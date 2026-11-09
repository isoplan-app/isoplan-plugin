// Taking a handoff from the floor (#48): the receiver's runner does it, in order.
//
// 1. The clone: the machine's Claude Code sessions from the last `cloneSearchDays` say which folders
//    the receiver works in. Each is placed with git, newest first, and the main checkout of the first
//    whose remote is the handoff's (the same project id, or the same path for a local remote) is the
//    clone. Without one nothing can be made, so no session opens and the handoff stays to be taken.
// 2. The worktree: a sibling of the clone, <clone>-handoff-<id>, on isoplan/handoff/<id>, tracking
//    the remote's branch, made and moved with the repo's hooks off (they are the sender's, from the
//    branch). One made for this handoff before moves to the branch as handed over now, unless it
//    holds work that isn't in it: uncommitted changes to tracked files, or any commit that is neither
//    in the new tip nor one of the commits this machine took of this handoff before (taken.json in
//    the handoff's folder). Then it is left as it is and the take is refused with a note. A local
//    branch is never reset over such commits.
// 3. The setup script (E11): `worktreeSetup` in isoplan.json at the repo's top, read from the
//    receiver's own copy of the remote's default branch, and never from any other branch, so neither
//    the handoff nor whatever the clone has checked out can change what runs. When the default branch
//    can't be told, setup is skipped and the meeting says why. It runs with the system shell (cmd.exe
//    on Windows, /bin/sh on a Mac) in the worktree, hidden, with ISOPLAN_HANDOFF_ID and
//    ISOPLAN_HANDOFF_BRANCH set, under its timeout. Its output goes to setup.log in the handoff's
//    folder.
// 4. The repos under the session's folder (#56), each at its path in the worktree, parents first.
//    One there already (the setup script's clone, say) with the handoff's remote is fetched and
//    switched to the handoff's branch, by the shortcut's rules below: never over uncommitted changes
//    to tracked files or commits of the receiver's own. Where there is none, or only an empty
//    folder, it is cloned from the recorded remote on that branch, only when that is an https, ssh
//    or host:path remote (never a local path, file:// or a \server share), with Git LFS's download
//    off. A path through a link, or into a .git folder by any name Windows gives one, is refused.
//    The setup script runs before this, so it sees only the repos it clones itself. One that fails is reported with its path, and the rest go on.
//    A handoff from a folder that isn't a repo itself (a plain folder above several) has no
//    worktree to make: its folder is a new plain folder, <workspace>-handoff-<id>, beside the
//    receiver's own workspace, which is the most recent session folder holding a clone of one of
//    its repos at that repo's path. There is no repo there to read isoplan.json from, so no setup
//    script runs.
// 5. Claude Code in the worktree, under the session id the server chose, so that session alone may
//    join the room, told to read the brief, which is in brief.md in the handoff's folder
//    (<claude dir>/isoplan/handoffs/<id>/). A spin-off's task (#91) is in task.md there, and the
//    session is told to read that first. As the receiver chose on the floor, and only as they
//    said: a handoff that doesn't say is refused.
//    - `terminal`: a terminal window, the only thing here that opens one, and only for that click
//      (Windows: `start`, a Windows Terminal tab where that is the default; Mac: Terminal.app);
//    - `headless`: a background session, `claude --bg`, with no window. Claude Code starts one only
//      in a folder it trusts, and a new worktree isn't, so the worktree's path alone is recorded as
//      trusted in .claude.json first: the floor told the receiver it would be. The session is
//      confirmed through `claude agents --json`; the receiver opens it with `claude attach`, and a
//      harness that shows the repo's worktrees (Orca, for example) finds the worktree.
//    - `orca`: in the receiver's own Orca app (orca.ts), the one other path that shows anything, and
//      only for that click. The clone is added to Orca when it isn't there. A worktree new to this
//      machine is made by Orca, `orca worktree create` on the handoff's branch from the remote's,
//      with Orca's own setup skipped, so it is one of Orca's in the repo's Orca workspace; one made
//      before, a local branch of the handoff's name, or a clone whose core.hooksPath is set (whose
//      hooks could be the handoff branch's own, and Orca's checkout doesn't turn them off) gets the
//      take's own worktree instead, which Orca finds by its path. The worktree is trusted as for
//      headless, then `orca terminal create` opens a terminal in it that runs the launcher. Neither
//      the worktree nor the terminal is brought to the front: Orca's view changes only when the
//      receiver clicks Focus this session on the floor (focus.ts), which is why the terminal's handle
//      and the worktree are kept in orca.json in the handoff's folder.
//      Without Orca's CLI nothing is made, and the take says so; nor for a handoff of a plain folder
//      above several repos, which Orca can't hold.
//    - `desktop`: in the Claude app, which runs its own Claude Code and opens a session of Claude
//      Code for the terminal's with `claude --desktop --resume <id>` (2.1.285 on, a Mac or Windows
//      x64, signed in with a Claude subscription). The OS, the binary's version and its sign-in
//      (`claude auth status`, which must answer, and say a subscription) are checked before anything
//      is made. The worktree is trusted as for headless, then the take's prompt runs to its end,
//      hidden, as a saved session under the server's id (`claude -p --permission-mode default`, so no
//      `defaultMode` in the branch's settings loosens it, under `desktopReadMaxTurns` and
//      `desktopReadTimeoutMinutes`), so it has read the brief before the app takes it over and the two
//      never write to it at once. A first turn that fails has its transcript deleted. Then, unless the
//      server has dropped the take (cancelled, or timed out) or it has run past
//      `desktopTakeBudgetMinutes` (kept under the server's own take timeout), the app is asked to open
//      it. A session the app didn't open is still taken, with the failure saying how to open it.
//      The first turn's process is in the process registry while it runs (runner/registry.ts).
//    - `driven` (protocol 0.5.0): a session driven from the floor, run by the runner's session driver
//      (runner/session.ts). Only for the runner's own person (`by`), checked before anything is made.
//      The worktree and setup are as for a terminal, and the worktree is trusted as for headless;
//      then the driver checks its cap and readies the session, which it opens once `taken` has been
//      handed to the link (which sends it now, or after the next hello), under the take's session id,
//      with the take's prompt as its first instruction, and the permission mode the person asked for
//      (`permissions`), which the driver runs only where the office allows it. A take the server has
//      dropped (cancelled, or timed out) by then isn't trusted or readied.
//
// Step 5 for every mode but driven is openSession, which a new session from the floor opened outside
// it uses too (runner/start-where.ts), with its own words.
//
// After Orca (for a take into Orca), the claude binary is looked for, in every mode, before anything
// is made: without it nothing is.
//
// A failed setup script or repo checkout doesn't stop the rest: the session still opens, and the step is reported
// with the end of its output. Output leaves the machine only after the secret scan.

import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { realpath } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { isGitFolder, PROTOCOL_VERSION, type Handoff, type HandoffMessage, type HandoffRepo, type TakenMessage } from "@isoplan/protocol";
import os from "node:os";
import { promisify } from "node:util";
import { normalize, pathKey } from "../data-layer/git.js";
import type { NodeIo } from "../data-layer/io.js";
import { atLeast, claudeCommand, claudeVersion, DESKTOP_MIN_VERSION, desktopPlatform } from "../runner/claude-binary.js";
import { forkEnv, killTree, type Track } from "../runner/claude.js";
import type { PreparedTake } from "../runner/session.js";
import type { RemoteNames } from "../data-layer/remote-names.js";
import { handoffBranch, remotesOf, sameRepo, type RunGit } from "./git.js";
import type { RunOrca } from "./orca.js";

/** The repo's own labelled settings file, at its top. */
export const REPO_CONFIG = "isoplan.json";

// The end of a step's output that goes to the meeting.
export const OUTPUT_TAIL = 2000;

type Failure = TakenMessage["failures"][number];

export interface TakeSettings {
  gitTimeoutSeconds: number;
  setupTimeoutMinutes: number;
  cloneSearchDays: number;
  /** How long a take into the Claude app may spend reading the brief before the app takes it over, and in how many turns. */
  desktopReadTimeoutMinutes: number;
  desktopReadMaxTurns: number;
  /** How long a take into the Claude app may run in all before the app is no longer opened: under the server's take timeout. */
  desktopTakeBudgetMinutes: number;
}

/** What opens a terminal: a launcher script written to `file`, then the command that runs it. */
export interface Launch {
  file: string;
  text: string;
  command: string[];
}

/** How a background session is started: `argv` in `cwd`, with no window. */
export interface Background {
  argv: string[];
  cwd: string;
}

