// One run of an employee's job, start to end (isoplan-app#341).
//
// - Before the fork: the waiting changes to the file of who was contacted are pushed (a remote that
//   refused is tried again at a run's start), which fetches the newest file, so `leave_draft` checks
//   against it; and the read clone is fetched and moved to origin's default branch.
// - The fork: prompts/employee-run.md, with the rejected recipients it carries and their corrections,
//   the path of the file of who was contacted in its folder, and what changed since its generation
//   read; Isoplan's tools bound to this run (`ask_expert` waits for its answer; `leave_draft` keeps
//   each draft before answering, employee-drafts-here.ts); its limits: its minutes (the
//   conversation's time limit, the day's minutes left counted in), its tokens and the day's (weighted
//   as caps.ts weighs, through `onUsage`), and its context, ended near the model's window.
// - The run's end (`endOfRun`, also for a run the runner died in, at its next start): each draft
//   scanned for secrets (a match never leaves and is only counted); a claim per draft with a
//   recipient, pushed, a recipient another sender claimed or contacted since dropping its draft;
//   then the drafts go to the office (employee-link.ts). A push that fails still lets the drafts go.
//   A run the runner stopped during (`closed`) leaves its end to the runner's next start.

import type { JOB_LIMITS } from "@isoplan/protocol";
import type { Ledger } from "./caps.js";
import { weighted } from "./caps.js";
import { zoneOf } from "./employee-schedule.js";
import type { EmployeeDraftsHere, RunAnswer } from "./employee-drafts-here.js";
import type { EmployeeFile } from "./employee-file.js";
import { EMPLOYEE_ROOM, loadEmployeePrompt, type EmployeeSettings, type EmployeeTrunk } from "./employee.js";
import { fill } from "./prompts.js";
import type { WhoWasContactedWriter } from "./who-was-contacted-writer.js";
import { prospectOf } from "./who-was-contacted.js";

export type JobLimit = (typeof JOB_LIMITS)[number];

export interface RunOutcome {
  outcome: "ran" | "failed" | "stopped";
  limit?: JobLimit;
  why?: string;
  drafts: number;
  heldBySecretCheck: number;
  someoneElseHad: number;
  startedAt: number;
}

/** A job's limits, the job's own else runner.json's. */
export interface Limits {
  runMinutes: number;
  dayMinutes: number;
  runTokens: number;
  dayTokens: number;
  draftsPerRun: number;
  runContextTokens: number;
}

export function limitsOf(f: EmployeeFile, s: EmployeeSettings["employees"]): Limits {
  const l = f.job.limits ?? {};
  return { runMinutes: l.runMinutes ?? s.runMinutes, dayMinutes: l.dayMinutes ?? s.dayMinutes, runTokens: l.runTokens ?? s.runTokens, dayTokens: l.dayTokens ?? s.dayTokens, draftsPerRun: l.draftsPerRun ?? s.draftsPerRun, runContextTokens: s.runContextTokens };
}

/** The weighted tokens of the employee's last 24 hours. */
export const dayTokensSpent = (ledger: Ledger, now: number, s: EmployeeSettings) => ledger.entries(now).filter((e) => e.room === EMPLOYEE_ROOM).reduce((n, e) => n + weighted(e.usage, s), 0);

export interface EmployeeRunDeps {
  key: string;
  file: () => EmployeeFile;
  trunk: EmployeeTrunk;
  drafts: EmployeeDraftsHere;
  writer: WhoWasContactedWriter;
  ledger: Ledger;
  settings: () => Promise<EmployeeSettings>;
  appDir: string;
  scan: (text: string) => Promise<string | null>;
  /** A question to one of the job's experts, from this run; its words, and the answer with its files when it came. */
  ask: (run: string, expert: string, question: string, deadline: number) => Promise<{ text: string; answer?: RunAnswer }>;
  /** The day's minutes this employee has run, in the last 24 hours. */
  dayMinutesSpent: () => number;
  now: () => number;
  log: (text: string) => void;
}

