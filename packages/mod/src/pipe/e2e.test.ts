// A session with the plugin, end to end through the runner (ADR 0007 step 2), against a stand-in
// office server, in a throwaway config folder: the runner's pipe (server.ts), its reporting
// (src/runner/reporting.ts, report-session.ts) put together as the runner's worker puts them, and a
// hooks module's end of the pipe (client.ts) in this process, its lines read as the hooks module
// reads them. The status line, an answer and a message from the floor, and ask_earlier_session (dist/ask.js,
// rebuilt with every change) all go through the runner; a runner started again mid-session has the
// session back on the floor, on one link at a time. So does ask_expert (dist/ask-expert.js), its
// answer in time or, past the wait, as a late line down the session's link, acked through dist/ask.js.

import { execFile, execFileSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import { WebSocketServer } from "ws";
import { loadConfig } from "../data-layer/config.js";
import { modDir, tempRoot } from "../data-layer/fixture.js";
import { nodeIo } from "../data-layer/io.js";
import { reportSession, sessionLog } from "../data-layer/report-session.js";
import type { DataLayerLine } from "../lines.js";
import { watchSessions } from "../runner/reporting.js";
import { relay } from "./client.js";
import { createPipeServer, type Hooked } from "./server.js";

vi.setConfig({ testTimeout: 40000 });

const closing: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  // The last opened closes first: the runner before its office.
  for (const close of closing.splice(0).reverse()) await close();
  vi.unstubAllEnvs();
});

async function until(check: () => boolean, ms = 20000) {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 20));
  }
}

type Sent = { type: string; id?: string; account?: { id: string }; facts?: { session: Record<string, unknown>; questions?: { id: string; answerable?: boolean }[] }; upsert?: { questions?: { id: string; answerable?: boolean }[] } };

// A full commit hash, and the citation block an expert's answer ends with.
const COMMIT = "1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b";
const EXPERT_ANSWER = "Only ids and counts leave it.\n\nCited, on main at 1a2b3c4:\n- docs/adr/0004-what-leaves-a-machine.md (read at 1a2b3c4)";

/**
 * A stand-in office that takes github.com/team/app; it answers a question for the room at once, and
 * one for an expert at once while `expert.now`, otherwise only that it is being answered.
 */
