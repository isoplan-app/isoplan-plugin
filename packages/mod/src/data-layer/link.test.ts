import type { AddressInfo } from "node:net";
import { PROTOCOL_VERSION, type ExpertsMessage, type Facts, type HelloMessage, type RunnerHelloMessage } from "@isoplan/protocol";
import { afterEach, expect, test } from "vitest";
import { WebSocketServer, type WebSocket as ServerSocket } from "ws";
import type { DataLayerLine } from "../lines.js";
import { forOffice } from "./attribution.js";
import { createLink, type Link, type LinkOptions, type ServerAsk } from "./link.js";
import type { Refusal } from "./pairing.js";

const at = "2026-10-20T09:00:00.000Z";
const hello: HelloMessage = {
  type: "hello",
  v: PROTOCOL_VERSION,
  source: "claude-code",
  account: { id: "claude:4f9c", name: "Ada" },
  machine: { name: "sevengill" },
  session: "claude-code:s",
  project: { id: "github.com/adam/isoplan", name: "isoplan" },
};
const facts = (status: "active" | "idle", edits: string[] = []): Facts => ({
  session: { id: "claude-code:s", source: "claude-code", lead: "claude-code:s:lead", title: "main", titleFrom: "branch", branch: "main", lastActive: at, status, lights: "on" },
  agents: [
    {
      id: "claude-code:s:lead",
      source: "claude-code",
      session: "claude-code:s",
      startedBy: null,
      agentType: null,
      task: null,
      status: "working",
      statusSince: at,
      lastActive: at,
      doing: null,
      usage: null,
    },
  ],
  edits: edits.map((file) => ({ agent: "claude-code:s:lead", file, at })),
  reads: [],
  waits: [],
  reports: [],
});

// A fake office server: every message it got, in order, with when, and its open sockets.
async function server() {
  const wss = new WebSocketServer({ port: 0, host: "127.0.0.1" });
  await new Promise((resolve) => wss.once("listening", resolve));
  const got: { type: string; seq?: number; at: number; [key: string]: unknown }[] = [];
  const sockets: ServerSocket[] = [];
  wss.on("connection", (ws) => {
    sockets.push(ws);
    ws.on("message", (data) => got.push({ ...JSON.parse(String(data)), at: Date.now() }));
  });
  const { port } = wss.address() as AddressInfo;
  cleanups.push(() => new Promise((resolve) => wss.close(resolve)));
  return { url: `ws://127.0.0.1:${port}/data-layer`, got, sockets, wss };
}

const cleanups: (() => unknown)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c();
});

function link(url: string, opts: Partial<LinkOptions> = {}): { link: Link; lines: DataLayerLine[] } {
  const lines: DataLayerLine[] = [];
  const l = createLink({ url, hello, emit: (line) => lines.push(line), retryBaseMs: 20, retryCapMs: 100, ...opts });
  cleanups.push(() => l.close());
  return { link: l, lines };
}

async function until(check: () => boolean, ms = 3000) {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 5));
  }
}

const types = (got: { type: string; seq?: number }[]) => got.map((m) => (m.seq === undefined ? m.type : `${m.type} ${m.seq}`));

test("link: hello, then full, then only what changed, seq going up by one", async () => {
  const s = await server();
  const { link: l, lines } = link(s.url, { minIntervalMs: 0 });
  l.update(facts("active"));
  await until(() => s.got.length === 2);
  expect(types(s.got)).toEqual(["hello", "full 0"]);
  expect(s.got[0]).toMatchObject(hello);
  expect(s.got[1]).toMatchObject({ v: PROTOCOL_VERSION, facts: facts("active") });

  l.update(facts("active")); // nothing changed: nothing sent
  l.update(facts("idle", ["a.md"]));
  await until(() => s.got.length === 3);
  expect(s.got[2]).toMatchObject({ type: "changes", seq: 1, upsert: { session: facts("idle").session, edits: facts("idle", ["a.md"]).edits }, remove: {} });
  expect(lines.filter((x) => x.type === "status").map((x) => x.type === "status" && x.state)).toEqual(["connecting", "connected"]);
});

