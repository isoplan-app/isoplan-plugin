import fs from "node:fs";
import path from "node:path";
import { expect, test } from "vitest";
import { NOW, line, session, tempRoot, touch } from "../data-layer/fixture.js";
import { nodeIo } from "../data-layer/io.js";
import { holdOff, lockHolder, refreshLock, takeLock } from "../wake/lock.js";
import { wakeRecordPath } from "../wake/wake.js";
import { anyRoomSince, askableMs, MAX_FAST_FAILURES, NOT_WANTED_CODE, onEscapes, supervise, UNPAIRED_CODE } from "./lifecycle.js";
import { errorText } from "./scan.js";
import { appCommand, applyClaudeDir, desktopAppPath, RUNNER_FRESH_MS, runnerCode, runnerLockPath, startRunner, stopRunner, type DesktopApp } from "./start.js";

const OTHER = 4242; // a pid that isn't this process

async function machine({ runner = true } = {}) {
  const claudeDir = path.join(tempRoot(), ".claude");
  const runnerJs = path.join(claudeDir, "isoplan", "runner", "app", "dist", "runner.mjs");
  fs.mkdirSync(path.dirname(runnerJs), { recursive: true });
  fs.writeFileSync(runnerJs, "// v1");
  fs.writeFileSync(wakeRecordPath(claudeDir), JSON.stringify(runner ? { dataLayer: "x", runner: runnerJs } : { dataLayer: "x" }));
  const spawned: { args: string[]; cwd: string }[] = [];
  const killed: number[] = [];
  const lock = runnerLockPath(claudeDir);
  const opts = (isAlive: (pid: number) => boolean = () => true) => ({ claudeDir, spawn: (args: string[], cwd: string) => spawned.push({ args, cwd }), isAlive, kill: (pid: number) => killed.push(pid) });
  const start = (isAlive?: (pid: number) => boolean) => startRunner(opts(isAlive));
  // A supervisor's lock, as main.ts takes it: its pid and the code it runs.
  const hold = async (pid: number) => takeLock(lock, pid, () => false, false, Date.now(), { extra: { code: await runnerCode(runnerJs) } });
  return { claudeDir, runnerJs, spawned, killed, start, lock, hold, opts };
}

test("one runner: started when none holds the lock, not while one lives; a dead one's lock is taken over", async () => {
  const m = await machine();
  expect(await m.start()).toBe("started");
  expect(m.spawned).toEqual([{ args: [m.runnerJs, "--claude-dir", m.claudeDir, "--inherited-env"], cwd: m.claudeDir }]);
  expect(await m.hold(OTHER)).toBe(true);
  expect(await takeLock(m.lock, OTHER + 1, () => true)).toBe(false);
  expect(await m.start(() => true)).toBe("running");
  // It crashed hard and left its lock: the next start takes over.
  expect(await m.start(() => false)).toBe("started");
  expect(await takeLock(m.lock, OTHER + 1, () => false)).toBe(true);
  expect(await lockHolder(m.lock)).toBe(OTHER + 1);
  expect(m.spawned).toHaveLength(2);
  expect(m.killed).toEqual([]);
});

test("one runner: of two starters taking a stale lock at once, exactly one wins", async () => {
  const m = await machine();
  for (let round = 0; round < 30; round++) {
    fs.writeFileSync(m.lock, JSON.stringify({ pid: OTHER }));
    const won = await Promise.all([OTHER + 1, OTHER + 2, OTHER + 3].map((pid) => takeLock(m.lock, pid, (p) => p !== OTHER)));
    expect(won.filter(Boolean)).toHaveLength(1);
    expect(await lockHolder(m.lock)).toBe([OTHER + 1, OTHER + 2, OTHER + 3][won.indexOf(true)]);
  }
  expect(fs.readdirSync(path.dirname(m.lock))).toEqual(["app", "lock.json"]);
});

test("one runner: a lock not kept fresh is stale though its pid is live, so a reused pid is neither the runner nor killed", async () => {
  const m = await machine();
  await m.hold(OTHER);
  const old = new Date(Date.now() - RUNNER_FRESH_MS - 1000);
  fs.utimesSync(m.lock, old, old);
  expect(await stopRunner(m.claudeDir, m.opts())).toBe(false);
  expect(m.killed).toEqual([]);
  expect(await m.start()).toBe("started");
  // The runner keeps its lock fresh, and then it counts again.
  expect(await refreshLock(m.lock, OTHER)).toBe(true);
  expect(await refreshLock(m.lock, OTHER + 1)).toBe(false);
  expect(await m.start()).toBe("running");
});

test("one runner: a runner on older code is stopped and a new one started; uninstall stops one and clears its lock", async () => {
  const m = await machine();
  await m.hold(OTHER);
  expect(await m.start()).toBe("running");
  fs.writeFileSync(m.runnerJs, "// v2, from a plugin update");
  expect(await m.start()).toBe("started");
  expect(m.killed).toEqual([OTHER]);
  expect(fs.existsSync(m.lock)).toBe(false);
  expect(m.spawned).toHaveLength(1);

  await m.hold(OTHER + 1);
  expect(await stopRunner(m.claudeDir, m.opts())).toBe(true);
  expect(m.killed).toEqual([OTHER, OTHER + 1]);
  expect(await stopRunner(m.claudeDir, m.opts())).toBe(false);
});

