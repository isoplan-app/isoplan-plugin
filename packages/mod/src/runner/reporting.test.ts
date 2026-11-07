// The runner reporting every session (reporting.ts, ADR 0007): which sessions it takes and when it
// takes one again, with or without a connected hooks module, with a stand-in for the reporting
// itself; then, with the data layer's own reporting (report-session.ts) and a stand-in office server,
// that a session reaches the office from the runner alone, again at once after a runner restart, and
// is handed over to an earlier version's data layer as it takes the session's lock.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import { WebSocketServer } from "ws";
import { approvedPath } from "../data-layer/approved-file.js";
import type { Config } from "../data-layer/config.js";
import { defaults, modDir, tempRoot } from "../data-layer/fixture.js";
import { nodeIo, type NodeIo } from "../data-layer/io.js";
import type { DataLayerLine } from "../lines.js";
import { hookedEnv, reportSession, sessionLog, takesOver, type Ended, type ReportSessionOptions } from "../data-layer/report-session.js";
import { lockPath } from "../wake/lock.js";
import { watchSessions, type Reporting, type ToReport } from "./reporting.js";

vi.setConfig({ testTimeout: 30000 });

const OTHER = 4242; // a pid that isn't this process
const watching: Reporting[] = [];
const closing: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const w of watching.splice(0)) await w.stop();
  for (const close of closing.splice(0)) await close();
  vi.unstubAllEnvs();
});

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(check: () => boolean, ms = 15000) {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error("timed out");
    await wait(20);
  }
}

const line = (cwd: string | null) => JSON.stringify({ type: "user", ...(cwd && { cwd }), timestamp: new Date().toISOString(), message: { role: "user", content: "hi" } }) + "\n";

/** A config folder with a folder `app`, and a way to write session transcripts in it. */
function machine(settings: Partial<Config> = {}) {
  const root = tempRoot();
  const claudeDir = path.join(root, "claude");
  const repo = path.join(root, "app");
  fs.mkdirSync(repo, { recursive: true });
  // No wait on the first look for hooks modules to say hello, unless a test asks for one.
  const config: Config = { ...defaults, streamSeconds: 0.05, runnerRetrySeconds: 0, ...settings };
  const transcript = (id: string) => path.join(claudeDir, "projects", "-app", `${id}.jsonl`);
  const write = (id: string, cwd: string | null = repo, ageMinutes = 0) => {
    fs.mkdirSync(path.dirname(transcript(id)), { recursive: true });
    fs.appendFileSync(transcript(id), line(cwd));
    const t = new Date(Date.now() - ageMinutes * 60000);
    fs.utimesSync(transcript(id), t, t);
  };
  return { claudeDir, repo, config, transcript, write };
}

/** A connected hooks module, as the runner's pipe gives it. */
type Hooks = { cwd: string; name: string; root?: string; since?: number; env?: Record<string, string> };

/** watchSessions with a stand-in report: each session it starts is kept, and ends when told (or when the runner stops). */
function watch(m: ReturnType<typeof machine>, o: { isOff?: (folder: string) => Promise<boolean>; isAlive?: (pid: number) => boolean; gapMs?: number; io?: NodeIo; hooked?: Map<string, Hooks> } = {}) {
  // The hooks modules told an earlier version's data layer reports their session.
  const told: { id: string; name: string }[] = [];
  const started: { id: string; notWanted: Record<string, number>; hooks?: Hooks; cwd: string; end: (ended?: Ended) => void; stoppedFor?: string }[] = [];
  const report = (s: ToReport<Hooks>) =>
    new Promise<Ended>((resolve) => {
      const entry: (typeof started)[number] = { id: s.sessionId, notWanted: s.notWanted, hooks: s.hooks, cwd: s.cwd, end: (ended = { why: "done" }) => resolve(ended) };
      started.push(entry);
      void s.closed.then((why) => ((entry.stoppedFor = why), resolve({ why: "stopped" })));
    });
  const w = watchSessions({ claudeDir: m.claudeDir, io: o.io ?? nodeIo(), config: async () => m.config, report, isOff: o.isOff ?? (async () => false), log: () => {}, gapMs: o.gapMs ?? 0, ...(o.isAlive && { isAlive: o.isAlive }), ...(o.hooked && { hooked: (id: string) => o.hooked!.get(id) ?? null }), held: (id, hooks) => void told.push({ id, name: hooks.name }) });
  watching.push(w);
  return { w, started, told, ids: () => started.map((s) => s.id) };
}

test("each session written within idleMinutes is reported, once; one whose transcript names no folder yet only once it does", async () => {
  const m = machine();
  m.write("s1");
  m.write("s2", null);
  m.write("not a plain id");
  const { w, ids } = watch(m);
  await until(() => ids().includes("s1"));
  await w.look();
  expect(ids()).toEqual(["s1"]);
  m.write("s2");
  await until(() => ids().includes("s2"));
  expect(w.reporting().sort()).toEqual(["s1", "s2"]);
});