export interface TakeOptions {
  run: RunGit;
  io: NodeIo;
  claudeDir: string;
  machine: string;
  platform: NodeJS.Platform;
  /** The processor, as Node names it: by default this one's. */
  arch?: string;
  /** The environment the setup script and the session start from. */
  env: Record<string, string | undefined>;
  settings: () => Promise<TakeSettings>;
  /** The `claude` binary, or null when none can be found. */
  claude: () => Promise<string | null>;
  scan: (text: string) => Promise<string | null>;
  log: (text: string) => void;
  /** Runs a launch; resolves once the terminal has been asked to open. */
  open?: (launch: Launch, env: Record<string, string>) => Promise<void>;
  /** Claude Code's .claude.json, where a folder's trust is kept. */
  claudeJson: string;
  /** Starts a background session; resolves once `claude --bg` has returned. */
  start?: (background: Background, env: Record<string, string>) => Promise<void>;
  /** The session ids of the background sessions Claude Code lists in `cwd`. */
  agents?: (bin: string, cwd: string, env: Record<string, string>) => Promise<string[]>;
  /** How long to wait for a background session to be listed. */
  confirmMs?: number;
  now?: () => number;
  newSession?: () => string;
  /** Which remotes a missing repo under the folder may be cloned from: by default `onTheWire`. */
  cloneFrom?: (remote: string) => boolean;
  /** Orca's CLI, for a take into Orca, or null when Orca isn't on this machine. */
  orca?: () => Promise<RunOrca | null>;
  /** Whether the office server has dropped this take since (cancelled, or timed out): checked before the Claude app is opened, and before a driven take is trusted and readied. */
  dropped?: () => boolean;
  /** The runner's session driver, for a take as a driven session: why not, before anything is made; then readying it, null or why it can't open. */
  driven?: { problem(by: { id: string } | undefined): string | null; prepare(take: PreparedTake): Promise<string | null> };
  /** Records the take into the Claude app's first turn in the process registry while it runs. */
  track?: Track;
  /** Told the bare id of each session it started with `claude --bg`, once Claude Code lists it. */
  background?: (session: string) => void;
  /** Whether the session's first turn for the Claude app was closed from this computer's Isoplan menu (by its bare id). */
  closed?: (session: string) => boolean;
  /** GitHub repos' current names, so a clone that names the handoff's repo by an old name is found too. */
  names?: RemoteNames | null;
}

/** The handoff's folder on this machine: its brief, launcher and setup log. */
export const handoffDir = (claudeDir: string, id: string) => path.join(claudeDir, "isoplan", "handoffs", id);

// The first of a repo's remotes with a URL that names the same repo as `remote` (git.ts sameRepo).
async function remoteFor(remotes: { name: string; urls: string[] }[] | null, remote: string, names: RemoteNames | null): Promise<{ name: string; urls: string[] } | undefined> {
  for (const r of remotes ?? []) for (const url of r.urls) if (await sameRepo(url, remote, names)) return r;
  return undefined;
}

const tail = (text: string) => (text.length > OUTPUT_TAIL ? "…" + text.slice(-OUTPUT_TAIL) : text).trim();

/** The main checkout of a clone of `remote` on this machine, the most recently used first, and that remote's name there; null with none. */
export async function findClone(io: NodeIo, run: RunGit, projectsDir: string, remote: string, since: number, timeoutMs: number, names: RemoteNames | null = null): Promise<{ dir: string; remote: string } | null> {
  const tried = new Set<string>();
  for (const cwd of await recentFolders(io, projectsDir, since)) {
    const where = await run(["rev-parse", "--path-format=absolute", "--show-toplevel", "--git-common-dir"], { cwd, timeoutMs });
    if (where.code !== 0) continue;
    const [toplevel, commonDir] = where.stdout.split(/\r?\n/).map((s) => s.trim());
    if (!toplevel || !commonDir) continue;
    const main = normalize(commonDir).endsWith("/.git") ? path.dirname(commonDir) : toplevel;
    if (tried.has(pathKey(main))) continue;
    tried.add(pathKey(main));
    const match = await remoteFor(await remotesOf(run, main, timeoutMs), remote, names);
    if (match) return { dir: path.resolve(main), remote: match.name };
  }
  return null;
}

/**
 * The receiver's own folder for a handoff from a folder that isn't a repo (#56): the most recently
 * used session folder with a clone of one of `repos` at that repo's path in it, or the folder above
 * a session's repo that is one of them; null with none.
 */
export async function findWorkspace(io: NodeIo, run: RunGit, projectsDir: string, repos: HandoffRepo[], since: number, timeoutMs: number, names: RemoteNames | null = null): Promise<string | null> {
  const tried = new Set<string>();
  const holds = async (folder: string) => {
    for (const repo of repos) {
      const dir = path.join(folder, repo.path);
      const top = await run(["rev-parse", "--show-toplevel"], { cwd: dir, timeoutMs });
      if (top.code !== 0 || pathKey(top.stdout.trim()) !== pathKey(dir)) continue;
      if (await remoteFor(await remotesOf(run, dir, timeoutMs), repo.remote, names)) return true;
    }
    return false;
  };
  for (const cwd of await recentFolders(io, projectsDir, since)) {
    const top = await run(["rev-parse", "--show-toplevel"], { cwd, timeoutMs });
    const candidates = [cwd];
    // A session in one of the repos: the folder its path in the handoff says is above it.
    if (top.code === 0) {
      const at = top.stdout.trim();
      for (const repo of repos) {
        const above = aboveOf(at, repo.path);
        if (pathKey(path.join(above, repo.path)) === pathKey(at)) candidates.push(above);
      }
    }
    for (const folder of candidates) {
      if (tried.has(pathKey(folder))) continue;
      tried.add(pathKey(folder));
      if (await holds(folder)) return path.resolve(folder);
    }
  }
  return null;
}

// The folders the machine's Claude Code sessions since `since` ran in, the most recent first, each once.
async function recentFolders(io: NodeIo, projectsDir: string, since: number): Promise<string[]> {
  return (await sessionFolders(io, projectsDir, since)).map((f) => f.folder);
}

/**
 * The folders the machine's Claude Code sessions since `since` ran in, still there (or, with `gone`,
 * those no longer there too), the most recent first, each once, with when each was last used. `cwds`
 * keeps what each transcript says its folder is between calls, so a transcript that names its folder
 * is read once.
 */
export async function sessionFolders(io: Pick<NodeIo, "listDir" | "stat" | "read">, projectsDir: string, since: number, cwds?: Map<string, string>, { gone = false }: { gone?: boolean } = {}): Promise<{ folder: string; at: number }[]> {
  const transcripts: { cwd: string; at: number }[] = [];
  const used = new Set<string>();
  for (const dir of await io.listDir(projectsDir)) {
    if (!dir.isDir) continue;
    for (const entry of await io.listDir(path.join(projectsDir, dir.name))) {
      if (entry.isDir || !entry.name.endsWith(".jsonl")) continue;
      const file = path.join(projectsDir, dir.name, entry.name);
      const st = await io.stat(file);
      if (!st || st.mtimeMs < since) continue;
      const cwd = cwds?.get(file) ?? (await cwdOf(io, file, st.size));
      if (cwd) {
        used.add(file);
        cwds?.set(file, cwd);
        transcripts.push({ cwd, at: st.mtimeMs });
      }
    }
  }
  if (cwds) for (const file of cwds.keys()) if (!used.has(file)) cwds.delete(file);
  transcripts.sort((a, b) => b.at - a.at);
  const out: { folder: string; at: number }[] = [];
  const seen = new Set<string>();
  for (const { cwd, at } of transcripts) {
    if (seen.has(pathKey(cwd))) continue;
    seen.add(pathKey(cwd));
    if (gone || (await io.stat(cwd))?.isDir) out.push({ folder: cwd, at });
  }
  return out;
}

// The folder a transcript's first lines name.
async function cwdOf(io: Pick<NodeIo, "read">, file: string, size: number): Promise<string | null> {
  for (const text of (await io.read(file, 0, Math.min(size, 65536)).catch(() => "")).split("\n")) {
    if (!text.includes('"cwd"')) continue;
    try {
      const cwd = (JSON.parse(text) as { cwd?: unknown }).cwd;
      if (typeof cwd === "string" && cwd) return cwd;
    } catch {
      // A line cut by the window's edge.
    }
  }
  return null;
}

export interface WorktreeSetup {
  command: string;
  timeoutMs: number;
}

/** `worktreeSetup` from isoplan.json's text, for this platform: null when it names no command here. Throws when malformed. */
export function parseSetup(text: string, platform: NodeJS.Platform, defaultTimeoutMs: number): WorktreeSetup | null {
  const value = JSON.parse(text) as { worktreeSetup?: unknown };
  const setup = value?.worktreeSetup as { command?: unknown; timeoutMinutes?: unknown } | undefined;
  if (setup === undefined) return null;
  if (!setup || typeof setup !== "object") throw new Error(`"worktreeSetup" in ${REPO_CONFIG} must be an object`);
  const key = platform === "win32" ? "windows" : platform === "darwin" ? "mac" : "linux";
  const c = setup.command;
  const command = c && typeof c === "object" ? (c as Record<string, unknown>)[key] : c;
  if (command !== undefined && (typeof command !== "string" || !command.trim())) throw new Error(`"worktreeSetup.command" in ${REPO_CONFIG} must be a command, or { "windows", "mac" } commands`);
  const t = setup.timeoutMinutes;
  if (t !== undefined && !(typeof t === "number" && Number.isFinite(t) && t > 0)) throw new Error(`"worktreeSetup.timeoutMinutes" in ${REPO_CONFIG} must be a number of minutes above 0`);
  return command ? { command, timeoutMs: typeof t === "number" ? t * 60000 : defaultTimeoutMs } : null;
}

/**
 * isoplan.json from the remote's default branch, as this clone knows it, and never from any other
 * branch. The default branch is `<remote>/HEAD`, else what the remote says its HEAD is; the branch
 * is fetched so the file is current. `problem` says why it couldn't be read; `text` is null when
 * the default branch has no isoplan.json.
 */
