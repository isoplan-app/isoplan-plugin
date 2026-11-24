// Ending a removed driven session's stray processes (#144): when a session started from the floor is
// ended and removed (from the floor, or the desktop app's End and remove), killTree has ended its
// process and what is still under it, but not what it started that outlived its parent: a dev server,
// a watcher, a shell. Those are ended here, and only those Isoplan can prove it started for that
// session. A process is ended only when all of these hold:
// - its environment was read and its ISOPLAN_SESSION is that session's id. The runner gives a driven
//   session's process that variable (session.ts), and every process under it inherits it, also after
//   its parent has ended; nothing else sets it, and forks and other processes the runner starts are
//   started without it (FORK_ENV_DROPPED);
// - its working folder, or a path in its command line, is in the session's folder;
// - it is this user's: processes.ts lists only this user's (Windows: this logon session's, whose
//   memory it could read; macOS: `ps -U`);
// - it isn't the runner itself, or a process above it (the desktop app that runs it);
// - just before it is ended, it is still the process that was listed: the same pid, started at the
//   same time, still carrying the session's marker (endIfSame). On Windows that check and the end go
//   through one handle to the process, so a pid reused in between can't be ended; on macOS ps is asked
//   again for that pid alone, and the process is signalled straight after. One that can't be checked
//   again is left.
// Any other process in the folder is left as it is and logged as left: one whose environment can't be
// read (a 32-bit one on Windows, say) is never ended by its name or command alone. Each one ended, and
// each one left, is a line in runner.log.

import { spawnSync } from "node:child_process";
import { pathKey } from "../data-layer/git.js";
import { commandPaths, CWD_HELPER, listProcesses, parsePsMarkers, runHidden, type Proc, type Run } from "./processes.js";
import { parsePsInfo } from "./registry.js";

/** Whether `p` is `folder` or in it. */
export function inFolder(p: string, folder: string): boolean {
  const key = pathKey(p);
  const root = pathKey(folder).replace(/\/+$/, "");
  return key === root || key.startsWith(root + "/");
}

export interface StrayChoice {
  /** The processes Isoplan started for the session, in its folder: to end. */
  end: Proc[];
  /** The others in the folder, or the session's own outside it, each with why it is left. */
  left: { proc: Proc; why: string }[];
}

/** Which of `procs` to end for the removed session `session` in `folder`, and which are left and why. Pure. */
export function chooseStrays(procs: Proc[], { session, folder, self, platform = process.platform }: { session: string; folder: string; self: number; platform?: NodeJS.Platform }): StrayChoice {
  const byPid = new Map(procs.map((p) => [p.pid, p]));
  // The runner and every process above it: never ended.
  const kept = new Set<number>([self]);
  for (let p = byPid.get(self); p; ) {
    // A parent pid reused since is another process.
    const parent = byPid.get(p.ppid);
    if (!parent || kept.has(parent.pid) || parent.startMs > p.startMs) break;
    kept.add(parent.pid);
    p = parent;
  }
  const here = (p: Proc) => (p.cwd !== undefined && inFolder(p.cwd, folder)) || commandPaths(p.command, platform).some((c) => inFolder(c, folder));
  const choice: StrayChoice = { end: [], left: [] };
  for (const p of procs) {
    const ours = p.marker === session;
    if (!here(p)) {
      if (ours && !kept.has(p.pid)) choice.left.push({ proc: p, why: "Isoplan started it for this session, but it runs outside the session's folder" });
      continue;
    }
    if (kept.has(p.pid)) choice.left.push({ proc: p, why: "it is Isoplan's runner, or the app that runs it" });
    else if (ours) choice.end.push(p);
    else if (p.marker === undefined) choice.left.push({ proc: p, why: "its environment couldn't be read, so it can't be told whether Isoplan started it" });
    else if (p.marker === "") choice.left.push({ proc: p, why: "Isoplan didn't start it" });
    else choice.left.push({ proc: p, why: "another of Isoplan's sessions started it" });
  }
  return choice;
}

/** Ends the process `pid` alone, not what it started: each of those is ended for itself, if it carries the marker. */
export function endPid(pid: number, platform = process.platform): boolean {
  if (platform === "win32") return spawnSync("taskkill", ["/pid", String(pid), "/F"], { windowsHide: true, stdio: "ignore" }).status === 0;
  try {
    process.kill(pid, "SIGKILL");
    return true;
  } catch {
    return false;
  }
}

/** What endIfSame did with a process: ended it; left it as it isn't the one listed any more; left it as it couldn't be checked; or couldn't end it. */
export type EndOutcome = "ended" | "changed" | "unknown" | "failed";

// How far apart two readings of one process's start may be on macOS, where ps gives it only as the
// seconds since it started.
const PS_START_SLACK_MS = 2000;

