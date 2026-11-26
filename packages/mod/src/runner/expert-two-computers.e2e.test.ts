// Two computers, one expert (isoplan-app#340, the critical path, plan test 42), end to end: two
// runner workers (dist/runner.js --worker, rebuilt with every change), started hidden as the
// supervisor starts them, each in its own Claude folder with real Claude Code against its own
// stand-in Messages API (ANTHROPIC_BASE_URL, a dummy key), both linked to one stand-in office that
// speaks to runners as the office server does. The project's remote is a bare repo reached through a
// stand-in ssh, so every git call is real. Adam's runner publishes his expert; Valentina's agent asks
// it through her runner's pipe (dist/ask-expert.js, as her session's hooks module runs it) and is told
// it isn't set up there, and offered its set-up once; her one click sets her instance up from the
// record, which grounds, proves and answers her, and answers again once Adam's runner has stopped,
// that time past her wait, as a late line her session's hooks module acks to her runner. What an
// office could pass on of hers to Adam's runner (her click, an older office's request with her
// question) runs nothing there: his Messages API gets no request after his own grounding. A second
// test runs the worker against an office from before 0.17.0.

import { execFile, execFileSync, spawn, spawnSync, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { PROTOCOL_VERSION } from "@isoplan/protocol";
import { afterEach, expect, test, vi } from "vitest";
import { WebSocketServer, type WebSocket } from "ws";
import { modDir, tempRoot } from "../data-layer/fixture.js";
import type { DataLayerLine } from "../lines.js";
import { relay } from "../pipe/client.js";
import { findClaude } from "./claude-binary.js";

vi.setConfig({ testTimeout: 300000 });

const closing: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const close of closing.splice(0).reverse()) await close();
  vi.unstubAllEnvs();
});

async function until(check: () => boolean, ms = 120000, what = "") {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error(`timed out${what ? `: ${what}` : ""}`);
    await new Promise((r) => setTimeout(r, 50));
  }
}

const PROJECT = "git.example.com/team/app";
const REMOTE = "git@git.example.com:team/app.git";
const RECORD = "6d1c2b3a-4e5f-4a6b-9c7d-8e9f0a1b2c3d";
const ADAM = { id: "claude:acc-adam", name: "Adam" };
const VALENTINA = { id: "claude:acc-valentina", name: "Valentina" };
const SUBJECT = "What may leave a machine.";
const ANSWER = "<answer>The relay holds it while it is in flight.</answer>\n<cited>\nsrc/relay.ts:1-2\n</cited>";
const QUESTION = "Where is a question held while it is in flight?";

// A stand-in ssh: git's request for the repo is served from the bare repo FAKE_REMOTE names.
const FAKE_SSH = `
import { spawn } from "node:child_process";
const service = /^git-(upload-pack|receive-pack)/.exec(process.argv.at(-1))?.[1] ?? "upload-pack";
spawn("git", [service, process.env.FAKE_REMOTE], { stdio: "inherit", windowsHide: true }).on("exit", (code) => process.exit(code ?? 1));
`;

// What the expert's Claude Code is answered, by what the last user turn of a request says: its
// grounding's two turns, its proof question, the judge, and a session's question, toolu_3 after a
// few seconds.
const REPLIES: [string, string, number?][] = [
  ["You check whether an expert's answer", "PASS\nIt says forty-two."],
  ["Question proof-", "<answer>Forty-two.</answer>"],
  ["Question toolu_3", ANSWER, 4000],
  ["Question toolu_", ANSWER],
  ["Reply with only the word: grounded", "grounded"],
  ["Reply with only the word: ready", "ready"],
];

