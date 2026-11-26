// This computer's experts and one office server, over the runner's link to it (protocol 0.17.0,
// isoplan-app#340): one of these per office in config.json.
//
// - The gate: nothing of the family goes on a connection before that connection's first
//   `expert-directory`, so a server from before 0.17.0, which sends none, is never sent any. One
//   whose first `expert-creation-suggestion-dismissals` comes with no directory before it is from
//   before 0.17.0 (a newer one sends the directory first, and this runner always says
//   `canCreateExpertsFromSuggestions`): `showedOld`, and its saved directory is forgotten.
// - Everything it sends goes live (`send`, the link's sendLive) and counts as sent only when that
//   took it: a record wanted, a failed proof, and what the asking module and the set-up offers keep
//   (`onDirectory`), go again after the next connection's first directory.
// - What it receives goes to the instances (expert-instance.ts), the set-up offers and the store
//   of what each office last said (expert-records-per-office.ts). `set-up-expert-instance` starts
//   anything only when its `by` is the account this runner says hello as, and the key isn't another
//   expert's here (the X1 guard); otherwise runner.log says why.
// - Its definitions: each expert file not tied to someone else's record, whose repo is in a project
//   the office's approved list takes (`home`) and has a remote. Its areas are those the protocol
//   takes (at most MAX_AREA_PATHS); then the whole definition is checked for secrets (a match: the
//   field in the health log and runner.log, nothing sent; patterns that can't be read: nothing
//   sent), then against the protocol (a failure: the field and why, nothing sent). One goes when it
//   differs from what this computer last had of its record there, or was never published there, once
//   per connection and on every change.
// - Its listing (A9): this server's instances alone, worked out after each directory, on every change
//   and every `checkMs`; the first on each connection always goes, then only one that differs. Each
//   working-out runs after the one before, so they go out in order. While git can't read an expert
//   repo's remote (`home` rejects), neither its listing nor that expert's definition changes. Each
//   listing sent is told to `onListingSent`, after which what instances learn may go
//   (what-was-learned-link.ts, protocol 0.18.0), whose messages from the office are passed on to it.

import { ExpertDefinitionSchema, ExpertInstanceStatesMessageSchema, PROTOCOL_VERSION, type ExpertDefinition, type ExpertDirectoryEntry, type ExpertDirectoryMessage, type ExpertInstanceStatesMessage, type ExpertQuestionsAskedOnYourOtherComputersMessage, type ExpertSetUpOfferEndedMessage, type Project } from "@isoplan/protocol";
import type { Approved } from "../data-layer/approved.js";
import type { RunnerExpertRecordMessage, ServerExpertRecordMessage } from "../data-layer/link.js";
import { definitionOf, sameDefinition } from "./expert-instance-file.js";
import type { ExpertInstances } from "./expert-instance.js";
import type { ExpertRecordsPerOffice } from "./expert-records-per-office.js";
import type { Experts, RunningExpert } from "./experts.js";
import { UNREADABLE } from "./scan.js";
import type { WhatWasLearnedServerMessage } from "./what-was-learned-link.js";

export interface ExpertRecordLinkOptions {
  server: string;
  /** The Claude account this runner says hello as. */
  account: { id: string; name: string };
  experts: Experts;
  instances: ExpertInstances;
  store: ExpertRecordsPerOffice;
  /** The set-up offers' end, told by the office. */
  offerEnded: (server: string, m: ExpertSetUpOfferEndedMessage) => void;
  approved: Pick<Approved, "refresh" | "repos">;
  /** The project a folder is in, when the approved list takes it. */
  home: (folder: string, repos: ReadonlySet<string>) => Promise<Project | null>;
  scan: (text: string) => Promise<string | null>;
  log: (text: string) => void;
  /** Sends on the link while it is up; false when it isn't. */
  send: (m: RunnerExpertRecordMessage) => boolean;
  checkMs: number;
}

