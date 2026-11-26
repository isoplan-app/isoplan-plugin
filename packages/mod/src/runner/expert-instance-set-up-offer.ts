// The offer to set up an expert on this computer (isoplan-app#340, ADR 0013): an agent here asked
// an expert this computer has no instance of. With runner.json's `expertInstances.setUpWithoutAsking`
// on, the set-up starts at once (expert-instance.ts) and nothing is offered. Off, the office is told
// once per computer per expert record, ever (`expert-set-up-offered`), so the floor offers the
// one-click set-up to this computer's person, and the asking session's hooks module is given a line
// for its status line (`expert-set-up-offer`, with the floor's link that opens the expert's card),
// given again when that session's pipe connects afresh, while the offer is open. It ends when an
// instance of the record is here, or the office says it ended (dismissed on the floor, expired, set
// up, or the record gone): its sessions are given `expert-set-up-offer-ended`, and an ended offer is
// never shown again. Which records were offered, whether the office took each offer (an offer the
// link couldn't send goes after its next directory), and how each ended, are kept in
// ~/.claude/isoplan/runner/expert-instance-set-up-offers.json, across restarts.

import { expertDisplayName, PROTOCOL_VERSION, type ExpertDirectoryEntry, type ExpertSetUpOfferedMessage, type ExpertSetUpOfferEndedMessage } from "@isoplan/protocol";
import type { DataLayerLine } from "../lines.js";
import { readJson, writeJson } from "./expert-state.js";

interface Offer {
  server: string;
  key: string;
  expertRecordId: string;
  at: number;
  /** The office took it. */
  sent: boolean;
  ended?: ExpertSetUpOfferEndedMessage["why"];
  /** The session whose agent asked, whose status line has it. */
  session: string;
}

export interface ExpertInstanceSetUpOffersOptions {
  file: string;
  setUpWithoutAsking: () => Promise<boolean>;
  setUp: (server: string, entry: ExpertDirectoryEntry) => void;
  /** Sends on the office's record link; false when it couldn't. */
  send: (server: string, m: ExpertSetUpOfferedMessage) => boolean;
  hooked: (session: string) => { send(line: DataLayerLine): void } | null;
  /** Whether this computer has an instance of the record now, or is setting one up. */
  hasInstance: (server: string, key: string, expertRecordId: string) => boolean;
  log: (text: string) => void;
  now?: () => number;
}

export interface ExpertInstanceSetUpOffers {
  start(): Promise<void>;
  /** An agent in `session` asked `entry`'s expert, which this computer has no instance of: "set-up" when it starts now, "offered" when its person is asked. */
  offerOrSetUp(server: string, entry: ExpertDirectoryEntry, session: string): Promise<"set-up" | "offered">;
  /** The office says the offer ended. */
  ended(server: string, m: ExpertSetUpOfferEndedMessage): void;
  /** This computer's instances changed: an offer of a record set up here now ends. */
  instancesChanged(): void;
  /** After the office's first directory on a connection: what it didn't take goes again. */
  afterDirectory(server: string): void;
  /** The session's pipe connected afresh: it is given its open offers again. */
  rehooked(session: string): void;
}

/** The floor's link that opens the expert's card, from the office's data-layer address. */
export function expertSetUpUrl(server: string, key: string): string {
  const url = new URL(server);
  url.protocol = url.protocol === "wss:" ? "https:" : "http:";
  url.pathname = url.pathname.replace(/\/data-layer\/?$/, "") + "/";
  url.search = `expert-set-up=${encodeURIComponent(key)}`;
  url.hash = "";
  return url.toString();
}

export function createExpertInstanceSetUpOffers(o: ExpertInstanceSetUpOffersOptions): ExpertInstanceSetUpOffers {
  const now = o.now ?? Date.now;
  let offers: Offer[] = [];
  let writing: Promise<void> = Promise.resolve();

  const save = () => {
    const copy = structuredClone(offers);
    writing = writing.then(() => writeJson(o.file, { version: 1, offers: copy })).catch((err: Error) => o.log(`couldn't write ${o.file}: ${err.message}`));
    return writing;
  };
  const find = (server: string, expertRecordId: string) => offers.find((x) => x.server === server && x.expertRecordId === expertRecordId);
  const line = (x: Offer): DataLayerLine => ({ type: "expert-set-up-offer", server: x.server, key: x.key, name: expertDisplayName(x.key), url: expertSetUpUrl(x.server, x.key) });
  const send = (x: Offer) => {
    if (x.sent || x.ended) return;
    if (o.send(x.server, { type: "expert-set-up-offered", v: PROTOCOL_VERSION, key: x.key, expertRecordId: x.expertRecordId })) {
      x.sent = true;
      void save();
    }
  };
  const end = (x: Offer, why: NonNullable<Offer["ended"]>) => {
    if (x.ended) return;
    x.ended = why;
    void save();
    o.hooked(x.session)?.send({ type: "expert-set-up-offer-ended", server: x.server, key: x.key });
    o.log(`the offer to set up expert ${x.key} from ${x.server} ended: ${why}`);
  };

  return {
    async start() {
      const read = (await readJson(o.file)) as { version?: unknown; offers?: unknown } | null;
      if (read?.version === 1 && Array.isArray(read.offers)) offers = read.offers as Offer[];
    },
    async offerOrSetUp(server, entry, session) {
      if (await o.setUpWithoutAsking()) {
        o.log(`expert ${entry.key} isn't set up on this computer and its agent asked it, so it is set up now, as runner.json's expertInstances.setUpWithoutAsking says`);
        o.setUp(server, entry);
        return "set-up";
      }
      if (find(server, entry.expertRecordId)) return "offered";
      const x: Offer = { server, key: entry.key, expertRecordId: entry.expertRecordId, at: now(), sent: false, session };
      offers.push(x);
      await save();
      o.log(`expert ${entry.key} isn't set up on this computer and its agent asked it, so its set-up is offered on the floor of ${server}`);
      send(x);
      o.hooked(session)?.send(line(x));
      return "offered";
    },
    ended(server, m) {
      const x = find(server, m.expertRecordId);
      if (x) end(x, m.why);
    },
    instancesChanged() {
      for (const x of offers) if (!x.ended && o.hasInstance(x.server, x.key, x.expertRecordId)) end(x, "set-up");
    },
    afterDirectory(server) {
      for (const x of offers) if (x.server === server) send(x);
    },
    rehooked(session) {
      const hooks = o.hooked(session);
      if (!hooks) return;
      for (const x of offers) if (x.session === session && !x.ended) hooks.send(line(x));
    },
  };
}
