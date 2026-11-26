// What this computer's instance of an expert learned that waits to be sent to its expert records
// (isoplan-app#366, A3): experts/<key>/what-was-learned-waiting-to-be-sent.json. A fork's thing
// learned is written here before it is added to the junior's trunk, so neither a stop nor offline
// time loses it.
//
// - It has a part per record this computer's file is tied to when it is kept, by the record's id with
//   its office server. With none tied yet (never published, a refused name, or its project in no
//   office) it waits for a record (`waitingForARecord`), and gets a part for each record tied the
//   first time the file is tied to any.
// - A part goes once its server answers `kept` (the thing moving to the received file first),
//   `removed` or `record-gone`, or when its record goes. A thing goes with its last part, once its
//   addition to the junior's trunk has ended (`added`: or never will, its generation no longer the
//   junior).
// - One a check matched before it could leave is kept on this computer only (`staysOnThisComputer`,
//   with the pattern's name): its parts go, and it goes once its addition has ended.
// - At most MAX_WAITING_PER_RECORD things per record, and as many waiting for a record: past that
//   the oldest goes.

import path from "node:path";
import type { FileWhatWasLearnedRestsOn } from "@isoplan/protocol";
import { readJson, writeJson } from "./expert-state.js";

/** The most things that wait for one record, and that wait for a record. */
export const MAX_WAITING_PER_RECORD = 500;

/** A thing a fork of this computer's instance learned. */
export interface ThingLearnedHere {
  /** Made here; the record keeps one of each. */
  id: string;
  text: string;
  /** The files it rests on, with the commit each was read at where it is known. */
  files: FileWhatWasLearnedRestsOn[];
  learnedAt: string;
  /** The generation whose fork learned it. */
  generation: number;
  firstLine: string;
}

export interface WaitingThing extends ThingLearnedHere {
  /** By record id: the office server each record is on. */
  parts: Record<string, { server: string }>;
  waitingForARecord?: true;
  staysOnThisComputer?: { pattern: string };
  /** Its addition to the junior's trunk has ended, or never will. */
  added?: true;
}

export interface WaitingFile {
  version: 1;
  things: WaitingThing[];
}

export const waitingPath = (expertDir: string) => path.join(expertDir, "what-was-learned-waiting-to-be-sent.json");

export async function readWaiting(expertDir: string): Promise<WaitingFile> {
  const o = (await readJson(waitingPath(expertDir))) as WaitingFile | null;
  if (!o || o.version !== 1 || !Array.isArray(o.things)) return { version: 1, things: [] };
  return o;
}

export const writeWaiting = (expertDir: string, file: WaitingFile) => writeJson(waitingPath(expertDir), file);

/** Whether a thing has nothing left to wait for. */
export const done = (t: WaitingThing) => !!t.added && !t.waitingForARecord && !Object.keys(t.parts).length;

/** The things past MAX_WAITING_PER_RECORD for a record, or waiting for a record, oldest first: each loses that part, or its wait. */
export function overTheCap(things: readonly WaitingThing[]): { thing: WaitingThing; record: string | null }[] {
  const over: { thing: WaitingThing; record: string | null }[] = [];
  const records = new Set(things.flatMap((t) => Object.keys(t.parts)));
  for (const record of records) {
    const waiting = things.filter((t) => Object.hasOwn(t.parts, record));
    for (const thing of waiting.slice(0, Math.max(0, waiting.length - MAX_WAITING_PER_RECORD))) over.push({ thing, record });
  }
  const unplaced = things.filter((t) => t.waitingForARecord);
  for (const thing of unplaced.slice(0, Math.max(0, unplaced.length - MAX_WAITING_PER_RECORD))) over.push({ thing, record: null });
  return over;
}
