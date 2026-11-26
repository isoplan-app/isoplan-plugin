// One expert on this computer: its generations, their grounding and proof, the forks that answer its
// questions, its senior, what it learned, promotion and caps (design: Agent Expertise). It answers
// only this computer's own sessions (#340): its instance (expert-instance.ts) gives it each
// question, and is told each outcome.
//
// - A generation is a trunk session grounded once, in two turns, in the expert's own clone of its
//   repo (expert-checkout.ts): turn 1 is the fixed grounding block (the cache breakpoint), turn 2 tells it
//   to read what its subject rests on. Its id is recorded as `grounding` before it is started, so the
//   runner never reports it. A model too close to its compaction point, too little room for things
//   learned, a compaction, a disallowed tool or a grounding cut short fails the generation. A third
//   turn then carries the newest things this expert's instances learned whose files git says haven't
//   changed, within the limit (isoplan-app#366), once this computer has caught up with its records.
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
//   at most twice a question, and the first time the question's `onSenior` is told (the floor
//   shows the senior joining). Forks of a senior, and trunk turns, are never given a senior.
// - The answer's citations get their commits from the runner, not the expert: read in this fork, at
//   its commit; else the senior's; else the junior's file → commit index; else the commit a thing the
//   fork was told of gives the file; else unknown. A cited file that isn't in the checkout is dropped.
//   The answer is scanned for secrets before its session is given it: a match is refused at once
//   (EXPERT_FORK_FAILED, with the pattern's name in the log).
// - What a fork that asked its senior or explored learned, when a file it names was read for it, gets
//   an id and each file's commit, is written to the waiting file (what-was-learned-for-one-expert.ts)
//   to be sent to its expert records, and then is added to the junior's trunk (isoplan-app#366, A3).
//   What the junior hasn't picked up of what other instances learned goes in its next fork's
//   question, each with its files' commits, marked where git says its files changed since (D7), and
//   is added to its trunk with the fork's own in one addition turn after the answer, its files in the
//   generation's index (U10). Additions run one at a time per trunk (expert-trunk-additions.ts); a
//   fork that starts meanwhile resumes the trunk as it was before (D18) and carries what is being
//   added. Past promoteAtTokens, with at least one thing added, a new generation is grounded in the
//   background.
// - More not picked up than one question carries (`learnedElsewhereTokensPerQuestion`, D17), or a
//   thing its trunk holds removed on the expert's card: a new generation grounds before the junior's
//   next fork. Past the limit questions wait for it (`catchingUp`); for a removal the junior goes on
//   answering, its forks told not to rely on what was removed.
// - A trunk is an ordinary Claude Code session, so a person could resume it by hand and add turns
//   every later fork inherits. After each grounding and addition the runner records the uuid of
//   its transcript's last user or assistant entry (a fork never writes to it), and compares before
//   it forks a junior or a senior and on start: a junior changed outside Isoplan is retired and a
//   new generation grounds, and a changed senior is dropped, so the junior explores instead.
// - A question is known by its id (the asking tool call's): asked again while it runs, the newest
//   asking is told its outcome, and one that finished is answered from memory, so a question never
//   runs twice. An outcome is `answered`, `refused` with its code, or `not-yet` (still grounding,
//   a checkout being reset, a junior being replaced), which isn't remembered: asked again, it runs.
// - A failed grounding that is no longer tried again on its own tells `onTriesRanOut` why, with the
//   proof's answer when it was the proof that failed; `retryNow` (Try again on the floor) grounds now.
// - A state.json of version 1, from before #340, is an existing expert's: it grounds a new
//   generation at once while its junior answers, and once that passes, every older generation
//   retires (none stays as its senior), and state.json becomes version 3.
//
// Everything an expert does goes to its health log (expert-health.ts); its processes are recorded
// in the process registry as forks of their trunk, except the judge, whose command line names none.

import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { AreaPathSchema, DEFAULT_LEARNED_ELSEWHERE_TOKENS_PER_QUESTION, MAX_FILES_WHAT_WAS_LEARNED_RESTS_ON, type FileWhatWasLearnedRestsOn } from "@isoplan/protocol";
import type { Usage } from "./answerer.js";
import { estimate, openLedger, weighted, type CapSettings, type Ledger } from "./caps.js";
import { claudeCommand } from "./claude-binary.js";
import { forkEnv, hiddenSpawn, killTree, type Spawn, type Track } from "./claude.js";
import { EXPERT_CAP_WORDS, EXPERT_ROOM, expertOverCap, type ExpertCap } from "./expert-caps.js";
import { createExpertCheckout, type ExpertCheckout } from "./expert-checkout.js";
import { appendArgs, converse, expertForkArgs, judgeArgs, refusedResumeAt, trunkArgs, type Conversation, type ConversationFailure, type ConverseOptions, type TurnResult } from "./expert-claude.js";
import type { ExpertFile } from "./expert-file.js";
import type { HealthLog } from "./expert-health.js";
import { createCheckoutLock, createGate } from "./expert-lock.js";
import { meterOf, ROOM_FOR_THINGS_LEARNED, roomForWhatWasLearnedProblem, thresholdProblem, TOKENS_PER_THING_LEARNED, windowFor } from "./expert-meter.js";
import { answerText, citationBlock, fileOf, filesNamedIn, parseReply, withCommitsRead } from "./expert-reply.js";
import { fingerprint, indexPath, readIndex, readState, writeIndex, writeState, type AddedToItsTrunk, type SavedExpert, type SavedGeneration } from "./expert-state.js";
import { createTrunkAdditions } from "./expert-trunk-additions.js";
import type { RunGit } from "../handoff/git.js";
import { fill } from "./prompts.js";
import { createForkSlots } from "./runner.js";
import { firstLineOf, type ThingToCarry, type WhatWasLearnedForOneExpert } from "./what-was-learned-for-one-expert.js";
import { filesByCommit, filesChangedSince, newestWithin, thingsText, tokensOfAll, type ThingInAQuestion } from "./what-was-learned-in-a-question.js";
import type { ThingLearnedHere } from "./what-was-learned-waiting-to-be-sent.js";

export type ExpertSettings = CapSettings & { expertJudgeModel: string };

/** A question this computer's session asks the expert: `id` is the tool call's, `asker` the asking session, which its caps count by. */
export interface ExpertQuestionForInstance {
  id: string;
  question: string;
  blocking: boolean;
  asker: string;
}

/**
 * How a question went: answered, with the commit and branch its answer describes; refused, with its
 * code and why (a cap with its limit and when it frees, in ms); or not yet, to be asked again.
 */
export type InstanceOutcome =
  | { kind: "answered"; answer: string; commit: string; branch: string }
  | { kind: "refused"; code: "EXPERT_CAP" | "EXPERT_FORK_FAILED" | "EXPERT_UNKNOWN"; detail: string; cap?: ExpertCap; limit?: number; frees?: number }
  | { kind: "not-yet"; detail: string };

/** Why its last grounding failed, as an asker is told: never the log's detail, which can name paths on this computer. */
export type ExpertFailure = "proof" | "checkout" | "other";

/** One expert as the runner runs it: `repo` is its folder. */
export interface HostedExpert {
  name: string;
  repo: string;
  subject: string;
  /** `starting`: no generation of it has passed its proof question yet; `ready`: its junior answers; `failed`: its last grounding failed and none answers. */
  state: "starting" | "ready" | "failed";
  /** It has a senior generation its junior can ask. */
  senior: boolean;
  /** The folders and globs of its repo its file says it covers; absent when it names none. */
  areas?: string[];
  /** While it is starting: whether its generation is grounding or being asked its proof question. */
  step?: "grounding" | "proof";
  /** Its junior's context right after its grounding. */
  groundingTokens?: number;
  /** With `failed`: why. */
  failure?: ExpertFailure;
}

