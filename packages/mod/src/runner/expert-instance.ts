// This computer's instance of each expert, as its expert record on an office server says it
// (isoplan-app#340). The registry (experts.ts) runs one expert per key; this module ties each to the
// record it was published as or set up from, by the record's id as experts/<key>/expert-records.json
// holds it (expert-records-file.ts), never by its key alone, and does what each record message asks:
//
// - Which file drives it: its owner's expert file, on a computer of theirs, while expert-records.json
//   ties it to a record marked `yours` or to none (never published there, refused `key-taken`, or its
//   project in no office); on any other computer an instance file (expert-instance-file.ts). One
//   instance per key: while this computer's own expert file has a key, no other record of that key is
//   set up here (`keyUsedHere`), and the listing names that record `key-used-here`.
// - Set-up (`setUp`, the floor's one click, Try again, or the set-up offer's own setting): it says
//   `setting-up`, `cloning` while it finds this computer's checkout of the project or clones it
//   (project-checkout-for-expert.ts), and only then asks for the record (`expert-record-wanted`). With
//   the record it writes the owner's expert file (D12: the record is this person's own) or the
//   instance file, its fields the defaults, expert-records.json first; the registry then grounds it,
//   which the listing says as `grounding`, `proof`, then `ready`. A refused clone is `failed`,
//   `clone`, with git's words, secret-checked; a runner stopped before the file was written finds the
//   set-up `failed`, `other`, as it starts.
// - A newer revision: on its owner's computer, while the expert file still says the definition it
//   last had, the file's definition fields are written from the record (this computer's fields
//   kept), and the registry applies it as an edit; on any other computer it is held, and applied just
//   before the instance's next question (`beforeQuestion`), which its current junior still answers. A
//   revision naming another project finds or clones that project first.
// - A publish's result: `published` ties the file to the record; `edited-elsewhere` writes the
//   record's definition into the file and keeps this computer's edit beside it, as
//   experts/<key>/definition-replaced-<ms>.json; `key-taken` changes nothing but the health log, and
//   the expert keeps answering this computer's sessions in its project; `not-owner` is a hand-over
//   away; `deleted` is the deletion of the record it named.
// - A hand-over (D13), from a directory entry naming the record this computer's file is tied to:
//   `yours` now with an instance file writes the expert file, then removes the instance file; `yours`
//   no longer with an expert file writes the instance file, then moves the expert file to
//   experts/<key>/expert-file-before-the-owner-changed.json, once no server's record of it is
//   `yours`. The expert keeps running, with no new generation.
// - A deletion, of the record this computer's file is tied to (`expert-deleted`, or that record gone
//   from the directory of the server an instance file was set up from): the expert stops and its
//   trunks, clone and folder are deleted, its instance file too; an owner's expert file moves to
//   ~/.claude/isoplan/deleted-experts/<key>-<ms>.json, so it is never published again. One that
//   stopped because its file was removed here goes the same way, its folder still tied to the record,
//   so a new file of the key is published as a new expert.
// - A proof that failed until its tries ran out, on a computer whose record isn't its person's own,
//   tells the owner once per revision (D20): its answer, secret-checked (a match sends only
//   `answerHeld`).
// - The listing (A9): each instance of a server's records, never another server's, by its key and
//   record, its state and step, its senior and its junior's grounding size, or why it failed.

import fs from "node:fs/promises";
import path from "node:path";
import { MAX_DETAIL_LENGTH, MAX_EXPERT_ANSWER_LENGTH, type ExpertDefinition, type ExpertDefinitionResultMessage, type ExpertDeletedMessage, type ExpertDirectoryEntry, type ExpertDirectoryMessage, type ExpertInstanceState, type ExpertProofFailedMessage, type ExpertRecordMessage, type Project } from "@isoplan/protocol";
import { renamed } from "./expert-checkout.js";
import { defaultLocalFields, expertInstanceFileText, fileSaysDefinition, localFieldsOf, ownerExpertFileText, type ExpertLocalFields } from "./expert-instance-file.js";
import { readExpertRecords, writeExpertRecords, type ExpertRecordOnOneServer, type ExpertRecordsFile, type HeldExpertRecord } from "./expert-records-file.js";
import type { HostedExpert } from "./expert.js";
import type { Experts, RunningExpert } from "./experts.js";
import { findOrCloneProjectCheckoutForExpert } from "./project-checkout-for-expert.js";

