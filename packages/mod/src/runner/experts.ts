// The experts this machine hosts: one for each expert file in ~/.claude/isoplan/experts
// (expert-files.ts watches the folder), each run by expert.ts in <name>/ beside its file, with its
// health log at ~/.claude/isoplan/logs/expert-<name>.log.
//
// - Its clone, read/, is where it was first made, so its trunks can still be resumed: <name>/read,
//   or <folder>/experts/<name>/read for a folder runner.json's `clonesFolder` names or named before.
//   A new one goes in the folder `clonesFolder` names, else in <name>/ (readFolder).
//
// - A file that doesn't parse is logged, to runner.log and to that expert's health log, and its
//   expert doesn't start; one already running keeps running. A field the runner doesn't know is
//   logged once per load. A change is the expert's to apply; a removed file stops its expert, whose
//   folder is kept.
// - `start()` settles once every file and every state.json is read: from then every recorded trunk
//   is known to `isExpertSession`, and an expert that can resume its junior is ready. Git and
//   groundings run in the background.
// - Requests go to their expert by name; one naming an expert this machine doesn't host is refused
//   EXPERT_UNKNOWN, and so is one from an office that doesn't take the expert's repo (`forOffice`).
//   Releases and drops go to the expert that owns the request.
// - What each office server is told (`listingFor`, expert-link.ts), with `senior` when the expert
//   has a senior its junior can ask, and `areas`, its file's folders and globs that fit the
//   protocol (at most MAX_AREA_PATHS), so the office offers no expert on a folder it covers: only
//   experts whose repo that office takes, never one whose project has no remote (its id would name
//   a path on this machine), never a subject that matches a secret pattern, at most MAX_EXPERTS, the
//   first by name.

import fs from "node:fs";
import path from "node:path";
import { AreaPathSchema, ExpertListingSchema, MAX_AREA_PATHS, MAX_EXPERTS, PROTOCOL_VERSION, type ExpertListing, type Project, type RefusalMessage, type ReplyMessage } from "@isoplan/protocol";
import type { Spawn, Track } from "./claude.js";
import { inside } from "./expert-claude.js";
import { parseExpertFile } from "./expert-file.js";
import { watchExpertFiles, type ExpertFileChange, type ExpertFiles } from "./expert-files.js";
import { createHealthLog, type HealthLog } from "./expert-health.js";
import { createExpert, type AnswerExpertRequest, type Expert, type ExpertSettings, type HostedExpert } from "./expert.js";
import { UNREADABLE } from "./scan.js";
import type { RunGit } from "../handoff/git.js";

export type { HostedExpert } from "./expert.js";

type Outgoing = ReplyMessage | RefusalMessage;

export interface ExpertsOptions {
  /** <claudeDir>/isoplan/experts */
  expertsDir: string;
  /** runner.json's `clonesFolder`, where a new expert's clone goes; "" for its folder in expertsDir. */
  clonesFolder?: string;
  /** Every folder `clonesFolder` has named (repo-folders.ts readClonesFolders), where an expert's clone made earlier may be. */
  clonesFolders?: readonly string[];
  /** <claudeDir>/isoplan/logs */
  logsDir: string;
  /** <claudeDir>/projects, where trunk transcripts are (resume check) */
  projectsDir: string;
  /** The runner's app folder: prompts/expert-*.md */
  appDir: string;
  binary: () => Promise<string | null>;
  /** runner.json */
  settings: () => Promise<ExpertSettings>;
  scan: (text: string) => Promise<string | null>;
  git: RunGit;
  gitTimeoutMs: () => Promise<number>;
  spawn?: Spawn;
  env?: Record<string, string | undefined>;
  track?: Track;
  log: (text: string) => void;
  now?: () => number;
  lookMs?: number;
}

export interface Experts {
  /** Settles once the expert files and each state.json are read; the rest runs in the background. */
  start(): Promise<void>;
  hosted(): HostedExpert[];
  /** `hosted()` changed: an expert added, removed, or its state. Several listeners, one per office. */
  onChange(listener: () => void): void;
  /** An office server's `hosting`: the experts it doesn't list are logged in their health logs, and so are those it lists again after. */
  listed(server: string, names: readonly string[]): void;
  owns(request: string): boolean;
  /** `senior` is told the request's id when the expert's junior first asks its senior for it. */
  answer(request: AnswerExpertRequest, send: (m: Outgoing) => void, senior?: (id: string) => void): void;
  release(request: string, send: (m: Outgoing) => void): void;
  drop(request: string): void;
  /** A bare uuid of a trunk, any generation. */
  isExpertSession(sessionId: string): boolean;
  /** No grounding, fork, append or judge running. */
  idle(): boolean;
  /** Ends every process tree, the judge's included. */
  close(): void;
}

