// The instance file, ~/.claude/isoplan/expert-instances/<key>.json (isoplan-app#340): on a computer
// other than its owner's, this computer's own fields of its instance of an expert, set up from the
// expert's record on an office server (expert-instance.ts). What every instance shares, its
// definition (D14: key, project, subject, model, promotion threshold, areas and proof question, and,
// since #366, how much of what other instances learned one question carries), is
// the record's, kept in experts/<key>/expert-records.json; this file holds only what is this
// computer's: the office server it was set up from (`server`), the folder its expert runs from
// (`repo`: a checkout of the project, or Isoplan's own clone of it), its time limits, how often it
// fetches, how many questions it answers at once, its caps and the model's window. A person may edit
// it by hand, as the expert file. Version 1; plain checks as expert-file.ts makes them: a field this
// runner doesn't know is reported, not fatal, and a file that doesn't parse names its first bad field.
//
// Here too: the expert file the runner runs either way (`expertFileFromRecord`), composed of a
// definition and this computer's fields, and the owner's expert file written from a record
// (`ownerExpertFileText`, D12), so the owner's other computers get one.

import path from "node:path";
import { AreaPathSchema, ExpertNameSchema, MAX_AREA_PATHS, type ExpertDefinition, type Project } from "@isoplan/protocol";
import { EXPERT_DEFAULTS, type ExpertCaps, type ExpertFile } from "./expert-file.js";

/** What of an expert file is this computer's own, never in its definition. */
export interface ExpertLocalFields {
  repo: string;
  forkTimeLimitMinutes: number;
  groundingTimeLimitMinutes: number;
  fetchSeconds: number;
  maxForks: number;
  caps: ExpertCaps;
  window?: number;
}

export interface ExpertInstanceFile extends ExpertLocalFields {
  version: 1;
  key: string;
  /** The office server it was set up from, by its data-layer address. */
  server: string;
}

export type ParsedExpertInstance = { ok: true; instance: ExpertInstanceFile; unknown: string[] } | { ok: false; field: string; reason: string };

const KNOWN = ["version", "key", "server", "repo", "forkTimeLimitMinutes", "groundingTimeLimitMinutes", "fetchSeconds", "maxForks", "caps", "window"];
const KNOWN_CAPS = ["perAskerPerDay", "openPerAsker", "tokenBudgetPerDay"];

