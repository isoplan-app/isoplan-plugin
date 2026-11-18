// One expert on this machine: its generations, their grounding and proof, the forks that answer its
// questions, its senior, learned notes, promotion and caps (design: Agent Expertise).
//
// - A generation is a trunk session grounded once, in two turns, in the expert's own clone of its
//   repo (expert-checkout.ts): turn 1 is the fixed grounding block (the cache breakpoint), turn 2 tells it
//   to read what its subject rests on. Its id is recorded as `grounding` before it is started, so the
//   runner never reports it. A model too close to its compaction point, too little room for learned
//   notes, a compaction, a disallowed tool or a grounding cut short fails the generation.
// - Each new generation is then asked its proof question on a fork, as a question is, and a judge
//   (runner.json's expertJudgeModel, no tools) compares the answer with the owner's. One that passes
//   becomes the junior, under the checkout's exclusive hold, so forks running then finish on the
//   generation before: that one becomes the senior, and the senior before it is retired. One that
//   fails takes no questions, and whichever generation answered keeps answering.
// - A question waits while the expert is starting (no junior yet), is checked against the expert
//   file's caps and reserved in its ledger, fetches origin at most every fetchSeconds and moves the
//   checkout when no grounding holds it, then runs on a fork of the junior's trunk, at most maxForks
//   at once, under the checkout's shared hold. The junior may ask its senior with an <ask-senior>
//   reply: the runner runs a fork of the senior and gives its answer back as the junior's next turn,
//   at most twice a question. Forks of a senior, and trunk turns, are never given a senior.
// - The answer's citations are stamped by the runner, not the expert: read in this fork, at its
//   commit; else the senior's stamp; else the junior's file → commit index; else unknown. A cited
//   file that isn't in the checkout is dropped. The answer is scanned for secrets before it goes:
//   a match is refused at once (EXPERT_FORK_FAILED, with the pattern's name in the log), never held.
// - What a fork that asked its senior or explored learned is appended to the junior's trunk as a
//   learned note when a file it names was read for it, one at a time, with new forks held back
//   meanwhile so they start from it. The runner's log names each one's question. Past
//   promoteAtTokens, with at least one note, a new generation is grounded in the background.
// - A trunk is an ordinary Claude Code session, so a person could resume it by hand and add turns
//   every later fork inherits. After each grounding and learned note the runner records the uuid of
//   its transcript's last user or assistant entry (a fork never writes to it), and compares before
//   it forks a junior or a senior and on start: a junior changed outside Isoplan is retired and a
//   new generation grounds, and a changed senior is dropped, so the junior explores instead.
// - A question is known by the server's question id: a request sent again for one still running is
//   attached to it, and one that finished is answered from memory, so a question never runs twice.
//
// Everything an expert does goes to its health log (expert-health.ts); its processes are recorded
// in the process registry as forks of their trunk, except the judge, whose command line names none.

import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { PROTOCOL_VERSION, RefusalMessageSchema, ReplyMessageSchema, type ExpertCap, type ExpertRefusal, type ExpertState, type RefusalMessage, type ReplyMessage, type RequestMessage } from "@isoplan/protocol";
import type { Usage } from "./answerer.js";
import { estimate, openLedger, weighted, type CapSettings, type Ledger } from "./caps.js";
import { claudeCommand } from "./claude-binary.js";
import { forkEnv, hiddenSpawn, killTree, type Spawn, type Track } from "./claude.js";
import { EXPERT_ROOM, expertOverCap } from "./expert-caps.js";
import { createExpertCheckout, type ExpertCheckout } from "./expert-checkout.js";
import { appendArgs, converse, expertForkArgs, judgeArgs, trunkArgs, type Conversation, type ConversationFailure, type ConverseOptions, type TurnResult } from "./expert-claude.js";
import type { ExpertFile } from "./expert-file.js";
import type { HealthLog } from "./expert-health.js";
import { createCheckoutLock, createGate } from "./expert-lock.js";
import { meterOf, notesRoomProblem, thresholdProblem, windowFor } from "./expert-meter.js";
import { answerText, citationBlock, fileOf, noteFiles, parseReply, stamp } from "./expert-reply.js";
import { fingerprint, readIndex, readState, writeIndex, writeState, type SavedExpert, type SavedGeneration } from "./expert-state.js";
import type { RunGit } from "../handoff/git.js";
import { fill } from "./prompts.js";
import { createForkSlots } from "./runner.js";

type Outgoing = ReplyMessage | RefusalMessage;
export type AnswerExpertRequest = Extract<RequestMessage, { kind: "answer-expert" }>;
export type ExpertSettings = CapSettings & { expertJudgeModel: string };

/** One expert as the runner lists it: `repo` is its folder, which the office's list is asked about. */
export interface HostedExpert {
  name: string;
  repo: string;
  subject: string;
  state: ExpertState;
}

export interface ExpertOptions {
  file: ExpertFile;
  /** Its folder, <expertsDir>/<name>: state, indexes, ledger and its clone. */
  dir: string;
  health: HealthLog;
  /** <claudeDir>/projects, where trunk transcripts are: a junior whose transcript is gone or changed isn't used. */
  projectsDir: string;
  /** The runner's app folder, whose prompts/ holds expert-*.md. */
  appDir: string;
  binary: () => Promise<string | null>;
  settings: () => Promise<ExpertSettings>;
  scan: (text: string) => Promise<string | null>;
  git: RunGit;
  gitTimeoutMs: () => Promise<number>;
  spawn?: Spawn;
  env?: Record<string, string | undefined>;
  track?: Track;
  log: (text: string) => void;
  /** Told whenever `hosted()` may have changed. */
  onChange: () => void;
  /** Told every trunk id, recorded or new, so the runner never reports one. */
  onTrunk?: (trunk: string) => void;
  now?: () => number;
  /** How long a minute of the expert file's limits is; shorter in tests. */
  minuteMs?: number;
}

