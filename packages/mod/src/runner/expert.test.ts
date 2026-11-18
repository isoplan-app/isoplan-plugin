import fs from "node:fs";
import path from "node:path";
import { PROTOCOL_VERSION, RefusalMessageSchema, type RefusalMessage, type ReplyMessage } from "@isoplan/protocol";
import { expect, test } from "vitest";
import { modDir, tempRoot } from "../data-layer/fixture.js";
import type { GitResult, RunGit } from "../handoff/git.js";
import { parseExpertFile, type ExpertFile } from "./expert-file.js";
import { createHealthLog } from "./expert-health.js";
import { fingerprint, type SavedExpert, type SavedGeneration } from "./expert-state.js";
import { createExpert, NO_SENIOR, type AnswerExpertRequest, type ExpertSettings } from "./expert.js";

const C0 = "0".repeat(40);
const C1 = "1".repeat(40);
const C2 = "2".repeat(40);
const T1 = "11111111-1111-4111-8111-111111111111";
const T2 = "22222222-2222-4222-8222-222222222222";
const settings = { ...JSON.parse(fs.readFileSync(path.join(modDir, "runner.json"), "utf8")), expertJudgeModel: "haiku" } as ExpertSettings;

// A stand-in for `claude`: it logs its argv and each turn, and answers each turn by the first rule
// in FAKE_RULES (read again every turn) whose kind, text and trunk match: a reply with the context
// its call had, Read calls of files in its folder, other tool calls, a compaction, a delay, a wait
// for a file to be there, or none.
const FAKE = `
const fs = require("node:fs");
const path = require("node:path");
const argv = process.argv.slice(2);
const kind = argv.includes("--session-id") ? "trunk" : argv.includes("--fork-session") ? "fork" : argv.includes("--resume") ? "append" : "judge";
const trunk = kind === "judge" ? null : argv[argv.indexOf(kind === "trunk" ? "--session-id" : "--resume") + 1];
const log = (x) => fs.appendFileSync(process.env.FAKE_LOG, JSON.stringify(x) + "\\n");
const out = (x) => process.stdout.write(JSON.stringify(x) + "\\n");
log({ kind, trunk, argv, background: process.env.CLAUDE_CODE_DISABLE_BACKGROUND_TASKS ? "off" : "on" });
let turn = 0, buf = "";
function respond(text) {
  const rules = JSON.parse(fs.readFileSync(process.env.FAKE_RULES, "utf8"));
  const rule = rules.find((r) => (!r.kind || r.kind === kind) && (!r.text || text.includes(r.text)) && (!r.trunk || r.trunk === trunk)) || { reply: "no rule" };
  if (turn === 1) out({ type: "system", subtype: "init", model: rule.model || "claude-sonnet-5-5", tools: ["Read", "Grep", "Glob", "Agent"] });
  if (rule.hang) return;
  if (rule.until && !fs.existsSync(rule.until)) {
    const wait = setInterval(() => fs.existsSync(rule.until) && (clearInterval(wait), reply(rule)), 20);
    return;
  }
  reply(rule);
}
function reply(rule) {
  setTimeout(() => {
    const ctx = rule.context || 1000;
    const usage = { input_tokens: 0, cache_read_input_tokens: ctx - 10, cache_creation_input_tokens: 0, output_tokens: 10 };
    const content = [
      ...(rule.reads || []).map((f, i) => ({ type: "tool_use", id: "r" + i, name: "Read", input: { file_path: path.join(process.cwd(), f) } })),
      ...(rule.tools || []).map((n, i) => ({ type: "tool_use", id: "t" + i, name: n, input: {} })),
    ];
    out({ type: "assistant", parent_tool_use_id: null, message: { id: "m" + turn, usage, content } });
    if (rule.compact) out({ type: "system", subtype: "compact_boundary" });
    out({ type: "result", subtype: "success", num_turns: 1, result: rule.reply || "", usage });
  }, rule.delayMs || 0);
}
process.stdin.setEncoding("utf8").on("data", (d) => {
  buf += d;
  let i;
  while ((i = buf.indexOf("\\n")) >= 0) {
    const text = JSON.parse(buf.slice(0, i)).message.content[0].text;
    buf = buf.slice(i + 1);
    turn++;
    log({ kind, trunk, turn, text });
    respond(text);
  }
}).on("end", () => process.exit(0));
setInterval(() => {}, 1000);
`;

interface Rule {
  kind?: "trunk" | "fork" | "append" | "judge";
  text?: string;
  trunk?: string;
  model?: string;
  reply?: string;
  context?: number;
  reads?: string[];
  tools?: string[];
  compact?: boolean;
  hang?: boolean;
  delayMs?: number;
  /** A file the reply waits for. */
  until?: string;
}

const ANSWER = "<answer>The relay holds it while it is in flight.</answer>\n<cited>\nsrc/relay.ts:1-2\n</cited>";
// The usual expert: it grounds reading two files, passes its proof, and answers.
const BASE: Rule[] = [
  { kind: "trunk", text: "Reply with only the word: ready", reply: "ready", context: 20000 },
  { kind: "trunk", text: "Now read what your subject rests on", reply: "grounded", context: 50000, reads: ["CONTEXT.md", "src/relay.ts"] },
  { kind: "fork", text: "Question proof-", reply: "<answer>Forty-two.</answer>" },
  { kind: "judge", reply: "PASS: it says forty-two." },
  { kind: "append", reply: "noted", context: 60000 },
  { kind: "fork", text: "Question x-", reply: ANSWER },
];