export async function readSetupFile(run: RunGit, clone: { dir: string; remote: string }, timeoutMs: number): Promise<{ text: string | null; problem: string | null }> {
  const git = (args: string[]) => run(args, { cwd: clone.dir, timeoutMs });
  let branch = (await git(["symbolic-ref", "-q", "--short", `refs/remotes/${clone.remote}/HEAD`])).stdout.trim().replace(`${clone.remote}/`, "");
  if (!branch) {
    const said = await git(["ls-remote", "--symref", clone.remote, "HEAD"]);
    branch = /^ref: refs\/heads\/(\S+)\s+HEAD$/m.exec(said.stdout)?.[1] ?? "";
  }
  if (!branch) return { text: null, problem: `Setup was skipped: ${clone.remote}'s default branch couldn't be told, so ${REPO_CONFIG} couldn't be read from it.` };
  const fetched = await git(["fetch", "-q", clone.remote, `+refs/heads/${branch}:refs/remotes/${clone.remote}/${branch}`]);
  if (fetched.code !== 0) return { text: null, problem: `Setup was skipped: ${clone.remote}/${branch} couldn't be fetched to read ${REPO_CONFIG}:\n${fetched.stderr}` };
  const shown = await git(["show", `refs/remotes/${clone.remote}/${branch}:${REPO_CONFIG}`]);
  return { text: shown.code === 0 ? shown.stdout : null, problem: null };
}

/** The setup command isoplan.json on the remote's default branch names for this platform, or null; never throws. */
export async function setupCommand(run: RunGit, clone: { dir: string; remote: string }, platform: NodeJS.Platform, timeoutMs: number): Promise<string | null> {
  const { text } = await readSetupFile(run, clone, timeoutMs);
  try {
    return text === null ? null : (parseSetup(text, platform, 0)?.command ?? null);
  } catch {
    return null;
  }
}

/** Runs `command` with the system shell, hidden; resolves with whether it exited 0, its output's end and whether it timed out. */
export function runShell(command: string, { cwd, env, timeoutMs }: { cwd: string; env: Record<string, string>; timeoutMs: number }): Promise<{ ok: boolean; output: string; timedOut: boolean }> {
  return new Promise((resolve) => {
    let output = "";
    let timedOut = false;
    const child = spawn(command, { cwd, env, shell: true, stdio: ["pipe", "pipe", "pipe"], windowsHide: true, detached: process.platform !== "win32" });
    child.stdin.end();
    const keep = (piece: string) => (output = (output + piece).slice(-64 * 1024));
    child.stdout.setEncoding("utf8").on("data", keep);
    child.stderr.setEncoding("utf8").on("data", keep);
    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child);
    }, timeoutMs);
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ ok: false, output: output + err.message, timedOut });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ ok: code === 0 && !timedOut, output: timedOut ? `${output}\nIt was stopped after ${Math.round(timeoutMs / 60000)} minutes.` : output, timedOut });
    });
  });
}

// One argument on a .cmd file's line. Inside the quotes & ( ) @ ^ | < > are plain characters; a
// quote can't be in a Windows path, so it is dropped, and % is doubled.
const cmdQuote = (s: string) => `"${s.replace(/"/g, "").replace(/%/g, "%%")}"`;
const shQuote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

/**
 * The launcher that runs Claude Code in `dir`, and the command that opens it in a terminal: on
 * Windows a .cmd file that `start` opens in a new console (a Windows Terminal tab where that is the
 * default), on a Mac a .command file that Terminal opens. Null on any other platform.
 * CLAUDE_CONFIG_DIR, when set, is written into the launcher, since Terminal.app starts it with its
 * own environment, not the runner's.
 */
export function launch(platform: NodeJS.Platform, { folder, dir, argv, title, configDir }: { folder: string; dir: string; argv: string[]; title: string; configDir: string | null }): Launch | null {
  const name = title.replace(/["%^&|<>!()@]/g, "");
  if (platform === "win32") {
    const file = path.win32.join(folder, "open.cmd");
    // UTF-8 from the first line on, so a path with letters outside the console's code page works.
    const text = ["@echo off", "chcp 65001>nul", `title ${name}`, ...(configDir ? [`set "CLAUDE_CONFIG_DIR=${configDir.replace(/"/g, "").replace(/%/g, "%%")}"`] : []), `cd /d ${cmdQuote(dir)}`, argv.map(cmdQuote).join(" "), ""].join("\r\n");
    // cmd /k keeps a quoted path's quotes only when nothing special is in it, else it takes off the
    // outer pair: with two pairs, the path keeps one either way.
    return { file, text, command: [process.env.ComSpec || "cmd.exe", "/d", "/c", "start", `"${name}"`, "cmd.exe", "/k", `""${file}""`] };
  }
  if (platform === "darwin") {
    const file = path.posix.join(folder, "open.command");
    const text = ["#!/bin/sh", ...(configDir ? [`export CLAUDE_CONFIG_DIR=${shQuote(configDir)}`] : []), `cd ${shQuote(dir)} || exit 1`, `exec ${argv.map(shQuote).join(" ")}`, ""].join("\n");
    return { file, text, command: ["open", "-a", "Terminal", file] };
  }
  return null;
}

/** Writes the launcher and runs the command that opens it; rejects when it couldn't. */
export async function openLaunch(l: Launch, env: Record<string, string>): Promise<void> {
  await fs.writeFile(l.file, l.text, { mode: 0o755 });
  const [cmd, ...args] = l.command;
  await new Promise<void>((resolve, reject) => {
    // `start` and `open` return once the terminal has the launcher; Windows' quoting is written out.
    const child = spawn(cmd!, args, { env, stdio: "ignore", detached: true, windowsHide: true, windowsVerbatimArguments: process.platform === "win32" });
    const timer = setTimeout(() => (child.unref(), resolve()), 15000);
    child.on("error", (err) => (clearTimeout(timer), reject(err)));
    child.on("exit", (code) => (clearTimeout(timer), code === 0 ? resolve() : reject(new Error(`${path.basename(cmd!)} exited with code ${code}`))));
  });
}

// Runs a command hidden and waits for it, with its output; never opens a window. `started` is told of the process.
function hidden([cmd, ...args]: string[], cwd: string, env: Record<string, string>, timeoutMs: number, started?: (child: ChildProcess) => void): Promise<{ code: number | null; stdout: string; stderr: string; timedOut: boolean }> {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    // Its own process group on a Mac, as runShell's, so killTree ends whatever it started too, and
    // nothing left holding its pipes keeps `close` from firing.
    const child = spawn(cmd!, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true, detached: process.platform !== "win32" });
    started?.(child);
    child.stdout.setEncoding("utf8").on("data", (piece: string) => (stdout += piece));
    child.stderr.setEncoding("utf8").on("data", (piece: string) => (stderr = (stderr + piece).slice(-OUTPUT_TAIL)));
    const timer = setTimeout(() => ((timedOut = true), killTree(child as never)), timeoutMs);
    child.on("error", (err) => (clearTimeout(timer), resolve({ code: null, stdout, stderr: err.message, timedOut })));
    child.on("close", (code) => (clearTimeout(timer), resolve({ code, stdout, stderr, timedOut })));
  });
}

/**
 * What a take into the Claude app needs and this machine lacks, in words, or null: the OS, the
 * binary's version, and a subscription sign-in that `claude auth status` answers for. The runner
 * offers the take only while this is null (runner/main.ts). `again`: how to try again, "take it again"
 * for a take, "start it again" for a start.
 */
export async function desktopProblem(bin: string, env: Record<string, string>, platform: NodeJS.Platform, arch: string, machine: string, again = "take it again"): Promise<string | null> {
  if (!desktopPlatform(platform, arch)) return `The Claude app opens Claude Code sessions only on a Mac or on Windows x64, and ${machine} is neither, so nothing was made: ${again} from the floor another way.`;
  const version = await claudeVersion(bin, env);
  if (!version || !atLeast(version, DESKTOP_MIN_VERSION)) return `${INSTALL_FOR_DESKTOP} ${machine} has ${version ? `version ${version}` : "a version that didn't say which it is"}, so nothing was made.`;
  // A sign-in that can't be checked is refused too: nothing is made on a guess.
  const r = await hidden([...claudeCommand(bin), "auth", "status", "--json"], os.tmpdir(), env, 30000);
  const status = ((): { loggedIn?: unknown; authMethod?: unknown; apiProvider?: unknown } | null => {
    try {
      const value = JSON.parse(r.stdout) as unknown;
      return value && typeof value === "object" && typeof (value as { loggedIn?: unknown }).loggedIn === "boolean" ? (value as { loggedIn: boolean }) : null;
    } catch {
      return null;
    }
  })();
  if (r.code !== 0 || r.timedOut || !status) {
    return `Couldn't check Claude Code's sign-in on ${machine}: \`claude auth status\` ${r.timedOut ? "didn't answer within 30 seconds" : r.code !== 0 ? `exited with code ${r.code}` : "didn't say whether it is signed in"}, so nothing was made. Run it there to see why, then ${again}.`;
  }
  if (status.loggedIn === false) return `Claude Code for the terminal isn't signed in on ${machine}, so nothing was made: run \`claude auth login\` with your Claude subscription, then ${again}.`;
  const provider = typeof status.apiProvider === "string" && status.apiProvider !== "firstParty";
  if (provider || (typeof status.authMethod === "string" && /api.?key/i.test(status.authMethod))) {
    return `The Claude app opens only sessions signed in with a Claude subscription, and Claude Code for the terminal on ${machine} uses ${provider ? `${status.apiProvider}` : "an API key"}, so nothing was made: sign it in with \`claude auth login\`, or ${again} from the floor another way.`;
  }
  return null;
}

