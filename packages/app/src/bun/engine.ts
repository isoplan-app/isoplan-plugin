// The app's engine: the runner's supervisor, in the app's main process (ADR 0007, 8 Nov update). It
// is the supervisor of packages/mod/src/runner/main.ts, not a copy of it: the same lock, the same
// `supervise` loop with its backoff and crash-loop hold-off, the same worker. The worker is the
// runner copy the plugin's install keeps up to date (wake.json's `runner`), run on the app's own Bun,
// so a plugin update reaches the app without a new app release: its new code is seen within a lock
// refresh and the worker starts again on it.
//
// Taking the lock, the engine stops a node runner that holds it, so the machine never runs both; a
// lock held by another app means one runs already, and this one ends. `engine: "app"` in the lock
// tells startRunner (src/runner/start.ts) that a live app is the runner.
//
// Pause stops the worker and keeps the lock, so nothing reports and nothing else starts a runner;
// resume starts it again. Quit stops the worker and lets the lock go.

import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import { recordedEnv } from "../../../mod/src/runner/environment.js";
import { supervise, type Stopped } from "../../../mod/src/runner/lifecycle.js";
import { isAppLock, LOCK_REFRESH_MS, RUNNER_FRESH_MS, runnerCode, runnerLockPath, stopRunner } from "../../../mod/src/runner/start.js";
import { alive, HOLD_OFF_MS, holdOff, readLock, refreshLock, releaseLock, takeLock } from "../../../mod/src/wake/lock.js";
import { wakeRecordPath } from "../../../mod/src/wake/wake.js";

export interface Worker {
  /** Its exit code, or null for a signal. */
  exited: Promise<number | null>;
  kill(): void;
}

/** Starts the runner's worker: this process's runtime on `script`, its stdin held open, as the runner's own supervisor does. */
export function spawnWorker(script: string, args: string[], cwd: string, env: Record<string, string> | undefined, log: (text: string) => void): Worker {
  const child = spawn(process.execPath, [script, ...args], { cwd, env, stdio: ["pipe", "ignore", "pipe"], windowsHide: true });
  let stderr = "";
  child.stderr?.setEncoding("utf8").on("data", (piece: string) => (stderr = (stderr + piece).slice(-4000)));
  const exited = new Promise<number | null>((resolve) => {
    child.on("error", (err) => (log(`couldn't start the runner's worker: ${err.message}`), resolve(1)));
    child.on("close", (code) => {
      if (stderr.trim()) log(`the runner's worker wrote: ${stderr.trim()}`);
      resolve(code);
    });
  });
  return { exited, kill: () => void child.kill() };
}

export type EngineState = "starting" | "running" | "paused" | "stopped";

/** Why the engine ended: the supervisor's reason, or it never held the lock. */
export type Ended = Stopped | "quit" | "taken" | "busy" | "held-off" | "not-installed";

export interface EngineOptions {
  claudeDir: string;
  /** The app's version, written into the lock. */
  version: string;
  log(text: string): void;
  spawn?: (script: string, args: string[], cwd: string, env: Record<string, string> | undefined) => Worker;
  isAlive?: (pid: number) => boolean;
  kill?: (pid: number) => void;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /** How long to wait for a node runner it stopped to exit. */
  exitMs?: number;
  refreshMs?: number;
  /** Told whenever the state changes. */
  onChange?: () => void;
  pid?: number;
}

export interface Engine {
  state(): EngineState;
  pause(): void;
  resume(): void;
  /** Stops the worker, lets the lock go and ends. */
  quit(): Promise<Ended>;
  ended: Promise<Ended>;
}