test("link: a repair gets the facts in full again", async () => {
  const s = await server();
  const { link: l } = link(s.url, { minIntervalMs: 0 });
  l.update(facts("active"));
  await until(() => s.got.length === 2);
  l.update(facts("idle"));
  await until(() => s.got.length === 3);
  s.sockets[0]!.send(JSON.stringify({ type: "repair", v: PROTOCOL_VERSION, reason: "missed seq 1" }));
  await until(() => s.got.length === 4);
  expect(types(s.got)).toEqual(["hello", "full 0", "changes 1", "full 2"]);
  expect(s.got[3]).toMatchObject({ facts: facts("idle") });
});

test("link: a dropped link reconnects with backoff and sends hello and full again; nothing is kept while down", async () => {
  const s = await server();
  const { link: l, lines } = link(s.url, { minIntervalMs: 0 });
  l.update(facts("active"));
  await until(() => s.got.length === 2);
  s.sockets[0]!.terminate();
  await until(() => lines.some((x) => x.type === "status" && x.state === "disconnected"));
  l.update(facts("idle", ["a.md"])); // while down
  await until(() => s.got.length === 4);
  expect(types(s.got)).toEqual(["hello", "full 0", "hello", "full 0"]);
  expect(s.got[3]).toMatchObject({ facts: facts("idle", ["a.md"]) });
  const down = lines.find((x) => x.type === "status" && x.state === "disconnected");
  expect(down).toMatchObject({ server: s.url, retryInMs: expect.any(Number) });
});

test("link: an unreachable server is retried with growing, capped delays", async () => {
  const s = await server();
  await new Promise((resolve) => s.wss.close(resolve));
  const { link: l, lines } = link(s.url, { random: () => 1, retryBaseMs: 10, retryCapMs: 40 });
  l.update(facts("active"));
  await until(() => lines.filter((x) => x.type === "status" && x.state === "disconnected").length >= 4);
  const delays = lines.flatMap((x) => (x.type === "status" && x.state === "disconnected" ? [x.retryInMs] : []));
  expect(delays.slice(0, 4)).toEqual([10, 20, 40, 40]);
});

test("link: changes go no faster than once a second, carrying the latest facts", async () => {
  const s = await server();
  const { link: l } = link(s.url);
  const t0 = Date.now();
  l.update(facts("active"));
  await until(() => s.got.length === 2);
  l.update(facts("idle"));
  await new Promise((r) => setTimeout(r, 100));
  l.update(facts("idle", ["a.md"]));
  await until(() => s.got.length === 3);
  l.update(facts("idle", ["a.md", "b.md"]));
  await until(() => s.got.length === 4);
  expect(types(s.got)).toEqual(["hello", "full 0", "changes 1", "changes 2"]);
  // The full went at t0 or later, so the first change no sooner than a second after t0, and the second a second after that.
  expect(s.got[2]!.at - t0).toBeGreaterThanOrEqual(1000);
  expect(s.got[3]!.at - t0).toBeGreaterThanOrEqual(2000);
  expect(s.got[2]).toMatchObject({ upsert: { session: facts("idle").session, edits: facts("idle", ["a.md"]).edits } });
});

test("link: the server's conflict notes, errors and late answers from the room go out as lines; a message it can't read is logged", async () => {
  const s = await server();
  const { link: l, lines } = link(s.url, { minIntervalMs: 0 });
  l.update(facts("active"));
  await until(() => s.got.length === 2);
  const conflict = { type: "conflict", v: PROTOCOL_VERSION, agent: "claude-code:s:lead", file: "a.md", text: "Bea's agent edited a.md 3 minutes ago." };
  s.sockets[0]!.send(JSON.stringify(conflict));
  s.sockets[0]!.send(JSON.stringify({ type: "error", v: PROTOCOL_VERSION, code: "not-paired", message: "Pair this machine first." }));
  const asked = { type: "asked", v: PROTOCOL_VERSION, question: "q-1", text: "Which branch?", state: "answered", answer: "feat/migrate-v2." };
  const rights = { type: "ask-rights", v: PROTOCOL_VERSION, room: "room:claude-code:a1", owner: { id: "p-adam", name: "Adam" }, granted: true };
  s.sockets[0]!.send(JSON.stringify(asked));
  s.sockets[0]!.send(JSON.stringify(rights));
  s.sockets[0]!.send(JSON.stringify({ type: "conflict", v: PROTOCOL_VERSION + 1 }));
  await until(() => lines.length >= 7);
  expect(lines.slice(2)).toEqual([conflict, { type: "error", v: PROTOCOL_VERSION, code: "not-paired", message: "Pair this machine first." }, asked, rights, { type: "log", text: expect.stringContaining("unsupported-version") }]);
});

