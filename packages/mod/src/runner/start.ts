// Starting the runner, from the wake hook, install and the plugin's data layer: unless one already
// holds the runner's lock, start the runner wake.json records, detached. Kept free of zod and the
// protocol so the wake hook starts fast.
//
// The supervisor writes `{ pid, code }` into the lock and keeps it fresh every LOCK_REFRESH_MS, so a
// lock not written for RUNNER_FRESH_MS is stale even when its pid is live: after a reboot the pid
// may name another process, which must neither count as the runner nor be killed. `code` names the
// runner.js it runs (its size and write time): a runner running older code than the recorded one
// (a plugin update copied a new one) is stopped and a new one started in its place.
//
// A supervisor that stops for a reason a restart won't mend (the server doesn't want it, it kept
// crashing) leaves a hold-off, `{ pid: 0, until, reason, code }`, which keeps it from starting
// until then.
//
// Once install has put the desktop app in place (src/install/app.ts, recorded in
// runner/desktop-app.json), the app is the runner: its main process is the supervisor and holds the
// same lock, with `engine: "app"` in it (packages/app). Then startRunner opens the app instead of
// starting node, and stops a node runner it finds running, so the machine never runs both. A live
// app counts as running whatever code it runs: it starts its worker again on new code itself.

import { spawn as spawnChild } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { alive, readLock, releaseLock } from "../wake/lock.js";
import { wakeRecordPath } from "../wake/wake.js";
import { recordedEnv } from "./environment.js";

/** The runner's lock: `{ pid, code }` of the supervisor that holds it. */
export const runnerLockPath = (claudeDir: string) => path.join(claudeDir, "isoplan", "runner", "lock.json");

export const LOCK_REFRESH_MS = 30000;
export const RUNNER_FRESH_MS = 3 * LOCK_REFRESH_MS;

/** What names a runner.js's code: its size and write time. Null when it is gone. */
export async function runnerCode(file: string): Promise<string | null> {
  const st = await fs.stat(file).catch(() => null);
  return st && st.isFile() ? `${st.size}-${Math.round(st.mtimeMs)}` : null;
}

/** The live runner's lock: a hold-off that hasn't ended, or a live pid that keeps it fresh. */
async function liveRunner(claudeDir: string, now: number, isAlive: (pid: number) => boolean) {
  const lock = await readLock(runnerLockPath(claudeDir));
  if (!lock) return null;
  if (lock.until !== null && lock.until > now) return { ...lock, isHoldOff: true };
  if (lock.pid !== null && isAlive(lock.pid) && now - lock.mtimeMs < RUNNER_FRESH_MS) return { ...lock, isHoldOff: false };
  return null;
}

/** The desktop app install put in place: its version, its folder (Isoplan.app on macOS) and the program to start. */
export interface DesktopApp {
  version: string;
  dir: string;
  launch: string;
}

export const desktopAppPath = (claudeDir: string) => path.join(claudeDir, "isoplan", "runner", "desktop-app.json");

/** The desktop app install recorded, if its program is still there. */
export async function recordedApp(claudeDir: string): Promise<DesktopApp | null> {
  try {
    const app = JSON.parse(await fs.readFile(desktopAppPath(claudeDir), "utf8")) as Partial<DesktopApp>;
    if (typeof app.version !== "string" || typeof app.dir !== "string" || typeof app.launch !== "string") return null;
    return (await fs.stat(app.launch).catch(() => null))?.isFile() ? (app as DesktopApp) : null;
  } catch {
    return null;
  }
}

/** The lock's holder is the desktop app. */
export const isAppLock = (extra: Record<string, unknown>) => extra.engine === "app";

/**
 * Starts the desktop app for `claudeDir` with no window and no focus, and doesn't wait for it: on
 * macOS through `open -g`, so it starts as an app of its own and stays in the background.
 */
export function openApp(app: DesktopApp, claudeDir: string, platform: NodeJS.Platform = process.platform): void {
  const [file, args] = platform === "darwin" ? ["/usr/bin/open", ["-g", app.dir, "--args", "--claude-dir", claudeDir]] : [app.launch, ["--claude-dir", claudeDir]];
  spawnChild(file, args, { cwd: claudeDir, detached: true, stdio: "ignore", windowsHide: true }).on("error", () => {}).unref();
}