/** A stand-in Messages API for one computer's Claude Code: every request's last user turn, and an answer to it, streamed. */
async function messagesApi() {
  const requests: string[] = [];
  const server = http.createServer((request, response) => {
    let body = "";
    request.setEncoding("utf8").on("data", (piece: string) => (body += piece));
    request.on("end", async () => {
      if (!request.url?.startsWith("/v1/messages")) return void response.writeHead(404).end();
      if (request.url.startsWith("/v1/messages/count_tokens")) return void response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ input_tokens: 1000 }));
      const b = JSON.parse(body) as { model: string; stream?: boolean; messages: { role: string; content: string | { type: string; text?: string }[] }[] };
      const last = [...b.messages].reverse().find((m) => m.role === "user");
      const said = typeof last?.content === "string" ? last.content : (last?.content ?? []).flatMap((c) => (c.type === "text" && c.text ? [c.text] : [])).join("\n");
      requests.push(said);
      const [, text, delayMs] = REPLIES.find(([words]) => said.includes(words)) ?? ["", "ok"];
      if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
      const usage = { input_tokens: 20000, output_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
      const message = { id: `msg_${requests.length}`, type: "message", role: "assistant", model: b.model, content: [], stop_reason: null, stop_sequence: null, usage };
      if (!b.stream) return void response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ ...message, content: [{ type: "text", text }], stop_reason: "end_turn" }));
      response.writeHead(200, { "content-type": "text/event-stream" });
      const event = (type: string, data: Record<string, unknown>) => response.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
      event("message_start", { message });
      event("content_block_start", { index: 0, content_block: { type: "text", text: "" } });
      event("content_block_delta", { index: 0, delta: { type: "text_delta", text } });
      event("content_block_stop", { index: 0 });
      event("message_delta", { delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 10 } });
      event("message_stop", {});
      response.end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  closing.push(() => new Promise((resolve) => (server.closeAllConnections(), server.close(resolve))));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, requests };
}

type Message = { type: string; [field: string]: unknown };

/**
 * A stand-in office that takes PROJECT, speaking to runners as the office server does: each runner
 * that keeps instances gets its own directory, `yours` on what its person owns; Adam's definition
 * becomes the record RECORD; a runner that wants it gets it. A session's link that says it asks
 * experts is told it may ask the record's expert. With `old`, an office from before 0.17.0: no
 * directory, only the dismissals of expert creation suggestions.
 */
