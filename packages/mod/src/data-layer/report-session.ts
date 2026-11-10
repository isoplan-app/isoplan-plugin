// Reporting one Claude Code session: the data layer's loop, which the machine's runner runs in its
// own process for every session on the machine (src/runner/reporting.ts, ADR 0007), two ways: for a
// session whose hooks module is connected to the runner's pipe (src/pipe), `by: "hooks"`, and for one
// without, `by: "runner"`. What follows says "the data layer" for both.
//
// Every `streamSeconds` it reads the session's facts from its transcripts and hands them to the
// link, which holds the WebSocket to the office server. For a hooks module it emits JSON lines
// (src/lines.ts), which go down the pipe: the link's state, the server's notes, and room titles to
// write. It reports a hooks module's session until that hooks module's connection goes (`closed`),
// or another reports it. Each agent's report is
// secret-checked before it is sent, and one that matches is held until its owner releases it
// (src/data-layer/reports.ts). Only a session in a repo the office takes is reported: the data layer
// reads the office's list of repos (src/data-layer/approved.ts) and opens no link for any other,
// sending nothing of it, its hello included, and says so in the status line. An office server that
// signs people in wants the machine paired first: reading that list pairs it, keeping the credential
// in <claude dir>/isoplan/pairing.json, under the machine's Claude account (src/data-layer/pairing.ts).
// For a hooks module it keeps the plugin up to date (src/update): as it starts and every
// `updateCheckHours` it installs a newer version in the background, and once one is on disk it says
// so in the status line, since the session loads it only at /reload-plugins. The copy it goes by is
// the hooks module's (`root`).
// An agent's open question to its owner is reported too, secret-checked like a report, and
// answerable from the floor while the session's hooks module marks that it waits for it
// (src/data-layer/owner-answers.ts); without a hooks module they are read-only. The session fact
// carries the session's context window once its hooks module has written the size to the file the
// `window` line names; without one there is none. A Claude Code workflow's name,
// description, phases and agents' labels are secret-checked too, and one that matches goes out as a
// placeholder (src/data-layer/workflows.ts); its agents' results are reports like any other.
// For a hooks module the session fact says `hooks`. For one that can submit a prompt
// (`takesMessages`), it says `takesMessages` too, and a message its owner sends from the floor goes
// to that hooks module, which submits it as the session's next turn (src/data-layer/owner-messages.ts);
// when that hooks module can also end the running turn (`endsTurns`), its open questions it didn't
// see asked are answerable as the owner's message.
//
// Its log lines go to <claude dir>/isoplan/logs/<session>.log (the runner's sessionLog), and without
// a hooks module the other lines are dropped. Without one it reports only while the session is at work, and the
// runner starts it again once the session's transcript moves: it ends once the session has been
// quiet longer than `idleMinutes`, once its link has been down five minutes in a row
// (src/data-layer/detached.ts), once the session has nothing to report, or when the server says the
// project isn't wanted. Started before the session's transcript has anything to report, it waits up
// to `factsWaitSeconds` for it first. Each way it ends is said in its log (#92). It can't watch the
// session's own process, so a closed session shows as quiet until it ends, then unreachable.
//
// It reports to every office server config.json names (#105): each has its own pairing, its own
// copy of the office's list, its own link, opened only while that office takes the session's repo,
// and its own hold on reports, which a release on that office's floor lets out to it alone. Each
// office's list is checked at once with the others', and a pass waits for a slow one at most
// `streamSeconds`, so one office's failure, pairing link, list or slowness never touches another's.
// The facts are read once a pass and go to each of those links; what the hooks module is sent names
// the office, and an office shows in the status line only once it is known to take the repo (or
// waits to be paired). Without a hooks module, a session one office doesn't want, while no office takes the
// repo, ends with a hold-off naming that office (`Ended`), which the runner keeps (reporting.ts).
// The runner gives it its own pairing and list for each office, so a machine pairs once per office.
//
// The runner reports a session once, with the hooks module the pipe has registered for it, if any
// (src/pipe/server.ts decides between two windows). It still takes <claude dir>/isoplan/live/
// <session>.json (src/wake/lock.ts) and refreshes it each pass, only so the data layer process of an
// earlier version (a session still on an older copy of the plugin) and the runner never report one
// session at once. Without a hooks module the lock says `detached`, and it doesn't start while such
// a data layer holds a fresh lock (three of its own slowest passes, lockFreshMs, from its
// config.json). For a hooks module it writes the lock as that hooks module's copy's data layer would
// have (its dist/data-layer.js, `detached: false`, when its window started, and a live parent), the
// shape an earlier version's data layer gives a session up to: so after a /reload-plugins, the new
// hooks module's report takes the lock over from the old version's data layer (takesOver), which
// leaves the session to it. Either way it ends as soon as such a data layer takes the lock back,
// telling a hooks module it reported for that it is `superseded` (`earlier`).

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PROTOCOL_VERSION, type Facts, type Project } from "@isoplan/protocol";
import { installApp, type InstallApp } from "../install/app.js";
import { installWake, type LinkHandlerPlace } from "../install/install.js";
import type { LoginItemPlace } from "../install/login-item.js";
import { managedDir, newestDataLayer, normalPath, pluginDirsOf, pluginIdOf, pluginState, pluginsDir, type Place } from "../install/state.js";
import type { ContextWindow, DataLayerLine, TitleReply, WaitMark } from "../lines.js";
import { claudeBinary, claudeCommand, findClaude } from "../runner/claude-binary.js";
import { SESSION_ENV } from "../pipe/pipe.js";
import { drivenName, registryPath } from "../runner/registry.js";
import { errorText, loadPatterns, type Pattern } from "../runner/scan.js";
import { startRunner, type StartOptions, type Started } from "../runner/start.js";
import { checkForUpdate, commandEnv, gitChoices, START_GAP_MS, updatesOffBy } from "../update/update.js";
import { alive, HOLD_OFF_MS, lockHolder, lockPath, readLock, refreshLock, releaseLock, takeLock, type LockBody } from "../wake/lock.js";
import { approvedPath, cachedRepos, createApproved, createSessionGate, type Approved, type Dormancy, type SessionGate } from "./approved.js";
import { forOffice } from "./attribution.js";
import { candidatesOf, inRepos } from "./home.js";
import { createClaudeCode, type SourceRead } from "./claude-code.js";
import { loadConfig, officesOf, type Config, type Office } from "./config.js";
import { detachedStop } from "./detached.js";
import { createGit, pathKey, type Where } from "./git.js";
import { accountOf, claudePaths, projectOf } from "./identity.js";
import { nodeIo } from "./io.js";
import { createLink, type Link, type ServerAsk } from "./link.js";
import { lateTake, prepareQuestions, relayOwnerAnswer } from "./owner-answers.js";
import { relayOwnerMessage } from "./owner-messages.js";
import { createPairing, pairingLockPath, pairingPath, pairingWriteLockPath, type Pairing } from "./pairing.js";
import { askingRemoteNames } from "./remote-names.js";
import { openReportHold, releasedPath, type ReportHold } from "./reports.js";
import { cleanTitle, nextTitle, TITLE_SYSTEM, type TitleCache } from "./titles.js";
import { prepareWorkflows } from "./workflows.js";

