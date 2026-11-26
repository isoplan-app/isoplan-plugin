// What this computer's instances of experts learned, and what their other instances learned, over
// one office's link (protocol 0.18.0, isoplan-app#366): one of these per office in config.json,
// beside that office's record link (expert-record-link.ts).
//
// - The gate: nothing of the family goes on a connection whose first `expert-directory` didn't say
//   `sharesWhatExpertInstancesLearn`; runner.log and each tied expert's health log say so once per
//   connection. Everything goes after a listing (`expert-instance-states`) on that connection, never
//   before, since the listing is what makes the office's row of this computer's instance.
// - Asking: after a listing, for each record of this office an instance here is tied to
//   (expert-instance.ts `tiedRecords`) that hasn't been asked for on this connection, or whose ask was
//   refused `not-an-instance-here` (that also on the timer), `expert-learned-wanted-after` with this
//   computer's own last number and chain for it. One ask unanswered at a time per record; a reason to
//   ask while one is unanswered asks once its last page came. An answer that doesn't follow on (what
//   what-was-learned-in-the-expert-record.ts takes) asks again once that answer's last page came, at
//   most three times per record per connection; past that, not again until the next connection.
// - Sending: after each listing, when a thing is kept, and on the timer, each thing waiting for a
//   record of this office, oldest first, not sent on this connection in the last 2 minutes (one
//   refused `not-an-instance-here` again after a listing and on the timer, after the rest), at most
//   50 unanswered at once (a refusal is an answer), each checked first (what-was-learned-before-it-leaves.ts): a match is never sent and stays
//   on this computer, the health log naming the pattern; patterns that can't be read send nothing of
//   that expert. It counts as sent only when the link took it.
// - What comes back goes to the key's WhatWasLearnedForOneExpert, the only writer of its files.

import { PROTOCOL_VERSION, type ExpertInstanceLearnedReceivedMessage, type ExpertLearnedSinceMessage, type ExpertLearnedWantedAfterRefusedMessage } from "@isoplan/protocol";
import type { RunnerExpertRecordMessage } from "../data-layer/link.js";
import type { HealthLog } from "./expert-health.js";
import type { ExpertInstances } from "./expert-instance.js";
import type { ExpertRecordLink } from "./expert-record-link.js";
import type { CheckBeforeItLeaves } from "./what-was-learned-before-it-leaves.js";
import type { CatchUp, WhatWasLearnedForOneExpert } from "./what-was-learned-for-one-expert.js";

/** The most things sent to an office and not yet answered, at once. */
export const MAX_UNANSWERED = 50;
/** How long a thing sent and not answered waits before it is sent again on the same connection. */
export const SENT_AGAIN_AFTER_MS = 2 * 60000;
/** How many times one connection asks again for a record whose answers don't follow on. */
export const ASKS_AGAIN_PER_CONNECTION = 3;

export type WhatWasLearnedServerMessage = ExpertInstanceLearnedReceivedMessage | ExpertLearnedSinceMessage | ExpertLearnedWantedAfterRefusedMessage;

export interface WhatWasLearnedLinkOptions {
  server: string;
  recordLink: Pick<ExpertRecordLink, "directory" | "onDirectory" | "onListingSent">;
  instances: Pick<ExpertInstances, "tiedRecords">;
  whatWasLearned: (key: string) => WhatWasLearnedForOneExpert;
  health: (key: string) => HealthLog;
  check: (thing: { text: string; files: { path: string }[] }) => Promise<CheckBeforeItLeaves>;
  /** Sends on the link while it is up; false when it isn't. */
  send: (m: RunnerExpertRecordMessage) => boolean;
  log: (text: string) => void;
  checkMs: number;
  now?: () => number;
}

export interface WhatWasLearnedLink {
  take(m: WhatWasLearnedServerMessage): void;
  onOpen(): void;
  onClose(): void;
  stop(): void;
  /** How far this connection's ask for the record has got. */
  catchUp(expertRecordId: string): CatchUp;
  /** A thing now waits, or a key's files were read: what is due is asked for and sent, if this connection can. */
  sendWaiting(): void;
}

interface Ask {
  key: string;
  /** `dropping`: an answer that didn't follow on is still coming; once its last page came, it asks again. */
  state: "asking" | "answered" | "refused" | "dropping" | "stopped";
  inPages: boolean;
  /** A reason to ask came while one was unanswered. */
  again: boolean;
  asksAgain: number;
}