export interface Expert {
  hosted(): HostedExpert;
  /** Reads its state; settles before any git or grounding, which run in the background. */
  start(): Promise<void>;
  /** Its expert file changed. */
  update(file: ExpertFile): void;
  owns(request: string): boolean;
  answer(request: AnswerExpertRequest, send: (m: Outgoing) => void): void;
  release(request: string, send: (m: Outgoing) => void): void;
  drop(request: string): void;
  /** No grounding, fork, append or judge running. */
  idle(): boolean;
  /** Its file was removed: its processes end, and its questions are refused. Its folder is kept. */
  stop(): void;
  /** Ends every process it runs, as the runner exits. */
  close(): void;
}

// Finished questions remembered, newest last, so one asked again is answered the same.
const REMEMBER = 200;
// How long the proof's judge gets.
const JUDGE_MS = 2 * 60000;
// The longest CONTEXT.md and CLAUDE.md put into the grounding.
const GROUNDING_FILE_MAX = 100_000;

/** What a fork that asks for a senior it hasn't got is told: the block is never honoured there. */
export const NO_SENIOR = "ask-senior isn't available here; answer from your own context";
/** What a junior asking its senior a third time for one question is told. */
export const ANSWER_NOW = "You have asked your senior twice for this question: answer now from what you have, in the format from your grounding.";
const KEPT_ASKING = "the expert kept asking its senior instead of answering";
const NOT_PASSED = "it didn't pass its proof question";
const SENIOR_FAILED ="Your senior couldn't answer. Answer from your own context, exploring if you need to, in the format from your grounding.";

const CAP_WORDS: Record<ExpertCap, string> = {
  "asker-day": "questions per asking session per day",
  "asker-open": "open questions per asking session",
  "expert-tokens": "the expert's daily token budget",
};

const zero = (): Usage => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
const add = (a: Usage, b: Usage): Usage => ({ input: a.input + b.input, output: a.output + b.output, cacheRead: a.cacheRead + b.cacheRead, cacheWrite: a.cacheWrite + b.cacheWrite });
const short = (commit: string) => commit.slice(0, 7);
const yesNo = (b: boolean) => (b ? "yes" : "no");
const names = (list: string[]) => (list.length ? list.map((n) => `- ${n}`).join("\n") : "none");

interface Prompts {
  grounding: string;
  read: string;
  question: string;
  roleJunior: string;
  roleFirst: string;
  roleSenior: string;
  seniorAnswer: string;
  note: string;
  judge: string;
}

async function loadExpertPrompts(appDir: string): Promise<Prompts> {
  const read = async (name: string) => (await fs.readFile(path.join(appDir, "prompts", `expert-${name}.md`), "utf8")).trim();
  const [grounding, readTurn, question, roleJunior, roleFirst, roleSenior, seniorAnswer, note, judge] = await Promise.all(["grounding", "read", "question", "role-junior", "role-first", "role-senior", "senior-answer", "note", "judge"].map(read));
  return { grounding: grounding!, read: readTurn!, question: question!, roleJunior: roleJunior!, roleFirst: roleFirst!, roleSenior: roleSenior!, seniorAnswer: seniorAnswer!, note: note!, judge: judge! };
}

/** What a fork is told about the files it read that have changed in the checkout since. */
export function freshnessText(changed: ReadonlySet<string>): string {
  if (!changed.size) return "None of the files you read has changed in the checkout since you read them.";
  return `These files you read have changed in the checkout since you read them, so re-read any you rely on:\n${[...changed].sort().map((f) => `- ${f}`).join("\n")}`;
}

// What one question's forks came to: the junior's final reply, or why there is none.
interface Asked {
  failure: ConversationFailure | null;
  /** The detail for the log when it failed. */
  why: string;
  text: string;
  usage: Usage;
  reads: ReadonlySet<string>;
  explored: boolean;
  askedSenior: boolean;
  seniorStamps: Record<string, string>;
}

interface Question {
  id: string;
  asker: string;
  blocking: boolean;
  text: string;
  /** The newest request id for it, which its reply goes under. */
  latest: string;
  /** Its request ids the server hasn't dropped. */
  requests: Set<string>;
  send: (m: Outgoing) => void;
  /** Released while it was still being answered. */
}