export function startEngine(o: EngineOptions): Engine {
  const now = o.now ?? Date.now;
  const isAlive = o.isAlive ?? alive;
  const sleep = o.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const pid = o.pid ?? process.pid;
  const lock = runnerLockPath(o.claudeDir);
  let state: EngineState = "starting";
  let worker: Worker | null = null;
  // The worker was stopped on purpose (pause, new code, quit), not crashed.
  let interrupted = false;
  let quitting = false;
  let resumed: (() => void) | null = null;
  let refresh: ReturnType<typeof setInterval> | undefined;
  let taken: (() => void) | null = null;
  const set = (to: EngineState) => {
    if (state === to) return;
    state = to;
    o.onChange?.();
  };
  const stopWorker = () => {
    interrupted = true;
    worker?.kill();
    resumed?.();
  };

  async function run(): Promise<Ended> {
    let runner: unknown;
    try {
      runner = (JSON.parse(await fs.readFile(wakeRecordPath(o.claudeDir), "utf8")) as { runner?: unknown }).runner;
    } catch {
      runner = null;
    }
    let code = typeof runner === "string" ? await runnerCode(runner) : null;
    if (typeof runner !== "string" || !code) {
      o.log("the app found no runner to run: the plugin's install puts it in place");
      return "not-installed";
    }
    const script = runner;
    const extra = () => ({ code, engine: "app", version: o.version });
    // The lock, from a node runner that holds it if need be.
    for (let tries = 0; ; tries++) {
      if (await takeLock(lock, pid, isAlive, false, now(), { freshMs: RUNNER_FRESH_MS, extra: extra() }).catch(() => false)) break;
      const held = await readLock(lock);
      if (held?.until && held.until > now()) return "held-off";
      if (held?.pid && isAppLock(held.extra)) return "busy";
      if (tries >= 2) return "busy";
      const node = held?.pid;
      if (node && (await stopRunner(o.claudeDir, { isAlive, now, ...(o.kill && { kill: o.kill }) }))) {
        o.log(`the app stopped the node runner ${node}, to be the runner itself`);
        for (const until = now() + (o.exitMs ?? 10000); isAlive(node) && now() < until; ) await sleep(100);
      }
    }
    if (quitting) {
      await releaseLock(lock, pid).catch(() => {});
      return "quit";
    }
    o.log(`the app ${pid} is the runner`);
    const lost = new Promise<"taken">((resolve) => (taken = () => resolve("taken")));
    refresh = setInterval(() => {
      void (async () => {
        if (!(await refreshLock(lock, pid))) {
          o.log(`the app ${pid} stopped: another runner took its lock`);
          quitting = true;
          stopWorker();
          taken?.();
          return;
        }
        // A plugin update copied new runner code: the worker starts again on it.
        const fresh = await runnerCode(script);
        if (fresh && fresh !== code) {
          code = fresh;
          await takeLock(lock, pid, isAlive, false, now(), { freshMs: RUNNER_FRESH_MS, extra: extra() }).catch(() => false);
          o.log("the runner's code changed: its worker starts again on it");
          if (worker) stopWorker();
        }
      })().catch(() => {});
    }, o.refreshMs ?? LOCK_REFRESH_MS);
    const env = (await recordedEnv(o.claudeDir)) ?? undefined;
    if (!env) o.log("no environment is recorded for the runner, so it runs with the app's; run the plugin's install script to record one");
    const spawnOne = o.spawn ?? ((s, args, cwd, e) => spawnWorker(s, args, cwd, e, o.log));
    const stopped = supervise({
      log: o.log,
      sleep,
      now,
      run: async () => {
        for (;;) {
          if (quitting) return 0;
          if (state === "paused") await new Promise<void>((r) => (resumed = r));
          resumed = null;
          if (quitting) return 0;
          interrupted = false;
          worker = spawnOne(script, ["--claude-dir", o.claudeDir, "--worker"], o.claudeDir, env);
          if (state !== "paused") set("running");
          const exit = await worker.exited;
          worker = null;
          if (quitting) return 0;
          if (!interrupted) return exit;
        }
      },
    });
    const ended = await Promise.race([stopped, lost]);
    clearInterval(refresh);
    if (ended === "taken") {
      await stopped;
      return "taken";
    }
    if (quitting) {
      await releaseLock(lock, pid).catch(() => {});
      return "quit";
    }
    if (ended === "done" || ended === "unpaired") await releaseLock(lock, pid).catch(() => {});
    else await holdOff(lock, pid, now() + HOLD_OFF_MS, { reason: ended, code, engine: "app" }).catch(() => {});
    return ended;
  }

  const ended = run().then((why) => (set("stopped"), why));
  return {
    state: () => state,
    pause() {
      if (state !== "running") return;
      set("paused");
      o.log("paused: the runner stops reporting until it is resumed");
      stopWorker();
    },
    resume() {
      if (state !== "paused") return;
      set("running");
      o.log("resumed");
      resumed?.();
    },
    async quit() {
      quitting = true;
      stopWorker();
      return ended;
    },
    ended,
  };
}