async function office() {
  const connections: { messages: Sent[]; closed: boolean; openAtHello: number; send(message: unknown): void }[] = [];
  const expert = { now: true };
  const server = http.createServer((request, response) => {
    if (!request.url?.startsWith("/data-layer/repos")) return void response.writeHead(404).end();
    response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ version: "v1", repos: ["github.com/team/app"] }));
  });
  const wss = new WebSocketServer({ server });
  wss.on("connection", (ws) => {
    const c = { messages: [] as Sent[], closed: false, openAtHello: 0, send: (message: unknown) => ws.send(JSON.stringify(message)) };
    connections.push(c);
    ws.on("message", (data) => {
      const message = JSON.parse(String(data)) as Sent & { question?: string; key?: string };
      c.messages.push(message);
      // How many of the session's links were still open as this one said hello.
      if (message.type === "hello") c.openAtHello = links().filter((l) => !l.closed).length;
      if (message.type === "ask-room") c.send({ type: "asked", v: 1, question: "q-1", text: message.question, state: "answered", answer: "Because the tests needed it.", owner: "Sam", key: message.key });
      if (message.type === "ask-expert") {
        const about = { type: "asked", v: 1, question: `x-${message.key === "toolu_x1" ? "0000000001" : "0000000002"}`, text: message.question, owner: "Adam", key: message.key, expert: "reporting" };
        c.send(expert.now ? { ...about, state: "answered", answer: EXPERT_ANSWER, commit: COMMIT, branch: "main" } : { ...about, state: "asking" });
      }
      if (message.type === "ask-check" && message.question === "x-0000000002") c.send({ type: "asked", v: 1, question: message.question, text: "Where do usage events go?", state: "asking", owner: "Adam", expert: "reporting" });
    });
    ws.on("close", () => (c.closed = true));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  closing.push(() => new Promise((resolve) => (wss.close(), server.closeAllConnections(), server.close(resolve))));
  // The session's own links: those that sent its facts.
  const links = () => connections.filter((c) => c.messages.some((m) => m.type === "full"));
  return { connections, links, expert, url: `ws://127.0.0.1:${(server.address() as AddressInfo).port}/data-layer` };
}

/** A repo the office takes, and session s1 in it whose agent has just asked its owner a question. */
function machine(url: string) {
  const root = tempRoot();
  const claudeDir = path.join(root, "claude");
  const repo = path.join(root, "app");
  fs.mkdirSync(repo);
  execFileSync("git", ["init", "-q"], { cwd: repo });
  execFileSync("git", ["remote", "add", "origin", "https://github.com/team/app.git"], { cwd: repo });
  const now = new Date().toISOString();
  const questions = [{ question: "Which branch?", header: "Branch", options: [{ label: "main", description: "Straight to main." }], multiSelect: false }];
  const transcript = path.join(claudeDir, "projects", "-app", "s1.jsonl");
  fs.mkdirSync(path.dirname(transcript), { recursive: true });
  fs.writeFileSync(
    transcript,
    [
      { type: "user", cwd: repo, timestamp: now, message: { role: "user", content: "fix the bug" } },
      { type: "assistant", cwd: repo, timestamp: now, message: { role: "assistant", content: [{ type: "tool_use", id: "toolu_q1", name: "AskUserQuestion", input: { questions } }] } },
    ]
      .map((l) => JSON.stringify(l))
      .join("\n") + "\n",
  );
  fs.mkdirSync(path.join(claudeDir, "isoplan"), { recursive: true });
  fs.writeFileSync(path.join(claudeDir, "isoplan", "config.json"), JSON.stringify({ server: url }));
  vi.stubEnv("CLAUDE_CONFIG_DIR", claudeDir);
  vi.stubEnv("CLAUDE_CODE_PLUGIN_CACHE_DIR", "");
  return { claudeDir, repo };
}

/** The runner's worker as it reports sessions and serves its pipe; `stop` ends it as the worker ends. */
async function runner(claudeDir: string) {
  const io = nodeIo();
  const config = () => loadConfig(io, path.join(modDir, "config.json"), path.join(claudeDir, "isoplan", "config.json"));
  let pipe: Awaited<ReturnType<typeof createPipeServer>> | null = null;
  const reporting = watchSessions<Hooked>({
    claudeDir,
    io,
    config,
    isOff: async () => false,
    log: () => {},
    hooked: (id) => pipe?.hooked(id) ?? null,
    held: (_id, hooks) => hooks.send({ type: "superseded", reason: "earlier" }),
    report: async ({ sessionId, cwd, closed, notWanted, hooks }) => {
      const said = sessionLog(claudeDir, sessionId);
      if (hooks) return reportSession({ sessionId, cwd, by: "hooks", appDir: modDir, root: hooks.root, takesMessages: hooks.messages, asksExperts: hooks.experts, emit: (line) => (said.emit(line), hooks.send(line)), closed: Promise.race([closed, hooks.closed]) });
      return reportSession({ sessionId, cwd, by: "runner", appDir: modDir, emit: said.emit, closed, notWanted, isOff: async () => false });
    },
  });
  // The asks the runner makes for the session are the worker's (askFromMachine, askExpertFromMachine), with its secret scan.
  const { askFromMachine } = await import("../ask/machine.js");
  const { askExpertFromMachine } = await import("../ask/expert-machine.js");
  const { loadPatterns, scan } = await import("../runner/scan.js");
  const scanText = async (text: string) => scan(text, await loadPatterns(path.join(modDir, "secret-patterns.json"), path.join(claudeDir, "isoplan", "secret-patterns.json"), () => {}));
  pipe = await createPipeServer({ claudeDir, log: () => {}, onChange: (s) => reporting.rehook(s), ask: (request) => askFromMachine({ ...request, appDir: modDir, scan: scanText }), askExpert: (request) => askExpertFromMachine({ ...request, appDir: modDir, scan: scanText }) });
  const stop = async () => {
    await reporting.stop();
    await pipe!.close();
  };
  closing.push(stop);
  return { pipe, reporting, stop };
}

/** The hooks module's end for s1, in this process, with what the hooks module would do with a few of its lines. */
function hooksModule(claudeDir: string, repo: string, since = Date.now()) {
  const out: DataLayerLine[] = [];
  let on = true;
  closing.push(async () => void (on = false));
  const relayed = relay({
    claudeDir,
    hello: { session: "s1", cwd: repo, since, messages: true, experts: true, root: modDir, version: "0.12.0" },
    out: (line) => {
      out.push(line);
      // As the hooks module marks the question it waits on, where the waits line says.
      if (line.type === "waits") fs.writeFileSync(path.join(line.dir, "toolu_q1.json"), JSON.stringify({ question: "toolu_q1", waiting: true }));
    },
    goOn: () => on,
    startRunner: async () => "running",
    retryMs: async () => 100,
  });
  return { out, relayed, of: <T extends DataLayerLine["type"]>(type: T) => out.filter((l): l is Extract<DataLayerLine, { type: T }> => l.type === type) };
}

const askScript = (claudeDir: string, repo: string, url: string, question: string) =>
  new Promise<string>((resolve) => {
    const child = execFile(process.execPath, [path.join(modDir, "dist", "ask.js"), "--session", "s1", "--cwd", repo, "--server", url, "--key", "toolu_ask"], { env: { ...process.env, CLAUDE_CONFIG_DIR: claudeDir }, windowsHide: true }, (_err, stdout) => resolve(stdout.trim()));
    child.stdin!.end(question);
  });

// ask_expert's script as the hooks module runs it, blocking: what it prints and its exit code.
const askExpertScript = (claudeDir: string, repo: string, url: string, key: string, question: string) =>
  new Promise<{ said: string; code: number }>((resolve) => {
    const argv = [path.join(modDir, "dist", "ask-expert.js"), "--session", "s1", "--cwd", repo, "--expert", "reporting", "--key", key, "--blocking", "--server", url];
    const child = execFile(process.execPath, argv, { env: { ...process.env, CLAUDE_CONFIG_DIR: claudeDir }, windowsHide: true }, (err, stdout) => resolve({ said: stdout.trim(), code: err ? Number(err.code) : 0 }));
    child.stdin!.end(question);
  });

const ackScript = (claudeDir: string, repo: string, url: string, question: string) =>
  new Promise<void>((resolve) => {
    execFile(process.execPath, [path.join(modDir, "dist", "ask.js"), "--session", "s1", "--cwd", repo, "--server", url, "--ack", question], { env: { ...process.env, CLAUDE_CONFIG_DIR: claudeDir }, windowsHide: true }, () => resolve());
  });

test("ask_expert through the runner: the session's fact asks for rights, which reach its hooks module; a blocking question answered in time prints the answer and its citations; one answered after the wait tells the agent to explore, its answer comes down the session's link, and its ack reaches the office", async () => {
  const o = await office();
  const { claudeDir, repo } = machine(o.url);
  // A short wait, so the second question runs past it quickly.
  fs.writeFileSync(path.join(claudeDir, "isoplan", "runner.json"), JSON.stringify({ expertWaitSeconds: 2 }));
  await runner(claudeDir);
  const h = hooksModule(claudeDir, repo);
  await until(() => o.links().length === 1);
  const [link] = o.links();
  expect(link!.messages.find((m) => m.type === "full")!.facts!.session.asksExperts).toBe(true);

  // The rights the hooks module registers ask_expert on (hooks/register.ts) reach it, tagged with their office.
  const experts = [{ name: "reporting", subject: "What leaves a machine.", repo: "app", host: "Adam" }];
  link!.send({ type: "expert-rights", v: 1, experts });
  await until(() => h.of("expert-rights").length > 0);
  expect(h.of("expert-rights")[0]).toMatchObject({ experts, server: o.url });

  // Answered in time: the answer, its citation block whole.
  const answered = await askExpertScript(claudeDir, repo, o.url, "toolu_x1", "What leaves a machine?");
  expect(answered.code).toBe(0);
  expect(answered.said).toContain("Expert reporting answered question x-0000000001. It describes main at 1a2b3c4");
  expect(answered.said).toContain("docs/adr/0004-what-leaves-a-machine.md (read at 1a2b3c4)");
  const side = o.connections.find((c) => c.messages.some((m) => m.type === "ask-expert"))!;
  expect(side.messages.find((m) => m.type === "hello")).toMatchObject({ session: "claude-code:s1" });
  expect(side.messages.find((m) => m.type === "ask-expert")).toMatchObject({ expert: "reporting", question: "What leaves a machine?", blocking: true, key: "toolu_x1" });
  await until(() => side.messages.some((m) => m.type === "asked-ack"));

  // Past the wait: explore meanwhile; the answer then comes down the session's own link, and its ack goes back.
  o.expert.now = false;
  const late = await askExpertScript(claudeDir, repo, o.url, "toolu_x2", "Where do usage events go?");
  expect(late.code).toBe(0);
  expect(late.said).toContain("the expert is still answering. Explore this yourself meanwhile");
  link!.send({ type: "asked", v: 1, question: "x-0000000002", text: "Where do usage events go?", state: "answered", answer: EXPERT_ANSWER, owner: "Adam", key: "toolu_x2", expert: "reporting", commit: COMMIT, branch: "main" });
  await until(() => h.of("asked").length > 0);
  expect(h.of("asked")[0]).toMatchObject({ question: "x-0000000002", expert: "reporting", key: "toolu_x2", commit: COMMIT, server: o.url });
  await ackScript(claudeDir, repo, o.url, "x-0000000002");
  await until(() => o.connections.some((c) => c.messages.some((m) => m.type === "asked-ack" && (m as { question?: string }).question === "x-0000000002")));
});

test("through the runner: the status line, a floor answer and a floor message reach the hooks module, and its ask_earlier_session question the earlier session; the runner started again has the session back on one link, and messages still reach it", async () => {
  const o = await office();
  const { claudeDir, repo } = machine(o.url);
  const first = await runner(claudeDir);
  const h = hooksModule(claudeDir, repo);

  // On the floor from the first look, with the status line saying so.
  await until(() => h.of("status").some((l) => l.state === "connected"));
  expect(h.of("status").find((l) => l.state === "connected")).toMatchObject({ server: o.url, state: "connected" });
  const [link] = o.links();
  const full = link!.messages.find((m) => m.type === "full")!;
  expect(full.facts!.session.takesMessages).toBe(true);
  const owner = link!.messages.find((m) => m.type === "hello")!.account!;

  // A floor answer to the question the hooks module waits on.
  const answerable = () => link!.messages.some((m) => [...(m.facts?.questions ?? []), ...(m.upsert?.questions ?? [])].some((q) => q.id === "toolu_q1" && q.answerable));
  await until(answerable);
  link!.send({ type: "request", v: 1, id: "a1", kind: "owner-answer", session: "claude-code:s1", question: "toolu_q1", answers: { "Which branch?": "main" } });
  await until(() => h.of("owner-answer").length > 0);
  const answer = h.of("owner-answer")[0]!;
  expect(answer).toMatchObject({ question: "toolu_q1", answers: { "Which branch?": "main" } });
  fs.writeFileSync(answer.file, JSON.stringify({ question: "toolu_q1", taken: true }));
  await until(() => link!.messages.some((m) => m.id === "a1"));
  expect(link!.messages.find((m) => m.id === "a1")).toEqual({ type: "reply", v: 1, id: "a1", kind: "owner-answer" });

  // A message from the floor, submitted by the hooks module.
  link!.send({ type: "request", v: 1, id: "m1", kind: "owner-message", session: "claude-code:s1", from: { id: owner.id, name: "Ada" }, text: "Now run the tests." });
  await until(() => h.of("owner-message").length > 0);
  const message = h.of("owner-message")[0]!;
  expect(message).toMatchObject({ session: "s1", text: "Now run the tests." });
  fs.writeFileSync(message.file, JSON.stringify({ taken: true }));
  await until(() => link!.messages.some((m) => m.id === "m1"));
  expect(link!.messages.find((m) => m.id === "m1")).toEqual({ type: "reply", v: 1, id: "m1", kind: "owner-message" });

  // ask_earlier_session, as the hooks module runs it, asks the earlier session through the runner.
  const said = await askScript(claudeDir, repo, o.url, "Why was the migration split?");
  expect(said).toContain("> Because the tests needed it.");
  const side = o.connections.find((c) => c.messages.some((m) => m.type === "ask-room"))!;
  expect(side.messages.find((m) => m.type === "hello")).toMatchObject({ session: "claude-code:s1" });
  // A question that looks like it holds a secret never leaves the machine.
  const asks = o.connections.filter((c) => c.messages.some((m) => m.type === "ask-room")).length;
  expect(await askScript(claudeDir, repo, o.url, "Is sk_live_" + "4eC39HqLyjWDarjtT1zdp7dc the key?")).toMatch(/^The question wasn't sent: it looks like it holds a secret/);
  expect(o.connections.filter((c) => c.messages.some((m) => m.type === "ask-room"))).toHaveLength(asks);

  // The runner stops and starts again mid-session.
  await first.stop();
  await until(() => h.of("runner").length > 0);
  expect(h.of("runner")).toEqual([{ type: "runner", state: "down" }]);
  await until(() => link!.closed);
  await runner(claudeDir);
  await until(() => o.links().length === 2);
  expect(h.of("runner")).toEqual([
    { type: "runner", state: "down" },
    { type: "runner", state: "up" },
  ]);
  // One link at a time: the first had closed before the second said hello.
  const again = o.links()[1]!;
  expect(again.openAtHello).toBe(0);
  again.send({ type: "request", v: 1, id: "m2", kind: "owner-message", session: "claude-code:s1", from: { id: owner.id, name: "Ada" }, text: "And push." });
  await until(() => h.of("owner-message").length === 2);
  fs.writeFileSync(h.of("owner-message")[1]!.file, JSON.stringify({ taken: true }));
  await until(() => again.messages.some((m) => m.id === "m2"));
  expect(again.messages.find((m) => m.id === "m2")).toMatchObject({ type: "reply", id: "m2" });
});

test("a hooks module whose session an earlier version's data layer keeps is told so through the runner, and nothing reaches the office for it; connecting again once that data layer has gone, it has its status line (#114)", async () => {
  const o = await office();
  const { claudeDir, repo } = machine(o.url);
  // An earlier version's data layer, live (this test's parent stands in for it), of the hooks
  // module's own copy in a window that started later: the runner doesn't take the session from it.
  const lock = path.join(claudeDir, "isoplan", "live", "s1.json");
  fs.mkdirSync(path.dirname(lock), { recursive: true });
  fs.writeFileSync(lock, JSON.stringify({ pid: process.ppid, dataLayer: path.join(modDir, "dist", "data-layer.js"), detached: false, since: Date.now() + 60000, parent: process.ppid, cwd: repo }));
  await runner(claudeDir);
  const h = hooksModule(claudeDir, repo);
  expect(await h.relayed).toBe("superseded");
  expect(h.out).toEqual([{ type: "superseded", reason: "earlier" }]);
  expect(o.links()).toEqual([]);
  expect(JSON.parse(fs.readFileSync(lock, "utf8"))).toMatchObject({ pid: process.ppid });

  // That data layer lets go (its window reloaded); the hooks module tries again, and the runner reports the session for it.
  fs.rmSync(lock);
  const again = hooksModule(claudeDir, repo);
  await until(() => again.of("status").some((l) => l.state === "connected"));
  expect(again.of("superseded")).toEqual([]);
  expect(o.links()).toHaveLength(1);
});
