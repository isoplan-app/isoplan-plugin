// One computer's expert stack in the tests, a copy of how the runner's worker puts it together
// (main.ts, which expert-two-computers.e2e.test.ts runs itself): its experts (experts.ts, with the
// fake `claude` and git of expert-fixture.ts), their instances, the set-up offers, what each session may ask, the asking module, and a record link per office
// with its link for what instances learn (checked against a stand-in secret pattern and the mod's personal-data patterns),
// whose live sends go to a stand-in office's list while it is up. Real files in a temp Claude folder;
// a session folder that is a real git repo with an origin, for the asking module's office pick.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { PROTOCOL_VERSION, type ExpertDefinition, type ExpertDirectoryEntry, type ExpertDirectoryMessage, type Project } from "@isoplan/protocol";
import { loadConfig } from "../data-layer/config.js";
import { modDir, tempRoot } from "../data-layer/fixture.js";
import { nodeIo } from "../data-layer/io.js";
import type { RunnerExpertRecordMessage, ServerExpertRecordMessage } from "../data-layer/link.js";
import type { DataLayerLine } from "../lines.js";
import { approvedPath } from "../data-layer/approved.js";
import { BASE, FAKE_CLAUDE, fakeGit, type Rule } from "./expert-fixture.js";
import type { EmployeeTies } from "./employee-ties.js";
import { createExpertInstanceSetUpOffers } from "./expert-instance-set-up-offer.js";
import { createExpertInstances } from "./expert-instance.js";
import { createExpertQuestionsAskedHere, type ExpertQuestionsAskedHereSettings } from "./expert-questions-asked-here.js";
import { createExpertRecordLink, type ExpertRecordLink } from "./expert-record-link.js";
import { createExpertRecordsPerOffice, expertRecordsPerOfficePath } from "./expert-records-per-office.js";
import { createExpertRightsOnThisComputer } from "./expert-rights-on-this-computer.js";
import type { ExpertSettings } from "./expert.js";
import { createExperts } from "./experts.js";
import { loadPatterns } from "./scan.js";
import { createCheckBeforeItLeaves } from "./what-was-learned-before-it-leaves.js";
import { createWhatWasLearnedLink, type WhatWasLearnedLink } from "./what-was-learned-link.js";

export const SERVER = "ws://127.0.0.1:4799/data-layer";
export const OTHER_SERVER = "ws://127.0.0.1:4798/data-layer";
export const PROJECT: Project = { id: "github.com/acme/app", name: "app" };
export const RECORD = "4f0c3a52-8a2b-4d6e-9f10-2b3c4d5e6f70";
export const OTHER_RECORD = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";
/** The expert's owner, someone else. */
export const ADA = { id: "claude:ada", name: "Ada" };
/** This computer's person. */
export const SAM = { id: "claude:sam", name: "Sam" };
export const ASKING = { openPerPersonPerExpert: 3, perPersonPerDay: 30, maxAgeHours: 72 };
export const DEFINITION: ExpertDefinition = { key: "adr", project: PROJECT, subject: "What may leave a machine.", model: "sonnet", promoteAtTokens: 200000, areas: [], proof: { question: "What is the answer?", answer: "Forty-two." } };

export const entryOf = (o: Partial<ExpertDirectoryEntry> = {}): ExpertDirectoryEntry => ({ key: "adr", expertRecordId: RECORD, project: PROJECT, owner: ADA, revision: 1, ...o });
export const directoryOf = (experts: ExpertDirectoryEntry[], asking = ASKING, shares = false): ExpertDirectoryMessage => ({ type: "expert-directory", v: PROTOCOL_VERSION, experts, asking, ...(shares && { sharesWhatExpertInstancesLearn: true as const }) });
/** A directory from an office that shares what instances of experts learn (protocol 0.18.0). */
export const sharingDirectoryOf = (experts: ExpertDirectoryEntry[], asking = ASKING) => directoryOf(experts, asking, true);