test("a session whose lock another live process keeps fresh isn't reported (the plugin's data layer has it); once that has gone, only once its transcript moves, so a closed session goes unreachable", async () => {
  const m = machine();
  let holderAlive = true;
  fs.mkdirSync(path.dirname(lockPath(m.claudeDir, "s1")), { recursive: true });
  fs.writeFileSync(lockPath(m.claudeDir, "s1"), JSON.stringify({ pid: OTHER, detached: false }));
  m.write("s1");
  const { w, ids } = watch(m, { isAlive: (pid) => pid !== OTHER || holderAlive });
  await w.look();
  await w.look();
  expect(ids()).toEqual([]);
  // The session closes: its data layer lets the lock go.
  holderAlive = false;
  fs.rmSync(lockPath(m.claudeDir, "s1"));
  await w.look();
  await w.look();
  expect(ids()).toEqual([]);
  // Its data layer had crashed, and the session goes on.
  await wait(20);
  m.write("s1");
  await until(() => ids().includes("s1"));
});

test("a session whose hooks module is connected is reported for it at once, however long ago it was written; one that connects, changes or goes stops the report under way, which starts again for the one it has now, and with none only once the transcript moves", async () => {
  const m = machine();
  const hooked = new Map<string, Hooks>();
  m.write("s1", m.repo, 25 * 60); // quiet past lightsOffHours
  m.write("s2");
  const { w, started } = watch(m, { hooked });
  await until(() => started.some((s) => s.id === "s2"));
  await w.look();
  expect(started.map((s) => s.id)).toEqual(["s2"]);

  // The hooks module of s1 connects, in the folder it is in now; and s2's, while the runner reports s2 without one.
  const first: Hooks = { cwd: path.join(m.repo, "sub"), name: "first" };
  hooked.set("s1", first);
  hooked.set("s2", { cwd: m.repo, name: "s2's" });
  w.rehook("s1");
  w.rehook("s2");
  await until(() => started.filter((s) => s.hooks).length === 2);
  expect(started.map((s) => [s.id, s.hooks?.name ?? null])).toEqual([
    ["s2", null],
    ["s1", "first"],
    ["s2", "s2's"],
  ]);
  expect(started[1]!.cwd).toBe(first.cwd);
  // Each report that stopped says why, for its log.
  expect(started[0]!.stoppedFor).toBe("its hooks module connected to the runner, which reports it for that hooks module now");

  // Another window's takes s1: reported again, for that one.
  hooked.set("s1", { cwd: m.repo, name: "later" });
  w.rehook("s1");
  await until(() => started.some((s) => s.hooks?.name === "later"));
  expect(started[1]!.stoppedFor).toBe("another hooks module has the session now (another window, or a reload)");

  // Its hooks module goes: the report stops, and s1 is reported again only once its transcript moves.
  hooked.delete("s1");
  w.rehook("s1");
  await until(() => !w.reporting().includes("s1"));
  expect(started.find((s) => s.hooks?.name === "later")!.stoppedFor).toBe("its hooks module's link to the runner closed");
  await w.look();
  await w.look();
  expect(started.filter((s) => s.id === "s1")).toHaveLength(2);
  await wait(20);
  m.write("s1");
  await until(() => started.filter((s) => s.id === "s1").length === 3);
  expect(started.at(-1)!.hooks).toBeUndefined();
});

test("a hooks module's report that ended by itself starts again only once the transcript moves; while an earlier version's data layer holds the lock, none starts, and once it lets go one starts at the next look, with no write", async () => {
  const m = machine();
  const hooked = new Map<string, Hooks>([["s1", { cwd: m.repo, name: "h" }]]);
  let holderAlive = true;
  fs.mkdirSync(path.dirname(lockPath(m.claudeDir, "s1")), { recursive: true });
  fs.writeFileSync(lockPath(m.claudeDir, "s1"), JSON.stringify({ pid: OTHER, detached: false }));
  m.write("s1");
  const { w, started } = watch(m, { hooked, isAlive: (pid) => pid !== OTHER || holderAlive });
  await w.look();
  await w.look();
  expect(started).toEqual([]);
  holderAlive = false;
  await w.look();
  expect(started).toHaveLength(1);
  expect(started[0]!.hooks?.name).toBe("h");

  started[0]!.end({ why: "the plugin is off here" });
  await until(() => !w.reporting().includes("s1"));
  await w.look();
  await w.look();
  expect(started).toHaveLength(1);
  await wait(20);
  m.write("s1");
  await until(() => started.length === 2);
});