// A session's log starts over once it is this big.
const LOG_CAP_BYTES = 64 * 1024;
/** One office server this data layer reports to, and what it keeps for it alone. */
interface OfficeRun {
  office: Office;
  pairing: Pairing;
  approved: Approved;
  gate: SessionGate;
  /** The reports held for this office, until its floor releases them. */
  hold: ReportHold;
  /** The facts last given to its link. */
  sent: Facts | null;
  /** The hooks module's lines from this office's link and pairing, named for it. */
  emit: (line: DataLayerLine) => void;
  /** Whether its list has said yet whether it takes the session's home, and why nothing is sent to it while it doesn't. */
  known: boolean;
  dormant: Dormancy | null;
  /** Its list's check under way, and what one that finished said, kept until the next pass's gating takes it. */
  homing: Promise<void> | null;
  result: { dormancy: Dormancy | null; projects: readonly Project[]; workspace: boolean } | null;
  connected: boolean;
  /** Without a hooks module, and the server said this project isn't wanted; until when that holds, once it ends. */
  unwanted: boolean;
  unwantedUntil: number | null;
}

// How long a session the office doesn't take waits between passes.
const DORMANT_MS = 30000;
// A session lock its holder hasn't refreshed for this long (three of its slowest passes) counts for
// nothing when a data layer decides whether to give the session up, or the runner whether to take
// it: the pid may have been reused.
export const LOCK_FRESH_MS = 3 * DORMANT_MS;
/** The same for a holder whose passes `streamSeconds` makes slower: a pass may wait that long, and a slow office's list as long again. */
export const lockFreshMs = (config: Pick<Config, "streamSeconds">) => Math.max(LOCK_FRESH_MS, 3 * 2 * config.streamSeconds * 1000);

/**
 * Whether a report for a hooks module takes the session's lock over from its holder: the data layer
 * process of an earlier version (`detached: false`, not the runner's), of another copy of the plugin
 * than the hooks module's `self` (its dist/data-layer.js), or of that copy in a window that started
 * before `since`. Such a data layer gives the session up once it sees the lock in this shape.
 */
export function takesOver(held: LockBody | null, self: string, since: number, pid = process.pid): boolean {
  if (!held?.pid || held.pid === pid) return false;
  const { dataLayer, detached, runner, since: theirs } = held.extra;
  if (detached !== false || runner === true || typeof dataLayer !== "string") return false;
  return normalPath(dataLayer) !== normalPath(self) || (typeof theirs === "number" && since > theirs);
}

/** The environment a hooks module's report goes by: the runner's, with the session's own SESSION_ENV in place of the runner's, so one the session doesn't set isn't set. */
export function hookedEnv(env: Record<string, string> = {}): Record<string, string | undefined> {
  const base: Record<string, string | undefined> = { ...process.env };
  for (const name of SESSION_ENV) delete base[name];
  return { ...base, ...env };
}

/**
 * Whether a hooks module's copy of the plugin (its dist/data-layer.js, `self`) is outdated: another
 * copy is the newest installed for `project` (state.ts). Such a copy's report never takes the lock
 * over (takesOver), here or in the runner's look (src/runner/reporting.ts).
 */
export const outdatedCopy = async (claudeDir: string, env: Record<string, string | undefined>, self: string, project: string) =>
  (await newestDataLayer(pluginsDir(claudeDir, env), self, project).catch(() => self)) !== self;

export interface ReportSessionOptions {
  sessionId: string;
  /** The session's folder. */
  cwd: string;
  /** The session's project folder ($CLAUDE_PROJECT_DIR), for the plugin's settings; its folder without one. */
  project?: string;
  /** For whom: the session's hooks module, connected to the runner's pipe, or a session without one. */
  by: "hooks" | "runner";
  /** The folder with the defaults: config.json and secret-patterns.json, and dist/ (the mod's folder, or the runner's copy). */
  appDir: string;
  /** With a hooks module: the plugin's folder it runs from, whose copy decides whether it is outdated, disabled or updated. */
  root?: string;
  /** With a hooks module: when its window's hooks module started. */
  since?: number;
  /** With a hooks module: the variables of the session's own environment it passed on (src/pipe/pipe.ts SESSION_ENV), read in place of the runner's. */
  env?: Record<string, string>;
  /** Lines for the hooks module, and the session's log (sessionLog). */
  emit(line: DataLayerLine): void;
  /** Settles when it should end, with why, as its log says it: the hooks module's connection went, another hooks module has the session, or the runner stops. */
  closed: Promise<string | void>;
  /** With a hooks module: it can submit a prompt. */
  takesMessages?: boolean;
  /** With a hooks module: it can end the running turn. */
  endsTurns?: boolean;
  /** Whether Claude Code lists the plugin as uninstalled or disabled for the session; by default, for the hooks module's copy (or this one's). */
  isOff?: () => Promise<boolean>;
  /** Without a hooks module: the offices that didn't want the session, each until when, from an earlier run. */
  notWanted?: Record<string, number>;
  /** The runner's own pairing and list of repos for an office, shared by every session it reports. */
  shared?: (office: Office) => { pairing: Pairing; approved: Approved } | null;
  /** The session's title as each pass works it out for the offices, sent or not, for the desktop app's menu (runner/status.ts). */
  titled?: (title: string) => void;
}

/** How it ended: why, as its log says; and without a hooks module, a hold-off for the runner to keep. */
export interface Ended {
  why: string;
  /**
   * Not before `until`: no office this reports to wants the project, or git can't place its folder;
   * with `projects`, no office takes any of them, until one of those offices' lists does. `offices`
   * are the servers it reported to, `notWanted` those that didn't want it, each until when.
   */
  holdOff?: { until: number; projects?: string[]; offices: string[]; notWanted: Record<string, number> };
}

/**
 * What keeps an error in reporting one session to that session, in the runner (#104): a throw in a
 * callback the session's links run or in a link's own socket handlers and pacing timer (onError in
 * link.ts), or the rejection of a promise nothing waits for, ends this
 * session alone at its next wait, and a throw in its own loop at once; either way its links close,
 * its lock goes and its log says why, the error's text checked for secrets first.
 */
interface Containment {
  /** Settles once an error has ended the session. */
  failed: Promise<void>;
  /** Why it ended; null while no error has ended it. */
  why(): Promise<string> | null;
  fail(err: unknown): void;
  /** `fn`, whose throw ends the session (`fallback` is returned in its place) rather than reaching the process. */
  guard<A extends unknown[], R = void>(fn: (...args: A) => R, fallback?: R): (...args: A) => R;
  /** A promise nothing waits for, whose rejection ends the session. */
  watch(promise: Promise<unknown>): void;
  /** The session's links, set once they are made. */
  links: () => Link[];
}

