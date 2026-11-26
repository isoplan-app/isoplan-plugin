// One employee's trunk on its owner's computer (isoplan-app#341): its generations, their grounding,
// its runs as forks of its newest generation, and what it learns from its owner's corrections.
//
// - A generation is a trunk grounded in the employee's read clone of its project (expert-checkout.ts,
//   as an expert's), with the run's flags (employee-claude.ts), so every trunk turn and run has the
//   same tool definitions. Turn 1: prompts/employee-grounding.md, the job's brief and rules and the
//   experts it may ask; turn 2: prompts/employee-read.md, its documents and examples to read now;
//   turn 3, when its record holds things it learned (received back through #366, say after its folder
//   was lost): prompts/employee-grounding-what-it-learned.md, within its room. The meter, the room
//   below promoteAtTokens, a compaction, a disallowed tool, Isoplan's tools not connecting and a turn
//   cut short fail it as they fail an expert's; three tries spaced as an expert's, then failed, and
//   its owner's Try again grounds it again now (`retryNow`).
// - No proof question: its owner judges every draft. A grounded generation is its newest at once
//   (`junior` in state.json, as expert-state.ts names it) and takes the runs; the one before it
//   retires once no process of it runs. No senior.
// - A new generation grounds before the next run, never during one (`readyForARun`): the job's
//   fingerprint changed (employee-file.ts), a thing its trunk holds was removed on its card, its
//   transcript changed outside Isoplan, or past promoteAtTokens with at least one thing added.
// - A run is a fork of the newest generation at the uuid recorded after its last turn (D18), so an
//   addition running meanwhile isn't read; its usage and every grounding's, correction fork's and
//   addition's go in the employee's ledger.
// - Corrections (`learnFromCorrections`): a fork with prompts/employee-correction.md writes each thing
//   it now knows as a <learned> block, a rule for every draft, never a person or an address; each goes
//   to the waiting file first (#366's A3), with no files, then one addition turn adds them all to the
//   trunk, then what-was-learned-link.ts sends them to its record after both checks.
// - Its processes are recorded as forks of its trunk (`track`), each with an MCP config of its own,
//   written before it starts and deleted as it ends (employees/<key>/mcp/<process>.json).

import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { DEFAULT_LEARNED_ELSEWHERE_TOKENS_PER_QUESTION, MAX_WHAT_WAS_LEARNED_LENGTH } from "@isoplan/protocol";
import type { Usage } from "./answerer.js";
import { weighted, type CapSettings, type Ledger } from "./caps.js";
import { claudeCommand } from "./claude-binary.js";
import { forkEnv, hiddenSpawn, killTree, type Spawn, type Track } from "./claude.js";
import { employeeAppendArgs, employeeDisallowed, employeeForkArgs, employeeTrunkArgs, ASK_EXPERT_TOOL, ISOPLAN_MCP_SERVER, LEAVE_DRAFT_TOOL, mcpConfigText, mcpToolTimeout, TOOLS_DIDNT_CONNECT } from "./employee-claude.js";
import { jobFingerprint, type EmployeeFile } from "./employee-file.js";
import type { EmployeeToolHandlers, EmployeeTools } from "./employee-tools.js";
import { createExpertCheckout, type ExpertCheckout } from "./expert-checkout.js";
import { converse, type Conversation, type ConversationFailure, type ConverseOptions, type TurnResult } from "./expert-claude.js";
import type { HealthLog } from "./expert-health.js";
import { createCheckoutLock } from "./expert-lock.js";
import { meterOf, ROOM_FOR_THINGS_LEARNED, roomForWhatWasLearnedProblem, thresholdProblem, TOKENS_PER_THING_LEARNED, windowFor } from "./expert-meter.js";
import { readIndex, readState, writeIndex, writeState, type SavedExpert, type SavedGeneration } from "./expert-state.js";
import { createTrunkAdditions } from "./expert-trunk-additions.js";
import { freshnessText } from "./expert.js";
import type { RunGit } from "../handoff/git.js";
import { fill } from "./prompts.js";
import { createTrunkTranscripts } from "./trunk-transcript.js";
import { firstLineOf, type ThingToCarry, type WhatWasLearnedForOneExpert } from "./what-was-learned-for-one-expert.js";
import { tokensOfAll } from "./what-was-learned-in-a-question.js";
import type { ThingLearnedHere } from "./what-was-learned-waiting-to-be-sent.js";