test("a hooks module's report takes the lock over from an earlier version's data layer of another copy, or of its own copy in an earlier window; never from the runner's own or a detached one", async () => {
  const self = path.join(modDir, "dist", "data-layer.js");
  const lock = (extra: Record<string, unknown>) => ({ pid: OTHER, until: null, mtimeMs: Date.now(), extra });
  expect(takesOver(lock({ dataLayer: "C:/cache/isoplan/0.11.1/dist/data-layer.js", detached: false, since: 9 }), self, 1)).toBe(true);
  expect(takesOver(lock({ dataLayer: self, detached: false, since: 1 }), self, 2)).toBe(true);
  expect(takesOver(lock({ dataLayer: self, detached: false, since: 3 }), self, 2)).toBe(false);
  expect(takesOver(lock({ detached: false }), self, 2)).toBe(false);
  expect(takesOver(lock({ dataLayer: "C:/old/dist/data-layer.js", detached: true }), self, 2)).toBe(false);
  expect(takesOver(lock({ dataLayer: "C:/old/dist/data-layer.js", detached: false, runner: true }), self, 2)).toBe(false);

  // The runner starts that report at once, while the earlier one still holds the lock.
  const m = machine();
  fs.mkdirSync(path.dirname(lockPath(m.claudeDir, "s1")), { recursive: true });
  fs.writeFileSync(lockPath(m.claudeDir, "s1"), JSON.stringify({ pid: OTHER, dataLayer: "C:/old/dist/data-layer.js", detached: false, since: 1, parent: OTHER }));
  m.write("s1");
  const hooked = new Map<string, Hooks>([["s1", { cwd: m.repo, name: "h", root: modDir, since: 2 }]]);
  const { started } = watch(m, { hooked, isAlive: () => true });
  await until(() => started.length === 1);
  expect(started[0]!.hooks?.name).toBe("h");
});

test("an outdated hooks module (a newer copy is installed for its session) doesn't take the lock over, so the runner starts no report for it while an earlier version's data layer holds it, as the report itself wouldn't", async () => {
  const m = machine();
  const plugins = path.join(tempRoot(), "plugin-cache");
  const copyOf = (version: string) => {
    const folder = path.join(plugins, "cache", "isoplan", "isoplan", version);
    for (const file of ["dist/data-layer.js", "dist/wake.js", "dist/hooks.js"]) {
      fs.mkdirSync(path.dirname(path.join(folder, file)), { recursive: true });
      fs.writeFileSync(path.join(folder, file), "");
    }
    fs.mkdirSync(path.join(folder, ".claude-plugin"), { recursive: true });
    fs.writeFileSync(path.join(folder, ".claude-plugin", "plugin.json"), JSON.stringify({ name: "isoplan", version }));
    return folder;
  };
  const old = copyOf("0.2.0");
  const now = copyOf("0.3.0");
  fs.writeFileSync(path.join(plugins, "installed_plugins.json"), JSON.stringify({ version: 2, plugins: { "isoplan@isoplan": [{ scope: "user", installPath: now, version: "0.3.0" }] } }));
  fs.mkdirSync(path.dirname(lockPath(m.claudeDir, "s1")), { recursive: true });
  fs.writeFileSync(lockPath(m.claudeDir, "s1"), JSON.stringify({ pid: OTHER, dataLayer: "C:/old/dist/data-layer.js", detached: false, since: 1, parent: OTHER }));
  m.write("s1");
  const env = { CLAUDE_CODE_PLUGIN_CACHE_DIR: plugins };
  const hooked = new Map<string, Hooks>([["s1", { cwd: m.repo, name: "outdated", root: old, since: 2, env }]]);
  const { w, started, told } = watch(m, { hooked, isAlive: () => true });
  await w.look();
  await w.look();
  expect(started).toEqual([]);
  // It is told so, once, and nothing reports the session for it (#114).
  expect(told).toEqual([{ id: "s1", name: "outdated" }]);
  // The newest copy's hooks module does take it over.
  hooked.set("s1", { cwd: m.repo, name: "newest", root: now, since: 2, env });
  w.rehook("s1");
  await until(() => started.length === 1);
  expect(started[0]!.hooks?.name).toBe("newest");
});

test("a hooks module whose session an earlier version's data layer keeps is told so once for each connection, and the session isn't reported while that data layer holds it; once it lets go, the hooks module connected then is reported for", async () => {
  const m = machine();
  let holderAlive = true;
  fs.mkdirSync(path.dirname(lockPath(m.claudeDir, "s1")), { recursive: true });
  // Of the hooks module's own copy, in a window that started later: not taken over.
  fs.writeFileSync(lockPath(m.claudeDir, "s1"), JSON.stringify({ pid: OTHER, dataLayer: path.join(modDir, "dist", "data-layer.js"), detached: false, since: 9, parent: OTHER }));
  m.write("s1");
  const hooked = new Map<string, Hooks>([["s1", { cwd: m.repo, name: "first", root: modDir, since: 2 }]]);
  const { w, started, told } = watch(m, { hooked, isAlive: (pid) => pid !== OTHER || holderAlive });
  await until(() => told.length === 1);
  await w.look();
  await w.look();
  expect(told).toEqual([{ id: "s1", name: "first" }]);
  expect(started).toEqual([]);
  // Told, it closes its connection; it connects again a minute later, and is told again.
  hooked.delete("s1");
  w.rehook("s1");
  await w.look();
  hooked.set("s1", { cwd: m.repo, name: "again", root: modDir, since: 2 });
  w.rehook("s1");
  await until(() => told.length === 2);
  expect(told[1]).toEqual({ id: "s1", name: "again" });
  expect(started).toEqual([]);
  // That data layer goes (its window reloaded or closed): the next look reports the session for the hooks module.
  holderAlive = false;
  await w.look();
  expect(started.map((s) => s.hooks?.name)).toEqual(["again"]);
  expect(told).toHaveLength(2);
});