test("link: not-wanted is passed on, then the link waits and asks again only after notWantedRetryMs", async () => {
  const s = await server();
  s.wss.on("connection", (ws) => {
    ws.send(JSON.stringify({ type: "error", v: PROTOCOL_VERSION, code: "not-wanted", message: "this project isn't in any office on this server" }));
    ws.close(1008, "not-wanted");
  });
  let told = 0;
  const { link: l, lines } = link(s.url, { notWantedRetryMs: 300, onNotWanted: () => told++ });
  l.update(facts("active"));
  await until(() => lines.some((x) => x.type === "status" && x.state === "not-wanted"));
  expect(told).toBe(1);
  expect(lines).toContainEqual({ type: "error", v: PROTOCOL_VERSION, code: "not-wanted", message: "this project isn't in any office on this server" });
  expect(lines.some((x) => x.type === "status" && x.state === "disconnected")).toBe(false);
  await new Promise((r) => setTimeout(r, 150)); // the fast backoff would have tried again by now
  expect(s.sockets.length).toBe(1);
  await until(() => s.sockets.length === 2);
});

test("link: a conflict note for an agent outside this session is not passed on", async () => {
  const s = await server();
  const { link: l, lines } = link(s.url, { minIntervalMs: 0 });
  l.update(facts("active"));
  await until(() => s.got.length === 2);
  s.sockets[0]!.send(JSON.stringify({ type: "conflict", v: PROTOCOL_VERSION, agent: "claude-code:someone-else", file: "a.md", text: "Not yours." }));
  await until(() => lines.length >= 3);
  expect(lines[2]).toEqual({ type: "log", text: expect.stringContaining("not an agent of this session") });
});

test("link: a runner's link passes the server's requests on, and a reply sent while down goes after the next hello", async () => {
  const s = await server();
  const runnerHello: RunnerHelloMessage = { type: "runner", v: PROTOCOL_VERSION, account: hello.account, machine: hello.machine };
  const asks: ServerAsk[] = [];
  const { link: l, lines } = link(s.url, { hello: runnerHello, onMessage: (m) => asks.push(m) });
  await until(() => s.got.length === 1);
  expect(s.got[0]).toMatchObject(runnerHello);
  const request = { type: "request", v: PROTOCOL_VERSION, id: "q1", kind: "answer-question", session: "claude-code:s", room: "r", from: { id: "claude:bob", name: "Bob" }, question: "Why?" };
  s.sockets[0]!.send(JSON.stringify(request));
  s.sockets[0]!.send(JSON.stringify({ type: "release", v: PROTOCOL_VERSION, id: "q0" }));
  await until(() => asks.length === 2);
  expect(asks).toEqual([request, { type: "release", v: PROTOCOL_VERSION, id: "q0" }]);

  s.sockets[0]!.terminate();
  await until(() => lines.some((x) => x.type === "status" && x.state === "disconnected"));
  l.send({ type: "reply", v: PROTOCOL_VERSION, id: "q1", kind: "answer-question", answer: "Because." });
  await until(() => s.got.length === 3);
  expect(types(s.got)).toEqual(["runner", "runner", "reply"]);
  expect(s.got[2]).toMatchObject({ id: "q1", answer: "Because." });
});

