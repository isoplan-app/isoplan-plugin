// When an employee runs on this computer (isoplan-app#341), and how its runs went: the rules of its
// schedule, kept across restarts in employees/<key>/runs.json, and the `employee-runs` row for it.
//
// - Checked every minute and at start, against the wall clock (a computer that slept fires late
//   timers): the latest scheduled time at or before now that has neither run nor been passed over is
//   due. Inside its missed-run window it runs, once; past it, it is `missed`. Only the latest runs,
//   never one per time missed.
// - A schedule change (its every, at, on or zone) passes over every scheduled time before the change,
//   and so does the employee's first look, so it runs from its next scheduled time on.
// - Not before its job file is tied to a published record and a generation is ready; a due time
//   waits for those inside its window. No overlapping runs: a time due during a run waits for it, and
//   a run started now (`runNow`) while a tick looks makes that tick start none.
// - Held back: while more of its drafts wait for its owner than one run leaves, a due time waits;
//   once decisions or expiry bring them down inside its window, it runs; past it, `held-back`.
// - Its day's minutes and tokens (rolling 24 hours, this file and its ledger) stop a run starting
//   when spent, and a run stopped at a limit is `stopped` with it and isn't tried again.
// - One try again: a run that failed is tried again once, `tryAgainAfterMinutes` later, if still
//   inside its window; a second failure isn't.
// - At start, a run this file names as running whose end wasn't done gets its end (its drafts
//   scanned, claimed and sent), and counts as failed, so its try again finds their recipients claimed.
//   That end is in the background, as a run is: nothing is due before it is done, and git's time
//   doesn't hold the runner's start.
// - `stop` starts no more runs, and the run under way ends as it would, its end done; `close`, as the
//   runner stops, leaves the end of the run under way to the next start.

import { randomUUID } from "node:crypto";
import path from "node:path";
import type { EmployeeRunsMessage } from "@isoplan/protocol";
import { missedRunWindowMs, scheduleKey, scheduledAfter, scheduledAtOrBefore } from "./employee-schedule.js";
import type { EmployeeFile } from "./employee-file.js";
import type { JobLimit, RunOutcome } from "./employee-run.js";
import { readJson, writeJson } from "./expert-state.js";

const DAY = 24 * 3600000;
const WEEK = 7 * DAY;
/** The most ended runs kept and listed: those of the last 7 days, newest first. */
const MAX_ENDED = 20;
/** What a failure's words say in their place when they matched a secret pattern. */
export const WHY_HELD = "the reason matched a secret pattern, so this computer's log for the employee says it";

type Ended = EmployeeRunsMessage["employees"][number]["ended"][number];

export interface RunsFile {
  version: 1;
  scheduleKey: string;
  /** Every scheduled time at or before this was passed over. */
  passedOverBefore: number;
  /** The latest scheduled time that ran, was missed or was held back. */
  lastScheduledFor: number | null;
  running: { run: string; scheduledFor: number; since: number; wasTheTryAgain?: true } | null;
  tryAgain: { scheduledFor: number; at: number } | null;
  ended: (Omit<Ended, "scheduledFor" | "startedAt" | "endedAt" | "tryingAgainAt"> & { scheduledFor: number; startedAt?: number; endedAt: number; tryingAgainAt?: number })[];
  dayMinutes: { at: number; minutes: number }[];
}

export interface EmployeeRunsOptions {
  dir: string;
  file: () => EmployeeFile;
  /** Tied to a published record, with a generation ready to run. */
  ready: () => Promise<boolean>;
  /** Its drafts waiting for its owner, and the most one run leaves. */
  waiting: () => number;
  draftsPerRun: () => Promise<number>;
  tryAgainAfterMinutes: () => Promise<number>;
  /** `closed`: whether the runner is stopping, so the run leaves its end to the next start. */
  run: (run: string, scheduledFor: number, closed: () => boolean) => Promise<RunOutcome>;
  /** The end of a run the runner died in. */
  endLeftover: (run: string) => Promise<{ drafts: number; heldBySecretCheck: number; someoneElseHad: number }>;
  scan: (text: string) => Promise<string | null>;
  now?: () => number;
  log: (text: string) => void;
  onChange: () => void;
  /** Every minute in the runner; tests tick by hand. */
  tickMs?: number | null;
}

export interface EmployeeRuns {
  start(): Promise<void>;
  /** Looks at the schedule now: what is due runs, what is past its window is missed. */
  tick(): Promise<void>;
  /** Its job file changed: a new schedule passes over every time before now. */
  jobChanged(): Promise<void>;
  /** Runs now, outside the schedule: an employee made on the floor's first run. */
  runNow(): Promise<void>;
  /** Its row in `employee-runs`, but its key, record and the facts of its job file and tracker. */
  listing(): Pick<EmployeeRunsMessage["employees"][number], "running" | "heldBack" | "ended" | "nextRunAt">;
  /** The minutes it ran in the last 24 hours. */
  dayMinutes(): number;
  running(): boolean;
  /** Starts no more runs; the run under way ends as it would. */
  stop(): void;
  /** The runner stops: the end of the run under way is left to the next start. */
  close(): void;
  /** Settles once the run under way, or the end of one the runner died in, is over. */
  settled(): Promise<void>;
  written(): Promise<void>;
}