export function createExpert(o: ExpertOptions): Expert {
  const now = o.now ?? Date.now;
  const minute = o.minuteMs ?? 60000;
  const spawn = o.spawn ?? hiddenSpawn;
  const env = o.env ?? process.env;
  const readDir = path.join(o.dir, "read");
  let file = o.file;
  const name = file.name;
  const say = o.health.say;
  const log = (text: string) => o.log(`expert ${name}: ${text}`);

  const lock = createCheckoutLock();
  const gate = createGate();
  const slots = createForkSlots();
  const children = new Set<ChildProcessWithoutNullStreams>();
  const indexes = new Map<number, Record<string, string>>();
  const appends = new Map<string, Promise<unknown>>(); // each trunk's last append
  const questions = new Map<string, Question>(); // running, by question id
  const inFlight = new Set<Question>(); // past the caps, not finished
  const byRequest = new Map<string, string>(); // request id → question id
  const finished = new Map<string, Outgoing>(); // question id → what was last sent
  const waiters = new Set<() => void>();
  const transcripts = new Map<string, string>(); // trunk → its transcript's path, once found

  let saved: SavedExpert = { version: 1, fingerprint: "", repo: file.repo, branch: "", generations: [] };
  let ledger: Ledger | null = null;
  let checkout = makeCheckout(file.repo);
  let preparing: Promise<boolean> | null = null;
  let prepared = false;
  // The grounding (with its proof) running, if any: only its own end clears it, so one a reset left
  // behind can't clear the one after.
  let groundingRun: object | null = null;
  let holding = 0; // groundings and proofs holding the checkout
  let lastFailed = false; // the last grounding failed
  // Why, as an asker is told: never the log's detail, which can name paths on this machine.
  let lastFailure: "proof" | "checkout" | "other" = "other";
  let promotionBlocked = false; // a promotion failed: not again until the file changes or a restart
  let stopped = false;
  let epoch = 0; // moves on a reset or a stop: work begun before then changes nothing
  let busy = 0; // processes running
  let appending = 0; // learned notes being appended
  let appendsStarted = 0;
  let saving: Promise<void> = Promise.resolve();
  let lastHosted = "";

  function makeCheckout(repo: string): ExpertCheckout {
    return createExpertCheckout({ git: o.git, repo, dir: o.dir, name, timeoutMs: o.gitTimeoutMs, log, fetchSeconds: () => file.fetchSeconds, now, onFetchFailed: (why) => say("fetch", { error: why }) });
  }

  const gen = (state: SavedGeneration["state"]) => saved.generations.find((g) => g.state === state) ?? null;
  const state = (): ExpertState => (gen("junior") ? "ready" : !groundingRun && lastFailed ? "failed" : "starting");
  const hosted = (): HostedExpert => ({ name, repo: file.repo, subject: file.subject, state: state() });

  // Wakes every question waiting for a junior, and tells the runner when the listing changed.
  function changed() {
    for (const wake of [...waiters]) wake();
    const text = JSON.stringify(hosted());
    if (text === lastHosted) return;
    lastHosted = text;
    o.onChange();
  }

  // state.json, written one at a time: two writes at once would share a temp file.
  const save = () => {
    const copy = structuredClone(saved);
    saving = saving.then(() => writeState(o.dir, copy)).catch((err: Error) => log(`couldn't write its state: ${err.message}`));
    return saving;
  };
  const saveIndex = (n: number, index: Record<string, string>) => {
    const copy = { ...index };
    saving = saving.then(() => writeIndex(o.dir, n, copy)).catch((err: Error) => log(`couldn't write its index: ${err.message}`));
    return saving;
  };

  const indexOf = async (n: number) => {
    let index = indexes.get(n);
    if (!index) indexes.set(n, (index = await readIndex(o.dir, n)));
    return index;
  };

  const overhead = (usage: Usage) => {
    if (ledger && usage.input + usage.output + usage.cacheRead + usage.cacheWrite > 0) ledger.reserve({ at: now(), room: EXPERT_ROOM, usage });
  };

  function killAll() {
    for (const child of children) killTree(child);
  }

  // Finds origin's default branch and makes the read checkout, once; again after a failure.
  function prepare(): Promise<boolean> {
    preparing ??= checkout.prepare().then(
      ({ branch }) => {
        saved.branch = branch;
        prepared = true;
        return true;
      },
      (err: Error) => {
        log(`couldn't prepare its checkout of ${file.repo}: ${err.message}`);
        say("generation", { state: "failed", why: `its checkout couldn't be prepared: ${err.message}` });
        preparing = null;
        return false;
      },
    );
    return preparing;
  }

  /** Runs one claude process to the end of its conversation; a trunk's are recorded under it. */
  async function run(args: string[], cwd: string, trunk: string | null, first: string, next: (turn: TurnResult) => string | null | Promise<string | null>, timeoutMs: number, opts: ConverseOptions, kids?: Set<ChildProcessWithoutNullStreams>): Promise<Conversation> {
    const failed = (kind: ConversationFailure["kind"], detail: string): Conversation => ({ ok: false, turns: [], usage: zero(), reads: new Set(), explored: false, compacted: false, failure: { kind, detail } });
    const bin = await o.binary();
    if (!bin) return failed("no-claude", "the claude binary wasn't found; run the plugin's install script, or set its path in ~/.claude/isoplan/claude-binary.json");
    // Stopped or closed while getting here: a claude started now would outlive the runner.
    if (stopped) return failed("failed", "the expert was stopped");
    let child: ChildProcessWithoutNullStreams;
    try {
      // Claude Code runs Explore subagents in the background unless background tasks are off, and a
      // turn's result would then come before their reports: the turn has to hold its subagents' work.
      child = spawn([...claudeCommand(bin), ...args], { cwd, env: { ...forkEnv(env), CLAUDE_CODE_DISABLE_BACKGROUND_TASKS: "1" } });
    } catch (err) {
      return failed("not-set-up", `couldn't start claude: ${(err as Error).message}`);
    }
    children.add(child);
    kids?.add(child);
    child.on("close", () => (children.delete(child), kids?.delete(child)));
    if (trunk) o.track?.(child, { kind: "fork", session: `claude-code:${trunk}`, folder: cwd });
    busy++;
    try {
      return await converse(child, first, next, timeoutMs, { root: readDir, ...opts });
    } finally {
      busy--;
    }
  }

  // A trunk turn's next: an <ask-senior> is answered once with NO_SENIOR, then the turns go on.
  const trunkNext = (rest: string[]) => {
    let refused = false;
    return (turn: TurnResult) => {
      if (!refused && parseReply(turn.text).askSenior !== null) {
        refused = true;
        return NO_SENIOR;
      }
      return rest.shift() ?? null;
    };
  };

  function failGeneration(g: SavedGeneration, why: string) {
    g.state = "failed";
    g.why = why;
    say("generation", { generation: g.n, state: "failed", why });
    log(`generation ${g.n} failed: ${why}`);
    void save();
  }

  // A generation that compacted or used a disallowed tool can't answer again; a junior's is replaced.
  function brokeGeneration(g: SavedGeneration, why: string) {
    const wasJunior = g.state === "junior";
    failGeneration(g, why);
    changed();
    if (wasJunior && !stopped) void ground();
  }

  /** Grounds a new generation and asks its proof question; one that passes becomes the junior. */
  async function ground(): Promise<void> {
    if (groundingRun || stopped) return;
    const mine = epoch;
    const f = file;
    const fp = fingerprint(f);
    const me = {};
    groundingRun = me;
    lastFailed = false;
    changed();
    let passed: SavedGeneration | null = null;
    try {
      if (!(await prepare())) return void ((lastFailed = true), (lastFailure = "checkout"));
      if (mine !== epoch) return;
      const n = Math.max(0, ...saved.generations.map((g) => g.n)) + 1;
      const g: SavedGeneration = { n, trunk: randomUUID(), model: f.model, commit: "", groundedAt: now(), meter: 0, notes: 0, state: "grounding" };
      saved.generations.push(g);
      o.onTrunk?.(g.trunk);
      await save();
      const ok = await lock.shared(async () => {
        holding++;
        try {
          return await groundAndProve(g, f, mine);
        } finally {
          holding--;
        }
      });
      if (mine !== epoch) return;
      if (ok) passed = g;
      else {
        lastFailed = !gen("junior");
        lastFailure = g.why === NOT_PASSED ? "proof" : "other";
        if (gen("junior")) {
          promotionBlocked = true;
          log(`its new generation ${n} didn't pass, so it isn't tried again until its file changes or the runner restarts`);
        }
      }
    } catch (err) {
      log(`its grounding failed: ${(err as Error)?.stack ?? String(err)}`);
      lastFailed = !gen("junior");
      lastFailure = "other";
    } finally {
      if (mine === epoch && passed) await promote(passed, fp);
      if (groundingRun === me) groundingRun = null;
      changed();
      // The file changed while this one grounded: ground for it now.
      if (mine === epoch && !stopped && fingerprint(file) !== fp && file.repo === f.repo) void ground();
      else checkPromotion();
    }
  }

  async function groundAndProve(g: SavedGeneration, f: ExpertFile, mine: number): Promise<boolean> {
    const started = now();
    const commit = await checkout.head();
    g.commit = commit;
    const s = await o.settings();
    const p = await loadExpertPrompts(o.appDir);
    const values = {
      name,
      subject: f.subject,
      context: (await checkout.read("CONTEXT.md", GROUNDING_FILE_MAX)) ?? "none",
      claude: (await checkout.read("CLAUDE.md", GROUNDING_FILE_MAX)) ?? "none",
      adrs: names(await checkout.list("docs/adr")),
    };
    let windowed = false;
    const check = (model: string) => {
      const w = windowFor(model, f.window);
      if (!w.ok) return w.why;
      windowed = true;
      return thresholdProblem(f.promoteAtTokens, w.compactAt ?? w.window);
    };
    const c = await run(trunkArgs(g.trunk, f.model), readDir, g.trunk, fill(p.grounding, values), trunkNext([p.read]), f.groundingTimeLimitMinutes * minute, { check });
    overhead(c.usage);
    if (mine !== epoch) return false;
    if (!c.ok) {
      failGeneration(g, c.failure!.kind === "timed-out" ? `its grounding didn't finish within ${f.groundingTimeLimitMinutes} minutes` : c.failure!.detail);
      return false;
    }
    g.model = c.model ?? f.model;
    g.last = await lastTurn(g.trunk);
    const problem = (windowed ? null : check(g.model)) ?? (c.turns.length < 2 ? "its grounding ended before its second turn" : notesRoomProblem(f.promoteAtTokens, meterOf(c.turns.at(-1)!)));
    g.meter = c.turns.length ? meterOf(c.turns.at(-1)!) : 0;
    if (problem) {
      failGeneration(g, problem);
      return false;
    }
    const index = Object.fromEntries([...c.reads].map((file) => [file, commit]));
    indexes.set(g.n, index);
    await saveIndex(g.n, index);
    say("grounding", { generation: g.n, trunk: g.trunk, commit: short(commit), model: g.model, meter: g.meter, cost: Math.round(weighted(c.usage, s)), ms: now() - started });
    await save();
    return prove(g, f, s, commit, mine);
  }

  // The proof: the new generation answers its owner's question on a fork, and the judge compares.
  async function prove(g: SavedGeneration, f: ExpertFile, s: ExpertSettings, commit: string, mine: number): Promise<boolean> {
    const senior = gen("junior") ?? gen("senior");
    const kids = new Set<ChildProcessWithoutNullStreams>();
    const asked = await askFork({ junior: g, senior, question: f.proof.question, id: `proof-${g.n}`, deadline: now() + f.forkTimeLimitMinutes * minute, commit, kids });
    for (const kid of kids) killTree(kid);
    overhead(asked.usage);
    if (mine !== epoch) return false;
    if (asked.failure) {
      failGeneration(g, `its proof question wasn't answered: ${asked.why}`);
      return false;
    }
    const answer = (parseReply(asked.text).answer ?? asked.text).trim();
    const judged = await run(judgeArgs(s.expertJudgeModel), o.dir, null, fill((await loadExpertPrompts(o.appDir)).judge, { question: f.proof.question, expected: f.proof.answer, answer }), () => null, JUDGE_MS, { root: o.dir });
    overhead(judged.usage);
    if (mine !== epoch) return false;
    const verdict = judged.ok ? (judged.turns.at(-1)?.text ?? "") : `the judge failed: ${judged.failure!.detail}`;
    // Its first line is the verdict: PASS as its first word, and no FAIL in it ("Pass? No: FAIL").
    const line = verdict.split(/\r?\n/)[0]!;
    const pass = judged.ok && /^\W*PASS\b/i.test(line) && !/\bFAIL\b/i.test(line);
    g.proof = { passed: pass, at: now() };
    say("proof", { generation: g.n, result: pass ? "pass" : "fail", expected: f.proof.answer, answer, judge: verdict });
    if (!pass) failGeneration(g, NOT_PASSED);
    else await save();
    return pass;
  }

  // The switch, under the exclusive hold: forks running finish on the generation before.
  async function promote(g: SavedGeneration, fp: string) {
    await lock.exclusive(async () => {
      const junior = gen("junior");
      const senior = gen("senior");
      if (junior) {
        if (senior) senior.state = "retired";
        junior.state = "senior";
      }
      g.state = "junior";
      saved.fingerprint = fp;
      await save();
      if (junior) say("promotion", { junior: g.n, senior: junior.n, retired: senior ? senior.n : "none" });
      say("ready", { generation: g.n });
      log(`generation ${g.n} answers now`);
    });
  }

  function checkPromotion() {
    const j = gen("junior");
    if (!j || groundingRun || promotionBlocked || stopped) return;
    if (j.meter < file.promoteAtTokens || j.notes < 1) return;
    log(`generation ${j.n} is at ${j.meter} tokens with ${j.notes} learned notes, so a new generation grounds`);
    void ground();
  }

  /** One question on a fork of `junior`, asking `senior` when its reply asks: the junior's final reply. */
  async function askFork(a: { junior: SavedGeneration; senior: SavedGeneration | null; question: string; id: string; deadline: number; commit: string; kids: Set<ChildProcessWithoutNullStreams> }): Promise<Asked> {
    const p = await loadExpertPrompts(o.appDir);
    const changedFiles = await checkout.changed(await indexOf(a.junior.n));
    const first = fill(p.question, { id: a.id, role: a.senior ? p.roleJunior : p.roleFirst, freshness: freshnessText(changedFiles), question: a.question });
    let usage = zero();
    let asks = 0;
    let askedSenior = false;
    const seniorStamps: Record<string, string> = {};
    const next = async (turn: TurnResult): Promise<string | null> => {
      const asked = parseReply(turn.text).askSenior;
      if (asked === null) return null;
      asks++;
      if (!a.senior) return asks === 1 ? NO_SENIOR : null;
      if (asks === 3) return ANSWER_NOW;
      if (asks > 3) return null;
      askedSenior = true;
      const said = await askSenior(a.senior, asked, a.deadline, a.commit, a.kids, p);
      usage = add(usage, said.usage);
      if (!said.answer) return SENIOR_FAILED;
      Object.assign(seniorStamps, said.stamps);
      return fill(p.seniorAnswer, { answer: said.answer, cited: said.cited });
    };
    // Waited for last, so a learned note being appended to the junior's trunk is in the fork's.
    if (a.junior.state === "junior") await gate.opened();
    const c = await run(expertForkArgs(a.junior.trunk, a.junior.model), readDir, a.junior.trunk, first, next, Math.max(1, a.deadline - now()), {}, a.kids);
    usage = add(usage, c.usage);
    const text = c.turns.at(-1)?.text ?? "";
    const base = { usage, reads: c.reads, explored: c.explored, askedSenior, seniorStamps, text };
    if (!c.ok) return { ...base, failure: c.failure!, why: c.failure!.detail };
    if (parseReply(text).askSenior !== null) return { ...base, failure: { kind: "failed", detail: KEPT_ASKING }, why: KEPT_ASKING };
    return { ...base, failure: null, why: "" };
  }

  // A fork of the senior for the junior's question: its answer, and its citations stamped and marked.
  async function askSenior(senior: SavedGeneration, question: string, deadline: number, commit: string, kids: Set<ChildProcessWithoutNullStreams>, p: Prompts): Promise<{ answer: string | null; cited: string; stamps: Record<string, string>; usage: Usage }> {
    if (!(await trusted(senior))) return { answer: null, cited: "", stamps: {}, usage: zero() };
    const index = await indexOf(senior.n);
    const first = fill(p.question, { id: "for your junior", role: p.roleSenior, freshness: freshnessText(await checkout.changed(index)), question });
    let refused = false;
    const c = await run(expertForkArgs(senior.trunk, senior.model), readDir, senior.trunk, first, (turn) => (!refused && parseReply(turn.text).askSenior !== null ? ((refused = true), NO_SENIOR) : null), Math.max(1, deadline - now()), {}, kids);
    if (!c.ok) {
      log(`its senior, generation ${senior.n}, couldn't answer: ${c.failure!.detail}`);
      if (c.failure!.kind === "compacted" || c.failure!.kind === "disallowed") brokeGeneration(senior, c.failure!.detail);
      return { answer: null, cited: "", stamps: {}, usage: c.usage };
    }
    const r = parseReply(c.turns.at(-1)?.text ?? "");
    const answer = (r.answer ?? c.turns.at(-1)?.text ?? "").trim();
    const stamped = stamp(await existing(r.cited, r.dropped), c.reads, {}, index, commit);
    const stamps = Object.fromEntries(stamped.flatMap((x) => (x.commit ? [[x.file, x.commit]] : [])));
    const since = await checkout.changed(Object.fromEntries(Object.entries(stamps).filter(([, c]) => c !== commit)));
    const cited = stamped.map((x) => `- ${x.cited} (${x.commit === null ? "commit unknown" : `read at ${short(x.commit)}${since.has(x.file) ? ", changed since: re-read it before relying on it" : ""}`})`).join("\n");
    return { answer: answer || null, cited: cited || "none", stamps, usage: c.usage };
  }

  // The cited paths that are in the checkout; the rest are logged and dropped.
  async function existing(cited: string[], dropped: string[]): Promise<string[]> {
    const kept: string[] = [];
    for (const c of cited) {
      if (await checkout.has(fileOf(c))) kept.push(c);
      else dropped.push(c);
    }
    if (dropped.length) log(`dropped citations that aren't files in its checkout: ${dropped.join(", ")}`);
    return kept;
  }

  const unavailable = (detail: string, expert?: ExpertRefusal): RefusalMessage => ({ type: "refusal", v: PROTOCOL_VERSION, id: "", reason: "unavailable", detail, ...(expert && { expert }) });
  const forkFailed = (detail: string) => unavailable(detail, { code: "EXPERT_FORK_FAILED" });
  const unknown = () => unavailable(`this machine hosts no expert named ${name} now`, { code: "EXPERT_UNKNOWN" });

  // Nothing the runner sends may fail the protocol, or the server would drop it unanswered.
  function checked(m: Outgoing): Outgoing {
    if ((m.type === "reply" ? ReplyMessageSchema : RefusalMessageSchema).safeParse(m).success) return m;
    log(`its reply for ${m.id} didn't fit the protocol, so it is refused instead`);
    return { ...forkFailed("the expert's reply didn't fit the protocol"), id: m.id };
  }

  // A question's request ids are kept while it is remembered.
  const forget = (qid: string) => {
    if (finished.has(qid)) return;
    for (const [request, q] of byRequest) if (q === qid) byRequest.delete(request);
  };

  function remember(qid: string, m: Outgoing) {
    finished.delete(qid);
    finished.set(qid, m);
    if (finished.size <= REMEMBER) return;
    const oldest = finished.keys().next().value!;
    finished.delete(oldest);
    forget(oldest);
  }

  /** Sends `m` for `q`; one that isn't `kept` (a refusal the server asks again after) isn't remembered. */
  function deliver(q: Question, m: Outgoing, kept = true) {
    const out = stopped ? unknown() : m;
    if (kept) remember(q.id, out);
    if (!q.requests.size) return log(`question ${q.id} was dropped by the office server, so its answer isn't sent`);
    q.send(checked({ ...out, id: q.latest }));
  }

  // Until there is a junior, bounded by the grounding's time limit. A checkout that couldn't be
  // prepared (offline, say) is tried again, once a question.
  async function whenReady(): Promise<"ready" | "failed" | "stopped" | "timeout"> {
    const deadline = now() + file.groundingTimeLimitMinutes * minute;
    let retried = false;
    for (;;) {
      if (stopped) return "stopped";
      const st = state();
      if (st === "failed" && !prepared && !retried) {
        retried = true;
        log("its checkout couldn't be prepared before, so it tries again for a question");
        void ground();
        continue;
      }
      if (st !== "starting") return st;
      const left = deadline - now();
      if (left <= 0) return "timeout";
      await new Promise<void>((go) => {
        const wake = () => (clearTimeout(timer), waiters.delete(wake), go());
        const timer = setTimeout(wake, left);
        waiters.add(wake);
      });
    }
  }

  async function handle(q: Question): Promise<void> {
    const started = now();
    const line = { id: q.id, blocking: q.blocking, ms: 0, cost: 0, outcome: "failed", senior: "no", explored: "no", note: "none" };
    const failed = (cause: string, refusal: Outgoing) => {
      say("error", { id: q.id, cause });
      deliver(q, refusal);
    };
    try {
      let ready = await whenReady();
      // A junior whose trunk was changed by hand is retired and a new one grounds: the question waits for it.
      while (ready === "ready" && !(await trusted(gen("junior")!))) ready = await whenReady();
      if (ready === "stopped") return deliver(q, unknown());
      if (ready === "failed") {
        const why = { proof: "the expert's grounding didn't pass its proof question", checkout: "the expert's checkout of its repo couldn't be prepared", other: "the expert's last grounding failed; its host's health log for it says why" }[lastFailure];
        return failed(why, forkFailed(why));
      }
      // Still grounding: a plain refusal, which the server asks again later, so it isn't remembered.
      if (ready === "timeout") {
        say("error", { id: q.id, cause: "it is still grounding" });
        return deliver(q, unavailable("the expert is still grounding its first junior"), false);
      }
      if (!q.requests.size) return log(`question ${q.id} was dropped by the office server before it ran`);

      const s = await o.settings();
      // The junior may have failed while the settings were read.
      const j = gen("junior");
      if (!j) return failed("its junior failed while the question waited", forkFailed("the expert's junior failed; a new one is grounding"));
      const expected = estimate(j.meter, s);
      const open = [...inFlight].filter((x) => x.asker === q.asker).length;
      // Checked and reserved with no await between, so two questions can't both take the last of a cap.
      const cap = expertOverCap(ledger!.entries(now()), q.asker, open, expected, now(), file.caps, s);
      if (cap) {
        line.outcome = "cap";
        say("cap", { id: q.id, cap: cap.cap, limit: cap.limit });
        return deliver(q, unavailable(`${CAP_WORDS[cap.cap]} of ${cap.limit} reached on this machine`, { code: "EXPERT_CAP", cap: cap.cap, limit: cap.limit, ...(cap.frees !== undefined && { frees: new Date(cap.frees).toISOString() }) }));
      }
      inFlight.add(q);
      const reservation = ledger!.reserve({ at: now(), room: q.asker, usage: expected });
      let resetting = false;
      try {
        if (prepared) {
          const moved = await checkout.fetch().catch((err: Error) => (log(`couldn't fetch: ${err.message}`), null));
          // A grounding holding the checkout keeps it where it is; a later question's fetch moves it.
          if (moved && holding === 0) await lock.exclusive(() => checkout.move(moved)).catch((err: Error) => log(`couldn't move its checkout to ${moved}: ${err.message}`));
        }
        const free = await slots.take(file.maxForks);
        let freed = false;
        const freeSlot = () => freed || ((freed = true), free());
        try {
          await lock.shared(async () => {
            // Stopped while it waited for a fork slot or the checkout: no fork starts.
            if (stopped) {
              await reservation.cancel();
              return deliver(q, unknown());
            }
            const junior = gen("junior");
            if (!junior) {
              await reservation.cancel();
              return failed("its junior failed while the question waited", forkFailed("the expert's junior failed; a new one is grounding"));
            }
            // The fork's time limit counts from here, not from when the question came: a question
            // held while the expert started, or queued for a slot or the checkout, isn't cut short.
            const deadline = now() + file.forkTimeLimitMinutes * minute;
            const senior = gen("senior");
            const commit = await checkout.head();
            const kids = new Set<ChildProcessWithoutNullStreams>();
            const asked = await askFork({ junior, senior, question: q.text, id: q.id, deadline, commit, kids });
            for (const kid of kids) killTree(kid);
            freeSlot();
            line.cost = Math.round(weighted(asked.usage, s));
            line.senior = yesNo(asked.askedSenior);
            line.explored = yesNo(asked.explored);
            const ran = !(asked.failure && (asked.failure.kind === "no-claude" || asked.failure.kind === "not-set-up"));
            await (ran ? reservation.settle(asked.usage) : reservation.cancel()).catch((err: Error) => log(`couldn't record ${q.id} in its ledger: ${err.message}`));

            // A junior whose fork compacted or used a disallowed tool fails, whatever the checkout's state.
            const k = asked.failure?.kind;
            if (k === "compacted" || k === "disallowed") brokeGeneration(junior, k === "compacted" ? "a fork of it compacted" : asked.failure!.detail);
            if (await checkout.dirty()) {
              resetting = true;
              return failed("the fork changed its checkout", forkFailed("the fork changed its checkout, which was reset"));
            }
            if (asked.failure) {
              const detail =
                k === "timed-out" ? `the fork timed out after ${file.forkTimeLimitMinutes} minute${file.forkTimeLimitMinutes === 1 ? "" : "s"}` : k === "compacted" ? "the fork ran out of room" : k === "no-claude" ? "this machine has no claude binary" : k === "disallowed" ? "the fork used a tool an expert may not use" : asked.why === KEPT_ASKING ? KEPT_ASKING : "the fork couldn't answer";
              return failed(asked.why, forkFailed(detail));
            }

            const r = parseReply(asked.text);
            let cited = r.cited;
            if (r.answer === null) {
              log(`its answer to ${q.id} had no <answer> block, so the whole reply is the answer, with no citations`);
              cited = [];
            }
            const body = (r.answer ?? asked.text).trim();
            if (!body) return failed("the answer was empty", forkFailed("the expert's answer was empty"));
            const index = await indexOf(junior.n);
            const stamped = stamp(await existing(cited, r.dropped), asked.reads, asked.seniorStamps, index, commit);
            const learnt = stamped.filter((x) => x.commit !== null && index[x.file] !== x.commit);
            if (learnt.length) {
              for (const x of learnt) index[x.file] = x.commit!;
              await saveIndex(junior.n, index);
            }
            const since = await checkout.changed(Object.fromEntries(stamped.flatMap((x) => (x.commit && x.commit !== commit ? [[x.file, x.commit]] : []))));
            const answer = answerText(body, citationBlock(stamped, saved.branch, commit, since));
            const reply: ReplyMessage = { type: "reply", v: PROTOCOL_VERSION, id: "", kind: "answer-expert", answer, commit, branch: saved.branch };
            const matched = await o.scan(answer);
            if (matched) {
              // Refused, never held: an expert runs on its own, so no person would release it.
              log(`refused its answer to ${q.id}: it matches the secret pattern "${matched}"`);
              line.outcome = "secret";
              deliver(q, forkFailed("its answer looked like it held a secret, so it wasn't sent"));
            } else {
              line.outcome = "answered";
              deliver(q, reply);
            }

            if (r.learned && (asked.askedSenior || asked.explored)) {
              // Only a note resting on a file this fork read, or its senior cited, joins the trunk.
              const files = noteFiles(r.learned);
              const first = r.learned.split(/\r?\n/)[0]!.slice(0, 200);
              if (!files.some((f) => asked.reads.has(f) || Object.hasOwn(asked.seniorStamps, f))) log(`didn't append the learned note from ${q.id}: none of the files it names was read for it ("${first}")`);
              else if (await append(junior, r.learned)) {
                line.note = "appended";
                log(`appended the learned note from ${q.id} to generation ${junior.n}: sha256 ${createHash("sha256").update(r.learned).digest("hex").slice(0, 12)}, "${first}"`);
              }
            }
          });
        } finally {
          freeSlot();
        }
      } finally {
        inFlight.delete(q);
        if (resetting) await lock.exclusive(() => checkout.reset()).catch((err: Error) => log(`couldn't reset its checkout: ${err.message}`));
        checkPromotion();
      }
    } finally {
      line.ms = now() - started;
      say("question", line);
    }
  }

  // A learned note, appended to the junior's trunk one at a time, with new forks held back meanwhile.
  function append(g: SavedGeneration, note: string): Promise<boolean> {
    const done = (appends.get(g.trunk) ?? Promise.resolve()).then(() =>
      gate.closed(async () => {
        if (stopped || g.state !== "junior") return false;
        // A trunk check meanwhile can't tell this append's turns from a person's, so it doesn't count.
        appending++;
        appendsStarted++;
        try {
          const p = await loadExpertPrompts(o.appDir);
          const c = await run(appendArgs(g.trunk, g.model), readDir, g.trunk, fill(p.note, { note }), trunkNext([]), file.forkTimeLimitMinutes * minute, {});
          overhead(c.usage);
          // Recorded even when it failed: whatever of it reached the transcript is the runner's own.
          g.last = await lastTurn(g.trunk);
          if (!c.ok) {
            log(`couldn't append a learned note to generation ${g.n}: ${c.failure!.detail}`);
            if (c.failure!.kind === "compacted" || c.failure!.kind === "disallowed") brokeGeneration(g, c.failure!.kind === "compacted" ? "its trunk compacted" : c.failure!.detail);
            else await save();
            return false;
          }
          g.meter = meterOf(c.turns.at(-1)!);
          g.notes++;
          await save();
          return true;
        } finally {
          appending--;
        }
      }),
    );
    appends.set(
      g.trunk,
      done.catch(() => false),
    );
    return done.catch((err: Error) => (log(`couldn't append a learned note: ${err.message}`), false));
  }

  // A new repo: the old repo's clone goes, and it grounds from scratch.
  async function reset(oldRepo: string) {
    epoch++;
    killAll();
    // The old repo's own checkout: after a restart `checkout` is already the new repo's.
    const old = makeCheckout(oldRepo);
    log(`its repo changed from ${oldRepo} to ${file.repo}, so it starts again`);
    await lock.exclusive(() => old.remove()).catch((err: Error) => log(`couldn't remove its clone of ${oldRepo}: ${err.message}`));
    saved = { version: 1, fingerprint: "", repo: file.repo, branch: "", generations: [] };
    indexes.clear();
    await save();
    checkout = makeCheckout(file.repo);
    preparing = null;
    prepared = false;
    lastFailed = false;
    promotionBlocked = false;
    groundingRun = null;
    changed();
    void ground();
  }

  // A trunk's transcript, under whichever project folder Claude Code named for read/; null when it is gone.
  async function transcriptOf(trunk: string): Promise<string | null> {
    const there = (file: string) => fs.stat(file).then(() => true, () => false);
    const known = transcripts.get(trunk);
    if (known && (await there(known))) return known;
    const dirs = await fs.readdir(o.projectsDir, { withFileTypes: true }).catch(() => []);
    for (const d of dirs) {
      const file = path.join(o.projectsDir, d.name, `${trunk}.jsonl`);
      if (d.isDirectory() && (await there(file))) return (transcripts.set(trunk, file), file);
    }
    return null;
  }

  // The uuid of a trunk transcript's last user or assistant entry: Claude Code writes other kinds of line too.
  async function lastTurn(trunk: string): Promise<string | null> {
    const file = await transcriptOf(trunk);
    const lines = (file ? await fs.readFile(file, "utf8").catch(() => "") : "").split("\n");
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const e = JSON.parse(lines[i]!) as { type?: unknown; uuid?: unknown };
        if ((e.type === "user" || e.type === "assistant") && typeof e.uuid === "string") return e.uuid;
      } catch {
        // a blank line, or one still being written
      }
    }
    return null;
  }

  /** Whether a junior's or senior's trunk is as the runner left it; one that isn't is taken out of use. */
  async function trusted(g: SavedGeneration): Promise<boolean> {
    const started = appendsStarted;
    const last = await lastTurn(g.trunk);
    // A generation from before the runner recorded this: its transcript as it is now is taken as its own.
    if (g.last === undefined) {
      g.last = last;
      void save();
      return true;
    }
    if (last === g.last || appending > 0 || appendsStarted !== started) return true;
    if (g.state === "junior" || g.state === "senior") {
      const wasJunior = g.state === "junior";
      g.state = "retired";
      g.why = "its trunk was changed outside Isoplan";
      say("generation", { generation: g.n, state: "retired", why: g.why });
      log(`generation ${g.n}'s trunk was changed outside Isoplan (resumed by hand, say), so it isn't used again${wasJunior ? ", and a new generation grounds" : ""}`);
      void save();
      changed();
      if (wasJunior && !stopped) void ground();
    }
    return false;
  }

  return {
    hosted,
    async start() {
      ledger = await openLedger(path.join(o.dir, "ledger.json"));
      const was = await readState(o.dir);
      if (was && was.repo !== file.repo) {
        for (const g of was.generations) o.onTrunk?.(g.trunk);
        changed();
        void reset(was.repo);
        return;
      }
      if (was) {
        saved = was;
        for (const g of saved.generations) {
          o.onTrunk?.(g.trunk);
          if (g.state === "grounding") failGeneration(g, "the runner stopped during its grounding");
        }
        const junior = gen("junior");
        if (junior && !(await transcriptOf(junior.trunk))) failGeneration(junior, "its trunk's transcript is gone");
        for (const g of [gen("junior"), gen("senior")]) if (g) await trusted(g);
      }
      changed();
      // A junior from before answers at once; the checkout is prepared beside it, so its questions fetch.
      if (!gen("junior") || saved.fingerprint !== fingerprint(file)) void ground();
      else void prepare().then(checkPromotion);
    },
    update(f) {
      const old = file;
      file = f;
      if (f.repo !== old.repo) return void reset(old.repo);
      promotionBlocked = false;
      changed();
      if (fingerprint(f) !== saved.fingerprint) void ground();
      else checkPromotion();
    },
    owns: (request) => byRequest.has(request),
    answer(request, send) {
      const known = byRequest.get(request.id);
      if (known !== undefined) {
        const running = questions.get(known);
        if (running) running.send = send;
        else if (finished.has(known)) send(checked({ ...finished.get(known)!, id: request.id }));
        return;
      }
      const qid = request.questionId;
      byRequest.set(request.id, qid);
      const running = questions.get(qid);
      if (running) {
        running.requests.add(request.id);
        running.latest = request.id;
        running.send = send;
        return;
      }
      const sent = finished.get(qid);
      if (sent) {
        send(checked({ ...sent, id: request.id }));
        return;
      }
      const q: Question = { id: qid, asker: request.asker, blocking: request.blocking, text: request.question, latest: request.id, requests: new Set([request.id]), send };
      questions.set(qid, q);
      void handle(q)
        .catch((err: unknown) => {
          log(`question ${qid}: the runner failed: ${(err as Error)?.stack ?? String(err)}`);
          if (!finished.has(qid)) deliver(q, forkFailed("the runner failed"));
        })
        .finally(() => {
          questions.delete(qid);
          // Nothing remembered for it (a refusal the server asks again after, or one dropped before it ran): its request ids go too.
          forget(qid);
        });
    },
    release(request, send) {
      // Nothing is ever held here: an answer that matches the secret scan is refused at once.
      send({ ...(stopped ? unknown() : unavailable("an expert holds no answers: one that matches the secret scan is refused at once")), id: request });
    },
    drop(request) {
      const qid = byRequest.get(request);
      if (qid === undefined) return;
      const running = questions.get(qid);
      if (running) running.requests.delete(request);
    },
    idle: () => busy === 0 && !groundingRun && questions.size === 0,
    stop() {
      stopped = true;
      epoch++;
      killAll();
      for (const wake of [...waiters]) wake();
    },
    close() {
      stopped = true;
      killAll();
    },
  };
}