export interface ComputerOptions {
  account?: { id: string; name: string };
  rules?: Rule[];
  /** This computer's checkout of the project; null for none. */
  checkout?: string | null;
  /** Isoplan's own clone, by address: its folder, or why git refused. */
  clone?: (url: string) => string | { problem: string; reason?: string } | Promise<string | { problem: string; reason?: string }>;
  servers?: string[];
  minuteMs?: number;
  setUpWithoutAsking?: boolean;
  expertWaitSeconds?: number;
  questionsKeptHours?: number;
  /** Folders in the project, besides the checkout, the session's folder and the clones. */
  inProject?: string[];
  /** Writes files into the Claude folder before the stack starts, as an earlier run of the runner left them. */
  before?: (paths: { file: (...parts: string[]) => string; checkout: string | null }) => void;
  /** The folder of an earlier computer() to start again in: the same Claude folder, as a restarted runner. */
  root?: string;
  /** The projects each office takes, by its address, read at each look; PROJECT when not given, and no list at all for null. */
  takes?: Record<string, string[] | null>;
  /** A folder's project, in place of PROJECT for the folders in it; undefined leaves it to them. */
  projectOf?: (folder: string) => Project | null | undefined;
  /** How often the links look again: the record link's listing, and what instances learned waiting. */
  checkMs?: number;
  /** This computer's employees' ties, given to each record link as the runner gives them (isoplan-app#341). */
  employeeTies?: EmployeeTies;
  onEmployeesChange?: (listener: () => void) => void;
}