test("an earlier version's data layer that took the lock back from a hooks module's report keeps the session until it lets go: a hooks module that connects again doesn't take it over again", async () => {
  const m = machine();
  let holderAlive = true;
  fs.mkdirSync(path.dirname(lockPath(m.claudeDir, "s1")), { recursive: true });
  fs.writeFileSync(lockPath(m.claudeDir, "s1"), JSON.stringify({ pid: OTHER, dataLayer: "C:/old/dist/data-layer.js", detached: false, since: 1, parent: OTHER }));
  m.write("s1");
  const hooked = new Map<string, Hooks>([["s1", { cwd: m.repo, name: "first", root: modDir, since: 2 }]]);
  const { w, started, told } = watch(m, { hooked, isAlive: (pid) => pid !== OTHER || holderAlive });
  await until(() => started.length === 1);
  // That data layer takes the lock back (the lock names it again): the report ends, and the hooks module connects again later.
  started[0]!.end({ why: "another data layer reports this session now" });
  await until(() => !w.reporting().includes("s1"));
  hooked.set("s1", { cwd: m.repo, name: "again", root: modDir, since: 2 });
  w.rehook("s1");
  await w.look();
  await w.look();
  expect(started).toHaveLength(1);
  expect(told).toEqual([{ id: "s1", name: "again" }]);
  // Once it has gone, the session is reported for the hooks module at the next look.
  holderAlive = false;
  await w.look();
  expect(started.map((s) => s.hooks?.name)).toEqual(["first", "again"]);
});

test("a hooks module's report goes by the session's own SESSION_ENV alone: one the session doesn't set isn't taken from the runner's", () => {
  vi.stubEnv("DISABLE_UPDATES", "1");
  vi.stubEnv("CLAUDE_CODE_PLUGIN_CACHE_DIR", "C:/runner/cache");
  const env = hookedEnv({ FORCE_AUTOUPDATE_PLUGINS: "1" });
  expect(env.DISABLE_UPDATES).toBeUndefined();
  expect(env.CLAUDE_CODE_PLUGIN_CACHE_DIR).toBeUndefined();
  expect(env.FORCE_AUTOUPDATE_PLUGINS).toBe("1");
  expect(env.PATH ?? env.Path).toBe(process.env.PATH ?? process.env.Path);
});

test("a hooks module's report writes the lock in the shape an earlier version's data layer gives the session up to, taking it from one", async () => {
  const m = machine();
  vi.stubEnv("CLAUDE_CONFIG_DIR", m.claudeDir);
  const file = lockPath(m.claudeDir, "s1");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  // An earlier version's data layer, live (this test's parent stands in for it), of another copy.
  fs.writeFileSync(file, JSON.stringify({ pid: process.ppid, dataLayer: "C:/old/dist/data-layer.js", detached: false, since: 1, parent: process.ppid, cwd: m.repo }));
  let close = () => {};
  const closed = new Promise<void>((resolve) => (close = resolve));
  const said: DataLayerLine[] = [];
  const ended = reportSession({ sessionId: "s1", cwd: m.repo, by: "hooks", appDir: modDir, root: modDir, since: 5, emit: (line) => void said.push(line), closed, isOff: async () => false });
  // Read as the runner moves it aside to take it, it may be missing for a moment.
  const read = () => {
    try {
      return JSON.parse(fs.readFileSync(file, "utf8")) as { pid?: number };
    } catch {
      return null;
    }
  };
  await until(() => read()?.pid === process.pid);
  expect(JSON.parse(fs.readFileSync(file, "utf8"))).toEqual({ pid: process.pid, dataLayer: path.join(modDir, "dist", "data-layer.js"), detached: false, since: 5, parent: process.pid, runner: true, cwd: m.repo });
  expect(said).toContainEqual({ type: "log", text: "an earlier version's data layer reported this session: the runner reports it now, for its hooks module, and that data layer leaves it" });
  close();
  await ended;
  expect(said.filter((l) => l.type === "superseded")).toEqual([]);
});