/** runner.json's `employees` block. */
export interface EmployeesSettings {
  promoteAtTokens: number;
  runContextTokens: number;
  runMinutes: number;
  dayMinutes: number;
  runTokens: number;
  dayTokens: number;
  draftsPerRun: number;
  draftsWaitHours: number;
  tryAgainAfterMinutes: number;
  expertAnswerWaitMinutes: number;
  whoWasContacted: string;
  whoWasContactedPushTries: number;
  offerAfter: { daysOfTheLastSeven: number; weeksRunning: number };
  jobFromSessionsModel: string;
  jobFromSessionsTimeoutSeconds: number;
  /** The newest sessions a job is written from. */
  sessionsAJobIsWrittenFrom: number;
  /** How long after no job could be written from sessions, or one didn't pass its check, it is tried again. */
  jobFromSessionsTriedAgainAfterHours: number;
  rememberStartsDays: number;
  /** The most rejections one fork learns from. */
  correctionsLearnedAtOnce: number;
  /** How long making one from the floor waits for its experts' set-ups, then for its grounding and publish. */
  makingWaitMinutes: number;
}

export type EmployeeSettings = CapSettings & { employees: EmployeesSettings };

/** The room its usage goes under in its ledger. */
export const EMPLOYEE_ROOM = "employee";
// The minutes before each try again of a grounding that keeps failing, as an expert's.
const RETRY_MINUTES = [10, 30, 90];
const GROUNDING_MINUTES = 15;
const TURN_MINUTES = 10;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const GROUNDING_FILE_MAX = 100_000;

const NOT_A_RUN_EXPERT = "Not now: you are only reading, and this isn't a run of your job.";
const NOT_A_RUN_DRAFT = "Not now: this isn't a run of your job, so leave no draft.";

export interface EmployeeTrunkOptions {
  key: string;
  /** Its job file as it is now. */
  file: () => EmployeeFile;
  /** employees/<key>: state, indexes, MCP configs. */
  dir: string;
  /** Its read clone. */
  read: string;
  health: HealthLog;
  projectsDir: string;
  appDir: string;
  binary: () => Promise<string | null>;
  settings: () => Promise<EmployeeSettings>;
  git: RunGit;
  gitTimeoutMs: () => Promise<number>;
  spawn?: Spawn;
  env?: Record<string, string | undefined>;
  track?: Track;
  log: (text: string) => void;
  onChange: () => void;
  onTrunk: (trunk: string) => void;
  whatWasLearned: WhatWasLearnedForOneExpert;
  tools: Pick<EmployeeTools, "open">;
  /** The job's experts, as the directory has them: their subjects for its grounding. */
  experts: () => { key: string; subject: string }[];
  ledger: Ledger;
  now?: () => number;
  minuteMs?: number;
  /** Whether its read clone may be cloned from an origin that isn't on the wire: tests' local origins. */
  cloneFrom?: (remote: string) => boolean;
}

/** How its trunk stands, as the listing says it. */
export type TrunkState = { state: "setting-up" } | { state: "ready"; groundingTokens?: number } | { state: "failed"; why: "clone" | "other"; detail: string };

export interface RunFork {
  prompt: string;
  timeoutMs: number;
  handlers: EmployeeToolHandlers;
  onUsage: (sofar: Usage, context: number) => string | null;
}