test("link: a runner's link passes drive requests and drive-policy to onDrive, tells onOpen after every hello and onClose at every drop, and sends a driven message only while up", async () => {
  const s = await server();
  const runnerHello: RunnerHelloMessage = { type: "runner", v: PROTOCOL_VERSION, account: hello.account, machine: hello.machine, drive: true };
  const drives: unknown[] = [];
  let opened = 0;
  let closed = 0;
  const { link: l, lines } = link(s.url, { hello: runnerHello, onDrive: (m) => drives.push(m), onOpen: () => void opened++, onClose: () => void closed++ });
  await until(() => opened === 1);
  expect(s.got).toHaveLength(1);
  const policy = { type: "drive-policy", v: PROTOCOL_VERSION, bypassAllowed: ["github.com/ada/app"] };
  const stop = { type: "drive", v: PROTOCOL_VERSION, id: "d1", by: hello.account, kind: "stop", session: "claude-code:s" };
  s.sockets[0]!.send(JSON.stringify(policy));
  s.sockets[0]!.send(JSON.stringify(stop));
  await until(() => drives.length === 2);
  expect(drives).toEqual([policy, stop]);
  const released = { type: "driven", v: PROTOCOL_VERSION, kind: "released", session: "claude-code:s", why: "stopped", id: "d1" } as const;
  expect(l.sendLive(released)).toBe(true);
  await until(() => s.got.length === 2);
  expect(closed).toBe(0);
  s.sockets[0]!.terminate();
  await until(() => lines.some((x) => x.type === "status" && x.state === "disconnected"));
  expect(closed).toBe(1);
  expect(l.sendLive(released)).toBe(false);
  await until(() => opened === 2);
  expect(closed).toBe(1);
  await new Promise((r) => setTimeout(r, 50));
  // The one sent while it was down is gone, not sent after the next hello.
  expect(types(s.got)).toEqual(["runner", "driven", "runner"]);
});

test("link: a session's link passes the experts it may ask on as a line; a runner's passes hosting to onHosting, and sends its listing only while up", async () => {
  const s = await server();
  const { link: session, lines } = link(s.url, { minIntervalMs: 0 });
  session.update(facts("active"));
  await until(() => s.got.length === 2);
  const rights = { type: "expert-rights", v: PROTOCOL_VERSION, experts: [{ name: "reporting", subject: "What leaves a machine.", repo: "isoplan-app", host: "Ada" }] };
  s.sockets[0]!.send(JSON.stringify(rights));
  await until(() => lines.some((l) => l.type === "expert-rights"));
  expect(lines.find((l) => l.type === "expert-rights")).toEqual(rights);

  const runner = await server();
  const runnerHello: RunnerHelloMessage = { type: "runner", v: PROTOCOL_VERSION, account: hello.account, machine: hello.machine, experts: true };
  const hosting: unknown[] = [];
  const { link: l, lines: runnerLines } = link(runner.url, { hello: runnerHello, onHosting: (m) => hosting.push(m) });
  await until(() => runner.got.length === 1);
  expect(runner.got[0]).toMatchObject({ type: "runner", experts: true });
  const listed = { type: "hosting", v: PROTOCOL_VERSION, listed: ["reporting"] };
  runner.sockets[0]!.send(JSON.stringify(listed));
  await until(() => hosting.length === 1);
  expect(hosting).toEqual([listed]);
  const listing: ExpertsMessage = { type: "experts", v: PROTOCOL_VERSION, experts: [{ name: "reporting", project: { id: "github.com/ada/isoplan-app", name: "isoplan-app" }, subject: "What leaves a machine.", state: "ready" }] };
  expect(l.sendLive(listing)).toBe(true);
  await until(() => runner.got.length === 2);
  expect(runner.got[1]).toMatchObject(listing);
  runner.sockets[0]!.terminate();
  await until(() => runnerLines.some((x) => x.type === "status" && x.state === "disconnected"));
  expect(l.sendLive(listing)).toBe(false);
});

