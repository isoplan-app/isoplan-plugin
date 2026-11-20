import { mkdtempSync, readFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { PROTOCOL_VERSION, type HelloMessage, type Project } from "@isoplan/protocol";
import { afterEach, expect, test } from "vitest";
import { WebSocketServer } from "ws";
import { cachedRepos, createApproved, createSessionGate, type Get, type RepoList } from "./approved.js";
import { createLink, type Link } from "./link.js";
import type { Pairing, Refusal } from "./pairing.js";

const SERVER = "wss://office.team.example/data-layer";
const APP = "github.com/team/app";
const API = "github.com/team/api";
const MINUTE = 60000;
const LIST = { refreshMs: 5 * MINUTE, maxAgeMs: 15 * MINUTE, log: () => {} };

const cleanups: (() => unknown)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c();
});

function folder(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "isoplan-approved-"));
  // rmSync doesn't retry an EPERM from a scanner holding the folder, on Windows; this does.
  cleanups.push(() => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }));
  return path.join(dir, "approved.json");
}

/** A stand-in office server's GET /repos: answers `repos`, with a 304 for a current copy, and keeps each request's headers. */
function office(repos: string[] = [APP]) {
  const state = { repos, version: 1, status: 200 as number, asked: [] as Record<string, string>[], fails: false, slow: null as Promise<void> | null };
  const get: Get = async (url, headers) => {
    expect(url).toMatch(/\/data-layer\/repos$/);
    state.asked.push(headers);
    if (state.slow) await state.slow;
    if (state.fails) throw new Error("ECONNREFUSED");
    if (state.status !== 200) return { status: state.status, body: state.status === 401 ? { code: "not-paired" } : null };
    if (headers["if-none-match"] === `"v${state.version}"`) return { status: 304, body: null };
    return { status: 200, body: { version: `v${state.version}`, repos: state.repos } satisfies RepoList };
  };
  return {
    state,
    get,
    change(next: string[]) {
      state.repos = next;
      state.version++;
    },
  };
}

test("the list is read once, kept on disk for every process of the machine, and checked again with its version once it is due", async () => {
  const file = folder();
  const o = office();
  let clock = 1_000_000;
  const options = { ...LIST, server: SERVER, file, get: o.get, now: () => clock };
  const one = createApproved(options);
  expect(one.repos()).toBeNull();
  await one.refresh();
  expect([...one.repos()!]).toEqual([APP]);
  expect(JSON.parse(readFileSync(file, "utf8"))).toMatchObject({ server: SERVER, version: "v1", repos: [APP] });
  expect(await cachedRepos(file, SERVER, LIST.maxAgeMs, clock)).toEqual(new Set([APP]));
  expect(await cachedRepos(file, "wss://elsewhere.example/data-layer", LIST.maxAgeMs, clock)).toBeNull();

  // Another process uses the copy as it is while it is fresh.
  const two = createApproved(options);
  await two.refresh();
  expect([...two.repos()!]).toEqual([APP]);
  expect(o.state.asked).toHaveLength(1);

  clock += 5 * MINUTE;
  await two.refresh();
  expect(o.state.asked[1]).toEqual({ "if-none-match": '"v1"' });
  expect([...two.repos()!]).toEqual([APP]);
});

test("a copy the server can't confirm approves nothing once past its maximum age; so does a 500, and the commands' copy too", async () => {
  const file = folder();
  const o = office();
  let clock = 0;
  const approved = createApproved({ ...LIST, server: SERVER, file, get: o.get, now: () => clock });
  await approved.refresh();
  o.state.status = 500;
  clock += 10 * MINUTE;
  await approved.refresh();
  // Still within its maximum age: the copy stands.
  expect([...approved.repos()!]).toEqual([APP]);
  o.state.status = 200;
  o.state.fails = true;
  clock += 6 * MINUTE;
  await approved.refresh();
  expect(approved.repos()).toBeNull();
  expect(approved.problem()).toBe("unreachable");
  expect(await cachedRepos(file, SERVER, LIST.maxAgeMs, clock)).toBeNull();
});

