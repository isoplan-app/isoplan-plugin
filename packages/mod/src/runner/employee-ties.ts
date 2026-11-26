// Each employee's tie to its expert record on one office server (isoplan-app#341), in
// employees/<key>/expert-records.json (expert-records-file.ts's format): an employee has an expert
// record as an expert does, its definition its job file's (employee-file.ts `definitionOfJob`).
//
// - One server per employee: the one its record is on, else the first in config.json's order whose
//   connection's first directory said `employees` and whose approved list takes its project (with a
//   remote). Its job is published only there, after the secret and personal-data patterns pass every
//   field (a match publishes nothing and names the field in its health log), and only on a connection
//   that said `employees` (expert-record-link.ts).
// - A publish's result: `published` ties it, and its runs may start; `runs-elsewhere` (it runs on
//   another computer of its owner's) and `key-taken` stop its runs here, its health log and runner.log
//   saying why; `edited-elsewhere` writes the record's definition into its job file, keeping this
//   computer's beside it; `deleted`, and its record gone from its office's directory, delete it.
// - A deletion (`expert-deleted` naming its record): its claims released, its runs stopped, its job
//   file moved to ~/.claude/isoplan/deleted-employees/<key>-<ms>.json so it is never published again,
//   and its folder deleted (employees.ts `remove`).
// - The listing's row of each employee tied to a server's record: `setting-up` at `grounding`,
//   `ready`, or `failed` with fixed words (its health log has the detail).

import fs from "node:fs/promises";
import path from "node:path";
import { ExpertDefinitionSchema, MAX_DETAIL_LENGTH, type ExpertDefinition, type ExpertDefinitionResultMessage, type ExpertDeletedMessage, type ExpertDirectoryMessage, type ExpertInstanceState, type Project } from "@isoplan/protocol";
import { definitionOfJob, jobFileText } from "./employee-file.js";
import type { EmployeeSettings } from "./employee.js";
import type { Employees } from "./employees.js";
import { renamed } from "./expert-checkout.js";
import { readExpertRecords, writeExpertRecords, type ExpertRecordsFile } from "./expert-records-file.js";
import type { CheckBeforeItLeaves } from "./what-was-learned-before-it-leaves.js";

/** What a failed grounding says on the floor: the health log has the detail, which can name paths on this computer. */
const GROUNDING_FAILED = "its grounding failed; this computer's health log for it says why";
const JOB_FILE_GONE = "its job file is gone from this computer";

export interface PublishedDefinition {
  definition: ExpertDefinition;
  basedOn?: { expertRecordId: string; revision: number };
}

export interface EmployeeTiesOptions {
  employees: Employees;
  /** The office servers in config.json, in its order. */
  servers: readonly string[];
  account: { id: string; name: string };
  /** Whether the server's directory (this connection's, else the last saved) says `employees`. */
  saysEmployees: (server: string) => boolean;
  /** The project the server's approved list takes for a folder; null when none; undefined while git can't say. */
  projectOn: (server: string, folder: string) => Promise<Project | null | undefined>;
  check: (thing: { text: string; files: { path: string }[] }) => Promise<CheckBeforeItLeaves>;
  settings: () => Promise<EmployeeSettings>;
  isoplanDir: string;
  log: (text: string) => void;
}

export interface EmployeeTies {
  start(): Promise<void>;
  /** Whether the key is an employee's on this computer. */
  has(key: string): boolean;
  /** The server its record is on, or would be published to once it is. */
  serverOf(key: string): string | null;
  /** Its record, when its job is published on its server. */
  tiedAndPublished(key: string): string | null;
  /** The definitions to publish to `server`: checked, and only those that server is the one for. */
  definitionsFor(server: string): Promise<PublishedDefinition[]>;
  /** Why its definition isn't published, when a check stopped it: for making one from the floor. */
  blocked(key: string): string | null;
  definitionResult(server: string, m: ExpertDefinitionResultMessage, sent: ExpertDefinition): Promise<void>;
  deleted(server: string, m: ExpertDeletedMessage): Promise<void>;
  directory(server: string, m: ExpertDirectoryMessage): Promise<void>;
  listingFor(server: string): ExpertInstanceState[];
  tiedRecords(server: string): { key: string; expertRecordId: string }[];
  tiedRecordsOf(key: string): { server: string; expertRecordId: string }[];
  heldOn(server: string, key: string): string | undefined;
  /** Its owner's Try again after a failed grounding (`set-up-expert-instance` `again`). */
  setUpAgain(key: string): void;
  onChange(listener: () => void): void;
}