export function createExperts(o: ExpertsOptions): Experts {
  const experts = new Map<string, Expert>();
  const stopped: Expert[] = []; // removed, kept so their requests in flight are still theirs
  const trunks = new Set<string>();
  const listeners: (() => void)[] = [];
  const healths = new Map<string, HealthLog>();
  const loading: Promise<void>[] = [];
  const unlisted = new Map<string, string>(); // server → the names it last didn't list
  let watcher: ExpertFiles | null = null;

  const changed = () => listeners.forEach((l) => l());
  const health = (name: string) => {
    let h = healths.get(name);
    if (!h) healths.set(name, (h = createHealthLog(path.join(o.logsDir, `expert-${name}.log`), o.now)));
    return h;
  };
  const owner = (request: string) => [...experts.values(), ...stopped].find((e) => e.owns(request));
  // Where an expert's clone is: where it was made, since its trunks resume only from there; else where a new one goes.
  const readFolder = (name: string) => {
    const made = [path.join(o.expertsDir, name, "read"), ...[o.clonesFolder ?? "", ...(o.clonesFolders ?? [])].filter(Boolean).map((f) => path.join(f, "experts", name, "read"))];
    return made.find((p) => fs.existsSync(p)) ?? (o.clonesFolder ? path.join(o.clonesFolder, "experts", name, "read") : made[0]!);
  };

  function onFile(change: ExpertFileChange) {
    const { name } = change;
    const fileName = `${name}.json`;
    const running = experts.get(name);
    if (change.kind === "removed") {
      if (!running) return;
      o.log(`expert ${name}: its file was removed, so it stops; its folder is kept`);
      running.stop();
      experts.delete(name);
      stopped.push(running);
      changed();
      return;
    }
    const parsed = parseExpertFile(change.text!, fileName);
    if (!parsed.ok) {
      const error = `${fileName}: ${parsed.field}: ${parsed.reason}`;
      o.log(`expert file ${error}${running ? "; the expert keeps running as it was" : ""}`);
      health(name).say("file", { error });
      return;
    }
    if (parsed.unknown.length) o.log(`expert file ${fileName}: fields this runner doesn't know, ignored: ${parsed.unknown.join(", ")}`);
    if (running) return running.update(parsed.expert);
    const expert = createExpert({
      ...o,
      file: parsed.expert,
      dir: path.join(o.expertsDir, name),
      read: readFolder(name),
      health: health(name),
      onChange: changed,
      onTrunk: (trunk) => trunks.add(trunk),
    });
    experts.set(name, expert);
    loading.push(expert.start().catch((err: Error) => o.log(`expert ${name}: couldn't start: ${err.message}`)));
    changed();
  }

  return {
    async start() {
      watcher = watchExpertFiles({ dir: o.expertsDir, ...(o.lookMs !== undefined && { lookMs: o.lookMs }), log: o.log, onChange: onFile });
      await watcher.look();
      await Promise.all(loading);
    },
    hosted: () => [...experts.values()].map((e) => e.hosted()).sort((a, b) => a.name.localeCompare(b.name)),
    onChange: (listener) => void listeners.push(listener),
    listed(server, listed) {
      const missing = [...experts.keys()].filter((n) => !listed.includes(n)).sort();
      const text = missing.join(",");
      const before = unlisted.get(server) ?? "";
      if (before === text) return;
      unlisted.set(server, text);
      const now = before.split(",").filter((n) => experts.has(n) && listed.includes(n));
      if (now.length) {
        o.log(`${server} now lists the experts ${now.join(", ")}`);
        for (const name of now) health(name).say("listed", { server, unlisted: text });
      }
      if (!missing.length) return;
      o.log(`${server} doesn't list the experts ${missing.join(", ")}: their repo isn't in an office there, another machine's expert has the name, or the office has more experts than a session may be told of`);
      for (const name of missing) health(name).say("listed", { server, unlisted: text });
    },
    owns: (request) => owner(request) !== undefined,
    answer(request, send, senior) {
      const expert = experts.get(request.expert);
      if (expert) return expert.answer(request, send, senior);
      send({ type: "refusal", v: PROTOCOL_VERSION, id: request.id, reason: "unavailable", detail: `this machine hosts no expert named ${request.expert} now`, expert: { code: "EXPERT_UNKNOWN" } });
    },
    release(request, send) {
      const expert = owner(request);
      if (expert) return expert.release(request, send);
      send({ type: "refusal", v: PROTOCOL_VERSION, id: request, reason: "unavailable", detail: "nothing is withheld under this id here; the runner may have restarted since, so ask again" });
    },
    drop: (request) => owner(request)?.drop(request),
    isExpertSession: (sessionId) => trunks.has(sessionId),
    idle: () => [...experts.values(), ...stopped].every((e) => e.idle()),
    close() {
      watcher?.stop();
      for (const e of [...experts.values(), ...stopped]) e.close();
    },
  };
}

