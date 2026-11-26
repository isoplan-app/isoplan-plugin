// A session with the plugin, end to end through the runner (ADR 0007 step 2), against a stand-in
// office server, in a throwaway config folder: the runner's pipe (server.ts), its reporting
// (src/runner/reporting.ts, report-session.ts) put together as the runner's worker puts them, and a
// hooks module's end of the pipe (client.ts) in this process, its lines read as the hooks module
// reads them. The status line, an answer and a message from the floor, and ask_earlier_session (dist/ask.js,
// rebuilt with every change) all go through the runner; a runner started again mid-session has the
// session back on the floor, on one link at a time. So does ask_expert (dist/ask-expert.js), which
// this computer's own instance of the expert answers (isoplan-app#340), with the fake `claude` and git
// of runner/expert-fixture.ts: its answer in time or, past the wait, as a late line to the session's
// hooks module, acked through dist/ask.js; the office is told only records with no words.

import { execFile, execFileSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import { WebSocketServer } from "ws";
import { loadConfig, loadSettings } from "../data-layer/config.js";
import { createLink } from "../data-layer/link.js";
import { modDir, tempRoot } from "../data-layer/fixture.js";
import { nodeIo } from "../data-layer/io.js";
import { reportSession, sessionLog } from "../data-layer/report-session.js";
import type { DataLayerLine } from "../lines.js";
import { watchSessions } from "../runner/reporting.js";
import { loadPatterns } from "../runner/scan.js";
import { BASE, C1, FAKE_CLAUDE, fakeGit, type Rule } from "../runner/expert-fixture.js";
import { createExpertInstanceSetUpOffers } from "../runner/expert-instance-set-up-offer.js";
import { createExpertInstances } from "../runner/expert-instance.js";
import { createExpertQuestionsAskedHere, type ExpertQuestionsAskedHereSettings } from "../runner/expert-questions-asked-here.js";
import { createExpertRecordLink } from "../runner/expert-record-link.js";
import { createExpertRecordsPerOffice, expertRecordsPerOfficePath } from "../runner/expert-records-per-office.js";
import { createExpertRightsOnThisComputer } from "../runner/expert-rights-on-this-computer.js";
import type { ExpertSettings } from "../runner/expert.js";
import { createExperts } from "../runner/experts.js";
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

// The expert record the office lists, and the expert's answers, cited at the fake git's commit.
const RECORD = "4f0c3a52-8a2b-4d6e-9f10-2b3c4d5e6f70";
const TEAM_APP = { id: "github.com/team/app", name: "app" };
const EXPERT_ANSWER = "<answer>Only ids and counts leave it.</answer>\n<cited>\nsrc/relay.ts:1-2\n</cited>";

/**
 * A stand-in office that takes github.com/team/app; it answers a question for the room at once, and
 * lists the expert "reporting", Adam's, to a runner that keeps instances of experts.
 */
async function office() {
  const connections: { messages: Sent[]; closed: boolean; openAtHello: number; send(message: unknown): void }[] = [];
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
      if (message.type === "runner" && (message as { expertInstances?: true }).expertInstances)
        c.send({ type: "expert-directory", v: 1, experts: [{ key: "reporting", expertRecordId: RECORD, project: TEAM_APP, owner: { id: "claude:adam", name: "Adam" }, revision: 1 }], asking: { openPerPersonPerExpert: 3, perPersonPerDay: 30, maxAgeHours: 72 } });
    });
    ws.on("close", () => (c.closed = true));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  closing.push(() => new Promise((resolve) => (wss.close(), server.closeAllConnections(), server.close(resolve))));
  // The session's own links: those that sent its facts.
  const links = () => connections.filter((c) => c.messages.some((m) => m.type === "full"));
  return { connections, links, url: `ws://127.0.0.1:${(server.address() as AddressInfo).port}/data-layer` };
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

/**
 * This computer's instance of the expert "reporting", Adam's, set up from the office's record in an
 * earlier run, in `repo`: its instance file and what it keeps of the record.
 */
