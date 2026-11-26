// What an expert keeps in its folder, ~/.claude/isoplan/experts/<name>/, across runner restarts:
//
// - state.json: its generations, each with its trunk's session id, the model id it resolved to,
//   the commit it was grounded at, its meter, its role and its proof, the uuid of its trunk
//   transcript's last user or assistant entry as the runner left it, and what its trunk holds of what
//   this expert's instances learned (`addedToItsTrunk`, each by its id) with how far it has taken
//   each expert record's sequence into account (`pickedUpTo`); and the fingerprint of the expert
//   file fields a new generation is grounded for. Version 3 (#366) keeps those two. Version 2 (#340)
//   is a state whose generations were all grounded since this computer kept instances set up from
//   expert records (`setUpFromExpertRecord`), and counted what was added to a trunk with no ids: it
//   still reads, its count kept as `addedBeforeEachHadAnId`, and is written as version 3. Version 1,
//   from before, still reads too, and its expert grounds a new generation that retires the old ones
//   once it passes (expert.ts).
// - index-<n>.json: generation n's file → commit index, `{ "version": 1, "files": { path: commit } }`,
//   the commit each file the generation read, cited or was told of (a file a thing it was given
//   rests on) was read at.
//
// Both are written to a temporary file and renamed into place, so a reader never sees half of one.
// A file that is missing or doesn't parse reads as none.

import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { ExpertFile } from "./expert-file.js";

export interface SavedGeneration {
  n: number;
  /** Its trunk's session id, a uuid. */
  trunk: string;
  /** The model id its grounding resolved to, which every later process of it runs. */
  model: string;
  /** The read checkout's commit at its grounding. */
  commit: string;
  groundedAt: number;
  /** Its trunk's context after its last turn. */
  meter: number;
  /** Its trunk's context right after its grounding; missing in a state from before it was recorded. */
  groundingTokens?: number;
  /** What its trunk holds of what this expert's instances learned, here and elsewhere: by its grounding or an addition. */
  addedToItsTrunk: AddedToItsTrunk[];
  /** By expert record: the arrival number up to which it has taken that record's sequence into account. */
  pickedUpTo: Record<string, number>;
  /** From a state before version 3: how many things were added to its trunk before each had an id. */
  addedBeforeEachHadAnId?: number;
  state: "grounding" | "junior" | "senior" | "retired" | "failed";
  proof?: { passed: boolean; at: number };
  /**
   * The uuid of its trunk transcript's last user or assistant entry after the runner's last turn on
   * it (null for none), so a turn someone added by resuming it by hand shows; missing in a state
   * from before it was recorded.
   */
  last?: string | null;
  /** Why it failed or was retired. */
  why?: string;
}

/** A thing learned its trunk holds. */
export interface AddedToItsTrunk {
  id: string;
  firstLine: string;
  /** The record and arrival number it came with, for one learned elsewhere. */
  expertRecordId?: string;
  arrivalNumber?: number;
}

/** state.json. */
export interface SavedExpert {
  version: 1 | 2 | 3;
  /** With version 2 or 3: every generation was grounded since this computer kept instances set up from expert records. */
  setUpFromExpertRecord?: true;
  fingerprint: string;
  repo: string;
  /** Origin's default branch, which the read checkout follows. */
  branch: string;
  generations: SavedGeneration[];
}

export const statePath = (dir: string) => path.join(dir, "state.json");
export const indexPath = (dir: string, n: number) => path.join(dir, `index-${n}.json`);

const STATES = ["grounding", "junior", "senior", "retired", "failed"];

/** The name a state before version 3 gave its generation's count of what was added to its trunk: read, never written. */
export const COUNT_BEFORE_VERSION_3 = "notes";

type Before3 = SavedGeneration & { [COUNT_BEFORE_VERSION_3]?: number };

// A generation of version 3, or of a version before it, which counted what was added to its trunk.
const isGeneration = (g: unknown): g is Before3 => {
  const o = g as Before3 | null;
  const holds = Number.isInteger(o?.[COUNT_BEFORE_VERSION_3]) || (Array.isArray(o?.addedToItsTrunk) && o.addedToItsTrunk.every((x) => typeof x?.id === "string") && !!o.pickedUpTo && typeof o.pickedUpTo === "object");
  return !!o && Number.isInteger(o.n) && typeof o.trunk === "string" && typeof o.model === "string" && typeof o.commit === "string" && Number.isFinite(o.groundedAt) && Number.isFinite(o.meter) && holds && STATES.includes(o.state) && (o.last === undefined || o.last === null || typeof o.last === "string");
};

// A generation of a state before version 3, as version 3 keeps it.
function asVersion3(g: Before3): SavedGeneration {
  const count = g[COUNT_BEFORE_VERSION_3];
  if (count === undefined) return g;
  const { [COUNT_BEFORE_VERSION_3]: _, ...rest } = g;
  return { ...rest, addedToItsTrunk: [], pickedUpTo: {}, ...(count > 0 && { addedBeforeEachHadAnId: count }) };
}

export async function readJson(file: string): Promise<unknown> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch {
    return null;
  }
}

/** Writes `value` as JSON whole: a reader never sees half of it. */
export async function writeJson(file: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(temp, JSON.stringify(value, null, 2) + "\n");
  // On Windows a reader that has the file open makes the rename fail for a moment.
  for (let tries = 0; ; tries++) {
    try {
      return await fs.rename(temp, file);
    } catch (err) {
      if (tries >= 5 || !["EPERM", "EBUSY", "EACCES"].includes((err as NodeJS.ErrnoException).code ?? "")) throw err;
      await new Promise((r) => setTimeout(r, 50 * (tries + 1)));
    }
  }
}

/** The expert's state.json, or null when there is none it can use; a version 2 reads as version 3. */
export async function readState(dir: string): Promise<SavedExpert | null> {
  const o = (await readJson(statePath(dir))) as SavedExpert | null;
  if (!o || (o.version !== 1 && o.version !== 2 && o.version !== 3) || typeof o.fingerprint !== "string" || typeof o.repo !== "string" || typeof o.branch !== "string" || !Array.isArray(o.generations) || !o.generations.every(isGeneration)) return null;
  return { ...o, version: o.version === 2 ? 3 : o.version, generations: o.generations.map(asVersion3) };
}

export const writeState = (dir: string, s: SavedExpert) => writeJson(statePath(dir), s);

/** Generation n's file → commit index; empty when it has none. */
export async function readIndex(dir: string, n: number): Promise<Record<string, string>> {
  const files = ((await readJson(indexPath(dir, n))) as { version?: unknown; files?: unknown } | null)?.files;
  if (!files || typeof files !== "object" || Array.isArray(files)) return {};
  return Object.fromEntries(Object.entries(files).filter((e): e is [string, string] => typeof e[1] === "string"));
}

export const writeIndex = (dir: string, n: number, index: Record<string, string>) => writeJson(indexPath(dir, n), { version: 1, files: index });

/** The expert file fields a new generation is grounded for: a change to any of them starts one. */
export function fingerprint(file: ExpertFile): string {
  return createHash("sha256")
    .update(JSON.stringify([file.repo, file.subject, file.model, file.proof.question, file.proof.answer, file.window ?? null]))
    .digest("hex");
}