/**
 * Deletes the transcript of session `id`, which a failed first turn left: its .jsonl and its folder of
 * the same name, in whichever project folder Claude Code put them. The id is the take's own, new to
 * this machine. Whether a transcript was there to delete.
 */
export async function removeTranscript(claudeDir: string, id: string): Promise<boolean> {
  const projects = path.join(claudeDir, "projects");
  let found = false;
  for (const dir of await fs.readdir(projects).catch(() => [] as string[])) {
    const file = path.join(projects, dir, `${id}.jsonl`);
    if (await fs.rm(file).then(() => true, () => false)) found = true;
    await fs.rm(path.join(projects, dir, id), { recursive: true, force: true }).catch(() => {});
  }
  return found;
}

// Whether the repo at `dir` has changes to tracked files, or commits its upstream doesn't have.
async function changedSince(run: RunGit, dir: string, timeoutMs: number): Promise<boolean> {
  const status = await run(["status", "--porcelain", "--untracked-files=no"], { cwd: dir, timeoutMs });
  if (status.code !== 0) return false;
  if (status.stdout.trim()) return true;
  const ahead = await run(["rev-list", "--count", "@{upstream}..HEAD"], { cwd: dir, timeoutMs });
  return ahead.code === 0 && Number(ahead.stdout.trim()) > 0;
}

const INSTALL_FOR_DESKTOP = `Install Claude Code for the terminal, version ${DESKTOP_MIN_VERSION} or newer, to open sessions in the Claude app.`;

/** Starts `claude --bg`, hidden, which returns once the background session is up; rejects when it couldn't. */
export async function startBackground({ argv, cwd }: Background, env: Record<string, string>): Promise<void> {
  const r = await hidden(argv, cwd, env, 60000);
  if (r.code !== 0) throw new Error((r.stderr || r.stdout).trim() || `claude exited with code ${r.code}`);
}

/** The session ids of the background sessions `claude agents --json --all --cwd <cwd>` lists. */
export async function listAgents(bin: string, cwd: string, env: Record<string, string>): Promise<string[]> {
  const r = await hidden([...claudeCommand(bin), "agents", "--json", "--all", "--cwd", cwd], cwd, env, 30000);
  if (r.code !== 0) return [];
  try {
    const listed = JSON.parse(r.stdout) as unknown;
    const rows = Array.isArray(listed) ? listed : ((listed as { agents?: unknown })?.agents ?? []);
    return (rows as { sessionId?: unknown }[]).map((a) => a?.sessionId).filter((id): id is string => typeof id === "string");
  } catch {
    return [];
  }
}

/** The key Claude Code keeps a folder under in .claude.json's projects: forward slashes on Windows too. */
export const trustKey = (dir: string, platform: NodeJS.Platform) => (platform === "win32" ? path.win32.resolve(dir).replace(/\\/g, "/") : path.posix.resolve(dir));

/**
 * Records Claude Code's trust for `dir` alone in .claude.json (projects[dir].hasTrustDialogAccepted),
 * changing nothing else in the file: it is read, changed in that one place, written beside itself
 * and moved over it.
 */
export async function trustFolder(claudeJson: string, dir: string, platform: NodeJS.Platform): Promise<void> {
  const text = await fs.readFile(claudeJson, "utf8").catch((err: NodeJS.ErrnoException) => (err.code === "ENOENT" ? "{}" : Promise.reject(err)));
  const config = JSON.parse(text) as { projects?: Record<string, Record<string, unknown>> };
  const key = trustKey(dir, platform);
  if (config.projects?.[key]?.hasTrustDialogAccepted === true) return;
  config.projects = config.projects ?? {};
  config.projects[key] = { ...(config.projects[key] ?? {}), hasTrustDialogAccepted: true };
  const temp = `${claudeJson}.isoplan-${process.pid}`;
  await fs.writeFile(temp, JSON.stringify(config, null, 2) + (text.endsWith("\n") ? "\n" : ""), { mode: 0o600 });
  await fs.rename(temp, claudeJson);
}

/**
 * The first thing the new session is told. A spin-off's (`task`, the file holding its task) leads
 * with the task; the task's own text stays in its file, out of the launcher's command line.
 */
export function takePrompt(id: string, brief: string, setupLog: string | null, failedRepos: string[] = [], task: string | null = null): string {
  const opening = task
    ? [`Isoplan spin-off ${id}: you are starting a new task of your own, in ${task}. Read it first, then its brief in ${brief}, which says what the task needs from the work it came from; that session carries on with its own work.`]
    : [`Isoplan handoff ${id}: you are taking this work over.`, `Read its brief in ${brief} first.`];
  return [
    ...opening,
    ...(setupLog ? [`The worktree's setup script failed; the end of its output is in ${setupLog}.`] : []),
    ...(failedRepos.length ? [`These repos in this folder couldn't be put on the handoff's branch, so check them first: ${failedRepos.join(", ")}.`] : []),
    task ? "Then say what you take the task to be and what you would do first, and wait for me before changing anything." : "Then say where things stand and what you would do next, and wait for me before changing anything.",
  ].join(" ");
}

/**
 * Claude Code's command line for the new session. The prompt comes first: `--add-dir` takes every
 * argument after it, and would take the prompt too. `print` runs the prompt to its end, unattended,
 * in at most `maxTurns` turns, and says how it went as JSON, for a take into the Claude app: with the
 * default permission mode, whatever the folder's settings set as theirs, so nothing that would ask
 * is allowed.
 */
export function sessionArgv(bin: string, { prompt, session, name, folder, headless, print }: { prompt: string; session: string; name: string; folder: string | null; headless: boolean; print?: { maxTurns: number } }): string[] {
  const printing = print ? ["--print", "--output-format", "json", "--permission-mode", "default", "--max-turns", String(print.maxTurns)] : [];
  return [...claudeCommand(bin), prompt, ...(headless ? ["--bg"] : []), ...printing, "--session-id", session, "--name", name, ...(folder ? ["--add-dir", folder] : [])];
}

/** The commits this machine took of a handoff before, which a re-take may move past. */
async function takenBefore(folder: string): Promise<string[]> {
  try {
    const { commits } = JSON.parse(await fs.readFile(path.join(folder, "taken.json"), "utf8")) as { commits?: unknown };
    return Array.isArray(commits) ? commits.filter((c): c is string => typeof c === "string" && /^[0-9a-f]{40,64}$/.test(c)) : [];
  } catch {
    return [];
  }
}

async function recordTaken(folder: string, commit: string): Promise<void> {
  const commits = [...new Set([...(await takenBefore(folder)), commit])].slice(-50);
  await fs.mkdir(folder, { recursive: true });
  await fs.writeFile(path.join(folder, "taken.json"), JSON.stringify({ about: "The commits of this handoff taken on this machine, which a later take may replace.", commits }, null, 2) + "\n");
}

/**
 * Orca's `terminal create` for the handoff's launcher `file` in `dir`, typed into the terminal's
 * shell: cmd.exe on Windows, asked for, and the login shell on a Mac. Only with `focus` does Orca's
 * view switch to it.
 */
export function orcaTerminal(platform: NodeJS.Platform, dir: string, title: string, file: string, focus: boolean): string[] {
  const command = platform === "win32" ? `"${file.replace(/"/g, "")}"` : shQuote(file);
  return ["terminal", "create", "--worktree", `path:${dir}`, "--title", title, "--command", command, ...(platform === "win32" ? ["--shell", "cmd.exe"] : []), ...(focus ? ["--focus"] : [])];
}

/** The handle Orca gave the terminal `terminal create` opened, or null when it gave none. */
export const terminalHandle = (result: Record<string, unknown>) => {
  const handle = (result.terminal as { handle?: unknown } | undefined)?.handle;
  return typeof handle === "string" && handle ? handle : null;
};

/** What a take into Orca leaves in the handoff's folder for Focus this session (focus.ts): its terminal's handle and its worktree. */
export async function recordOrca(folder: string, terminal: string | null, worktree: string): Promise<void> {
  await fs.writeFile(path.join(folder, "orca.json"), JSON.stringify({ about: "The Orca terminal and worktree this handoff was opened in on this machine, for the floor's Focus this session.", terminal, worktree }, null, 2) + "\n");
}

// An empty folder as core.hooksPath, so no hook of the repo's runs while the handoff's branch, or a
// branch started from the floor (runner/checkouts.ts), is checked out: they would be whoever pushed
// it, from that branch.
let emptyHooks: Promise<string> | null = null;
export const noHooks = async () => ["-c", `core.hooksPath=${await (emptyHooks ??= fs.mkdtemp(path.join(os.tmpdir(), "isoplan-no-hooks-")))}`];