export function createEmployeeRuns(o: EmployeeRunsOptions): EmployeeRuns {
  const now = o.now ?? Date.now;
  const file = path.join(o.dir, "runs.json");
  let state: RunsFile | null = null;
  let heldBack: { scheduledFor: number; draftsWaiting: number } | null = null;
  let running: Promise<void> | null = null;
  let ticking: Promise<void> | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  let stopped = false;
  let closed = false;
  let writing: Promise<void> = Promise.resolve();

  const save = () => {
    const copy = structuredClone(state);
    writing = writing.then(() => writeJson(file, copy)).catch((err: Error) => o.log(`couldn't write its runs: ${err.message}`));
    return writing;
  };
  const s = () => state!;
  const schedule = () => o.file().job.schedule;
  const windowEnd = (scheduledFor: number) => scheduledFor + missedRunWindowMs(o.file().job, scheduledFor);

  function end(e: RunsFile["ended"][number]) {
    s().ended = [e, ...s().ended.filter((x) => x.run !== e.run && now() - x.endedAt < WEEK)].slice(0, MAX_ENDED);
  }

  async function why(text: string | undefined): Promise<string | undefined> {
    if (!text) return undefined;
    return (await o.scan(text)) ? WHY_HELD : text.slice(0, 1000);
  }

  async function start(scheduledFor: number, wasTheTryAgain: boolean) {
    const run = randomUUID();
    const since = now();
    s().running = { run, scheduledFor, since, ...(wasTheTryAgain && { wasTheTryAgain: true as const }) };
    if (!wasTheTryAgain) s().lastScheduledFor = Math.max(s().lastScheduledFor ?? 0, scheduledFor);
    s().tryAgain = null;
    heldBack = null;
    await save();
    o.onChange();
    let out: RunOutcome;
    try {
      out = await o.run(run, scheduledFor, () => closed);
    } catch (err) {
      out = { outcome: "failed", why: `the runner failed: ${(err as Error).message}`, drafts: 0, heldBySecretCheck: 0, someoneElseHad: 0, startedAt: since };
    }
    if (closed) return;
    const endedAt = now();
    s().dayMinutes = [...s().dayMinutes.filter((x) => endedAt - x.at < DAY), { at: endedAt, minutes: (endedAt - since) / 60000 }];
    const tryAgainAt = out.outcome === "failed" && !wasTheTryAgain ? endedAt + (await o.tryAgainAfterMinutes()) * 60000 : null;
    const retries = tryAgainAt !== null && tryAgainAt < windowEnd(scheduledFor);
    end({ run, scheduledFor, startedAt: out.startedAt, endedAt, outcome: out.outcome, ...(out.limit && { limit: out.limit }), drafts: out.drafts, heldBySecretCheck: out.heldBySecretCheck, someoneElseHad: out.someoneElseHad, ...(out.why && { why: await why(out.why) }), ...(retries && { tryingAgainAt: tryAgainAt! }), ...(wasTheTryAgain && { wasTheTryAgain: true as const }) });
    s().running = null;
    s().tryAgain = retries ? { scheduledFor, at: tryAgainAt! } : null;
    await save();
    o.log(`its run for ${new Date(scheduledFor).toISOString()} ended ${out.outcome}${out.limit ? ` at its limit ${out.limit}` : ""}: ${out.drafts} drafts${retries ? `; tried again at ${new Date(tryAgainAt!).toISOString()}` : ""}`);
    o.onChange();
  }

  // Never two at once: a run asked for while one is under way is that one.
  const go = (scheduledFor: number, again: boolean): Promise<void> => {
    if (running || stopped) return running ?? Promise.resolve();
    running = start(scheduledFor, again).finally(() => (running = null));
    return running;
  };

  // The end of a run this file names as running: the runner stopped during it.
  async function endLeftover(left: NonNullable<RunsFile["running"]>) {
    o.log(`its run ${left.run} was under way when the runner stopped, so its end is done now`);
    const counts = await o.endLeftover(left.run);
    if (closed) return;
    const endedAt = now();
    const tryAgainAt = left.wasTheTryAgain ? null : endedAt + (await o.tryAgainAfterMinutes()) * 60000;
    const retries = tryAgainAt !== null && tryAgainAt < windowEnd(left.scheduledFor);
    end({ run: left.run, scheduledFor: left.scheduledFor, startedAt: left.since, endedAt, outcome: "failed", ...counts, why: "the runner stopped during the run", ...(retries && { tryingAgainAt: tryAgainAt! }), ...(left.wasTheTryAgain && { wasTheTryAgain: true as const }) });
    s().running = null;
    s().tryAgain = retries ? { scheduledFor: left.scheduledFor, at: tryAgainAt! } : null;
    await save();
    o.onChange();
  }

  // A schedule changed: every time before now is passed over.
  async function jobChanged() {
    if (!state || s().scheduleKey === scheduleKey(schedule())) return;
    Object.assign(s(), { scheduleKey: scheduleKey(schedule()), passedOverBefore: now(), tryAgain: null });
    heldBack = null;
    await save();
    o.onChange();
  }

  async function tickNow() {
    if (stopped || !state || running) return;
    // Changed while the runner wasn't running: passed over from now.
    await jobChanged();
    const t = now();
    const retry = s().tryAgain;
    if (retry) {
      if (t >= windowEnd(retry.scheduledFor)) s().tryAgain = null;
      else if (t >= retry.at) {
        if (await o.ready()) return void go(retry.scheduledFor, true);
        return;
      }
    }
    const due = scheduledAtOrBefore(schedule(), t);
    if (due <= s().passedOverBefore || due <= (s().lastScheduledFor ?? -Infinity)) return;
    if (t >= windowEnd(due)) {
      const outcome = heldBack?.scheduledFor === due ? "held-back" : "missed";
      s().lastScheduledFor = due;
      end({ run: randomUUID(), scheduledFor: due, endedAt: t, outcome, drafts: 0, heldBySecretCheck: 0, someoneElseHad: 0 });
      heldBack = null;
      await save();
      o.log(`its run for ${new Date(due).toISOString()} was ${outcome === "missed" ? "missed: the runner wasn't running, or the employee wasn't ready, inside its window" : "held back until its window passed: too many drafts waited for its owner"}`);
      return o.onChange();
    }
    if (s().tryAgain) return;
    if (!(await o.ready())) return;
    const waiting = o.waiting();
    if (waiting > (await o.draftsPerRun())) {
      if (heldBack?.scheduledFor !== due || heldBack.draftsWaiting !== waiting) (heldBack = { scheduledFor: due, draftsWaiting: waiting }), o.onChange();
      return;
    }
    void go(due, false);
  }

  const tick = () => (ticking ??= tickNow().finally(() => (ticking = null)));

  return {
    async start() {
      const read = (await readJson(file)) as RunsFile | null;
      state = read?.version === 1 ? read : { version: 1, scheduleKey: scheduleKey(schedule()), passedOverBefore: now(), lastScheduledFor: null, running: null, tryAgain: null, ended: [], dayMinutes: [] };
      if (!read) await save();
      const left = s().running;
      // Held as a run is, so nothing is due until it is done; then it looks at the schedule.
      if (left)
        running = endLeftover(left)
          .catch((err: Error) => o.log(`the end of its run ${left.run} failed: ${err.message}`))
          .finally(() => {
            running = null;
            void tick();
          });
      if (o.tickMs !== null) {
        timer = setInterval(() => void tick(), o.tickMs ?? 60000);
        timer.unref?.();
      }
      void tick();
    },
    tick,
    jobChanged,
    async runNow() {
      if (running || stopped) return;
      await go(now(), false);
    },
    listing() {
      if (!state) return { ended: [] };
      const iso = (t: number) => new Date(t).toISOString();
      const r = s().running;
      const next = scheduledAfter(schedule(), Math.max(now(), s().lastScheduledFor ?? 0));
      return {
        ...(r && { running: { run: r.run, scheduledFor: iso(r.scheduledFor), since: iso(r.since) } }),
        ...(heldBack && { heldBack: { scheduledFor: iso(heldBack.scheduledFor), draftsWaiting: heldBack.draftsWaiting } }),
        ended: s()
          .ended.filter((e) => now() - e.endedAt < WEEK)
          .map((e) => ({ ...e, scheduledFor: iso(e.scheduledFor), endedAt: iso(e.endedAt), ...(e.startedAt !== undefined && { startedAt: iso(e.startedAt) }), ...(e.tryingAgainAt !== undefined && { tryingAgainAt: iso(e.tryingAgainAt) }) })) as Ended[],
        nextRunAt: iso(s().tryAgain?.at ?? next),
      };
    },
    dayMinutes: () => (state ? s().dayMinutes.filter((x) => now() - x.at < DAY).reduce((n, x) => n + x.minutes, 0) : 0),
    running: () => running !== null,
    stop() {
      stopped = true;
      if (timer) clearInterval(timer);
    },
    close() {
      stopped = closed = true;
      if (timer) clearInterval(timer);
    },
    settled: async () => void (await running),
    written: () => writing,
  };
}

export type { JobLimit };