function installReportingInstance(claudeDir: string, server: string, repo: string) {
  const definition = { key: "reporting", project: TEAM_APP, subject: "What leaves a machine.", model: "sonnet", promoteAtTokens: 200000, areas: [], proof: { question: "What is the answer?", answer: "Forty-two." } };
  const dir = path.join(claudeDir, "isoplan", "experts", "reporting");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "expert-records.json"), JSON.stringify({ version: 1, servers: { [server]: { record: { expertRecordId: RECORD, revision: 1, owner: { id: "claude:adam", name: "Adam" }, yours: false, definition } } } }));
  fs.mkdirSync(path.join(claudeDir, "isoplan", "expert-instances"), { recursive: true });
  fs.writeFileSync(path.join(claudeDir, "isoplan", "expert-instances", "reporting.json"), JSON.stringify({ version: 1, key: "reporting", server, repo }));
}

/**
 * This computer's experts, as the runner's worker keeps them (runner/main.ts): their instances, the
 * runner's own link to the office with its record link, what each session may ask, and the asking
 * module, with the fake `claude` answering by `rules`.
 */
async function expertsHere(claudeDir: string, server: string, repo: string, rules: Rule[], hooked: (session: string) => Hooked | null) {
  const io = nodeIo();
  const isoplanDir = path.join(claudeDir, "isoplan");
  const root = path.dirname(claudeDir);
  const [bin, rulesFile, claudeLog] = [path.join(root, "claude.js"), path.join(root, "rules.json"), path.join(root, "claude.jsonl")];
  fs.writeFileSync(bin, FAKE_CLAUDE);
  fs.writeFileSync(rulesFile, JSON.stringify(rules));
  fs.writeFileSync(claudeLog, "");
  const settings = async () => ({ ...(await loadSettings<ExpertSettings & ExpertQuestionsAskedHereSettings>(io, path.join(modDir, "runner.json"), path.join(isoplanDir, "runner.json"))), expertJudgeModel: "haiku" });
  const scan = async () => null;
  const account = { id: "claude:sam", name: "Sam" };
  const experts = createExperts({ expertsDir: path.join(isoplanDir, "experts"), instancesDir: path.join(isoplanDir, "expert-instances"), logsDir: path.join(isoplanDir, "logs"), projectsDir: path.join(root, "expert-projects"), appDir: modDir, binary: async () => bin, settings, scan, git: fakeGit(repo).git, gitTimeoutMs: async () => 5000, env: { ...process.env, FAKE_RULES: rulesFile, FAKE_LOG: claudeLog }, log: () => {} });
  const instances = createExpertInstances({ experts, isoplanDir, scan, log: () => {}, checkoutOf: async () => repo, clone: async () => ({ problem: "no clone in this test" }) });
  const store = createExpertRecordsPerOffice({ file: expertRecordsPerOfficePath(isoplanDir), keptHours: async () => 144, log: () => {} });
  await store.load();
  const offers = createExpertInstanceSetUpOffers({ file: path.join(isoplanDir, "runner", "expert-instance-set-up-offers.json"), setUpWithoutAsking: async () => false, setUp: () => {}, send: () => false, hooked, hasInstance: () => false, log: () => {} });
  let send = (_m: Parameters<ReturnType<typeof createLink>["sendLive"]>[0]) => false;
  const record = createExpertRecordLink({ server, account, experts, instances, store, offerEnded: () => {}, approved: { refresh: async () => {}, repos: () => new Set([TEAM_APP.id]) }, home: async (folder) => (folder === repo ? TEAM_APP : null), scan, log: () => {}, send: (m) => send(m), checkMs: 3600000 });
  const link = createLink({ url: server, hello: { type: "runner", v: 1, account, machine: { name: "box" }, canCreateExpertsFromSuggestions: true, expertInstances: true }, emit: () => {}, onExpertRecordMessages: (m) => record.take(m), onOpen: () => record.onOpen(), onClose: () => record.onClose() });
  send = (m) => link.sendLive(m);
  const rights = createExpertRightsOnThisComputer({ instances, store, person: () => account.name, projectOf: async (_s, folder) => (folder === repo ? TEAM_APP : null), send: (session, line) => hooked(session)?.send(line), log: () => {} });
  const asking = createExpertQuestionsAskedHere({ file: path.join(isoplanDir, "runner", "expert-questions-asked-here.json"), claudeDir, config: () => loadConfig(io, path.join(modDir, "config.json"), path.join(isoplanDir, "config.json")), settings, links: new Map([[server, record]]), instances, offers, rights: (s, office) => rights.rights(s, office), hooked, log: () => {} });
  await experts.start();
  await instances.start();
  await asking.start();
  closing.push(async () => (link.close(), record.stop(), asking.close(), experts.close()));
  const claude = () => fs.readFileSync(claudeLog, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l) as { kind: string; turn?: number; text?: string });
  return { experts, rights, asking, claude };
}