test("link: replies kept while down are bounded, the oldest dropped first", async () => {
  const s = await server();
  const runnerHello: RunnerHelloMessage = { type: "runner", v: PROTOCOL_VERSION, account: hello.account, machine: hello.machine };
  const { link: l, lines } = link(s.url, { hello: runnerHello });
  await until(() => s.got.length === 1);
  s.sockets[0]!.terminate();
  await until(() => lines.some((x) => x.type === "status" && x.state === "disconnected"));
  for (let i = 0; i < 101; i++) l.send({ type: "refusal", v: PROTOCOL_VERSION, id: `q${i}`, reason: "withheld" });
  await until(() => s.got.length === 102);
  await new Promise((r) => setTimeout(r, 50));
  expect(s.got.slice(2).map((m) => m.id)).toEqual(Array.from({ length: 100 }, (_, i) => `q${i + 1}`));
});

test("link: a hello refused for its token is told to pairing, which pairs or renews, and the link tries again", async () => {
  const s = await server();
  // The server takes only the fresh token: no token is not-paired, an old one has expired.
  s.wss.on("connection", (ws) => {
    ws.once("message", (data) => {
      const { token } = JSON.parse(String(data)) as { token?: string };
      if (token === "fresh") return;
      const code = token ? "token-expired" : "not-paired";
      ws.send(JSON.stringify({ type: "error", v: PROTOCOL_VERSION, code, message: code === "not-paired" ? "Pair this machine first." : "expired" }));
      ws.close(1008, code);
    });
  });
  const refused: [string, string | undefined][] = [];
  const answers: (string | null | undefined)[] = [undefined, null, "old", "fresh"];
  const pairing = {
    token: async () => answers.shift(),
    refused: async (code: Refusal, sent: string | undefined) => void refused.push([code, sent]),
    close: async () => {},
  };
  const { link: l, lines } = link(s.url, { pairing, pairPollMs: 20, retryBaseMs: 20, retryCapMs: 40 });
  l.update(facts("active"));
  await until(() => s.got.at(-1)?.type === "full" && s.got.at(-2)?.token === "fresh");
  expect(refused).toEqual([["not-paired", undefined], ["token-expired", "old"]]);
  expect(s.got.filter((m) => m.type === "hello").map((m) => m.token)).toEqual([undefined, "old", "fresh"]);
  expect(lines.some((x) => x.type === "status" && x.state === "pairing")).toBe(true);
  // The server's words on how to pair are shown; the renewal only logged.
  expect(lines).toContainEqual({ type: "error", v: PROTOCOL_VERSION, code: "not-paired", message: "Pair this machine first." });
  expect(lines.some((x) => x.type === "error" && x.code === "token-expired")).toBe(false);
});

test("link: hellos refused again and again back off, doubling up to the cap, though each socket opened", async () => {
  const s = await server();
  s.wss.on("connection", (ws) => {
    ws.once("message", () => {
      ws.send(JSON.stringify({ type: "error", v: PROTOCOL_VERSION, code: "not-paired", message: "no token here" }));
      ws.close(1008, "not-paired");
    });
  });
  const pairing = { token: async () => "unread" + "-token", refused: async () => {}, close: async () => {} };
  const { link: l, lines } = link(s.url, { pairing, retryBaseMs: 20, retryCapMs: 80 });
  l.update(facts("active"));
  await until(() => lines.filter((x) => x.type === "status" && x.state === "disconnected").length >= 5);
  const waits = lines.flatMap((x) => (x.type === "status" && x.state === "disconnected" ? [x.retryInMs] : []));
  expect(waits.slice(0, 5)).toEqual([20, 40, 80, 80, 80]);
});

test("link: a runner's hello carries the machine's token too, and pairing-ended is told once the credential is dropped", async () => {
  const s = await server();
  s.wss.on("connection", (ws) => {
    ws.once("message", () => {
      ws.send(JSON.stringify({ type: "error", v: PROTOCOL_VERSION, code: "pairing-ended", message: "revoked" }));
      ws.close(1008, "pairing-ended");
    });
  });
  const events: string[] = [];
  const pairing = {
    token: async () => "machine" + "-token",
    refused: async (code: Refusal) => void events.push(`refused ${code}`),
    close: async () => {},
  };
  const runnerHello: RunnerHelloMessage = { type: "runner", v: PROTOCOL_VERSION, account: hello.account, machine: hello.machine };
  link(s.url, { hello: runnerHello, pairing, onPairingEnded: () => events.push("ended") });
  await until(() => events.includes("ended"));
  expect(s.got[0]).toMatchObject({ type: "runner", token: "machine-token" });
  expect(events.slice(0, 2)).toEqual(["refused pairing-ended", "ended"]);
});