test("a hooks module's report goes by the session's own environment, as its hooks module passed it on: its plugin cache, and whether updates are off", async () => {
  const m = machine();
  vi.stubEnv("CLAUDE_CONFIG_DIR", m.claudeDir);
  const plugins = path.join(tempRoot(), "plugin-cache");
  const root = path.join(plugins, "cache", "isoplan", "isoplan", "0.12.0");
  let close = () => {};
  const closed = new Promise<void>((resolve) => (close = resolve));
  const said: DataLayerLine[] = [];
  const ended = reportSession({ sessionId: "s1", cwd: m.repo, by: "hooks", appDir: modDir, root, since: 1, env: { CLAUDE_CODE_PLUGIN_CACHE_DIR: plugins, DISABLE_UPDATES: "1" }, emit: (line) => void said.push(line), closed, isOff: async () => false });
  await until(() => said.some((l) => l.type === "log" && l.text.startsWith("not checking")));
  expect(said).toContainEqual({ type: "log", text: "not checking for a newer version of the plugin: DISABLE_UPDATES is set (FORCE_AUTOUPDATE_PLUGINS=1 turns plugin updates back on)" });
  close();
  await ended;
});

test("on its first look, a runner started again holds its reports without a hooks module for twice runnerRetrySeconds, so a hooks module saying hello meanwhile has its session reported for it from the start", async () => {
  const m = machine({ runnerRetrySeconds: 0.3 });
  m.write("s1");
  m.write("s2");
  const hooked = new Map<string, Hooks>();
  const { w, started } = watch(m, { hooked });
  await w.look();
  expect(started).toEqual([]);
  hooked.set("s1", { cwd: m.repo, name: "h" });
  w.rehook("s1");
  await until(() => started.length === 2);
  expect(started.map((s) => [s.id, s.hooks?.name ?? null])).toEqual([
    ["s1", "h"],
    ["s2", null],
  ]);
  await wait(700);
  expect(started).toHaveLength(2);
});

test("a lock counts as fresh for three of its holder's slowest passes, which a long streamSeconds makes longer", async () => {
  const m = machine({ streamSeconds: 20 }); // three passes of up to 40 s: two minutes
  const lock = lockPath(m.claudeDir, "s1");
  const age = (seconds: number) => {
    const t = new Date(Date.now() - seconds * 1000);
    fs.utimesSync(lock, t, t);
  };
  fs.mkdirSync(path.dirname(lock), { recursive: true });
  fs.writeFileSync(lock, JSON.stringify({ pid: OTHER, detached: false }));
  age(100);
  m.write("s1");
  const { w, ids } = watch(m, { isAlive: () => true });
  await w.look();
  await w.look();
  expect(ids()).toEqual([]);
  age(130);
  await w.look(); // the lock let go before the transcript moved
  await wait(20);
  m.write("s1");
  await w.look();
  expect(ids()).toEqual(["s1"]);
});

test("a session whose last write and lock letting go fall between two looks isn't reported: it closed just after a turn; its next write is", async () => {
  const m = machine();
  fs.mkdirSync(path.dirname(lockPath(m.claudeDir, "s1")), { recursive: true });
  fs.writeFileSync(lockPath(m.claudeDir, "s1"), JSON.stringify({ pid: OTHER, detached: false }));
  m.write("s1");
  const { w, ids } = watch(m, { isAlive: (pid) => pid !== OTHER || fs.existsSync(lockPath(m.claudeDir, "s1")) });
  await w.look();
  await wait(20);
  m.write("s1");
  fs.rmSync(lockPath(m.claudeDir, "s1"));
  await w.look();
  await w.look();
  expect(ids()).toEqual([]);
  await wait(20);
  m.write("s1");
  await until(() => ids().includes("s1"));
});

test("stop waits for a report stuck in a pass at most stopWaitMs", async () => {
  const m = machine();
  m.write("s1");
  const w = watchSessions({ claudeDir: m.claudeDir, io: nodeIo(), config: async () => m.config, report: () => new Promise<Ended>(() => {}), isOff: async () => false, log: () => {}, gapMs: 0, stopWaitMs: 200 });
  await until(() => w.reporting().includes("s1"));
  const started = Date.now();
  await w.stop();
  expect(Date.now() - started).toBeLessThan(2000);
});

test("a session that stopped being reported is reported again only once its transcript moves", async () => {
  const m = machine();
  m.write("s1");
  const { w, started, ids } = watch(m);
  await until(() => ids().length === 1);
  started[0]!.end();
  await until(() => w.reporting().length === 0);
  await w.look();
  await w.look();
  expect(ids()).toEqual(["s1"]);
  await wait(20); // a write time past the one it ended at
  m.write("s1");
  await until(() => ids().length === 2);
});

test("a session that just stopped being reported isn't started again while the runner reads its write time", async () => {
  const m = machine({ streamSeconds: 60 }); // only the first look, and those asked for
  m.write("s1");
  // The next stat after `slow` is set takes a while.
  let slow = false;
  const io = nodeIo();
  const stat: NodeIo["stat"] = async (file) => {
    if (slow) {
      slow = false;
      await wait(300);
    }
    return io.stat(file);
  };
  const { w, started, ids } = watch(m, { io: { ...io, stat } });
  await until(() => ids().length === 1);
  slow = true;
  started[0]!.end();
  await wait(50);
  await w.look();
  await until(() => w.reporting().length === 0);
  await w.look();
  expect(ids()).toEqual(["s1"]);
});

