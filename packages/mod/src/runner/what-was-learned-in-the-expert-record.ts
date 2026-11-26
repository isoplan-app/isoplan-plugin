// What this computer has of each expert record's sequence of things its instances learned
// (isoplan-app#366, A2): experts/<key>/what-was-learned-in-the-expert-record.json, per record
// (`expertRecordId`), never per server, and the rules for taking what an office sends of it
// (`expert-learned-since`). Pure: what-was-learned-for-one-expert.ts applies them and writes.
//
// - The sequence is numbered by the office as each entry reaches the record: 1, 2, 3, … A message is
//   taken only when it continues from this computer's last number (`lastArrivalNumberReceived`), or
//   is the first page of an answer `startedAgain` from 0, or a page continuing a rebuild under way.
//   Anything else is left, and the link asks again.
// - Over the sequence both sides keep a chain: sha256 of the chain before, "\n" and each entry's
//   `arrivalEntryId`, "" before the first. The chain this computer works out at a message's last
//   entry must be the message's own, or nothing of it is taken and the link asks again. So a server
//   restored from an older copy is found even once its numbers have passed this computer's again.
// - A message whose `lastArrivalNumber` is below this computer's last number (a shorter sequence on
//   the server) is left, and the link asks again: this computer always asks after its own number with
//   its own chain, and the server answers `startedAgain` whenever its history differs.
// - `startedAgain`: the record's entries are rebuilt from the answer's pages once its last came.
//   Every removal this computer saw stays (a thing removed is never carried or sent again, even if a
//   restored server has it again). This computer's own things that the rebuilt sequence doesn't name
//   and weren't removed go back to waiting, to be sent again.
// - `learned` entries are kept, the newest 1000; `learned-then-removed` and `removed` entries go in
//   `removed` (all, while the record exists) and take the thing out of the entries.
// - `keptNotYetReceived`: this computer's own things the server answered `kept` but whose entry
//   hasn't come yet. Its entry coming moves it into the entries, marked `learnedHere`. One the server
//   no longer holds at its number (a message's `lastArrivalNumber` is below it, or another entry is
//   at it: a restored server that lost it) goes back to waiting. So once the server answered `kept`,
//   a thing is always in one of the two files until its own entry has come.

import { createHash } from "node:crypto";
import { arrivalEntryId, type ExpertLearnedSinceMessage, type FileWhatWasLearnedRestsOn, type WhatWasLearnedEntry } from "@isoplan/protocol";

/** How many things learned a record's part of the file keeps: the newest. */
export const NEWEST_KEPT = 1000;

/** A thing learned, by an instance on this computer or another, as the record numbered it. */
export interface ThingReceived {
  arrivalNumber: number;
  id: string;
  text: string;
  files: FileWhatWasLearnedRestsOn[];
  learnedAt: string;
  /** This computer's own. */
  learnedHere?: true;
}

/** This computer's own thing learned that the server answered `kept`, its entry not come yet. */
export interface ThingKeptNotYetReceived {
  arrivalNumber: number;
  id: string;
  text: string;
  files: FileWhatWasLearnedRestsOn[];
  learnedAt: string;
  generation: number;
  firstLine: string;
}

export interface Removal {
  id: string;
  arrivalNumber: number;
  /** When it was removed, from a `removed` entry. */
  at?: string;
  /** Its first line, where this computer had it. */
  firstLine?: string;
}

export interface ReceivedForOneRecord {
  server: string;
  lastArrivalNumberReceived: number;
  chain: string;
  serverLastArrivalNumber: number;
  entries: ThingReceived[];
  removed: Removal[];
  keptNotYetReceived: ThingKeptNotYetReceived[];
}

export interface ReceivedFile {
  version: 1;
  records: Record<string, ReceivedForOneRecord>;
}

/** A record's part before anything of it came. */
export const nothingReceived = (server: string): ReceivedForOneRecord => ({ server, lastArrivalNumberReceived: 0, chain: "", serverLastArrivalNumber: 0, entries: [], removed: [], keptNotYetReceived: [] });

/** The chain after `entry`. */
export const chainAfter = (chain: string, entry: Pick<WhatWasLearnedEntry, "kind" | "id">) => createHash("sha256").update(`${chain}\n${arrivalEntryId(entry)}`).digest("hex");