/** A stand-in for git over one repo: a HEAD and an origin tip, the files changed, a dirty flag, and origin out of reach. */
function fakeGit(readDir: string) {
  const calls: { cwd: string; args: string[] }[] = [];
  const repo = { head: C1, origin: C1, changed: [] as string[], dirty: false, offline: false };
  const ok = (stdout = ""): GitResult => ({ code: 0, stdout, stderr: "", timedOut: false });
  const git: RunGit = async (argv, { cwd }) => {
    const args = argv.slice(2); // after the no-hooks prefix
    calls.push({ cwd, args });
    const at = (word: string) => args.includes(word);
    if (args[0] === "remote" && args[1] === "get-url") return ok("https://github.com/acme/app.git\n");
    if (args[0] === "ls-remote") return repo.offline ? { ...ok(), code: 128, stderr: "could not read from remote" } : ok("ref: refs/heads/main\tHEAD\n");
    if (args[0] === "clone") return (makeRead(args.at(-1)!), ok());
    if (args[0] === "rev-parse" && args[1] === "--verify" && args[2]?.startsWith("refs/remotes/")) return ok(repo.origin);
    if (at("rev-parse") && args.at(-1) === "HEAD") return ok(repo.head + "\n");
    if (at("checkout")) return ((repo.head = args.at(-1)!.startsWith("refs/remotes/") ? repo.origin : args.at(-1)!), ok());
    if (at("status")) return ok(repo.dirty ? " M src/relay.ts\n" : "");
    if (at("reset")) return ((repo.dirty = false), ok());
    if (at("diff")) return ok(args.at(-1) === `${repo.head}..HEAD` ? "" : repo.changed.join("\n"));
    return ok();
  };
  return { git, calls, repo };
}

function makeRead(readDir: string) {
  const write = (file: string, text: string) => (fs.mkdirSync(path.dirname(path.join(readDir, file)), { recursive: true }), fs.writeFileSync(path.join(readDir, file), text));
  write("CONTEXT.md", "**Relay**: what carries questions.");
  write("src/relay.ts", "export const relay = 1;\n");
  write("src/other.ts", "export const other = 1;\n");
  write("docs/adr/0004-x.md", "# What leaves a machine\n");
  fs.mkdirSync(path.join(readDir, ".git"), { recursive: true });
}

const expertFile = (o: Record<string, unknown> = {}): ExpertFile => {
  const parsed = parseExpertFile(JSON.stringify({ version: 1, name: "adr", repo: path.resolve("/work/app"), subject: "What may leave a machine.", model: "sonnet", promoteAtTokens: 200000, proof: { question: "What is the answer?", answer: "Forty-two." }, ...o }), "adr.json");
  if (!parsed.ok) throw new Error(parsed.reason);
  return parsed.expert;
};

const gen = (n: number, trunk: string, state: SavedGeneration["state"], o: Partial<SavedGeneration> = {}): SavedGeneration => ({ n, trunk, model: "claude-sonnet-5-5", commit: C1, groundedAt: 0, meter: 50000, notes: 0, state, proof: { passed: true, at: 0 }, ...o });

interface SetUp {
  file?: ExpertFile;
  rules?: Rule[];
  minuteMs?: number;
  /** A state from before a restart: written with its trunks' transcripts (empty, or these entries) and these indexes, for `repo` (the file's when not given). */
  restored?: { generations: SavedGeneration[]; indexes?: Record<number, Record<string, string>>; repo?: string; transcripts?: Record<string, object[]> };
  /** Origin is out of reach as it starts. */
  offline?: boolean;
}

async function setUp(o: SetUp = {}) {
  const root = tempRoot();
  const dir = path.join(root, "experts", "adr");
  const readDir = path.join(dir, "read");
  const projectsDir = path.join(root, "projects");
  const bin = path.join(root, "claude.js");
  const rulesFile = path.join(root, "rules.json");
  const claudeLog = path.join(root, "claude.jsonl");
  const healthFile = path.join(root, "logs", "expert-adr.log");
  fs.writeFileSync(bin, FAKE);
  fs.writeFileSync(claudeLog, "");
  const rules = (r: Rule[]) => fs.writeFileSync(rulesFile, JSON.stringify(r));
  const transcript = (trunk: string) => path.join(projectsDir, "c--work-app", `${trunk}.jsonl`);
  rules(o.rules ?? BASE);
  let file = o.file ?? expertFile();
  if (o.restored) {
    makeRead(readDir);
    const state: SavedExpert = { version: 1, fingerprint: fingerprint(file), repo: o.restored.repo ?? file.repo, branch: "main", generations: o.restored.generations };
    fs.writeFileSync(path.join(dir, "state.json"), JSON.stringify(state));
    for (const [n, files] of Object.entries(o.restored.indexes ?? {})) fs.writeFileSync(path.join(dir, `index-${n}.json`), JSON.stringify({ version: 1, files }));
    fs.mkdirSync(path.join(projectsDir, "c--work-app"), { recursive: true });
    for (const g of o.restored.generations) fs.writeFileSync(transcript(g.trunk), (o.restored.transcripts?.[g.trunk] ?? []).map((e) => JSON.stringify(e) + "\n").join(""));
  }
  const g = fakeGit(readDir);
  g.repo.offline = o.offline ?? false;
  const sent: (ReplyMessage | RefusalMessage)[] = [];
  const logs: string[] = [];
  const trunks: string[] = [];
  const expert = createExpert({
    file,
    dir,
    health: createHealthLog(healthFile),
    projectsDir,
    appDir: modDir,
    binary: async () => bin,
    settings: async () => settings,
    scan: async (text) => (text.includes("SECRET") ? "test secret" : null),
    git: g.git,
    gitTimeoutMs: async () => 5000,
    env: { ...process.env, FAKE_RULES: rulesFile, FAKE_LOG: claudeLog },
    log: (t) => void logs.push(t),
    onChange: () => {},
    onTrunk: (t) => void trunks.push(t),
    minuteMs: o.minuteMs ?? 4000,
  });
  const claude = () => fs.readFileSync(claudeLog, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l) as { kind: string; trunk: string | null; argv?: string[]; background?: string; turn?: number; text?: string });
  const health = () => (fs.existsSync(healthFile) ? fs.readFileSync(healthFile, "utf8") : "");
  const ask = (qid: string, o: Partial<AnswerExpertRequest> = {}) =>
    expert.answer({ type: "request", v: PROTOCOL_VERSION, id: `expert-${qid}-1`, kind: "answer-expert", expert: "adr", questionId: qid, question: `Where is it held? (${qid})`, blocking: true, from: { id: "claude:sam", name: "Sam" }, asker: "s-1", ...o }, (m) => void sent.push(m));
  const reply = async (id: string) => (await until(() => sent.some((m) => m.id === id)), sent.find((m) => m.id === id)!);
  const state = () => JSON.parse(fs.readFileSync(path.join(dir, "state.json"), "utf8")) as SavedExpert;
  const update = (f: ExpertFile) => ((file = f), expert.update(f));
  await expert.start();
  return { expert, ...g, sent, logs, trunks, claude, health, ask, reply, state, rules, update, dir, readDir, transcript, file: () => file };
}

