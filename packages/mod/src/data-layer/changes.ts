// What changed between two sets of one session's facts, as a `changes` message carries it: the
// records that are new or differ, and the keys of those that went away. Records are keyed as the
// protocol keys them: an agent by its id, an edit or read by agent, file and project (absent for
// the session's own, as an older peer sends it), a wait by waiter and
// on, a report by its agent, a question or a workflow by its id, an area by its folder and project.
// The session is one record, sent whole when it
// changed. Facts without questions have none. Given `answered`, each removed question says how it
// ended: answered, or abandoned with no answer. An area is never removed (protocol 0.15.0): it goes
// with its session, so one no longer in the facts stays as the server last had it.

import type { FactRemove, Facts, FactUpsert } from "@isoplan/protocol";

/** null when nothing changed. */
export function diffFacts(before: Facts, after: Facts, answered?: (question: string) => boolean): { upsert: FactUpsert; remove: FactRemove } | null {
  const upsert: FactUpsert = {};
  const remove: FactRemove = {};
  if (!same(before.session, after.session)) upsert.session = after.session;

  const agents = diff(before.agents, after.agents, (a) => a.id);
  if (agents.upsert.length) upsert.agents = agents.upsert;
  if (agents.remove.length) remove.agents = agents.remove.map((a) => a.id);

  for (const list of ["edits", "reads"] as const) {
    const d = diff(before[list], after[list], (f) => key(f.agent, f.file, f.project?.id ?? ""));
    if (d.upsert.length) upsert[list] = d.upsert;
    if (d.remove.length) remove[list] = d.remove.map(({ agent, file, project }) => ({ agent, file, ...(project ? { project } : {}) }));
  }

  const waits = diff(before.waits, after.waits, (w) => key(w.waiter, w.on));
  if (waits.upsert.length) upsert.waits = waits.upsert;
  if (waits.remove.length) remove.waits = waits.remove.map(({ waiter, on }) => ({ waiter, on }));

  const reports = diff(before.reports, after.reports, (r) => r.agent);
  if (reports.upsert.length) upsert.reports = reports.upsert;
  if (reports.remove.length) remove.reports = reports.remove.map((r) => r.agent);

  const questions = diff(before.questions ?? [], after.questions ?? [], (q) => q.id);
  if (questions.upsert.length) upsert.questions = questions.upsert;
  if (questions.remove.length) {
    remove.questions = questions.remove.map((q) => q.id);
    if (answered) remove.questionOutcomes = Object.fromEntries(remove.questions.map((id) => [id, answered(id) ? "answered" : "abandoned"]));
  }

  const workflows = diff(before.workflows ?? [], after.workflows ?? [], (w) => w.id);
  if (workflows.upsert.length) upsert.workflows = workflows.upsert;
  if (workflows.remove.length) remove.workflows = workflows.remove.map((w) => w.id);

  const areas = diff(before.areas ?? [], after.areas ?? [], (a) => key(a.folder, a.project?.id ?? ""));
  if (areas.upsert.length) upsert.areas = areas.upsert;

  return Object.keys(upsert).length || Object.keys(remove).length ? { upsert, remove } : null;
}

function diff<T>(before: T[], after: T[], keyOf: (record: T) => string): { upsert: T[]; remove: T[] } {
  const old = new Map(before.map((r) => [keyOf(r), r]));
  const now = new Set(after.map(keyOf));
  return {
    upsert: after.filter((r) => !same(old.get(keyOf(r)), r)),
    remove: before.filter((r) => !now.has(keyOf(r))),
  };
}

const key = (...parts: string[]) => JSON.stringify(parts);

// The records are built the same way each pass, so their JSON compares them.
const same = (a: unknown, b: unknown) => a !== undefined && JSON.stringify(a) === JSON.stringify(b);