function contained(patterns: () => Promise<Pattern[] | null>): Containment {
  let why: Promise<string> | null = null;
  let failed = () => {};
  const c: Containment = {
    failed: new Promise<void>((resolve) => (failed = resolve)),
    why: () => why,
    fail(err) {
      if (why) return;
      why = patterns()
        .catch(() => null)
        .then((p) => `something went wrong in reporting it: ${errorText(err, p)}`);
      failed();
    },
    guard:
      (fn, fallback) =>
      (...args) => {
        try {
          return fn(...args);
        } catch (err) {
          c.fail(err);
          return fallback!;
        }
      },
    watch: (promise) => void promise.catch((err: unknown) => c.fail(err)),
    links: () => [],
  };
  return c;
}

/** Reports the session until it should end. */
export async function reportSession(o: ReportSessionOptions): Promise<Ended> {
  const { dir: claudeDir } = claudePaths(process.env, os.homedir());
  const patterns = () => loadPatterns(path.join(o.appDir, "secret-patterns.json"), path.join(claudeDir, "isoplan", "secret-patterns.json"), () => {});
  const c = contained(patterns);
  try {
    return await reporting(o, c);
  } catch (err) {
    // An earlier error may have ended it already: this one is logged too.
    const earlier = c.why();
    c.fail(err);
    for (const link of c.links()) link.close();
    await releaseLock(lockPath(claudeDir, o.sessionId), process.pid).catch(() => {});
    const why = await c.why()!;
    try {
      o.emit({ type: "log", text: `stopping: ${why}` });
      if (earlier) o.emit({ type: "log", text: `then, as it stopped, something else went wrong: ${errorText(err, await patterns().catch(() => null))}` });
    } catch {
      // Its log can't be written: the runner's says it (reporting.ts).
      throw new Error(why);
    }
    return { why };
  }
}

