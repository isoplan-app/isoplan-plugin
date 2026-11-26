// The job file, ~/.claude/isoplan/employees/<key>.json (isoplan-app#341, CONTEXT.md: Job): the one
// file a person writes to start an employee on this computer, and the file the runner writes when
// one is made on the floor (version 1). It names the employee, this computer's checkout of its
// project (`repo`, never sent), what it does (its subject), the model it grounds and runs with, its
// promotion threshold, and its job, as the protocol's JobSchema says: brief, rules, documents and
// examples, schedule, missed-run window, tools, experts, how long its drafts wait, limits, and the
// path of its file of who was contacted. Parsed as an expert file is (expert-file.ts): plain checks,
// no I/O, a newer version refused, a field this runner doesn't know reported, the first bad field
// named with why.
//
// - Only the fields the file sets are in its definition (`definitionOfJob`), so a default changing in
//   runner.json changes no definition; runner.json's `employees` block holds the defaults.
// - A change to the job's model, brief, rules, documents, examples, tools or experts grounds a new
//   generation before its next run (`jobFingerprint`); its schedule, window, wait, limits and file of
//   who was contacted apply at once.

import { createHash } from "node:crypto";
import path from "node:path";
import { areaCovers, ExpertNameSchema, JOB_TOOLS, JobSchema, MAX_EXPERT_SUBJECT_LENGTH, type ExpertDefinition, type Job, type Project } from "@isoplan/protocol";

export interface EmployeeFile {
  version: 1;
  name: string;
  /** The full path of this computer's checkout of its project: this computer's own, never sent. */
  repo: string;
  subject: string;
  model: string;
  /** Absent: runner.json's `employees.promoteAtTokens`. */
  promoteAtTokens?: number;
  /** Only the fields the file sets. */
  job: Job;
}

export type ParsedEmployee = { ok: true; employee: EmployeeFile; unknown: string[] } | { ok: false; field: string; reason: string };

/** The fields of a job file in the order the runner writes them. */
const ORDER = ["version", "name", "repo", "subject", "model", "promoteAtTokens", "brief", "rules", "documents", "examples", "schedule", "missedRunWindowMinutes", "tools", "experts", "draftsWaitHours", "limits", "whoWasContacted"] as const;
const JOB_FIELDS = ["brief", "rules", "documents", "examples", "schedule", "missedRunWindowMinutes", "tools", "experts", "draftsWaitHours", "limits", "whoWasContacted"] as const;
const KNOWN_SCHEDULE = ["every", "at", "on", "timeZone"];
const KNOWN_LIMITS = ["runMinutes", "dayMinutes", "runTokens", "dayTokens", "draftsPerRun"];

export const ONLY_JOB_TOOLS = `a job may only use ${JOB_TOOLS.slice(0, -1).join(", ")} and ${JOB_TOOLS.at(-1)}: nothing it does may send, post, merge or pay`;
export const JOB_NEEDS_READ = "a job needs Read to read its documents";

class Bad extends Error {
  constructor(
    readonly field: string,
    readonly reason: string,
  ) {
    super(`${field}: ${reason}`);
  }
}

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** Whether this computer knows `zone` as a time zone. */
export function knownTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/** `text` as the job file named `fileName`, whose base name is the employee's key. */
export function parseEmployeeFile(text: string, fileName: string): ParsedEmployee {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (err) {
    return { ok: false, field: "(file)", reason: `isn't valid JSON: ${(err as Error).message}` };
  }
  try {
    return parse(value, path.basename(fileName, ".json"));
  } catch (err) {
    if (err instanceof Bad) return { ok: false, field: err.field, reason: err.reason };
    throw err;
  }
}