test("link: forged-hello is shown and stops the link, which asks again only after takenRetryMs", async () => {
  const s = await server();
  s.wss.on("connection", (ws) => {
    ws.once("message", () => {
      ws.send(JSON.stringify({ type: "error", v: PROTOCOL_VERSION, code: "forged-hello", message: "session claude-code:s belongs to someone else on this office" }));
      ws.close(1008, "forged-hello");
    });
  });
  const pairing = { token: async () => "machine" + "-token", refused: async () => {}, close: async () => {} };
  const { link: l, lines } = link(s.url, { pairing, takenRetryMs: 300 });
  l.update(facts("active"));
  await until(() => lines.some((x) => x.type === "status" && x.state === "taken"));
  expect(lines).toContainEqual({ type: "error", v: PROTOCOL_VERSION, code: "forged-hello", message: "session claude-code:s belongs to someone else on this office" });
  await new Promise((r) => setTimeout(r, 150)); // the fast backoff would have tried again by now
  expect(s.sockets.length).toBe(1);
  await until(() => s.sockets.length === 2);
});

test("link: a token that runs out on a link that stayed up is renewed and the link opened again at once, unseen", async () => {
  const s = await server();
  let opened = 0;
  s.wss.on("connection", (ws) => {
    if (++opened > 1) return;
    // The first link is up a while, then its token runs out.
    setTimeout(() => {
      ws.send(JSON.stringify({ type: "error", v: PROTOCOL_VERSION, code: "token-expired", message: "expired" }));
      ws.close(1008, "token-expired");
    }, 20);
  });
  const tokens = ["first" + "-token", "second" + "-token"];
  const pairing = { token: async () => tokens.shift() ?? "second" + "-token", refused: async () => {}, close: async () => {} };
  // A backoff this long can't finish inside the wait, so only the renewal's own reconnect gets there.
  const { link: l, lines } = link(s.url, { pairing, retryBaseMs: 10000, retryCapMs: 10000 });
  l.update(facts("active"));
  await until(() => s.got.filter((m) => m.type === "runner" || m.type === "hello").length === 2);
  expect(s.got.filter((m) => m.type === "hello").map((m) => m.token)).toEqual(["first-token", "second-token"]);
  expect(lines.some((x) => x.type === "status" && x.state === "disconnected")).toBe(false);
});

test("link: another repo's edits go only after this connection's welcome, and a reconnect's full goes by the new connection's", async () => {
  const s = await server();
  const web = { id: "github.com/team/web", name: "web" };
  const filter = (f: Facts, projects: ReadonlySet<string> | null) => forOffice(f, projects);
  const { link: l } = link(s.url, { minIntervalMs: 0, filter });
  const away = { ...facts("active", ["a.md"]), edits: [{ agent: "claude-code:s:lead", file: "a.md", at: "2026-10-20T09:00:00.000Z" }, { agent: "claude-code:s:lead", file: "x.ts", at: "2026-10-20T09:00:00.000Z", project: web, away: true }] };
  l.update(away);
  await until(() => s.got.length === 2);
  const edits = (m: { [key: string]: unknown }) => ((m.facts ?? m.upsert) as Facts).edits?.map((e) => e.file);
  expect([l.projects(), edits(s.got[1]!)]).toEqual([null, ["a.md"]]);
  s.sockets[0]!.send(JSON.stringify({ type: "welcome", v: PROTOCOL_VERSION, projects: ["GitHub.com/team/web"] }));
  await until(() => s.got.length === 3);
  expect([[...l.projects()!], s.got[2]!.type, edits(s.got[2]!)]).toEqual([["github.com/team/web"], "changes", ["x.ts"]]);
  // A new connection has had no welcome: its full keeps the other repo's edit on the machine.
  s.sockets[0]!.close();
  await until(() => s.got.filter((m) => m.type === "full").length === 2);
  expect([l.projects(), edits(s.got.filter((m) => m.type === "full")[1]!)]).toEqual([null, ["a.md"]]);
  l.close();
});