async function office({ old = false } = {}) {
  const runners = new Map<string, { ws: WebSocket; received: Message[]; closed: boolean }>();
  const sessions: Message[][] = [];
  // The links of sessions that ask experts.
  const askers: WebSocket[] = [];
  let record: { definition: { project: { id: string; name: string } }; owner: { id: string; name: string } } | null = null;
  const send = (ws: WebSocket, m: Record<string, unknown>) => ws.send(JSON.stringify({ v: PROTOCOL_VERSION, ...m }));
  const directory = (person: string) => ({
    type: "expert-directory",
    experts: record ? [{ key: "adr", expertRecordId: RECORD, project: record.definition.project, owner: record.owner, revision: 1, ...(record.owner.id === person && { yours: true }) }] : [],
    asking: { openPerPersonPerExpert: 3, perPersonPerDay: 30, maxAgeHours: 72 },
  });
  const server = http.createServer((request, response) => {
    if (!request.url?.startsWith("/data-layer/repos")) return void response.writeHead(404).end();
    response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ version: "v1", repos: [PROJECT] }));
  });
  const wss = new WebSocketServer({ server });
  wss.on("connection", (ws) => {
    let person: string | null = null;
    let session: Message[] | null = null;
    ws.on("message", (data) => {
      const m = JSON.parse(String(data)) as Message;
      if (m.type === "runner") {
        person = (m.account as { id: string }).id;
        runners.set(person, { ws, received: [], closed: false });
        ws.on("close", () => void (runners.get(person!)!.ws === ws && (runners.get(person!)!.closed = true)));
        if (old) send(ws, { type: "expert-creation-suggestion-dismissals", dismissals: [] });
        else if (m.expertInstances) send(ws, directory(person));
      }
      if (person) {
        runners.get(person)!.received.push(m);
        if (m.type === "expert-definition" && person === ADAM.id) {
          record = { definition: m.definition as NonNullable<typeof record>["definition"], owner: ADAM };
          send(ws, { type: "expert-definition-result", key: "adr", outcome: "published", expertRecordId: RECORD, revision: 1 });
          for (const [each, r] of runners) if (!r.closed) send(r.ws, directory(each));
        }
        if (m.type === "expert-record-wanted" && record && m.expertRecordId === RECORD) send(ws, { type: "expert-record", expertRecordId: RECORD, revision: 1, owner: record.owner, ...(person === ADAM.id && { yours: true }), definition: record.definition });
        return;
      }
      if (m.type === "hello") sessions.push((session = []));
      session?.push(m);
      if (m.type === "full" && (m.facts as { session?: { asksExperts?: boolean } } | undefined)?.session?.asksExperts && record) {
        askers.push(ws);
        send(ws, { type: "expert-rights", experts: [{ name: "adr", subject: SUBJECT, repo: "app", host: record.owner.name }] });
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  closing.push(() => new Promise((resolve) => (wss.close(), server.closeAllConnections(), server.close(resolve))));
  const of = (person: string) => runners.get(person)?.received ?? [];
  return {
    url: `ws://127.0.0.1:${(server.address() as AddressInfo).port}/data-layer`,
    of,
    linked: (person: string) => !!runners.get(person) && !runners.get(person)!.closed,
    closed: (person: string) => runners.get(person)?.closed === true,
    /** The last instance listing the runner of `person` sent. */
    listing: (person: string) => (of(person).filter((m) => m.type === "expert-instance-states").at(-1)?.instances as { state: string }[] | undefined) ?? [],
    sendTo: (person: string, m: Record<string, unknown>) => send(runners.get(person)!.ws, m),
    /** What the sessions that ask experts may ask now. */
    rights: (experts: unknown[]) => askers.forEach((ws) => send(ws, { type: "expert-rights", experts })),
    everything: () => JSON.stringify([...[...runners.values()].flatMap((r) => r.received), ...sessions.flat()]),
  };
}

/** The bare repo of PROJECT, with what the expert grounds on, and the stand-in ssh that serves it. */
function project(root: string) {
  const remote = path.join(root, "remote.git");
  const seed = path.join(root, "seed");
  const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, windowsHide: true, stdio: "pipe" });
  fs.mkdirSync(remote);
  git(remote, "init", "-q", "--bare", "-b", "main");
  for (const [file, text] of [["CONTEXT.md", "**Relay**: what carries questions.\n"], ["src/relay.ts", "export const relay = 1;\n"], ["docs/adr/0004-what-leaves-a-machine.md", "# What leaves a machine\n"]] as const) {
    fs.mkdirSync(path.dirname(path.join(seed, file)), { recursive: true });
    fs.writeFileSync(path.join(seed, file), text);
  }
  git(seed, "init", "-q", "-b", "main");
  git(seed, "add", ".");
  git(seed, "-c", "user.name=Seed", "-c", "user.email=seed@example.com", "commit", "-qm", "seed");
  git(seed, "push", "-q", remote, "main");
  const ssh = path.join(root, "fake-ssh.mjs");
  fs.writeFileSync(ssh, FAKE_SSH);
  const forward = (p: string) => p.replace(/\\/g, "/");
  const env = { GIT_SSH_COMMAND: `"${forward(process.execPath)}" "${forward(ssh)}"`, GIT_SSH_VARIANT: "simple", FAKE_REMOTE: remote };
  return { env, clone: (into: string) => execFileSync("git", ["clone", "-q", REMOTE, into], { env: { ...process.env, ...env }, windowsHide: true, stdio: "pipe" }) };
}

/** One person's computer: a checkout of the project, a Claude folder paired with the office, and Claude Code recorded as its binary. */
function computer(root: string, person: { id: string; name: string }, server: string, p: ReturnType<typeof project>, claudeBinary: string) {
  const dir = path.join(root, person.name.toLowerCase());
  const home = path.join(dir, "home");
  const claudeDir = path.join(dir, "claude");
  const isoplanDir = path.join(claudeDir, "isoplan");
  const checkout = path.join(dir, "app");
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(isoplanDir, { recursive: true });
  p.clone(checkout);
  fs.writeFileSync(path.join(claudeDir, ".claude.json"), JSON.stringify({ oauthAccount: { accountUuid: person.id.slice("claude:".length), displayName: person.name } }));
  fs.writeFileSync(path.join(isoplanDir, "config.json"), JSON.stringify({ servers: [{ label: "Office", server }] }));
  fs.writeFileSync(path.join(isoplanDir, "runner.json"), JSON.stringify({ expertWaitSeconds: 60 }));
  fs.writeFileSync(path.join(isoplanDir, "pairing.json"), JSON.stringify({ accounts: {}, offices: { [server]: { [person.id]: { server, credential: "cred", token: "token", tokenExpires: Date.now() + 86400000 } } } }));
  fs.writeFileSync(path.join(isoplanDir, "claude-binary.json"), JSON.stringify({ path: claudeBinary }));
  return {
    claudeDir,
    home,
    checkout,
    file: (...parts: string[]) => path.join(isoplanDir, ...parts),
    read: (...parts: string[]) => (fs.existsSync(path.join(isoplanDir, ...parts)) ? fs.readFileSync(path.join(isoplanDir, ...parts), "utf8") : ""),
  };
}

/** The runner's worker, as its supervisor starts it: hidden, in the computer's own Claude folder, its Claude Code talking to `api`. */
function startWorker(c: ReturnType<typeof computer>, api: string, p: ReturnType<typeof project>) {
  // This session's own Claude Code and Anthropic variables never reach it.
  const inherited = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(CLAUDE|ANTHROPIC_)/i.test(key)));
  const env = { ...inherited, ...p.env, CLAUDE_CONFIG_DIR: c.claudeDir, USERPROFILE: c.home, HOME: c.home, CLAUDE_CODE_PLUGIN_CACHE_DIR: "", ANTHROPIC_BASE_URL: api, ANTHROPIC_API_KEY: "isoplan-test-key", CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1" };
  const child: ChildProcess = spawn(process.execPath, [path.join(modDir, "dist", "runner.js"), "--claude-dir", c.claudeDir, "--worker"], { cwd: c.claudeDir, env, stdio: ["pipe", "ignore", "pipe"], windowsHide: true });
  const exited = new Promise((resolve) => child.on("exit", resolve));
  // Its supervisor gone: stdin closes, and the worker ends its forks and exits.
  const stop = async () => {
    if (child.exitCode !== null) return;
    child.stdin!.end();
    const stopped = await Promise.race([exited.then(() => true), new Promise((r) => setTimeout(() => r(false), 15000))]);
    if (!stopped && child.pid) spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
  };
  closing.push(stop);
  return { stop };
}

/** Valentina's session s1 in her checkout, as Claude Code wrote its transcript, and its hooks module's end of her runner's pipe, in this process. */
function sessionOf(c: ReturnType<typeof computer>) {
  const now = new Date().toISOString();
  const transcript = path.join(c.claudeDir, "projects", "-app", "s1.jsonl");
  fs.mkdirSync(path.dirname(transcript), { recursive: true });
  fs.writeFileSync(transcript, [{ type: "user", cwd: c.checkout, sessionId: "s1", timestamp: now, message: { role: "user", content: "find where questions are held" } }].map((l) => JSON.stringify(l)).join("\n") + "\n");
  vi.stubEnv("CLAUDE_CONFIG_DIR", c.claudeDir);
  vi.stubEnv("CLAUDE_CODE_PLUGIN_CACHE_DIR", "");
  const out: DataLayerLine[] = [];
  let on = true;
  closing.push(async () => void (on = false));
  void relay({ claudeDir: c.claudeDir, hello: { session: "s1", cwd: c.checkout, since: Date.now(), messages: true, experts: true, root: modDir, version: "0.19.0" }, out: (line) => void out.push(line), goOn: () => on, startRunner: async () => "running", retryMs: async () => 200 });
  return { of: <T extends DataLayerLine["type"]>(type: T) => out.filter((l): l is Extract<DataLayerLine, { type: T }> => l.type === type) };
}

// ask_expert's script as the session's hooks module runs it, blocking: what it prints.
const askExpert = (c: ReturnType<typeof computer>, server: string, key: string) =>
  new Promise<string>((resolve) => {
    const argv = [path.join(modDir, "dist", "ask-expert.js"), "--session", "s1", "--cwd", c.checkout, "--expert", "adr", "--key", key, "--blocking", "--server", server];
    const child = execFile(process.execPath, argv, { env: { ...process.env, CLAUDE_CONFIG_DIR: c.claudeDir }, windowsHide: true }, (_err, stdout) => resolve(stdout.trim()));
    child.stdin!.end(QUESTION);
  });

// The hooks module's ack of a late end it showed, through dist/ask.js.
const ack = (c: ReturnType<typeof computer>, server: string, question: string) =>
  new Promise<void>((resolve) => {
    execFile(process.execPath, [path.join(modDir, "dist", "ask.js"), "--session", "s1", "--cwd", c.checkout, "--server", server, "--ack", question], { env: { ...process.env, CLAUDE_CONFIG_DIR: c.claudeDir }, windowsHide: true }, () => resolve());
  });

test("two computers, one expert: with one click Valentina's computer sets up its own instance from Adam's expert record, which answers her, with Adam's runner stopped too; nothing of hers runs on Adam's computer", async () => {
  const claudeBinary = await findClaude(process.env, process.platform, os.homedir());
  if (!claudeBinary) throw new Error("this test runs real Claude Code, and none was found on this computer");
  const root = tempRoot();
  const o = await office();
  const p = project(root);
  const adam = computer(root, ADAM, o.url, p, claudeBinary);
  const valentina = computer(root, VALENTINA, o.url, p, claudeBinary);
  const adamApi = await messagesApi();
  const valentinaApi = await messagesApi();
  const logs = () => `Adam's runner.log:\n${adam.read("logs", "runner.log")}\nValentina's runner.log:\n${valentina.read("logs", "runner.log")}\nValentina's expert health log:\n${valentina.read("logs", "expert-adr.log")}`;
  const waitFor = (check: () => boolean, what: string) => until(check, 180000, what).catch((err: Error) => Promise.reject(new Error(`${err.message}\n${logs()}`)));

  // Adam's own expert, published by his runner, grounded and proved on his computer.
  fs.mkdirSync(adam.file("experts"));
  fs.writeFileSync(adam.file("experts", "adr.json"), JSON.stringify({ version: 1, name: "adr", repo: adam.checkout, subject: SUBJECT, model: "sonnet", promoteAtTokens: 200000, proof: { question: "What is the answer?", answer: "Forty-two." } }));
  const adamsRunner = startWorker(adam, adamApi.url, p);
  await waitFor(() => o.listing(ADAM.id)[0]?.state === "ready", "Adam's expert ready");
  expect(o.of(ADAM.id).find((m) => m.type === "expert-definition")).toMatchObject({ definition: { key: "adr", project: { id: PROJECT }, subject: SUBJECT } });
  const adamsRequests = adamApi.requests.length;

  // Valentina's agent asks it: not set up on her computer, and its set-up offered once.
  startWorker(valentina, valentinaApi.url, p);
  await waitFor(() => o.linked(VALENTINA.id) && o.of(VALENTINA.id).some((m) => m.type === "expert-instance-states"), "Valentina's runner linked");
  const s1 = sessionOf(valentina);
  await waitFor(() => s1.of("expert-rights").length > 0, "her session's rights");
  expect(s1.of("expert-rights")[0]).toMatchObject({ experts: [{ name: "adr", host: "Adam" }], server: o.url });
  expect(await askExpert(valentina, o.url, "toolu_1")).toContain("isn't set up on this computer yet. Explore this yourself (EXPERT_NOT_SET_UP)");
  await waitFor(() => s1.of("expert-set-up-offer").length > 0, "the offer's line");
  expect(o.of(VALENTINA.id).filter((m) => m.type === "expert-set-up-offered")).toEqual([{ type: "expert-set-up-offered", v: PROTOCOL_VERSION, key: "adr", expertRecordId: RECORD }]);

  // Her one click on the floor, to her own runner; an office could pass it, and an older office her
  // question itself, to Adam's runner too.
  o.sendTo(VALENTINA.id, { type: "set-up-expert-instance", request: "r-1", key: "adr", expertRecordId: RECORD, by: VALENTINA });
  o.sendTo(ADAM.id, { type: "set-up-expert-instance", request: "r-2", key: "adr", expertRecordId: RECORD, by: VALENTINA });
  o.sendTo(ADAM.id, { type: "request", id: "req-1", kind: "answer-expert", expert: "adr", questionId: "toolu_2", question: QUESTION, blocking: true, from: VALENTINA, asker: "claude-code:s1" });
  await waitFor(() => o.listing(VALENTINA.id)[0]?.state === "ready", "Valentina's instance ready");
  expect(JSON.parse(valentina.read("expert-instances", "adr.json"))).toMatchObject({ key: "adr", server: o.url, repo: valentina.checkout });
  expect(await askExpert(valentina, o.url, "toolu_2")).toContain("Expert adr answered question toolu_2.");

  // Adam's runner stops: her instance still answers her, past her wait this time, so its answer
  // comes to her session as a late line, which its hooks module acks to her runner.
  await adamsRunner.stop();
  await waitFor(() => o.closed(ADAM.id), "Adam's runner gone");
  fs.writeFileSync(valentina.file("runner.json"), JSON.stringify({ expertWaitSeconds: 1 }));
  expect(await askExpert(valentina, o.url, "toolu_3")).toContain("Expert adr, question toolu_3: the expert is still answering. Explore this yourself meanwhile");
  await waitFor(() => s1.of("asked").some((l) => l.question === "toolu_3"), "the late answer");
  expect(s1.of("asked").find((l) => l.question === "toolu_3")).toMatchObject({ state: "answered", expert: "adr", text: QUESTION, server: o.url });
  expect(s1.of("asked").find((l) => l.question === "toolu_3")!.answer).toContain("The relay holds it while it is in flight.");
  await ack(valentina, o.url, "toolu_3");
  const kept = () => (JSON.parse(valentina.read("runner", "expert-questions-asked-here.json")) as { questions: { id: string; shown: boolean; text: string | null }[] }).questions.find((q) => q.id === "toolu_3");
  await waitFor(() => kept()?.shown === true, "the ack");
  expect(kept()!.text).toBe(null);

  // What her session may ask is the office's word for it, not its directory: told it may ask none, it can't ask this one.
  o.rights([]);
  await waitFor(() => s1.of("expert-rights").at(-1)?.experts.length === 0, "her session's new rights");
  expect(await askExpert(valentina, o.url, "toolu_4")).toBe("Expert adr, question toolu_4: There are no experts in this session's office now. (EXPERT_UNKNOWN)");

  // Nothing ran on Adam's computer after his own grounding and proof: no fork, no grounding, no question of hers.
  expect(adamApi.requests.slice(adamsRequests)).toEqual([]);
  expect(adamApi.requests.some((r) => r.includes(QUESTION))).toBe(false);
  expect(adam.read("logs", "expert-adr.log")).not.toMatch(/question id=toolu_/);
  expect(adam.read("logs", "runner.log")).toContain("asked to set up expert adr for Valentina, not this runner's own account, so nothing starts");
  // Her questions ran on her computer: its Messages API was asked both, and her health log has them.
  expect(valentinaApi.requests.filter((r) => r.includes("Question toolu_")).map((r) => /Question (toolu_\d)/.exec(r)![1])).toEqual(["toolu_2", "toolu_3"]);
  expect(valentina.read("logs", "expert-adr.log")).toMatch(/question id=toolu_2 /);
  expect(valentina.read("logs", "expert-adr.log")).toMatch(/question id=toolu_3 /);
  // The office was told of her questions only in records with no words.
  expect(o.of(VALENTINA.id).filter((m) => m.type === "expert-question").map((m) => [m.id, m.state])).toEqual(expect.arrayContaining([["toolu_2", "answered"], ["toolu_3", "answered"]]));
  expect(o.everything()).not.toContain(QUESTION);
  expect(o.everything()).not.toContain("The relay holds it while it is in flight");
});

test("an office from before each computer kept its own instance: its dismissals come with no directory before them, and the runner's worker tells an agent asking an expert there EXPERT_PLUGIN_OLD", async () => {
  const claudeBinary = await findClaude(process.env, process.platform, os.homedir());
  if (!claudeBinary) throw new Error("this test runs real Claude Code, and none was found on this computer");
  const root = tempRoot();
  const o = await office({ old: true });
  const p = project(root);
  const valentina = computer(root, VALENTINA, o.url, p, claudeBinary);
  const api = await messagesApi();
  startWorker(valentina, api.url, p);
  await until(() => valentina.read("logs", "runner.log").includes(`${o.url} is from before each computer kept its own instance of an expert`));
  const s1 = sessionOf(valentina);
  await until(() => s1.of("status").some((l) => l.state === "connected"));
  expect(await askExpert(valentina, o.url, "toolu_1")).toBe("Expert adr, question toolu_1: the office server is from before each computer kept its own instance of an expert; updating the office server fixes it (EXPERT_PLUGIN_OLD)");
  expect(o.of(VALENTINA.id).filter((m) => m.type.startsWith("expert-"))).toEqual([]);
});
