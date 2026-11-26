// The employees on this computer (isoplan-app#341): one per job file in
// ~/.claude/isoplan/employees/<key>.json (employee-file.ts), each run in employees/<key>/ with its
// health log at ~/.claude/isoplan/logs/employee-<key>.log, and one per folder there whose
// expert-records.json ties it to a record but whose job file is gone.
//
// - Each has its trunk (employee.ts), its drafts here (employee-drafts-here.ts), its writer of the
//   file of who was contacted (who-was-contacted-writer.ts), its runs (employee-runs.ts, employee-run.ts),
//   its ledger, and its record of what it learned (what-was-learned-for-one-expert.ts, #366's), made
//   over its folder and bound as experts.ts binds its own.
// - The folder is watched as the experts' is (expert-files.ts). A file that doesn't parse is logged
//   to runner.log and the employee's health log, and one already running keeps running. A key an
//   expert file or instance file here has doesn't run.
// - A job file removed by hand stops its runs on this computer and nothing else: its folder, its
//   record and its drafts stay, decisions still apply, and its listing says `jobFileGone`; put back,
//   it carries on. Deleting it for good is the floor's (`remove`): its run under way ends first, then
//   every claim it holds is released and pushed, then its trunks' transcripts, clones and folder go.
// - Its file of who was contacted inside an area of one of this computer's experts of its project is
//   warned of once, in runner.log and its health log: that expert reads prospects' details as it grounds.
// - Its trunks are known to `isEmployeeSession`, so none is ever reported; `anyTied` keeps the
//   runner up between runs.

import fs from "node:fs";
import path from "node:path";
import type { EmployeeDraftDecidedMessage, EmployeeRunsMessage } from "@isoplan/protocol";
import { openLedger, type Ledger } from "./caps.js";
import type { Spawn, Track } from "./claude.js";
import { createEmployeeDraftsHere, type DecisionApplied, type EmployeeDraftsHere, type KeptDraft, type RunAnswer } from "./employee-drafts-here.js";
import { parseEmployeeFile, type EmployeeFile } from "./employee-file.js";
import { dayTokensSpent, endOfRun, limitsOf, runOnce, type EmployeeRunDeps } from "./employee-run.js";
import { createEmployeeRuns, type EmployeeRuns } from "./employee-runs.js";
import type { EmployeeTools } from "./employee-tools.js";
import { createEmployeeTrunk, removeTrunkTranscripts, type EmployeeSettings, type EmployeeTrunk, type TrunkState } from "./employee.js";
import { inside } from "./expert-claude.js";
import { watchExpertFiles, type ExpertFiles } from "./expert-files.js";
import { createHealthLog, type HealthLog } from "./expert-health.js";
import type { RunGit } from "../handoff/git.js";
import { areaCovers, employeeDisplayName } from "@isoplan/protocol";
import { createWhatWasLearnedForOneExpert, type WhatWasLearnedBinding, type WhatWasLearnedForOneExpert } from "./what-was-learned-for-one-expert.js";
import { createWhoWasContactedWriter, type WhoWasContactedWriter } from "./who-was-contacted-writer.js";

type Row = EmployeeRunsMessage["employees"][number];