export interface ExpertOptions {
  file: ExpertFile;
  /** Its folder, <expertsDir>/<name>: state, indexes, ledger and, unless `read` is elsewhere, its clone. */
  dir: string;
  /** Its clone, where every trunk and fork runs: <dir>/read unless runner.json's `clonesFolder` put it elsewhere (experts.ts readFolder). */
  read?: string;
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
  /** A failed grounding isn't tried again on its own any more: why, and the proof's answer when its proof failed. */
  onTriesRanOut?: (ran: { why: ExpertFailure; proofAnswer: string | null }) => void;
  /** Told every trunk id, recorded or new, so the runner never reports one. */
  onTrunk?: (trunk: string) => void;
  /** What its instance learned and was told of (isoplan-app#366): the waiting file and the received file. */
  whatWasLearned: WhatWasLearnedForOneExpert;
  now?: () => number;
  /** How long a minute of the expert file's limits is; shorter in tests. */
  minuteMs?: number;
}

export interface Expert {
  hosted(): HostedExpert;
  /** Reads its state; settles before any git or grounding, which run in the background. */
  start(): Promise<void>;
  /** Its file changed. */
  update(file: ExpertFile): void;
  /** `onOutcome` is told how it went; `onSenior` once, when its junior first asks its senior. Asked again under its id, the newest asking is told. */
  answer(question: ExpertQuestionForInstance, onOutcome: (outcome: InstanceOutcome) => void, onSenior?: () => void): void;
  /**
   * Before a question is given to it, from what is in memory (D17, removal): more not picked up than
   * one question carries starts a new generation that questions wait for; a thing its junior's trunk
   * holds removed on the card starts one in the background. Neither while promotion is blocked or a
   * try again is timed.
   */
  beforeQuestion(): void;
  /** Questions wait for a new generation that carries what other instances learned. */
  catchingUp(): boolean;
  /** Grounds again now, as if its file had changed: Try again after a failure. */
  retryNow(): void;
  /** No grounding, fork, addition or judge running. */
  idle(): boolean;
  /** Its file was removed: its processes end, and its questions are refused. Its folder is kept. */
  stop(): void;
  /** Its expert was deleted: it stops, and its trunks, its clone and its folder are deleted. */
  remove(): Promise<void>;
  /** Ends every process it runs, as the runner exits. */
  close(): void;
}

// Finished questions remembered, newest last, so one asked again is answered the same.
const REMEMBER = 200;
// How long the proof's judge gets.
const JUDGE_MS = 2 * 60000;
// The longest CONTEXT.md and CLAUDE.md put into the grounding.
const GROUNDING_FILE_MAX = 100_000;
// The minutes before each try again of a grounding that keeps failing: no question comes to a
// failed expert, and no person is there to edit its file. A generation that passes, or a change to
// its file, starts the count again.
const RETRY_MINUTES = [10, 30, 90];
// A trunk id as the runner makes them: only a path built from one is ever deleted.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** What a fork that asks for a senior it hasn't got is told: the block is never honoured there. */
export const NO_SENIOR = "ask-senior isn't available here; answer from your own context";
/** What a junior asking its senior a third time for one question is told. */
export const ANSWER_NOW = "You have asked your senior twice for this question: answer now from what you have, in the format from your grounding.";
const KEPT_ASKING = "the expert kept asking its senior instead of answering";
const NOT_PASSED = "it didn't pass its proof question";
const SENIOR_FAILED ="Your senior couldn't answer. Answer from your own context, exploring if you need to, in the format from your grounding.";
const CATCHING_UP = "the expert is catching up on what its other instances learned";
// How long a question waits for a catch-up still coming in pages before it is judged against the
// limit. A new generation's grounding waits a minute for this computer to catch up with its records.
const CAUGHT_UP_FOR_A_QUESTION_MS = 5000;

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
  /** The addition turn: what forks learned, here and elsewhere. */
  whatWasLearned: string;
  /** In a fork's question: what other instances learned that it hasn't been told. */
  learnedElsewhere: string;
  /** In a fork's question: what was removed on the card that its trunk holds. */
  removed: string;
  /** A new generation's third grounding turn. */
  groundingWhatWasLearned: string;
  judge: string;
}

async function loadExpertPrompts(appDir: string): Promise<Prompts> {
  const read = async (name: string) => (await fs.readFile(path.join(appDir, "prompts", `expert-${name}.md`), "utf8")).trim();
  const [grounding, readTurn, question, roleJunior, roleFirst, roleSenior, seniorAnswer, whatWasLearned, learnedElsewhere, removed, groundingWhatWasLearned, judge] = await Promise.all(["grounding", "read", "question", "role-junior", "role-first", "role-senior", "senior-answer", "what-was-learned", "learned-elsewhere", "removed", "grounding-what-was-learned", "judge"].map(read));
  return { grounding: grounding!, read: readTurn!, question: question!, roleJunior: roleJunior!, roleFirst: roleFirst!, roleSenior: roleSenior!, seniorAnswer: seniorAnswer!, whatWasLearned: whatWasLearned!, learnedElsewhere: learnedElsewhere!, removed: removed!, groundingWhatWasLearned: groundingWhatWasLearned!, judge: judge! };
}

/** What a fork is told about the files it read, or that something it learned rests on, that have changed in the checkout since. */
export function freshnessText(changed: ReadonlySet<string>): string {
  if (!changed.size) return "None of the files you read, or that something you learned rests on, has changed in the checkout since.";
  return `These files, which you read or which something you learned rests on, have changed in the checkout since, so re-read any you rely on:\n${[...changed].sort().map((f) => `- ${f}`).join("\n")}`;
}

/** The estimated tokens of what other instances learned that one fork's question may carry (D17). */
const limitOf = (f: ExpertFile) => f.learnedElsewhereTokensPerQuestion ?? DEFAULT_LEARNED_ELSEWHERE_TOKENS_PER_QUESTION;

/** What a fork carries, and git's answer for its files, worked out before the fork starts. */
interface Carry {
  things: ThingToCarry[];
  /** Each record's last arrival number received when the carry was taken. */
  upTo: Record<string, number>;
  /** Git's answer, by commit: the files changed since. A commit not asked counts its files changed. */
  changed: ReadonlyMap<string, ReadonlySet<string>>;
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
  seniorCommits: Record<string, string>;
  /** What its question carried of what was learned elsewhere, for the addition after its answer. */
  carry: Carry;
  /** Not asked: what came since the question did is more than it carries, and questions wait for a new generation (D17). */
  catchingUp?: true;
}

interface Question {
  id: string;
  asker: string;
  blocking: boolean;
  text: string;
  /** The newest asking's: told its outcome. */
  onOutcome: (outcome: InstanceOutcome) => void;
  /** The newest asking's: told when its junior first asks its senior. */
  onSenior: (() => void) | undefined;
}