test("with no copy, nothing is approved while the server can't be reached or is too old to list its repos", async () => {
  const o = office();
  o.state.fails = true;
  let clock = 0;
  const approved = createApproved({ ...LIST, server: SERVER, file: folder(), get: o.get, now: () => clock });
  await approved.refresh();
  expect(approved.repos()).toBeNull();
  expect(approved.problem()).toBe("unreachable");
  o.state.fails = false;
  o.state.status = 404;
  clock += MINUTE;
  await approved.refresh();
  expect(approved.repos()).toBeNull();
  expect(approved.problem()).toBe("too-old");
});

test("a forced check waits behind one running and then runs, rather than being skipped", async () => {
  const o = office();
  let release = () => {};
  o.state.slow = new Promise((r) => (release = r));
  const approved = createApproved({ ...LIST, server: SERVER, file: folder(), get: o.get });
  const first = approved.refresh();
  // The admin takes the repo out while the first check is in flight.
  o.change([]);
  const forced = approved.refresh(true);
  o.state.slow = null;
  release();
  await Promise.all([first, forced]);
  expect(o.state.asked).toHaveLength(2);
  expect([...approved.repos()!]).toEqual([]);
});

test("ask asks the server past a fresh copy, and a session takes what it kept at its next refresh, not at its own next check", async () => {
  const file = folder();
  const o = office([]);
  let clock = 0;
  const options = { ...LIST, server: SERVER, file, get: o.get, now: () => clock };
  const session = createApproved(options);
  await session.refresh();
  expect([...session.repos()!]).toEqual([]);

  // The admin adds the repo; a minute later /isoplan:repos asks at once.
  o.change([APP]);
  clock += MINUTE;
  const command = createApproved(options);
  expect(await command.ask()).toBe("listed");
  expect(o.state.asked).toHaveLength(2);
  expect([...command.repos()!]).toEqual([APP]);

  // The session's own check is four minutes off, but it takes the copy on disk now, asking nothing.
  await session.refresh();
  expect([...session.repos()!]).toEqual([APP]);
  expect(o.state.asked).toHaveLength(2);
});

test("a forced check uses a copy another process confirmed within refreshMs, so links dropping together ask the server once", async () => {
  const file = folder();
  const o = office();
  let clock = 0;
  const options = { ...LIST, server: SERVER, file, get: o.get, now: () => clock };
  const one = createApproved(options);
  const two = createApproved(options);
  await one.refresh();
  await two.refresh();
  expect(o.state.asked).toHaveLength(1);

  // The office restarts: both links drop, a minute later.
  clock += MINUTE;
  await one.refresh(true);
  await two.refresh(true);
  expect(o.state.asked).toHaveLength(2);
  expect([...two.repos()!]).toEqual([APP]);
});

test("after a 404 the copy it replaced isn't taken back, and the server is asked again only once refreshMs is up", async () => {
  const file = folder();
  const o = office();
  let clock = 0;
  const approved = createApproved({ ...LIST, server: SERVER, file, get: o.get, now: () => clock });
  await approved.refresh();
  o.state.status = 404;
  clock += 5 * MINUTE;
  await approved.refresh();
  expect(approved.problem()).toBe("too-old");
  expect(o.state.asked).toHaveLength(2);

  // Every pass after reads the old copy on disk, but neither takes it nor asks.
  for (let i = 0; i < 5; i++) {
    clock += 30000;
    await approved.refresh();
  }
  expect(approved.repos()).toBeNull();
  expect(o.state.asked).toHaveLength(2);
  clock += 3 * MINUTE;
  await approved.refresh();
  expect(o.state.asked).toHaveLength(3);
});