/** A definition's fields as text, each checked before it leaves. */
const FIELDS: [string, (d: ExpertDefinition) => string][] = [
  ["key", (d) => d.key],
  ["subject", (d) => d.subject],
  ["model", (d) => d.model],
  ["brief", (d) => d.job!.brief],
  ["rules", (d) => d.job!.rules.join("\n")],
  ["documents", (d) => d.job!.documents.join("\n")],
  ["examples", (d) => d.job!.examples.join("\n")],
  ["experts", (d) => d.job!.experts.join("\n")],
  ["whoWasContacted", (d) => d.job!.whoWasContacted ?? ""],
];

/** The first field of a definition a check matched, with why, or null; `unreadable` when the patterns can't be read. */
export async function definitionCheck(d: ExpertDefinition, check: EmployeeTiesOptions["check"]): Promise<{ field: string; why: string } | "unreadable" | null> {
  for (const [field, text] of FIELDS) {
    const t = text(d);
    if (!t) continue;
    const r = await check({ text: t, files: [] });
    if ("unreadable" in r) return "unreadable";
    if ("matched" in r) return { field, why: r.matched === "personal-data" ? `its ${field} has ${r.pattern}: put a signature or an address in one of its documents, which never leave this computer` : `its ${field} matches the secret pattern "${r.pattern}"` };
  }
  return null;
}