async function reporting(o: ReportSessionOptions, c: Containment): Promise<Ended> {
  const { sessionId, cwd, closed } = o;
  const hooked = o.by === "hooks";
  // Only the session's own hooks module can submit a prompt.
  const takesMessages = hooked && !!o.takesMessages;
  // A question asked before it loaded is answered by ending the turn, then submitting the answer.
  const answersLate = takesMessages && !!o.endsTurns;
  const here = path.join(o.appDir, "dist");
  const defaultsPath = path.join(o.appDir, "config.json");
  const { dir: claudeDir, json: claudeJson } = claudePaths(process.env, os.homedir());
  const lock = lockPath(claudeDir, sessionId);
  const userConfigPath = path.join(claudeDir, "isoplan", "config.json");
  // The person's own folder, not the machine's shared temp folder.
  const titlesDir = path.join(claudeDir, "isoplan", "titles");
  const titleFile = path.join(titlesDir, `${sessionId}.json`);
  // Where the hooks module says whether it took an owner's answer, one file per request, and where it
  // marks the questions it waits on: this session's own folders, cleared as the data layer starts.
  const answersDir = path.join(claudeDir, "isoplan", "answers", sessionId);
  // Where the hooks module says whether it took an owner's message, one file per request.
  const messagesDir = path.join(claudeDir, "isoplan", "messages", sessionId);
  const waitsDir = path.join(claudeDir, "isoplan", "waits", sessionId);
  // Where the hooks module writes the session's context window (a window line names it).
  const windowFile = path.join(claudeDir, "isoplan", "windows", `${sessionId}.json`);
  const modPatterns = path.join(o.appDir, "secret-patterns.json");
  const ownerPatterns = path.join(claudeDir, "isoplan", "secret-patterns.json");
  const machine = os.hostname();

  const io = nodeIo();
  const git = createGit(io);
  // The project of each repo an edit or command lands in, by its common dir, looked up again as
  // git's answers are (#74).
  const projects = new Map<string, { at: number; project: ReturnType<typeof projectOf> }>();
  // A GitHub repo's current name, asked for before a remote first seen is reported, so an old clone
  // never reports as a second project (remote-names.ts).
  const names = askingRemoteNames(claudeDir);
  const source = createClaudeCode({ ...io, claudeDir, home: os.homedir() });

  let downSince: number | null = Date.now(); // since when no office's link has been connected; null while one is
  let closedFor: string | null = null; // why `closed` settled, once it has
  void closed.then((reason) => void (closedFor = reason || null));
  const emit = o.emit;
  const wait = (ms: number) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeUp = new Promise<boolean>((resolve) => (timer = setTimeout(() => resolve(true), ms)));
    return Promise.race([timeUp, closed.then(() => false), c.failed.then(() => false)]).finally(() => clearTimeout(timer));
  };
  let why = "it was stopped"; // why it ends, once it does
  const stopping = (reason: string) => {
    why = reason;
    emit({ type: "log", text: `stopping: ${reason}` });
    return false;
  };
  const end = (reason: string): Ended => (stopping(reason), { why });

  // Claude Code runs nothing of a plugin's when it is uninstalled or disabled, so this looks itself
  // (src/install/state.ts), before it takes the session's lock and on every pass: a session whose
  // plugin is uninstalled or disabled for it is reported no more.
  // The session's own environment where its hooks module passed it on: where its plugins are, and whether it updates.
  const env = hooked ? hookedEnv(o.env) : { ...process.env };
  const place: Place = { claudeDir, plugins: pluginsDir(claudeDir, env), managed: managedDir(process.platform), pluginDirs: pluginDirsOf(env) };
  const project = o.project ?? cwd;
  // The copy of the plugin, by its dist/data-layer.js as Claude Code's records know it: the hooks module's, or the runner's own.
  const self = path.join(hooked && o.root ? path.join(o.root, "dist") : here, "data-layer.js");
  const isOff = o.isOff ?? (async () => (await pluginState(place, self, project).catch(() => "enabled")) !== "enabled");
  if (await isOff()) return end("Claude Code lists the Isoplan plugin as uninstalled or disabled here, so this session isn't reported");
  // The session's folder too, so /isoplan:repos (src/repos) looks at the folder this reports as.
  // For a hooks module, in the shape an earlier version's data layer gives the session up to (see above).
  const since = o.since ?? Date.now();
  const lockExtra = hooked ? { dataLayer: self, detached: false, since, parent: process.pid, runner: true, cwd } : { detached: true, runner: true, cwd };
  // The newest copy of the plugin installed for this session (state.ts): another one means the hooks
  // module's is outdated. The runner is kept up to date by its own start (src/runner/start.ts).
  const isOutdated = async () => hooked && (await outdatedCopy(claudeDir, env, self, project));
  let outdated = await isOutdated();
  // An earlier version's data layer holds the session's lock (see above): its hooks module is told.
  const takenOver = (reason: string) => {
    if (hooked) emit({ type: "superseded", reason: "earlier" });
    return stopping(reason);
  };

  // Reported again after one office didn't want the session: that office stays left alone until its
  // hold-off ends (src/runner/reporting.ts).
  const notWantedBefore: Record<string, unknown> = hooked ? {} : (o.notWanted ?? {});
  let config: Config = await loadConfig(io, defaultsPath, userConfigPath);
  try {
    // A hold-off a detached data layer of an earlier version left counts for nothing: the runner keeps its own.
    const held = await readLock(lock);
    if (held?.pid === null) await fs.rm(lock, { force: true });
    // An earlier version's data layer this hooks module's copy replaces: the lock is taken from it, and it leaves.
    const over = hooked && !outdated && takesOver(held, self, since);
    if (over) emit({ type: "log", text: "an earlier version's data layer reported this session: the runner reports it now, for its hooks module, and that data layer leaves it" });
    if (!(await takeLock(lock, process.pid, alive, over, Date.now(), { extra: lockExtra, freshMs: lockFreshMs(config) }))) {
      takenOver("an earlier version's data layer already reports this session");
      return { why };
    }
  } catch (err) {
    return end(`couldn't take the session lock: ${String((err as Error)?.message ?? err)}`);
  }

  const paths = { ...place, settings: path.join(claudeDir, "settings.json") };
  if (outdated) emit({ type: "updated" });
  // The update check (src/update), for a copy in Claude Code's plugin cache: there is nothing to
  // update in a checkout or a folder loaded in place. One at a time for this session; the machine's
  // update lock and record keep sessions from checking together.
  const pluginId = pluginIdOf(place.plugins, self);
  let checking = false;
  let checkedAt = Date.now(); // the timed checks count from the one at start
  const checkUpdate = (gapMs: number) => {
    if (!hooked || !pluginId || outdated || checking || !config.updateCheckHours) return;
    checkedAt = Date.now();
    const off = updatesOffBy(env);
    if (off) return emit({ type: "log", text: `not checking for a newer version of the plugin: ${off} is set (FORCE_AUTOUPDATE_PLUGINS=1 turns plugin updates back on)` });
    checking = true;
    c.watch((async () => {
      if ((await pluginState(place, self).catch(() => "enabled")) !== "enabled") return emit({ type: "log", text: "not checking for a newer version of the plugin: it is disabled for this machine" });
      const binary = await claudeBinary(claudeDir, process.env, process.platform, os.homedir());
      if (!binary) return emit({ type: "log", text: "couldn't find the claude binary, so the plugin can't update itself" });
      const checked = await checkForUpdate({ claudeDir, settings: paths.settings, plugins: place.plugins, id: pluginId, cwd: project, claude: claudeCommand(binary), env: commandEnv(env, await gitChoices(project)), gapMs });
      for (const text of checked.said) emit({ type: "log", text: `update check: ${text}` });
    })()
      .catch((err: unknown) => emit({ type: "log", text: `couldn't check for a newer version of the plugin: ${String((err as Error)?.message ?? err)}` }))
      .finally(() => (checking = false)));
  };
  checkUpdate(START_GAP_MS);
  // The offices are read once: a link that moved servers mid-session would leave a room behind.
  // Plain ws:// to another machine would send facts and the machine's credential unencrypted.
  const offices = officesOf(config);
  for (const { server } of offices.filter((o) => o.plainRefused)) emit({ type: "log", text: `not reporting to ${server}: it is plain ws:// to another machine; use wss://, or set "allowPlainWs": true in config.json` });
  if (hooked) {
    for (const dir of [answersDir, waitsDir, messagesDir]) await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
    if (await fs.mkdir(waitsDir, { recursive: true }).then(() => true, () => false)) emit({ type: "waits", dir: waitsDir });
    // Made once here, not per message, so each message's line goes out in the order it came.
    await fs.mkdir(messagesDir, { recursive: true }).catch(() => {});
    // The hooks module writes the size again for this run, so one from an earlier run is never sent.
    await fs.rm(windowFile, { force: true }).catch(() => {});
    if (await fs.mkdir(path.dirname(windowFile), { recursive: true }).then(() => true, () => false)) emit({ type: "window", file: windowFile });
  }

  // The pairing is the machine's, whichever folder the session is in. The list of repos each office
  // takes is read with it, which pairs a machine not paired yet (approved.ts).
  const machineAccount = await accountOf({ readText: (p) => fs.readFile(p, "utf8").catch(() => null), run: io.run }, claudeJson, os.homedir());
  // The projects the session may report as (home.ts), looked up again as git's answers are.
  let candidates: { projects: Project[]; workspace: boolean } | null = null;
  let candidatesAt = -Infinity;
  let dormant: Dormancy | null = null; // why nothing is sent, while it isn't
  let notApproved: string[] | null = null; // without a hooks module, and no office takes any of these: it holds off
  let factsSession = ""; // the session's id as its facts give it, for the hello
  let reported = ""; // the last problem logged, so a lasting one is logged once
  let title: TitleCache | null = null;
  let asked: string | null = null; // the key of the title call in flight
  let isPlaceless = false; // without a hooks module, and git couldn't place the session's folder
  let passes = 0;
  let shown: Parameters<ReportHold["apply"]> | null = null; // the last facts and patterns the holds were applied to
  let marks: ReadonlyMap<string, boolean> = new Map(); // the open questions the hooks module marked, and whether it still waits on each
  const said = new Set<string>(); // the pattern files' problems, logged once each, since they are read every pass
  const patternLog = (text: string) => {
    if (!said.has(text)) emit({ type: "log", text });
    said.add(text);
  };
  // What goes to an office's link: the reports its hold keeps held, the questions checked and
  // marked, and the workflows' names, phases and labels checked (workflows.ts).
  const outgoing = (run: OfficeRun, facts: Facts, patterns: Pattern[] | null) =>
    prepareWorkflows(prepareQuestions(run.hold.apply(facts, patterns), patterns, marks, patternLog, answersLate), patterns, patternLog);
  // The project of each subagent working in a worktree of another repo, from the latest read.
  let checkouts: Record<string, string> = {};
  // Whether a question got an answer, from the latest read, so one that closed says how.
  let answered = (_id: string) => false;
  let contextWindow: number | null = null; // the session's context window, once the hooks module wrote it

  const account = await accountOf({ readText: (p) => fs.readFile(p, "utf8").catch(() => null), run: io.run }, claudeJson, cwd);
  const openLink = (run: OfficeRun, home: Project, mayConnect: () => Promise<boolean>): Link =>
    createLink({
      url: run.office.server,
      emit: run.emit,
      pairing: run.pairing,
      admit: mayConnect,
      // The list may have changed: it is read again, and the link opens afresh once it has.
      onNotWanted: c.guard(() => {
        run.unwanted = !hooked;
        run.gate.notWanted();
      }),
      // Another repo's files, commands and checkouts go only to a server that welcomed them, and
      // only for its office's repos; the link applies this at every send, on every connection.
      filter: (f, projects) => forOffice(candidates?.workspace ? inRepos(f) : f, projects, checkouts),
      onError: c.fail,
      answered: c.guard((id: string) => answered(id), false),
      // The owner released a withheld report on this office's floor: it goes to this office alone, now, not on the next pass.
      // The owner answered a question, or sent the session a message, from the floor: it goes to the
      // hooks module, and the reply to the office it came from.
      onMessage: c.guard((message: ServerAsk) => {
        if (message.type === "request" && message.kind === "owner-answer") {
          const file = path.join(answersDir, `${randomUUID()}.json`);
          c.watch(fs
            .mkdir(answersDir, { recursive: true })
            .then(async () => {
              const relayed = await relayOwnerAnswer(message, { detached: !hooked, session: sessionId, facts: () => run.sent, file, emit, take: takeFile });
              run.gate.current()?.send(relayed.message);
              if (!relayed.gaveUp) return;
              // The hooks module's word may still come: a take that does follows as a late reply.
              const late = await lateTake(message.question, file, takeFile);
              if (late === null) return;
              emit({ type: "log", text: `the hooks module said late that it ${late ? "took" : "didn't take"} the owner's answer to ${message.question}` });
              if (late) run.gate.current()?.send({ type: "reply", v: PROTOCOL_VERSION, id: message.id, kind: "owner-answer", late: true });
            })
            // A word that came later still, or not at all, is left over: it goes.
            .finally(() => fs.rm(file, { force: true }).catch(() => {}))
            .catch((err: unknown) => emit({ type: "log", text: `couldn't pass the owner's answer on: ${String((err as Error)?.message ?? err)}` })));
          return;
        }
        if (message.type === "request" && message.kind === "owner-message") {
          const file = path.join(messagesDir, `${randomUUID()}.json`);
          // relayOwnerMessage emits its line before its first await: lines go out in arrival order.
          c.watch(relayOwnerMessage(message, { detached: !hooked, takes: takesMessages, owner: account.id, session: sessionId, file, emit, take: takeFile })
            .then((answer) => run.gate.current()?.send(answer))
            .finally(() => fs.rm(file, { force: true }).catch(() => {}))
            .catch((err: unknown) => emit({ type: "log", text: `couldn't pass the owner's message on: ${String((err as Error)?.message ?? err)}` })));
          return;
        }
        if (message.type !== "release") return emit({ type: "log", text: `the office server sent a ${message.type} message, which this data layer doesn't handle yet` });
        c.watch(run.hold.release(message.id).then((released) => {
          if (released && shown) run.gate.current()?.update((run.sent = outgoing(run, ...shown)));
        }));
      }),
      hello: {
        type: "hello",
        v: PROTOCOL_VERSION,
        source: "claude-code",
        account,
        machine: { name: machine },
        session: factsSession,
        project: home,
      },
    });
  // Each office's link, opened by its gate only while that office takes the session's home
  // (approved.ts), which it asks again before every reconnect, so a hello never goes on a list that
  // changed or aged out.
  const runs: OfficeRun[] = await Promise.all(offices
    .filter((o) => !o.plainRefused)
    .map(async (office) => {
      const { server, label } = office;
      const until = notWantedBefore[server];
      const held = typeof until === "number" && until > Date.now();
      const run = { office, known: held, dormant: null, homing: null, result: null, connected: false, unwanted: held, unwantedUntil: held ? until : null, sent: null } as OfficeRun;
      run.hold = await openReportHold(releasedPath(claudeDir, office, sessionId), (text) => emit({ type: "log", text: `${text} (for ${server})` }));
      run.emit = c.guard((line: DataLayerLine) => {
        if (line.type === "status") {
          run.connected = line.state === "connected";
          downSince = runs.some((r) => r.connected) ? null : (downSince ?? Date.now());
          // A link that drops has the list of repos the office takes read again, in case that is why.
          if (line.state === "disconnected") c.watch(run.approved.refresh(true));
        }
        emit(line.type === "status" || line.type === "pair" ? { ...line, label } : line.type === "asked" || line.type === "ask-rights" ? { ...line, server } : line);
      });
      // The runner's own, shared by every session it reports: one pairing for the office, which a session's link closing leaves answering.
      const shared = o.shared?.(office);
      if (shared) {
        run.pairing = { ...shared.pairing, close: async () => {} };
        run.approved = shared.approved;
      } else {
        run.pairing = createPairing({
          file: pairingPath(claudeDir),
          lock: pairingLockPath(claudeDir, office),
          writeLock: pairingWriteLockPath(claudeDir),
          server,
          account: machineAccount,
          machine,
          emit: run.emit,
          allowPlainWs: config.allowPlainWs,
          legacy: !!office.legacy,
        });
        run.approved = createApproved({
          server,
          file: approvedPath(claudeDir, server),
          pairing: run.pairing,
          refreshMs: config.approvedRefreshMinutes * 60000,
          maxAgeMs: config.approvedMaxAgeMinutes * 60000,
          log: (text) => emit({ type: "log", text }),
        });
      }
      run.gate = createSessionGate({ approved: run.approved, open: (home, mayConnect) => openLink(run, home, mayConnect) });
      return run;
    }));
  const links = () => runs.flatMap((run) => run.gate.current() ?? []);
  c.links = links;
  // Without a hooks module, and every office either doesn't want this project or doesn't take its repo, one at least not wanting it.
  const isUnwanted = () => runs.some((r) => r.unwanted) && runs.every((r) => r.unwanted || r.dormant === "not-approved");
  // Whether an office's list now takes the session's home, checked at once with the others'; a check
  // still under way is left running, not started again. What it says is kept, and taken only at a
  // pass's gating (apply), so a check that ends late never changes an office in the middle of a pass.
  const check = (run: OfficeRun, projects: readonly Project[], workspace: boolean) =>
    (run.homing ??= run.gate
      .home(projects)
      .then((gated) => void (run.result = { dormancy: gated.dormancy, projects, workspace }))
      .catch((err: unknown) => emit({ type: "log", text: `couldn't check which repos ${run.office.server} takes: ${String((err as Error)?.message ?? err)}` }))
      .finally(() => (run.homing = null)));
  const apply = (run: OfficeRun) => {
    if (!run.result) return;
    const { dormancy, projects, workspace } = run.result;
    run.result = null;
    const { server, label } = run.office;
    if (dormancy !== run.dormant || !run.known) {
      // An office shows only once it takes the repo, or waits to be paired; outside it, nothing.
      run.emit({ type: "status", server, label, state: dormancy ?? "waiting", ...(workspace && dormancy && { workspace: true as const }) });
      const what = workspace ? "none of the repos in this folder is" : `${projects[0]?.id ?? cwd} isn't`;
      if (dormancy === "not-approved") emit({ type: "log", text: `${what} one the office at ${server} takes, so nothing of this session is sent to it` });
      if (dormancy === "no-list") emit({ type: "log", text: `can't tell which repos ${server} takes (no list, or one older than ${config.approvedMaxAgeMinutes} minutes), so nothing of this session is sent to it` });
    }
    run.dormant = dormancy;
    run.known = true;
  };
  // Left alone while its hold-off from an earlier run lasts; once it has ended, asked again.
  const isHeldOff = (run: OfficeRun, now: number) => {
    if (run.unwantedUntil !== null && run.unwantedUntil <= now) {
      run.unwanted = false;
      run.unwantedUntil = null;
    }
    return run.unwantedUntil !== null;
  };
  // A plain ws:// office to another machine is named in the status line only when its last list
  // takes the session's home, or there is none to tell by.
  const insecureSaid = new Map<string, string>();
  const sayInsecure = async (projects: readonly Project[]) => {
    for (const { server, label } of offices.filter((o) => o.plainRefused)) {
      const repos = await cachedRepos(approvedPath(claudeDir, server), server, config.approvedMaxAgeMinutes * 60000);
      const state = !repos ? "unchecked" : projects.some((p) => repos.has(p.id.toLowerCase())) ? "insecure" : "not-approved";
      if (insecureSaid.get(server) === state) continue;
      insecureSaid.set(server, state);
      emit(state === "not-approved" ? { type: "status", server, label, state } : { type: "status", server, label, state: "insecure", ...(state === "unchecked" && { unchecked: true as const }) });
    }
  };
  let pending = false; // an office's list hasn't answered yet
  const startedAt = Date.now();
  // Whether to go on to the next pass, once this one's wait is over; each reason not to is logged.
  const goOn = async () => {
    // Only `closed` (the runner stopping, or the hooks module's connection going or changing), or an error that ended the session, ends the wait early.
    if (!(await wait(dormant && !pending ? DORMANT_MS : config.streamSeconds * 1000))) {
      const failure = c.why();
      return stopping(failure ? await failure : (closedFor ?? "the runner stopped"));
    }
    if (isUnwanted()) return stopping("no office this reports to wants this session's project or takes its repo, so it holds off");
    if ((await lockHolder(lock)) !== process.pid) return takenOver("another data layer reports this session now");
    if (await isOff()) return stopping("Claude Code lists the Isoplan plugin as uninstalled or disabled here now");
    return true;
  };

  do {
    const now = Date.now();
    const isFirstPass = passes++ === 0;
    await refreshLock(lock, process.pid).catch(() => {});
    config = await loadConfig(io, defaultsPath, userConfigPath).catch(() => config);
    if (!outdated && (outdated = await isOutdated())) emit({ type: "updated" });
    if (now - checkedAt >= config.updateCheckHours * 3600000) checkUpdate(config.updateCheckHours * 3600000);
    const gitOpts = { now, maxAgeMs: config.gitCacheSeconds * 1000 };
    const resolve = (dir: string) => git.resolve(dir, gitOpts);
    const projectOfRepo = (where: Where) => {
      const key = pathKey(where.commonDir);
      const hit = projects.get(key);
      if (hit && now - hit.at <= gitOpts.maxAgeMs) return hit.project;
      const project = projectOf(io.run, where, where.toplevel, machine, { names });
      projects.set(key, { at: now, project });
      return project;
    };
    // Only a repo the office takes is reported (#91): for any other, no link opens and nothing is
    // sent, not even a hello; one already open closes. A workspace reports as the first of its repos
    // the office takes. It connects once the list has one.
    if (!candidates || now - candidatesAt > gitOpts.maxAgeMs) {
      const io2 = { resolve, projectOf: (where: Where | null, dir: string) => projectOf(io.run, where, dir, machine, { names }), stat: (f: string) => io.stat(f), listDir: (d: string) => io.listDir(d) };
      candidates = await candidatesOf(cwd, { ...io2, home: os.homedir(), workspaceRepos: config.workspaceRepos });
      candidatesAt = now;
    }
    await sayInsecure(candidates.projects);
    const { projects: homes, workspace } = candidates;
    const checks = runs.filter((r) => !isHeldOff(r, now)).map((r) => check(r, homes, workspace));
    let slow: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([Promise.allSettled(checks), new Promise((r) => (slow = setTimeout(r, config.streamSeconds * 1000)))]);
    clearTimeout(slow);
    for (const run of runs) apply(run);
    // The offices that take the session's home now; with none, why nothing is sent.
    const taking = runs.filter((r) => r.known && !r.dormant && !isHeldOff(r, now));
    pending = runs.some((r) => !r.known);
    dormant = taking.length ? null : pending ? "no-list" : (runs.find((r) => r.dormant && r.dormant !== "not-approved")?.dormant ?? "not-approved");
    if (!taking.length) {
      // Without a hooks module it holds off, as for not-wanted, until the runner finds a list takes one of
      // these repos, or the hold ends; one with no list stops once that has lasted LINK_DOWN_MS.
      if (!hooked && dormant === "not-approved") {
        notApproved = candidates.projects.map((p) => p.id.toLowerCase());
        stopping(`no office this reports to takes ${notApproved.join(", ") || cwd}, so it holds off until one does`);
        break;
      }
      const quiet = hooked ? null : detachedStop({ now, lastActive: new Date(now).toISOString(), idleMinutes: config.idleMinutes, downSince });
      if (quiet) {
        stopping(quiet);
        break;
      }
      continue;
    }

    const read: SourceRead = await source.read({ sessionId, cwd, now, config, resolve, projectOf: projectOfRepo }).catch((err: unknown) => ({
      facts: null,
      status: String((err as Error)?.message ?? err),
      errors: { count: 0, first: null },
    }));
    const problem = read.status ?? (read.errors.count ? `${read.errors.count} transcript(s) could not be read: ${read.errors.first}` : "");
    if (problem && problem !== reported) emit({ type: "log", text: problem });
    reported = problem;
    if (!read.facts) {
      // Nothing to report (lights off with no reply, aged out, the transcript gone): the link
      // closes, so the server marks the room unreachable and ages it out. It opens again if facts
      // come back; without a hooks module it is done, and the runner starts it again once the transcript moves.
      if (!hooked) {
        // A folder git can't place won't be placed on the next turn either: the runner holds off.
        isPlaceless = isFirstPass && !(await resolve(cwd));
        if (isPlaceless) {
          stopping(`git can't place ${cwd}, so it holds off`);
          break;
        }
        // Started before the transcript has started (none yet, or only bookkeeping lines): it waits for it, for a while (#92).
        if (read.unstarted && !factsSession) {
          if (Date.now() - startedAt < config.factsWaitSeconds * 1000) continue;
          stopping(`the session's transcript had nothing to report within ${config.factsWaitSeconds} seconds`);
          break;
        }
        stopping("the session has nothing to report now (lights off with no reply, left out, aged out, or its transcript gone)");
        break;
      }
      for (const run of taking) {
        if (!run.gate.current()) continue;
        run.gate.drop();
        run.emit({ type: "status", server: run.office.server, label: run.office.label, state: "waiting" });
      }
      continue;
    }
    factsSession = read.facts.session.id;

    // A written title replaces the branch stand-in; the hooks module writes the reply to a file.
    const reply = await takeReply(titleFile);
    if (reply) {
      const text: string | null = reply.key === asked ? cleanTitle(reply.text) : null;
      if (text && title) title = { key: reply.key, title: text, at: title.at };
    }
    // A session driven from the floor has the name its runner wrote from its first instruction (runner/naming.ts), which replaces the branch stand-in too.
    const named: string | null = read.facts.session.titleFrom === "branch" ? await drivenName(registryPath(claudeDir), read.facts.session.id) : null;
    const ask: ReturnType<typeof nextTitle> = named ? null : nextTitle(read.facts, title, now);
    if (ask && (await fs.mkdir(titlesDir, { recursive: true }).then(() => true, () => false))) {
      title = { key: title?.key ?? null, title: title?.title ?? null, at: now };
      asked = ask.key;
      emit({ type: "title-ask", model: "haiku", system: TITLE_SYSTEM, prompt: ask.prompt, maxTokens: 40, key: ask.key, file: titleFile });
    }
    // The size stays as last read while the file is missing or half written; there is none until it is written.
    if (hooked) contextWindow = (await windowOf(windowFile)) ?? contextWindow;
    const given: string | null | undefined = named ?? (read.facts.session.titleFrom === "branch" ? title?.title : null);
    const titled = given ? { ...read.facts, session: { ...read.facts.session, title: given } } : read.facts;
    const sized: Facts = contextWindow ? { ...titled, session: { ...titled.session, contextWindow } } : titled;
    const facts: Facts = hooked ? { ...sized, session: { ...sized.session, hooks: true, ...(takesMessages && { takesMessages: true as const }) } } : sized;
    if (facts.session.title) o.titled?.(facts.session.title);

    checkouts = read.checkouts ?? {};
    answered = read.answered ?? answered;

    const patterns = await loadPatterns(modPatterns, ownerPatterns, patternLog).catch((err: unknown) => {
      patternLog(`couldn't read the secret patterns, so every report is withheld: ${String((err as Error)?.message ?? err)}`);
      return null;
    });
    marks = hooked ? await waitsOf(waitsDir, facts) : new Map();
    shown = [facts, patterns];
    // One office's failure never ends the loop for the others.
    for (const run of taking) {
      try {
        run.gate.link()?.update((run.sent = outgoing(run, facts, patterns)));
      } catch (err) {
        emit({ type: "log", text: `couldn't send this session's facts to ${run.office.server}: ${String((err as Error)?.message ?? err)}` });
      }
    }
    const quiet = hooked ? null : detachedStop({ now, lastActive: facts.session.lastActive, idleMinutes: config.idleMinutes, downSince });
    if (quiet) {
      stopping(quiet);
      break;
    }
    // A dormant session waits longer between passes: there is nothing to send, only the list to check.
  } while (await goOn());

  for (const link of links()) link.close();
  await releaseLock(lock, process.pid).catch(() => {});
  // An error that ended the session during a pass that then stopped for another reason is said too,
  // and is why it ended; a hold-off that reason brings is kept.
  const failure = c.why();
  if (failure) {
    const text = await failure;
    if (why !== text) stopping(text);
  }
  // The offices that didn't want the session, each until its hold-off ends: the runner reads no list
  // of theirs, and lists only of the offices configured now (reporting.ts).
  const notWanted = Object.fromEntries(runs.filter((r) => r.unwanted).map((r) => [r.office.server, r.unwantedUntil ?? Date.now() + HOLD_OFF_MS]));
  const named = { offices: offices.map((office) => office.server), notWanted };
  // An office that doesn't take the repo may yet: then the hold-off ends once one of its lists does.
  if (isUnwanted() && runs.some((r) => r.dormant === "not-approved")) notApproved = (candidates?.projects ?? []).map((p) => p.id.toLowerCase());
  if ((isUnwanted() && !notApproved) || isPlaceless) return { why, holdOff: { until: Date.now() + HOLD_OFF_MS, ...named } };
  if (notApproved) return { why, holdOff: { until: Date.now() + HOLD_OFF_MS, projects: notApproved, ...named } };
  return { why };
}