/** What git said when a clone failed, in place of its words, when they matched a secret pattern. */
export const CLONE_WORDS_HELD = "git's words matched a secret pattern, so they aren't shown; this computer's runner log has them";
/** The health log's line for an expert whose publish was refused `key-taken`. */
const KEY_TAKEN_WORDS = "Another expert has this name, so this one can't be asked. Use unique names.";

export interface ExpertInstancesOptions {
  experts: Experts;
  /** <claudeDir>/isoplan */
  isoplanDir: string;
  scan: (text: string) => Promise<string | null>;
  log: (text: string) => void;
  /** This computer's checkout of `project`, as the office `server` takes it; null when it has none. */
  checkoutOf: (server: string, project: Project) => Promise<string | null>;
  /** Isoplan's own hidden clone of a project (isoplan-clone.ts). */
  clone: (url: string, project: string) => Promise<string | { problem: string; reason?: string }>;
}

/** What this module sends on one office's record link (expert-record-link.ts). */
export interface ExpertInstanceOutbound {
  /** Asks for the record, now and after each new connection's directory until it comes. */
  want(key: string, expertRecordId: string): void;
  /** Sends now if the link can; false when it couldn't, and it is sent after the next connection's directory. */
  proofFailed(m: Omit<ExpertProofFailedMessage, "type" | "v">): boolean;
}

/** An instance the asking module can give a question to, or how far its set-up is. */
export type FoundInstance =
  | { kind: "running"; running: RunningExpert; expertRecordId: string | null; capsIn: string }
  | { kind: "setting-up"; expertRecordId: string }
  | { kind: "set-up-failed"; expertRecordId: string };

export interface ExpertInstances {
  /** Reads every expert-records.json; a set-up a stopped runner left is failed. */
  start(): Promise<void>;
  attach(server: string, out: ExpertInstanceOutbound): void;
  /** Told when a set-up moves on, or what this module keeps of a record changes. */
  onChange(listener: () => void): void;
  /** Told when the key's instance, or its set-up, is deleted here: before its expert stops. */
  onDeleted(listener: (key: string) => void): void;
  setUp(server: string, entry: ExpertDirectoryEntry, again?: boolean): Promise<void>;
  record(server: string, m: ExpertRecordMessage): Promise<void>;
  directory(server: string, m: ExpertDirectoryMessage): Promise<void>;
  deleted(server: string, m: ExpertDeletedMessage): Promise<void>;
  definitionResult(server: string, m: ExpertDefinitionResultMessage, sent: ExpertDefinition, entry: ExpertDirectoryEntry | null): Promise<void>;
  /** What this computer keeps of the key's records, by server. */
  heldOn(server: string, key: string): ExpertRecordOnOneServer | undefined;
  /** This server's instances, as `expert-instance-states` lists them; `takes` says whether an expert file's repo is in a project the office takes, with a remote. */
  listingFor(server: string, directory: ExpertDirectoryMessage | null, takes: (running: RunningExpert) => Promise<boolean>): Promise<ExpertInstanceState[]>;
  /** The instance of `key` from `server`'s record, `entry` the directory's, for a question. */
  lookUp(server: string, key: string, entry: ExpertDirectoryEntry | null): FoundInstance | null;
  /** Whether the record `expertRecordId` of `key` can't be set up here: this computer has another expert of that key. */
  keyUsedHere(server: string, key: string, expertRecordId: string): boolean;
  /** This computer's own experts whose publish to `server` was refused `key-taken`. */
  ownKeyTakenExperts(server: string): RunningExpert[];
  /** Applies a newer revision held for the key, just before its next question. */
  beforeQuestion(server: string, key: string): Promise<void>;
  /** Sends again what didn't go: after each new connection's first directory. */
  afterDirectory(server: string): void;
}