/** The chain over `entries`, from `chain`. */
export const chainOver = (chain: string, entries: readonly Pick<WhatWasLearnedEntry, "kind" | "id">[]) => entries.reduce(chainAfter, chain);

/** A thing's first line, as lists and the health log show it: at most 120 characters. */
export const firstLineOf = (text: string) => text.split(/\r?\n/)[0]!.slice(0, 120);

/** A rebuild under way: the pages of an answer `startedAgain`, taken so far. */
export interface Rebuilding {
  last: number;
  chain: string;
  entries: WhatWasLearnedEntry[];
}

/** One of this computer's own things to send again: it went back to waiting. */
export type BackToWaiting = Omit<ThingKeptNotYetReceived, "arrivalNumber">;

export type Taken =
  | { kind: "taken"; record: ReceivedForOneRecord; backToWaiting: BackToWaiting[]; rebuilt?: { sequence: WhatWasLearnedEntry[]; oldNumbers: ReadonlyMap<string, number> } }
  | { kind: "page-of-a-rebuild"; rebuilding: Rebuilding }
  | { kind: "ask-again"; why: string };

const own = (t: ThingReceived | ThingKeptNotYetReceived, generation = 0): BackToWaiting => ({ id: t.id, text: t.text, files: t.files, learnedAt: t.learnedAt, generation: "generation" in t ? t.generation : generation, firstLine: "firstLine" in t ? t.firstLine : firstLineOf(t.text) });

// Each entry applied to `r` in order; what went back to waiting.
function apply(r: ReceivedForOneRecord, entries: readonly WhatWasLearnedEntry[], serverLast: number): BackToWaiting[] {
  const back: BackToWaiting[] = [];
  const removedIds = new Set(r.removed.map((x) => x.id));
  for (const e of entries) {
    // Another entry at a kept thing's number: a restored server lost it.
    for (const k of r.keptNotYetReceived.filter((k) => k.arrivalNumber === e.arrivalNumber && !(e.kind !== "removed" && e.id === k.id))) {
      back.push(own(k));
      r.keptNotYetReceived = r.keptNotYetReceived.filter((x) => x !== k);
    }
    if (e.kind === "learned") {
      const kept = r.keptNotYetReceived.find((k) => k.id === e.id);
      const before = r.entries.find((x) => x.id === e.id);
      r.keptNotYetReceived = r.keptNotYetReceived.filter((k) => k.id !== e.id);
      r.entries = r.entries.filter((x) => x.id !== e.id);
      if (!removedIds.has(e.id)) r.entries.push({ arrivalNumber: e.arrivalNumber, id: e.id, text: e.text, files: e.files, learnedAt: e.learnedAt, ...((kept || before?.learnedHere) && { learnedHere: true as const }) });
    } else {
      const had = r.entries.find((x) => x.id === e.id) ?? r.keptNotYetReceived.find((x) => x.id === e.id);
      if (!removedIds.has(e.id)) {
        removedIds.add(e.id);
        r.removed.push({ id: e.id, arrivalNumber: e.arrivalNumber, ...(e.kind === "removed" && { at: e.at }), ...(had && { firstLine: firstLineOf(had.text) }) });
      } else if (e.kind === "removed") {
        const x = r.removed.find((x) => x.id === e.id)!;
        x.at ??= e.at;
      }
      r.entries = r.entries.filter((x) => x.id !== e.id);
      r.keptNotYetReceived = r.keptNotYetReceived.filter((x) => x.id !== e.id);
    }
    r.lastArrivalNumberReceived = e.arrivalNumber;
  }
  r.serverLastArrivalNumber = serverLast;
  // Kept at a number the server no longer has: lost.
  for (const k of r.keptNotYetReceived.filter((k) => k.arrivalNumber > serverLast)) back.push(own(k));
  r.keptNotYetReceived = r.keptNotYetReceived.filter((k) => k.arrivalNumber <= serverLast);
  r.entries.sort((a, b) => a.arrivalNumber - b.arrivalNumber);
  if (r.entries.length > NEWEST_KEPT) r.entries = r.entries.slice(-NEWEST_KEPT);
  return back;
}

