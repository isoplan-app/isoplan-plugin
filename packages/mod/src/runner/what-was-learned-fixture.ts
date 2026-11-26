// The stand-ins the tests of what instances learn run against (isoplan-app#366), with this
// computer's expert stack (expert-stack-fixture.ts): forks that explore and learn, a stand-in
// office's sequence for one record kept as the office server keeps it (once per id, numbered on
// arrival, with its chain, answering an ask from 0 with `startedAgain` when the asker's number or
// chain isn't its own), and the files of what an instance learned, read as they are written.

import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { PROTOCOL_VERSION, type ExpertInstanceLearnedReceivedMessage, type ExpertLearnedSinceMessage, type FileWhatWasLearnedRestsOn, type WhatWasLearnedEntry } from "@isoplan/protocol";
import { ANSWER, BASE, until, type Rule } from "./expert-fixture.js";
import type { InstanceOutcome } from "./expert.js";
import type { Computer } from "./expert-stack-fixture.js";
import { RECORD, SERVER } from "./expert-stack-fixture.js";
import { chainOver, type ReceivedFile } from "./what-was-learned-in-the-expert-record.js";
import type { WaitingFile } from "./what-was-learned-waiting-to-be-sent.js";

/** What a fork that explored src/relay.ts learns, unless a rule says otherwise. */
export const LEARNED = "Rule or fact: the relay holds a question while it is in flight. Why: ADR 0004. Files: src/relay.ts";

/** A fork asked question `id` (its text has `(id)`) explores src/relay.ts and learns `learned`. */
export const learns = (id: string, learned = LEARNED, o: Partial<Rule> = {}): Rule => ({ kind: "fork", text: `(${id})`, reads: ["src/relay.ts"], reply: `${ANSWER}\n<learned>${learned}</learned>`, ...o });

/** Forks that explore and learn LEARNED, as BASE otherwise. */
export const LEARNING: Rule[] = [{ kind: "fork", text: "Question x-", reads: ["src/relay.ts"], reply: `${ANSWER}\n<learned>${LEARNED}</learned>` }, ...BASE];

/** Asks this computer's instance of `key` question `id` directly: its outcome. */
export function askHere(c: Computer, id: string, key = "adr"): Promise<InstanceOutcome> {
  return new Promise((resolve) => c.experts.running(key)!.expert.answer({ id, question: `Where is it held? (${id})`, blocking: true, asker: "s-1" }, resolve));
}

// A JSON file written whole, once it is there: ENOENT is not yet.
const readOnce = <T>(file: string): T | null => {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return null;
  }
};

/** The key's waiting file, once it is there. */
export const waitingOf = (c: Computer, key = "adr") => readOnce<WaitingFile>(c.file("experts", key, "what-was-learned-waiting-to-be-sent.json"))?.things ?? [];
/** The key's received file's part for a record, once it is there. */
export const receivedOf = (c: Computer, record = RECORD, key = "adr") => readOnce<ReceivedFile>(c.file("experts", key, "what-was-learned-in-the-expert-record.json"))?.records[record];

/** Waits until `check` holds of the files: they are written in the background. */
export const once = (check: () => boolean, ms = 20000) => until(check, ms);

/** A stand-in office's sequence of what instances learned for one record. */
export function officeSequence(record = RECORD, key = "adr") {
  const entries: WhatWasLearnedEntry[] = [];
  const chainAt = (n: number) => chainOver("", entries.slice(0, n));
  const message = (after: number, list: WhatWasLearnedEntry[], o: { startedAgain?: boolean; more?: boolean } = {}): ExpertLearnedSinceMessage => ({
    type: "expert-learned-since",
    v: PROTOCOL_VERSION,
    key,
    expertRecordId: record,
    afterArrivalNumber: after,
    entries: list,
    chain: chainAt(after + list.length),
    lastArrivalNumber: entries.length,
    ...(o.startedAgain && { startedAgain: true as const }),
    ...(o.more && { more: true as const }),
  });
  const seq = {
    entries,
    /** Kept once per id, numbered on arrival: its number. */
    learned(thing: { id?: string; text: string; files: FileWhatWasLearnedRestsOn[]; learnedAt?: string }): number {
      const id = thing.id ?? randomUUID();
      const at = entries.findIndex((e) => e.kind !== "removed" && e.id === id);
      if (at >= 0) return at + 1;
      entries.push({ kind: "learned", arrivalNumber: entries.length + 1, id, text: thing.text, files: thing.files, learnedAt: thing.learnedAt ?? new Date().toISOString() });
      return entries.length;
    },
    /** Removed on the card: its row keeps only its id, and the removal is numbered in turn. */
    remove(id: string) {
      const i = entries.findIndex((e) => e.kind === "learned" && e.id === id);
      entries[i] = { kind: "learned-then-removed", arrivalNumber: i + 1, id };
      entries.push({ kind: "removed", arrivalNumber: entries.length + 1, id, at: new Date().toISOString() });
    },
    /** The answer to an ask, in pages of `page`: from 0, `startedAgain`, when the number asked after is beyond its last or the chain asked with isn't its own there. */
    answer(ask: { afterArrivalNumber: number; chain: string }, page = 100): ExpertLearnedSinceMessage[] {
      const again = ask.afterArrivalNumber > entries.length || chainAt(ask.afterArrivalNumber) !== ask.chain;
      const from = again ? 0 : ask.afterArrivalNumber;
      const rest = entries.slice(from);
      const pages: WhatWasLearnedEntry[][] = [];
      for (let i = 0; i === 0 || i < rest.length; i += page) pages.push(rest.slice(i, i + page));
      return pages.map((list, p) => message(from + p * page, list, { startedAgain: again && p === 0, more: p < pages.length - 1 }));
    },
    /** A push: the entries after `after`. */
    after: (after: number) => message(after, entries.slice(after)),
    /** The answer to a thing sent: `kept` at its number. */
    received: (id: string): ExpertInstanceLearnedReceivedMessage => ({ type: "expert-instance-learned-received", v: PROTOCOL_VERSION, key, expertRecordId: record, id, outcome: "kept", arrivalNumber: entries.findIndex((e) => e.kind !== "removed" && e.id === id) + 1 }),
    /** As the office answers what `c` sent since the last call (the first, since it started, or since now with `fromNow`): each ask (in pages of `page`, then pushing on), and each thing sent (kept, then pushed). */
    serving(c: Computer, o: { server?: string; page?: number; fromNow?: boolean } = {}) {
      const server = o.server ?? SERVER;
      let seen = o.fromNow ? c.sent.get(server)!.length : 0;
      let pushedTo: number | null = null;
      return () => {
        const sent = c.sent.get(server)!;
        for (const m of sent.slice(seen)) {
          if (m.type === "expert-learned-wanted-after" && m.expertRecordId === record) {
            for (const each of seq.answer(m, o.page)) c.take(each, server);
            pushedTo = entries.length;
          } else if (m.type === "expert-instance-learned" && m.expertRecordId === record) {
            seq.learned(m);
            c.take(seq.received(m.id), server);
            if (pushedTo !== null && pushedTo < entries.length) (c.take(seq.after(pushedTo), server), (pushedTo = entries.length));
          }
        }
        seen = sent.length;
      };
    },
  };
  return seq;
}