async function until(check: () => boolean, ms = 20000) {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 10));
  }
}

const turns = (t: Awaited<ReturnType<typeof setUp>>, kind: string, trunk?: string) => t.claude().filter((l) => l.kind === kind && l.turn && (!trunk || l.trunk === trunk));
const starts = (t: Awaited<ReturnType<typeof setUp>>, kind: string) => t.claude().filter((l) => l.kind === kind && l.argv);
const short = (c: string) => c.slice(0, 7);
const forkFailed = (id: string, detail: string) => ({ type: "refusal", v: PROTOCOL_VERSION, id, reason: "unavailable", detail, expert: { code: "EXPERT_FORK_FAILED" } });

test("grounding: two trunk turns, recorded before the spawn, then the proof passes and it is ready, all in the health log", async () => {
  const t = await setUp();
  expect(t.expert.hosted()).toEqual({ name: "adr", repo: t.file().repo, subject: "What may leave a machine.", state: "starting" });
  await until(() => t.expert.hosted().state === "ready");
  const [trunk] = starts(t, "trunk");
  expect(trunk!.trunk).toBe(t.trunks[0]);
  // Background subagents would end a turn before their reports came in.
  expect(t.claude().filter((l) => l.argv).map((l) => l.background)).toEqual(["off", "off", "off"]);
  const [first, second] = turns(t, "trunk");
  expect(first!.text).toContain("You are the expert named adr");
  expect(first!.text).toContain("**Relay**: what carries questions.");
  expect(first!.text).toContain("- 0004-x.md");
  expect(second!.text).toContain("Now read what your subject rests on");
  expect(turns(t, "fork")[0]!.text).toContain("You are this expert's first generation");
  expect(turns(t, "judge")[0]!.text).toContain("The expert's answer:\n\nForty-two.");
  await until(() => /ready generation=1/.test(t.health()));
  expect(t.health()).toMatch(new RegExp(`grounding generation=1 trunk=${t.trunks[0]} commit=${short(C1)} model=claude-sonnet-5-5 meter=50000 cost=\\d+ ms=\\d+`));
  expect(t.health()).toMatch(/proof generation=1 result=pass expected=Forty-two. answer=Forty-two. judge="PASS: it says forty-two."/);
  expect(t.state().generations).toMatchObject([{ n: 1, trunk: t.trunks[0], state: "junior", meter: 50000, commit: C1 }]);
  expect(JSON.parse(fs.readFileSync(path.join(t.dir, "index-1.json"), "utf8"))).toEqual({ version: 1, files: { "CONTEXT.md": C1, "src/relay.ts": C1 } });
});

test("proof: a failing first generation takes no questions; a failing later one leaves the one before answering", async () => {
  const t = await setUp({ rules: [{ kind: "judge", reply: "FAIL: it says forty-three." }, ...BASE] });
  await until(() => t.expert.hosted().state === "failed");
  t.ask("x-1");
  expect(await t.reply("expert-x-1-1")).toEqual(forkFailed("expert-x-1-1", "the expert's grounding didn't pass its proof question"));

  const later = await setUp({ restored: { generations: [gen(1, T1, "junior")] }, rules: [{ kind: "judge", reply: "FAIL: no." }, ...BASE] });
  later.update(expertFile({ subject: "What may leave a machine, and why." }));
  await until(() => /proof generation=2 result=fail/.test(later.health()));
  expect(later.expert.hosted().state).toBe("ready");
  later.ask("x-1");
  expect(await later.reply("expert-x-1-1")).toMatchObject({ type: "reply", kind: "answer-expert" });
  expect(starts(later, "fork").at(-1)!.trunk).toBe(T1);
  expect(later.state().generations.map((g) => [g.n, g.state])).toEqual([
    [1, "junior"],
    [2, "failed"],
  ]);
});