export interface ExpertRecordLink {
  take(m: ServerExpertRecordMessage): void;
  /** This connection's first `expert-creation-suggestion-dismissals` came. */
  dismissals(): void;
  onOpen(): void;
  onClose(): void;
  stop(): void;
  /** This connection has had its first directory. */
  open(): boolean;
  /** This connection showed the server is from before 0.17.0. */
  showedOld(): boolean;
  /** The directory: this connection's, else the one saved. */
  directory(): ExpertDirectoryMessage | null;
  otherComputers(): ExpertQuestionsAskedOnYourOtherComputersMessage | null;
  /** Sends a message of the family now if the gate is open; false when it couldn't. */
  sendNow(m: RunnerExpertRecordMessage): boolean;
  /** Told after each connection's first directory, to send what didn't go. */
  onDirectory(listener: () => void): void;
  /** Told when the counts of this person's questions on their other computers change. */
  onOtherComputers(listener: () => void): void;
  /** Told after each listing it sends on a connection: the first on each always goes, later ones when it changed. */
  onListingSent(listener: () => void): void;
  /** Given the office's messages of what instances learn (protocol 0.18.0). */
  onWhatWasLearned(listener: (m: WhatWasLearnedServerMessage) => void): void;
}

// A definition's fields, each checked for secrets, the first that matches named. Only this
// computer's expert files are published, and each has its proof (protocol 0.19.0).
const FIELDS: [string, (d: ExpertDefinition) => string][] = [
  ["key", (d) => d.key],
  ["subject", (d) => d.subject],
  ["model", (d) => d.model],
  ["areas", (d) => d.areas.join("\n")],
  ["proof.question", (d) => d.proof!.question],
  ["proof.answer", (d) => d.proof!.answer],
];