/** Takes the handoff on this machine; never throws. */
export async function takeHandoff(message: Pick<HandoffMessage, "handoff" | "mode" | "session" | "by" | "room" | "permissions">, o: TakeOptions): Promise<TakenMessage> {
  const { handoff } = message;
  const headless = message.mode === "headless";
  const driven = message.mode === "driven";
  let orca: RunOrca | null = null;
  const failures: Failure[] = [];
  const done = (session?: string): TakenMessage => ({ type: "taken", v: PROTOCOL_VERSION, handoff: handoff.id, ...(session ? { session } : {}), failures });
  const fail = async (step: Failure["step"], output: string, repo?: string) => {
    const matched = await o.scan(output);
    failures.push({ step, ...(repo ? { repo } : {}), output: matched ? `The end of its output is withheld here: it matches a secret pattern. It is on ${o.machine}.` : tail(output) });
  };
  // A window opens only when the receiver asked for a terminal: a handoff that doesn't say is refused.
  if (message.mode !== "terminal" && message.mode !== "headless" && message.mode !== "orca" && message.mode !== "desktop" && message.mode !== "driven") {
    await fail("open", "The office server didn't say how to open the session, so none was opened: take it again from the floor.");
    return done();
  }
  if (driven) {
    const problem = o.driven ? o.driven.problem(message.by) : "This computer's Isoplan can't run sessions from the floor yet, so nothing was made: take it again another way.";
    if (problem || !message.session || !message.room) {
      await fail("open", problem ?? "The office server didn't say which session and room to open, so none was opened: take it again from the floor.");
      return done();
    }
  }
  const desktop = message.mode === "desktop";
  const startedAt = Date.now();
  try {
    if (message.mode === "orca") {
      orca = (await o.orca?.()) ?? null;
      if (!orca) {
        await fail("open", `Orca wasn't found on ${o.machine}, so nothing was made or opened: take it again from the floor another way.`);
        return done();
      }
    }
    // Before anything is made, so a machine without Claude Code is left without a stray worktree.
    const bin = await o.claude();
    if (!bin) {
      const where = "if it is installed, set its path in ~/.claude/isoplan/claude-binary.json";
      await fail("open", desktop ? `${INSTALL_FOR_DESKTOP} It wasn't found on ${o.machine}, so nothing was made; ${where}.` : `Claude Code for the terminal wasn't found on ${o.machine}, so nothing was made: install it, then take the handoff again; ${where}.`);
      return done();
    }
    const env = forkEnv(o.env);
    if (desktop) {
      const problem = await desktopProblem(bin, env, o.platform, o.arch ?? process.arch, o.machine);
      if (problem) {
        await fail("open", problem);
        return done();
      }
    }
    const s = await o.settings();
    const timeoutMs = s.gitTimeoutSeconds * 1000;
    const repo = handoff.repos.find((r) => r.path === ".");
    const branch = repo?.branch ?? handoffBranch(handoff.id);
    const subs = byDepth(handoff.repos.filter((r) => r.path !== "."));
    const now = (o.now ?? Date.now)();
    const since = now - s.cloneSearchDays * 86400000;
    const projects = path.join(o.claudeDir, "projects");
    const folder = handoffDir(o.claudeDir, handoff.id);

    let dir: string;
    let clone: { dir: string; remote: string } | null = null;
    if (repo) {
      clone = await findClone(o.io, o.run, projects, repo.remote, since, timeoutMs, o.names);
      if (!clone) {
        await fail("worktree", `No clone of ${repo.remote} was found on ${o.machine}: none of its Claude Code sessions from the last ${s.cloneSearchDays} days ran in one. Open Claude Code once in your clone of the repo, then take the handoff again, or copy its prompt into a session there.`);
        return done();
      }
      const fetched = await o.run(["fetch", clone.remote, `+refs/heads/${branch}:refs/remotes/${clone.remote}/${branch}`], { cwd: clone.dir, timeoutMs });
      if (fetched.code !== 0) {
        await fail("worktree", `git fetch ${clone.remote} ${branch} in ${clone.dir} failed${fetched.timedOut ? " (it took too long)" : ""}:\n${fetched.stderr}`);
        return done();
      }
      const exempt = await takenBefore(folder);
      const made = orca ? await orcaWorktree(orca, o.run, clone, branch, { name: `handoff-${handoff.id}`, comment: `Isoplan handoff ${handoff.id}` }, (existing) => worktreeFor(o.run, clone!.dir, clone!.remote, branch, handoff.id, exempt, timeoutMs, existing), timeoutMs) : await worktreeFor(o.run, clone.dir, clone.remote, branch, handoff.id, exempt, timeoutMs);
      if (typeof made !== "string") {
        await fail("worktree", made.error);
        return done();
      }
      dir = made;
      await recordTaken(folder, (await resolved(o.run, dir, "HEAD", timeoutMs)) ?? repo.commit);
    } else {
      // Orca opens a terminal only in a repo it holds, and this folder isn't one.
      if (orca) {
        await fail("open", "This handoff is of a folder above several repos, not one repo, so Orca can't open it: take it again from the floor another way.");
        return done();
      }
      // A handoff from a plain folder above its repos: a plain folder beside the receiver's own.
      const workspace = await findWorkspace(o.io, o.run, projects, subs, since, timeoutMs, o.names);
      if (!workspace) {
        await fail("worktree", `No folder holding a clone of ${subs.map((r) => r.remote).join(" or ")} at its path in the handoff (${subs.map((r) => r.path).join(", ")}) was found on ${o.machine}: none of its Claude Code sessions from the last ${s.cloneSearchDays} days ran in one. Open Claude Code once in your folder of these repos, then take the handoff again, or copy its prompt into a session there.`);
        return done();
      }
      const own = `-handoff-${handoff.id}`;
      dir = path.basename(workspace).endsWith(own) ? workspace : `${workspace}${own}`;
      await fs.mkdir(dir, { recursive: true });
    }
    await fs.mkdir(folder, { recursive: true });
    const briefFile = path.join(folder, "brief.md");
    await fs.writeFile(briefFile, handoff.brief + "\n");
    const taskFile = handoff.task ? path.join(folder, "task.md") : null;
    if (taskFile) await fs.writeFile(taskFile, handoff.task + "\n");

    // A new session is spawned, so the setup script always runs, when there is a repo to read it from.
    let setupLog: string | null = null;
    let setup: WorktreeSetup | null = null;
    if (clone) {
      const config = await readSetupFile(o.run, clone, timeoutMs);
      if (config.problem) await fail("setup", config.problem);
      try {
        setup = config.text === null ? null : parseSetup(config.text, o.platform, s.setupTimeoutMinutes * 60000);
      } catch (err) {
        await fail("setup", `${REPO_CONFIG} couldn't be read: ${(err as Error).message}`);
      }
    }
    if (setup) {
      o.log(`handoff ${handoff.id}: running the worktree setup script in ${dir}`);
      const r = await runShell(setup.command, { cwd: dir, env: { ...env, ISOPLAN_HANDOFF_ID: handoff.id, ISOPLAN_HANDOFF_BRANCH: branch }, timeoutMs: setup.timeoutMs });
      if (!r.ok) {
        setupLog = path.join(folder, "setup.log");
        await fs.writeFile(setupLog, r.output);
        await fail("setup", r.output || "The setup script failed with no output.");
      }
    }

    // The repos under the folder, after setup, which may have cloned some of them on main.
    const failedRepos: string[] = [];
    for (const sub of subs) {
      const failed = await repoAt(o.run, dir, sub, folder, timeoutMs, o.cloneFrom ?? onTheWire, o.names ?? null);
      if (!failed) continue;
      failedRepos.push(sub.path);
      await fail(failed.step, failed.error, sub.path);
    }

    const id = message.session ?? (o.newSession ?? randomUUID)();
    const name = `Isoplan handoff ${handoff.id}`;
    if (driven) {
      const dropped = `The take stopped before its session was opened: it was cancelled or timed out on the floor. The worktree is ${dir}: take it again from the floor.`;
      if (o.dropped?.()) {
        await fail("open", dropped);
        return done();
      }
      try {
        // The floor told the receiver: this trusts the worktree, so its settings, hooks and scripts run.
        await trustFolder(o.claudeJson, dir, o.platform);
      } catch (err) {
        await fail("open", `The session couldn't be readied to run from the floor: ${(err as Error).message}. The worktree is ${dir}.`);
        return done();
      }
      if (o.dropped?.()) {
        await fail("open", dropped);
        return done();
      }
      const problem = await o.driven!.prepare({ session: id, folder: dir, prompt: takePrompt(handoff.id, briefFile, setupLog, failedRepos, taskFile), name, addDir: folder, room: message.room!, by: message.by!, permissions: message.permissions ?? "auto" });
      if (problem) {
        await fail("open", `${problem} The worktree is ${dir}.`);
        return done();
      }
      o.log(`handoff ${handoff.id}: Claude Code session ${id} opens in ${dir}, run from the floor`);
      return done(`claude-code:${id}`);
    }
    const words: OpenWords = {
      read: "read the handoff",
      did: "Claude Code read the handoff",
      stopped: "the take stopped",
      again: "take it again from the floor",
      at: "The worktree is",
      yourself: `The worktree is ${dir} and the brief is ${briefFile}${taskFile ? `, and its task is ${taskFile}` : ""}: open Claude Code there yourself.`,
      changed: " Tracked files in it have changed since it was made (by its setup or that turn), and a take again leaves a worktree with changes alone: run `git reset --hard` in it to drop them first.",
    };
    const prompt = takePrompt(handoff.id, briefFile, setupLog, failedRepos, taskFile);
    const opened = await openSession({ mode: message.mode as OpenMode, bin, env, dir, folder, addDir: true, prompt, session: id, name, orca, settings: s, startedAt, label: `handoff ${handoff.id}`, words }, o);
    if (opened.problem) await fail("open", opened.problem);
    if (opened.terminal !== undefined) await recordOrca(folder, opened.terminal, dir).catch((err: Error) => o.log(`handoff ${handoff.id}: couldn't record its Orca terminal: ${err.message}`));
    return done(opened.opened ? `claude-code:${id}` : undefined);
  } catch (err) {
    o.log(`handoff ${handoff.id}: taking it failed: ${(err as Error)?.stack ?? String(err)}`);
    if (!failures.length) failures.push({ step: "worktree", output: "The runner failed while taking the handoff; its log on this machine says why." });
    return done();
  }
}

