// What the window of what's running shows (#137): this user's processes by folder, each folder's
// sessions with the processes that belong to each, and the processes there that belong to no session.
// Pure, so it can be tested without a window or real processes. Read-only: nothing is ended (#144).
//
// A process's folder is the git work tree (the nearest folder above holding `.git`) of its working
// folder (processes.ts reads it on both OSes), else of the first path in its command line that is in
// one, for a process whose working folder couldn't be read. One with neither has the folder of the
// nearest process above it that has one. A session's processes are its own process and every process
// under it, all in the session's folder. A session's process is the one the runner started (its pid in
// status.json), else the one Claude Code's own record of the session names (<claude dir>/sessions/<pid>.json),
// believed only when that process started when the record says.

import type { RunnerStatus, SessionSeen } from "../../../mod/src/runner/status.js";
import { SPAWN_MATCH_MS } from "../../../mod/src/runner/registry.js";
import { pathKey } from "../../../mod/src/data-layer/git.js";
import type { Proc } from "./processes.ts";

/** Claude Code's record of a running session: <claude dir>/sessions/<pid>.json. */
export interface ClaudeSessionRecord {
  pid: number;
  sessionId: string;
  startedAt: number;
  /** busy, idle, or another Claude Code word. */
  status?: string;
}

/** A Claude Code session record's text, or null when it isn't one. */
export function parseClaudeSession(text: string): ClaudeSessionRecord | null {
  try {
    const v = JSON.parse(text) as Record<string, unknown>;
    if (!Number.isSafeInteger(v?.pid) || typeof v.sessionId !== "string" || typeof v.startedAt !== "number") return null;
    return { pid: v.pid as number, sessionId: v.sessionId, startedAt: v.startedAt, ...(typeof v.status === "string" && { status: v.status }) };
  } catch {
    return null;
  }
}

export interface ProcessLine {
  pid: number;
  name: string;
  /** Its command with secrets cut out; null when the secret patterns can't be read, so it isn't shown. */
  command: string | null;
  /** When it started, ISO. */
  started: string;
  /** Bytes. */
  memory: number;
  /** What started it: its name when it is among the processes listed; none when it has ended or isn't listed (another user's, an elevated one, or one whose command line can't be read). */
  parent: { pid: number; name?: string };
  /** The name of the session it belongs to; null for one that belongs to no session. */
  session: string | null;
}

export interface SessionLine {
  /** Its id, told apart from another session's with the same id (a fork beside its lead). */
  key: string;
  name: string;
  /** How it runs, in words. */
  how: string;
  /** working or idle, where Claude Code says. */
  state?: string;
  /** Whether its own process was found; when not, its processes can't be told apart from the folder's others. */
  found: boolean;
  processes: ProcessLine[];
}

export interface FolderLine {
  folder: string;
  /** Bytes, of every process in it. */
  memory: number;
  sessions: SessionLine[];
  /** The processes in it that belong to no session. */
  strays: ProcessLine[];
}

export interface RunningView {
  /** Whether the runner lists the sessions with their folders now; when not, every process is shown as belonging to no session. */
  sessionsListed: boolean;
  /** Whether the OS could be asked for the processes. */
  processesListed: boolean;
  folders: FolderLine[];
  /** Bytes, of everything shown. */
  memory: number;
  /** How often the window asks again, from `processRefreshSeconds`. */
  refreshMs: number;
}

export interface RunningInput {
  /** The current worker's status (menu.ts currentStatus); null when the runner isn't running, or hasn't said. */
  status: RunnerStatus | null;
  processes: Proc[] | null;
  claudeSessions: ClaudeSessionRecord[];
  /** The git work tree `path` is in, or null. */
  workTree: (path: string) => string | null;
  /** Which OS's paths a command line holds; this one's by default. */
  platform?: NodeJS.Platform;
  /** The command with secrets cut out, or null when the secret patterns can't be read. */
  cut: (command: string) => string | null;
  refreshMs: number;
}