export interface EmployeesOptions {
  /** <claudeDir>/isoplan/employees: the job files, and each employee's folder. */
  employeesDir: string;
  /** runner.json's `clonesFolder`, where a new employee's read clone goes; "" for its folder. */
  clonesFolder?: string;
  logsDir: string;
  projectsDir: string;
  appDir: string;
  binary: () => Promise<string | null>;
  settings: () => Promise<EmployeeSettings>;
  scan: (text: string) => Promise<string | null>;
  git: RunGit;
  gitTimeoutMs: () => Promise<number>;
  tools: Pick<EmployeeTools, "open">;
  /** This runner's person. */
  account: { id: string; name: string };
  /** Whether an expert file or instance file here has the key. */
  expertHasKey: (key: string) => boolean;
  /** The job's experts, as the directory of its record's office has them. */
  expertsOf: (key: string) => { key: string; subject: string }[];
  /** This computer's experts of the employee's project, with their areas. */
  expertAreasOf?: (key: string) => { expert: string; areas: string[] }[];
  /** Teaches the expert `expert` on this computer from rejected drafts and its answers in their runs: `waiting` while it can't now (no instance ready, its day's tokens spent). */
  teach?: (expert: string, corrections: { correction: string; draftText: string; answers: RunAnswer[] }[]) => Promise<"learned" | "none" | "failed" | "waiting">;
  /** A run's question to one of the job's experts. */
  ask: (key: string, run: string, expert: string, question: string, deadline: number) => Promise<{ text: string; answer?: RunAnswer }>;
  spawn?: Spawn;
  env?: Record<string, string | undefined>;
  track?: Track;
  log: (text: string) => void;
  now?: () => number;
  lookMs?: number;
  minuteMs?: number;
  /** Every minute in the runner; null in tests, which tick by hand. */
  tickMs?: number | null;
  /** Whether the writer may clone from an address that isn't on the wire: tests' local origins. */
  cloneFrom?: (remote: string) => boolean;
  writeDelayMs?: (n: number) => number;
}

/** One employee on this computer. */
export interface EmployeeHere {
  key: string;
  /** Its job file; null once it is gone from this computer. */
  file: EmployeeFile | null;
  /** The project its record names, once it is tied to one: what its writer clones when there is no job file. */
  project: string | null;
  trunk: EmployeeTrunk | null;
  runs: EmployeeRuns | null;
  drafts: EmployeeDraftsHere;
  writer: WhoWasContactedWriter;
  ledger: Ledger;
  health: HealthLog;
  approvedTwice: NonNullable<Row["approvedTwice"]>;
}

export interface Employees {
  /** Settles once every job file and folder is read; groundings run in the background. */
  start(): Promise<void>;
  all(): EmployeeHere[];
  get(key: string): EmployeeHere | null;
  /** The listing's facts of one employee: its trunk's state and its row but its key and record. */
  stateOf(key: string): TrunkState | null;
  rowOf(key: string): Omit<Row, "key" | "expertRecordId"> | null;
  /** Something of an employee changed: its runs, its drafts, its state. */
  onChange(listener: (key: string) => void): void;
  decide(key: string, m: EmployeeDraftDecidedMessage): Promise<DecisionApplied>;
  /** Its job file was written or changed here: read it now. */
  refresh(key: string): Promise<void>;
  /** Its first run, now, outside its schedule. */
  runNow(key: string): Promise<void>;
  /** Each employee's expired drafts released, its corrections learned from, its schedule looked at: every minute in the runner. */
  tick(): Promise<void>;
  /** Deleted for good: its claims released, its runs stopped, its folder deleted. */
  remove(key: string): Promise<void>;
  /** Stops its runs while it is refused on its record's office (runs elsewhere, a key taken), or starts them again. */
  setRefused(key: string, why: string | null): void;
  bindTies(tiedAndPublished: (key: string) => string | null): void;
  bindWhatWasLearned(binding: (key: string) => WhatWasLearnedBinding): void;
  tiesMayHaveChanged(): void;
  setProject(key: string, project: string): void;
  whatWasLearned(key: string): WhatWasLearnedForOneExpert;
  health(key: string): HealthLog;
  dir(key: string): string;
  jobFilePath(key: string): string;
  isEmployeeSession(id: string): boolean;
  /** Some employee is tied to a published record: the runner stays up for its runs. */
  anyTied(): boolean;
  idle(): boolean;
  close(): void;
}