/** Where openSession opens a session: a take's or a start's mode other than driven. */
export type OpenMode = "terminal" | "headless" | "orca" | "desktop";

/** The words openSession's failures use for what it opens: a handoff's take, or a start from the floor. */
export interface OpenWords {
  /** What the Claude app's first turn does, after "couldn't": "read the handoff". */
  read: string;
  /** That it did: "Claude Code read the handoff". */
  did: string;
  /** "the take stopped". */
  stopped: string;
  /** How to try again: "take it again from the floor". */
  again: string;
  /** Before the folder it opened in: "The worktree is". */
  at: string;
  /** After "Opening a terminal isn't supported on <platform> yet.". */
  yourself: string;
  /** Said when tracked files in the folder changed during a failed first turn for the Claude app; null: not checked. */
  changed: string | null;
}

export interface OpenSession {
  mode: OpenMode;
  bin: string;
  env: Record<string, string>;
  /** The folder Claude Code runs in. */
  dir: string;
  /** Where the terminal's launcher is written; with `addDir`, added to the session too (--add-dir). */
  folder: string;
  addDir: boolean;
  /** The first message. */
  prompt: string;
  /** The session id it opens under, a bare uuid. */
  session: string;
  name: string;
  /** Orca's CLI, for mode `orca`. */
  orca: RunOrca | null;
  settings: TakeSettings;
  /** When the take or start began, for desktopTakeBudgetMinutes. */
  startedAt: number;
  /** What the log calls it: "handoff <id>". */
  label: string;
  words: OpenWords;
}

export type OpenOptions = Pick<TakeOptions, "run" | "claudeDir" | "claudeJson" | "platform" | "env" | "log" | "open" | "start" | "agents" | "confirmMs" | "dropped" | "track" | "background" | "closed">;

/** Why a take's first turn ended when the desktop app's Close ended it. */
export const CLOSED_FROM_MENU = "it was closed from this computer's Isoplan menu";

const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/**
 * Opens Claude Code in `dir` under `session`, with `prompt` its first message, as `mode` says (see
 * step 5 above): a terminal window, a background session, a terminal in Orca in a worktree Orca
 * already sees, or the Claude app, its first turn run hidden first. `opened`: the session is there,
 * and `problem`, when set, says what still needs the person; else `problem` says why none opened.
 * `terminal`: for Orca, the handle of the terminal it opened, or null when Orca gave none.
 */
export async function openSession(x: OpenSession, o: OpenOptions): Promise<{ opened: boolean; problem: string | null; terminal?: string | null }> {
  const { bin, env, dir, folder, session: id, name, settings: s, words: w, label } = x;
  const desktop = x.mode === "desktop";
  const headless = x.mode === "headless";
  const argv = sessionArgv(bin, { prompt: x.prompt, session: id, name, folder: x.addDir ? folder : null, headless, ...(desktop ? { print: { maxTurns: s.desktopReadMaxTurns } } : {}) });
  const failed = (problem: string) => ({ opened: false, problem });
  if (desktop) {
    const budgetMs = s.desktopTakeBudgetMinutes * 60000;
    const left = () => budgetMs - (Date.now() - x.startedAt);
    const stopped = () => (o.dropped?.() ? "it was cancelled or timed out on the floor" : left() <= 0 ? `it ran past ${s.desktopTakeBudgetMinutes} minutes` : null);
    const before = stopped();
    if (before) return failed(`${capital(w.stopped)} before Claude Code ${w.read}: ${before}. ${w.at} ${dir}: ${w.again}.`);
    try {
      // The person chose this folder on the floor (a take's receiver, or a start's owner): trusting it runs its settings, hooks and scripts.
      await trustFolder(o.claudeJson, dir, o.platform);
    } catch (err) {
      return failed(`The session couldn't be readied for the Claude app: ${(err as Error).message}. ${w.at} ${dir}.`);
    }
    // The first turn ends before the app opens the session, so the two never write to it at once.
    const readMs = Math.min(s.desktopReadTimeoutMinutes * 60000, left());
    const read = await hidden(argv, dir, env, readMs, (child) => o.track?.(child, { kind: "desktop-read", session: `claude-code:${id}`, folder: dir }));
    const said = ((): { is_error?: unknown; subtype?: unknown; session_id?: unknown } | null => {
      try {
        return JSON.parse(read.stdout.trim().split(/\r?\n/).at(-1) ?? "") as { is_error?: unknown; subtype?: unknown; session_id?: unknown };
      } catch {
        return null;
      }
    })();
    if (read.code !== 0 || said?.is_error === true || said?.session_id !== id) {
      // Fixed words only: what claude printed is the model's, and stays in the local log.
      o.log(`${label}: the first turn of ${id} failed (code ${read.code}): ${read.stderr.trim().slice(-500)}`);
      const kind = typeof said?.subtype === "string" && /^[a-z_]+$/.test(said.subtype) ? ` (${said.subtype})` : "";
      const why = o.closed?.(id) ? CLOSED_FROM_MENU : read.timedOut ? `it was stopped after ${Math.round(readMs / 60000)} minutes` : read.code !== 0 ? `claude exited with code ${read.code}` : said?.is_error === true ? `it ended in an error${kind}` : `it didn't say it ran session ${id}`;
      const removed = await removeTranscript(o.claudeDir, id);
      const changed = w.changed !== null && (await changedSince(o.run, dir, s.gitTimeoutSeconds * 1000));
      return failed(
        `Claude Code couldn't ${w.read} before the Claude app took it over: ${why}; this machine's runner log has more. ${removed ? "Its unfinished session was deleted." : `Its unfinished session ${id} may be left in Claude Code's session list.`} ${w.at} ${dir}.${changed ? w.changed : ""}`,
      );
    }
    const after = stopped();
    if (after) return failed(`${w.did}, but ${w.stopped} before the Claude app was opened: ${after}. Its session ${id} is in ${dir}; ${w.again}, or open it yourself with \`claude --resume ${id}\` there.`);
    const opened = await hidden([...claudeCommand(bin), "--desktop", "--resume", id], dir, env, 60000);
    if (opened.code !== 0) {
      // The session is made and has had its first turn: it is open, and the problem says how to open it.
      const why = opened.timedOut ? "it didn't return within a minute" : opened.stderr.trim() || `claude exited with code ${opened.code}`;
      o.log(`${label}: Claude Code session ${id} is ready in ${dir}, but the Claude app didn't open on it`);
      return { opened: true, problem: `The Claude app didn't open on the session: ${why}. The session is ready: open it from the Claude app's session list, or run \`claude --desktop --resume ${id}\` in ${dir}.` };
    }
    o.log(`${label}: opened Claude Code session ${id} in the Claude app, in ${dir}`);
    return { opened: true, problem: null };
  }
  if (headless) {
    try {
      // The person chose this folder on the floor (a take's receiver, or a start's owner): trusting it runs its settings, hooks and scripts.
      await trustFolder(o.claudeJson, dir, o.platform);
      await (o.start ?? startBackground)({ argv, cwd: dir }, env);
    } catch (err) {
      return failed(`The headless session couldn't be started: ${(err as Error).message}. ${w.at} ${dir}.`);
    }
    const end = Date.now() + (o.confirmMs ?? 15000);
    let listed = false;
    while (!listed && Date.now() < end) {
      listed = (await (o.agents ?? listAgents)(bin, dir, env)).includes(id);
      if (!listed) await new Promise((r) => setTimeout(r, 500));
    }
    if (!listed) return failed(`claude --bg returned, but \`claude agents\` doesn't list session ${id} in ${dir}, so it may not have started. Open Claude Code there yourself.`);
    o.log(`${label}: started background Claude Code session ${id} in ${dir}`);
    o.background?.(id);
    return { opened: true, problem: null };
  }
  const l = launch(o.platform, { folder, dir, argv, title: name, configDir: o.env.CLAUDE_CONFIG_DIR ?? null });
  if (!l) return failed(`Opening a terminal isn't supported on ${o.platform} yet. ${w.yourself}`);
  if (x.mode === "orca") {
    if (!x.orca) return failed(`Orca wasn't found on this computer, so nothing was opened. ${w.at} ${dir}.`);
    try {
      // The person chose this folder on the floor (a take's receiver, or a start's owner): trusting it runs its settings, hooks and scripts.
      await trustFolder(o.claudeJson, dir, o.platform);
      await fs.writeFile(l.file, l.text, { mode: 0o755 });
    } catch (err) {
      return failed(`The session couldn't be readied for Orca: ${(err as Error).message}. ${w.at} ${dir}.`);
    }
    const opened = await x.orca(orcaTerminal(o.platform, dir, name, l.file, false));
    if (!opened.ok) return failed(`Orca couldn't open Claude Code in ${dir}: ${opened.error}`);
    o.log(`${label}: opened Claude Code session ${id} in Orca, in ${dir}`);
    return { opened: true, problem: null, terminal: terminalHandle(opened.result) };
  }
  try {
    await (o.open ?? openLaunch)(l, env);
  } catch (err) {
    return failed(`The terminal couldn't be opened: ${(err as Error).message}. ${w.at} ${dir}.`);
  }
  o.log(`${label}: opened Claude Code session ${id} in ${dir}`);
  return { opened: true, problem: null };
}