/** Starts `node <args>` detached and hidden, without waiting for it. */
export const spawnHidden: StartOptions["spawn"] = (args, dir, env) => spawn(process.execPath, args, { cwd: dir, env, detached: true, stdio: "ignore", windowsHide: true }).on("error", () => {}).unref();

/** Where this machine finds the claude binary, and keeps the isoplan:// link handler and the login item (src/install). */
export const systemPlaces = () => ({
  findClaude: () => findClaude(process.env, process.platform, os.homedir()),
  linkHandler: { platform: process.platform, home: os.homedir(), dataHome: process.env.XDG_DATA_HOME, node: process.execPath },
  loginItem: { platform: process.platform, home: os.homedir(), configHome: process.env.XDG_CONFIG_HOME, uid: process.getuid?.(), node: process.execPath },
});

export interface MachineStart {
  place: Place;
  /** The dist/ folder this data layer runs from. */
  here: string;
  spawn: StartOptions["spawn"];
  log: (text: string) => void;
  findClaude?: () => Promise<string | null>;
  linkHandler?: LinkHandlerPlace;
  loginItem?: LoginItemPlace;
  /** This computer, for the desktop app (src/install/app.ts); without it the app isn't installed. */
  app?: Omit<InstallApp, "claudeDir" | "from">;
}

