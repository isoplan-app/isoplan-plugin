// What one expert's instance on this computer learned and was told of (isoplan-app#366): the only
// writer of its waiting file (what-was-learned-waiting-to-be-sent.ts) and its received file
// (what-was-learned-in-the-expert-record.ts), one per key, made by the registry (experts.ts). It holds
// both in memory and writes each through one promise chain, a copy at a time, as state.json is
// written: two writes at once would share a temporary file.
//
// The expert asks it what its generation hasn't picked up, what was removed on the card, and what a
// new generation's grounding may carry; each office's link (what-was-learned-link.ts) gives it what
// that office answered and sent. It is bound, once the instances and links exist, to which records
// this computer's file of the key is tied to (expert-instance.ts) and how far each link's ask has
// got. The runner, never the model, decides what is new: by arrival number, id and chain only.

import path from "node:path";
import type { ExpertLearnedSinceMessage, FileWhatWasLearnedRestsOn } from "@isoplan/protocol";
import { readJson, writeJson } from "./expert-state.js";
import { firstLineOf, nothingReceived, pickedUpToAfterARebuild, takeLearnedSince, type BackToWaiting, type ReceivedFile, type Rebuilding } from "./what-was-learned-in-the-expert-record.js";
import { done, overTheCap, readWaiting, writeWaiting, type ThingLearnedHere, type WaitingFile, type WaitingThing } from "./what-was-learned-waiting-to-be-sent.js";

/** A thing learned a fork may be told of: one an office numbered (its record and number), or one of this computer's own still waiting. */
export interface ThingToCarry {
  id: string;
  text: string;
  files: FileWhatWasLearnedRestsOn[];
  learnedAt: string;
  expertRecordId?: string;
  arrivalNumber?: number;
}

/** How far an office's link has got with this connection's ask for a record. */
export type CatchUp = "answered" | "in-pages" | "waiting" | "cannot";

/** What the module is bound to once the instances and links exist. */
export interface WhatWasLearnedBinding {
  /** The records this computer's file of the key is tied to now. */
  tied(): { server: string; expertRecordId: string }[];
  /** The record of the key this computer keeps for `server`, tied or not. */
  held(server: string): string | undefined;
  /** The office servers in config.json. */
  servers: readonly string[];
  catchUp(server: string, expertRecordId: string): CatchUp;
  /** A thing now waits to be sent. */
  waiting(): void;
}

/** What a generation keeps of what it was given (state.json). */
export interface WhatAGenerationHolds {
  addedToItsTrunk: { id: string }[];
  pickedUpTo: Record<string, number>;
}

export interface WhatWasLearnedForOneExpert {
  /** Reads both files, once; nothing is written before. Once bound too, its ties are looked at and what waits is sent. */
  load(): Promise<void>;
  /** Both files are read. */
  loaded(): boolean;
  bind(binding: WhatWasLearnedBinding): void;
  /** Its ties may have changed: a first tie gives the things waiting for a record their parts; a record this computer no longer keeps goes. */
  checkTies(): void;
  /** A3: written to the waiting file, with a part for each record tied (none yet: it waits for one); settles once it is on disk. */
  keepBeforeAdding(thing: ThingLearnedHere): Promise<void>;
  /** These things' addition to the junior's trunk ended, or never will. */
  additionEnded(ids: readonly string[]): void;
  /** At start: the junior's things still waiting that its trunk doesn't hold, to add now; the rest count as added. */
  toAddAtStart(junior: number | null, holds: ReadonlySet<string>): ThingLearnedHere[];
  /** What a generation hasn't picked up: received after its pickedUpTo, not removed, not in its trunk, in arrival order; and each record's last received now. */
  notPickedUp(g: WhatAGenerationHolds): { things: ThingToCarry[]; upTo: Record<string, number> };
  /** The things removed on the card, from every record: each with its first line where this computer had it. */
  removed(): ReadonlyMap<string, string | null>;
  /** For a new generation's grounding: received, kept and waiting things, not removed, newest first. */
  newestFirst(): ThingToCarry[];
  /** Each record's last arrival number received. */
  lastReceived(): Record<string, number>;
  /** Whether a check kept it on this computer only. */
  staying(id: string): boolean;
  /** Whether an answer to an ask is still coming in pages, for a record tied. */
  catchingUpInPages(): boolean;
  /** Settles once every record tied has had this connection's ask answered in full, or none can, or `ms` passed; not yet bound, it waits. */
  caughtUp(ms: number): Promise<void>;
  /**
   * A record's sequence was rebuilt: how each generation's pickedUpTo for it maps. One listener, the
   * expert that holds the key's state now: a later one replaces it, so an expert stopped when its file
   * was removed no longer writes its state once the file is back and another expert holds it.
   */
  onRebuilt(listener: (expertRecordId: string, pickedUpTo: (old: number, inItsTrunk: ReadonlySet<string>) => number) => void): void;