/**
 * How many commits `ref` has that neither the new tip nor any commit this machine took of the
 * handoff before (`exempt`, which a new hand-over replaces) has: the receiver's own work. Null when
 * git can't say.
 */
async function ahead(run: RunGit, cwd: string, tip: string, exempt: string[], ref: string, timeoutMs: number): Promise<number | null> {
  const known: string[] = [];
  for (const c of exempt) if ((await run(["cat-file", "-e", `${c}^{commit}`], { cwd, timeoutMs })).code === 0) known.push(c);
  const r = await run(["rev-list", "--count", ref, "--not", tip, ...known], { cwd, timeoutMs });
  return r.code === 0 ? Number(r.stdout.trim()) : null;
}

/** What a ref points at now, or null. */
async function resolved(run: RunGit, cwd: string, ref: string, timeoutMs: number): Promise<string | null> {
  const r = await run(["rev-parse", "--verify", "-q", ref], { cwd, timeoutMs });
  return r.code === 0 ? r.stdout.trim() : null;
}

/**
 * The shortcut's checkout (/isoplan:take): the handoff's branch in the session's own folder, fetched
 * from the remote there that is the handoff's, with the repo's hooks off. A folder with uncommitted
 * changes to tracked files is left as it is, rather than carrying them over. A local branch of that
 * name moves to the fetched tip, unless it has commits that are neither in the tip nor ones this
 * machine took of the handoff before (recorded in `folder`), which would be lost: then it is left as
 * it is. The repos under the folder (#56) follow, each at its path in the folder, cloned where
 * missing, as on the floor; they are left alone when the folder's own repo fails. The folder is the
 * session's repo's top, or the session's folder for a handoff from a plain folder; a session in one
 * of the handoff's repos under the folder works from the folder above it, and a plain folder's
 * handoff isn't taken inside some other repo. No setup script runs: the person, or their harness,
 * set up this folder. Returns the failed steps, each with the end of git's output and the repo it
 * was in when that is one under the folder, and the folder's own repo's remote name.
 */
export async function checkoutHere(run: RunGit, cwd: string, handoff: Handoff, folder: string, timeoutMs: number, { cloneFrom = onTheWire, names = null }: { cloneFrom?: (remote: string) => boolean; names?: RemoteNames | null } = {}): Promise<{ failures: Failure[]; remote: string | null; dir: string }> {
  const repo = handoff.repos.find((r) => r.path === ".");
  const subs = byDepth(handoff.repos.filter((r) => r.path !== "."));
  const refused = (output: string, remote: string | null = null) => ({ failures: [{ step: "checkout" as const, output: tail(output) }], remote, dir: at ?? cwd });
  const top = await run(["rev-parse", "--show-toplevel"], { cwd, timeoutMs });
  const at = top.code === 0 ? top.stdout.trim() : null;
  let inside: HandoffRepo | undefined;
  for (const sub of at ? subs : []) {
    if (pathKey(path.join(aboveOf(at!, sub.path), sub.path)) !== pathKey(at!)) continue;
    if (await remoteFor(await remotesOf(run, at!, timeoutMs), sub.remote, names)) inside = sub;
  }
  const base = inside ? aboveOf(at!, inside.path) : (at ?? cwd);
  let remote: string | null = null;
  if (repo) {
    const own = at ? await checkoutIn(run, base, repo, repo.branch, folder, timeoutMs, names) : { error: `${cwd} isn't in a git repo.`, remote: null };
    if (own.error) return refused(own.error, own.remote);
    remote = own.remote;
  } else if (at && !inside) {
    return refused(`${cwd} is inside the repo at ${at}, which isn't one of this handoff's repos (${subs.map((r) => r.path).join(", ")}), so nothing was cloned into it. Take it from the folder that holds them, or an empty one.`);
  }
  const failures: Failure[] = [];
  for (const sub of subs) {
    const failed = await repoAt(run, base, sub, folder, timeoutMs, cloneFrom, names);
    if (failed) failures.push({ step: failed.step, repo: sub.path, output: tail(failed.error) });
  }
  return { failures, remote, dir: base };
}

// The handoff's branch checked out in the repo at `cwd`, by the shortcut's rules; the error, else null.
async function checkoutIn(run: RunGit, cwd: string, repo: HandoffRepo, branch: string, folder: string, timeoutMs: number, names: RemoteNames | null): Promise<{ error: string | null; remote: string | null }> {
  const git = (args: string[]) => run(args, { cwd, timeoutMs });
  // Checking out downloads no LFS files: a handoff never carries any.
  const checkout = (args: string[]) => run(args, { cwd, timeoutMs, env: NO_LFS });
  const remotes = await remotesOf(run, cwd, timeoutMs);
  const failed = (error: string, remote: string | null = null) => ({ error, remote });
  if (!remotes) return failed(`${cwd} isn't in a git repo.`);
  const name = (await remoteFor(remotes, repo.remote, names))?.name;
  if (!name) return failed(`No remote of the repo in ${cwd} is ${repo.remote}, the repo the handoff was pushed to.`);
  if ((await git(["status", "--porcelain", "--untracked-files=no"])).stdout.trim()) {
    return failed(`${cwd} has uncommitted changes to tracked files, so the handoff's branch wasn't checked out over them. Commit or stash them, then take it again.`, name);
  }
  const tip = `refs/remotes/${name}/${branch}`;
  const fetched = await git(["fetch", name, `+refs/heads/${branch}:${tip}`]);
  if (fetched.code !== 0) return failed(`git fetch ${name} ${branch}: ${fetched.stderr}`, name);
  const hooksOff = await noHooks();
  const ok = async () => {
    await recordTaken(folder, (await resolved(run, cwd, "HEAD", timeoutMs)) ?? repo.commit);
    return { error: null, remote: name };
  };
  const local = await git(["rev-parse", "--verify", "-q", `refs/heads/${branch}`]);
  if (local.code !== 0) {
    const switched = await checkout([...hooksOff, "switch", "--track", "-c", branch, `${name}/${branch}`]);
    return switched.code === 0 ? ok() : failed(`git switch ${branch}: ${switched.stderr}`, name);
  }
  const extra = await ahead(run, cwd, tip, await takenBefore(folder), `refs/heads/${branch}`, timeoutMs);
  if (extra !== 0) return failed(`The local branch ${branch} has ${extra ?? "some"} commit(s) that aren't in the handoff as handed over now, so it was left as it is. Merge or rebase them onto ${name}/${branch} yourself.`, name);
  const switched = await checkout([...hooksOff, "switch", branch]);
  if (switched.code !== 0) return failed(`git switch ${branch}: ${switched.stderr}`, name);
  const moved = await checkout([...hooksOff, "reset", "-q", "--keep", tip]);
  return moved.code === 0 ? ok() : failed(`${branch} couldn't be moved to the handoff as handed over now:\n${moved.stderr}`, name);
}

// Repos parents first, so one under another is checked out after it.
const byDepth = (repos: HandoffRepo[]) => [...repos].sort((a, b) => a.path.split("/").length - b.path.split("/").length);

// The folder above a repo at `at` whose path in that folder is `p`.
const aboveOf = (at: string, p: string) => path.resolve(at, ...p.split("/").map(() => ".."));

/**
 * Whether a missing repo may be cloned from `remote`: https, ssh or scp-style (host:path) only, so
 * a handoff never points git at a local path, a file:// URL or a \\server share on this machine.
 */
export function onTheWire(remote: string): boolean {
  const url = /^([a-z][a-z0-9+.-]*):\/\//i.exec(remote);
  if (url) return ["https", "ssh", "git+ssh", "ssh+git"].includes(url[1]!.toLowerCase());
  // scp-style: a colon before any slash, after more than a drive letter.
  const scp = /^([^/\\]*):/.exec(remote);
  return !!scp && scp[1]!.length > 1 && !remote.startsWith("\\");
}

// The real path, with Windows' short 8.3 names spelled out long.
const realpathNative = promisify(realpath.native);

// Git LFS downloads nothing on a checkout of the handoff's: a handoff never carries LFS files.
const NO_LFS = { GIT_LFS_SKIP_SMUDGE: "1" };

// Why a repo's path in the handoff isn't one to check out at, or null: what the protocol refuses, again here.
function badPath(p: string): string | null {
  const parts = p.split(/[\\/]/);
  if (parts.some(isGitFolder)) return `${p} is inside a .git folder`;
  if (p.includes(":")) return `${p} has a colon in it, which Windows reads as a drive or a file's stream`;
  if (path.isAbsolute(p) || parts.some((part) => part === "" || part === "." || part === "..")) return `${p} isn't a path of named folders inside the folder`;
  return null;
}

/**
 * A repo under the folder (#56) on its handoff branch at its path in `base`: switched where a clone
 * of it is there, cloned where there is nothing or an empty folder, from a remote `cloneFrom`
 * allows, with Git LFS's download off (a handoff never carries LFS files). The failed step,
 * `clone` when git clone failed and `checkout` otherwise, with its error; else null.
 */