class Bad extends Error {
  constructor(
    readonly field: string,
    readonly reason: string,
  ) {
    super(`${field}: ${reason}`);
  }
}

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** `text` as the instance file named `fileName` (its base name is the expert's key). */
export function parseExpertInstanceFile(text: string, fileName: string): ParsedExpertInstance {
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

function parse(o: unknown, base: string): ParsedExpertInstance {
  if (!isObject(o)) throw new Bad("(file)", "must be a JSON object");
  const whole = (field: string, v: unknown, min: number, fallback: number): number => {
    if (v === undefined) return fallback;
    if (typeof v !== "number" || !Number.isInteger(v) || v < min) throw new Bad(field, `must be a whole number of at least ${min}`);
    return v;
  };
  if (typeof o.version === "number" && Number.isInteger(o.version) && o.version > 1) throw new Bad("version", `is ${o.version}: written for a newer runner; update the Isoplan plugin on this computer`);
  if (o.version !== 1) throw new Bad("version", "must be 1");
  if (typeof o.key !== "string" || !ExpertNameSchema.safeParse(o.key).success) throw new Bad("key", "must be lowercase letters, digits and dashes, at most 63, starting with a letter or digit");
  if (o.key !== base) throw new Bad("key", `is "${o.key}", but the file is ${base}.json; they must be the same`);
  if (typeof o.server !== "string" || !o.server.trim()) throw new Bad("server", "must be the office server's address it was set up from");
  if (typeof o.repo !== "string" || !path.isAbsolute(o.repo.trim())) throw new Bad("repo", "must be the full path of the folder it runs from");
  const caps = o.caps === undefined ? {} : o.caps;
  if (!isObject(caps)) throw new Bad("caps", "must be an object");
  const instance: ExpertInstanceFile = {
    version: 1,
    key: o.key,
    server: o.server.trim(),
    repo: o.repo.trim(),
    forkTimeLimitMinutes: whole("forkTimeLimitMinutes", o.forkTimeLimitMinutes, 1, EXPERT_DEFAULTS.forkTimeLimitMinutes),
    groundingTimeLimitMinutes: whole("groundingTimeLimitMinutes", o.groundingTimeLimitMinutes, 1, EXPERT_DEFAULTS.groundingTimeLimitMinutes),
    fetchSeconds: whole("fetchSeconds", o.fetchSeconds, 0, EXPERT_DEFAULTS.fetchSeconds),
    maxForks: whole("maxForks", o.maxForks, 1, EXPERT_DEFAULTS.maxForks),
    caps: {
      perAskerPerDay: whole("caps.perAskerPerDay", caps.perAskerPerDay, 1, EXPERT_DEFAULTS.caps.perAskerPerDay),
      openPerAsker: whole("caps.openPerAsker", caps.openPerAsker, 1, EXPERT_DEFAULTS.caps.openPerAsker),
      tokenBudgetPerDay: whole("caps.tokenBudgetPerDay", caps.tokenBudgetPerDay, 1, EXPERT_DEFAULTS.caps.tokenBudgetPerDay),
    },
    ...(o.window !== undefined && { window: whole("window", o.window, 100_000, 0) }),
  };
  const unknown = [...Object.keys(o).filter((k) => !KNOWN.includes(k)), ...Object.keys(caps).filter((k) => !KNOWN_CAPS.includes(k)).map((k) => `caps.${k}`)];
  return { ok: true, instance, unknown };
}

/** This computer's fields for a new instance or expert file in `repo`: the defaults. */
export const defaultLocalFields = (repo: string): ExpertLocalFields => ({
  repo,
  forkTimeLimitMinutes: EXPERT_DEFAULTS.forkTimeLimitMinutes,
  groundingTimeLimitMinutes: EXPERT_DEFAULTS.groundingTimeLimitMinutes,
  fetchSeconds: EXPERT_DEFAULTS.fetchSeconds,
  maxForks: EXPERT_DEFAULTS.maxForks,
  caps: { ...EXPERT_DEFAULTS.caps },
});

/** What of an expert file is this computer's own. */
export const localFieldsOf = (f: ExpertLocalFields): ExpertLocalFields => ({
  repo: f.repo,
  forkTimeLimitMinutes: f.forkTimeLimitMinutes,
  groundingTimeLimitMinutes: f.groundingTimeLimitMinutes,
  fetchSeconds: f.fetchSeconds,
  maxForks: f.maxForks,
  caps: { ...f.caps },
  ...(f.window !== undefined && { window: f.window }),
});

/** The instance file's text. */
export const expertInstanceFileText = (instance: ExpertInstanceFile) => JSON.stringify(instance, null, 2) + "\n";

/** The expert file the runner runs: a definition with this computer's own fields. */
export const expertFileFromRecord = (d: ExpertDefinition, local: ExpertLocalFields): ExpertFile => ({
  version: 1,
  name: d.key,
  repo: local.repo,
  subject: d.subject,
  model: d.model,
  promoteAtTokens: d.promoteAtTokens,
  forkTimeLimitMinutes: local.forkTimeLimitMinutes,
  groundingTimeLimitMinutes: local.groundingTimeLimitMinutes,
  fetchSeconds: local.fetchSeconds,
  maxForks: local.maxForks,
  caps: { perAskerPerDay: local.caps.perAskerPerDay, openPerAsker: local.caps.openPerAsker, tokenBudgetPerDay: local.caps.tokenBudgetPerDay },
  proof: { question: d.proof.question, answer: d.proof.answer },
  ...(local.window !== undefined && { window: local.window }),
  areas: [...d.areas],
  ...(d.learnedElsewhereTokensPerQuestion !== undefined && { learnedElsewhereTokensPerQuestion: d.learnedElsewhereTokensPerQuestion }),
});

/** The owner's expert file, as written from a record on a computer of theirs that had none (D12), or rewritten from a newer revision. */
export function ownerExpertFileText(d: ExpertDefinition, local: ExpertLocalFields): string {
  const f = expertFileFromRecord(d, local);
  const body = { version: 1, name: f.name, repo: f.repo, subject: f.subject, model: f.model, promoteAtTokens: f.promoteAtTokens, forkTimeLimitMinutes: f.forkTimeLimitMinutes, groundingTimeLimitMinutes: f.groundingTimeLimitMinutes, fetchSeconds: f.fetchSeconds, maxForks: f.maxForks, caps: f.caps, proof: f.proof, ...(f.window !== undefined && { window: f.window }), areas: f.areas, ...(f.learnedElsewhereTokensPerQuestion !== undefined && { learnedElsewhereTokensPerQuestion: f.learnedElsewhereTokensPerQuestion }) };
  return JSON.stringify(body, null, 2) + "\n";
}

/** An expert file's definition as the office `project` takes its repo: its areas filtered to those the protocol takes, at most MAX_AREA_PATHS. */
export const definitionOf = (f: ExpertFile, project: Project): ExpertDefinition => ({
  key: f.name,
  project: { id: project.id, name: project.name },
  subject: f.subject,
  model: f.model,
  promoteAtTokens: f.promoteAtTokens,
  areas: f.areas.filter((a) => AreaPathSchema.safeParse(a).success).slice(0, MAX_AREA_PATHS),
  proof: { question: f.proof.question, answer: f.proof.answer },
  ...(f.learnedElsewhereTokensPerQuestion !== undefined && { learnedElsewhereTokensPerQuestion: f.learnedElsewhereTokensPerQuestion }),
});

/** Whether two definitions say the same, their projects compared by id alone, as git may name one repo two ways. */
export const sameDefinition = (a: ExpertDefinition, b: ExpertDefinition) => JSON.stringify(comparable(a)) === JSON.stringify(comparable(b));

/** Whether an expert file still says what a definition says, whatever its project: what an owner's computer compares a new revision with. */
export const fileSaysDefinition = (f: ExpertFile, d: ExpertDefinition) => sameDefinition(definitionOf(f, d.project), d);

const comparable = (d: ExpertDefinition) => [d.key, d.project.id.toLowerCase(), d.subject, d.model, d.promoteAtTokens, d.areas, d.proof.question, d.proof.answer, d.learnedElsewhereTokensPerQuestion ?? null];