test("one engine: with the desktop app installed it is opened in place of node, a node runner running is stopped first, and a live app is running whatever code it runs", async () => {
  const m = await machine();
  const launch = path.join(m.claudeDir, "app", "bin", "launcher.exe");
  fs.mkdirSync(path.dirname(launch), { recursive: true });
  fs.writeFileSync(launch, "");
  const app: DesktopApp = { version: "0.1.0", dir: path.dirname(path.dirname(launch)), launch };
  fs.writeFileSync(desktopAppPath(m.claudeDir), JSON.stringify(app));
  const opened: { app: DesktopApp; claudeDir: string }[] = [];
  const start = (isAlive: (pid: number) => boolean = () => true) => startRunner({ ...m.opts(isAlive), open: (a, claudeDir) => opened.push({ app: a, claudeDir }) });

  // A node runner on the current code runs: it is stopped, and the app opened.
  await m.hold(OTHER);
  expect(await start()).toBe("started");
  expect(m.killed).toEqual([OTHER]);
  expect(opened).toEqual([{ app, claudeDir: m.claudeDir }]);
  expect(m.spawned).toEqual([]);

  // The app holds the lock: running, on a plugin update's new code too.
  await takeLock(m.lock, OTHER + 1, () => false, false, Date.now(), { extra: { code: await runnerCode(m.runnerJs), engine: "app" } });
  fs.writeFileSync(m.runnerJs, "// v2, from a plugin update");
  expect(await start()).toBe("running");
  expect(m.killed).toEqual([OTHER]);
  expect(opened).toHaveLength(1);

  // The app's program gone, node runs again.
  fs.rmSync(launch);
  expect(await start(() => false)).toBe("started");
  expect(m.spawned).toHaveLength(1);
  expect(opened).toHaveLength(1);
});

test("one engine: the app is started hidden with its config folder in CLAUDE_CONFIG_DIR, which its launcher passes on where arguments aren't", () => {
  const home = path.resolve("/home/me");
  const app: DesktopApp = { version: "0.1.0", dir: "/home/me/Applications/Isoplan.app", launch: "/home/me/Applications/Isoplan.app/Contents/MacOS/launcher" };
  const env = { PATH: "/bin", CLAUDE_CONFIG_DIR: "/elsewhere" };
  expect(appCommand(app, path.join(home, ".claude"), "darwin", env, home)).toEqual({ file: "/usr/bin/open", args: ["-g", app.dir], env: { PATH: "/bin" } });
  const other = path.join(home, "work-claude");
  expect(appCommand(app, other, "darwin", env, home)).toEqual({ file: "/usr/bin/open", args: ["-g", "--env", `CLAUDE_CONFIG_DIR=${other}`, app.dir], env: { PATH: "/bin", CLAUDE_CONFIG_DIR: other } });
  expect(appCommand({ ...app, launch: "C:/Isoplan/bin/launcher.exe" }, other, "win32", env, home)).toEqual({ file: "C:/Isoplan/bin/launcher.exe", args: [], env: { PATH: "/bin", CLAUDE_CONFIG_DIR: other } });
});

test("one runner: a hold-off keeps it from starting; nothing starts when install recorded no runner, or it is gone", async () => {
  const held = await machine();
  await held.hold(OTHER);
  await holdOff(held.lock, OTHER, Date.now() + 60000);
  expect(await held.start(() => false)).toBe("held-off");
  expect(await stopRunner(held.claudeDir, held.opts())).toBe(false);
  const none = await machine({ runner: false });
  expect(await none.start()).toBe("not-installed");
  const gone = await machine();
  fs.rmSync(gone.runnerJs);
  expect(await gone.start()).toBe("not-installed");
  expect([...held.spawned, ...none.spawned, ...gone.spawned]).toEqual([]);
});

function supervised(codes: (number | null)[], runMs: (run: number) => number = () => 10) {
  let clock = 0;
  let runs = 0;
  const slept: number[] = [];
  const logs: string[] = [];
  const stopped = supervise({
    run: async () => {
      clock += runMs(++runs);
      return codes.length ? codes.shift()! : 1;
    },
    sleep: async (ms) => void slept.push(ms),
    now: () => clock,
    log: (t) => logs.push(t),
  });
  return { stopped, slept, logs, runs: () => runs };
}

test("lifecycle: the supervisor starts a crashed worker again with a backoff, and ends when it exits cleanly", async () => {
  // The third run stays up past a minute, so the crash after it starts the backoff over.
  const s = supervised([1, null, 1, 0], (run) => (run === 3 ? 61000 : 10));
  expect(await s.stopped).toBe("done");
  expect(s.runs()).toBe(4);
  expect(s.slept).toEqual([1000, 2000, 1000]);
  expect(s.logs[1]).toBe("the runner's worker was killed; starting it again in 2 s");
});