test("quiet past idleMinutes, the folder gone, or the plugin off for the folder: not reported", async () => {
  const m = machine({ idleMinutes: 30, lightsOffHours: 0 });
  const offDir = path.join(m.repo, "..", "off");
  fs.mkdirSync(offDir);
  m.write("quiet", m.repo, 31);
  m.write("gone", path.join(m.repo, "..", "gone"));
  m.write("off", offDir);
  m.write("on");
  const { w, ids } = watch(m, { isOff: async (folder) => folder === offDir });
  await until(() => ids().includes("on"));
  await w.look();
  expect(ids()).toEqual(["on"]);
});

test("a runner started again reports each live session at its first look, and then, one at a time, those quiet within lightsOffHours", async () => {
  const m = machine({ idleMinutes: 30, lightsOffHours: 24 });
  m.write("live");
  m.write("quiet-1", m.repo, 60);
  m.write("quiet-2", m.repo, 120);
  m.write("old", m.repo, 25 * 60);
  const { w, ids } = watch(m, { gapMs: 300 });
  await until(() => ids().length >= 1);
  expect(ids()).toEqual(["live"]);
  await until(() => ids().length === 3);
  expect(ids().slice(1).sort()).toEqual(["quiet-1", "quiet-2"]);
  await w.look();
  expect(ids()).not.toContain("old");
});

test("a hold-off: the session isn't reported before it ends; one no office took is, as it moves, once a fresh list of an office takes its repo, but never one that didn't want it", async () => {
  const m = machine();
  m.write("s1");
  const { w, started, ids } = watch(m);
  await until(() => ids().length === 1);
  const until_ = Date.now() + 3600000;
  started[0]!.end({ why: "held", holdOff: { until: until_, projects: ["github.com/team/app"], offices: ["ws://a/data-layer", "ws://b/data-layer"], notWanted: { "ws://b/data-layer": until_ } } });
  await until(() => w.reporting().length === 0);
  expect(w.heldOff("s1")).toBe(true);
  const list = (server: string, repos: string[]) => {
    fs.mkdirSync(path.dirname(approvedPath(m.claudeDir, server)), { recursive: true });
    fs.writeFileSync(approvedPath(m.claudeDir, server), JSON.stringify({ server, version: "v1", repos, fetched: Date.now(), checked: Date.now() }));
  };
  // The office that didn't want it takes the repo: still held off.
  list("ws://b/data-layer", ["github.com/team/app"]);
  await wait(20);
  m.write("s1");
  await w.look();
  await w.look();
  expect(ids()).toEqual(["s1"]);
  // Another it reported to does: reported again, still leaving the other office alone.
  list("ws://a/data-layer", ["github.com/team/app"]);
  await wait(20);
  m.write("s1");
  await until(() => ids().length === 2);
  expect(started[1]!.notWanted).toEqual({ "ws://b/data-layer": until_ });
  expect(w.heldOff("s1")).toBe(false);
});

test("a hold-off with no repos to wait for (no office wants the project) holds until it ends", async () => {
  const m = machine();
  m.write("s1");
  const { w, started, ids } = watch(m);
  await until(() => ids().length === 1);
  started[0]!.end({ why: "held", holdOff: { until: Date.now() + 300, offices: [], notWanted: {} } });
  await until(() => w.reporting().length === 0);
  await wait(20);
  m.write("s1");
  await w.look();
  expect(ids()).toHaveLength(1);
  await wait(400);
  m.write("s1");
  await until(() => ids().length === 2);
});