export function createEmployees(o: EmployeesOptions): Employees {
  const now = o.now ?? Date.now;
  const here = new Map<string, EmployeeHere>();
  const listeners: ((key: string) => void)[] = [];
  const learned = new Map<string, WhatWasLearnedForOneExpert>();
  const healths = new Map<string, HealthLog>();
  const refused = new Map<string, string>();
  const badText = new Map<string, string>();
  const chains = new Map<string, Promise<void>>();
  const saidKeyClash = new Set<string>();
  const learning = new Set<string>();
  const warnedOfAreas = new Set<string>();
  // The run under way of an employee whose runs were stopped, until it has ended.
  const ending = new Map<string, Promise<void>>();
  const timers: ReturnType<typeof setInterval>[] = [];
  let binding: ((key: string) => WhatWasLearnedBinding) | null = null;
  let tied: (key: string) => string | null = () => null;
  let watcher: ExpertFiles | null = null;

  const dir = (key: string) => path.join(o.employeesDir, key);
  const jobFilePath = (key: string) => path.join(o.employeesDir, `${key}.json`);
  const changed = (key: string) => listeners.forEach((l) => l(key));
  const health = (key: string) => {
    let h = healths.get(key);
    if (!h) healths.set(key, (h = createHealthLog(path.join(o.logsDir, `employee-${key}.log`), o.now)));
    return h;
  };
  const whatWasLearned = (key: string) => {
    let w = learned.get(key);
    if (!w) {
      learned.set(key, (w = createWhatWasLearnedForOneExpert({ dir: dir(key), log: (t) => o.log(`employee ${key}: ${t}`) })));
      if (binding) w.bind(binding(key));
    }
    return w;
  };
  // Where its read clone is: where it was made, else where a new one goes.
  const readFolder = (key: string) => {
    const made = [path.join(dir(key), "read"), ...(o.clonesFolder ? [path.join(o.clonesFolder, "employees", key, "read")] : [])];
    return made.find((p) => fs.existsSync(p)) ?? made.at(-1)!;
  };
  const queue = (key: string, work: () => Promise<void>) => {
    const next = (chains.get(key) ?? Promise.resolve()).then(work).catch((err: Error) => o.log(`employee ${key}: ${err.message}`));
    chains.set(key, next);
    return next;
  };

  async function make(key: string, file: EmployeeFile | null): Promise<EmployeeHere> {
    const ledger = await openLedger(path.join(dir(key), "ledger.json"));
    const settings = o.settings;
    const e: EmployeeHere = { key, file, project: null, trunk: null, runs: null, drafts: null!, writer: null!, ledger, health: health(key), approvedTwice: [] };
    e.writer = createWhoWasContactedWriter({
      git: o.git,
      dir: dir(key),
      repo: () => e.file?.repo ?? null,
      project: () => e.project ?? "",
      file: () => e.file?.job.whoWasContacted ?? cachedSettings?.employees.whoWasContacted ?? "who-was-contacted.csv",
      me: () => ({ sender: o.account.name || o.account.id, employee: key }),
      employeeName: () => employeeDisplayName(key),
      timeoutMs: o.gitTimeoutMs,
      scan: o.scan,
      log: (t) => o.log(`employee ${key}: ${t}`),
      tries: async () => (await settings()).employees.whoWasContactedPushTries,
      ...(o.writeDelayMs && { delayMs: o.writeDelayMs }),
      ...(o.cloneFrom && { cloneFrom: o.cloneFrom }),
    });
    e.drafts = createEmployeeDraftsHere({
      dir: dir(key),
      writer: e.writer,
      account: () => o.account,
      ...(o.now && { now: o.now }),
      log: (t) => o.log(`employee ${key}: ${t}`),
      // A decision may let a held-back time run now; corrections are learned on the minute's tick, so a burst of rejections makes one fork.
      onDecided: () => {
        changed(key);
        void e.runs?.tick();
      },
      onApprovedTwice: (x) => {
        e.approvedTwice = [x, ...e.approvedTwice].filter((y) => now() - Date.parse(y.approvedAt) < 7 * 86400000).slice(0, 20);
        health(key).say("approved-twice", { approvedAt: x.approvedAt, alreadyContactedBy: x.alreadyContactedBy });
        changed(key);
      },
    });
    await e.writer.load();
    await e.drafts.load();
    await whatWasLearned(key).load();
    return e;
  }

  let cachedSettings: EmployeeSettings | null = null;

  // Its trunk and runs, for a job file that is there.
  async function startRunning(e: EmployeeHere) {
    const key = e.key;
    const file = () => e.file!;
    e.trunk = createEmployeeTrunk({
      key,
      file,
      dir: dir(key),
      read: readFolder(key),
      health: e.health,
      projectsDir: o.projectsDir,
      appDir: o.appDir,
      binary: o.binary,
      settings: o.settings,
      git: o.git,
      gitTimeoutMs: o.gitTimeoutMs,
      ...(o.spawn && { spawn: o.spawn }),
      ...(o.env && { env: o.env }),
      ...(o.track && { track: o.track }),
      log: o.log,
      onChange: () => changed(key),
      onTrunk: () => {},
      whatWasLearned: whatWasLearned(key),
      tools: o.tools,
      experts: () => o.expertsOf(key),
      ledger: e.ledger,
      ...(o.now && { now: o.now }),
      ...(o.minuteMs && { minuteMs: o.minuteMs }),
      ...(o.cloneFrom && { cloneFrom: o.cloneFrom }),
    });
    const trunk = e.trunk;
    const deps: EmployeeRunDeps = {
      key,
      file,
      trunk,
      drafts: e.drafts,
      writer: e.writer,
      ledger: e.ledger,
      settings: o.settings,
      appDir: o.appDir,
      scan: o.scan,
      ask: (run, expert, question, deadline) => o.ask(key, run, expert, question, deadline),
      dayMinutesSpent: () => e.runs?.dayMinutes() ?? 0,
      now,
      log: o.log,
    };
    e.runs = createEmployeeRuns({
      dir: dir(key),
      file,
      ready: async () => !!e.file && !refused.has(key) && tied(key) !== null && (await trunk.readyForARun()),
      waiting: () => e.drafts.waiting(),
      draftsPerRun: async () => limitsOf(file(), (await o.settings()).employees).draftsPerRun,
      tryAgainAfterMinutes: async () => (await o.settings()).employees.tryAgainAfterMinutes,
      run: (run, scheduledFor, closed) => runOnce(deps, run, scheduledFor, closed),
      endLeftover: (run) => endOfRun(deps, run, "failed"),
      scan: o.scan,
      ...(o.now && { now: o.now }),
      log: (t) => o.log(`employee ${key}: ${t}`),
      onChange: () => changed(key),
      ...(o.tickMs !== undefined && { tickMs: o.tickMs }),
    });
    await trunk.start();
    await e.runs.start();
  }

  function stopRunning(e: EmployeeHere) {
    e.trunk?.stop();
    e.runs?.stop();
    if (e.runs) ending.set(e.key, e.runs.settled());
    e.trunk = null;
    e.runs = null;
  }

  // Its file of who was contacted inside an area of one of this computer's experts of its project: said once.
  function warnOfAreas(e: EmployeeHere) {
    if (!e.file || !o.expertAreasOf) return;
    const tracker = e.file.job.whoWasContacted ?? cachedSettings?.employees.whoWasContacted ?? "who-was-contacted.csv";
    for (const { expert, areas } of o.expertAreasOf(e.key)) {
      const area = areas.find((a) => areaCovers([a], tracker));
      const said = `${e.key}\n${expert}\n${area}\n${tracker}`;
      if (!area || warnedOfAreas.has(said)) continue;
      warnedOfAreas.add(said);
      const why = `its file of who was contacted, ${tracker}, is inside expert ${expert}'s area ${area}, so that expert reads prospects' details as it grounds: move the file out of the area, or the area off the file`;
      o.log(`employee ${e.key}: ${why}`);
      e.health.say("file", { warning: why });
    }
  }

  async function tickOf(e: EmployeeHere) {
    warnOfAreas(e);
    await e.drafts.tidy().catch(() => {});
    void learn(e).catch((err: Error) => o.log(`employee ${e.key}: couldn't learn from its owner's corrections: ${err.message}`));
    await e.runs?.tick();
  }

  // Rejections into what the employee learned, and into each expert its owner chose to teach: one
  // fork at a time per employee, at most runner.json's correctionsLearnedAtOnce each, inside its day's tokens.
  async function learn(e: EmployeeHere) {
    if (learning.has(e.key) || !e.trunk || !e.file) return;
    learning.add(e.key);
    try {
      const s = await o.settings();
      if (dayTokensSpent(e.ledger, now(), s) >= limitsOf(e.file, s.employees).dayTokens) {
        if (e.drafts.toLearn().length) e.health.say("learned", { from: "corrections", waiting: "its day's tokens are spent" });
        return;
      }
      const atOnce = s.employees.correctionsLearnedAtOnce;
      const mine = e.drafts.toLearn().filter((d) => !d.learning!.employee).slice(0, atOnce);
      if (mine.length) {
        const r = await e.trunk.learnFromCorrections(mine.map((d) => ({ correction: d.decision!.correction!, text: d.draft.text, at: d.decision!.at })));
        if (r !== "waiting") await e.drafts.learned(mine.map((d) => d.draft.id), "employee", r !== "failed");
      }
      const byExpert = new Map<string, KeptDraft[]>();
      for (const d of e.drafts.toLearn()) for (const k of d.decision?.teach ?? []) if (!d.learning!.experts.includes(k)) byExpert.set(k, [...(byExpert.get(k) ?? []), d]);
      for (const [expert, list] of byExpert) {
        const batch = list.slice(0, atOnce);
        const r = o.teach ? await o.teach(expert, batch.map((d) => ({ correction: d.decision!.correction!, draftText: d.draft.text, answers: d.answers[expert] ?? [] }))) : "waiting";
        if (r !== "waiting") await e.drafts.learned(batch.map((d) => d.draft.id), expert, r !== "failed");
      }
      changed(e.key);
    } finally {
      learning.delete(e.key);
    }
  }

  // What the key's job file says now.
  async function apply(key: string, text: string | null) {
    let file: EmployeeFile | null = null;
    if (text !== null) {
      const parsed = parseEmployeeFile(text, `${key}.json`);
      if (!parsed.ok) {
        if (badText.get(key) === text) return;
        badText.set(key, text);
        const error = `${key}.json: ${parsed.field}: ${parsed.reason}`;
        o.log(`job file ${error}${here.get(key)?.file ? "; the employee keeps running as it was" : ""}`);
        health(key).say("file", { error });
        return;
      }
      badText.delete(key);
      if (parsed.unknown.length) o.log(`job file ${key}.json: fields this runner doesn't know, ignored: ${parsed.unknown.join(", ")}`);
      file = parsed.employee;
    }
    if (file && o.expertHasKey(key)) {
      if (!saidKeyClash.has(key)) (o.log(`employee ${key}: an expert on this computer has this key, so it doesn't run`), health(key).say("file", { error: "an expert on this computer has this key" }));
      saidKeyClash.add(key);
      file = null;
    } else saidKeyClash.delete(key);
    let e = here.get(key) ?? null;
    if (!file) {
      if (!e) return;
      if (e.file) {
        o.log(`employee ${key}: its job file was removed, so it doesn't run on this computer; its folder, record and drafts stay`);
        health(key).say("file", { gone: "yes" });
      }
      stopRunning(e);
      e.file = null;
      return changed(key);
    }
    if (!e) here.set(key, (e = await make(key, file)));
    const was = e.file;
    e.file = file;
    warnOfAreas(e);
    if (!e.trunk) await startRunning(e);
    else if (JSON.stringify(was) !== JSON.stringify(file)) {
      e.trunk.update();
      await e.runs?.jobChanged();
    }
    changed(key);
  }

  return {
    async start() {
      cachedSettings = await o.settings();
      // Folders tied to a record whose job file is gone.
      for (const d of await fs.promises.readdir(o.employeesDir, { withFileTypes: true }).catch(() => [])) {
        if (!d.isDirectory() || fs.existsSync(jobFilePath(d.name)) || !fs.existsSync(path.join(dir(d.name), "expert-records.json"))) continue;
        here.set(d.name, await make(d.name, null));
      }
      watcher = watchExpertFiles({
        dir: o.employeesDir,
        ...(o.lookMs !== undefined && { lookMs: o.lookMs }),
        log: o.log,
        onChange: (c) => void queue(c.name, () => apply(c.name, c.kind === "removed" ? null : c.text!)),
      });
      await watcher.look();
      await Promise.all([...chains.values()]);
      if (o.tickMs !== null) {
        const timer = setInterval(() => void Promise.all([...here.values()].map((e) => tickOf(e))), o.tickMs ?? 60000);
        timer.unref?.();
        timers.push(timer);
      }
    },
    all: () => [...here.values()].sort((a, b) => a.key.localeCompare(b.key)),
    get: (key) => here.get(key) ?? null,
    stateOf: (key) => here.get(key)?.trunk?.state() ?? null,
    rowOf(key) {
      const e = here.get(key);
      if (!e) return null;
      const problem = e.writer.problem();
      return {
        ...(e.runs?.listing() ?? { ended: [] }),
        ...(!e.file && { jobFileGone: true as const }),
        ...(problem && { whoWasContactedProblem: { detail: problem.detail.slice(0, 1000), ...(problem.refused && { refused: true as const }) } }),
        ...(e.approvedTwice.length && { approvedTwice: e.approvedTwice }),
      };
    },
    onChange: (l) => void listeners.push(l),
    async decide(key, m) {
      const e = here.get(key);
      if (!e) return { refused: "unknown-draft" };
      return e.drafts.decide(m);
    },
    refresh: async (key) => {
      const text = await fs.promises.readFile(jobFilePath(key), "utf8").catch(() => null);
      await queue(key, () => apply(key, text));
    },
    async runNow(key) {
      await here.get(key)?.runs?.runNow();
    },
    async tick() {
      await Promise.all([...here.values()].map((e) => tickOf(e)));
    },
    async remove(key) {
      await queue(key, async () => {
        const e = here.get(key);
        if (!e) return;
        const trunk = e.trunk;
        stopRunning(e);
        // Its run under way ends first, its fork ended, so no claim of that run is pushed after the release.
        await ending.get(key);
        ending.delete(key);
        const releasing = e.drafts.releaseAll();
        if (releasing.length) {
          await e.writer.add(releasing);
          const r = await e.writer.write();
          if (!r.pushed) o.log(`employee ${key}: its claims couldn't be released in the file of who was contacted as it was deleted: ${r.detail}`);
        }
        if (trunk) await trunk.remove();
        else await removeTrunkTranscripts(dir(key), o.projectsDir);
        learned.get(key)?.forget();
        learned.delete(key);
        here.delete(key);
        await e.drafts.written();
        await e.writer.remove();
        await fs.promises.rm(dir(key), { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch((err: Error) => o.log(`employee ${key}: couldn't delete its folder: ${err.message}`));
        await fs.promises.rm(readFolder(key), { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(() => {});
        o.log(`employee ${key}: deleted, with its trunks, its clones and its folder`);
        changed(key);
      });
    },
    setRefused(key, why) {
      if (why) refused.set(key, why);
      else refused.delete(key);
      changed(key);
    },
    bindTies: (fn) => void (tied = fn),
    bindWhatWasLearned(b) {
      binding = b;
      for (const [key, w] of learned) w.bind(b(key));
    },
    tiesMayHaveChanged: () => learned.forEach((w) => w.checkTies()),
    setProject(key, project) {
      const e = here.get(key);
      if (e) e.project = project;
    },
    whatWasLearned,
    health,
    dir,
    jobFilePath,
    isEmployeeSession: (id) => [...here.values()].some((e) => e.trunk?.isTrunk(id)),
    anyTied: () => [...here.values()].some((e) => e.file && tied(e.key) !== null),
    idle: () => [...here.values()].every((e) => (e.trunk?.idle() ?? true) && !(e.runs?.running() ?? false)),
    close() {
      watcher?.stop();
      for (const t of timers) clearInterval(t);
      for (const e of here.values()) {
        e.trunk?.close();
        e.runs?.close();
      }
    },
  };
}

/** Whether a session is an employee's, to keep it off the floor: in the employees' folder, or a trunk of one. */
export const employeeIgnored =
  (employeesDir: string, employees: () => Pick<Employees, "isEmployeeSession"> | null, clonesFolder = "") =>
  (id: string, cwd: string | null): boolean =>
    (cwd !== null && [employeesDir, ...(clonesFolder ? [path.join(clonesFolder, "employees")] : [])].some((d) => inside(d, cwd) !== null)) || (employees()?.isEmployeeSession(id) ?? false);