/** This computer, for the desktop app. */
export const appComputer = (): Omit<InstallApp, "claudeDir" | "from"> => ({ platform: process.platform, arch: process.arch, home: os.homedir(), env: process.env });

/**
 * The machine's part of a current copy of the plugin's start (the hooks module's end of the pipe, src/pipe/main.ts): the wake hook and the runner's copy
 * (src/install), then the runner (src/runner/start.ts), which replaces one running older code. The
 * runner answers for the machine's rooms and reports every session. Not
 * while the plugin is disabled for the machine, though a session's project enables it. Then, in the
 * background (`app`), the desktop app this version names, which takes over from the node runner once
 * it is in place.
 */
export function startMachine(o: MachineStart): { installed: Promise<void>; started: Promise<Started | null>; app: Promise<void> } {
  const self = path.join(o.here, "data-layer.js");
  const installed = installWake({ ...o.place, settings: path.join(o.place.claudeDir, "settings.json") }, self, path.join(o.here, "wake.js"), {
    auto: true,
    runnerFrom: path.join(o.here, ".."),
    findClaude: o.findClaude,
    linkHandler: o.linkHandler,
    loginItem: o.loginItem,
  }).then(
    (changes) => changes.forEach((text) => o.log(text)),
    (err: unknown) => o.log(`couldn't install the wake hook: ${String((err as Error)?.message ?? err)}`),
  );
  const started = installed.then(async () => ((await pluginState(o.place, self)) === "enabled" ? startRunner({ claudeDir: o.place.claudeDir, spawn: o.spawn }) : null)).catch(() => null);
  const app = started.then(async (runner) => {
    if (!o.app || runner === null) return;
    const { changes } = await installApp({ ...o.app, claudeDir: o.place.claudeDir, from: path.join(o.here, "..") });
    changes.forEach((text) => o.log(text));
    if (changes.length) await startRunner({ claudeDir: o.place.claudeDir, spawn: o.spawn });
  }).catch((err: unknown) => o.log(`couldn't install the desktop app: ${String((err as Error)?.message ?? err)}`));
  return { installed, started, app };
}