function parse(value: unknown, base: string): ParsedEmployee {
  if (!isObject(value)) throw new Bad("(file)", "must be a JSON object");
  const o = value;
  const words = (field: string, v: unknown): string => {
    if (v === undefined) throw new Bad(field, "is required");
    if (typeof v !== "string" || !v.trim()) throw new Bad(field, "must be text that isn't empty");
    return v.trim();
  };
  if (o.version === undefined) throw new Bad("version", "is required");
  if (typeof o.version === "number" && Number.isInteger(o.version) && o.version > 1) throw new Bad("version", `is ${o.version}: written for a newer runner; update the Isoplan plugin on this computer`);
  if (o.version !== 1) throw new Bad("version", "must be 1");
  if (typeof o.name !== "string" || !ExpertNameSchema.safeParse(o.name).success) throw new Bad("name", o.name === undefined ? "is required" : "must be lowercase letters, digits and dashes, at most 63, starting with a letter or digit");
  if (o.name !== base) throw new Bad("name", `is "${o.name}", but the file is ${base}.json; they must be the same`);
  const repo = words("repo", o.repo);
  if (!path.isAbsolute(repo)) throw new Bad("repo", "must be the full path of this computer's checkout of its project");
  const subject = words("subject", o.subject);
  if (subject.length > MAX_EXPERT_SUBJECT_LENGTH) throw new Bad("subject", `must be at most ${MAX_EXPERT_SUBJECT_LENGTH} characters`);
  const model = words("model", o.model);
  if (model.startsWith("-")) throw new Bad("model", "must be a model name, not starting with -");
  if (o.promoteAtTokens !== undefined && !(Number.isInteger(o.promoteAtTokens) && (o.promoteAtTokens as number) > 0)) throw new Bad("promoteAtTokens", "must be a whole number of at least 1");

  // A folder written with its slash at the end ("outreach/approved/") is that folder.
  const folders = (v: unknown) => (Array.isArray(v) ? v.map((x) => (typeof x === "string" && x.length > 1 ? x.replace(/\/+$/, "") : x)) : v);

  // The words a person can act on, before the protocol's own.
  if (Array.isArray(o.tools)) {
    const outside = o.tools.find((t) => !(JOB_TOOLS as readonly unknown[]).includes(t));
    if (outside !== undefined) throw new Bad("tools", `${JSON.stringify(outside)}: ${ONLY_JOB_TOOLS}`);
    if (!o.tools.includes("Read")) throw new Bad("tools", JOB_NEEDS_READ);
  }
  if (isObject(o.schedule) && typeof o.schedule.timeZone === "string" && !knownTimeZone(o.schedule.timeZone)) throw new Bad("schedule.timeZone", `${o.schedule.timeZone} isn't a time zone this computer knows, such as Europe/London`);
  if (typeof o.whoWasContacted === "string") {
    for (const field of ["documents", "examples"] as const) {
      const list = Array.isArray(o[field]) ? (folders(o[field]) as unknown[]).filter((x): x is string => typeof x === "string") : [];
      const covering = list.find((area) => areaCovers([area], o.whoWasContacted as string));
      if (covering) throw new Bad("whoWasContacted", `the file of who was contacted holds prospects' details, so its runs must not read it while grounding: move it out of ${covering === "." ? "the project's root, which its " + field + " cover" : covering.replace(/\/?$/, "/")}`);
    }
  }

  const job =Object.fromEntries(JOB_FIELDS.filter((f) => o[f] !== undefined).map((f) => [f, f === "documents" || f === "examples" ? folders(o[f]) : o[f]]));
  // A job may leave out the lists it has none of; its tools it must name.
  const parsed = JobSchema.safeParse({ rules: [], documents: [], examples: [], experts: [], ...job });
  if (!parsed.success) {
    const issue = parsed.error.issues[0]!;
    throw new Bad(issue.path.join(".") || "(job)", issue.code === "invalid_type" && issue.input === undefined ? "is required" : issue.message);
  }
  const employee: EmployeeFile = { version: 1, name: o.name, repo, subject, model, ...(o.promoteAtTokens !== undefined && { promoteAtTokens: o.promoteAtTokens as number }), job: parsed.data };
  const unknown = [
    ...Object.keys(o).filter((k) => !(ORDER as readonly string[]).includes(k)),
    ...(isObject(o.schedule) ? Object.keys(o.schedule).filter((k) => !KNOWN_SCHEDULE.includes(k)).map((k) => `schedule.${k}`) : []),
    ...(isObject(o.limits) ? Object.keys(o.limits).filter((k) => !KNOWN_LIMITS.includes(k)).map((k) => `limits.${k}`) : []),
  ];
  return { ok: true, employee, unknown };
}

/** The employee's definition in its expert record: only what the file sets of its job; no areas, no proof. */
export function definitionOfJob(f: EmployeeFile, project: Project, defaultPromoteAtTokens: number): ExpertDefinition {
  return { key: f.name, project: { id: project.id, name: project.name }, subject: f.subject, model: f.model, promoteAtTokens: f.promoteAtTokens ?? defaultPromoteAtTokens, areas: [], job: structuredClone(f.job) };
}

/** What a new generation is grounded for: a change to any of these grounds one before the next run. */
export function jobFingerprint(f: EmployeeFile): string {
  const j = f.job;
  return createHash("sha256").update(JSON.stringify([f.model, j.brief, j.rules, j.documents, j.examples, j.tools, j.experts])).digest("hex");
}

/** The job file the runner writes for a definition (made on the floor, or its record edited elsewhere), with this computer's checkout as `repo`. */
export function jobFileText(d: ExpertDefinition, repo: string, promoteAtTokensSet = true): string {
  const job = d.job!;
  const fields: Record<string, unknown> = { version: 1, name: d.key, repo, subject: d.subject, model: d.model, ...(promoteAtTokensSet && { promoteAtTokens: d.promoteAtTokens }), ...job };
  return JSON.stringify(Object.fromEntries(ORDER.filter((k) => fields[k] !== undefined).map((k) => [k, fields[k]])), null, 2) + "\n";
}

/** Whether the file still says what a definition says, whatever its project. */
export function fileSaysJob(f: EmployeeFile, d: ExpertDefinition, defaultPromoteAtTokens: number): boolean {
  const mine = definitionOfJob(f, d.project, defaultPromoteAtTokens);
  return JSON.stringify([mine.key, mine.subject, mine.model, mine.promoteAtTokens, mine.job]) === JSON.stringify([d.key, d.subject, d.model, d.promoteAtTokens, d.job]);
}