// On Windows, a process checked and ended through one handle: its start (GetProcessTimes' creation
// time, in ms since the epoch, as Win32_Process's CreationDate gave it) and its ISOPLAN_SESSION
// (IsoplanCwd.MarkerOf) must match before TerminateProcess. 0x0411: terminate, query information,
// read memory.
const END_HELPER = [
  "public static class IsoplanEnd {",
  '[DllImport("kernel32.dll")] static extern IntPtr OpenProcess(int access, bool inherit, int pid);',
  '[DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);',
  '[DllImport("kernel32.dll")] static extern bool GetProcessTimes(IntPtr h, out long create, out long exit, out long kernel, out long user);',
  '[DllImport("kernel32.dll")] static extern bool TerminateProcess(IntPtr h, uint code);',
  "public static string If(int pid, long startMs, string marker) {",
  'IntPtr h = OpenProcess(0x0411, false, pid); if (h == IntPtr.Zero) return "unknown";',
  "try {",
  'long c, e, k, u; if (!GetProcessTimes(h, out c, out e, out k, out u)) return "unknown";',
  'if (Math.Abs((c - 116444736000000000L) / 10000 - startMs) > 1) return "changed";',
  'var m = IsoplanCwd.MarkerOf(h); if (m == null) return "unknown"; if (m != marker) return "changed";',
  'return TerminateProcess(h, 1) ? "ended" : "failed";',
  "} finally { CloseHandle(h); } } }",
].join(" ");

/** The hidden PowerShell call that checks and ends each of `procs` for `session`; null when the session's id can't be put in it as it is. */
export function endCommand(procs: Proc[], session: string): string[] | null {
  if (!/^[\w:.-]+$/.test(session)) return null;
  const each = procs.map((p) => `@{ pid = ${p.pid}; r = [IsoplanEnd]::If(${p.pid}, ${Math.trunc(p.startMs)}, '${session}') }`).join(", ");
  return ["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", [`Add-Type -TypeDefinition '${CWD_HELPER} ${END_HELPER}'`, `ConvertTo-Json -InputObject @(${each}) -Compress`].join("; ")];
}

/**
 * Ends each of `procs` only if, just before, it is still the process that was listed: the same pid,
 * started then, and still carrying `session`'s marker. Every one it can't check again is "unknown",
 * and left.
 */
export async function endIfSame(procs: Proc[], session: string, { platform = process.platform, run = runHidden, now = Date.now, signal = (pid: number) => process.kill(pid, "SIGKILL") }: { platform?: NodeJS.Platform; run?: Run; now?: () => number; signal?: (pid: number) => void } = {}): Promise<Map<number, EndOutcome>> {
  const out = new Map<number, EndOutcome>(procs.map((p) => [p.pid, "unknown"]));
  if (!procs.length) return out;
  if (platform === "win32") {
    const command = endCommand(procs, session);
    const answer = command && (await run(command));
    let said: unknown;
    try {
      said = JSON.parse(answer ?? "null");
    } catch {
      return out;
    }
    for (const r of Array.isArray(said) ? said : []) if (out.has(r?.pid) && ["ended", "changed", "unknown", "failed"].includes(r?.r)) out.set(r.pid, r.r);
    return out;
  }
  for (const p of procs) {
    const [info, env] = await Promise.all([run(["ps", "-p", String(p.pid), "-o", "etime=,command="]), run(["ps", "-E", "-ww", "-p", String(p.pid), "-o", "pid=,command="])]);
    const seen = parsePsInfo(info ?? "", now());
    if (!seen || env === null) continue;
    if (Math.abs(seen.startMs - p.startMs) > PS_START_SLACK_MS || seen.command !== p.command) {
      out.set(p.pid, "changed");
      continue;
    }
    const marker = parsePsMarkers(env, new Map([[p.pid, p.command]])).get(p.pid);
    if (marker === undefined) continue;
    if (marker !== session) {
      out.set(p.pid, "changed");
      continue;
    }
    try {
      signal(p.pid);
      out.set(p.pid, "ended");
    } catch {
      out.set(p.pid, "failed");
    }
  }
  return out;
}

export interface EndStraysOptions {
  log: (text: string) => void;
  list?: () => Promise<Proc[] | null>;
  end?: (procs: Proc[], session: string) => Promise<Map<number, EndOutcome>>;
  self?: number;
  platform?: NodeJS.Platform;
}

/** Ends what the removed session `session` left running in `folder`, as chooseStrays decides and endIfSame confirms, logging each one ended or left. */
export async function endStrays(session: string, folder: string, { log, list = () => listProcesses(), end = (procs, s) => endIfSame(procs, s), self = process.pid, platform = process.platform }: EndStraysOptions): Promise<void> {
  const procs = await list();
  if (procs === null) return log(`couldn't list this computer's processes, so nothing ${session} left running in ${folder} was ended`);
  const { end: ending, left } = chooseStrays(procs, { session, folder, self, platform });
  const outcomes = await end(ending, session);
  for (const p of ending) {
    const outcome = outcomes.get(p.pid) ?? "unknown";
    const what = `${p.name} (${p.pid})`;
    if (outcome === "ended") log(`ended ${what}, which ${session} left running in ${folder}`);
    else if (outcome === "failed") log(`couldn't end ${what}, which ${session} left running in ${folder}: it may have ended already`);
    else if (outcome === "changed") log(`left ${what} running in ${folder} when ${session} was removed: it isn't the process that was listed any more (its pid was reused, or its environment changed)`);
    else log(`left ${what} running in ${folder} when ${session} was removed: it couldn't be checked again just before it was to be ended`);
  }
  for (const { proc, why } of left) log(`left ${proc.name} (${proc.pid}) running in ${folder} when ${session} was removed: ${why}`);
}