  /** The number and chain to ask after: this computer's own. A rebuild under way is dropped, since a new answer starts. */
  askAfter(expertRecordId: string): { afterArrivalNumber: number; chain: string };
  /** The things waiting for a record, oldest first, none a check kept here. */
  waitingFor(expertRecordId: string): WaitingThing[];
  take(expertRecordId: string, server: string, m: ExpertLearnedSinceMessage): "taken" | "in-pages" | { askAgain: string };
  answered(expertRecordId: string, id: string, outcome: "kept" | "removed" | "record-gone" | "not-an-instance-here", arrivalNumber?: number): void;
  /** The record is gone: what this computer has of it goes from both files. */
  recordGone(expertRecordId: string): void;
  staysOnThisComputer(id: string, pattern: string): void;
  /** Its folder is being deleted: nothing more is written. */
  forget(): void;
  written(): Promise<void>;
}

export const receivedPath = (expertDir: string) => path.join(expertDir, "what-was-learned-in-the-expert-record.json");

async function readReceived(expertDir: string): Promise<ReceivedFile> {
  const o = (await readJson(receivedPath(expertDir))) as ReceivedFile | null;
  if (!o || o.version !== 1 || !o.records || typeof o.records !== "object" || Array.isArray(o.records)) return { version: 1, records: {} };
  return o;
}

export interface WhatWasLearnedForOneExpertOptions {
  /** The expert's folder, experts/<key>. */
  dir: string;
  log: (text: string) => void;
  now?: () => number;
}