export function createWhatWasLearnedLink(o: WhatWasLearnedLinkOptions): WhatWasLearnedLink {
  const { server } = o;
  const now = o.now ?? Date.now;
  let connection = 0;
  let shares: boolean | null = null; // what this connection's first directory said
  let listed = false; // a listing went on this connection
  let stopped = false;
  const asks = new Map<string, Ask>(); // by record id, on this connection
  const sentAt = new Map<string, number>(); // `${record}\n${id}` → when it went on this connection
  const unanswered = new Set<string>();
  const refusedHere = new Set<string>(); // refused not-an-instance-here: sent again after a listing and on the timer
  const saidUnreadable = new Set<string>();
  let sending: Promise<void> = Promise.resolve();

  const sendFor = (key: string, m: RunnerExpertRecordMessage) => !stopped && shares === true && listed && o.send(m);

  function ask(key: string, expertRecordId: string) {
    const a = asks.get(expertRecordId);
    if (a && (a.state === "asking" || a.state === "dropping")) return void (a.again = true);
    if (a?.state === "stopped") return;
    const after = o.whatWasLearned(key).askAfter(expertRecordId);
    if (!sendFor(key, { type: "expert-learned-wanted-after", v: PROTOCOL_VERSION, key, expertRecordId, ...after })) return;
    asks.set(expertRecordId, { key, state: "asking", inPages: false, again: false, asksAgain: a?.asksAgain ?? 0 });
  }

  // The records tied here whose key's files are read.
  const tied = () => o.instances.tiedRecords(server).filter((r) => o.whatWasLearned(r.key).loaded());

  // Each record tied here that this connection hasn't asked for, or whose ask was refused as no instance here.
  function askWhatIsDue() {
    for (const { key, expertRecordId } of tied()) {
      const a = asks.get(expertRecordId);
      if (!a || a.state === "refused") ask(key, expertRecordId);
    }
  }

  const sendable = (k: string, again: boolean) => {
    const at = sentAt.get(k);
    return at === undefined || now() - at >= SENT_AGAIN_AFTER_MS || (again && refusedHere.has(k));
  };

  async function sendNow(again: boolean) {
    const mine = connection;
    if (stopped || shares !== true || !listed) return;
    // Oldest first per record, and what was refused as no instance here after the rest, so an expert
    // the office keeps refusing never holds back another's.
    const due = tied().flatMap(({ key, expertRecordId }) => o.whatWasLearned(key).waitingFor(expertRecordId).map((t) => ({ key, expertRecordId, t, k: `${expertRecordId}\n${t.id}` })));
    due.sort((a, b) => Number(refusedHere.has(a.k)) - Number(refusedHere.has(b.k)));
    const unreadable = new Set<string>();
    for (const { key, expertRecordId, t, k } of due) {
      if (mine !== connection || stopped) return;
      if (unreadable.has(key) || !sendable(k, again)) continue;
      if (unanswered.size >= MAX_UNANSWERED) return;
      const checked = await o.check(t);
      if (mine !== connection) return;
      if ("unreadable" in checked) {
        if (!saidUnreadable.has(key)) o.log(`expert ${key}: the secret or personal-data patterns can't be read, so nothing it learned goes to ${server} until they can`);
        saidUnreadable.add(key);
        unreadable.add(key);
        continue;
      }
      saidUnreadable.delete(key);
      if ("matched" in checked) {
        const why = `it matches the ${checked.matched} pattern "${checked.pattern}"`;
        o.whatWasLearned(key).staysOnThisComputer(t.id, checked.pattern);
        o.health(key).say("learned", { id: t.id, kept: "on this computer only", why });
        o.log(`expert ${key}: what it learned, ${t.id}, stays on this computer: ${why}`);
        continue;
      }
      if (!sendFor(key, { type: "expert-instance-learned", v: PROTOCOL_VERSION, key, expertRecordId, id: t.id, text: t.text, files: t.files, learnedAt: t.learnedAt })) return;
      sentAt.set(k, now());
      unanswered.add(k);
      refusedHere.delete(k);
    }
  }

  const sendWaiting = (again = false) => {
    sending = sending.then(() => sendNow(again)).catch((err: Error) => o.log(`what experts learned, to ${server}: ${err.message}`));
  };

  o.recordLink.onDirectory(() => {
    if (shares !== null) return;
    shares = o.recordLink.directory()?.sharesWhatExpertInstancesLearn === true;
    if (shares) return;
    const words = `${server} doesn't share what instances of experts learn yet: update its Isoplan server`;
    o.log(words);
    for (const { key } of o.instances.tiedRecords(server)) o.health(key).say("learned", { server, shared: "no", why: words });
  });

  o.recordLink.onListingSent(() => {
    if (shares !== true || stopped) return;
    listed = true;
    askWhatIsDue();
    sendWaiting(true);
  });

  const timer = setInterval(() => {
    if (shares !== true || !listed) return;
    askWhatIsDue();
    sendWaiting(true);
  }, o.checkMs);
  timer.unref?.();

  function fresh() {
    connection++;
    shares = null;
    listed = false;
    asks.clear();
    sentAt.clear();
    unanswered.clear();
    refusedHere.clear();
  }

  function since(m: ExpertLearnedSinceMessage) {
    const a = asks.get(m.expertRecordId);
    if (!a || a.key !== m.key) return o.log(`${server} sent what was learned of record ${m.expertRecordId}, which this connection didn't ask for, so it is left`);
    if (a.state === "stopped") return;
    if (a.state === "dropping") {
      if (m.more) return;
      a.state = "answered";
      return ask(a.key, m.expertRecordId);
    }
    const got = o.whatWasLearned(a.key).take(m.expertRecordId, server, m);
    if (typeof got === "object") {
      a.asksAgain++;
      a.inPages = false;
      if (a.asksAgain > ASKS_AGAIN_PER_CONNECTION) {
        a.state = "stopped";
        const words = `what ${server} sends of record ${m.expertRecordId} doesn't follow on from what this computer has (${got.askAgain}), after asking again ${ASKS_AGAIN_PER_CONNECTION} times, so it isn't asked for again until the next connection`;
        o.log(`expert ${a.key}: ${words}`);
        o.health(a.key).say("learned", { server, record: m.expertRecordId, asked: "no more", why: words });
        return;
      }
      o.log(`expert ${a.key}: what ${server} sent of record ${m.expertRecordId} doesn't follow on (${got.askAgain}), so it asks again after its own number and chain`);
      if (m.more) return void (a.state = "dropping");
      a.state = "answered";
      return ask(a.key, m.expertRecordId);
    }
    a.inPages = got === "in-pages";
    if (m.more || a.state !== "asking") return;
    a.state = "answered";
    if (a.again) {
      a.again = false;
      ask(a.key, m.expertRecordId);
    }
  }

  return {
    take(m) {
      if (stopped) return;
      if (m.type === "expert-learned-since") return since(m);
      if (m.type === "expert-learned-wanted-after-refused") {
        if (m.reason === "record-gone") {
          asks.delete(m.expertRecordId);
          o.log(`expert ${m.key}: ${server} holds no record ${m.expertRecordId} of it any more, so what this computer has of that record goes`);
          return o.whatWasLearned(m.key).recordGone(m.expertRecordId);
        }
        const a = asks.get(m.expertRecordId);
        if (a) a.state = "refused";
        return;
      }
      const k = `${m.expertRecordId}\n${m.id}`;
      const outcome = m.outcome === "refused" ? m.reason : m.outcome;
      // Refused as no instance here, it is sent again after a listing and on the timer, its place among
      // the unanswered freed meanwhile.
      if (outcome === "not-an-instance-here") refusedHere.add(k);
      unanswered.delete(k);
      o.whatWasLearned(m.key).answered(m.expertRecordId, m.id, outcome, m.outcome === "kept" ? m.arrivalNumber : undefined);
      if (outcome !== "not-an-instance-here") sendWaiting();
    },
    onOpen: fresh,
    onClose: fresh,
    stop() {
      stopped = true;
      clearInterval(timer);
    },
    catchUp(expertRecordId) {
      if (stopped || shares === false) return "cannot";
      const a = asks.get(expertRecordId);
      if (!a) return "waiting";
      if (a.state === "answered") return "answered";
      if (a.state === "stopped") return "cannot";
      return a.inPages ? "in-pages" : "waiting";
    },
    sendWaiting() {
      if (shares !== true || !listed || stopped) return;
      askWhatIsDue();
      sendWaiting();
    },
  };
}