/** Takes `m` into `before` (this computer's part of its record, untouched), given a rebuild under way. */
export function takeLearnedSince(before: ReceivedForOneRecord, rebuilding: Rebuilding | null, m: ExpertLearnedSinceMessage): Taken {
  const pages = rebuilding ?? (m.startedAgain ? { last: 0, chain: "", entries: [] } : null);
  if (pages) {
    if (rebuilding && (m.startedAgain || m.afterArrivalNumber !== rebuilding.last)) return { kind: "ask-again", why: `a page after ${m.afterArrivalNumber} doesn't continue the sequence being rebuilt, at ${rebuilding.last}` };
    if (chainOver(pages.chain, m.entries) !== m.chain) return { kind: "ask-again", why: "its chain isn't the one its entries make" };
    const next: Rebuilding = { last: m.entries.at(-1)?.arrivalNumber ?? pages.last, chain: m.chain, entries: [...pages.entries, ...m.entries] };
    if (m.more) return { kind: "page-of-a-rebuild", rebuilding: next };
    return rebuild(before, next.entries, m.lastArrivalNumber);
  }
  if (m.afterArrivalNumber !== before.lastArrivalNumberReceived) return { kind: "ask-again", why: `it continues from ${m.afterArrivalNumber}, not from this computer's last, ${before.lastArrivalNumberReceived}` };
  if (m.lastArrivalNumber < before.lastArrivalNumberReceived) return { kind: "ask-again", why: `the server's last is ${m.lastArrivalNumber}, below this computer's ${before.lastArrivalNumberReceived}` };
  if (chainOver(before.chain, m.entries) !== m.chain) return { kind: "ask-again", why: "its chain isn't the one this computer's sequence and its entries make" };
  const r = structuredClone(before);
  const back = apply(r, m.entries, m.lastArrivalNumber);
  r.chain = m.chain;
  return { kind: "taken", record: r, backToWaiting: back };
}

// The record's part made again from a whole sequence: what this computer saw removed stays removed,
// and its own things the sequence doesn't name go back to waiting.
function rebuild(before: ReceivedForOneRecord, sequence: WhatWasLearnedEntry[], serverLast: number): Taken {
  const named = new Set(sequence.map((e) => e.id));
  const oldNumbers = new Map<string, number>([...before.entries, ...before.keptNotYetReceived].map((t) => [t.id, t.arrivalNumber]));
  const removed = new Set(before.removed.map((x) => x.id));
  const r: ReceivedForOneRecord = { ...nothingReceived(before.server), removed: structuredClone(before.removed), keptNotYetReceived: before.keptNotYetReceived.filter((k) => named.has(k.id)) };
  const back: BackToWaiting[] = [
    ...before.entries.filter((t) => t.learnedHere && !named.has(t.id) && !removed.has(t.id)).map((t) => own(t)),
    ...before.keptNotYetReceived.filter((k) => !named.has(k.id) && !removed.has(k.id)).map((k) => own(k)),
  ];
  // Its own things the sequence names again are still its own.
  const mine = new Set(before.entries.filter((t) => t.learnedHere).map((t) => t.id));
  back.push(...apply(r, sequence, serverLast));
  for (const t of r.entries) if (mine.has(t.id)) t.learnedHere = true;
  r.chain = chainOver("", sequence);
  return { kind: "taken", record: r, backToWaiting: back, rebuilt: { sequence, oldNumbers } };
}

/**
 * A generation's `pickedUpTo` for a record after a rebuild: the highest new arrival number N such that
 * every `learned` entry numbered up to N in the rebuilt sequence was, before it, at or below the old
 * `pickedUpTo` or is in its trunk. So what is new to it is carried, and only what it had taken into
 * account past the restore's point counts as not picked up again.
 */
export function pickedUpToAfterARebuild(sequence: readonly WhatWasLearnedEntry[], oldNumbers: ReadonlyMap<string, number>, oldPickedUpTo: number, inItsTrunk: ReadonlySet<string>): number {
  for (const e of sequence) {
    if (e.kind !== "learned") continue;
    const old = oldNumbers.get(e.id);
    if (!((old !== undefined && old <= oldPickedUpTo) || inItsTrunk.has(e.id))) return e.arrivalNumber - 1;
  }
  return sequence.at(-1)?.arrivalNumber ?? 0;
}