test("two processes writing the copy keep the newer version, whichever confirmed its own last", async () => {
  const file = folder();
  const o = office();
  let clock = 0;
  // b's server answer is held back: its request went before the change, so it confirms v1.
  let answer = () => {};
  let asked = false;
  const late: Get = async () => {
    asked = true;
    await new Promise<void>((r) => (answer = r));
    return { status: 304, body: null };
  };
  const a = createApproved({ ...LIST, server: SERVER, file, get: o.get, now: () => clock });
  await a.refresh();
  const b = createApproved({ ...LIST, server: SERVER, file, get: (u, h) => (h["if-none-match"] ? late(u, h) : o.get(u, h)), now: () => clock });
  await b.refresh();
  clock += 5 * MINUTE;
  const confirming = b.refresh(true);
  await until(() => asked);
  // Meanwhile the repo is taken out, and a writes v2.
  o.change([]);
  clock += 1;
  await a.refresh(true);
  expect(JSON.parse(readFileSync(file, "utf8"))).toMatchObject({ version: "v2", repos: [] });
  // b's answer, a 304 for v1 that it takes as confirmed later than a's, comes now: the newer version stays.
  clock += 1;
  answer();
  await confirming;
  expect(JSON.parse(readFileSync(file, "utf8"))).toMatchObject({ version: "v2", repos: [] });
  expect([...b.repos()!]).toEqual([]);
});

test("a machine not paired yet pairs from the list's refusal, sending no token until it has one, then reads the list with it", async () => {
  const o = office();
  o.state.status = 401;
  const told: [Refusal, string | undefined][] = [];
  let token: string | null | undefined;
  const pairing: Pairing = {
    token: async () => token,
    refused: async (code, sent) => {
      told.push([code, sent]);
      token = null;
    },
    close: async () => {},
  };
  let clock = 0;
  const approved = createApproved({ ...LIST, server: SERVER, file: folder(), pairing, get: o.get, now: () => clock });
  await approved.refresh();
  expect(o.state.asked).toEqual([{}]);
  expect(told).toEqual([["not-paired", undefined]]);
  await approved.refresh();
  expect(approved.problem()).toBe("pairing");
  expect(o.state.asked).toHaveLength(1);

  token = "t0k3n-" + "of-the-machine";
  o.state.status = 200;
  clock += 5000;
  await approved.refresh();
  expect(o.state.asked[1]).toEqual({ authorization: "Bearer t0k3n-of-the-machine" });
  expect([...approved.repos()!]).toEqual([APP]);
});

const project = (id: string): Project => ({ id, name: id.split("/").pop()! });
const hello = (p: Project): HelloMessage => ({ type: "hello", v: PROTOCOL_VERSION, source: "claude-code", account: { id: "claude:4f9c", name: "Ada" }, machine: { name: "sevengill" }, session: "claude-code:s", project: p });

async function until(check: () => boolean, ms = 3000) {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 5));
  }
}

/** A stand-in office server's socket, keeping each connection's messages, and a gate opening real links to it. */
async function gated(o: ReturnType<typeof office>, clock: { now: number }) {
  const wss = new WebSocketServer({ port: 0, host: "127.0.0.1" });
  await new Promise((resolve) => wss.once("listening", resolve));
  cleanups.push(() => new Promise((resolve) => wss.close(resolve)));
  const connections: { messages: { type: string; project?: { id: string } }[]; closed: boolean; close(): void }[] = [];
  wss.on("connection", (ws) => {
    const c = { messages: [] as { type: string }[], closed: false, close: () => ws.close() };
    connections.push(c);
    ws.on("message", (data) => c.messages.push(JSON.parse(String(data))));
    ws.on("close", () => (c.closed = true));
  });
  const url = `ws://127.0.0.1:${(wss.address() as AddressInfo).port}/data-layer`;
  const approved = createApproved({ ...LIST, server: url, file: folder(), get: o.get, now: () => clock.now });
  const gate = createSessionGate({
    approved,
    open: (home, mayConnect) => {
      const l: Link = createLink({ url, hello: hello(home), emit: () => {}, retryBaseMs: 20, retryCapMs: 50, admit: mayConnect });
      cleanups.push(() => l.close());
      return l;
    },
  });
  return { connections, gate, approved };
}