export interface EmployeeTrunk {
  start(): Promise<void>;
  state(): TrunkState;
  /** A new generation, when one is due, starts now; whether one is ready to run now. */
  readyForARun(): Promise<boolean>;
  /** Fetches origin's default branch and moves the read clone to it, under the checkout's exclusive hold; why not, when it couldn't. */
  refresh(): Promise<string | null>;
  /** The read clone's folder. */
  readFolder(): string;
  /** One run on a fork of its newest generation. */
  run(r: RunFork): Promise<Conversation>;
  /** What changed in the checkout since its newest generation read it, for the run's prompt. */
  freshness(): Promise<string>;
  /** Corrections into what it learned: `learned`, `none` (no block), or `failed`; `waiting` while it can't now. */
  learnFromCorrections(corrections: { correction: string; text: string; at: string }[]): Promise<"learned" | "none" | "failed" | "waiting">;
  /** Its job file changed. */
  update(): void;
  retryNow(): void;
  idle(): boolean;
  isTrunk(id: string): boolean;
  stop(): void;
  remove(): Promise<void>;
  close(): void;
}

export async function loadEmployeePrompt(appDir: string, name: string): Promise<string> {
  return (await fs.readFile(path.join(appDir, "prompts", `${name}.md`), "utf8")).trim();
}