test("link: a throw in its socket handlers goes to onError, and that handler sends nothing more (#104)", async () => {
  const s = await server();
  const errors: unknown[] = [];
  // As it opens: the full's filter throws.
  const { link: opening, lines } = link(s.url, { filter: () => { throw new Error("boom: on open"); }, onError: (err) => errors.push(err) });
  opening.update(facts("active"));
  await until(() => errors.length === 1);
  expect(String(errors[0])).toBe("Error: boom: on open");
  expect(types(s.got)).toEqual(["hello"]);
  expect(lines.some((x) => x.type === "status" && x.state === "connected")).toBe(false);
  opening.close();
  // On a message: the welcome's flush throws.
  s.got.length = 0;
  const { link: l } = link(s.url, { minIntervalMs: 0, filter: (f, projects) => { if (projects) throw new Error("boom: on welcome"); return f; }, onError: (err) => errors.push(err) });
  l.update(facts("active"));
  await until(() => s.got.length === 2 && s.sockets.length === 2);
  l.update(facts("idle", ["a.md"]));
  await until(() => s.got.length === 3);
  s.sockets[1]!.send(JSON.stringify({ type: "welcome", v: PROTOCOL_VERSION, projects: ["github.com/adam/isoplan"] }));
  await until(() => errors.length === 2);
  expect(String(errors[1])).toBe("Error: boom: on welcome");
  expect(types(s.got)).toEqual(["hello", "full 0", "changes 1"]);
  l.close();
});

test("link: a runner's passes the server's expert creation suggestion messages to onExpertCreationSuggestionMessages, and sends its own only while up; without onExpertCreationSuggestionMessages they are logged", async () => {
  const runner = await server();
  const runnerHello: RunnerHelloMessage = { type: "runner", v: PROTOCOL_VERSION, account: hello.account, machine: hello.machine, canCreateExpertsFromSuggestions: true };
  const suggestionMessages: unknown[] = [];
  const { link: l, lines } = link(runner.url, { hello: runnerHello, onExpertCreationSuggestionMessages: (m) => suggestionMessages.push(m) });
  await until(() => runner.got.length === 1);
  expect(runner.got[0]).toMatchObject({ type: "runner", canCreateExpertsFromSuggestions: true });
  const dismissals = { type: "expert-creation-suggestion-dismissals", v: PROTOCOL_VERSION, dismissals: [] };
  const ended = { type: "expert-creation-suggestion-ended", v: PROTOCOL_VERSION, id: "o1", why: "made", key: "pairing" };
  for (const m of [dismissals, ended]) runner.sockets[0]!.send(JSON.stringify(m));
  await until(() => suggestionMessages.length === 2);
  expect(suggestionMessages).toEqual([dismissals, ended]);
  const progress = { type: "expert-creation-progress", v: PROTOCOL_VERSION, request: "m1", expertCreationSuggestionId: "o1", state: "cloning" } as const;
  expect(l.sendLive(progress)).toBe(true);
  await until(() => runner.got.length === 2);
  expect(runner.got[1]).toMatchObject(progress);
  runner.sockets[0]!.terminate();
  await until(() => lines.some((x) => x.type === "status" && x.state === "disconnected"));
  expect(l.sendLive(progress)).toBe(false);

  const plain = await server();
  const { lines: plainLines } = link(plain.url, { hello: runnerHello });
  await until(() => plain.got.length === 1);
  plain.sockets[0]!.send(JSON.stringify(dismissals));
  await until(() => plainLines.some((x) => x.type === "log" && x.text.includes("expert-creation-suggestion-dismissals message, which this data layer doesn't handle")));
});