export function createExpertRecordLink(o: ExpertRecordLinkOptions): ExpertRecordLink {
  const { server } = o;
  let connection = 0; // moves on with each open and close, so work for an old connection sends nothing
  let gate = false; // this connection has had its first directory
  let up = false;
  let old = false;
  let sawDismissals = false;
  let directory: ExpertDirectoryMessage | null = null; // this connection's last
  let others: ExpertQuestionsAskedOnYourOtherComputersMessage | null = null;
  let lastListing: string | null = null; // the listing last sent on this connection
  const sentDefinitions = new Map<string, string>(); // key → the definition last sent on this connection
  const awaitingResult = new Map<string, ExpertDefinition>(); // key → the definition its result will be of
  const wanted = new Map<string, string>(); // record id → key, until its record comes
  const directoryListeners: (() => void)[] = [];
  const othersListeners: (() => void)[] = [];
  const listingListeners: (() => void)[] = [];
  const learnedListeners: ((m: WhatWasLearnedServerMessage) => void)[] = [];
  let stopped = false;
  let chain: Promise<void> = Promise.resolve();
  let saidNoList = false;
  let said = new Set<string>();

  // Each line once while it holds: the timer works it all out every few minutes.
  const quiet = () => {
    const now = new Set<string>();
    return {
      log: (text: string, key?: string, fields?: Record<string, string>) => {
        now.add(text);
        if (said.has(text)) return;
        o.log(text);
        if (key && fields) o.experts.health(key).say("definition", fields);
      },
      done: () => (said = now),
    };
  };

  const sendNow = (m: RunnerExpertRecordMessage) => !stopped && gate && o.send(m);
  const entryOf = (key: string): ExpertDirectoryEntry | null => (directory ?? o.store.directory(server))?.experts.find((e) => e.key === key) ?? null;

  // Rejects while git can't read the repo's remote, so the listing sent last stands.
  async function takes(running: RunningExpert, repos: ReadonlySet<string>) {
    const project = await o.home(running.file.repo, repos);
    return !!project && !project.id.toLowerCase().startsWith("local:");
  }

  async function sync(force: boolean, mine: number) {
    if (stopped || mine !== connection || !gate) return;
    await o.approved.refresh(force);
    const repos = o.approved.repos();
    if (!repos) {
      if (!saidNoList) o.log(`no approved list from ${server}, so this computer's experts aren't told to it yet`);
      saidNoList = true;
      return;
    }
    saidNoList = false;
    let instances: Awaited<ReturnType<ExpertInstances["listingFor"]>>;
    try {
      instances = await o.instances.listingFor(server, directory, (running) => takes(running, repos));
    } catch (err) {
      return o.log(`couldn't tell which of this computer's experts ${server} takes (${(err as Error).message}), so what it was last told stands`);
    }
    if (stopped || mine !== connection) return;
    const listing: ExpertInstanceStatesMessage = { type: "expert-instance-states", v: PROTOCOL_VERSION, instances };
    const text = JSON.stringify(instances);
    if (text !== lastListing) {
      if (!ExpertInstanceStatesMessageSchema.safeParse(listing).success) o.log(`the expert instance states for ${server} don't fit the protocol, so they aren't sent`);
      else if (o.send(listing)) {
        lastListing = text;
        for (const l of listingListeners) l();
      }
    }
    await publish(repos, mine);
  }

  async function publish(repos: ReadonlySet<string>, mine: number) {
    const q = quiet();
    try {
      for (const running of o.experts.all()) {
        if (running.from !== "expert-file") continue;
        const { key } = running;
        const held = o.instances.heldOn(server, key);
        if (held?.record && !held.record.yours) continue;
        const project = await o.home(running.file.repo, repos).catch(() => undefined);
        if (project === undefined) continue; // git couldn't read its remote: nothing changes until it can
        if (!project) {
          q.log(`expert ${key} isn't published to ${server}: the office doesn't take its repo ${running.file.repo}`);
          continue;
        }
        if (project.id.toLowerCase().startsWith("local:")) {
          q.log(`expert ${key} isn't published to ${server}: its repo ${running.file.repo} has no remote, so its project would name a folder on this computer`, key, { server, published: "no", why: "its repo has no remote" });
          continue;
        }
        const definition = definitionOf(running.file, project);
        let matched: [string, string] | null = null;
        for (const [field, text] of FIELDS) {
          const hit = await o.scan(text(definition));
          if (hit === UNREADABLE) return void q.log(`the secret patterns can't be read, so no expert definition goes to ${server}`);
          if (hit) {
            matched = [field, hit];
            break;
          }
        }
        if (matched) {
          q.log(`expert ${key} isn't published to ${server}: its ${matched[0]} matches the secret pattern "${matched[1]}"`, key, { server, published: "no", field: matched[0], why: `it matches the secret pattern "${matched[1]}"` });
          continue;
        }
        const parsed = ExpertDefinitionSchema.safeParse(definition);
        if (!parsed.success) {
          const issue = parsed.error.issues[0]!;
          const field = issue.path.join(".") || "(definition)";
          q.log(`expert ${key} isn't published to ${server}: its ${field} doesn't fit the protocol: ${issue.message}`, key, { server, published: "no", field, why: issue.message });
          continue;
        }
        if (held?.lastResult === "published" && held.record && sameDefinition(held.record.definition, definition)) continue;
        const text = JSON.stringify(definition);
        if (sentDefinitions.get(key) === text) continue;
        if (stopped || mine !== connection) return;
        const basedOn = held?.record ? { expertRecordId: held.record.expertRecordId, revision: held.record.revision } : undefined;
        if (o.send({ type: "expert-definition", v: PROTOCOL_VERSION, definition, ...(basedOn && { basedOn }) })) {
          sentDefinitions.set(key, text);
          awaitingResult.set(key, definition);
        }
      }
    } finally {
      q.done();
    }
  }

  const queue = (work: () => Promise<void>) => {
    chain = chain.then(work).catch((err: Error) => o.log(`expert records with ${server}: ${err.message}`));
  };
  const resync = (force: boolean) => {
    const mine = connection;
    queue(() => sync(force, mine));
  };
  const fresh = () => {
    connection++;
    gate = false;
    old = false;
    sawDismissals = false;
    directory = null;
    others = null;
    lastListing = null;
    sentDefinitions.clear();
    awaitingResult.clear();
  };

  o.experts.onChange(() => gate && resync(false));
  o.instances.onChange(() => gate && resync(false));
  // A key deleted here is a new expert from its next file on: that goes even with the definition sent before.
  o.instances.onDeleted((key) => void sentDefinitions.delete(key));
  const timer = setInterval(() => gate && resync(false), o.checkMs);
  timer.unref?.();

  o.instances.attach(server, {
    want(key, expertRecordId) {
      wanted.set(expertRecordId, key);
      sendNow({ type: "expert-record-wanted", v: PROTOCOL_VERSION, key, expertRecordId });
    },
    proofFailed: (m) => sendNow({ type: "expert-proof-failed", v: PROTOCOL_VERSION, ...m }),
  });

  function take(m: ServerExpertRecordMessage) {
    if (stopped) return;
    switch (m.type) {
      case "expert-directory": {
        const first = !gate;
        gate = true;
        directory = m;
        o.store.setDirectory(server, m);
        const mine = connection;
        queue(async () => {
          await o.instances.directory(server, m);
          if (first && mine === connection) {
            o.instances.afterDirectory(server);
            for (const [expertRecordId, key] of wanted) sendNow({ type: "expert-record-wanted", v: PROTOCOL_VERSION, key, expertRecordId });
            for (const l of directoryListeners) l();
          }
          await sync(first, mine);
        });
        return;
      }
      case "expert-record":
        wanted.delete(m.expertRecordId);
        return queue(() => o.instances.record(server, m));
      case "expert-definition-result": {
        const sent = awaitingResult.get(m.key);
        awaitingResult.delete(m.key);
        if (!sent) return o.log(`${server} answered a definition of expert ${m.key} this connection didn't send, so it changes nothing`);
        if (m.outcome === "refused") sentDefinitions.set(m.key, JSON.stringify(sent));
        const mine = connection;
        return queue(async () => {
          await o.instances.definitionResult(server, m, sent, entryOf(m.key));
          await sync(false, mine);
        });
      }
      case "expert-deleted":
        return queue(() => o.instances.deleted(server, m));
      case "set-up-expert-instance": {
        if (m.by.id !== o.account.id) return o.log(`${server} asked to set up expert ${m.key} for ${m.by.name || m.by.id}, not this runner's own account, so nothing starts`);
        const entry = entryOf(m.key);
        if (!entry || entry.expertRecordId !== m.expertRecordId) return o.log(`${server} asked to set up expert ${m.key} from a record its directory doesn't list, so nothing starts`);
        if (o.instances.keyUsedHere(server, m.key, m.expertRecordId)) return o.log(`${server} asked to set up expert ${m.key}, but this computer has another expert with that key, so nothing starts`);
        return queue(() => o.instances.setUp(server, entry, m.again === true));
      }
      case "expert-set-up-offer-ended":
        return o.offerEnded(server, m);
      case "expert-questions-asked-on-your-other-computers":
        others = m;
        o.store.setOtherComputers(server, m);
        for (const l of othersListeners) l();
        return;
      case "expert-instance-learned-received":
      case "expert-learned-since":
      case "expert-learned-wanted-after-refused":
        // In the record link's order, after the listing and record messages before it.
        return queue(async () => void learnedListeners.forEach((l) => l(m)));
    }
  }

  return {
    take,
    dismissals() {
      if (!gate && !sawDismissals) {
        old = true;
        o.store.setDirectory(server, null);
        o.log(`${server} is from before each computer kept its own instance of an expert, so this computer's experts aren't told to it`);
      }
      sawDismissals = true;
    },
    onOpen: () => (fresh(), (up = true)),
    onClose: () => (fresh(), (up = false)),
    stop() {
      stopped = true;
      clearInterval(timer);
    },
    open: () => gate,
    showedOld: () => up && old,
    directory: () => directory ?? o.store.directory(server),
    otherComputers: () => others ?? o.store.otherComputers(server),
    sendNow,
    onDirectory: (listener) => void directoryListeners.push(listener),
    onOtherComputers: (listener) => void othersListeners.push(listener),
    onListingSent: (listener) => void listingListeners.push(listener),
    onWhatWasLearned: (listener) => void learnedListeners.push(listener),
  };
}