export function createExpert(o: ExpertOptions): Expert {
  const now = o.now ?? Date.now;
  const minute = o.minuteMs ?? 60000;
  const spawn = o.spawn ?? hiddenSpawn;
  const env = o.env ?? process.env;
  const readDir = o.read ?? path.join(o.dir, "read");
  let file = o.file;
  const name = file.name;
  const say = o.health.say;
  const log = (text: string) => o.log(`expert ${name}: ${text}`);

  const lock = createCheckoutLock();
  const gate = createGate();
  const slots = createForkSlots();
  const children = new Set<ChildProcessWithoutNullStreams>();
  const indexes = new Map<number, Record<string, string>>();
  const additions = createTrunkAdditions<ThingToCarry>(log);
  const whatWasLearned = o.whatWasLearned;
  const questions = new Map<string, Question>(); // running, by question id
  const inFlight = new Set<Question>(); // past the caps, not finished
  const finished = new Map<string, InstanceOutcome>(); // question id → how it went
  const waiters = new Set<() => void>();
  const transcripts = new Map<string, string>(); // trunk → its transcript's path, once found
  const live = new Map<string, number>(); // trunk → its processes running
  const discarded = new Set<string>(); // trunks whose files are deleted

  let saved: SavedExpert = { version: 3, setUpFromExpertRecord: true, fingerprint: "", repo: file.repo, branch: "", generations: [] };
  // A state from before #340: its new generation, once it passes, retires every one before it.
  let migrating = false;
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
  let lastFailure: ExpertFailure = "other";
  let lastProofAnswer: string | null = null; // the answer of the last proof that failed
  let proving = false; // a generation is being asked its proof question
  let promotionBlocked = false; // a promotion failed: not again until a retry, the file changes or a restart
  let retries = 0; // groundings tried again since one last passed or the file changed
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  // A fork left the checkout changed while a grounding held it: it is reset once the grounding lets go.
  let resetPending = false;
  let stopped = false;
  let epoch = 0; // moves on a reset or a stop: work begun before then changes nothing
  let busy = 0; // processes running
  let appending = 0; // additions to a trunk running
  let appendsStarted = 0;
  // Questions wait for a new generation that carries more than one question can (D17).
  let catchingUp = false;
  // This Claude Code refused `--resume-session-at`: forks wait for additions instead, for the rest of the runner's life.
  let noResumeAt = false;
  let saving: Promise<void> = Promise.resolve();
  let lastHosted = "";

  function makeCheckout(repo: string): ExpertCheckout {
    return createExpertCheckout({ git: o.git, repo, dir: o.dir, read: readDir, name, timeoutMs: o.gitTimeoutMs, log, fetchSeconds: () => file.fetchSeconds, now, onFetchFailed: (why) => say("fetch", { error: why }) });
  }

  const gen = (state: SavedGeneration["state"]) => saved.generations.find((g) => g.state === state) ?? null;
  const state = (): HostedExpert["state"] => (gen("junior") ? "ready" : !groundingRun && lastFailed ? "failed" : "starting");
  const hosted = (): HostedExpert => {
    const st = state();
    const junior = gen("junior");
    const groundingTokens = junior ? junior.groundingTokens ?? junior.meter : 0;
    return {
      name,
      repo: file.repo,
      subject: file.subject,
      state: st,
      senior: !!junior && !!gen("senior"),
      ...(file.areas.length && { areas: [...file.areas] }),
      ...(st === "starting" && groundingRun && { step: proving ? ("proof" as const) : ("grounding" as const) }),
      ...(groundingTokens > 0 && { groundingTokens }),
      ...(st === "failed" && { failure: lastFailure }),
    };
  };

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
      // Auto memory is off too: an expert knows only its grounding and what was added to its trunk, and a memory
      // Claude Code kept for the read checkout would reach every fork outside them.
      child = spawn([...claudeCommand(bin), ...args], { cwd, env: { ...forkEnv(env), CLAUDE_CODE_DISABLE_BACKGROUND_TASKS: "1", CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1" } });
    } catch (err) {
      return failed("not-set-up", `couldn't start claude: ${(err as Error).message}`);
    }
    children.add(child);
    kids?.add(child);
    if (trunk) live.set(trunk, (live.get(trunk) ?? 0) + 1);
    child.on("close", () => {
      children.delete(child);
      kids?.delete(child);
      if (!trunk) return;
      const left = live.get(trunk)! - 1;
      if (left) live.set(trunk, left);
      else live.delete(trunk);
      const g = saved.generations.find((x) => x.trunk === trunk);
      if (g) discardIfDone(g);
    });
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
    discardIfDone(g);
  }

  // A retired or failed generation's trunk transcript, the folder beside it (its subagents'), and its
  // index are deleted once none of its processes runs, since none of it is used again. Its record stays
  // in state.json, so its number isn't used again.
  function discardIfDone(g: SavedGeneration) {
    if ((g.state !== "retired" && g.state !== "failed") || live.has(g.trunk) || discarded.has(g.trunk)) return;
    discarded.add(g.trunk);
    void discard(g);
  }

  async function discard(g: SavedGeneration) {
    indexes.delete(g.n);
    const n = g.n;
    // After any write of it already queued.
    saving = saving.then(() => fs.rm(indexPath(o.dir, n), { force: true })).catch((err: Error) => log(`couldn't delete generation ${n}'s index: ${err.message}`));
    // A trunk that isn't a uuid could name a project folder itself, so nothing is deleted for it.
    if (!UUID.test(g.trunk)) return;
    const transcript = await transcriptOf(g.trunk);
    transcripts.delete(g.trunk);
    if (!transcript) return;
    try {
      // Tried again a few times: Windows holds a file or folder a moment while a scanner or a process in it lets go.
      await fs.rm(transcript, { force: true, maxRetries: 5, retryDelay: 200 });
      await fs.rm(path.join(path.dirname(transcript), g.trunk), { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
      log(`deleted generation ${n}'s trunk transcript, as it is ${g.state}`);
    } catch (err) {
      log(`couldn't delete generation ${n}'s trunk transcript: ${(err as Error).message}`);
    }
  }

  // A generation that compacted or used a disallowed tool can't answer again; a junior's is replaced.
  function brokeGeneration(g: SavedGeneration, why: string) {
    const wasJunior = g.state === "junior";
    failGeneration(g, why);
    changed();
    if (wasJunior && !stopped) void ground();
  }

  /** Grounds a new generation and asks its proof question; one that passes becomes the junior. `because` goes to the log. */
  async function ground(because?: string): Promise<void> {
    if (groundingRun || stopped) return;
    clearRetry();
    if (because) log(`a new generation grounds: ${because}`);
    const mine = epoch;
    const f = file;
    const fp = fingerprint(f);
    const me = {};
    groundingRun = me;
    lastFailed = false;
    changed();
    let passed: SavedGeneration | null = null;
    // Once it failed: whether trying again could go differently.
    let retry: boolean | null = null;
    const failure = { repeats: false };
    try {
      if (!(await prepare())) return void ((lastFailed = true), (lastFailure = "checkout"), (retry = true));
      if (mine !== epoch) return;
      const n = Math.max(0, ...saved.generations.map((g) => g.n)) + 1;
      const g: SavedGeneration = { n, trunk: randomUUID(), model: f.model, commit: "", groundedAt: now(), meter: 0, addedToItsTrunk: [], pickedUpTo: {}, state: "grounding" };
      saved.generations.push(g);
      o.onTrunk?.(g.trunk);
      await save();
      const ok = await lock.shared(async () => {
        holding++;
        try {
          return await groundAndProve(g, f, mine, failure);
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
          log(`its new generation ${n} didn't pass, so the one before goes on answering`);
        }
        retry = !failure.repeats;
      }
    } catch (err) {
      log(`its grounding failed: ${(err as Error)?.stack ?? String(err)}`);
      lastFailed = !gen("junior");
      lastFailure = "other";
      retry = true;
    } finally {
      // The grounding has let go of the checkout, so a reset a fork left waiting runs now.
      if (resetPending && holding === 0) {
        resetPending = false;
        await lock.exclusive(() => checkout.reset()).catch((err: Error) => log(`couldn't reset its checkout: ${err.message}`));
      }
      if (mine === epoch && passed) await promote(passed, fp);
      if (groundingRun === me) groundingRun = null;
      // A catch-up whose generation didn't pass ends: its junior answers, carrying within the limit.
      if (catchingUp && !passed) {
        catchingUp = false;
        log("its new generation didn't pass, so it isn't caught up; its junior answers, carrying the newest of what was learned elsewhere within the limit");
      }
      changed();
      // The file changed while this one grounded: ground for it now.
      if (mine === epoch && !stopped && fingerprint(file) !== fp && file.repo === f.repo) void ground();
      else if (mine === epoch && retry !== null) retryLater(retry);
      else checkPromotion();
    }
  }

  function clearRetry() {
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = null;
  }

  // A failed grounding is tried again on the runner's own timer, a few times, further apart each time.
  function retryLater(retryable: boolean) {
    if (stopped) return;
    const ranOut = () => o.onTriesRanOut?.({ why: lastFailure, proofAnswer: lastFailure === "proof" ? lastProofAnswer : null });
    if (!retryable) return (log("its grounding failed in a way that fails every time, so it isn't tried again until its file changes"), ranOut());
    if (retries >= RETRY_MINUTES.length) return (log(`its grounding failed ${retries + 1} times running, so it isn't tried again until its file changes or the runner restarts`), ranOut());
    const minutes = RETRY_MINUTES[retries++]!;
    const attempt = retries;
    log(`its grounding failed, so it is tried again in ${minutes} minutes`);
    retryTimer = setTimeout(() => {
      retryTimer = null;
      say("retry", { attempt, of: RETRY_MINUTES.length, after: `${minutes}m` });
      void ground();
    }, minutes * minute);
    retryTimer.unref?.();
  }

  /** Sets `failure.repeats` when it fails in a way that fails every time: the expert file's numbers against the model. */
  async function groundAndProve(g: SavedGeneration, f: ExpertFile, mine: number, failure: { repeats: boolean }): Promise<boolean> {
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
      windowed = w.ok;
      const why = w.ok ? thresholdProblem(f.promoteAtTokens, w.compactAt ?? w.window) : w.why;
      if (why) failure.repeats = true;
      return why;
    };
    // Turn 2's room check, and what turn 3 carried: worked out as the conversation goes.
    const after = { room: null as string | null, carried: null as { things: ThingToCarry[]; upTo: Record<string, number> } | null };
    let refused = false;
    let step = 0;
    const next = async (turn: TurnResult): Promise<string | null> => {
      if (!refused && parseReply(turn.text).askSenior !== null) return ((refused = true), NO_SENIOR);
      step++;
      if (step === 1) return p.read;
      if (step !== 2) return null;
      // Room for things learned, judged on turn 2: a third turn only takes some of the room above it.
      after.room = roomForWhatWasLearnedProblem(f.promoteAtTokens, meterOf(turn));
      if (after.room) return ((failure.repeats = true), null);
      return whatWasLearnedForGrounding(f, meterOf(turn), mine, p, after);
    };
    const c = await run(trunkArgs(g.trunk, f.model), readDir, g.trunk, fill(p.grounding, values), next, f.groundingTimeLimitMinutes * minute, { check });
    overhead(c.usage);
    if (mine !== epoch) return false;
    if (!c.ok) {
      failGeneration(g, c.failure!.kind === "timed-out" ? `its grounding didn't finish within ${f.groundingTimeLimitMinutes} minutes` : c.failure!.detail);
      return false;
    }
    g.model = c.model ?? f.model;
    g.last = await lastTurn(g.trunk);
    const problem = (windowed ? null : check(g.model)) ?? (c.turns.length < 2 ? "its grounding ended before its second turn" : after.room);
    g.meter = c.turns.length ? meterOf(c.turns.at(-1)!) : 0;
    g.groundingTokens = g.meter;
    if (problem) {
      failGeneration(g, problem);
      return false;
    }
    const index = Object.fromEntries([...c.reads].map((file) => [file, commit]));
    // What it took into account of each record: everything received when its third turn was made, carried or not.
    g.pickedUpTo = { ...(after.carried?.upTo ?? whatWasLearned.lastReceived()) };
    const carried = after.carried?.things ?? [];
    if (carried.length) {
      g.addedToItsTrunk = carried.map(addedOf);
      // U10: git said none of these files changed since, so they are as at this commit.
      for (const t of carried) for (const x of t.files) if (x.commit && !Object.hasOwn(index, x.path)) index[x.path] = commit;
    }
    indexes.set(g.n, index);
    await saveIndex(g.n, index);
    say("grounding", { generation: g.n, trunk: g.trunk, commit: short(commit), model: g.model, meter: g.meter, cost: Math.round(weighted(c.usage, s)), ms: now() - started, ...(carried.length && { carried: carried.length }) });
    await save();
    return prove(g, f, s, commit, mine);
  }

  // A new generation's third turn: once this computer has caught up with its records, the newest
  // things learned whose files git says haven't changed, newest first while they fit, within the
  // limit and half the headroom above the room kept for things learned (so the meter after it still
  // leaves that room where the estimate is low). Null for none: no third turn.
  async function whatWasLearnedForGrounding(f: ExpertFile, meterAfterTwo: number, mine: number, p: Prompts, after: { carried: { things: ThingToCarry[]; upTo: Record<string, number> } | null }): Promise<string | null> {
    await whatWasLearned.caughtUp(minute);
    const upTo = whatWasLearned.lastReceived();
    after.carried = { things: [], upTo };
    if (mine !== epoch || stopped) return null;
    const headroom = f.promoteAtTokens - meterAfterTwo - ROOM_FOR_THINGS_LEARNED * TOKENS_PER_THING_LEARNED;
    let left = Math.min(limitOf(f), Math.floor(headroom / 2));
    const candidates = whatWasLearned.newestFirst();
    const changed = await changedSince(candidates);
    const fits: ThingToCarry[] = [];
    for (const t of candidates) {
      if (filesChangedSince(t, changed)) continue;
      const n = tokensOfAll([t]);
      if (n > left) break;
      left -= n;
      fits.unshift(t);
    }
    after.carried = { things: fits, upTo };
    if (!fits.length) return null;
    return fill(p.groundingWhatWasLearned, { items: thingsText(fits, () => false) });
  }

  // Git's answer for the things' files: by commit, the files changed since in the checkout. One `git diff` per commit.
  async function changedSince(things: readonly ThingInAQuestion[]): Promise<Map<string, ReadonlySet<string>>> {
    const out = new Map<string, ReadonlySet<string>>();
    for (const [commit, files] of filesByCommit(things)) out.set(commit, await checkout.changed(Object.fromEntries([...files].map((x) => [x, commit]))));
    return out;
  }

  const addedOf = (t: ThingToCarry): AddedToItsTrunk => ({ id: t.id, firstLine: firstLineOf(t.text), ...(t.expertRecordId && t.arrivalNumber !== undefined && { expertRecordId: t.expertRecordId, arrivalNumber: t.arrivalNumber }) });

  // What a fork of `g` carries now, in one moment with no await: what it hasn't picked up, and, with
  // the fork reading the trunk as it was before any addition running (D18), what those additions
  // hold; never what its trunk holds or what was removed. Within the limit, the newest.
  function carryNow(g: SavedGeneration, d18: boolean, changed: ReadonlyMap<string, ReadonlySet<string>>): Carry {
    const { things, upTo } = whatWasLearned.notPickedUp(g);
    const held = new Set(g.addedToItsTrunk.map((x) => x.id));
    const removed = whatWasLearned.removed();
    const all = new Map<string, ThingToCarry>();
    for (const t of [...(d18 ? additions.beingAdded(g.trunk) : []), ...things]) if (!held.has(t.id) && !removed.has(t.id) && !all.has(t.id)) all.set(t.id, t);
    let list = [...all.values()];
    if (tokensOfAll(list) > limitOf(file)) list = newestWithin(list, limitOf(file));
    return { things: list, upTo, changed };
  }

  // The block telling a fork of `g` what was removed on the card that its trunk holds: "" for none.
  function removedText(g: SavedGeneration, p: Prompts): string {
    const removed = whatWasLearned.removed();
    const held = g.addedToItsTrunk.filter((x) => removed.has(x.id));
    if (!held.length) return "";
    return fill(p.removed, { items: held.map((x) => `- ${x.firstLine || removed.get(x.id) || x.id}`).join("\n") }) + "\n\n";
  }

  // The commit each file a carried thing rests on was read at, the newest thing's where several name it.
  const toldCommits = (things: readonly ThingToCarry[]) => Object.fromEntries(things.flatMap((t) => t.files.flatMap((x) => (x.commit ? [[x.path, x.commit] as const] : []))));

  // `g` has taken each record's sequence into account up to `upTo`.
  function moveUpTo(g: SavedGeneration, upTo: Record<string, number>) {
    for (const [r, n] of Object.entries(upTo)) g.pickedUpTo[r] = Math.max(g.pickedUpTo[r] ?? 0, n);
  }

  // U10: each file a thing added to `g`'s trunk rests on goes in its index: at `commit` (the fork's)
  // where git said the file is unchanged since the thing's commit, the same content; else at the
  // thing's own commit, so later forks are told to re-read it. A file the index has already stays.
  async function recordFilesOf(g: SavedGeneration, things: readonly ThingToCarry[], changed: ReadonlyMap<string, ReadonlySet<string>>, commit: string) {
    const index = await indexOf(g.n);
    let more = false;
    for (const t of things) {
      for (const x of t.files) {
        if (!x.commit || Object.hasOwn(index, x.path)) continue;
        index[x.path] = changed.get(x.commit)?.has(x.path) !== false ? x.commit : commit;
        more = true;
      }
    }
    if (more) await saveIndex(g.n, index);
  }

  // One addition turn on `g`'s trunk: `things` in arrival order, leaving out what its trunk holds,
  // or was removed on the card, when the turn starts. Once it ended their ids are in the generation's
  // list and their files in its index, in the same moment as its uuid, and it has taken each record
  // into account up to `upTo`. One that fails changes neither, so the next fork carries them again.
  function addToTrunk(g: SavedGeneration, things: readonly ThingToCarry[], upTo: Record<string, number>, changed: ReadonlyMap<string, ReadonlySet<string>>, commit: string): Promise<boolean> {
    return additions.add(g.trunk, things, () =>
      gate.closed(async () => {
        if (stopped || g.state !== "junior" || !(await trusted(g))) return false;
        const held = new Set(g.addedToItsTrunk.map((x) => x.id));
        const removed = whatWasLearned.removed();
        const adding = things.filter((t) => !held.has(t.id) && !removed.has(t.id));
        if (!adding.length) {
          moveUpTo(g, upTo);
          await save();
          return true;
        }
        // A trunk check meanwhile can't tell this addition's turns from a person's, so it doesn't count.
        appending++;
        appendsStarted++;
        try {
          const p = await loadExpertPrompts(o.appDir);
          const before = g.last ?? null;
          const text = fill(p.whatWasLearned, { items: thingsText(adding, (t) => filesChangedSince(t, changed)) });
          const c = await run(appendArgs(g.trunk, g.model), readDir, g.trunk, text, trunkNext([]), file.forkTimeLimitMinutes * minute, {});
          overhead(c.usage);
          // Whatever of it reached the transcript is the runner's own, even when it failed; a person's
          // turn among it is not, and then the generation isn't used again.
          if (!(await onlyOurs(g.trunk, before, [text, NO_SENIOR]))) {
            retireChanged(g);
            return false;
          }
          const last = await lastTurn(g.trunk);
          if (!c.ok) {
            g.last = last;
            log(`couldn't add what was learned to generation ${g.n}'s trunk: ${c.failure!.detail}`);
            if (c.failure!.kind === "compacted" || c.failure!.kind === "disallowed") brokeGeneration(g, c.failure!.kind === "compacted" ? "its trunk compacted" : c.failure!.detail);
            else await save();
            return false;
          }
          g.last = last;
          g.meter = meterOf(c.turns.at(-1)!);
          g.addedToItsTrunk.push(...adding.map(addedOf));
          moveUpTo(g, upTo);
          await recordFilesOf(g, adding, changed, commit);
          await save();
          return true;
        } finally {
          appending--;
        }
      }),
    );
  }

  // What a fork that asked its senior or explored learned, when a file it names was read for it: an
  // id, and each file it names with the commit it was read at (in the fork, else the senior's, else
  // the junior's index, else none), written to the waiting file before it is added to the trunk (A3).
  // One naming no file the protocol takes is added to the trunk only, kept nowhere else.
  async function keepWhatItLearned(q: Question, learned: string, asked: Asked, index: Readonly<Record<string, string>>, commit: string, junior: SavedGeneration, line: { learned: string }): Promise<{ thing: ThingLearnedHere; kept: boolean } | null> {
    const named = filesNamedIn(learned);
    const firstLine = firstLineOf(learned);
    if (!named.some((f) => asked.reads.has(f) || Object.hasOwn(asked.seniorCommits, f))) {
      line.learned = "not added: no file it names was read for it";
      log(`didn't add what ${q.id}'s fork learned: none of the files it names was read for it ("${firstLine}")`);
      return null;
    }
    const files: FileWhatWasLearnedRestsOn[] = [];
    for (const rel of named) {
      if (files.length >= MAX_FILES_WHAT_WAS_LEARNED_RESTS_ON || files.some((x) => x.path === rel) || !AreaPathSchema.safeParse(rel).success) continue;
      const at = asked.reads.has(rel) ? commit : (asked.seniorCommits[rel] ?? index[rel]);
      files.push({ path: rel, ...(at && { commit: at }) });
    }
    const thing: ThingLearnedHere = { id: randomUUID(), text: learned, files, learnedAt: new Date(now()).toISOString(), generation: junior.n, firstLine };
    if (!files.length) {
      log(`what ${q.id}'s fork learned names no file the protocol takes, so it is added to its trunk only ("${firstLine}")`);
      return { thing, kept: false };
    }
    await whatWasLearned.keepBeforeAdding(thing);
    return { thing, kept: true };
  }

  // At start: what a fork learned that the runner stopped before adding to the junior's trunk.
  async function addWhatWaitedAtStart(things: ThingLearnedHere[]) {
    const j = gen("junior");
    if (!j || !things.length || !(await prepare())) return;
    log(`adds to generation ${j.n}'s trunk what ${things.length} of its forks learned before the runner stopped`);
    const commit = await checkout.head();
    await addToTrunk(j, things, {}, await changedSince(things), commit);
    whatWasLearned.additionEnded(things.map((t) => t.id));
  }

  // The proof: the new generation answers its owner's question on a fork, and the judge compares.
  async function prove(g: SavedGeneration, f: ExpertFile, s: ExpertSettings, commit: string, mine: number): Promise<boolean> {
    proving = true;
    changed();
    try {
      return await proveNow(g, f, s, commit, mine);
    } finally {
      proving = false;
    }
  }

  async function proveNow(g: SavedGeneration, f: ExpertFile, s: ExpertSettings, commit: string, mine: number): Promise<boolean> {
    // A migrating expert's new generation answers alone, so its proof asks no senior from before #340.
    const senior = migrating ? null : (gen("junior") ?? gen("senior"));
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
    // A judge that crashed or ran out of time judged nothing: the generation fails, but not its proof.
    if (!judged.ok) {
      failGeneration(g, `its proof's judge failed: ${judged.failure!.detail}`);
      return false;
    }
    const verdict = judged.turns.at(-1)?.text ?? "";
    // Its first line is the verdict: PASS as its first word, and no FAIL in it ("Pass? No: FAIL").
    const line = verdict.split(/\r?\n/)[0]!;
    const pass = /^\W*PASS\b/i.test(line) && !/\bFAIL\b/i.test(line);
    g.proof = { passed: pass, at: now() };
    say("proof", { generation: g.n, result: pass ? "pass" : "fail", expected: f.proof.answer, answer, judge: verdict });
    lastProofAnswer = pass ? null : answer;
    if (!pass) failGeneration(g, NOT_PASSED);
    else await save();
    return pass;
  }

  // The switch, under the exclusive hold: forks running finish on the generation before.
  async function promote(g: SavedGeneration, fp: string) {
    await lock.exclusive(async () => {
      if (migrating) return migrated(g, fp);
      const junior = gen("junior");
      const senior = gen("senior");
      if (junior) {
        if (senior) senior.state = "retired";
        junior.state = "senior";
      }
      g.state = "junior";
      saved.fingerprint = fp;
      retries = 0;
      promotionBlocked = false;
      // It carried what was learned elsewhere: questions no longer wait.
      catchingUp = false;
      await save();
      if (senior) discardIfDone(senior);
      if (junior) say("promotion", { junior: g.n, senior: junior.n, retired: senior ? senior.n : "none" });
      say("ready", { generation: g.n });
      log(`generation ${g.n} answers now`);
    });
  }

  // The first generation grounded since #340 passed: every one before it retires, its old trunk
  // with it, and state.json says it is version 3.
  async function migrated(g: SavedGeneration, fp: string) {
    const old = saved.generations.filter((x) => x !== g && (x.state === "junior" || x.state === "senior"));
    for (const x of old) {
      x.state = "retired";
      x.why = "a generation grounded since each computer keeps its own instance took over";
    }
    g.state = "junior";
    saved.fingerprint = fp;
    saved.version = 3;
    saved.setUpFromExpertRecord = true;
    migrating = false;
    retries = 0;
    promotionBlocked = false;
    catchingUp = false;
    await save();
    for (const x of old) discardIfDone(x);
    say("promotion", { junior: g.n, senior: "none", retired: old.length ? old.map((x) => x.n).join(",") : "none" });
    say("ready", { generation: g.n });
    log(`generation ${g.n} answers now; the generations from before each computer kept its own instance retire`);
  }

  function checkPromotion() {
    const j = gen("junior");
    if (!j || groundingRun || promotionBlocked || stopped) return;
    const added = j.addedToItsTrunk.length + (j.addedBeforeEachHadAnId ?? 0);
    if (j.meter < file.promoteAtTokens || added < 1) return;
    log(`generation ${j.n} is at ${j.meter} tokens with ${added} things learned added to its trunk, so a new generation grounds`);
    void ground();
  }

  // Where a fork reads `g`'s trunk up to: the uuid the runner recorded after its last turn on it
  // (D18), so an addition running meanwhile isn't read; null to resume the whole trunk, once additions
  // have ended, when none is recorded or this Claude Code doesn't take it.
  const forkAt = (g: SavedGeneration) => (noResumeAt || typeof g.last !== "string" ? null : g.last);

  // A fork that failed because this Claude Code doesn't take `--resume-session-at`: from now on forks wait for additions instead.
  function resumeAtRefused(c: Conversation, at: string | null): boolean {
    if (c.ok || at === null || !refusedResumeAt(c.failure!.detail)) return false;
    noResumeAt = true;
    log("this Claude Code doesn't take --resume-session-at, so from now on its forks wait for additions to the junior's trunk to end");
    return true;
  }

  /**
   * One question on a fork of `junior`, asking `senior` when its reply asks: the junior's final reply.
   * With `carries`, its question carries what the junior hasn't picked up of what was learned
   * elsewhere (D7): git is asked about their files first, at no token cost.
   */
  async function askFork(a: { junior: SavedGeneration; senior: SavedGeneration | null; question: string; id: string; deadline: number; commit: string; kids: Set<ChildProcessWithoutNullStreams>; onSenior?: () => void; carries?: boolean }): Promise<Asked> {
    const p = await loadExpertPrompts(o.appDir);
    const changedFiles = await checkout.changed(await indexOf(a.junior.n));
    // Git is asked first about what may be carried: what the junior hasn't picked up, and what is being added to its trunk.
    const changed = a.carries ? await changedSince([...whatWasLearned.notPickedUp(a.junior).things, ...(forkAt(a.junior) !== null ? additions.beingAdded(a.junior.trunk) : [])]) : new Map<string, ReadonlySet<string>>();
    let usage = zero();
    let asks = 0;
    let askedSenior = false;
    const seniorCommits: Record<string, string> = {};
    const next = async (turn: TurnResult): Promise<string | null> => {
      const asked = parseReply(turn.text).askSenior;
      if (asked === null) return null;
      asks++;
      if (!a.senior) return asks === 1 ? NO_SENIOR : null;
      if (asks === 3) return ANSWER_NOW;
      if (asks > 3) return null;
      if (!askedSenior) a.onSenior?.();
      askedSenior = true;
      const said = await askSenior(a.senior, asked, a.deadline, a.commit, a.kids, p);
      usage = add(usage, said.usage);
      if (!said.answer) return SENIOR_FAILED;
      Object.assign(seniorCommits, said.commits);
      return fill(p.seniorAnswer, { answer: said.answer, cited: said.cited });
    };
    // A fork that can't read the trunk as it was waits for an addition running to end, so the addition is in its trunk.
    if (a.junior.state === "junior" && forkAt(a.junior) === null) await gate.opened();
    // From here to the fork's question, no await: where it reads the trunk from and what it carries are one moment's.
    // D17 is judged again in it, so a catch-up that came in one message since the question did isn't cut to fit.
    if (a.carries) beforeQuestion();
    if (a.carries && catchingUp) return { failure: null, why: "", text: "", usage, reads: new Set(), explored: false, askedSenior, seniorCommits, carry: { things: [], upTo: {}, changed }, catchingUp: true };
    const at = forkAt(a.junior);
    const carry = a.carries ? carryNow(a.junior, at !== null, changed) : { things: [], upTo: {}, changed };
    const learnedElsewhere = carry.things.length ? fill(p.learnedElsewhere, { items: thingsText(carry.things, (t) => filesChangedSince(t, changed)) }) + "\n\n" : "";
    const first = fill(p.question, { id: a.id, role: a.senior ? p.roleJunior : p.roleFirst, freshness: freshnessText(changedFiles), removed: removedText(a.junior, p), learnedElsewhere, question: a.question });
    if (carry.things.length) log(`question ${a.id}: carried ${carry.things.length} thing${carry.things.length === 1 ? "" : "s"} learned elsewhere`);
    const c = await run(expertForkArgs(a.junior.trunk, a.junior.model, at), readDir, a.junior.trunk, first, next, Math.max(1, a.deadline - now()), {}, a.kids);
    if (resumeAtRefused(c, at)) return askFork(a);
    usage = add(usage, c.usage);
    const text = c.turns.at(-1)?.text ?? "";
    const base = { usage, reads: c.reads, explored: c.explored, askedSenior, seniorCommits, carry, text };
    if (!c.ok) return { ...base, failure: c.failure!, why: c.failure!.detail };
    if (parseReply(text).askSenior !== null) return { ...base, failure: { kind: "failed", detail: KEPT_ASKING }, why: KEPT_ASKING };
    return { ...base, failure: null, why: "" };
  }

  // A fork of the senior for the junior's question: its answer, and its citations with their commits, marked where they changed since.
  async function askSenior(senior: SavedGeneration, question: string, deadline: number, commit: string, kids: Set<ChildProcessWithoutNullStreams>, p: Prompts): Promise<{ answer: string | null; cited: string; commits: Record<string, string>; usage: Usage }> {
    if (!(await trusted(senior))) return { answer: null, cited: "", commits: {}, usage: zero() };
    const index = await indexOf(senior.n);
    const first = fill(p.question, { id: "for your junior", role: p.roleSenior, freshness: freshnessText(await checkout.changed(index)), removed: removedText(senior, p), learnedElsewhere: "", question });
    let refused = false;
    const at = forkAt(senior);
    const c = await run(expertForkArgs(senior.trunk, senior.model, at), readDir, senior.trunk, first, (turn) => (!refused && parseReply(turn.text).askSenior !== null ? ((refused = true), NO_SENIOR) : null), Math.max(1, deadline - now()), {}, kids);
    if (resumeAtRefused(c, at)) return askSenior(senior, question, deadline, commit, kids, p);
    if (!c.ok) {
      log(`its senior, generation ${senior.n}, couldn't answer: ${c.failure!.detail}`);
      if (c.failure!.kind === "compacted" || c.failure!.kind === "disallowed") brokeGeneration(senior, c.failure!.detail);
      return { answer: null, cited: "", commits: {}, usage: c.usage };
    }
    const r = parseReply(c.turns.at(-1)?.text ?? "");
    const answer = (r.answer ?? c.turns.at(-1)?.text ?? "").trim();
    const withCommits = withCommitsRead(await existing(r.cited, r.dropped), c.reads, {}, index, commit);
    const commits = Object.fromEntries(withCommits.flatMap((x) => (x.commit ? [[x.file, x.commit]] : [])));
    const since = await checkout.changed(Object.fromEntries(Object.entries(commits).filter(([, c]) => c !== commit)));
    const cited = withCommits.map((x) => `- ${x.cited} (${x.commit === null ? "commit unknown" : `read at ${short(x.commit)}${since.has(x.file) ? ", changed since: re-read it before relying on it" : ""}`})`).join("\n");
    return { answer: answer || null, cited: cited || "none", commits, usage: c.usage };
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

  const notYet = (detail: string): InstanceOutcome => ({ kind: "not-yet", detail });
  const forkFailed = (detail: string): InstanceOutcome => ({ kind: "refused", code: "EXPERT_FORK_FAILED", detail });
  const unknown = (): InstanceOutcome => ({ kind: "refused", code: "EXPERT_UNKNOWN", detail: `this computer has no instance of the expert ${name} now` });

  function remember(qid: string, outcome: InstanceOutcome) {
    finished.delete(qid);
    finished.set(qid, outcome);
    if (finished.size <= REMEMBER) return;
    finished.delete(finished.keys().next().value!);
  }

  /** Tells `q` how it went; `not-yet` isn't remembered, so asked again it runs. */
  function deliver(q: Question, outcome: InstanceOutcome) {
    const out = stopped ? unknown() : outcome;
    if (out.kind !== "not-yet") remember(q.id, out);
    q.onOutcome(out);
  }

  // Until there is a junior, and while it is catching up, bounded by the grounding's time limit. A
  // checkout that couldn't be prepared (offline, say) is tried again, once a question.
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
      if (st !== "starting" && !(st === "ready" && catchingUp)) return st;
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
    const line = { id: q.id, blocking: q.blocking, ms: 0, cost: 0, outcome: "failed", senior: "no", explored: "no", learned: "none" };
    const failed = (cause: string, refusal: InstanceOutcome) => {
      say("error", { id: q.id, cause });
      deliver(q, refusal);
    };
    try {
      let ready = await whenReady();
      // A junior whose trunk was changed by hand is retired and a new one grounds: the question waits for it.
      while (ready === "ready" && !(await trusted(gen("junior")!))) ready = await whenReady();
      // A catch-up still coming in pages is waited for before what it brings is judged against the limit.
      if (ready === "ready" && whatWasLearned.catchingUpInPages()) {
        await whatWasLearned.caughtUp(CAUGHT_UP_FOR_A_QUESTION_MS);
        beforeQuestion();
        if (catchingUp) ready = await whenReady();
      }
      if (ready === "stopped") return deliver(q, unknown());
      if (ready === "failed") {
        const why = { proof: "the expert's grounding didn't pass its proof question", checkout: "the expert's checkout of its repo couldn't be prepared", other: "the expert's last grounding failed; its host's health log for it says why" }[lastFailure];
        return failed(why, forkFailed(why));
      }
      // Still grounding: not yet, so it isn't remembered, and its asker asks again.
      if (ready === "timeout") {
        say("error", { id: q.id, cause: catchingUp ? "it is catching up on what its other instances learned" : "it is still grounding" });
        return deliver(q, notYet(catchingUp ? CATCHING_UP : "the expert is still grounding its first junior"));
      }

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
        return deliver(q, { kind: "refused", code: "EXPERT_CAP", detail: `${EXPERT_CAP_WORDS[cap.cap]} of ${cap.limit} reached on this computer`, cap: cap.cap, limit: cap.limit, ...(cap.frees !== undefined && { frees: cap.frees }) });
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
            // Not yet, so it isn't remembered: a checkout waiting to be reset, a junior catching up (its
            // new generation takes the question), or a junior whose trunk was changed while the question
            // waited (retired now; a new one grounds), isn't forked.
            const notNow = resetPending ? "the expert's checkout is being reset" : catchingUp ? CATCHING_UP : !(await trusted(junior)) ? "the expert's junior is being replaced" : null;
            if (notNow) {
              await reservation.cancel();
              say("error", { id: q.id, cause: notNow });
              return deliver(q, notYet(notNow));
            }
            // The fork's time limit counts from here, not from when the question came: a question
            // held while the expert started, or queued for a slot or the checkout, isn't cut short.
            const deadline = now() + file.forkTimeLimitMinutes * minute;
            const senior = gen("senior");
            const commit = await checkout.head();
            const kids = new Set<ChildProcessWithoutNullStreams>();
            const asked = await askFork({ junior, senior, question: q.text, id: q.id, deadline, commit, kids, onSenior: () => q.onSenior?.(), carries: true });
            for (const kid of kids) killTree(kid);
            freeSlot();
            if (asked.catchingUp) {
              await reservation.cancel();
              say("error", { id: q.id, cause: CATCHING_UP });
              return deliver(q, notYet(CATCHING_UP));
            }
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
            const withCommits = withCommitsRead(await existing(cited, r.dropped), asked.reads, asked.seniorCommits, index, commit, toldCommits(asked.carry.things));
            const newer = withCommits.filter((x) => x.commit !== null && index[x.file] !== x.commit);
            if (newer.length) {
              for (const x of newer) index[x.file] = x.commit!;
              await saveIndex(junior.n, index);
            }
            const since = await checkout.changed(Object.fromEntries(withCommits.flatMap((x) => (x.commit && x.commit !== commit ? [[x.file, x.commit]] : []))));
            const answer = answerText(body, citationBlock(withCommits, saved.branch, commit, since));
            const matched = await o.scan(answer);
            if (matched) {
              // Refused, never held: an expert runs on its own, so no person would release it.
              log(`refused its answer to ${q.id}: it matches the secret pattern "${matched}"`);
              line.outcome = "secret";
              deliver(q, forkFailed("its answer looked like it held a secret, so it wasn't sent"));
            } else {
              line.outcome = "answered";
              deliver(q, { kind: "answered", answer, commit, branch: saved.branch });
            }

            // What its fork learned, and what its question carried, join the junior's trunk in one addition turn.
            const own = r.learned && (asked.askedSenior || asked.explored) ? await keepWhatItLearned(q, r.learned, asked, index, commit, junior, line) : null;
            const adding = [...asked.carry.things, ...(own ? [own.thing] : [])];
            if (!adding.length) {
              moveUpTo(junior, asked.carry.upTo);
              await save();
            } else {
              const changedNow = own ? new Map([...asked.carry.changed, ...(await changedSince([own.thing]))]) : asked.carry.changed;
              const added = await addToTrunk(junior, adding, asked.carry.upTo, changedNow, commit);
              // Read before its addition is said to have ended, which lets a thing kept here only go.
              const staying = !!own?.kept && whatWasLearned.staying(own.thing.id);
              if (own?.kept) whatWasLearned.additionEnded([own.thing.id]);
              if (own && added && junior.addedToItsTrunk.some((x) => x.id === own.thing.id)) {
                line.learned = staying ? "kept here only" : "added";
                log(`added what ${q.id}'s fork learned to generation ${junior.n}'s trunk: ${own.thing.id}, "${own.thing.firstLine}"`);
              }
            }
          });
        } finally {
          freeSlot();
        }
      } finally {
        inFlight.delete(q);
        // A grounding holding the checkout isn't waited for: it is reset once the grounding lets go.
        if (resetting && holding > 0) resetPending = true;
        else if (resetting) await lock.exclusive(() => checkout.reset()).catch((err: Error) => log(`couldn't reset its checkout: ${err.message}`));
        checkPromotion();
      }
    } finally {
      line.ms = now() - started;
      say("question", line);
    }
  }

  // A new repo: the old repo's clone and generations go, and it grounds from scratch.
  async function reset(oldRepo: string, generations: SavedGeneration[]) {
    epoch++;
    killAll();
    clearRetry();
    // The old repo's own checkout: after a restart `checkout` is already the new repo's.
    const old = makeCheckout(oldRepo);
    log(`its repo changed from ${oldRepo} to ${file.repo}, so it starts again`);
    await lock.exclusive(async () => {
      await old.remove().catch((err: Error) => log(`couldn't remove its clone of ${oldRepo}: ${err.message}`));
      // Numbers start again at 1, so the old indexes go before any new one is written.
      for (const g of generations) if (!discarded.has(g.trunk)) (discarded.add(g.trunk), await discard(g));
    });
    saved = { version: 3, setUpFromExpertRecord: true, fingerprint: "", repo: file.repo, branch: "", generations: [] };
    migrating = false;
    catchingUp = false;
    indexes.clear();
    await save();
    checkout = makeCheckout(file.repo);
    preparing = null;
    prepared = false;
    lastFailed = false;
    promotionBlocked = false;
    retries = 0;
    resetPending = false;
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

  // Whether every user turn after `after` (from the start when null) in a trunk's transcript is one
  // of `ours`. Tool results and Claude Code's own entries (isMeta, a subagent's) are user entries too.
  async function onlyOurs(trunk: string, after: string | null, ours: string[]): Promise<boolean> {
    const file = await transcriptOf(trunk);
    const entries = (file ? await fs.readFile(file, "utf8").catch(() => "") : "").split("\n").flatMap((l) => {
      try {
        return [JSON.parse(l) as { type?: unknown; uuid?: unknown; isMeta?: unknown; isSidechain?: unknown; message?: { content?: unknown } }];
      } catch {
        return []; // a blank line, or one still being written
      }
    });
    const from = after === null ? 0 : entries.findIndex((e) => e.uuid === after) + 1;
    if (from === 0 && after !== null) return false;
    const wanted = new Set(ours.map((t) => t.trim()));
    return entries.slice(from).every((e) => {
      if (e.type !== "user" || e.isMeta === true || e.isSidechain === true) return true;
      const content = e.message?.content;
      const blocks = typeof content === "string" ? [{ type: "text", text: content }] : Array.isArray(content) ? (content as { type?: unknown; text?: unknown }[]) : [];
      if (blocks.some((b) => b?.type === "tool_result")) return true;
      return wanted.has(blocks.map((b) => (b?.type === "text" && typeof b.text === "string" ? b.text : "")).join("").trim());
    });
  }

  /** Whether a junior's or senior's trunk is as the runner left it; one that isn't is taken out of use. */
  async function trusted(g: SavedGeneration): Promise<boolean> {
    const started = appendsStarted;
    const last = await lastTurn(g.trunk);
    // Stopped meanwhile: it changes nothing (an expert started after it may hold its folder), and its callers stop on their own.
    if (stopped) return true;
    // A generation from before the runner recorded this: its transcript as it is now is taken as its own.
    if (g.last === undefined) {
      g.last = last;
      void save();
      return true;
    }
    if (last === g.last || appending > 0 || appendsStarted !== started) return true;
    retireChanged(g);
    return false;
  }

  // A junior or senior whose trunk was changed outside Isoplan is retired; a junior's is replaced.
  function retireChanged(g: SavedGeneration) {
    if (g.state !== "junior" && g.state !== "senior") return;
    const wasJunior = g.state === "junior";
    g.state = "retired";
    g.why = "its trunk was changed outside Isoplan";
    say("generation", { generation: g.n, state: "retired", why: g.why });
    log(`generation ${g.n}'s trunk was changed outside Isoplan (resumed by hand, say), so it isn't used again${wasJunior ? ", and a new generation grounds" : ""}`);
    void save();
    discardIfDone(g);
    changed();
    if (wasJunior && !stopped) void ground();
  }

  // D17 and removal, before a question, from what is in memory: a new generation starts only while
  // promotion isn't blocked and no try again is timed (ground() checks neither). Meanwhile the junior's
  // forks carry the newest within the limit, and are told of what was removed.
  function beforeQuestion() {
    const j = gen("junior");
    if (!j || stopped) return;
    const mayStart = !promotionBlocked && !retryTimer;
    const { things } = whatWasLearned.notPickedUp(j);
    const tokens = tokensOfAll(things);
    if (tokens > limitOf(file)) {
      if (!mayStart) return;
      if (!catchingUp) log(`${things.length} things learned on other computers, about ${tokens} tokens, are more than one question carries (${limitOf(file)}), so its questions wait for a new generation that carries them`);
      catchingUp = true;
      if (!groundingRun) void ground("more was learned on other computers than one question can carry");
      return;
    }
    const removed = whatWasLearned.removed();
    if (mayStart && !groundingRun && j.addedToItsTrunk.some((x) => removed.has(x.id))) void ground("something it holds was removed on the expert's card");
  }

  return {
    hosted,
    async start() {
      ledger = await openLedger(path.join(o.dir, "ledger.json"));
      await whatWasLearned.load();
      const was = await readState(o.dir);
      // Stopped while it started (its file removed again at once): it does nothing more, so an expert
      // started after it is the only one that writes its folder.
      if (stopped) return;
      // A record's sequence rebuilt (a restored office server): each generation carries only what is
      // new to it. Told from the moment its state is read, with no await before `saved` holds it, in
      // place of an expert stopped before it on this key, so two never write state.json.
      whatWasLearned.onRebuilt((expertRecordId, pickedUpTo) => {
        for (const g of saved.generations) {
          if (g.state !== "junior" && g.state !== "senior" && g.state !== "grounding") continue;
          g.pickedUpTo[expertRecordId] = pickedUpTo(g.pickedUpTo[expertRecordId] ?? 0, new Set(g.addedToItsTrunk.map((x) => x.id)));
        }
        void save();
      });
      if (was && was.repo !== file.repo) {
        for (const g of was.generations) o.onTrunk?.(g.trunk);
        changed();
        void reset(was.repo, was.generations);
        return;
      }
      if (was) {
        saved = was;
        migrating = was.version === 1 && was.generations.some((g) => g.state === "junior" || g.state === "senior");
        if (was.version === 1 && !migrating) Object.assign(saved, { version: 3, setUpFromExpertRecord: true });
        for (const g of saved.generations) {
          o.onTrunk?.(g.trunk);
          if (g.state === "grounding") failGeneration(g, "the runner stopped during its grounding");
        }
        const junior = gen("junior");
        const transcript = junior ? await transcriptOf(junior.trunk) : null;
        if (stopped) return;
        if (junior && !transcript) failGeneration(junior, "its trunk's transcript is gone");
        for (const g of [gen("junior"), gen("senior")]) if (g) await trusted(g);
        if (stopped) return;
      }
      changed();
      // A junior from before answers at once; the checkout is prepared beside it, so its questions fetch.
      // One from before #340 answers while a new generation grounds to take over from it.
      if (migrating) log("its state is from before each computer kept its own instance, so a new generation grounds to take over from its old ones");
      // What its forks learned that the runner stopped before adding to the junior's trunk is added now.
      const junior = gen("junior");
      const waited = whatWasLearned.toAddAtStart(junior?.n ?? null, new Set(junior?.addedToItsTrunk.map((x) => x.id) ?? []));
      if (!gen("junior") || saved.fingerprint !== fingerprint(file) || migrating) void ground();
      else void prepare().then(checkPromotion);
      if (waited.length) void addWhatWaitedAtStart(waited).catch((err: Error) => log(`couldn't add what its forks learned before the runner stopped: ${err.message}`));
    },
    update(f) {
      const old = file;
      file = f;
      if (f.repo !== old.repo) return void reset(old.repo, saved.generations);
      promotionBlocked = false;
      clearRetry();
      retries = 0;
      changed();
      if (fingerprint(f) !== saved.fingerprint) void ground();
      else checkPromotion();
    },
    answer(question, onOutcome, onSenior) {
      const running = questions.get(question.id);
      if (running) {
        running.onOutcome = onOutcome;
        running.onSenior = onSenior;
        return;
      }
      const done = finished.get(question.id);
      if (done) return onOutcome(done);
      const q: Question = { id: question.id, asker: question.asker, blocking: question.blocking, text: question.question, onOutcome, onSenior };
      questions.set(q.id, q);
      void handle(q)
        .catch((err: unknown) => {
          log(`question ${q.id}: the runner failed: ${(err as Error)?.stack ?? String(err)}`);
          if (!finished.has(q.id)) deliver(q, forkFailed("the runner failed"));
        })
        .finally(() => questions.delete(q.id));
    },
    beforeQuestion,
    catchingUp: () => catchingUp,
    retryNow() {
      if (stopped) return;
      clearRetry();
      retries = 0;
      promotionBlocked = false;
      log("asked to try its grounding again now");
      void ground();
    },
    idle: () => busy === 0 && !groundingRun && questions.size === 0,
    stop() {
      stopped = true;
      epoch++;
      clearRetry();
      killAll();
      for (const wake of [...waiters]) wake();
    },
    async remove() {
      whatWasLearned.forget();
      stopped = true;
      epoch++;
      clearRetry();
      killAll();
      for (const wake of [...waiters]) wake();
      for (const g of saved.generations) {
        if (g.state === "junior" || g.state === "senior" || g.state === "grounding") Object.assign(g, { state: "retired", why: "its expert was deleted" });
      }
      // Once its processes have ended, so none of them holds a file.
      for (let waited = 0; children.size && waited < 5000; waited += 50) await new Promise((r) => setTimeout(r, 50));
      for (const g of saved.generations) if (!discarded.has(g.trunk)) (discarded.add(g.trunk), await discard(g));
      await saving;
      await fs.rm(readDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch((err: Error) => log(`couldn't delete its clone: ${err.message}`));
      await fs.rm(o.dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch((err: Error) => log(`couldn't delete its folder: ${err.message}`));
      log("deleted, with its trunks, its clone and its folder, as its expert was deleted");
    },
    close() {
      stopped = true;
      clearRetry();
      killAll();
    },
  };
}