test("lifecycle: a worker that keeps dying as it starts is given up on, with the reason logged", async () => {
  const s = supervised([]);
  expect(await s.stopped).toBe("gave-up");
  expect(s.runs()).toBe(MAX_FAST_FAILURES);
  expect(s.logs.at(-1)).toContain(`the ${MAX_FAST_FAILURES}th time in a row within a minute of starting; giving up`);
  expect(await supervised([NOT_WANTED_CODE]).stopped).toBe("not-wanted");
  // A pairing that ended stops it too, without counting as a crash.
  expect(await supervised([UNPAIRED_CODE]).stopped).toBe("unpaired");
});

test("lifecycle: the worker stays while any room is inside its lights-off window", async () => {
  const home = path.join(tempRoot(), "home");
  const projects = path.join(home, ".claude", "projects");
  const p = session(home, "s", [line.user("/repo", "hi")], { age: 3600 });
  const window = askableMs({ lightsOffHours: 24, idleMinutes: 30 });
  expect(window).toBe(24 * 3600000);
  expect(await anyRoomSince(nodeIo(), projects, NOW - window)).toBe(true);
  touch(p, 24 * 3600 + 1);
  expect(await anyRoomSince(nodeIo(), projects, NOW - window)).toBe(false);
  // With lights-off at 0, a room stays askable through its idle window.
  expect(askableMs({ lightsOffHours: 0, idleMinutes: 30 })).toBe(30 * 60000);
  expect(await anyRoomSince(nodeIo(), path.join(home, "missing"), 0)).toBe(false);
});

test("one runner: a starter acting on an old read doesn't stop the runner another starter just put in its place", async () => {
  const m = await machine();
  await m.hold(OTHER);
  const old = { pid: OTHER, code: await runnerCode(m.runnerJs) };
  // Starter A replaces the outdated runner with S1, on new code.
  fs.writeFileSync(m.runnerJs, "// v2");
  expect(await m.start()).toBe("started");
  await m.hold(OTHER + 1);
  // Starter B judged OTHER outdated before that, and only now gets to stop it.
  expect(await stopRunner(m.claudeDir, { ...m.opts(), expect: old })).toBe(false);
  expect(m.killed).toEqual([OTHER]);
  expect(await lockHolder(m.lock)).toBe(OTHER + 1);
});

test("one runner: a crash loop's hold-off keeps it down, until a newer version is installed", async () => {
  const m = await machine();
  await m.hold(OTHER);
  await holdOff(m.lock, OTHER, Date.now() + 3600000, { reason: "gave-up", code: await runnerCode(m.runnerJs) });
  expect(await m.start(() => false)).toBe("held-off");
  fs.writeFileSync(m.runnerJs, "// v2, with the crash fixed");
  expect(await m.start(() => false)).toBe("started");
  expect(fs.existsSync(m.lock)).toBe(false);
  // A server that didn't want the runner keeps it held off, whatever the version.
  await m.hold(OTHER);
  await holdOff(m.lock, OTHER, Date.now() + 3600000, { reason: "not-wanted", code: "old" });
  expect(await m.start(() => false)).toBe("held-off");
});

test("runner: --claude-dir wins over an inherited CLAUDE_CONFIG_DIR", () => {
  const home = path.resolve("/home/ada");
  const env: Record<string, string | undefined> = { CLAUDE_CONFIG_DIR: "/elsewhere" };
  applyClaudeDir(["node", "runner.mjs", "--claude-dir", path.join(home, ".claude")], env, home);
  expect(env).toEqual({});
  applyClaudeDir(["node", "runner.mjs", "--claude-dir", "/custom/claude", "--worker"], env, home);
  expect(env).toEqual({ CLAUDE_CONFIG_DIR: "/custom/claude" });
  applyClaudeDir(["node", "runner.mjs", "--worker"], env, home);
  expect(env).toEqual({ CLAUDE_CONFIG_DIR: "/custom/claude" });
});

test("lifecycle: an error nothing caught is logged, its text checked for secrets; after a rejection the worker goes on, after an exception it exits for the supervisor", async () => {
  const handlers: Record<string, (err: unknown) => void> = {};
  const logs: string[] = [];
  let exits = 0;
  const patterns = [{ name: "GitHub token", regex: /ghp_\w+/ }];
  onEscapes({ on: (event, handler) => (handlers[event] = handler), said: async (err) => errorText(err, patterns), log: (text) => logs.push(text), exit: () => exits++ });
  handlers.unhandledRejection!(new Error("a promise broke"));
  await new Promise((r) => setTimeout(r, 0));
  expect(logs.at(-1)).toMatch(/caught an error nothing else did, and goes on: Error: a promise broke/);
  expect(exits).toBe(0);
  handlers.uncaughtException!(new Error("a handler broke with ghp_secret"));
  await new Promise((r) => setTimeout(r, 0));
  expect(logs.at(-1)).toBe("the runner's worker caught an error nothing else did, so it starts again: (its text is left out: it matches the secret pattern GitHub token)");
  expect(exits).toBe(1);
});