async function repoAt(run: RunGit, base: string, repo: HandoffRepo, folder: string, timeoutMs: number, cloneFrom: (remote: string) => boolean, names: RemoteNames | null): Promise<{ step: "clone" | "checkout"; error: string } | null> {
  const refused = (error: string) => ({ step: "checkout" as const, error });
  const bad = badPath(repo.path);
  if (bad) return refused(`${bad}, so nothing was checked out there.`);
  const target = path.join(base, repo.path);
  // The path stays inside the folder: no link on the way (one the handoff's branch made, say)
  // leads out, and no folder on it is a .git folder by its real, long name.
  let existing = target;
  while (!(await fs.lstat(existing).then(() => true, () => false))) existing = path.dirname(existing);
  const realBase = await realpathNative(base);
  const real = await realpathNative(existing);
  if (pathKey(real) !== pathKey(path.join(realBase, path.relative(base, existing)))) return refused(`${target} leads outside ${base} through a link, so nothing was checked out there.`);
  if (path.relative(realBase, real).split(/[\\/]/).some(isGitFolder)) return refused(`${repo.path} is inside a .git folder, so nothing was checked out there.`);
  const st = await fs.lstat(target).catch(() => null);
  if (st && !st.isDirectory()) return refused(`${target} is there already and isn't a folder, so ${repo.remote} wasn't cloned there.`);
  if (!st || (await fs.readdir(target)).length === 0) {
    if (!cloneFrom(repo.remote)) return refused(`${repo.path} isn't here, and ${repo.remote} isn't an https, ssh or host:path remote, so it wasn't cloned: a handoff never clones from a local path, a file:// URL or a \\\\server share. Clone it at ${target} yourself, then take the handoff again.`);
    await fs.mkdir(path.dirname(target), { recursive: true });
    const cloned = await run([...(await noHooks()), "clone", "-q", "--branch", repo.branch, "--", repo.remote, target], { cwd: base, timeoutMs, env: NO_LFS });
    if (cloned.code !== 0) return { step: "clone", error: `git clone ${repo.remote} ${repo.path} failed${cloned.timedOut ? " (it took too long)" : ""}:\n${cloned.stderr}` };
    await recordTaken(folder, (await resolved(run, target, "HEAD", timeoutMs)) ?? repo.commit);
    return null;
  }
  const top = await run(["rev-parse", "--show-toplevel"], { cwd: target, timeoutMs });
  if (top.code !== 0 || pathKey(top.stdout.trim()) !== pathKey(target)) return refused(`${target} is there already and isn't a repo of its own, so ${repo.remote} wasn't cloned into it.`);
  const { error } = await checkoutIn(run, target, repo, repo.branch, folder, timeoutMs, names);
  return error ? refused(error) : null;
}

// The worktree for the handoff: one already made on its branch, moved to the new tip when nothing
// in it would be lost, else a new sibling of the clone.
// `existing`, a worktree already on the handoff's branch wherever it is (Orca's, say), is the one
// moved, when given.
async function worktreeFor(run: RunGit, clone: string, remote: string, branch: string, id: string, exempt: string[], timeoutMs: number, existing: string | null = null): Promise<string | { error: string }> {
  const tip = `refs/remotes/${remote}/${branch}`;
  const hooksOff = await noHooks();
  const move = async (dir: string) => {
    // Untracked files (a setup script's own, say) are kept by the reset, so only tracked changes count.
    const dirty = (await run(["status", "--porcelain", "--untracked-files=no"], { cwd: dir, timeoutMs })).stdout.trim() !== "";
    const extra = await ahead(run, dir, tip, exempt, "HEAD", timeoutMs);
    if (dirty || extra !== 0) {
      return { error: `${dir}, this handoff's worktree from before, has work that isn't in the handoff as handed over now (${dirty ? "uncommitted changes" : `${extra ?? "some"} commit(s)`}), so it was left as it is. Commit and push it, or move it aside, then take the handoff again.` };
    }
    const moved = await run([...hooksOff, "reset", "-q", "--keep", tip], { cwd: dir, timeoutMs, env: NO_LFS });
    return moved.code === 0 ? dir : { error: `${dir} couldn't be moved to the handoff as handed over now:\n${moved.stderr}` };
  };
  if (existing) return move(existing);
  const base = path.join(path.dirname(clone), `${path.basename(clone)}-handoff-${id}`);
  for (let n = 1; n < 10; n++) {
    const dir = n === 1 ? base : `${base}-${n}`;
    const exists = await fs.stat(dir).then(() => true, () => false);
    if (exists) {
      const head = await run(["rev-parse", "--abbrev-ref", "HEAD"], { cwd: dir, timeoutMs });
      if (head.code !== 0 || head.stdout.trim() !== branch) continue;
      return move(dir);
    }
    // A local branch of the handoff's name with commits the remote's doesn't have is never reset.
    if ((await run(["rev-parse", "--verify", "-q", `refs/heads/${branch}`], { cwd: clone, timeoutMs })).code === 0) {
      const extra = await ahead(run, clone, tip, exempt, `refs/heads/${branch}`, timeoutMs);
      if (extra !== 0) return { error: `The local branch ${branch} in ${clone} has ${extra ?? "some"} commit(s) that aren't in the handoff as handed over now, so no worktree was made over it. Push or move them, then take the handoff again.` };
    }
    const r = await run([...hooksOff, "worktree", "add", "--track", "-B", branch, dir, `${remote}/${branch}`], { cwd: clone, timeoutMs, env: NO_LFS });
    return r.code === 0 ? dir : { error: `git worktree add ${dir} failed${r.timedOut ? " (it took too long)" : ""}:\n${r.stderr}` };
  }
  return { error: `${base} and the next eight names beside it are taken by other folders` };
}

/** The worktree, other than the main checkout, that has `branch` checked out, or null. */
export async function worktreeOn(run: RunGit, clone: string, branch: string, timeoutMs: number): Promise<string | null> {
  const listed = await run(["worktree", "list", "--porcelain"], { cwd: clone, timeoutMs });
  if (listed.code !== 0) return null;
  const blocks = listed.stdout.split(/\r?\n\r?\n/).slice(1).map((b) => b.split(/\r?\n/));
  const at = blocks.find((lines) => lines.includes(`branch refs/heads/${branch}`))?.find((line) => line.startsWith("worktree "));
  return at ? path.resolve(at.slice("worktree ".length)) : null;
}

// `dir` known to Orca as a project, added when it isn't: the problem, else null.
export async function inOrca(orca: RunOrca, dir: string): Promise<string | null> {
  const shown = await orca(["repo", "show", "--repo", `path:${dir}`]);
  if (shown.ok) return null;
  if (shown.code !== "repo_not_found") return `Orca couldn't be asked about ${dir}: ${shown.error}`;
  const added = await orca(["repo", "add", "--path", dir]);
  return added.ok ? null : `Orca couldn't add ${dir}: ${added.error}`;
}

/**
 * The worktree for a take into Orca, or for a start from the floor on a branch (runner/checkouts.ts):
 * made by Orca, on `branch` from the remote's, fetched already, named `made.name`, when this machine
 * has no worktree on it, no local branch of its name and no core.hooksPath in the clone; else
 * `otherwise`'s (for a take, its own, worktreeFor), given the worktree already on the branch, which
 * Orca finds by its path. Either way the clone is a repo in Orca, added when it isn't.
 */
export async function orcaWorktree(
  orca: RunOrca,
  run: RunGit,
  clone: { dir: string; remote: string },
  branch: string,
  made: { name: string; comment: string },
  otherwise: (existing: string | null) => Promise<string | { error: string }>,
  timeoutMs: number,
): Promise<string | { error: string }> {
  const git = (args: string[], cwd = clone.dir) => run(args, { cwd, timeoutMs });
  const unknown = await inOrca(orca, clone.dir);
  if (unknown) return { error: unknown };
  const existing = await worktreeOn(run, clone.dir, branch, timeoutMs);
  const local = (await git(["rev-parse", "--verify", "-q", `refs/heads/${branch}`])).code === 0;
  const hooks = (await git(["config", "--get", "core.hooksPath"])).code === 0;
  if (!existing && !local && !hooks) {
    const created = await orca(["worktree", "create", "--repo", `path:${clone.dir}`, "--name", made.name, "--branch", branch, "--base-branch", `${clone.remote}/${branch}`, "--no-parent", "--setup", "skip", "--comment", made.comment]);
    if (!created.ok) return { error: `Orca couldn't make the worktree for ${branch}: ${created.error}` };
    const at = (created.result.worktree as { path?: unknown } | undefined)?.path;
    if (typeof at !== "string") return { error: "Orca made a worktree but didn't say where." };
    const dir = path.resolve(at);
    const head = (await git(["rev-parse", "--abbrev-ref", "HEAD"], dir)).stdout.trim();
    if (head !== branch) return { error: `Orca made ${dir} on ${head || "no branch"}, not ${branch}, so nothing was opened there.` };
    const tip = await resolved(run, clone.dir, `refs/remotes/${clone.remote}/${branch}`, timeoutMs);
    if (!tip || (await resolved(run, dir, "HEAD", timeoutMs)) !== tip) return { error: `Orca made ${dir}, but not at ${branch} as it is on ${clone.remote} now, so nothing was opened there.` };
    const tracked = await git(["branch", `--set-upstream-to=${clone.remote}/${branch}`, branch], dir);
    return tracked.code === 0 ? dir : { error: `${branch} in ${dir} couldn't be set to track ${clone.remote}/${branch}:\n${tracked.stderr}` };
  }
  const dir = await otherwise(existing);
  if (typeof dir !== "string") return dir;
  const seen = await orca(["worktree", "show", "--worktree", `path:${dir}`]);
  return seen.ok ? dir : { error: `Orca doesn't see ${dir} as a worktree of ${clone.dir}: ${seen.error}` };
}