export async function computer(o: ComputerOptions = {}) {
  const root = o.root ?? tempRoot();
  const claudeDir = path.join(root, "claude");
  const isoplanDir = path.join(claudeDir, "isoplan");
  const servers = o.servers ?? [SERVER];
  fs.mkdirSync(isoplanDir, { recursive: true });
  // The session's folder: a real git repo whose origin the offices take.
  const sessionFolder = path.join(root, "session");
  if (!fs.existsSync(sessionFolder)) {
    fs.mkdirSync(sessionFolder);
    execFileSync("git", ["init", "-q"], { cwd: sessionFolder, windowsHide: true });
    execFileSync("git", ["remote", "add", "origin", "https://github.com/acme/app.git"], { cwd: sessionFolder, windowsHide: true });
  }
  fs.writeFileSync(path.join(isoplanDir, "config.json"), JSON.stringify({ servers: servers.map((server) => ({ server, label: "Office" })), allowPlainWs: true }));
  for (const server of servers) {
    fs.mkdirSync(path.dirname(approvedPath(claudeDir, server)), { recursive: true });
    fs.writeFileSync(approvedPath(claudeDir, server), JSON.stringify({ server, version: "v1", repos: [PROJECT.id], fetched: Date.now(), checked: Date.now() + 3600000 }));
  }
  const checkout = o.checkout === undefined ? path.join(root, "checkout") : o.checkout;
  const inProject = new Set([sessionFolder, ...(checkout ? [checkout] : []), ...(o.inProject ?? [])]);
  o.before?.({ file: (...parts) => path.join(isoplanDir, ...parts), checkout });

  const bin = path.join(root, "claude.js");
  const rulesFile = path.join(root, "rules.json");
  const claudeLog = path.join(root, "claude.jsonl");
  fs.writeFileSync(bin, FAKE_CLAUDE);
  if (!fs.existsSync(claudeLog)) fs.writeFileSync(claudeLog, "");
  const rules = (r: Rule[]) => fs.writeFileSync(rulesFile, JSON.stringify(r));
  rules(o.rules ?? BASE);
  const g = fakeGit(path.join(root, "unused"));
  const logs: string[] = [];
  const log = (t: string) => void logs.push(t);
  const scan = async (text: string) => (text.includes("SECRET") ? "test secret" : null);
  const settings = { ...JSON.parse(fs.readFileSync(path.join(modDir, "runner.json"), "utf8")), expertJudgeModel: "haiku", expertWaitSeconds: o.expertWaitSeconds ?? 10, expertInstances: { setUpWithoutAsking: o.setUpWithoutAsking ?? false, questionsKeptHours: o.questionsKeptHours ?? 144 } } as ExpertSettings & ExpertQuestionsAskedHereSettings;
  const account = o.account ?? SAM;

  const experts = createExperts({
    expertsDir: path.join(isoplanDir, "experts"),
    instancesDir: path.join(isoplanDir, "expert-instances"),
    logsDir: path.join(isoplanDir, "logs"),
    projectsDir: path.join(root, "projects"),
    appDir: modDir,
    binary: async () => bin,
    settings: async () => settings,
    scan,
    git: g.git,
    gitTimeoutMs: async () => 5000,
    env: { ...process.env, FAKE_RULES: rulesFile, FAKE_LOG: claudeLog },
    log,
    lookMs: 3600000,
    minuteMs: o.minuteMs ?? 4000,
  });
  const cloned: string[] = [];
  const instances = createExpertInstances({
    experts,
    isoplanDir,
    scan,
    log,
    checkoutOf: async (_server, project) => (project.id === PROJECT.id ? checkout : null),
    clone: async (url) => {
      cloned.push(url);
      const got = await (o.clone?.(url) ?? { problem: "git refused", reason: `fatal: could not read from ${url}` });
      if (typeof got === "string") inProject.add(got);
      return got;
    },
  });
  const store = createExpertRecordsPerOffice({ file: expertRecordsPerOfficePath(isoplanDir), keptHours: async () => 144, log });
  await store.load();
  const sent = new Map<string, RunnerExpertRecordMessage[]>(servers.map((s) => [s, []]));
  const up = new Map<string, boolean>(servers.map((s) => [s, true]));
  const links = new Map<string, ExpertRecordLink>();
  const connected = new Set<string>();
  const lines = new Map<string, DataLayerLine[]>();
  const linesOf = (session: string) => lines.get(session) ?? (lines.set(session, []), lines.get(session)!);
  const hooked = (session: string) => (connected.has(session) ? { send: (line: DataLayerLine) => void linesOf(session).push(line) } : null);
  const offers = createExpertInstanceSetUpOffers({
    file: path.join(isoplanDir, "runner", "expert-instance-set-up-offers.json"),
    setUpWithoutAsking: async () => settings.expertInstances.setUpWithoutAsking,
    setUp: (server, entry) => void instances.setUp(server, entry),
    send: (server, m) => links.get(server)?.sendNow(m) ?? false,
    hooked,
    hasInstance: (server, key, id) => {
      const found = instances.lookUp(server, key, null);
      return !!found && found.kind !== "set-up-failed" && found.expertRecordId === id;
    },
    log,
  });
  instances.onChange(() => offers.instancesChanged());
  const projectOfFolder = (folder: string) => {
    const said = o.projectOf?.(folder);
    return said !== undefined ? said : inProject.has(folder) ? PROJECT : null;
  };
  const takes = (server: string) => {
    const list = o.takes?.[server];
    return list === null ? null : new Set(list ?? [PROJECT.id]);
  };
  const home = async (folder: string, repos: ReadonlySet<string>) => {
    const project = projectOfFolder(folder);
    return project && (project.id.startsWith("local:") || repos.has(project.id)) ? project : null;
  };
  for (const server of servers) {
    const link = createExpertRecordLink({
      server,
      account,
      experts,
      instances,
      store,
      offerEnded: (s, m) => offers.ended(s, m),
      approved: { refresh: async () => {}, repos: () => takes(server) },
      home,
      scan,
      log,
      send: (m) => (up.get(server) ? (sent.get(server)!.push(m), true) : false),
      checkMs: o.checkMs ?? 3600000,
      ...(o.employeeTies && { employeeTies: o.employeeTies }),
      ...(o.onEmployeesChange && { onEmployeesChange: o.onEmployeesChange }),
    });
    link.onDirectory(() => offers.afterDirectory(server));
    links.set(server, link);
  }
  const check = createCheckBeforeItLeaves({ secretPatterns: async () => [{ name: "test secret", regex: /SECRET/ }], personalDataPatterns: () => loadPatterns(path.join(modDir, "personal-data-patterns.json"), path.join(isoplanDir, "personal-data-patterns.json"), log) });
  const learnedLinks = new Map<string, WhatWasLearnedLink>();
  for (const server of servers) {
    const link = createWhatWasLearnedLink({ server, recordLink: links.get(server)!, instances, whatWasLearned: (key) => experts.whatWasLearned(key), health: (key) => experts.health(key), check, send: (m) => (up.get(server) ? (sent.get(server)!.push(m), true) : false), log, checkMs: o.checkMs ?? 3600000 });
    links.get(server)!.onWhatWasLearned((m) => link.take(m));
    learnedLinks.set(server, link);
  }
  const rights = createExpertRightsOnThisComputer({ instances, store, person: () => account.name, projectOf: (server, folder) => home(folder, takes(server) ?? new Set()), send: (session, line) => hooked(session)?.send(line), log });
  const asking = createExpertQuestionsAskedHere({
    file: path.join(isoplanDir, "runner", "expert-questions-asked-here.json"),
    claudeDir,
    config: () => loadConfig(nodeIo(), path.join(modDir, "config.json"), path.join(isoplanDir, "config.json")),
    settings: async () => settings,
    links,
    instances,
    offers,
    rights: (session, server) => rights.rights(session, server),
    hooked,
    log,
  });
  await experts.start();
  await instances.start();
  // Once the instances have read what each key keeps of its records, as the runner binds them.
  experts.bindWhatWasLearned((key) => ({
    tied: () => instances.tiedRecordsOf(key),
    held: (server) => instances.heldOn(server, key)?.record?.expertRecordId,
    servers,
    catchUp: (server, expertRecordId) => learnedLinks.get(server)?.catchUp(expertRecordId) ?? "cannot",
    waiting: () => learnedLinks.forEach((l) => l.sendWaiting()),
  }));
  instances.onChange(() => experts.tiesMayHaveChanged());
  await offers.start();
  await asking.start();
  for (const link of links.values()) link.onOpen();
  for (const link of learnedLinks.values()) link.onOpen();

  const claude = () => fs.readFileSync(claudeLog, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l) as { kind: string; trunk: string | null; argv?: string[]; turn?: number; text?: string });
  const health = (key = "adr") => {
    const file = path.join(isoplanDir, "logs", `expert-${key}.log`);
    return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  };
  const of = <T extends RunnerExpertRecordMessage["type"]>(type: T, server = SERVER) => sent.get(server)!.filter((m): m is Extract<RunnerExpertRecordMessage, { type: T }> => m.type === type);
  return {
    root,
    claudeDir,
    isoplanDir,
    sessionFolder,
    checkout,
    experts,
    instances,
    offers,
    rights,
    asking,
    links,
    store,
    sent,
    of,
    up,
    logs,
    cloned,
    rules,
    git: g,
    claude,
    health,
    settings,
    lines: linesOf,
    /** The session's hooks module connects to the runner. */
    connect: (session: string) => (connected.add(session), asking.rehooked(session), offers.rehooked(session)),
    disconnect: (session: string) => void connected.delete(session),
    /** A message from the office, as its link hands it on. */
    take: (m: ServerExpertRecordMessage, server = SERVER) => links.get(server)!.take(m),
    /** The link drops and opens again. */
    reconnect: (server = SERVER) => (links.get(server)!.onClose(), learnedLinks.get(server)!.onClose(), links.get(server)!.onOpen(), learnedLinks.get(server)!.onOpen()),
    file: (...parts: string[]) => path.join(isoplanDir, ...parts),
    /** Ends it as the runner's worker ends, once what it keeps is written. */
    /** What the key's instance learned waiting to be sent, and what this computer has of its records. */
    learned: (key = "adr") => experts.whatWasLearned(key),
    close: async () => {
      for (const link of links.values()) link.stop();
      for (const link of learnedLinks.values()) link.stop();
      asking.close();
      experts.close();
      await store.written();
    },
  };
}