const held = (m: ExpertRecordMessage): HeldExpertRecord => ({ expertRecordId: m.expertRecordId, revision: m.revision, owner: m.owner, yours: m.yours === true, definition: m.definition });

const FAILURE_DETAIL: Record<NonNullable<HostedExpert["failure"]>, string | undefined> = {
  proof: undefined,
  checkout: "its own clone of the project couldn't be made or fetched on this computer",
  other: "its grounding failed; this computer's health log for it says why",
};

/** A running expert's state, as the listing says it for the record `expertRecordId`. */
function stateOf(h: HostedExpert, expertRecordId: string): ExpertInstanceState {
  const base = { key: h.name, expertRecordId };
  if (h.state === "ready") return { ...base, state: "ready", ...(h.senior && { senior: true as const }), ...(h.groundingTokens && { groundingTokens: h.groundingTokens }) };
  if (h.state === "starting") return { ...base, state: "setting-up", step: h.step ?? "grounding" };
  const detail = FAILURE_DETAIL[h.failure ?? "other"];
  return { ...base, state: "failed", failure: { why: h.failure === "proof" ? "proof" : "other", ...(detail && { detail }) } };
}

export function createExpertInstances(o: ExpertInstancesOptions): ExpertInstances {
  const records = new Map<string, ExpertRecordsFile>();
  const outs = new Map<string, ExpertInstanceOutbound>();
  const listeners: (() => void)[] = [];
  const deletedListeners: ((key: string) => void)[] = [];
  // Set-ups under way, by key, before the file is written: the folder, once it is found or cloned.
  const setting = new Map<string, { server: string; expertRecordId: string; folder?: string }>();
  const saidKeyTaken = new Set<string>();
  let saving: Promise<void> = Promise.resolve();

  const changed = () => listeners.forEach((l) => l());
  const wasDeleted = (key: string) => deletedListeners.forEach((l) => l(key));
  const log = (key: string, text: string) => o.log(`expert ${key}: ${text}`);
  const recordsOf = (key: string) => records.get(key) ?? { version: 1 as const, servers: {} };
  const heldOn = (server: string, key: string) => records.get(key)?.servers[server];

  // expert-records.json, changed by `change` and written one at a time; awaited, so the file is there before what follows reads it.
  function save(key: string, change: (servers: Record<string, ExpertRecordOnOneServer>) => void): Promise<void> {
    const file = structuredClone(recordsOf(key));
    change(file.servers);
    for (const [server, r] of Object.entries(file.servers)) if (!Object.keys(r).length) delete file.servers[server];
    records.set(key, file);
    const copy = structuredClone(file);
    saving = saving.then(() => writeExpertRecords(o.experts.dir(key), copy)).catch((err: Error) => log(key, `couldn't write its expert-records.json: ${err.message}`));
    return saving;
  }

  const write = async (file: string, text: string) => {
    await fs.mkdir(path.dirname(file), { recursive: true });
    const temp = `${file}.${process.pid}.tmp`;
    await fs.writeFile(temp, text);
    await renamed(temp, file);
  };

  // A set-up's failure, kept in expert-records.json, so the listing says it after a restart too.
  async function failSetUp(server: string, key: string, expertRecordId: string, why: "clone" | "other", detail: string) {
    setting.delete(key);
    await save(key, (s) => void (s[server] = { ...s[server], setUp: { expertRecordId, startedAt: s[server]?.setUp?.startedAt ?? Date.now(), failed: { why, detail: detail.slice(0, MAX_DETAIL_LENGTH) } } }));
    changed();
  }

  // The set-up's record came: the owner's expert file or the instance file, expert-records.json first.
  async function finishSetUp(server: string, key: string, folder: string, m: ExpertRecordMessage) {
    const local = defaultLocalFields(folder);
    await save(key, (s) => void (s[server] = { record: held(m), ...(m.yours && { lastResult: "published" as const }) }));
    if (m.yours) {
      await write(o.experts.expertFilePath(key), ownerExpertFileText(m.definition, local));
      log(key, `set up from its record on ${server} as its owner's: wrote its expert file, for ${folder}`);
    } else {
      await write(o.experts.instanceFilePath(key), expertInstanceFileText({ version: 1, key, server, ...local }));
      log(key, `set up from its record on ${server}: wrote its instance file, for ${folder}`);
    }
    setting.delete(key);
    await o.experts.refresh(key);
    changed();
  }

  // The folder a definition's project runs from: this computer's checkout, else Isoplan's own clone.
  const folderFor = (server: string, project: Project) => findOrCloneProjectCheckoutForExpert({ project, checkoutOf: (p) => o.checkoutOf(server, p), clone: o.clone });

  // An owner's expert file, rewritten from a record's definition; this computer's fields kept, a new project's folder found first.
  async function rewriteOwnerFile(server: string, running: RunningExpert, d: ExpertDefinition, was: ExpertDefinition): Promise<boolean> {
    let local: ExpertLocalFields = localFieldsOf(running.file);
    if (d.project.id.toLowerCase() !== was.project.id.toLowerCase()) {
      const found = await folderFor(server, d.project);
      if ("failed" in found) return (log(running.key, `its new revision names the project ${d.project.name}, which couldn't be found or cloned here: ${found.failed}`), false);
      local = { ...local, repo: found.folder };
    }
    await write(o.experts.expertFilePath(running.key), ownerExpertFileText(d, local));
    return true;
  }

  // Whether another server's record of this computer's expert file is still this person's own.
  const yoursElsewhere = (key: string, server: string) => Object.entries(recordsOf(key).servers).some(([s, r]) => s !== server && r.record?.yours === true);

  async function handOverToMe(server: string, running: RunningExpert, entry: ExpertDirectoryEntry) {
    const key = running.key;
    const r = heldOn(server, key)!.record!;
    const d = heldOn(server, key)!.newerRecord?.definition ?? r.definition;
    await save(key, (s) => void (s[server] = { ...s[server], record: { ...r, ...(s[server]?.newerRecord ?? {}), owner: entry.owner, yours: true }, lastResult: "published", newerRecord: undefined }));
    await write(o.experts.expertFilePath(key), ownerExpertFileText(d, localFieldsOf(running.instance!)));
    await fs.rm(o.experts.instanceFilePath(key), { force: true });
    log(key, `its owner is now this computer's person, so it runs from its expert file; its instance file was removed`);
    o.experts.health(key).say("owner", { server, owner: entry.owner.name || entry.owner.id, yours: "yes" });
    await o.experts.refresh(key);
  }

  // Its record here says it isn't this person's only once the expert file has moved aside, so a move that fails is tried again at the next directory.
  async function handOverAway(server: string, running: RunningExpert, owner: { id: string; name: string } | null) {
    const key = running.key;
    const away = async () => {
      await save(key, (s) => {
        const r = s[server]?.record;
        if (r) s[server] = { ...s[server], record: { ...r, yours: false, ...(owner && { owner }) } };
        delete s[server]!.lastResult;
      });
      o.experts.health(key).say("owner", { server, owner: owner ? owner.name || owner.id : "another person", yours: "no" });
    };
    if (yoursElsewhere(key, server)) {
      await away();
      return log(key, `its record on ${server} is someone else's now; its record on another office server is still this person's, so its expert file stays`);
    }
    await write(o.experts.instanceFilePath(key), expertInstanceFileText({ version: 1, key, server, ...localFieldsOf(running.file) }));
    const aside = path.join(o.experts.dir(key), "expert-file-before-the-owner-changed.json");
    await fs.mkdir(path.dirname(aside), { recursive: true });
    await renamed(o.experts.expertFilePath(key), aside);
    await away();
    log(key, `its owner is someone else now, so it runs from an instance file; its expert file was moved to ${aside}`);
    await o.experts.refresh(key);
  }

  /** `why`: "deleted on the floor of <server> by <name>", or why else its record went. */
  async function deleteInstance(server: string, key: string, why: string) {
    const running = o.experts.running(key);
    setting.delete(key);
    wasDeleted(key);
    if (running?.from === "expert-file") {
      const aside = path.join(o.isoplanDir, "deleted-experts", `${key}-${Date.now()}.json`);
      await fs.mkdir(path.dirname(aside), { recursive: true });
      await renamed(o.experts.expertFilePath(key), aside).catch((err: Error) => log(key, `couldn't move its expert file aside: ${err.message}`));
      log(key, `${why}: it stops and its folder goes; its expert file was moved to ${aside}`);
    } else if (running) {
      await fs.rm(o.experts.instanceFilePath(key), { force: true });
      log(key, `${why}: it stops, and its instance file and folder go`);
    } else {
      log(key, `${why}: it had stopped here, its file removed, and now its folder goes`);
    }
    o.experts.health(key).say("deleted", { server, why });
    records.delete(key);
    await saving;
    await o.experts.remove(key);
    changed();
  }

  // Whether the key's file here is tied to the record `id` on `server`.
  const tiedTo = (server: string, key: string, id: string) => {
    const running = o.experts.running(key);
    const r = heldOn(server, key);
    if (r?.record?.expertRecordId === id && running && (running.from === "expert-file" || running.instance?.server === server)) return running;
    return null;
  };

  async function sendProofFailed(server: string, key: string) {
    const r = heldOn(server, key);
    const p = r?.proofFailed;
    if (!r?.record || !p || p.sent) return;
    const went = outs.get(server)?.proofFailed({ key, expertRecordId: r.record.expertRecordId, revision: p.revision, ...(p.answerHeld ? { answerHeld: true as const } : { answer: p.answer! }) }) ?? false;
    if (went) await save(key, (s) => void (s[server]!.proofFailed = { ...p, sent: true }));
  }

  o.experts.onTriesRanOut((key, ran) => {
    void (async () => {
      if (ran.why !== "proof") return;
      const running = o.experts.running(key);
      if (!running) return;
      for (const [server, r] of Object.entries(recordsOf(key).servers)) {
        if (!r.record || r.record.yours || (running.from === "instance-file" && running.instance?.server !== server)) continue;
        if (r.proofFailed?.revision === r.record.revision) continue;
        const answer = (ran.proofAnswer ?? "").slice(0, MAX_EXPERT_ANSWER_LENGTH);
        const matched = answer ? await o.scan(answer) : "empty";
        if (matched && answer) log(key, `its failed proof's answer matches the secret pattern "${matched}", so only that it was held goes to its owner`);
        const revision = r.record.revision;
        await save(key, (s) => void (s[server]!.proofFailed = { revision, ...(matched ? { answerHeld: true as const } : { answer }), sent: false }));
        await sendProofFailed(server, key);
      }
    })().catch((err: Error) => log(key, `couldn't tell its owner its proof failed: ${err.message}`));
  });

  return {
    async start() {
      const keys = await fs.readdir(path.join(o.isoplanDir, "experts"), { withFileTypes: true }).catch(() => []);
      for (const d of keys) {
        if (!d.isDirectory()) continue;
        const file = await readExpertRecords(o.experts.dir(d.name));
        if (!Object.keys(file.servers).length) continue;
        records.set(d.name, file);
        for (const [server, r] of Object.entries(file.servers)) {
          if (r.setUp && !r.setUp.failed) await failSetUp(server, d.name, r.setUp.expertRecordId, "other", "the runner stopped during its set-up");
        }
      }
    },
    attach: (server, out) => void outs.set(server, out),
    onChange: (listener) => void listeners.push(listener),
    onDeleted: (listener) => void deletedListeners.push(listener),
    heldOn,

    async setUp(server, entry, again = false) {
      const { key, expertRecordId: id } = entry;
      const running = o.experts.running(key);
      if (running) {
        if (tiedTo(server, key, id)) {
          if (again) running.expert.retryNow();
          else log(key, `set-up of its record on ${server} asked for: it is set up here already`);
          return;
        }
        return log(key, `isn't set up from its record on ${server}: this computer has another expert with this key${running.from === "expert-file" ? ", its own" : ""}`);
      }
      const busy = setting.get(key);
      if (busy) {
        if (busy.server !== server || busy.expertRecordId !== id) log(key, `isn't set up from its record on ${server}: a set-up of another record of this key is under way`);
        return;
      }
      setting.set(key, { server, expertRecordId: id });
      await save(key, (s) => void (s[server] = { ...s[server], setUp: { expertRecordId: id, startedAt: Date.now() } }));
      changed();
      log(key, `${again ? "set up again" : "set up"} from its record on ${server}: finding this computer's checkout of ${entry.project.name}, or cloning it`);
      const found = await folderFor(server, entry.project);
      if (setting.get(key)?.expertRecordId !== id) return; // deleted meanwhile
      if ("failed" in found) {
        log(key, `its set-up failed: ${found.failed}`);
        const matched = await o.scan(found.failed);
        return failSetUp(server, key, id, "clone", matched ? CLONE_WORDS_HELD : found.failed);
      }
      setting.get(key)!.folder = found.folder;
      changed();
      outs.get(server)?.want(key, id);
    },

    async record(server, m) {
      const key = m.definition.key;
      const s = setting.get(key);
      if (s?.server === server && s.expertRecordId === m.expertRecordId && s.folder) return finishSetUp(server, key, s.folder, m);
      const running = tiedTo(server, key, m.expertRecordId);
      const r = heldOn(server, key)?.record;
      if (!running || !r) return log(key, `a record of it came from ${server} that no file here is tied to, so it changes nothing`);
      if (m.revision <= r.revision && !(m.yours === true && !r.yours)) return;
      if (running.from === "instance-file") {
        if (m.yours) return handOverToMe(server, running, { key, expertRecordId: m.expertRecordId, project: m.definition.project, owner: m.owner, yours: true, revision: m.revision });
        await save(key, (x) => void (x[server] = { ...x[server], newerRecord: held(m) }));
        return log(key, `revision ${m.revision} of its record came from ${server}; it is applied before its next question`);
      }
      // Its owner's computer: written into the expert file while that still says what it last had.
      if (!fileSaysDefinition(running.file, r.definition)) return log(key, `revision ${m.revision} of its record came from ${server}, but its expert file was edited here since, so the edit is published and the office settles it`);
      if (!(await rewriteOwnerFile(server, running, m.definition, r.definition))) return;
      await save(key, (x) => void (x[server] = { ...x[server], record: held(m), lastResult: "published" }));
      log(key, `its expert file was rewritten from revision ${m.revision} of its record on ${server}`);
      await o.experts.refresh(key);
    },

    async directory(server, m) {
      const byId = new Map(m.experts.map((e) => [e.expertRecordId, e]));
      const keys = new Set([...records.keys(), ...o.experts.all().map((r) => r.key)]);
      for (const key of keys) {
        const r = heldOn(server, key);
        const running = o.experts.running(key);
        // A set-up whose record has gone from the directory: gone.
        if (r?.setUp && !byId.has(r.setUp.expertRecordId)) {
          setting.delete(key);
          await save(key, (s) => void delete s[server]!.setUp);
          wasDeleted(key);
          changed();
        }
        if (!r?.record || !running) continue;
        const entry = byId.get(r.record.expertRecordId);
        if (running.from === "instance-file" && running.instance?.server === server) {
          if (!entry) await deleteInstance(server, key, `its record has gone from ${server}'s offices`);
          else if (entry.yours) await handOverToMe(server, running, entry);
          else if (entry.revision > (r.newerRecord?.revision ?? r.record.revision)) outs.get(server)?.want(key, entry.expertRecordId);
          continue;
        }
        if (running.from !== "expert-file") continue;
        // Its record isn't listed (deleted, or its project left every office): it is published again,
        // still tied to that record, so a deletion still reaches it and the office answers which.
        if (!entry) {
          if (r.lastResult === "published") await save(key, (s) => void delete s[server]!.lastResult);
          continue;
        }
        if (!entry.yours && r.record.yours) await handOverAway(server, running, entry.owner).catch((err: Error) => log(key, `couldn't hand it over, so it is tried again at the next directory: ${err.message}`));
        else if (entry.revision > r.record.revision) outs.get(server)?.want(key, entry.expertRecordId);
      }
      changed();
    },

    async deleted(server, m) {
      const running = tiedTo(server, m.key, m.expertRecordId);
      const s = setting.get(m.key);
      const settingUp = heldOn(server, m.key)?.setUp?.expertRecordId === m.expertRecordId || (s?.server === server && s.expertRecordId === m.expertRecordId);
      // Its file removed here, it stopped, but its folder still ties the key to the record: that goes too, so a new file of the key is a new expert.
      const stoppedHere = !o.experts.running(m.key) && heldOn(server, m.key)?.record?.expertRecordId === m.expertRecordId;
      if (!running && !settingUp && !stoppedHere) return;
      if (!running && !stoppedHere) {
        setting.delete(m.key);
        await save(m.key, (x) => void delete x[server]!.setUp);
        wasDeleted(m.key);
        return changed();
      }
      await deleteInstance(server, m.key, `deleted on the floor of ${server} by ${m.by.name || m.by.id}`);
    },

    async definitionResult(server, m, sent, entry) {
      const key = m.key;
      const running = o.experts.running(key);
      if (!running || running.from !== "expert-file") return;
      const owner = heldOn(server, key)?.record?.owner ?? entry?.owner ?? { id: "", name: "" };
      if (m.outcome === "published") {
        await save(key, (s) => void (s[server] = { ...s[server], record: { expertRecordId: m.expertRecordId, revision: m.revision, owner, yours: true, definition: sent }, lastResult: "published" }));
        if (saidKeyTaken.delete(key)) o.experts.health(key).say("published", { server, record: m.expertRecordId, revision: m.revision });
        return changed();
      }
      if (m.reason === "edited-elsewhere") {
        const aside = path.join(o.experts.dir(key), `definition-replaced-${Date.now()}.json`);
        await write(aside, JSON.stringify(sent, null, 2) + "\n");
        if (!(await rewriteOwnerFile(server, running, m.definition, sent))) return;
        await save(key, (s) => void (s[server] = { ...s[server], record: { expertRecordId: m.expertRecordId, revision: m.revision, owner, yours: true, definition: m.definition }, lastResult: "published" }));
        o.experts.health(key).say("definition", { server, replaced: "yes", why: "it was edited on another of its owner's computers first", kept: aside });
        log(key, `its definition was edited on another computer of its owner's first, so its expert file now says revision ${m.revision} of its record; this computer's edit is kept in ${aside}`);
        await o.experts.refresh(key);
        return changed();
      }
      if (m.reason === "not-owner") return handOverAway(server, running, entry && !entry.yours ? entry.owner : null);
      if (m.reason === "deleted") return deleteInstance(server, key, `deleted on the floor of ${server}, its office says`);
      const was = heldOn(server, key)?.lastResult;
      await save(key, (s) => void (s[server] = { ...s[server], lastResult: m.reason }));
      if (m.reason === "key-taken" && was !== "key-taken") {
        saidKeyTaken.add(key);
        o.experts.health(key).say("key-taken", { server, words: KEY_TAKEN_WORDS });
        log(key, `${server} refused its definition: ${KEY_TAKEN_WORDS} It still answers this computer's own sessions in its project.`);
      }
      if (m.reason === "project-not-in-an-office" && was !== m.reason) log(key, `${server} refused its definition: no office there holds its project`);
      changed();
    },

    async listingFor(server, directory, takes) {
      const out = new Map<string, ExpertInstanceState>();
      const keys = new Set([...records.keys(), ...setting.keys(), ...o.experts.all().map((r) => r.key)]);
      for (const key of [...keys].sort()) {
        const r = heldOn(server, key);
        const s = setting.get(key);
        const running = o.experts.running(key);
        if (s?.server === server) out.set(key, { key, expertRecordId: s.expertRecordId, state: "setting-up", step: "cloning" });
        else if (r?.setUp?.failed && !running) out.set(key, { key, expertRecordId: r.setUp.expertRecordId, state: "failed", failure: { why: r.setUp.failed.why, detail: r.setUp.failed.detail } });
        else if (running?.from === "instance-file" && running.instance?.server === server && r?.record) out.set(key, stateOf(running.expert.hosted(), r.record.expertRecordId));
        else if (running?.from === "expert-file" && r?.lastResult === "published" && r.record && (await takes(running))) out.set(key, stateOf(running.expert.hosted(), r.record.expertRecordId));
      }
      // A key this computer's own expert has, named by another record: that one can't be set up here.
      for (const e of directory?.experts ?? []) {
        const running = o.experts.running(e.key);
        if (running?.from === "expert-file" && heldOn(server, e.key)?.record?.expertRecordId !== e.expertRecordId && !out.has(e.key)) out.set(e.key, { key: e.key, expertRecordId: e.expertRecordId, state: "failed", failure: { why: "key-used-here" } });
      }
      return [...out.values()];
    },

    lookUp(server, key, entry) {
      const r = heldOn(server, key);
      const s = setting.get(key);
      const running = o.experts.running(key);
      if (s?.server === server) return { kind: "setting-up", expertRecordId: s.expertRecordId };
      if (!running) return r?.setUp?.failed ? { kind: "set-up-failed", expertRecordId: r.setUp.expertRecordId } : null;
      if (running.from === "instance-file") {
        if (running.instance?.server !== server || !r?.record) return null;
        return { kind: "running", running, expertRecordId: r.record.expertRecordId, capsIn: `its instance file, ${o.experts.instanceFilePath(key)}` };
      }
      const capsIn = "the expert file";
      if (r?.lastResult === "key-taken") return { kind: "running", running, expertRecordId: null, capsIn };
      if (r?.record && (r.lastResult === "published" || !r.record.yours)) return { kind: "running", running, expertRecordId: r.record.expertRecordId, capsIn };
      // Its own expert file whose publish there hasn't been answered yet, of the record the directory says is this person's.
      if (entry?.yours && !r?.lastResult) return { kind: "running", running, expertRecordId: entry.expertRecordId, capsIn };
      return null;
    },

    keyUsedHere(server, key, id) {
      const running = o.experts.running(key);
      if (!running) return false;
      return !tiedTo(server, key, id);
    },

    ownKeyTakenExperts: (server) => o.experts.all().filter((r) => r.from === "expert-file" && heldOn(server, r.key)?.lastResult === "key-taken"),

    async beforeQuestion(server, key) {
      const r = heldOn(server, key);
      const running = o.experts.running(key);
      if (!r?.newerRecord || !r.record || running?.from !== "instance-file") return;
      const newer = r.newerRecord;
      if (newer.definition.project.id.toLowerCase() !== r.record.definition.project.id.toLowerCase()) {
        const found = await folderFor(server, newer.definition.project);
        if ("failed" in found) return log(key, `revision ${newer.revision} names the project ${newer.definition.project.name}, which couldn't be found or cloned here, so it isn't applied: ${found.failed}`);
        await write(o.experts.instanceFilePath(key), expertInstanceFileText({ ...running.instance!, repo: found.folder }));
      }
      await save(key, (s) => void (s[server] = { ...s[server], record: newer, newerRecord: undefined }));
      log(key, `revision ${newer.revision} of its record applies now, before its next question`);
      await o.experts.refresh(key);
    },

    afterDirectory(server) {
      for (const key of records.keys()) {
        void sendProofFailed(server, key);
        const s = setting.get(key);
        if (s?.server === server && s.folder) outs.get(server)?.want(key, s.expertRecordId);
      }
    },
  };
}