test("a session in a repo the office doesn't take opens no socket; added, it connects at the next check; taken out, its link closes", async () => {
  const o = office([]);
  const clock = { now: 0 };
  const { connections, gate } = await gated(o, clock);

  expect(await gate.home([project(APP)])).toEqual({ home: null, dormancy: "not-approved" });
  await new Promise((r) => setTimeout(r, 100));
  expect(connections).toEqual([]);

  o.change([APP]);
  clock.now += 5 * MINUTE;
  expect((await gate.home([project(APP)])).home?.id).toBe(APP);
  const link = gate.link();
  await until(() => connections[0]?.messages.some((m) => m.type === "hello") ?? false);
  expect(gate.link()).toBe(link);

  o.change([]);
  clock.now += 5 * MINUTE;
  expect(await gate.home([project(APP)])).toEqual({ home: null, dormancy: "not-approved" });
  await until(() => connections[0]!.closed);
  expect(connections).toHaveLength(1);
});

test("a dropped link reconnects only after the list is checked again: a copy past its maximum age opens no socket", async () => {
  const o = office([APP]);
  const clock = { now: 0 };
  const { connections, gate } = await gated(o, clock);
  await gate.home([project(APP)]);
  gate.link();
  await until(() => connections.length === 1 && connections[0]!.messages.length > 0);

  // The server can't be asked any more, and the copy ages out; then the link drops.
  o.state.fails = true;
  clock.now += 16 * MINUTE;
  connections[0]!.close();
  await new Promise((r) => setTimeout(r, 300));
  expect(connections).toHaveLength(1);

  // Reachable again and still approved: it reconnects, after checking.
  o.state.fails = false;
  await until(() => connections.length === 2 && connections[1]!.messages.some((m) => m.type === "hello"));
});

test("a workspace reports as the first of its repos the office takes, and opens nothing while it takes none", async () => {
  const o = office([]);
  const clock = { now: 0 };
  const { connections, gate } = await gated(o, clock);
  const repos = [project(API), project(APP)];
  expect((await gate.home(repos)).dormancy).toBe("not-approved");
  o.change([APP]);
  clock.now += 5 * MINUTE;
  expect((await gate.home(repos)).home?.id).toBe(APP);
  gate.link();
  await until(() => connections[0]?.messages.some((m) => m.type === "hello") ?? false);
  expect(connections[0]!.messages.find((m) => m.type === "hello")!.project!.id).toBe(APP);

  // Its first repo added too: it reports as that one, on a new link.
  o.change([API, APP]);
  clock.now += 5 * MINUTE;
  expect((await gate.home(repos)).home?.id).toBe(API);
  await until(() => connections[0]!.closed);
});

test("after not-wanted the link sits out its hour, but opens afresh once the list has changed", async () => {
  const o = office([APP]);
  const clock = { now: 0 };
  const { gate } = await gated(o, clock);
  await gate.home([project(APP)]);
  const first = gate.link();
  gate.notWanted();
  await gate.home([project(APP)]);
  expect(gate.current()).toBe(first);
  // The repo is taken out and added back: a new version.
  o.change([APP, API]);
  clock.now += 5 * MINUTE;
  await gate.home([project(APP)]);
  expect(gate.current()).toBeNull();
  expect(gate.link()).not.toBe(first);
});

test("a check that ends late, taking the repo out while a pass still uses the gate, leaves no link to open: link() is null, never a throw (#105)", async () => {
  const o = office([APP]);
  const clock = { now: 0 };
  const { connections, gate } = await gated(o, clock);
  expect((await gate.home([project(APP)])).home?.id).toBe(APP);
  expect(gate.link()).not.toBeNull();
  await until(() => connections[0]?.messages.some((m) => m.type === "hello") ?? false);

  // The next check is slow; meanwhile the pass goes on with the home it had.
  let answer = () => {};
  o.state.slow = new Promise<void>((r) => (answer = r));
  o.change([]);
  clock.now += 5 * MINUTE;
  const late = gate.home([project(APP)]);
  expect(gate.link()).not.toBeNull();
  answer();
  expect(await late).toEqual({ home: null, dormancy: "not-approved" });
  expect(gate.link()).toBeNull();
  await until(() => connections[0]!.closed);
});