test("a question: answered on a fork of the junior at the moved checkout, its citations stamped and marked changed since", async () => {
  const t = await setUp({
    restored: { generations: [gen(1, T1, "junior")], indexes: { 1: { "src/relay.ts": C1, "CONTEXT.md": C1 } } },
    rules: [{ kind: "fork", text: "Question x-1", reads: ["docs/adr/0004-x.md"], reply: "<answer>It stays on the server.</answer>\n<cited>\nsrc/relay.ts:1-2\ndocs/adr/0004-x.md\nsrc/other.ts\nsrc/gone.ts\n/etc/passwd\n</cited>" }],
  });
  await until(() => t.calls.some((c) => c.args[0] === "fetch"));
  t.repo.origin = C2;
  t.repo.changed = ["src/relay.ts"];
  t.ask("x-1");
  const r = (await t.reply("expert-x-1-1")) as Extract<ReplyMessage, { kind: "answer-expert" }>;
  expect(t.repo.head).toBe(C2);
  expect(turns(t, "fork")[0]!.text).toContain("re-read any you rely on:\n- src/relay.ts");
  expect(r).toMatchObject({ commit: C2, branch: "main" });
  expect(r.answer).toBe(`It stays on the server.\n\nCited, on main at ${short(C2)}:\n- src/relay.ts:1-2 (read at ${short(C1)}, changed since)\n- docs/adr/0004-x.md (read at ${short(C2)})\n- src/other.ts (commit unknown)`);
  await until(() => /question id=x-1/.test(t.health()));
  expect(JSON.parse(fs.readFileSync(path.join(t.dir, "index-1.json"), "utf8")).files["docs/adr/0004-x.md"]).toBe(C2);
  expect(t.health()).toMatch(/question id=x-1 blocking=true ms=\d+ cost=\d+ outcome=answered senior=no explored=yes note=none/);
});

// Generation 1 is the senior, at commit C0 for src/relay.ts; generation 2 the junior.
const withSenior = (rules: Rule[]): SetUp => ({ restored: { generations: [gen(1, T1, "senior"), gen(2, T2, "junior")], indexes: { 1: { "src/relay.ts": C0 } } }, rules });
const JUNIOR_ASKS: Rule[] = [
  { kind: "fork", text: "Your senior answered", reply: "<answer>On the server, in the relay.</answer>\n<cited>\nsrc/relay.ts\n</cited>\n<learned>Rule or fact: questions wait on the server. Why: ADR 0004. Files: src/relay.ts</learned>" },
  { kind: "fork", text: "You are this expert's senior", reply: "<answer>In the relay.</answer>\n<cited>\nsrc/relay.ts\n</cited>" },
  { kind: "fork", text: "You are this expert's junior", reply: "<ask-senior>Where does a question wait?</ask-senior>" },
  ...BASE,
];

test("the junior asks its senior: a fork of the senior's trunk, whose answer is the junior's next turn, and the learned note is appended", async () => {
  const t = await setUp(withSenior(JUNIOR_ASKS));
  t.ask("x-1");
  const r = (await t.reply("expert-x-1-1")) as Extract<ReplyMessage, { kind: "answer-expert" }>;
  expect(starts(t, "fork").map((s) => s.trunk)).toEqual([T2, T1]);
  const senior = turns(t, "fork", T1)[0]!.text!;
  expect(senior).toContain("You are this expert's senior");
  expect(senior).toContain("Where does a question wait?");
  expect(turns(t, "fork", T2)[1]!.text).toContain("Your senior answered:\n\nIn the relay.");
  expect(r.answer).toContain(`- src/relay.ts (read at ${short(C0)})`);
  await until(() => /note=appended/.test(t.health()));
  expect(turns(t, "append", T2)[0]!.text).toContain("Rule or fact: questions wait on the server.");
  expect(t.health()).toMatch(/question id=x-1 .* senior=yes explored=no note=appended/);
  expect(t.state().generations.find((g) => g.n === 2)).toMatchObject({ notes: 1, meter: 60000 });
});

test("the senior's answer to the junior marks the files it cited that changed since", async () => {
  const t = await setUp(withSenior(JUNIOR_ASKS));
  t.repo.changed = ["src/relay.ts"];
  t.ask("x-1");
  const r = (await t.reply("expert-x-1-1")) as Extract<ReplyMessage, { kind: "answer-expert" }>;
  expect(turns(t, "fork", T2)[1]!.text).toContain(`- src/relay.ts (read at ${short(C0)}, changed since: re-read it before relying on it)`);
  expect(r.answer).toContain(`- src/relay.ts (read at ${short(C0)}, changed since)`);
});

test("an <ask-senior> isn't honoured in a senior's fork, nor in a first generation's", async () => {
  const t = await setUp(withSenior([{ kind: "fork", text: NO_SENIOR, reply: "<answer>In the relay.</answer>" }, { kind: "fork", text: "You are this expert's senior", reply: "<ask-senior>Who knows?</ask-senior>" }, ...JUNIOR_ASKS]));
  t.ask("x-1");
  await t.reply("expert-x-1-1");
  expect(turns(t, "fork", T1).map((l) => l.text)).toEqual([expect.stringContaining("Where does a question wait?"), NO_SENIOR]);
  expect(starts(t, "fork")).toHaveLength(2);

  const first = await setUp({ restored: { generations: [gen(1, T1, "junior")] }, rules: [{ kind: "fork", text: NO_SENIOR, reply: ANSWER }, { kind: "fork", text: "Question x-", reply: "<ask-senior>Who knows?</ask-senior>" }] });
  first.ask("x-1");
  expect(await first.reply("expert-x-1-1")).toMatchObject({ type: "reply" });
  expect(starts(first, "fork")).toHaveLength(1);
});