/**
 * For `--detached` (main.ts): a wake hook or runner of an earlier version started this data layer
 * for a session without a hooks module, which the runner reports now (src/runner/reporting.ts).
 * So it does the machine's part of its start (startMachine), putting this version's wake hook and
 * runner in place and starting that runner in place of the older one, says so in the session's
 * log, and is done. An outdated copy does nothing, so it never hands them back to older code.
 */
export async function startDetached(o: { sessionId: string | null; project: string | null; appDir: string } & Omit<MachineStart, "place" | "here" | "log">): Promise<void> {
  const { dir: claudeDir } = claudePaths(process.env, os.homedir());
  const here = path.join(o.appDir, "dist");
  const self = path.join(here, "data-layer.js");
  const place: Place = { claudeDir, plugins: pluginsDir(claudeDir, process.env), managed: managedDir(process.platform), pluginDirs: pluginDirsOf(process.env) };
  const said = o.sessionId ? sessionLog(claudeDir, o.sessionId) : null;
  const say = (text: string) => said?.say(text);
  if ((await newestDataLayer(place.plugins, self, o.project ?? undefined).catch(() => self)) !== self) {
    say("an earlier version's wake hook or runner started an outdated copy of the plugin's data layer for this session, which does nothing: the newest version's runner reports sessions without the plugin");
  } else {
    const started = await startMachine({ place, here, spawn: o.spawn, log: say, findClaude: o.findClaude, linkHandler: o.linkHandler, loginItem: o.loginItem }).started;
    const runner = started === null ? "the plugin is disabled for this machine, so the runner wasn't started" : { started: "started the runner", running: "the runner was already running", "held-off": "the runner is holding off for now (see runner.log)", "not-installed": "the runner's copy isn't in place, so it wasn't started" }[started];
    say(`an earlier version's wake hook or runner asked for this session to be reported: the runner reports it now, so this data layer ends (${runner})`);
  }
  await said?.flushed();
}