export function createWhatWasLearnedForOneExpert(o: WhatWasLearnedForOneExpertOptions): WhatWasLearnedForOneExpert {
  let waiting: WaitingFile = { version: 1, things: [] };
  let received: ReceivedFile = { version: 1, records: {} };
  let binding: WhatWasLearnedBinding | null = null;
  let forgotten = false;
  let reading: Promise<void> | null = null;
  let isLoaded = false;
  let writing: Promise<void> = Promise.resolve();
  const rebuilding = new Map<string, Rebuilding>();
  let rebuiltListener: ((expertRecordId: string, pickedUpTo: (old: number, inItsTrunk: ReadonlySet<string>) => number) => void) | null = null;

  // The waiting file first, so a thing going back to waiting is there before it leaves the received
  // file; after a `kept` answer the received file first, so the thing is there before it leaves the
  // waiting file. A stop between the two writes never leaves a thing in neither.
  const save = (receivedFirst = false) => {
    if (forgotten || !isLoaded) return writing;
    const w = structuredClone(waiting);
    const r = structuredClone(received);
    const writes = [() => writeWaiting(o.dir, w), () => writeJson(receivedPath(o.dir), r)];
    if (receivedFirst) writes.reverse();
    writing = writing
      .then(async () => {
        for (const write of writes) {
          if (forgotten) return;
          await write();
        }
      })
      .catch((err: Error) => o.log(`couldn't write what it learned: ${err.message}`));
    return writing;
  };

  // Things with nothing left to wait for go, and so does the oldest past the cap.
  function prune() {
    for (const { thing, record } of overTheCap(waiting.things)) {
      if (record === null) {
        delete thing.waitingForARecord;
        o.log(`dropped the oldest thing it learned waiting for a record, past the most that wait: "${thing.firstLine}"`);
      } else {
        delete thing.parts[record];
        o.log(`dropped the oldest thing it learned waiting to be sent to record ${record}, past the most that wait: "${thing.firstLine}"`);
      }
    }
    waiting.things = waiting.things.filter((t) => !done(t));
  }

  const partsFor = (tied: { server: string; expertRecordId: string }[]) => Object.fromEntries(tied.map((r) => [r.expertRecordId, { server: r.server }]));
  const removedIds = () => new Set(Object.values(received.records).flatMap((r) => r.removed.map((x) => x.id)));

  function backToWaiting(b: BackToWaiting, expertRecordId: string, server: string) {
    const there = waiting.things.find((t) => t.id === b.id);
    if (there) there.parts[expertRecordId] = { server };
    else waiting.things.push({ ...b, parts: { [expertRecordId]: { server } }, added: true });
    o.log(`its record ${expertRecordId} on ${server} no longer has what it learned, "${b.firstLine}", so it is sent again`);
  }

  function dropRecord(expertRecordId: string) {
    delete received.records[expertRecordId];
    rebuilding.delete(expertRecordId);
    for (const t of waiting.things) delete t.parts[expertRecordId];
  }

  const tiedNow = () => binding?.tied() ?? [];

  // Read and bound: parts for servers no longer in config.json go, its ties are looked at, and what waits is sent.
  function bound(b: WhatWasLearnedBinding) {
    for (const t of waiting.things) for (const [r, part] of Object.entries(t.parts)) if (!b.servers.includes(part.server)) delete t.parts[r];
    checkTies();
    prune();
    void save();
    b.waiting();
  }

  function checkTies() {
    if (!binding || forgotten || !isLoaded) return;
    const tied = binding.tied();
    let changed = false;
    if (tied.length) {
      for (const t of waiting.things.filter((t) => t.waitingForARecord)) {
        delete t.waitingForARecord;
        t.parts = partsFor(tied);
        changed = true;
        o.log(`its file is tied to a record now, so what it learned before goes to it: "${t.firstLine}"`);
      }
    }
    const known = new Map<string, string>(Object.entries(received.records).map(([r, x]) => [r, x.server]));
    for (const t of waiting.things) for (const [r, part] of Object.entries(t.parts)) known.set(r, part.server);
    for (const [r, server] of known) {
      if (binding.held(server) === r) continue;
      dropRecord(r);
      changed = true;
      o.log(`its record ${r} on ${server} is no longer this computer's, so what it has of it goes`);
    }
    if (!changed) return;
    prune();
    void save();
    binding.waiting();
  }


  return {
    load() {
      reading ??= (async () => {
        waiting = await readWaiting(o.dir);
        received = await readReceived(o.dir);
        isLoaded = true;
        if (binding) bound(binding);
      })();
      return reading;
    },

    loaded: () => isLoaded,

    bind(b) {
      binding = b;
      if (isLoaded) bound(b);
    },

    checkTies,

    async keepBeforeAdding(thing) {
      const tied = tiedNow();
      waiting.things.push({ ...thing, parts: partsFor(tied), ...(!tied.length && { waitingForARecord: true as const }) });
      if (!tied.length) o.log(`kept what it learned, "${thing.firstLine}", until its file is tied to a record`);
      prune();
      await save();
      binding?.waiting();
    },

    additionEnded(ids) {
      const ended = new Set(ids);
      for (const t of waiting.things) if (ended.has(t.id)) t.added = true;
      prune();
      void save();
    },

    toAddAtStart(junior, holds) {
      const add: ThingLearnedHere[] = [];
      for (const t of waiting.things) {
        if (t.added) continue;
        if (t.generation === junior && !holds.has(t.id)) add.push({ id: t.id, text: t.text, files: t.files, learnedAt: t.learnedAt, generation: t.generation, firstLine: t.firstLine });
        else t.added = true;
      }
      prune();
      void save();
      return add;
    },

    notPickedUp(g) {
      const inItsTrunk = new Set(g.addedToItsTrunk.map((x) => x.id));
      const removed = removedIds();
      const seen = new Set<string>();
      const things: ThingToCarry[] = [];
      const upTo: Record<string, number> = {};
      for (const [r, rec] of Object.entries(received.records)) {
        upTo[r] = rec.lastArrivalNumberReceived;
        const from = g.pickedUpTo[r] ?? 0;
        for (const e of rec.entries) {
          if (e.arrivalNumber <= from || inItsTrunk.has(e.id) || removed.has(e.id) || seen.has(e.id)) continue;
          seen.add(e.id);
          things.push({ id: e.id, text: e.text, files: e.files, learnedAt: e.learnedAt, expertRecordId: r, arrivalNumber: e.arrivalNumber });
        }
      }
      return { things, upTo };
    },

    removed() {
      const out = new Map<string, string | null>();
      for (const r of Object.values(received.records)) for (const x of r.removed) out.set(x.id, x.firstLine ?? out.get(x.id) ?? waiting.things.find((t) => t.id === x.id)?.firstLine ?? null);
      return out;
    },

    newestFirst() {
      const removed = removedIds();
      const out = new Map<string, ThingToCarry>();
      for (const [r, rec] of Object.entries(received.records)) {
        for (const e of rec.entries) out.set(e.id, { id: e.id, text: e.text, files: e.files, learnedAt: e.learnedAt, expertRecordId: r, arrivalNumber: e.arrivalNumber });
        for (const k of rec.keptNotYetReceived) if (!out.has(k.id)) out.set(k.id, { id: k.id, text: k.text, files: k.files, learnedAt: k.learnedAt });
      }
      for (const t of waiting.things) if (!out.has(t.id)) out.set(t.id, { id: t.id, text: t.text, files: t.files, learnedAt: t.learnedAt });
      return [...out.values()].filter((t) => !removed.has(t.id)).sort((a, b) => Date.parse(b.learnedAt) - Date.parse(a.learnedAt) || (b.arrivalNumber ?? 0) - (a.arrivalNumber ?? 0));
    },

    lastReceived: () => Object.fromEntries(Object.entries(received.records).map(([r, x]) => [r, x.lastArrivalNumberReceived])),

    staying: (id) => !!waiting.things.find((t) => t.id === id)?.staysOnThisComputer,

    catchingUpInPages: () => !!binding && tiedNow().some((r) => binding!.catchUp(r.server, r.expertRecordId) === "in-pages"),

    caughtUp(ms) {
      const end = (o.now ?? Date.now)() + ms;
      return new Promise<void>((resolve) => {
        const look = () => {
          if (forgotten) return resolve();
          if (binding && tiedNow().every((r) => ["answered", "cannot"].includes(binding!.catchUp(r.server, r.expertRecordId)))) return resolve();
          if ((o.now ?? Date.now)() >= end) return resolve();
          setTimeout(look, 100).unref?.();
        };
        look();
      });
    },

    onRebuilt: (listener) => void (rebuiltListener = listener),

    askAfter(expertRecordId) {
      rebuilding.delete(expertRecordId);
      const r = received.records[expertRecordId];
      return { afterArrivalNumber: r?.lastArrivalNumberReceived ?? 0, chain: r?.chain ?? "" };
    },

    waitingFor: (expertRecordId) => waiting.things.filter((t) => Object.hasOwn(t.parts, expertRecordId) && !t.staysOnThisComputer),

    take(expertRecordId, server, m) {
      const before = received.records[expertRecordId] ?? nothingReceived(server);
      const t = takeLearnedSince(before, rebuilding.get(expertRecordId) ?? null, m);
      if (t.kind === "ask-again") {
        rebuilding.delete(expertRecordId);
        return { askAgain: t.why };
      }
      if (t.kind === "page-of-a-rebuild") {
        rebuilding.set(expertRecordId, t.rebuilding);
        return "in-pages";
      }
      rebuilding.delete(expertRecordId);
      received.records[expertRecordId] = { ...t.record, server };
      for (const b of t.backToWaiting) backToWaiting(b, expertRecordId, server);
      if (t.rebuilt) {
        const { sequence, oldNumbers } = t.rebuilt;
        o.log(`its record ${expertRecordId} on ${server} started again from its first entry (a restored office server, say), so what it has of it was rebuilt, ${sequence.length} entries`);
        rebuiltListener?.(expertRecordId, (old, inItsTrunk) => pickedUpToAfterARebuild(sequence, oldNumbers, old, inItsTrunk));
      }
      prune();
      void save();
      if (t.backToWaiting.length) binding?.waiting();
      return m.more ? "in-pages" : "taken";
    },

    answered(expertRecordId, id, outcome, arrivalNumber) {
      const thing = waiting.things.find((t) => t.id === id && Object.hasOwn(t.parts, expertRecordId));
      if (!thing || outcome === "not-an-instance-here") return;
      if (outcome === "kept" && arrivalNumber !== undefined) {
        const part = thing.parts[expertRecordId]!;
        const r = (received.records[expertRecordId] ??= nothingReceived(part.server));
        const entry = r.entries.find((e) => e.id === id);
        if (entry) entry.learnedHere = true;
        else if (!r.keptNotYetReceived.some((k) => k.id === id) && !r.removed.some((x) => x.id === id)) r.keptNotYetReceived.push({ arrivalNumber, id, text: thing.text, files: thing.files, learnedAt: thing.learnedAt, generation: thing.generation, firstLine: thing.firstLine });
      }
      delete thing.parts[expertRecordId];
      prune();
      void save(outcome === "kept");
    },

    recordGone(expertRecordId) {
      if (!received.records[expertRecordId] && !waiting.things.some((t) => Object.hasOwn(t.parts, expertRecordId))) return;
      dropRecord(expertRecordId);
      o.log(`its record ${expertRecordId} is gone, so what it has of it goes`);
      prune();
      void save();
    },

    staysOnThisComputer(id, pattern) {
      const thing = waiting.things.find((t) => t.id === id);
      if (!thing) return;
      thing.parts = {};
      delete thing.waitingForARecord;
      thing.staysOnThisComputer = { pattern };
      prune();
      void save();
    },

    forget() {
      forgotten = true;
      waiting = { version: 1, things: [] };
      received = { version: 1, records: {} };
    },

    written: () => writing,
  };
}

export { firstLineOf };
