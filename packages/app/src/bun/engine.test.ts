import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, expect, test } from "vitest";
import { appOpenPath, runnerCode, runnerLockPath, startRunner } from "../../../mod/src/runner/start.js";
import { readLock, takeLock } from "../../../mod/src/wake/lock.js";
import { wakeRecordPath } from "../../../mod/src/wake/wake.js";
import { startEngine, type Worker } from "./engine.ts";

const ME = 5150; // the app's pid in these tests
const NODE = 4242; // a node runner's

const roots: string[] = [];
afterAll(() => roots.forEach((r) => fs.rmSync(r, { recursive: true, force: true, maxRetries: 5 })));

function machine() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "isoplan-app-"));
  roots.push(root);
  const claudeDir = path.join(root, ".claude");
  const runner = path.join(claudeDir, "isoplan", "runner", "app", "dist", "runner.mjs");
  fs.mkdirSync(path.dirname(runner), { recursive: true });
  fs.writeFileSync(runner, "// v1");
  fs.writeFileSync(wakeRecordPath(claudeDir), JSON.stringify({ dataLayer: "x", runner }));
  const workers: { args: string[]; exit: (code: number | null) => void; killed: boolean }[] = [];
  const spawn = (_script: string, args: string[]): Worker => {
    let exit!: (code: number | null) => void;
    const exited = new Promise<number | null>((r) => (exit = r));
    const w = { args, exit, killed: false };
    workers.push(w);
    return { exited, kill: () => ((w.killed = true), exit(null)) };
  };
  const alive = new Set<number>([ME]);
  const killed: number[] = [];
  const logs: string[] = [];
  const start = (refreshMs = 60_000) =>
    startEngine({ claudeDir, version: "0.1.0", log: (t) => logs.push(t), spawn, pid: ME, isAlive: (pid) => alive.has(pid), kill: (pid) => (killed.push(pid), alive.delete(pid)), sleep: async () => {}, refreshMs });
  return { claudeDir, runner, lock: runnerLockPath(claudeDir), workers, alive, killed, logs, start };
}

const settle = () => new Promise((r) => setTimeout(r, 30));

test("engine: the app takes the runner's lock from a node runner, stopping it first, and runs the worker on the plugin's runner copy", async () => {
  const m = machine();
  m.alive.add(NODE);
  await takeLock(m.lock, NODE, () => false, false, Date.now(), { extra: { code: await runnerCode(m.runner) } });
  // startRunner's record that it opened the app goes once the app is the runner.
  fs.writeFileSync(appOpenPath(m.claudeDir), JSON.stringify({ version: "0.1.0", openedAt: Date.now() }));
  const engine = m.start();
  await settle();
  expect(fs.existsSync(appOpenPath(m.claudeDir))).toBe(false);
  expect(m.killed).toEqual([NODE]);
  expect(engine.state()).toBe("running");
  expect(m.workers.map((w) => w.args)).toEqual([["--claude-dir", m.claudeDir, "--worker"]]);
  const lock = await readLock(m.lock);
  expect(lock?.pid).toBe(ME);
  expect(lock?.extra).toEqual({ code: await runnerCode(m.runner), engine: "app", version: "0.1.0" });
  // Now any starter finds it running, and starts nothing beside it.
  const spawned: string[][] = [];
  expect(await startRunner({ claudeDir: m.claudeDir, spawn: (args) => spawned.push(args), isAlive: (pid) => m.alive.has(pid) })).toBe("running");
  expect(spawned).toEqual([]);
  await engine.quit();
});

test("engine: a second app finds the first running and ends without a worker", async () => {
  const m = machine();
  m.alive.add(NODE);
  await takeLock(m.lock, NODE, () => false, false, Date.now(), { extra: { engine: "app" } });
  const engine = m.start();
  expect(await engine.ended).toBe("busy");
  expect(m.workers).toEqual([]);
  expect(m.killed).toEqual([]);
  expect(engine.state()).toBe("stopped");
});

test("engine: quit stops the worker and lets the lock go", async () => {
  const m = machine();
  const engine = m.start();
  await settle();
  expect((await readLock(m.lock))?.pid).toBe(ME);
  expect(await engine.quit()).toBe("quit");
  expect(m.workers).toHaveLength(1);
  expect(m.workers[0]?.killed).toBe(true);
  // A quit is not a crash: nothing was logged as one.
  expect(m.logs.some((l) => l.includes("starting it again"))).toBe(false);
  expect(fs.existsSync(m.lock)).toBe(false);
  expect(engine.state()).toBe("stopped");
});

test("engine: a crashed worker starts again; one that ends cleanly ends the app and its lock", async () => {
  const m = machine();
  const engine = m.start();
  await settle();
  m.workers[0]!.exit(1);
  await settle();
  expect(m.workers).toHaveLength(2);
  m.workers[1]!.exit(0);
  expect(await engine.ended).toBe("done");
  expect(fs.existsSync(m.lock)).toBe(false);
});

test("engine: new runner code from a plugin update starts the worker again on it", async () => {
  const m = machine();
  const engine = m.start(20);
  await settle();
  fs.writeFileSync(m.runner, "// v2, a plugin update");
  for (let i = 0; i < 50 && m.workers.length < 2; i++) await settle();
  expect(m.workers[0]?.killed).toBe(true);
  expect(m.workers).toHaveLength(2);
  expect((await readLock(m.lock))?.extra.code).toBe(await runnerCode(m.runner));
  await engine.quit();
});

test("engine: with no runner copy in place there is nothing to run", async () => {
  const m = machine();
  fs.rmSync(m.runner);
  expect(await m.start().ended).toBe("not-installed");
});