/** The runner's worker as it reports sessions and serves its pipe, with `experts` its experts; `stop` ends it as the worker ends. */
async function runner(claudeDir: string, experts?: (hooked: (session: string) => Hooked | null) => Promise<Awaited<ReturnType<typeof expertsHere>>>) {
  const io = nodeIo();
  const config = () => loadConfig(io, path.join(modDir, "config.json"), path.join(claudeDir, "isoplan", "config.json"));
  let pipe: Awaited<ReturnType<typeof createPipeServer>> | null = null;
  const here = experts ? await experts((id) => pipe?.hooked(id) ?? null) : null;
  const reporting = watchSessions<Hooked>({
    claudeDir,
    io,
    config,
    isOff: async () => false,
    log: () => {},
    patterns: () => loadPatterns(path.join(modDir, "secret-patterns.json"), path.join(claudeDir, "isoplan", "secret-patterns.json"), () => {}),
    hooked: (id) => pipe?.hooked(id) ?? null,
    held: (_id, hooks) => hooks.send({ type: "superseded", reason: "earlier" }),
    report: async ({ sessionId, cwd, closed, notWanted, hooks }) => {
      const said = sessionLog(claudeDir, sessionId);
      // What the session may ask is this computer's to rewrite first, as the worker's report does it.
      if (hooks) return reportSession({ sessionId, cwd, by: "hooks", appDir: modDir, root: hooks.root, takesMessages: hooks.messages, asksExperts: hooks.experts, emit: (line) => (said.emit(line), line.type === "expert-rights" && here ? here.rights.tap(sessionId, cwd, line) : hooks.send(line)), closed: Promise.race([closed, hooks.closed]) });
      return reportSession({ sessionId, cwd, by: "runner", appDir: modDir, emit: said.emit, closed, notWanted, isOff: async () => false });
    },
  });
  // The asks the runner makes for the session are the worker's: the room's through the office
  // (askFromMachine, with its secret scan), the experts' here, an ack of an expert's end too.
  const { askFromMachine } = await import("../ask/machine.js");
  const { loadPatterns, scan } = await import("../runner/scan.js");
  const scanText = async (text: string) => scan(text, await loadPatterns(path.join(modDir, "secret-patterns.json"), path.join(claudeDir, "isoplan", "secret-patterns.json"), () => {}));
  pipe = await createPipeServer({
    claudeDir,
    log: () => {},
    onChange: (s) => (reporting.rehook(s), here?.asking.rehooked(s)),
    ask: (request) => (request.ack && here?.asking.holds(request.ack) ? here.asking.ack(request.session, request.ack) : askFromMachine({ ...request, appDir: modDir, scan: scanText })),
    ...(here && { askExpert: (request) => here.asking.ask(request) }),
  });
  const stop = async () => {
    await reporting.stop();
    await pipe!.close();
  };
  closing.push(stop);
  return { pipe, reporting, stop, here };
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

test("ask_expert through the runner, answered by this computer's own instance: the session's fact asks for rights, which reach its hooks module; a blocking question answered in time prints the answer and its citations; one answered after the wait tells the agent to explore, its answer comes to the hooks module as a late line, acked back to the runner; the office is told nothing of either question but records with no words", async () => {
  const o = await office();
  const { claudeDir, repo } = machine(o.url);
  installReportingInstance(claudeDir, o.url, repo);
  // A long wait for the first question, so it is answered in time however slow the instance's grounding.
  fs.writeFileSync(path.join(claudeDir, "isoplan", "runner.json"), JSON.stringify({ expertWaitSeconds: 30 }));
  const rules: Rule[] = [{ kind: "fork", text: "Question toolu_x1", reply: EXPERT_ANSWER }, { kind: "fork", text: "Question toolu_x2", reply: EXPERT_ANSWER, delayMs: 4000 }, ...BASE];
  const { here } = await runner(claudeDir, (hooked) => expertsHere(claudeDir, o.url, repo, rules, hooked));
  await until(() => here!.experts.running("reporting")?.expert.hosted().state === "ready", 30000);
  const h = hooksModule(claudeDir, repo);
  await until(() => o.links().length === 1);
  const [link] = o.links();
  expect(link!.messages.find((m) => m.type === "full")!.facts!.session.asksExperts).toBe(true);

  // The rights the hooks module registers ask_expert on (hooks/register.ts) reach it, tagged with their office.
  const experts = [{ name: "reporting", subject: "What leaves a machine.", repo: "app", host: "Adam" }];
  link!.send({ type: "expert-rights", v: 1, experts });
  await until(() => h.of("expert-rights").length > 0);
  expect(h.of("expert-rights")[0]).toMatchObject({ experts, server: o.url });

  // Answered in time, by this computer's instance: the answer, its citation block whole.
  const answered = await askExpertScript(claudeDir, repo, o.url, "toolu_x1", "What leaves a machine?");
  expect(answered.code).toBe(0);
  expect(answered.said).toContain(`Expert reporting answered question toolu_x1. It describes main at ${C1.slice(0, 7)}`);
  expect(answered.said).toContain(`src/relay.ts:1-2 (read at ${C1.slice(0, 7)})`);
  expect(here!.claude().some((l) => l.kind === "fork" && l.text?.includes("What leaves a machine?"))).toBe(true);

  // Past the wait: explore meanwhile; the answer then comes to the hooks module as a late line, and its ack goes back to the runner.
  fs.writeFileSync(path.join(claudeDir, "isoplan", "runner.json"), JSON.stringify({ expertWaitSeconds: 2 }));
  const late = await askExpertScript(claudeDir, repo, o.url, "toolu_x2", "Where do usage events go?");
  expect(late.code).toBe(0);
  expect(late.said).toContain("the expert is still answering. Explore this yourself meanwhile");
  await until(() => h.of("asked").length > 0, 20000);
  expect(h.of("asked")[0]).toMatchObject({ question: "toolu_x2", expert: "reporting", key: "toolu_x2", text: "Where do usage events go?", state: "answered", commit: C1, server: o.url });
  await ackScript(claudeDir, repo, o.url, "toolu_x2");
  const kept = () => JSON.parse(fs.readFileSync(path.join(claudeDir, "isoplan", "runner", "expert-questions-asked-here.json"), "utf8")) as { questions: { id: string; shown: boolean; text: string | null }[] };
  await until(() => kept().questions.find((q) => q.id === "toolu_x2")?.shown === true);
  expect(kept().questions.find((q) => q.id === "toolu_x2")!.text).toBe(null);

  // The office: no question, only records with no words, from the runner's own link.
  const all = o.connections.flatMap((c) => c.messages);
  expect(all.some((m) => m.type === "ask-expert" || m.type === "asked-ack")).toBe(false);
  expect(JSON.stringify(all)).not.toContain("What leaves a machine?");
  expect(JSON.stringify(all)).not.toContain("Where do usage events go?");
  expect(JSON.stringify(all)).not.toContain("Only ids and counts leave it");
  const records = all.filter((m) => m.type === "expert-question") as unknown as { id: string; state: string; session: string }[];
  expect(records.map((m) => [m.id, m.state])).toEqual(expect.arrayContaining([["toolu_x1", "answered"], ["toolu_x2", "answered"]]));
  expect(records.every((m) => m.session === "claude-code:s1")).toBe(true);
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