export interface StartOptions {
  claudeDir: string;
  /** Starts `node <args>` in `cwd`, detached, with `env` (else this process's), and doesn't wait for it. */
  spawn(args: string[], cwd: string, env?: Record<string, string>): void;
  isAlive?: (pid: number) => boolean;
  kill?: (pid: number) => void;
  now?: () => number;
  /** Starts the desktop app (openApp). */
  open?: (app: DesktopApp, claudeDir: string) => void;
}

/**
 * What startRunner did: `started` one; found one `running` the recorded code; found the runner
 * `held-off` (the server didn't want it, or it kept crashing); or found none `installed` to start.
 */
export type Started = "started" | "running" | "held-off" | "not-installed";

/**
 * Starts the recorded runner unless a live one runs the recorded code. One on older code is
 * replaced. A hold-off keeps it from starting, except a crash loop's hold-off on older code: a new
 * version may have fixed what crashed. With the desktop app recorded it opens the app instead,
 * once no node runner runs, and a live app is running.
 */
export async function startRunner({ claudeDir, spawn, isAlive = alive, kill = (pid) => process.kill(pid), now = Date.now, open = openApp }: StartOptions): Promise<Started> {
  let runner: unknown;
  try {
    runner = (JSON.parse(await fs.readFile(wakeRecordPath(claudeDir), "utf8")) as { runner?: unknown }).runner;
  } catch {
    return "not-installed";
  }
  if (typeof runner !== "string") return "not-installed";
  const code = await runnerCode(runner);
  if (!code) return "not-installed";
  const lockFile = runnerLockPath(claudeDir);
  const app = await recordedApp(claudeDir);
  const live = await liveRunner(claudeDir, now(), isAlive);
  if (live?.isHoldOff) {
    if (live.extra.reason !== "gave-up" || live.extra.code === code) return "held-off";
    // Taken out only if it is still the same hold-off.
    if ((await readLock(lockFile))?.until === live.until) await fs.rm(lockFile, { force: true });
  } else if (live) {
    if (isAppLock(live.extra) || (live.extra.code === code && !app)) return "running";
    await stopRunner(claudeDir, { isAlive, kill, now, expect: { pid: live.pid!, code: live.extra.code } });
  }
  if (app) {
    open(app, claudeDir);
    return "started";
  }
  // The config folder goes with it, so the runner uses the one its starter found, whatever its
  // environment says. The environment is the one install recorded (environment.ts), never this
  // session's; without one the runner inherits it, and says so in its log.
  const env = await recordedEnv(claudeDir);
  spawn([runner, "--claude-dir", claudeDir, ...(env ? [] : ["--inherited-env"])], claudeDir, env ?? undefined);
  return "started";
}

/**
 * Ends the running runner, for uninstall and updates: its worker and forks follow once its
 * supervisor has gone. True when one was running. A stale lock's pid is never killed. With
 * `expect`, only the runner judged outdated is: if the lock names another pid or code by now
 * (another starter replaced it already), it is left.
 */
export async function stopRunner(
  claudeDir: string,
  { isAlive = alive, kill = (pid: number) => process.kill(pid), now = Date.now, expect }: Omit<StartOptions, "claudeDir" | "spawn"> & { expect?: { pid: number; code: unknown } } = {},
): Promise<boolean> {
  const live = await liveRunner(claudeDir, now(), isAlive);
  if (!live || live.isHoldOff || live.pid === null) return false;
  if (expect && (live.pid !== expect.pid || live.extra.code !== expect.code)) return false;
  try {
    kill(live.pid);
  } catch {
    // Gone already.
  }
  await releaseLock(runnerLockPath(claudeDir), live.pid);
  return true;
}

/**
 * Makes the runner use the config folder `--claude-dir` names, whatever it inherited: the default
 * ~/.claude takes CLAUDE_CONFIG_DIR away (Claude Code then looks there, and for ~/.claude.json);
 * any other folder is set as CLAUDE_CONFIG_DIR, for the runner and its forks.
 */
export function applyClaudeDir(argv: string[], env: Record<string, string | undefined>, home: string): void {
  const i = argv.indexOf("--claude-dir");
  const dir = i >= 0 ? argv[i + 1] : undefined;
  if (!dir || dir.startsWith("--")) return;
  if (path.resolve(dir) === path.resolve(home, ".claude")) delete env.CLAUDE_CONFIG_DIR;
  else env.CLAUDE_CONFIG_DIR = dir;
}