/** How a session runs, as the window says it. */
export function howItRuns(s: SessionSeen): string {
  if (s.fork) return "a fork answering for its session";
  if (s.close?.startsWith("pid:")) return "a take's first turn";
  if (s.close) return "from the floor";
  if (s.headless) return "headless";
  return "in a terminal or the Claude app";
}

/**
 * The log line for secret patterns the window can't use, from loadPatterns' reasons; "" when there are
 * none. The scan's own line says what it means for answers, briefs and reports, so that part is cut.
 */
export function patternsProblemLine(reasons: string[]): string {
  if (!reasons.length) return "";
  const why = reasons.map((r) => r.replace(", so every answer, brief and report is held", "")).join("; ");
  return `the window of what's running shows no command, as the secret patterns can't be read: ${why}`;
}

const STATE: Record<string, string> = { busy: "working", idle: "idle" };

/**
 * The absolute paths in a command line: quoted or not, and after a flag's `=`. On Windows only a
 * drive's paths, with Git Bash's `/c/...` read as `C:/...`, so cmd's `/c` and `/d` aren't taken for paths.
 */
export function commandPaths(command: string, platform: NodeJS.Platform = process.platform): string[] {
  const asPath = (t: string): string | null => {
    const clean = t.replace(/[;,]+$/, "");
    if (platform !== "win32") return clean.startsWith("/") ? clean : null;
    const bash = /^\/([A-Za-z])(\/.*)$/.exec(clean);
    return bash ? `${bash[1]!.toUpperCase()}:${bash[2]}` : /^[A-Za-z]:[\\/]/.test(clean) ? clean : null;
  };
  const out: string[] = [];
  for (const m of command.matchAll(/(?:"[^"]*"|'[^']*'|[^\s"'])+/g)) {
    const token = m[0].replace(/["']/g, "");
    // A quoted path keeps its spaces; a quoted command (cmd /c "...") is read word by word, and so are
    // the words after the first of one that starts with a path ("C:\tools\bash.exe -c C:\w\x").
    const whole = asPath(token) !== null || asPath(token.slice(token.indexOf("=") + 1)) !== null;
    const words = whole ? [token, ...token.split(/\s+/).slice(1)] : token.split(/\s+/);
    for (const word of words) {
      for (const t of [word, word.slice(word.indexOf("=") + 1)]) {
        const p = asPath(t);
        if (p !== null && !out.includes(p)) out.push(p);
      }
    }
  }
  return out;
}

/**
 * A finder of the git work tree a path is in: the nearest folder at or above it that holds `.git`
 * (a folder in a checkout, a file in a worktree), asking `exists` once per folder.
 */
export function workTreeFinder(exists: (path: string) => boolean, p: { join: (...parts: string[]) => string; dirname: (path: string) => string }): (path: string) => string | null {
  const known = new Map<string, string | null>();
  const find = (dir: string): string | null => {
    const hit = known.get(dir);
    if (hit !== undefined) return hit;
    known.set(dir, null);
    const parent = p.dirname(dir);
    const found = exists(p.join(dir, ".git")) ? dir : parent === dir ? null : find(parent);
    known.set(dir, found);
    return found;
  };
  return find;
}

export function runningView({ status, processes, claudeSessions, workTree, platform = process.platform, cut, refreshMs }: RunningInput): RunningView {
  const procs = processes ?? [];
  const byPid = new Map(procs.map((p) => [p.pid, p]));
  // A process's parent, only if it started before it: a parent pid reused since is another process.
  const parentOf = (p: Proc) => {
    const parent = byPid.get(p.ppid);
    return parent && parent !== p && parent.startMs <= p.startMs ? parent : null;
  };

  // Each session's own process. A runner older than the window lists sessions without their folders: none are shown.
  const listed = !!status?.sessions?.every((s) => typeof s.folder === "string");
  const sessions = listed ? status!.sessions! : [];
  const rootOf = new Map<number, number>();
  sessions.forEach((s, i) => {
    const record = claudeSessions.find((c) => c.sessionId === s.id && Math.abs((byPid.get(c.pid)?.startMs ?? -Infinity) - c.startedAt) <= SPAWN_MATCH_MS);
    const pid = s.pid !== undefined && byPid.has(s.pid) ? s.pid : record?.pid;
    if (pid !== undefined && !rootOf.has(pid)) rootOf.set(pid, i);
  });

  // The session each process belongs to: the nearest session process at or above it.
  const sessionOf = new Map<Proc, number | null>();
  const belongs = (p: Proc, seen = new Set<Proc>()): number | null => {
    if (sessionOf.has(p)) return sessionOf.get(p)!;
    if (seen.has(p)) return null;
    seen.add(p);
    const parent = parentOf(p);
    const s = rootOf.get(p.pid) ?? (parent ? belongs(parent, seen) : null);
    sessionOf.set(p, s);
    return s;
  };

  const sessionFolder = (s: SessionSeen) => workTree(s.folder) ?? s.folder;
  // The folder of a process in no session.
  const folderOf = new Map<Proc, string | null>();
  const placed = (p: Proc, seen = new Set<Proc>()): string | null => {
    if (folderOf.has(p)) return folderOf.get(p)!;
    if (seen.has(p)) return null;
    seen.add(p);
    const own = p.cwd ? workTree(p.cwd) : null;
    let folder = own ?? commandPaths(p.command, platform).map(workTree).find((f) => f !== null) ?? null;
    if (folder === null) {
      const parent = parentOf(p);
      folder = parent ? placed(parent, seen) : null;
    }
    folderOf.set(p, folder);
    return folder;
  };

  const folders = new Map<string, FolderLine>();
  const folderLine = (folder: string) => {
    const key = pathKey(folder);
    let line = folders.get(key);
    if (!line) folders.set(key, (line = { folder, memory: 0, sessions: [], strays: [] }));
    return line;
  };
  const found = new Set(rootOf.values());
  const sessionLines = sessions.map((s, i) => {
    const record = claudeSessions.find((c) => c.sessionId === s.id && rootOf.get(c.pid) === i);
    const state = record?.status ? STATE[record.status] : undefined;
    const key = sessions.filter((o) => o.id === s.id).length > 1 ? `${s.id}:${s.pid ?? i}` : s.id;
    const line: SessionLine = { key, name: s.name, how: howItRuns(s), ...(state && { state }), found: found.has(i), processes: [] };
    folderLine(sessionFolder(s)).sessions.push(line);
    return line;
  });

  const line = (p: Proc, session: string | null): ProcessLine => {
    const parent = parentOf(p);
    return { pid: p.pid, name: p.name, command: cut(p.command), started: new Date(p.startMs).toISOString(), memory: p.memory, parent: { pid: p.ppid, ...(parent && { name: parent.name }) }, session };
  };
  for (const p of [...procs].sort((a, b) => a.startMs - b.startMs || a.pid - b.pid)) {
    const i = belongs(p);
    if (i !== null) {
      const s = sessions[i]!;
      sessionLines[i]!.processes.push(line(p, s.name));
      folderLine(sessionFolder(s)).memory += p.memory;
      continue;
    }
    const folder = placed(p);
    if (folder === null) continue;
    const f = folderLine(folder);
    f.strays.push(line(p, null));
    f.memory += p.memory;
  }

  const list = [...folders.values()].sort((a, b) => a.folder.localeCompare(b.folder));
  for (const f of list) f.sessions.sort((a, b) => a.name.localeCompare(b.name));
  return {
    sessionsListed: listed,
    processesListed: processes !== null,
    folders: list,
    memory: list.reduce((sum, f) => sum + f.memory, 0),
    refreshMs,
  };
}
