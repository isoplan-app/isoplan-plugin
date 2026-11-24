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
// - it isn't the runner itself, or a process above it (the desktop app that runs it).
// Any other process in the folder is left as it is and logged as left: one whose environment can't be
// read (a 32-bit one on Windows, say) is never ended by its name or command alone. Each one ended, and
// each one left, is a line in runner.log.

import { spawnSync } from "node:child_process";
import { pathKey } from "../data-layer/git.js";
import { commandPaths, listProcesses, type Proc } from "./processes.js";

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

export interface EndStraysOptions {
  log: (text: string) => void;
  list?: () => Promise<Proc[] | null>;
  end?: (pid: number) => boolean;
  self?: number;
  platform?: NodeJS.Platform;
}

/** Ends what the removed session `session` left running in `folder`, as chooseStrays decides, logging each one ended or left. */
export async function endStrays(session: string, folder: string, { log, list = () => listProcesses(), end = (pid) => endPid(pid), self = process.pid, platform = process.platform }: EndStraysOptions): Promise<void> {
  const procs = await list();
  if (procs === null) return log(`couldn't list this computer's processes, so nothing ${session} left running in ${folder} was ended`);
  const { end: ending, left } = chooseStrays(procs, { session, folder, self, platform });
  for (const p of ending) log(end(p.pid) ? `ended ${p.name} (${p.pid}), which ${session} left running in ${folder}` : `couldn't end ${p.name} (${p.pid}), which ${session} left running in ${folder}: it may have ended already`);
  for (const { proc, why } of left) log(`left ${proc.name} (${proc.pid}) running in ${folder} when ${session} was removed: ${why}`);
}