/**
 * Where a session the runner reports says what it does: its log lines, the office's errors and
 * pairing links, in <claude dir>/isoplan/logs/<session>.log; the rest is for a hooks module, so dropped.
 * `flushed` settles once what was said so far is written.
 */
export function sessionLog(claudeDir: string, sessionId: string): { emit: (line: DataLayerLine) => void; say: (text: string) => void; flushed: () => Promise<void> } {
  const file = path.join(claudeDir, "isoplan", "logs", `${sessionId}.log`);
  let logging = Promise.resolve();
  const say = (said: string) => {
    const text = `${new Date().toISOString()} ${said}
`;
    logging = logging.then(() => writeLog(file, text)).catch(() => {});
  };
  return {
    emit: (line) => {
      if (line.type === "log" || line.type === "error" || line.type === "pair") say(line.type === "log" ? line.text : line.type === "pair" ? pairNote(line) : `the office server says: ${line.message} (${line.code})`);
    },
    say,
    flushed: () => logging,
  };
}

/** A pair line as the log says it. */
const pairNote = (line: { server: string; url: string; expires: string }) =>
  `to report to ${line.server}, pair this machine: click ${line.url} on this computer and approve it in the office (it works until ${line.expires})`;

// Appends to a session's log, starting it over once it passes LOG_CAP_BYTES.
async function writeLog(file: string, text: string): Promise<void> {
  const size = (await fs.stat(file).catch(() => null))?.size ?? 0;
  await fs.mkdir(path.dirname(file), { recursive: true });
  if (size > LOG_CAP_BYTES) await fs.writeFile(file, text);
  else await fs.appendFile(file, text);
}

// The open questions the hooks module marked, each in <dir>/<call id>.json, and whether it still waits on each.
async function waitsOf(dir: string, facts: Facts): Promise<Map<string, boolean>> {
  const out = new Map<string, boolean>();
  for (const q of facts.questions ?? []) {
    if (!/^[A-Za-z0-9_-]{1,200}$/.test(q.id)) continue;
    const mark = await fs.readFile(path.join(dir, `${q.id}.json`), "utf8").then((text) => JSON.parse(text) as Partial<WaitMark>, () => null);
    if (mark?.question === q.id && typeof mark.waiting === "boolean") out.set(q.id, mark.waiting);
  }
  return out;
}

/** The context window the hooks module wrote, in tokens; null while there is none, or it isn't a whole positive number. */
async function windowOf(file: string): Promise<number | null> {
  let said: unknown;
  try {
    said = JSON.parse(await fs.readFile(file, "utf8"));
  } catch {
    return null;
  }
  const value = said && typeof said === "object" ? (said as Partial<ContextWindow>).contextWindow : null;
  return Number.isInteger(value) && value! > 0 ? value! : null;
}

// A JSON file the hooks module wrote, which goes once it is read; null while it isn't there, or
// doesn't parse yet (it may still be being written).
async function takeFile(file: string): Promise<string | null> {
  const text = await fs.readFile(file, "utf8").catch(() => null);
  try {
    JSON.parse(text ?? "");
  } catch {
    return null;
  }
  await fs.rm(file, { force: true }).catch(() => {});
  return text;
}

// The title reply, if the hooks module has written one; the file goes once it is read. One that
// doesn't parse may still be being written, so it is left for the next pass.
async function takeReply(file: string): Promise<TitleReply | null> {
  let value: unknown;
  try {
    value = JSON.parse(await fs.readFile(file, "utf8"));
  } catch {
    return null;
  }
  await fs.rm(file, { force: true }).catch(() => {});
  const r = value as Partial<TitleReply>;
  return typeof r.key === "string" && typeof r.text === "string" ? { key: r.key, text: r.text } : null;
}