/** A stand-in office server taking github.com/team/app, which keeps every data-layer socket. */
async function office() {
  const connections: { messages: { type: string }[]; closed: boolean; at: number; drop: () => void }[] = [];
  const server = http.createServer((request, response) => {
    if (!request.url?.startsWith("/data-layer/repos")) return void response.writeHead(404).end();
    response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ version: "v1", repos: ["github.com/team/app"] }));
  });
  const wss = new WebSocketServer({ server });
  wss.on("connection", (ws) => {
    const c = { messages: [] as { type: string }[], closed: false, at: Date.now(), drop: () => ws.terminate() };
    connections.push(c);
    ws.on("message", (data) => c.messages.push(JSON.parse(String(data)) as { type: string }));
    ws.on("close", () => (c.closed = true));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  closing.push(() => new Promise((resolve) => (wss.close(), server.closeAllConnections(), server.close(resolve))));
  return { connections, url: `ws://127.0.0.1:${(server.address() as AddressInfo).port}/data-layer` };
}

/** watchSessions as the runner's worker runs it, reporting with the data layer's own loop. */
function runner(m: ReturnType<typeof machine>) {
  vi.stubEnv("CLAUDE_CONFIG_DIR", m.claudeDir);
  const report = async ({ sessionId, cwd, notWanted, closed }: ToReport) => {
    const log = sessionLog(m.claudeDir, sessionId);
    const ended = await reportSession({ sessionId, cwd, by: "runner", appDir: modDir, emit: log.emit, closed, notWanted, isOff: async () => false });
    await log.flushed();
    return ended;
  };
  const w = watchSessions({ claudeDir: m.claudeDir, io: nodeIo(), config: async () => m.config, report, isOff: async () => false, log: () => {} });
  watching.push(w);
  return w;
}

test("with no hooks module and no wake hook, a session reaches the office from the runner; a runner started again reports it within one streamSeconds; the plugin's data layer taking the lock ends the runner's link", async () => {
  const o = await office();
  const m = machine({ streamSeconds: 2 });
  execFileSync("git", ["init", "-q"], { cwd: m.repo });
  execFileSync("git", ["remote", "add", "origin", "https://github.com/team/app.git"], { cwd: m.repo });
  fs.mkdirSync(path.join(m.claudeDir, "isoplan"), { recursive: true });
  fs.writeFileSync(path.join(m.claudeDir, "isoplan", "config.json"), JSON.stringify({ server: o.url, streamSeconds: 2 }));
  fs.mkdirSync(path.dirname(m.transcript("s1")), { recursive: true });
  const now = new Date().toISOString();
  fs.writeFileSync(m.transcript("s1"), [{ type: "user", cwd: m.repo, timestamp: now, message: { role: "user", content: "hi" } }, { type: "assistant", cwd: m.repo, timestamp: now, message: { role: "assistant", content: [{ type: "text", text: "ok" }] } }].map((l) => JSON.stringify(l) + "\n").join(""));
  const full = (i: number) => o.connections[i]?.messages.some((msg) => msg.type === "full") ?? false;

  const first = runner(m);
  await until(() => full(0));
  expect(JSON.parse(fs.readFileSync(lockPath(m.claudeDir, "s1"), "utf8"))).toMatchObject({ pid: process.pid, runner: true });

  // The runner stops (its worker ends with its links) and starts again.
  await first.stop();
  await until(() => o.connections[0]!.closed);
  const restarted = Date.now();
  runner(m);
  await until(() => full(1));
  expect(Date.now() - restarted).toBeLessThan(m.config.streamSeconds * 1000);

  // The plugin's data layer takes the session's lock, as it does from the runner (by force): the runner's link closes, and stays closed.
  fs.writeFileSync(lockPath(m.claudeDir, "s1"), JSON.stringify({ pid: process.ppid, detached: false }));
  await until(() => o.connections[1]!.closed, 10000);
  await wait(2500);
  expect(o.connections).toHaveLength(2);
});

/** Sessions s1 and s2 in one repo the stand-in office takes, at work, the runner's to report. */
async function twoSessions() {
  const o = await office();
  const m = machine({ streamSeconds: 1 });
  execFileSync("git", ["init", "-q"], { cwd: m.repo });
  execFileSync("git", ["remote", "add", "origin", "https://github.com/team/app.git"], { cwd: m.repo });
  fs.mkdirSync(path.join(m.claudeDir, "isoplan"), { recursive: true });
  fs.writeFileSync(path.join(m.claudeDir, "isoplan", "config.json"), JSON.stringify({ server: o.url, streamSeconds: 1 }));
  fs.mkdirSync(path.dirname(m.transcript("s1")), { recursive: true });
  const now = new Date().toISOString();
  for (const id of ["s1", "s2"]) fs.writeFileSync(m.transcript(id), [{ type: "user", cwd: m.repo, timestamp: now, message: { role: "user", content: "hi" } }, { type: "assistant", cwd: m.repo, timestamp: now, message: { role: "assistant", content: [{ type: "text", text: "ok" }] } }].map((l) => JSON.stringify(l) + "\n").join(""));
  const of = (id: string) => o.connections.find((c) => c.messages.some((msg) => msg.type === "full" && (msg as { facts?: { session?: { id?: string } } }).facts?.session?.id === `claude-code:${id}`));
  const logOf = (id: string) => fs.readFileSync(path.join(m.claudeDir, "isoplan", "logs", `${id}.log`), "utf8");
  return { o, m, of, logOf };
}

/** watchSessions as the worker runs it, with s1's report given `s1` in place of its own emit, isOff or shared pairing and list; how many times each session was started. */
function runnerWith(m: ReturnType<typeof machine>, s1: { emit?: (line: DataLayerLine, emit: (line: DataLayerLine) => void) => void; isOff?: () => Promise<boolean>; shared?: ReportSessionOptions["shared"] }) {
  vi.stubEnv("CLAUDE_CONFIG_DIR", m.claudeDir);
  const starts: string[] = [];
  const report = async ({ sessionId, cwd, notWanted, closed }: ToReport) => {
    starts.push(sessionId);
    const log = sessionLog(m.claudeDir, sessionId);
    const injected: typeof s1 = sessionId === "s1" ? s1 : {};
    const emit = injected.emit ? (line: DataLayerLine) => injected.emit!(line, log.emit) : log.emit;
    const ended = await reportSession({ sessionId, cwd, by: "runner", appDir: modDir, emit, closed, notWanted, isOff: injected.isOff ?? (async () => false), ...(injected.shared && { shared: injected.shared }) });
    await log.flushed();
    return ended;
  };
  const w = watchSessions({ claudeDir: m.claudeDir, io: nodeIo(), config: async () => m.config, report, isOff: async () => false, log: () => {} });
  watching.push(w);
  return { w, started: (id: string) => starts.filter((s) => s === id).length };
}

test("a session whose report throws in one of its link's handlers ends alone, its lock gone and its log saying why, while another session the runner reports goes on; it starts again once its transcript moves", async () => {
  const { m, of, logOf } = await twoSessions();
  // The throw comes from the link's socket handler as it opens: before #104 it reached the worker's process.
  const { w, started } = runnerWith(m, {
    emit: (line, emit) => {
      if (line.type === "status" && line.state === "connected") throw new Error("boom: a handler broke");
      emit(line);
    },
  });
  await until(() => !!of("s1") && !!of("s2"));
  await until(() => of("s1")!.closed && !w.reporting().includes("s1"));
  expect(logOf("s1")).toMatch(/stopping: something went wrong in reporting it: Error: boom: a handler broke/);
  expect(fs.existsSync(lockPath(m.claudeDir, "s1"))).toBe(false);
  // The other session goes on.
  await wait(1500);
  expect(w.reporting()).toEqual(["s2"]);
  expect(of("s2")!.closed).toBe(false);
  expect(JSON.parse(fs.readFileSync(lockPath(m.claudeDir, "s2"), "utf8"))).toMatchObject({ pid: process.pid });
  // Like any other end: not again until its transcript moves.
  await w.look();
  expect(started("s1")).toBe(1);
  fs.appendFileSync(m.transcript("s1"), line(m.repo));
  await until(() => started("s1") === 2);
});

test("a session whose report rejects in a promise nothing waits for ends alone, logged, while another session the runner reports goes on", async () => {
  const { m, of, logOf } = await twoSessions();
  let broken = false;
  const approved = {
    repos: () => new Set(["github.com/team/app"]),
    version: () => "v1",
    problem: () => null,
    refresh: async (force?: boolean) => {
      if (force && broken) throw new Error("boom: the list broke");
    },
    ask: async () => "listed" as const,
  };
  const pairing = { token: async () => undefined, refused: async () => {}, close: async () => {} };
  const { w } = runnerWith(m, { shared: () => ({ pairing, approved }) });
  await until(() => !!of("s1") && !!of("s2"));
  // The office drops s1's link: the session reads the office's list again, which rejects.
  broken = true;
  of("s1")!.drop();
  await until(() => !w.reporting().includes("s1"));
  expect(logOf("s1")).toMatch(/stopping: something went wrong in reporting it: Error: boom: the list broke/);
  expect(fs.existsSync(lockPath(m.claudeDir, "s1"))).toBe(false);
  await wait(1500);
  expect(w.reporting()).toEqual(["s2"]);
  expect(of("s2")!.closed).toBe(false);
});

test("a session whose reporting loop itself throws ends alone, its links closed, its lock gone and its log saying why, while another session the runner reports goes on", async () => {
  const { m, of, logOf } = await twoSessions();
  // Asked as it starts and after each pass's wait: the loop awaits it, so its throw is the loop's own.
  let asked = 0;
  const { w } = runnerWith(m, {
    isOff: async () => {
      if (asked++ > 0) throw new Error("boom: the loop broke");
      return false;
    },
  });
  await until(() => !!of("s1") && !!of("s2"));
  await until(() => of("s1")!.closed && !w.reporting().includes("s1"));
  expect(logOf("s1")).toMatch(/stopping: something went wrong in reporting it: Error: boom: the loop broke/);
  expect(fs.existsSync(lockPath(m.claudeDir, "s1"))).toBe(false);
  await wait(1500);
  expect(w.reporting()).toEqual(["s2"]);
  expect(of("s2")!.closed).toBe(false);
});

test("a session whose error text matches a secret pattern logs that it is left out, not the text", async () => {
  const { m, of, logOf } = await twoSessions();
  const secret = "ghp_" + "a".repeat(36);
  const { w } = runnerWith(m, {
    emit: (line, emit) => {
      if (line.type === "status" && line.state === "connected") throw new Error(`boom: ${secret}`);
      emit(line);
    },
  });
  await until(() => !!of("s1"));
  await until(() => !w.reporting().includes("s1"));
  expect(logOf("s1")).toMatch(/something went wrong in reporting it: \(its text is left out: it matches the secret pattern /);
  expect(logOf("s1")).not.toContain(secret);
});