export function createEmployeeTies(o: EmployeeTiesOptions): EmployeeTies {
  const files = new Map<string, ExpertRecordsFile>();
  const blocked = new Map<string, string>();
  const listeners: (() => void)[] = [];
  let saving: Promise<void> = Promise.resolve();
  const changed = () => listeners.forEach((l) => l());
  const of = (key: string) => files.get(key) ?? { version: 1 as const, servers: {} };
  const log = (key: string, text: string) => o.log(`employee ${key}: ${text}`);

  async function save(key: string, change: (f: ExpertRecordsFile) => void) {
    const f = structuredClone(of(key));
    change(f);
    files.set(key, f);
    const copy = structuredClone(f);
    saving = saving.then(() => writeExpertRecords(o.employees.dir(key), copy)).catch((err: Error) => log(key, `couldn't write its expert-records.json: ${err.message}`));
    await saving;
    o.employees.bindTies(tiedAndPublished);
    changed();
  }

  const recordServer = (key: string) => Object.entries(of(key).servers).find(([, r]) => r.record)?.[0] ?? null;
  function tiedAndPublished(key: string): string | null {
    const server = recordServer(key);
    const r = server ? of(key).servers[server] : undefined;
    return r?.lastResult === "published" && r.record ? r.record.expertRecordId : null;
  }

  async function remove(server: string, key: string, why: string) {
    const e = o.employees.get(key);
    if (e?.file) {
      const aside = path.join(o.isoplanDir, "deleted-employees", `${key}-${Date.now()}.json`);
      await fs.mkdir(path.dirname(aside), { recursive: true });
      await renamed(o.employees.jobFilePath(key), aside).catch((err: Error) => log(key, `couldn't move its job file aside: ${err.message}`));
      log(key, `${why}: its runs stop and its folder goes; its job file was moved to ${aside}`);
    } else log(key, `${why}: its folder goes`);
    o.employees.health(key).say("deleted", { server, why });
    files.delete(key);
    await o.employees.remove(key);
    changed();
  }

  const stateRow = (key: string, expertRecordId: string): ExpertInstanceState => {
    const s = o.employees.stateOf(key);
    if (!s) return { key, expertRecordId, state: "failed", failure: { why: "other", detail: JOB_FILE_GONE } };
    if (s.state === "ready") return { key, expertRecordId, state: "ready", ...(s.groundingTokens && { groundingTokens: s.groundingTokens }) };
    if (s.state === "setting-up") return { key, expertRecordId, state: "setting-up", step: "grounding" };
    return { key, expertRecordId, state: "failed", failure: { why: s.why, detail: (s.why === "clone" ? "its own clone of the project couldn't be made or fetched on this computer" : GROUNDING_FAILED).slice(0, MAX_DETAIL_LENGTH) } };
  };

  const ties: EmployeeTies = {
    async start() {
      for (const e of o.employees.all()) {
        const f = await readExpertRecords(o.employees.dir(e.key));
        if (Object.keys(f.servers).length) files.set(e.key, f);
        const server = recordServer(e.key);
        const r = server ? f.servers[server] : undefined;
        if (r?.record) o.employees.setProject(e.key, r.record.definition.project.id);
        if (r?.lastResult === "runs-elsewhere" || r?.lastResult === "key-taken") o.employees.setRefused(e.key, r.lastResult);
      }
      o.employees.bindTies(tiedAndPublished);
    },
    has: (key) => o.employees.get(key) !== null,
    serverOf: (key) => recordServer(key) ?? (o.employees.get(key)?.file ? (o.servers.find((s) => o.saysEmployees(s)) ?? null) : null),
    tiedAndPublished,
    blocked: (key) => blocked.get(key) ?? null,

    async definitionsFor(server) {
      const out: PublishedDefinition[] = [];
      const s = await o.settings();
      for (const e of o.employees.all()) {
        if (!e.file) continue;
        const key = e.key;
        const held = recordServer(key);
        if (held && held !== server) continue;
        if (!held) {
          let earlier = false;
          for (const other of o.servers.slice(0, Math.max(0, o.servers.indexOf(server)))) if (o.saysEmployees(other) && (await o.projectOn(other, e.file.repo).catch(() => null))) earlier = true;
          if (earlier) continue;
        }
        const project = await o.projectOn(server, e.file.repo).catch(() => undefined);
        if (project === undefined) continue;
        if (!project || project.id.toLowerCase().startsWith("local:")) {
          if (blocked.get(key) !== "project") log(key, `isn't published to ${server}: the office doesn't take its project's checkout ${e.file.repo}, or it has no remote`);
          blocked.set(key, "project");
          continue;
        }
        o.employees.setProject(key, project.id);
        const definition = definitionOfJob(e.file, project, s.employees.promoteAtTokens);
        const hit = await definitionCheck(definition, o.check);
        if (hit === "unreadable") {
          log(key, `the secret or personal-data patterns can't be read, so its job isn't published to ${server}`);
          continue;
        }
        if (hit) {
          if (blocked.get(key) !== hit.why) {
            log(key, `isn't published to ${server}: ${hit.why}`);
            o.employees.health(key).say("definition", { server, published: "no", field: hit.field, why: hit.why });
          }
          blocked.set(key, hit.why);
          continue;
        }
        const parsed = ExpertDefinitionSchema.safeParse(definition);
        if (!parsed.success) {
          const issue = parsed.error.issues[0]!;
          const why = `its ${issue.path.join(".")} doesn't fit the protocol: ${issue.message}`;
          if (blocked.get(key) !== why) log(key, `isn't published to ${server}: ${why}`);
          blocked.set(key, why);
          continue;
        }
        blocked.delete(key);
        const r = of(key).servers[server];
        if ((r?.lastResult === "runs-elsewhere" || r?.lastResult === "key-taken") && r.record === undefined && JSON.stringify(definition) === r.refusedFor) continue;
        if (r?.lastResult === "published" && r.record && JSON.stringify(r.record.definition) === JSON.stringify(definition)) continue;
        out.push({ definition, ...(r?.record && { basedOn: { expertRecordId: r.record.expertRecordId, revision: r.record.revision } }) });
      }
      return out;
    },

    async definitionResult(server, m, sent) {
      const key = m.key;
      const e = o.employees.get(key);
      if (!e) return;
      if (m.outcome === "published") {
        await save(key, (f) => void (f.servers[server] = { ...f.servers[server], record: { expertRecordId: m.expertRecordId, revision: m.revision, owner: o.account, yours: true, definition: sent }, lastResult: "published" }));
        o.employees.setRefused(key, null);
        o.employees.setProject(key, sent.project.id);
        o.employees.health(key).say("published", { server, record: m.expertRecordId, revision: m.revision });
        return;
      }
      if (m.reason === "edited-elsewhere") {
        if (!e.file) return;
        const aside = path.join(o.employees.dir(key), `definition-replaced-${Date.now()}.json`);
        await fs.writeFile(aside, JSON.stringify(sent, null, 2) + "\n");
        await fs.writeFile(o.employees.jobFilePath(key), jobFileText(m.definition, e.file.repo));
        await save(key, (f) => void (f.servers[server] = { record: { expertRecordId: m.expertRecordId, revision: m.revision, owner: o.account, yours: true, definition: m.definition }, lastResult: "published" }));
        o.employees.health(key).say("definition", { server, replaced: "yes", kept: aside });
        log(key, `its record was changed elsewhere first, so its job file now says revision ${m.revision}; this computer's job is kept in ${aside}`);
        await o.employees.refresh(key);
        return;
      }
      if (m.reason === "deleted") return remove(server, key, `deleted on the floor of ${server}, its office says`);
      const why = m.reason === "runs-elsewhere" ? `it runs on ${m.machineName}, the computer it was first published from, so it doesn't run on this one` : m.reason === "key-taken" ? "another expert or employee has this key: rename its job file" : m.reason === "project-not-in-an-office" ? "no office there holds its project" : "its record is someone else's now";
      await save(key, (f) => void (f.servers[server] = { ...f.servers[server], lastResult: m.reason, refusedFor: JSON.stringify(sent) }));
      if (m.reason === "runs-elsewhere" || m.reason === "key-taken" || m.reason === "not-owner") o.employees.setRefused(key, why);
      o.employees.health(key).say("refused", { server, reason: m.reason, why });
      log(key, `${server} refused its job: ${why}`);
    },

    async deleted(server, m) {
      const r = of(m.key).servers[server];
      if (r?.record?.expertRecordId !== m.expertRecordId) return;
      await remove(server, m.key, `deleted on the floor of ${server} by ${m.by.name || m.by.id}`);
    },

    async directory(server, m) {
      // Only a directory that lists employees can say an employee's record is gone.
      if (m.employees !== true) return;
      for (const key of [...files.keys()]) {
        const r = of(key).servers[server];
        if (r?.record && r.lastResult === "published" && !m.experts.some((x) => x.expertRecordId === r.record!.expertRecordId)) await remove(server, key, `its record has gone from ${server}'s offices`);
      }
    },

    listingFor: (server) =>
      [...files.keys()].sort().flatMap((key) => {
        const r = of(key).servers[server];
        return r?.lastResult === "published" && r.record ? [stateRow(key, r.record.expertRecordId)] : [];
      }),
    tiedRecords: (server) =>
      [...files.keys()].sort().flatMap((key) => {
        const r = of(key).servers[server];
        return r?.lastResult === "published" && r.record ? [{ key, expertRecordId: r.record.expertRecordId }] : [];
      }),
    tiedRecordsOf: (key) => Object.entries(of(key).servers).flatMap(([server, r]) => (r.lastResult === "published" && r.record ? [{ server, expertRecordId: r.record.expertRecordId }] : [])),
    heldOn: (server, key) => of(key).servers[server]?.record?.expertRecordId,
    setUpAgain(key) {
      o.employees.get(key)?.trunk?.retryNow();
    },
    onChange: (l) => void listeners.push(l),
  };
  return ties;
}

