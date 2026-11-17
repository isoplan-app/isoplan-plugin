// The expert file, ~/.claude/isoplan/experts/<name>.json: the one file a person writes to start an
// expert on this machine (version 1). It names the expert, the repo it answers about, its subject
// (what to ask it, and before which changes), the model it grounds with, its promotion threshold,
// its proof question with the expected answer, and optional limits and caps. A newer runner reads
// older versions; a file written for a newer runner is refused. A field this runner doesn't know is
// reported (`unknown`) and isn't fatal. A file that doesn't parse names its first bad field and why.
//
// Kept to plain checks with no I/O: whether `repo` is a git checkout with an origin remote is found
// out when its checkout is prepared.

import path from "node:path";
import { ExpertNameSchema, MAX_EXPERT_SUBJECT_LENGTH } from "@isoplan/protocol";

/** The host's caps for one expert: per asking session, and its daily budget in weighted tokens (caps.ts). */
export interface ExpertCaps {
  perAskerPerDay: number;
  openPerAsker: number;
  tokenBudgetPerDay: number;
}

export interface ExpertFile {
  version: 1;
  name: string;
  repo: string;
  subject: string;
  model: string;
  promoteAtTokens: number;
  forkTimeLimitMinutes: number;
  groundingTimeLimitMinutes: number;
  fetchSeconds: number;
  maxForks: number;
  caps: ExpertCaps;
  proof: { question: string; answer: string };
  /** Overrides the model → window table (expert-meter.ts). */
  window?: number;
  /** Globs of the area it claims: kept for speaking up first, unused in slice 1. */
  areas: string[];
}

export type ParsedExpert = { ok: true; expert: ExpertFile; unknown: string[] } | { ok: false; field: string; reason: string };

/** What an expert file leaves out. */
export const EXPERT_DEFAULTS = {
  forkTimeLimitMinutes: 5,
  groundingTimeLimitMinutes: 15,
  fetchSeconds: 60,
  maxForks: 3,
  caps: { perAskerPerDay: 30, openPerAsker: 3, tokenBudgetPerDay: 2_000_000 },
} as const;

const KNOWN = ["version", "name", "repo", "subject", "model", "promoteAtTokens", "forkTimeLimitMinutes", "groundingTimeLimitMinutes", "fetchSeconds", "maxForks", "caps", "proof", "window", "areas"];
const KNOWN_CAPS = ["perAskerPerDay", "openPerAsker", "tokenBudgetPerDay"];
const KNOWN_PROOF = ["question", "answer"];

class Bad extends Error {
  constructor(
    readonly field: string,
    readonly reason: string,
  ) {
    super(`${field}: ${reason}`);
  }
}

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** `text` as the expert file named `fileName` (its base name is the expert's name). */
export function parseExpertFile(text: string, fileName: string): ParsedExpert {
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

function parse(value: unknown, base: string): ParsedExpert {
  if (!isObject(value)) throw new Bad("(file)", "must be a JSON object");
  const o = value;
  const whole = (field: string, v: unknown, min: number, fallback?: number): number => {
    if (v === undefined && fallback !== undefined) return fallback;
    if (v === undefined) throw new Bad(field, "is required");
    if (typeof v !== "number" || !Number.isInteger(v) || v < min) throw new Bad(field, `must be a whole number of at least ${min}`);
    return v;
  };
  const words = (field: string, v: unknown): string => {
    if (v === undefined) throw new Bad(field, "is required");
    if (typeof v !== "string" || !v.trim()) throw new Bad(field, "must be text that isn't empty");
    return v.trim();
  };

  if (o.version === undefined) throw new Bad("version", "is required");
  if (typeof o.version === "number" && Number.isInteger(o.version) && o.version > 1) throw new Bad("version", `is ${o.version}: written for a newer runner; update the Isoplan plugin on this machine`);
  if (o.version !== 1) throw new Bad("version", "must be 1");

  if (o.name === undefined) throw new Bad("name", "is required");
  if (typeof o.name !== "string" || !ExpertNameSchema.safeParse(o.name).success) throw new Bad("name", "must be lowercase letters, digits and dashes, at most 63, starting with a letter or digit");
  if (o.name !== base) throw new Bad("name", `is "${o.name}", but the file is ${base}.json; they must be the same`);

  const repo = words("repo", o.repo);
  if (!path.isAbsolute(repo)) throw new Bad("repo", "must be the full path of the repo's folder");

  const subject = words("subject", o.subject);
  if (subject.length > MAX_EXPERT_SUBJECT_LENGTH) throw new Bad("subject", `must be at most ${MAX_EXPERT_SUBJECT_LENGTH} characters`);

  const model = words("model", o.model);
  if (model.startsWith("-")) throw new Bad("model", "must be a model name, not starting with -");

  const caps = o.caps === undefined ? {} : o.caps;
  if (!isObject(caps)) throw new Bad("caps", "must be an object");
  if (o.proof === undefined) throw new Bad("proof", "is required");
  if (!isObject(o.proof)) throw new Bad("proof", "must be an object with a question and its answer");
  if (o.areas !== undefined && !(Array.isArray(o.areas) && o.areas.every((a) => typeof a === "string"))) throw new Bad("areas", "must be a list of globs");

  const expert: ExpertFile = {
    version: 1,
    name: o.name,
    repo,
    subject,
    model,
    promoteAtTokens: whole("promoteAtTokens", o.promoteAtTokens, 1),
    forkTimeLimitMinutes: whole("forkTimeLimitMinutes", o.forkTimeLimitMinutes, 1, EXPERT_DEFAULTS.forkTimeLimitMinutes),
    groundingTimeLimitMinutes: whole("groundingTimeLimitMinutes", o.groundingTimeLimitMinutes, 1, EXPERT_DEFAULTS.groundingTimeLimitMinutes),
    fetchSeconds: whole("fetchSeconds", o.fetchSeconds, 0, EXPERT_DEFAULTS.fetchSeconds),
    maxForks: whole("maxForks", o.maxForks, 1, EXPERT_DEFAULTS.maxForks),
    caps: {
      perAskerPerDay: whole("caps.perAskerPerDay", caps.perAskerPerDay, 1, EXPERT_DEFAULTS.caps.perAskerPerDay),
      openPerAsker: whole("caps.openPerAsker", caps.openPerAsker, 1, EXPERT_DEFAULTS.caps.openPerAsker),
      tokenBudgetPerDay: whole("caps.tokenBudgetPerDay", caps.tokenBudgetPerDay, 1, EXPERT_DEFAULTS.caps.tokenBudgetPerDay),
    },
    proof: { question: words("proof.question", o.proof.question), answer: words("proof.answer", o.proof.answer) },
    ...(o.window !== undefined && { window: whole("window", o.window, 100_000) }),
    areas: (o.areas as string[] | undefined) ?? [],
  };
  const unknown = [
    ...Object.keys(o).filter((k) => !KNOWN.includes(k)),
    ...Object.keys(caps).filter((k) => !KNOWN_CAPS.includes(k)).map((k) => `caps.${k}`),
    ...Object.keys(o.proof).filter((k) => !KNOWN_PROOF.includes(k)).map((k) => `proof.${k}`),
  ];
  return { ok: true, expert, unknown };
}