/** Whether a session is an expert's, to keep it off the floor: in the experts' folder or experts/ of a folder `clonesFolder` has named, or a trunk of one (while `experts` is made). */
export const expertIgnored =
  (expertsDir: string, experts: () => Pick<Experts, "isExpertSession"> | null, clonesFolders: readonly string[] = []) =>
  (id: string, cwd: string | null): boolean =>
    (cwd !== null && [expertsDir, ...clonesFolders.map((f) => path.join(f, "experts"))].some((dir) => inside(dir, cwd) !== null)) || (experts()?.isExpertSession(id) ?? false);

/**
 * The experts as one office's runner asks them: a question for an expert whose repo that office
 * doesn't take (by `home`, as `listingFor` lists) is refused as for an unknown name, before the
 * expert sees it, so an office never gets an answer about another office's repo. `senior` is that
 * office's (expert-link.ts), told when a junior first asks its senior for one of its requests.
 */
export function forOffice(experts: Pick<Experts, "hosted" | "owns" | "answer" | "release" | "drop">, home: (folder: string) => Promise<Project | null>, log: (text: string) => void, senior?: (id: string) => void): Pick<Experts, "owns" | "answer" | "release" | "drop"> {
  return {
    owns: (request) => experts.owns(request),
    answer(request, send) {
      const hosted = experts.hosted().find((h) => h.name === request.expert);
      if (!hosted) return experts.answer(request, send, senior);
      void home(hosted.repo).then(
        (project) => {
          if (project && !project.id.startsWith("local:")) return experts.answer(request, send, senior);
          log(`expert ${request.expert}: refused ${request.id}, since this office doesn't take its repo`);
          send({ type: "refusal", v: PROTOCOL_VERSION, id: request.id, reason: "unavailable", detail: `this machine hosts no expert named ${request.expert} now`, expert: { code: "EXPERT_UNKNOWN" } });
        },
        (err: Error) => {
          log(`expert ${request.expert}: couldn't tell whether this office takes its repo, so ${request.id} is refused: ${err.message}`);
          send({ type: "refusal", v: PROTOCOL_VERSION, id: request.id, reason: "unavailable", detail: "the expert's host couldn't check this office's repos; ask again later" });
        },
      );
    },
    release: (request, send) => experts.release(request, send),
    drop: (request) => experts.drop(request),
  };
}

/**
 * The listing one office server is sent: each hosted expert whose repo `home` places in a project
 * that office takes, with a remote, a subject clear of secrets, and a shape the protocol takes; at
 * most MAX_EXPERTS, by name. Each one left out is logged with why. Null when the secret patterns
 * can't be read: nothing can be told then, so the listing sent last stands.
 */
export async function listingFor(hosted: HostedExpert[], home: (folder: string) => Promise<Project | null>, scan: (text: string) => Promise<string | null>, log: (text: string) => void): Promise<ExpertListing[] | null> {
  const out: ExpertListing[] = [];
  for (const h of [...hosted].sort((a, b) => a.name.localeCompare(b.name))) {
    const project = await home(h.repo);
    if (!project) {
      log(`expert ${h.name} isn't listed: the office doesn't take its repo ${h.repo}`);
      continue;
    }
    if (project.id.startsWith("local:")) {
      log(`expert ${h.name} isn't listed: its repo ${h.repo} has no remote, so its project would name a folder on this machine`);
      continue;
    }
    const matched = await scan(h.subject);
    if (matched === UNREADABLE) return null;
    if (matched) {
      log(`expert ${h.name} isn't listed: its subject matches the secret pattern "${matched}"`);
      continue;
    }
    const areas = (h.areas ?? []).filter((a) => AreaPathSchema.safeParse(a).success).slice(0, MAX_AREA_PATHS);
    const listing = { name: h.name, project: { id: project.id, name: project.name }, subject: h.subject, state: h.state, ...(h.senior && { senior: true }), ...(areas.length && { areas }) };
    const parsed = ExpertListingSchema.safeParse(listing);
    if (!parsed.success) {
      log(`expert ${h.name} isn't listed: its listing doesn't fit the protocol: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
      continue;
    }
    out.push(parsed.data);
  }
  if (out.length > MAX_EXPERTS) log(`only ${MAX_EXPERTS} experts are listed to an office, so these aren't: ${out.slice(MAX_EXPERTS).map((e) => e.name).join(", ")}`);
  return out.slice(0, MAX_EXPERTS);
}