/** A trunk's transcript under ~/.claude/projects, and its folder of tool results, deleted. */
async function removeTranscript(transcripts: ReturnType<typeof createTrunkTranscripts>, trunk: string) {
  if (!UUID.test(trunk)) return;
  const transcript = await transcripts.transcriptOf(trunk);
  transcripts.forget(trunk);
  if (!transcript) return;
  await fs.rm(transcript, { force: true, maxRetries: 5, retryDelay: 200 }).catch(() => {});
  await fs.rm(path.join(path.dirname(transcript), trunk), { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(() => {});
}

/** Every generation's transcript its state names, deleted: an employee deleted with no trunk here, since its job file was gone. */
export async function removeTrunkTranscripts(dir: string, projectsDir: string): Promise<void> {
  const transcripts = createTrunkTranscripts(projectsDir);
  for (const g of (await readState(dir))?.generations ?? []) await removeTranscript(transcripts, g.trunk);
}

const list = (lines: readonly string[]) => (lines.length ? lines.map((x) => `- ${x}`).join("\n") : "none");

export function createEmployeeTrunk(o: EmployeeTrunkOptions): EmployeeTrunk {
  const now = o.now ?? Date.now;
  const minute = o.minuteMs ?? 60000;
  const spawn = o.spawn ?? hiddenSpawn;
  const env = o.env ?? process.env;
  const key = o.key;
  const log = (text: string) => o.log(`employee ${key}: ${text}`);
  const say = o.health.say;
  const lock = createCheckoutLock();
  const additions = createTrunkAdditions<ThingToCarry>(log);
  const transcripts = createTrunkTranscripts(o.projectsDir);
  const children = new Set<ChildProcessWithoutNullStreams>();
  const live = new Map<string, number>();
  const trunks = new Set<string>();
  const discarded = new Set<string>();
  const indexes = new Map<number, Record<string, string>>();

  let saved: SavedExpert = { version: 3, fingerprint: "", repo: o.file().repo, branch: "", generations: [] };
  let checkout = makeCheckout();
  let prepared: Promise<boolean> | null = null;
  let grounding: Promise<void> | null = null;
  let lastFailure: { why: "clone" | "other"; detail: string } | null = null;
  let retries = 0;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  // A new generation for promotion or a removal failed: the newest one goes on running until a Try again or its file changes.
  let blocked = false;
  let busy = 0;
  let appending = 0;
  let stopped = false;
  let saving: Promise<void> = Promise.resolve();
  let lastState = "";

  function makeCheckout() {
    return createExpertCheckout({ git: o.git, repo: o.file().repo, dir: o.dir, read: o.read, name: key, timeoutMs: o.gitTimeoutMs, log, fetchSeconds: () => 0, now, onFetchFailed: (why) => say("fetch", { error: why }), ...(o.cloneFrom && { cloneFrom: o.cloneFrom }) });
  }

  const junior = () => saved.generations.find((g) => g.state === "junior") ?? null;
  const fingerprintNow = () => jobFingerprint(o.file());
  const state = (): TrunkState => {
    const j = junior();
    if (j && saved.fingerprint === fingerprintNow()) return { state: "ready", ...((j.groundingTokens ?? 0) > 0 && { groundingTokens: j.groundingTokens }) };
    if (!grounding && lastFailure && !retryTimer) return { state: "failed", ...lastFailure };
    return { state: "setting-up" };
  };
  const changed = () => {
    const text = JSON.stringify(state());
    if (text === lastState) return;
    lastState = text;
    o.onChange();
  };
  const save = () => {
    const copy = structuredClone(saved);
    saving = saving.then(() => writeState(o.dir, copy)).catch((err: Error) => log(`couldn't write its state: ${err.message}`));
    return saving;
  };
  const spent = (usage: Usage) => {
    if (usage.input + usage.output + usage.cacheRead + usage.cacheWrite > 0) void o.ledger.reserve({ at: now(), room: EMPLOYEE_ROOM, usage }).settle(usage).catch(() => {});
  };
  const prepare = () =>
    (prepared ??= checkout.prepare().then(
      ({ branch }) => ((saved.branch = branch), true),
      (err: Error) => {
        prepared = null;
        lastFailure = { why: "clone", detail: `its checkout couldn't be prepared: ${err.message}` };
        log(lastFailure.detail);
        return false;
      },
    ));

  /** One claude process to the end of its conversation, with its own MCP config and tools. */
  async function runClaude(args: (config: string) => string[], trunk: string, first: string, next: (turn: TurnResult) => string | null | Promise<string | null>, timeoutMs: number, handlers: EmployeeToolHandlers, more: Pick<ConverseOptions, "check" | "onUsage"> = {}): Promise<Conversation> {
    const failed = (kind: ConversationFailure["kind"], detail: string): Conversation => ({ ok: false, turns: [], usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, reads: new Set(), explored: false, compacted: false, failure: { kind, detail } });
    const bin = await o.binary();
    if (!bin) return failed("no-claude", "the claude binary wasn't found; run the plugin's install script, or set its path in ~/.claude/isoplan/claude-binary.json");
    if (stopped) return failed("failed", "the employee was stopped");
    const job = o.file().job;
    const s = await o.settings();
    const tools = o.tools.open(key, job.experts, handlers);
    const id = randomUUID();
    const config = path.join(o.dir, "mcp", `${id}.json`);
    await fs.mkdir(path.dirname(config), { recursive: true });
    await fs.writeFile(config, mcpConfigText(tools.url, tools.token));
    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawn([...claudeCommand(bin), ...args(config)], { cwd: o.read, env: { ...forkEnv(env), CLAUDE_CODE_DISABLE_BACKGROUND_TASKS: "1", CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1", MCP_TOOL_TIMEOUT: mcpToolTimeout(s.employees.expertAnswerWaitMinutes) } });
    } catch (err) {
      tools.close();
      await fs.rm(config, { force: true });
      return failed("not-set-up", `couldn't start claude: ${(err as Error).message}`);
    }
    children.add(child);
    live.set(trunk, (live.get(trunk) ?? 0) + 1);
    child.on("close", () => {
      children.delete(child);
      tools.close();
      void fs.rm(config, { force: true }).catch(() => {});
      const left = live.get(trunk)! - 1;
      if (left) live.set(trunk, left);
      else live.delete(trunk);
      const g = saved.generations.find((x) => x.trunk === trunk);
      if (g) discardIfDone(g);
    });
    o.track?.(child, { kind: "fork", session: `claude-code:${trunk}`, folder: o.read });
    busy++;
    try {
      return await converse(child, first, next, timeoutMs, { root: o.read, disallowed: employeeDisallowed(job), requireAtInit: { mcpServer: ISOPLAN_MCP_SERVER, tools: [ASK_EXPERT_TOOL, LEAVE_DRAFT_TOOL], words: TOOLS_DIDNT_CONNECT }, ...more });
    } finally {
      busy--;
    }
  }

  const notARun: EmployeeToolHandlers = { askExpert: async () => NOT_A_RUN_EXPERT, leaveDraft: async () => NOT_A_RUN_DRAFT };

  function discardIfDone(g: SavedGeneration) {
    if ((g.state !== "retired" && g.state !== "failed") || live.has(g.trunk) || discarded.has(g.trunk)) return;
    discarded.add(g.trunk);
    void discard(g);
  }

  async function discard(g: SavedGeneration) {
    indexes.delete(g.n);
    await fs.rm(path.join(o.dir, `index-${g.n}.json`), { force: true }).catch(() => {});
    await removeTranscript(transcripts, g.trunk);
  }

  function fail(g: SavedGeneration, why: string) {
    g.state = "failed";
    g.why = why;
    lastFailure = { why: "other", detail: why };
    say("generation", { generation: g.n, state: "failed", why });
    log(`generation ${g.n} failed: ${why}`);
    void save();
    discardIfDone(g);
  }

  function clearRetry() {
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = null;
  }

  function retryLater(repeats: boolean) {
    if (stopped) return;
    if (repeats || retries >= RETRY_MINUTES.length) {
      log(repeats ? "its grounding failed in a way that fails every time, so it isn't tried again until its file changes or its owner tries again" : `its grounding failed ${retries + 1} times running, so it isn't tried again until its owner tries again`);
      return changed();
    }
    const minutes = RETRY_MINUTES[retries++]!;
    log(`its grounding failed, so it is tried again in ${minutes} minutes`);
    retryTimer = setTimeout(() => {
      retryTimer = null;
      void ground("its last grounding failed");
    }, minutes * minute);
    retryTimer.unref?.();
    changed();
  }

  /** Grounds a new generation; it becomes the newest at once. */
  function ground(because: string): Promise<void> {
    if (grounding || stopped) return grounding ?? Promise.resolve();
    clearRetry();
    log(`a new generation grounds: ${because}`);
    grounding = groundNow().finally(() => {
      grounding = null;
      changed();
    });
    changed();
    return grounding;
  }

  async function groundNow(): Promise<void> {
    const f = o.file();
    const fp = jobFingerprint(f);
    let repeats = false;
    let passed = false;
    try {
      if (!(await prepare())) return;
      const commit = await checkout.head();
      const n = Math.max(0, ...saved.generations.map((g) => g.n)) + 1;
      const g: SavedGeneration = { n, trunk: randomUUID(), model: f.model, commit, groundedAt: now(), meter: 0, addedToItsTrunk: [], pickedUpTo: {}, state: "grounding" };
      saved.generations.push(g);
      trunks.add(g.trunk);
      o.onTrunk(g.trunk);
      await save();
      const s = await o.settings();
      const promoteAt = f.promoteAtTokens ?? s.employees.promoteAtTokens;
      const values = {
        name: key,
        subject: f.subject,
        brief: f.job.brief,
        rules: list(f.job.rules),
        experts: list(o.experts().filter((e) => f.job.experts.includes(e.key)).map((e) => `${e.key}: ${e.subject}`)),
        documents: list(f.job.documents),
        examples: list(f.job.examples),
        context: (await checkout.read("CONTEXT.md", GROUNDING_FILE_MAX)) ?? "none",
      };
      const [groundingText, readText, learnedText] = (await Promise.all(["employee-grounding", "employee-read", "employee-grounding-what-it-learned"].map((p) => loadEmployeePrompt(o.appDir, p)))) as [string, string, string];
      let windowed = false;
      const check = (model: string) => {
        const w = windowFor(model);
        windowed = w.ok;
        const why = w.ok ? thresholdProblem(promoteAt, w.compactAt ?? w.window) : w.why;
        if (why) repeats = true;
        return why;
      };
      let carried: ThingToCarry[] = [];
      let room: string | null = null;
      let step = 0;
      const next = async (turn: TurnResult): Promise<string | null> => {
        step++;
        if (step === 1) return fill(readText, values);
        if (step !== 2) return null;
        room = roomForWhatWasLearnedProblem(promoteAt, meterOf(turn));
        if (room) return ((repeats = true), null);
        // What it learned before, back from its record, within half the headroom above the room kept for more.
        await o.whatWasLearned.caughtUp(minute);
        const headroom = promoteAt - meterOf(turn) - ROOM_FOR_THINGS_LEARNED * TOKENS_PER_THING_LEARNED;
        let left = Math.min(DEFAULT_LEARNED_ELSEWHERE_TOKENS_PER_QUESTION, Math.floor(headroom / 2));
        const removed = o.whatWasLearned.removed();
        for (const t of o.whatWasLearned.newestFirst()) {
          if (removed.has(t.id)) continue;
          const tokens = tokensOfAll([t]);
          if (tokens > left) break;
          left -= tokens;
          carried.unshift(t);
        }
        g.pickedUpTo = { ...o.whatWasLearned.lastReceived() };
        return carried.length ? fill(learnedText, { things: carried.map((t) => `- ${t.text.trim().replace(/\n/g, "\n  ")}`).join("\n") }) : null;
      };
      const c = await runClaude((config) => employeeTrunkArgs(g.trunk, f.model, f.job, config), g.trunk, fill(groundingText, values), next, GROUNDING_MINUTES * minute, notARun, { check });
      spent(c.usage);
      if (stopped) return;
      if (!c.ok) return fail(g, c.failure!.kind === "timed-out" ? `its grounding didn't finish within ${GROUNDING_MINUTES} minutes` : c.failure!.detail);
      g.model = c.model ?? f.model;
      const problem = (windowed ? null : check(g.model)) ?? (c.turns.length < 2 ? "its grounding ended before its second turn" : room);
      if (problem) return fail(g, problem);
      g.last = await transcripts.lastTurn(g.trunk);
      g.meter = meterOf(c.turns.at(-1)!);
      g.groundingTokens = g.meter;
      g.addedToItsTrunk = carried.map((t) => ({ id: t.id, firstLine: firstLineOf(t.text), ...(t.expertRecordId && t.arrivalNumber !== undefined && { expertRecordId: t.expertRecordId, arrivalNumber: t.arrivalNumber }) }));
      const index = Object.fromEntries([...c.reads].map((file) => [file, commit]));
      indexes.set(n, index);
      await writeIndex(o.dir, n, index);
      await lock.exclusive(async () => {
        const before = junior();
        if (before) before.state = "retired";
        g.state = "junior";
        saved.fingerprint = fp;
        await save();
        if (before) discardIfDone(before);
      });
      passed = true;
      retries = 0;
      blocked = false;
      lastFailure = null;
      say("grounding", { generation: n, trunk: g.trunk, model: g.model, meter: g.meter, cost: Math.round(weighted(c.usage, s)), ...(carried.length && { carried: carried.length }) });
      log(`generation ${n} takes its runs now`);
    } catch (err) {
      log(`its grounding failed: ${(err as Error)?.stack ?? String(err)}`);
      lastFailure = { why: "other", detail: (err as Error)?.message ?? String(err) };
    } finally {
      if (!passed && !stopped) {
        if (junior() && saved.fingerprint === fingerprintNow()) blocked = true;
        else retryLater(repeats);
      }
    }
  }

  async function trusted(g: SavedGeneration): Promise<boolean> {
    if (appending > 0) return true;
    const last = await transcripts.lastTurn(g.trunk);
    if (g.last === undefined) return ((g.last = last), void save(), true);
    if (last === g.last || stopped) return true;
    g.state = "retired";
    g.why = "its trunk was changed outside Isoplan";
    say("generation", { generation: g.n, state: "retired", why: g.why });
    log(`generation ${g.n}'s trunk was changed outside Isoplan, so it isn't used again, and a new generation grounds`);
    void save();
    discardIfDone(g);
    return false;
  }

  /** Why a new generation is due before the next run, or null. */
  function due(j: SavedGeneration, promoteAt: number): string | null {
    if (saved.fingerprint !== fingerprintNow()) return "its job changed";
    if (blocked) return null;
    const removed = o.whatWasLearned.removed();
    if (j.addedToItsTrunk.some((x) => removed.has(x.id))) return "something it learned was removed on its card";
    if (j.meter >= promoteAt && j.addedToItsTrunk.length > 0) return `it is at ${j.meter} tokens with ${j.addedToItsTrunk.length} things learned added to its trunk`;
    return null;
  }

  // One addition turn of what it learned, in order, leaving out what its trunk holds or was removed.
  function addToTrunk(g: SavedGeneration, things: ThingToCarry[]): Promise<boolean> {
    return additions.add(g.trunk, things, async () => {
      if (stopped || g.state !== "junior" || !(await trusted(g))) return false;
      const held = new Set(g.addedToItsTrunk.map((x) => x.id));
      const removed = o.whatWasLearned.removed();
      const adding = things.filter((t) => !held.has(t.id) && !removed.has(t.id));
      if (!adding.length) return true;
      appending++;
      try {
        const before = g.last ?? null;
        const text = fill(await loadEmployeePrompt(o.appDir, "employee-what-it-learned"), { things: adding.map((t) => `- ${t.text.trim().replace(/\n/g, "\n  ")}`).join("\n") });
        const f = o.file();
        const c = await runClaude((config) => employeeAppendArgs(g.trunk, g.model, f.job, config), g.trunk, text, () => null, TURN_MINUTES * minute, notARun);
        spent(c.usage);
        if (!(await transcripts.onlyOurs(g.trunk, before, [text]))) {
          g.state = "retired";
          g.why = "its trunk was changed outside Isoplan";
          void save();
          return false;
        }
        g.last = await transcripts.lastTurn(g.trunk);
        if (!c.ok) {
          log(`couldn't add what it learned to generation ${g.n}'s trunk: ${c.failure!.detail}`);
          await save();
          return false;
        }
        g.meter = meterOf(c.turns.at(-1)!);
        g.addedToItsTrunk.push(...adding.map((t) => ({ id: t.id, firstLine: firstLineOf(t.text) })));
        await save();
        return true;
      } finally {
        appending--;
      }
    });
  }

  return {
    async start() {
      const was = await readState(o.dir);
      if (stopped) return;
      if (was) {
        saved = was;
        for (const g of saved.generations) {
          trunks.add(g.trunk);
          o.onTrunk(g.trunk);
          if (g.state === "grounding") fail(g, "the runner stopped during its grounding");
        }
        const j = junior();
        if (j && !(await transcripts.transcriptOf(j.trunk))) fail(j, "its trunk's transcript is gone");
        for (const n of saved.generations.map((g) => g.n)) indexes.set(n, await readIndex(o.dir, n));
      }
      // MCP configs a runner that stopped left behind.
      await fs.rm(path.join(o.dir, "mcp"), { recursive: true, force: true }).catch(() => {});
      changed();
      if (!junior() || saved.fingerprint !== fingerprintNow()) void ground(was ? "its job changed, or it has no generation" : "it is new");
      else void prepare();
    },
    state,
    async readyForARun() {
      if (stopped) return false;
      const j = junior();
      if (!j) {
        if (!grounding && !retryTimer && !lastFailure) void ground("it has no generation");
        return false;
      }
      if (!(await trusted(j))) {
        void ground("its trunk was changed outside Isoplan");
        return false;
      }
      const why = due(j, o.file().promoteAtTokens ?? (await o.settings()).employees.promoteAtTokens);
      if (why) {
        if (!grounding && !retryTimer) void ground(why);
        return false;
      }
      return !grounding || saved.fingerprint === fingerprintNow();
    },
    async refresh() {
      if (!(await prepare())) return lastFailure?.detail ?? "its checkout couldn't be prepared";
      try {
        const moved = await checkout.fetch();
        if (moved) await lock.exclusive(() => checkout.move(moved));
        return null;
      } catch (err) {
        return `its checkout couldn't be fetched: ${(err as Error).message}`;
      }
    },
    readFolder: () => o.read,
    async run(r) {
      const j = junior()!;
      return lock.shared(async () => {
        const f = o.file();
        const c = await runClaude((config) => employeeForkArgs(j.trunk, j.model, j.last ?? null, f.job, config), j.trunk, r.prompt, () => null, r.timeoutMs, r.handlers, { onUsage: r.onUsage });
        spent(c.usage);
        // A generation a run compacted, or that offered or used a tool it may not, can't run again: a new one grounds, as an expert's broken junior is replaced.
        if (c.failure?.kind === "compacted" || c.failure?.kind === "disallowed") {
          fail(j, c.failure.kind === "compacted" ? "a run of it compacted" : c.failure.detail);
          lastFailure = null;
          void ground("a run broke its generation");
        }
        return c;
      });
    },
    async freshness() {
      const j = junior();
      if (!j) return freshnessText(new Set());
      return freshnessText(await checkout.changed(indexes.get(j.n) ?? (await readIndex(o.dir, j.n))));
    },
    async learnFromCorrections(corrections) {
      const j = junior();
      if (!j || grounding || stopped) return "waiting";
      const f = o.file();
      const text = fill(await loadEmployeePrompt(o.appDir, "employee-correction"), { corrections: corrections.map((x) => `- On ${x.at.slice(0, 10)}, your draft:\n${x.text.trim().replace(/^/gm, "  > ")}\n  Your owner's correction: ${x.correction.trim()}`).join("\n\n") });
      const c = await runClaude((config) => employeeForkArgs(j.trunk, j.model, j.last ?? null, f.job, config), j.trunk, text, () => null, TURN_MINUTES * minute, notARun);
      spent(c.usage);
      if (!c.ok) return (log(`couldn't learn from its owner's corrections: ${c.failure!.detail}`), "failed");
      const blocks = [...(c.turns.at(-1)?.text ?? "").matchAll(/<learned>([\s\S]*?)<\/learned>/g)].map((m) => m[1]!.trim().slice(0, MAX_WHAT_WAS_LEARNED_LENGTH)).filter(Boolean);
      if (!blocks.length) return "none";
      const things: ThingLearnedHere[] = blocks.map((b) => ({ id: randomUUID(), text: b, files: [], learnedAt: new Date(now()).toISOString(), generation: j.n, firstLine: firstLineOf(b) }));
      for (const t of things) await o.whatWasLearned.keepBeforeAdding(t);
      const added = await addToTrunk(j, things);
      o.whatWasLearned.additionEnded(things.map((t) => t.id));
      say("learned", { from: "corrections", count: things.length, added: added ? "yes" : "no" });
      return "learned";
    },
    update() {
      blocked = false;
      clearRetry();
      retries = 0;
      lastFailure = null;
      if (o.file().repo !== saved.repo) {
        saved.repo = o.file().repo;
        checkout = makeCheckout();
        prepared = null;
      }
      changed();
    },
    retryNow() {
      if (stopped) return;
      clearRetry();
      retries = 0;
      blocked = false;
      lastFailure = null;
      log("asked to try its grounding again now");
      void ground("its owner asked to try again");
    },
    idle: () => busy === 0 && !grounding,
    isTrunk: (id) => trunks.has(id),
    stop() {
      stopped = true;
      clearRetry();
      for (const child of children) killTree(child);
    },
    async remove() {
      stopped = true;
      clearRetry();
      for (const child of children) killTree(child);
      o.whatWasLearned.forget();
      for (let waited = 0; children.size && waited < 5000; waited += 50) await new Promise((r) => setTimeout(r, 50));
      for (const g of saved.generations) {
        if (g.state === "junior" || g.state === "grounding") g.state = "retired";
        if (!discarded.has(g.trunk)) (discarded.add(g.trunk), await discard(g));
      }
      await saving;
    },
    close() {
      stopped = true;
      clearRetry();
      for (const child of children) killTree(child);
    },
  };
}