/** One run: `run` its id, for the scheduled time `scheduledFor`; `closed`, whether the runner is stopping. */
export async function runOnce(d: EmployeeRunDeps, run: string, scheduledFor: number, closed: () => boolean = () => false): Promise<RunOutcome> {
  const startedAt = d.now();
  const leftToTheNextStart: RunOutcome = { outcome: "failed", why: "the runner stopped during the run", drafts: 0, heldBySecretCheck: 0, someoneElseHad: 0, startedAt };
  const f = d.file();
  const s = await d.settings();
  const limits = limitsOf(f, s.employees);
  const failed = async (why: string): Promise<RunOutcome> => ({ outcome: "failed", why, ...(await endOfRun(d, run, "failed")), startedAt });

  const daySpent = dayTokensSpent(d.ledger, d.now(), s);
  const minutesLeft = limits.dayMinutes - d.dayMinutesSpent();
  if (daySpent >= limits.dayTokens) return { outcome: "stopped", limit: "day-tokens", ...(await endOfRun(d, run, "stopped")), startedAt };
  if (minutesLeft <= 0) return { outcome: "stopped", limit: "day-minutes", ...(await endOfRun(d, run, "stopped")), startedAt };

  await d.writer.write({ runStart: true, alreadySent: alreadySent(d.drafts, run) });
  const refreshed = await d.trunk.refresh();
  if (closed()) return leftToTheNextStart;
  if (refreshed) return failed(refreshed);

  const zone = zoneOf(f.job.schedule);
  const carried = await d.drafts.carry(run);
  const file = f.job.whoWasContacted ?? s.employees.whoWasContacted;
  const when = new Date(scheduledFor).toLocaleString("en-GB", { timeZone: zone, weekday: "long", day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });
  const prompt = fill(await loadEmployeePrompt(d.appDir, "employee-run"), {
    when,
    timeZone: zone,
    batch: String(limits.draftsPerRun),
    research: f.job.tools.includes("Agent") ? "Do your web searches and reading in Agent subagents and keep only what you need: your own context is limited.\n\n" : "",
    rejectedAgain: carried.length ? `Your owner rejected your last draft to each of these, with a correction. Draft each again first, following its correction:\n${carried.map((r) => `- ${[r.name, r.organisation].filter(Boolean).join(", ") || "(no name)"} <${r.prospect}>: ${r.correction}`).join("\n")}\n\n` : "",
    whoWasContacted: `The file of who was contacted is ${file} in your folder, as fetched at this run's start: skip everyone in it.\n\n`,
    freshness: await d.trunk.freshness(),
  });

  const answers: Record<string, RunAnswer[]> = {};
  const deadline = startedAt + Math.min(limits.runMinutes, minutesLeft) * 60000;
  let limit: JobLimit | null = null;
  const c = await d.trunk.run({
    prompt,
    timeoutMs: deadline - d.now(),
    handlers: {
      askExpert: async (expert, question) => {
        const r = await d.ask(run, expert, question, deadline);
        if (r.answer) (answers[expert] ??= []).push(r.answer);
        return r.text;
      },
      leaveDraft: (input) => d.drafts.leave(run, input, limits.draftsPerRun, answers),
    },
    onUsage: (sofar, context) => {
      const tokens = weighted(sofar, s);
      limit = context >= limits.runContextTokens ? "context" : tokens > limits.runTokens ? "run-tokens" : daySpent + tokens > limits.dayTokens ? "day-tokens" : null;
      return limit ? `it reached its limit, ${limit}` : null;
    },
  });
  if (closed()) return leftToTheNextStart;
  if (!c.ok && c.failure!.kind === "timed-out") limit = limits.runMinutes <= minutesLeft ? "run-minutes" : "day-minutes";
  const end = await endOfRun(d, run, c.ok ? "ran" : limit ? "stopped" : "failed");
  if (c.ok) return { outcome: "ran", ...end, startedAt };
  if (limit) return { outcome: "stopped", limit, ...end, startedAt };
  return { outcome: "failed", why: c.failure!.detail, ...end, startedAt };
}

/** The drafts of runs before `run` that went to the office already: their claims stand whatever the file says now. */
const alreadySent = (drafts: EmployeeDraftsHere, run: string) => new Set(drafts.toSend().flatMap((x) => (x.run === run ? [] : x.drafts.map((d) => d.id))));

/** The end of a run: secret check, claims, then the drafts can go. Also for a run the runner died in. */
export async function endOfRun(d: Pick<EmployeeRunDeps, "drafts" | "writer" | "scan" | "settings" | "file" | "now" | "log" | "key">, run: string, outcome: "ran" | "failed" | "stopped"): Promise<{ drafts: number; heldBySecretCheck: number; someoneElseHad: number }> {
  const s = await d.settings();
  const kept = d.drafts.ofRun(run).filter((x) => !x.ended);
  const held = new Set<string>();
  for (const x of kept) {
    const hit = await d.scan([x.draft.subject ?? "", x.draft.text].join("\n"));
    if (hit) held.add(x.draft.id);
  }
  if (held.size) d.log(`employee ${d.key}: the secret check held ${held.size} of run ${run}'s drafts on this computer`);
  const claims = kept.filter((x) => x.draft.to && !held.has(x.draft.id)).map((x) => ({ op: "claim" as const, prospect: prospectOf(x.draft.to!.address), ...(x.draft.to!.name && { name: x.draft.to!.name }), ...(x.draft.to!.organisation && { organisation: x.draft.to!.organisation }), draft: x.draft.id, at: new Date(d.now()).toISOString() }));
  let dropped = new Set<string>();
  if (claims.length) {
    await d.writer.add(claims);
    const pushed = await d.writer.write({ alreadySent: alreadySent(d.drafts, run) });
    if (pushed.pushed) dropped = new Set(pushed.someoneElseHad);
  }
  const waitHours = d.file().job.draftsWaitHours ?? s.employees.draftsWaitHours;
  await d.drafts.endRun(run, { held, dropped, expiresAt: new Date(d.now() + waitHours * 3600000).toISOString(), outcome });
  return { drafts: kept.length - held.size - dropped.size, heldBySecretCheck: held.size, someoneElseHad: dropped.size };
}