test("a learned note is appended only when the fork explored or asked its senior, and it names a file read for it", async () => {
  const learned = (file: string) => `<answer>Yes.</answer>\n<learned>Rule or fact: a. Why: b. Files: ${file}:1-2.</learned>`;
  const t = await setUp({
    restored: { generations: [gen(1, T1, "junior")] },
    rules: [{ kind: "fork", text: "(x-1)", reply: learned("src/relay.ts") }, { kind: "fork", text: "(x-2)", reply: learned("src/relay.ts"), reads: ["src/relay.ts"] }, { kind: "fork", text: "(x-3)", reply: learned("src/other.ts"), reads: ["src/relay.ts"] }, ...BASE],
  });
  t.ask("x-1");
  await until(() => /question id=x-1/.test(t.health()));
  expect(starts(t, "append")).toHaveLength(0);
  t.ask("x-2");
  await until(() => /question id=x-2/.test(t.health()));
  expect(starts(t, "append")).toHaveLength(1);
  expect(t.logs).toContainEqual(expect.stringMatching(/^expert adr: appended the learned note from x-2 to generation 1: sha256 [0-9a-f]{12}, "Rule or fact: a\./));
  // Explored, but the file it names wasn't read for it: the note isn't kept.
  t.ask("x-3");
  await until(() => /question id=x-3/.test(t.health()));
  expect(starts(t, "append")).toHaveLength(1);
  expect(t.logs).toContainEqual(expect.stringMatching(/^expert adr: didn't append the learned note from x-3: none of the files it names was read for it/));
  expect(t.health()).toMatch(/question id=x-1 .* note=none/);
  expect(t.health()).toMatch(/question id=x-2 .* explored=yes note=appended/);
  expect(t.health()).toMatch(/question id=x-3 .* explored=yes note=none/);
});

test("promotion: not with no learned notes; at the threshold a new generation grounds, and the switch waits for a fork in flight", async () => {
  const release = path.join(tempRoot(), "release-x-2");
  const t = await setUp({
    file: expertFile({ promoteAtTokens: 150000 }),
    restored: { generations: [gen(1, T1, "junior", { meter: 160000 })] },
    rules: [{ kind: "fork", text: "(x-1)", reply: "<answer>Yes.</answer>\n<learned>Rule or fact: a. Files: src/relay.ts</learned>", reads: ["src/relay.ts"] }, { kind: "fork", text: "(x-2)", reply: ANSWER, until: release }, { kind: "append", reply: "noted", context: 165000 }, ...BASE],
  });
  await new Promise((r) => setTimeout(r, 300));
  expect(starts(t, "trunk")).toHaveLength(0);
  t.ask("x-1");
  await until(() => starts(t, "trunk").length === 1);
  t.ask("x-2");
  // Generation 2 has passed while x-2's fork is still running: its switch waits for that fork.
  await until(() => /proof generation=2 result=pass/.test(t.health()));
  await new Promise((r) => setTimeout(r, 300));
  expect(t.health()).not.toMatch(/question id=x-2|promotion/);
  fs.writeFileSync(release, "");
  await until(() => /promotion junior=2 senior=1 retired=none/.test(t.health()));
  expect(t.health().indexOf("question id=x-2")).toBeGreaterThan(-1);
  expect(t.health().indexOf("question id=x-2")).toBeLessThan(t.health().indexOf("promotion junior=2"));
  expect(starts(t, "fork").find((s) => turns(t, "fork", s.trunk!).some((l) => l.text?.includes("x-2")))!.trunk).toBe(T1);
  expect(t.state().generations.map((g) => [g.n, g.state])).toEqual([
    [1, "senior"],
    [2, "junior"],
  ]);
});

test("the proof of generation 2 asks generation 1 as its senior", async () => {
  const t = await setUp({ restored: { generations: [gen(1, T1, "junior")] }, rules: [{ kind: "fork", text: "Your senior answered", reply: "<answer>Forty-two.</answer>" }, { kind: "fork", text: "You are this expert's senior", reply: "<answer>Forty-two.</answer>" }, { kind: "fork", text: "Question proof-2", reply: "<ask-senior>What is the answer?</ask-senior>" }, ...BASE] });
  t.update(expertFile({ subject: "What may leave a machine, and why." }));
  await until(() => /ready generation=2/.test(t.health()));
  expect(turns(t, "fork").find((l) => l.text?.includes("Question proof-2"))!.text).toContain("You are this expert's junior");
  expect(turns(t, "fork", T1)[0]!.text).toContain("You are this expert's senior");
});

test("a promoteAtTokens within 100,000 of the compaction point fails the generation as soon as the model is known", async () => {
  const t = await setUp({ file: expertFile({ promoteAtTokens: 900000 }) });
  await until(() => t.expert.hosted().state === "failed" && /generation generation=1/.test(t.health()));
  expect(t.health()).toMatch(/generation generation=1 state=failed why="promoteAtTokens 900000 is within 100,000 tokens of the compaction point at 967000/);
  expect(turns(t, "trunk").length).toBeLessThanOrEqual(1);
});

test("a grounding that leaves room for fewer than 20 learned notes fails", async () => {
  const t = await setUp({ file: expertFile({ promoteAtTokens: 55000 }) });
  await until(() => t.expert.hosted().state === "failed" && /generation generation=1/.test(t.health()));
  expect(t.health()).toMatch(/generation generation=1 state=failed why="room for fewer than 20 learned notes/);
});

test("a fork that compacts fails its question and its generation, and a new junior grounds", async () => {
  const t = await setUp({ restored: { generations: [gen(1, T1, "junior")] }, rules: [{ kind: "fork", text: "Question x-1", compact: true, reply: ANSWER }, ...BASE] });
  t.ask("x-1");
  expect(await t.reply("expert-x-1-1")).toEqual(forkFailed("expert-x-1-1", "the fork ran out of room"));
  expect(t.health()).toMatch(/generation generation=1 state=failed why="a fork of it compacted"/);
  await until(() => /ready generation=2/.test(t.health()));
  expect(t.state().generations.map((g) => [g.n, g.state])).toEqual([
    [1, "failed"],
    [2, "junior"],
  ]);
});

test("a fork past forkTimeLimitMinutes is ended and refused", async () => {
  const t = await setUp({ minuteMs: 600, file: expertFile({ forkTimeLimitMinutes: 1 }), restored: { generations: [gen(1, T1, "junior")] }, rules: [{ kind: "fork", hang: true }] });
  t.ask("x-1");
  expect(await t.reply("expert-x-1-1")).toEqual(forkFailed("expert-x-1-1", "the fork timed out after 1 minute"));
  await until(() => /error id=x-1 cause="no reply within/.test(t.health()));
});

test("a fork that left its checkout changed is refused, and the checkout reset", async () => {
  const t = await setUp({ restored: { generations: [gen(1, T1, "junior")] } });
  t.repo.dirty = true;
  t.ask("x-1");
  expect(await t.reply("expert-x-1-1")).toEqual(forkFailed("expert-x-1-1", "the fork changed its checkout, which was reset"));
  await until(() => !t.repo.dirty);
  expect(t.calls.filter((c) => c.args.includes("reset") || c.args.includes("clean"))).toEqual([
    { cwd: t.readDir, args: ["reset", "-q", "--hard", "HEAD"] },
    { cwd: t.readDir, args: ["clean", "-fd"] },
  ]);
});

test("an answer that matches a secret pattern is refused at once, logged with the pattern's name, and never held for release", async () => {
  const t = await setUp({ restored: { generations: [gen(1, T1, "junior")] }, rules: [{ kind: "fork", reply: "<answer>The key is SECRET.</answer>" }] });
  t.ask("x-1");
  const refused = await t.reply("expert-x-1-1");
  expect(refused).toMatchObject({ type: "refusal", reason: "unavailable", detail: "its answer looked like it held a secret, so it wasn't sent", expert: { code: "EXPERT_FORK_FAILED" } });
  expect(JSON.stringify(refused)).not.toContain("SECRET");
  expect(t.logs.some((l) => l.includes('refused its answer to x-1: it matches the secret pattern'))).toBe(true);
  expect(t.health()).toMatch(/outcome=secret/);
  const released: (ReplyMessage | RefusalMessage)[] = [];
  t.expert.release("expert-x-1-1", (m) => void released.push(m));
  expect(released).toEqual([expect.objectContaining({ type: "refusal", reason: "unavailable", id: "expert-x-1-1" })]);
});

test("one question per questionId: a request sent again is attached to it, the newest gets the reply, and a finished one is answered from memory", async () => {
  const t = await setUp({ restored: { generations: [gen(1, T1, "junior")] }, rules: [{ kind: "fork", reply: ANSWER, delayMs: 500 }] });
  t.ask("x-1");
  t.ask("x-1");
  t.ask("x-1", { id: "expert-x-1-2" });
  const r = await t.reply("expert-x-1-2");
  expect(t.sent.map((m) => m.id)).toEqual(["expert-x-1-2"]);
  t.ask("x-1", { id: "expert-x-1-3" });
  expect(t.sent.at(-1)).toEqual({ ...r, id: "expert-x-1-3" });
  expect(starts(t, "fork")).toHaveLength(1);
  // Dropped while it runs: it runs to its end, and nothing is sent.
  t.ask("x-2", { id: "expert-x-2-1" });
  t.expert.drop("expert-x-2-1");
  await until(() => /question id=x-2/.test(t.health()));
  expect(t.sent.some((m) => m.id === "expert-x-2-1")).toBe(false);
});

test("after a restart a recorded junior answers at once, with no grounding; one left grounding is failed", async () => {
  const t = await setUp({ restored: { generations: [gen(1, T1, "junior"), gen(2, T2, "grounding")] } });
  expect(t.expert.hosted().state).toBe("ready");
  expect(t.trunks).toEqual([T1, T2]);
  t.ask("x-1");
  await t.reply("expert-x-1-1");
  expect(starts(t, "trunk")).toHaveLength(0);
  expect(starts(t, "fork")[0]!.trunk).toBe(T1);
  expect(t.state().generations[1]).toMatchObject({ state: "failed", why: "the runner stopped during its grounding" });
});

test("while it is starting a question is held, and answered once its junior is ready", async () => {
  const t = await setUp({ rules: [{ kind: "trunk", text: "Now read", reply: "grounded", context: 50000, delayMs: 800 }, ...BASE] });
  t.ask("x-1");
  await new Promise((r) => setTimeout(r, 300));
  expect(t.sent).toEqual([]);
  expect(await t.reply("expert-x-1-1")).toMatchObject({ type: "reply", kind: "answer-expert" });
});

test("a fetch that moved origin during a grounding doesn't move the checkout until the grounding ends", async () => {
  const t = await setUp({ restored: { generations: [gen(1, T1, "junior")] }, rules: [{ kind: "trunk", text: "Now read", reply: "grounded", context: 50000, delayMs: 1500 }, ...BASE] });
  t.update(expertFile({ subject: "What may leave a machine, and why." }));
  await until(() => turns(t, "trunk").length === 2);
  t.repo.origin = C2;
  t.ask("x-1");
  expect(await t.reply("expert-x-1-1")).toMatchObject({ commit: C1 });
  await until(() => /grounding generation=2/.test(t.health()) && t.expert.idle());
  t.ask("x-2");
  expect(await t.reply("expert-x-2-1")).toMatchObject({ commit: C2 });
});

// What the runner may ask in a person's repo: it only ever reads there.
const READS = ["remote get-url origin", "ls-remote --symref origin HEAD", "symbolic-ref --short refs/remotes/origin/HEAD", "rev-parse --path-format=absolute --git-common-dir"];

test("a change of repo deletes the old clone, then clones the new repo's origin and grounds afresh, only reading in either repo", async () => {
  const t = await setUp({ restored: { generations: [gen(1, T1, "junior")] } });
  await until(() => t.calls.some((c) => c.args[0] === "fetch"));
  const old = t.file().repo;
  const repo = path.resolve("/work/app-2");
  t.update(expertFile({ repo }));
  await until(() => /ready generation=1/.test(t.health()));
  expect(t.logs).toContainEqual(`expert adr: removed expert adr's clone of ${old}`);
  expect(t.calls.filter((c) => c.args[0] === "clone")).toEqual([{ cwd: t.dir, args: expect.arrayContaining(["--reference-if-able", repo, "https://github.com/acme/app.git", path.join(t.dir, "read.new")]) }]);
  for (const c of t.calls.filter((c) => c.cwd === old || c.cwd === repo)) expect(READS).toContain(c.args.join(" "));
  expect(t.state()).toMatchObject({ repo, generations: [{ n: 1, state: "junior" }] });
  expect(t.state().generations[0]!.trunk).not.toBe(T1);
});

test("a repo changed while the runner was off: the old clone is deleted and the new one made", async () => {
  const old = path.resolve("/work/app");
  const repo = path.resolve("/work/app-2");
  const t = await setUp({ file: expertFile({ repo }), restored: { repo: old, generations: [gen(1, T1, "junior")] } });
  await until(() => /ready generation=1/.test(t.health()));
  expect(t.logs).toContainEqual(`expert adr: removed expert adr's clone of ${old}`);
  expect(t.calls.filter((c) => c.args[0] === "clone")).toHaveLength(1);
});

test("a question held while the expert starts gets its fork's whole time limit, counted from when the fork starts", async () => {
  const t = await setUp({ minuteMs: 2000, file: expertFile({ forkTimeLimitMinutes: 1 }), rules: [{ kind: "trunk", text: "Now read", reply: "grounded", context: 50000, delayMs: 3000 }, ...BASE] });
  t.ask("x-1");
  expect(await t.reply("expert-x-1-1")).toMatchObject({ type: "reply", kind: "answer-expert" });
}, 30000);

test("a question refused while the expert is still grounding isn't remembered: asked again once its junior is ready, it is answered", async () => {
  const t = await setUp({ minuteMs: 3000, file: expertFile({ groundingTimeLimitMinutes: 1 }), rules: [{ kind: "fork", text: "Question proof-", reply: "<answer>Forty-two.</answer>", delayMs: 4000 }, ...BASE] });
  t.ask("x-1");
  expect(await t.reply("expert-x-1-1")).toEqual({ type: "refusal", v: PROTOCOL_VERSION, id: "expert-x-1-1", reason: "unavailable", detail: "the expert is still grounding its first junior" });
  // Nothing remembered for it, so its request id isn't kept either.
  await until(() => !t.expert.owns("expert-x-1-1"));
  await until(() => t.expert.hosted().state === "ready");
  t.ask("x-1", { id: "expert-x-1-2" });
  expect(await t.reply("expert-x-1-2")).toMatchObject({ type: "reply", kind: "answer-expert" });
  expect(turns(t, "fork").some((l) => l.text?.includes("Question x-1"))).toBe(true);
}, 30000);

test("caps: open questions and questions a day, per asking session, refused EXPERT_CAP", async () => {
  const t = await setUp({ file: expertFile({ caps: { openPerAsker: 1, perAskerPerDay: 2 } }), restored: { generations: [gen(1, T1, "junior")] }, rules: [{ kind: "fork", text: "(x-1)", reply: "<answer>The key is SECRET.</answer>", delayMs: 800 }, { kind: "fork", reply: ANSWER }] });
  t.ask("x-1");
  await until(() => starts(t, "fork").length === 1);
  t.ask("x-2");
  expect(await t.reply("expert-x-2-1")).toMatchObject({ reason: "unavailable", expert: { code: "EXPERT_CAP", cap: "asker-open", limit: 1 } });
  // Another asking session's open questions are its own.
  t.ask("x-3", { asker: "s-2" });
  expect(await t.reply("expert-x-3-1")).toMatchObject({ type: "reply" });
  expect(await t.reply("expert-x-1-1")).toMatchObject({ reason: "unavailable", expert: { code: "EXPERT_FORK_FAILED" } });
  t.ask("x-4");
  expect(await t.reply("expert-x-4-1")).toMatchObject({ type: "reply" });
  t.ask("x-5");
  const day = await t.reply("expert-x-5-1");
  expect(day).toMatchObject({ reason: "unavailable", expert: { code: "EXPERT_CAP", cap: "asker-day", limit: 2, frees: expect.stringMatching(/^\d{4}-\d\d-\d\dT/) } });
  expect(RefusalMessageSchema.safeParse(day).success).toBe(true);
}, 30000);

test("stop: a question waiting for a fork slot starts no fork", async () => {
  const t = await setUp({ file: expertFile({ maxForks: 1 }), restored: { generations: [gen(1, T1, "junior")] }, rules: [{ kind: "fork", reply: ANSWER, delayMs: 3000 }] });
  t.ask("x-1");
  await until(() => starts(t, "fork").length === 1);
  t.ask("x-2");
  await new Promise((r) => setTimeout(r, 100));
  t.expert.stop();
  expect(await t.reply("expert-x-1-1")).toMatchObject({ expert: { code: "EXPERT_UNKNOWN" } });
  expect(await t.reply("expert-x-2-1")).toMatchObject({ expert: { code: "EXPERT_UNKNOWN" } });
  await new Promise((r) => setTimeout(r, 300));
  expect(starts(t, "fork")).toHaveLength(1);
});

test("a fork that used a disallowed tool fails its junior even when it also left the checkout changed", async () => {
  const t = await setUp({ restored: { generations: [gen(1, T1, "junior")] }, rules: [{ kind: "fork", text: "Question x-1", reply: ANSWER, tools: ["Write"] }, ...BASE] });
  t.repo.dirty = true;
  t.ask("x-1");
  expect(await t.reply("expert-x-1-1")).toEqual(forkFailed("expert-x-1-1", "the fork changed its checkout, which was reset"));
  await until(() => /ready generation=2/.test(t.health()));
  expect(t.state().generations.map((g) => [g.n, g.state])).toEqual([
    [1, "failed"],
    [2, "junior"],
  ]);
  expect(t.repo.dirty).toBe(false);
}, 30000);

// A transcript's entries as Claude Code writes them: turns, and lines of other kinds between them.
const turn = (type: "user" | "assistant", uuid: string) => ({ type, uuid, parentUuid: null, message: {} });
const meta = { type: "last-prompt", lastPrompt: "x" };
const addLines = (file: string, ...entries: object[]) => fs.appendFileSync(file, entries.map((e) => JSON.stringify(e) + "\n").join(""));

test("a junior whose trunk was resumed by hand is retired, and its question waits for a new generation; lines that aren't turns don't count", async () => {
  const t = await setUp({ restored: { generations: [gen(1, T1, "junior", { last: "u-2" })], transcripts: { [T1]: [turn("user", "u-1"), turn("assistant", "u-2")] } } });
  addLines(t.transcript(T1), meta, { type: "attachment", uuid: "a-1" });
  t.ask("x-1");
  await t.reply("expert-x-1-1");
  expect(starts(t, "fork").at(-1)!.trunk).toBe(T1);

  addLines(t.transcript(T1), turn("user", "u-3"), turn("assistant", "u-4"), meta);
  t.ask("x-2");
  expect(await t.reply("expert-x-2-1")).toMatchObject({ type: "reply", kind: "answer-expert" });
  const second = t.state().generations.find((g) => g.n === 2)!;
  expect(starts(t, "fork").at(-1)!.trunk).toBe(second.trunk);
  expect(t.state().generations.map((g) => [g.n, g.state])).toEqual([
    [1, "retired"],
    [2, "junior"],
  ]);
  expect(t.health()).toMatch(/generation generation=1 state=retired why="its trunk was changed outside Isoplan"/);
}, 30000);

test("a senior whose trunk was resumed by hand is dropped, so the junior explores instead; on start a changed junior is retired at once", async () => {
  const t = await setUp({ ...withSenior(JUNIOR_ASKS), restored: { generations: [gen(1, T1, "senior", { last: "u-1" }), gen(2, T2, "junior")], transcripts: { [T1]: [turn("assistant", "u-1")] } } });
  addLines(t.transcript(T1), turn("user", "u-9"));
  t.ask("x-1");
  await t.reply("expert-x-1-1");
  expect(starts(t, "fork").map((s) => s.trunk)).toEqual([T2]);
  expect(turns(t, "fork", T2)[1]!.text).toContain("Your senior couldn't answer");
  expect(t.state().generations.map((g) => [g.n, g.state])).toEqual([
    [1, "retired"],
    [2, "junior"],
  ]);

  const restarted = await setUp({ restored: { generations: [gen(1, T1, "junior", { last: "u-1" })], transcripts: { [T1]: [turn("assistant", "u-1"), turn("user", "u-9")] } } });
  expect(restarted.expert.hosted().state).toBe("starting");
  await until(() => /ready generation=2/.test(restarted.health()));
}, 30000);

test("the judge's verdict passes only with PASS as its first word and no FAIL in its first line", async () => {
  const t = await setUp({ rules: [{ kind: "judge", reply: "Pass? No: FAIL, it says forty-three." }, ...BASE] });
  await until(() => t.expert.hosted().state === "failed");
  expect(t.health()).toMatch(/proof generation=1 result=fail/);
});

test("a checkout that couldn't be prepared is tried again for the next question, with no change to its file", async () => {
  const t = await setUp({ offline: true });
  await until(() => t.expert.hosted().state === "failed");
  t.ask("x-1");
  expect(await t.reply("expert-x-1-1")).toEqual(forkFailed("expert-x-1-1", "the expert's checkout of its repo couldn't be prepared"));
  t.repo.offline = false;
  t.ask("x-2");
  expect(await t.reply("expert-x-2-1")).toMatchObject({ type: "reply", kind: "answer-expert" });
  expect(t.health()).toMatch(/ready generation=1/);
}, 30000);