export type Computer = Awaited<ReturnType<typeof computer>>;

/** Writes this computer's own expert file for the key, in `repo`. */
export function writeExpertFile(c: Computer, o: Record<string, unknown> = {}) {
  const file = { version: 1, name: DEFINITION.key, repo: c.checkout, subject: DEFINITION.subject, model: DEFINITION.model, promoteAtTokens: DEFINITION.promoteAtTokens, proof: DEFINITION.proof, ...o };
  fs.mkdirSync(c.file("experts"), { recursive: true });
  fs.writeFileSync(c.file("experts", `${file.name}.json`), JSON.stringify(file, null, 2));
  return file;
}

export const readJsonFile = <T = Record<string, unknown>>(file: string): T => JSON.parse(fs.readFileSync(file, "utf8")) as T;

/** An instance of `id` from `server`, someone else's record (DEFINITION, unless given; its key the definition's), as its set-up wrote it in an earlier run, with this computer's fields given: for `before`. */
export const installedInstance =
  (server: string, id: string, local: Record<string, unknown> = {}, definition: ExpertDefinition = DEFINITION) =>
  (p: { file: (...parts: string[]) => string; checkout: string | null }) => {
    const { key } = definition;
    fs.mkdirSync(p.file("experts", key), { recursive: true });
    fs.writeFileSync(p.file("experts", key, "expert-records.json"), JSON.stringify({ version: 1, servers: { [server]: { record: { expertRecordId: id, revision: 1, owner: ADA, yours: false, definition } } } }));
    fs.mkdirSync(p.file("expert-instances"), { recursive: true });
    fs.writeFileSync(p.file("expert-instances", `${key}.json`), JSON.stringify({ version: 1, key, server, repo: p.checkout, ...local }));
  };
