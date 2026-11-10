// The data layer's loop (report-session.ts) against a stand-in office server, with a throwaway
// Claude config folder: as the runner runs it, in this process, so it installs nothing and starts
// no runner: what it sends for a session in a repo the office doesn't take, and when the copy of the
// office's list is too old (isoplan-app/isoplan#91); and as the runner reports a session for its
// hooks module (ADR 0007 step 2): what it does for a copy in the plugin cache once Claude Code has
// installed a newer one (isoplan-app/isoplan#96), beside an earlier version's data layer, and with
// the files the hooks module writes back. dist/data-layer.js (rebuilt with every change) is run as
// an earlier version's wake hook starts it.

import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import { reportSession, sessionLog, startDetached, type ReportSessionOptions } from "./report-session.js";
import type { DataLayerLine } from "../lines.js";
import { WebSocketServer } from "ws";
import { modDir, tempRoot } from "./fixture.js";

vi.setConfig({ testTimeout: 30000 });

const children: ChildProcess[] = [];
const servers: (() => Promise<unknown>)[] = [];
const reporting: { stop: () => void; done: Promise<unknown> }[] = [];
afterEach(async () => {
  for (const c of children.splice(0)) c.kill();
  const stopping = reporting.splice(0);
  for (const r of stopping) r.stop();
  await Promise.all(stopping.map((r) => r.done));
  vi.unstubAllEnvs();
  for (const close of servers.splice(0)) await close();
});

/**
 * A stand-in office server: GET /data-layer/repos answers `list` (or `status`, or nothing while it
 * `hangs`), and every data-layer socket is kept; with `notWanted` a hello is told the project isn't wanted.
 */
async function office() {
  const state = { repos: [] as string[], version: 1, status: 200, hangs: false, notWanted: false, connections: [] as { messages: { type: string }[]; closed: boolean; close(): void; send(message: unknown): void }[] };
  const server = http.createServer((request, response) => {
    if (!request.url?.startsWith("/data-layer/repos")) return void response.writeHead(404).end();
    if (state.hangs) return;
    if (state.status !== 200) return void response.writeHead(state.status).end("{}");
    response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ version: `v${state.version}`, repos: state.repos }));
  });
  const wss = new WebSocketServer({ server });
  wss.on("connection", (ws) => {
    const c = { messages: [] as { type: string }[], closed: false, close: () => ws.close(), send: (message: unknown) => ws.send(JSON.stringify(message)) };
    state.connections.push(c);
    ws.on("message", (data) => {
      const message = JSON.parse(String(data)) as { type: string };
      c.messages.push(message);
      if (message.type === "hello" && state.notWanted) ws.send(JSON.stringify({ type: "error", v: 1, code: "not-wanted", message: "this project isn't in any office on this server" }));
    });
    ws.on("close", () => (c.closed = true));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  servers.push(() => new Promise((resolve) => (wss.close(), server.closeAllConnections(), server.close(resolve))));
  return { state, url: `ws://127.0.0.1:${(server.address() as AddressInfo).port}/data-layer` };
}

type Lines = (repo: string, now: string) => object[];
const turn: Lines = (repo, now) => [{ type: "user", cwd: repo, timestamp: now, message: { role: "user", content: "hi" } }, { type: "assistant", cwd: repo, timestamp: now, message: { role: "assistant", content: [{ type: "text", text: "ok" }] } }];
// What a transcript holds as the first prompt's hooks run: bookkeeping lines, none naming a folder (#92).
const bookkeeping: Lines = (_repo, now) => [{ type: "session-owner" }, { type: "queue-operation", operation: "enqueue", timestamp: now }, { type: "queue-operation", operation: "dequeue", timestamp: now }];
const jsonl = (lines: object[]) => lines.map((l) => JSON.stringify(l)).join("\n") + "\n";

/** A repo with a remote, and session s1 in it with a fresh transcript (`lines`, by default a prompt and a reply); the repo's folder. */
function session(claudeDir: string, root: string, lines = turn): string {
  const repo = path.join(root, "app");
  fs.mkdirSync(repo);
  execFileSync("git", ["init", "-q"], { cwd: repo });
  execFileSync("git", ["remote", "add", "origin", "https://github.com/team/app.git"], { cwd: repo });
  const now = new Date().toISOString();
  const transcript = path.join(claudeDir, "projects", repo.replace(/[^a-zA-Z0-9]/g, "-"), "s1.jsonl");
  fs.mkdirSync(path.dirname(transcript), { recursive: true });
  fs.writeFileSync(transcript, jsonl(lines(repo, now)));
  fs.mkdirSync(path.join(claudeDir, "isoplan"), { recursive: true });
  return repo;
}

/** Session s1 reported as the runner reports it, in this process, until the test ends. */
function inRunner(claudeDir: string, repo: string, extra: Partial<ReportSessionOptions> = {}) {
  vi.stubEnv("CLAUDE_CONFIG_DIR", claudeDir);
  let stop = () => {};
  const closed = new Promise<void>((resolve) => (stop = resolve));
  const log = sessionLog(claudeDir, "s1");
  const done = reportSession({ sessionId: "s1", cwd: repo, by: "runner", appDir: modDir, emit: log.emit, closed, isOff: async () => false, ...extra }).then(async (ended) => (await log.flushed(), ended));
  reporting.push({ stop, done });
  return done;
}

/** session(), and the runner reporting it. */
function start(url: string, config: Record<string, unknown> = {}, lines = turn) {
  const root = tempRoot();
  const claudeDir = path.join(root, "claude");
  const repo = session(claudeDir, root, lines);
  fs.writeFileSync(path.join(claudeDir, "isoplan", "config.json"), JSON.stringify({ server: url, ...config }));
  const ended = inRunner(claudeDir, repo);
  const transcript = path.join(claudeDir, "projects", repo.replace(/[^a-zA-Z0-9]/g, "-"), "s1.jsonl");
  const logged = () => fs.readFileSync(path.join(claudeDir, "isoplan", "logs", "s1.log"), "utf8");
  return { claudeDir, repo, transcript, ended, logged, stop: reporting.at(-1)!.stop, lock: path.join(claudeDir, "isoplan", "live", "s1.json") };
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(check: () => boolean, ms = 15000) {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error("timed out");
    await wait(20);
  }
}

test("a session in a repo the office doesn't take opens no socket, and the runner holds it off, naming the repo", async () => {
  const o = await office();
  o.state.repos = ["github.com/team/other"];
  const { ended, lock, logged } = start(o.url);
  expect((await ended).holdOff).toMatchObject({ projects: ["github.com/team/app"], offices: [o.url] });
  expect(o.state.connections).toEqual([]);
  expect(fs.existsSync(lock)).toBe(false);
  expect(logged()).toContain("stopping: no office this reports to takes github.com/team/app, so it holds off until one does");
});

/** session() in a repo the office doesn't take, reported by the runner with `emit` in front of its log; its log. */
async function notTaken(emit: (line: DataLayerLine, log: (line: DataLayerLine) => void) => void) {
  const o = await office();
  o.state.repos = ["github.com/team/other"];
  const root = tempRoot();
  const claudeDir = path.join(root, "claude");
  const repo = session(claudeDir, root);
  fs.writeFileSync(path.join(claudeDir, "isoplan", "config.json"), JSON.stringify({ server: o.url }));
  const log = sessionLog(claudeDir, "s1");
  const ended = await inRunner(claudeDir, repo, { emit: (line) => emit(line, log.emit) });
  await log.flushed();
  return { ended, logged: fs.readFileSync(path.join(claudeDir, "isoplan", "logs", "s1.log"), "utf8") };
}

test("an error during a pass that then holds off as not taken is logged and is why it ended, and the hold-off is kept (#104)", async () => {
  const { ended, logged } = await notTaken((line, log) => {
    if (line.type === "status" && line.state === "not-approved") throw new Error("boom: the status line broke");
    log(line);
  });
  expect(ended.why).toMatch(/^something went wrong in reporting it: Error: boom: the status line broke/);
  expect(ended.holdOff).toMatchObject({ projects: ["github.com/team/app"] });
  expect(logged).toContain("stopping: no office this reports to takes github.com/team/app");
  expect(logged).toContain("stopping: something went wrong in reporting it: Error: boom: the status line broke");
});

test("a throw in the loop after an earlier error ended the session is logged as well as the earlier one (#104)", async () => {
  const { ended, logged } = await notTaken((line, log) => {
    if (line.type === "status" && line.state === "not-approved") throw new Error("boom: the status line broke");
    if (line.type === "log" && line.text.startsWith("stopping: no office")) throw new Error("boom: the log line broke");
    log(line);
  });
  expect(ended.why).toMatch(/^something went wrong in reporting it: Error: boom: the status line broke/);
  expect(logged).toContain("stopping: something went wrong in reporting it: Error: boom: the status line broke");
  expect(logged).toContain("then, as it stopped, something else went wrong: Error: boom: the log line broke");
});

// #92: a session may be seen before Claude Code has written a line that names the session's folder.
test("the runner, reporting a session before its transcript has anything to report, waits for it, and reports the session once it has", async () => {
  const o = await office();
  o.state.repos = ["github.com/team/app"];
  const { repo, transcript, lock } = start(o.url, {}, bookkeeping);
  await wait(1500);
  expect(o.state.connections).toEqual([]);
  expect(JSON.parse(fs.readFileSync(lock, "utf8"))).toMatchObject({ pid: process.pid, detached: true, runner: true });
  fs.appendFileSync(transcript, jsonl(turn(repo, new Date().toISOString())));
  await until(() => o.state.connections[0]?.messages.some((m) => m.type === "full") ?? false);
});

test("the runner stops reporting a session whose transcript has nothing to report within factsWaitSeconds, saying why, and lets the session go", async () => {
  const o = await office();
  o.state.repos = ["github.com/team/app"];
  const { ended, lock, logged } = start(o.url, { factsWaitSeconds: 1 }, bookkeeping);
  expect((await ended).holdOff).toBeUndefined();
  expect(o.state.connections).toEqual([]);
  expect(logged()).toContain("stopping: the session's transcript had nothing to report within 1 seconds");
  expect(fs.existsSync(lock)).toBe(false);
});

// A transcript that has started but is left out (a helper session) has nothing to report, and isn't waited for.
const helper: Lines = (repo, now) => [{ type: "user", cwd: repo, timestamp: now, message: { role: "user", content: "Generate a short git branch name for this" } }, { type: "assistant", cwd: repo, timestamp: now, message: { role: "assistant", content: [{ type: "text", text: "fix-it" }] } }];
test("the runner stops reporting a session that has started but has nothing to report at once, without waiting for facts", async () => {
  const o = await office();
  o.state.repos = ["github.com/team/app"];
  const begun = Date.now();
  const { ended, logged } = start(o.url, { factsWaitSeconds: 60 }, helper);
  await ended;
  expect(Date.now() - begun).toBeLessThan(15000);
  expect(logged()).toContain("stopping: the session has nothing to report now");
});

test("the runner keeps the session's lock fresh each pass, and as it stops reporting the session, its log says why", async () => {
  const o = await office();
  o.state.repos = ["github.com/team/app"];
  const { ended, lock, logged, stop } = start(o.url);
  await until(() => o.state.connections[0]?.messages.some((m) => m.type === "full") ?? false);
  const old = new Date(Date.now() - 60000);
  fs.utimesSync(lock, old, old);
  await until(() => fs.statSync(lock).mtimeMs > Date.now() - 10000);
  stop();
  expect((await ended).why).toBe("the runner stopped");
  expect(logged()).toContain("stopping: the runner stopped");
});

test("the runner hears the title each pass gives the office, for the desktop app's menu", async () => {
  const o = await office();
  o.state.repos = ["github.com/team/app"];
  const root = tempRoot();
  const claudeDir = path.join(root, "claude");
  const repo = session(claudeDir, root, (repo, now) => [...turn(repo, now), { type: "ai-title", aiTitle: "Tidy the docs", sessionId: "s1" }]);
  fs.writeFileSync(path.join(claudeDir, "isoplan", "config.json"), JSON.stringify({ server: o.url }));
  const titles: string[] = [];
  void inRunner(claudeDir, repo, { titled: (title) => void titles.push(title) });
  await until(() => titles.length > 0);
  expect(titles[0]).toBe("Tidy the docs");
});

test("an approved session connects; once its copy of the list is past its maximum age and can't be checked, its link closes and no other socket opens, reconnects included", async () => {
  const o = await office();
  o.state.repos = ["github.com/team/app"];
  // Minutes in config.json: a copy is checked every 0.6 s and is too old after 1.2 s.
  start(o.url, { approvedRefreshMinutes: 0.01, approvedMaxAgeMinutes: 0.02 });
  await until(() => o.state.connections[0]?.messages.some((m) => m.type === "hello") ?? false);

  // The list can't be checked: a drop within the copy's age reconnects, after checking; past it, the link closes.
  o.state.status = 500;
  o.state.connections[0]!.close();
  // Past the copy's maximum age (1.2 s) and a pass of the loop, everything is closed.
  await wait(3000);
  expect(o.state.connections.every((c) => c.closed)).toBe(true);
  const opened = o.state.connections.length;
  await wait(4000);
  expect(o.state.connections).toHaveLength(opened);
  expect(o.state.connections.every((c) => c.closed)).toBe(true);

  // The server answers again: the list is checked, and only then does it reconnect.
  o.state.status = 200;
  await until(() => o.state.connections.length === 2 && o.state.connections[1]!.messages.some((m) => m.type === "hello"));
});

test("a session reports to every office whose list takes its repo, each on its own link: one taking it out leaves the other's link up (#105)", async () => {
  const internal = await office();
  const dev = await office();
  internal.state.repos = ["github.com/team/app"];
  const hello = (o: typeof internal, i: number) => o.state.connections[i]?.messages.some((m) => m.type === "hello") ?? false;
  const { claudeDir } = start("ws://127.0.0.1:9/data-layer", {
    servers: [
      { label: "internal", server: internal.url },
      { label: "dev", server: dev.url },
    ],
    approvedRefreshMinutes: 0.01,
  });
  await until(() => hello(internal, 0));
  // The office that doesn't take the repo gets nothing, not even a hello.
  await wait(1500);
  expect(dev.state.connections).toEqual([]);

  // Once it takes it too, the session goes to both.
  dev.state.repos = ["github.com/team/app"];
  dev.state.version++;
  await until(() => hello(dev, 0));
  expect(internal.state.connections).toHaveLength(1);
  expect(internal.state.connections[0]!.closed).toBe(false);

  // The first takes it out: its link closes, and the other's stays up.
  internal.state.repos = [];
  internal.state.version++;
  await until(() => internal.state.connections[0]!.closed);
  await wait(1500);
  expect(dev.state.connections).toHaveLength(1);
  expect(dev.state.connections[0]!.closed).toBe(false);
  // Each office's copy of its list is its own.
  const lists = fs.readdirSync(path.join(claudeDir, "isoplan", "offices")).map((id) => JSON.parse(fs.readFileSync(path.join(claudeDir, "isoplan", "offices", id, "approved.json"), "utf8")).server);
  expect(lists.sort()).toEqual([internal.url, dev.url].sort());
});

test("a slow office's list never holds up another's: the one that answers gets the session at once (#105)", async () => {
  const slow = await office();
  const fast = await office();
  slow.state.hangs = true;
  fast.state.repos = ["github.com/team/app"];
  const began = Date.now();
  start("ws://127.0.0.1:9/data-layer", { servers: [{ label: "slow", server: slow.url }, { label: "fast", server: fast.url }] });
  await until(() => fast.state.connections[0]?.messages.some((m) => m.type === "hello") ?? false);
  // The slow one's list is asked for with a 15 s timeout; the fast one doesn't wait for it.
  expect(Date.now() - began).toBeLessThan(10000);
  expect(slow.state.connections).toEqual([]);
});

test("one office not wanting the session while no other takes its repo holds it off naming that office; reported again, it leaves that office alone (#105)", async () => {
  const internal = await office();
  const dev = await office();
  internal.state.repos = ["github.com/team/app"];
  internal.state.notWanted = true;
  const servers = [{ label: "internal", server: internal.url }, { label: "dev", server: dev.url }];
  const { claudeDir, repo, ended } = start("ws://127.0.0.1:9/data-layer", { servers, approvedRefreshMinutes: 0.01 });
  const held = (await ended).holdOff!;
  expect(held).toMatchObject({ projects: ["github.com/team/app"], offices: [internal.url, dev.url] });
  expect(held.notWanted[internal.url]).toBeGreaterThan(Date.now());

  // The runner reports it again once dev takes the repo, passing on the office that didn't want it.
  dev.state.repos = ["github.com/team/app"];
  dev.state.version++;
  const asked = internal.state.connections.length;
  void inRunner(claudeDir, repo, { notWanted: held.notWanted });
  await until(() => dev.state.connections[0]?.messages.some((m) => m.type === "hello") ?? false);
  await wait(1500);
  expect(internal.state.connections).toHaveLength(asked);
});

/** Two versions of the plugin in a throwaway plugin cache, Claude Code's record naming the newer, and a way to start either for session s1. */
function versions(server = "ws://127.0.0.1:9/data-layer") {
  const root = tempRoot();
  const claudeDir = path.join(root, "claude");
  const plugins = path.join(claudeDir, "plugins");
  const folder = (version: string) => path.join(plugins, "cache", "isoplan", "isoplan", version);
  for (const version of ["0.2.0", "0.3.0"]) {
    fs.mkdirSync(path.join(folder(version), "dist"), { recursive: true });
    fs.mkdirSync(path.join(folder(version), ".claude-plugin"), { recursive: true });
    // Never the runner's files: without them a copy that installs fails before it reaches the link
    // handler and the login item, which point at this machine's real home and registry (systemPlaces).
    for (const file of ["data-layer.js", "wake.js", "hooks.js"]) fs.copyFileSync(path.join(modDir, "dist", file), path.join(folder(version), "dist", file));
    fs.copyFileSync(path.join(modDir, "config.json"), path.join(folder(version), "config.json"));
    fs.writeFileSync(path.join(folder(version), ".claude-plugin", "plugin.json"), JSON.stringify({ name: "isoplan", version }));
  }
  fs.writeFileSync(path.join(plugins, "installed_plugins.json"), JSON.stringify({ version: 2, plugins: { "isoplan@isoplan": [{ scope: "user", installPath: folder("0.3.0"), version: "0.3.0" }] } }));
  const repo = session(claudeDir, root);
  fs.writeFileSync(path.join(claudeDir, "isoplan", "config.json"), JSON.stringify({ server }));
  const lock = path.join(claudeDir, "isoplan", "live", "s1.json");
  const run = (version: string, ...flags: string[]) => {
    const child = spawn(process.execPath, [path.join(folder(version), "dist", "data-layer.js"), "--session", "s1", "--cwd", repo, ...flags], {
      cwd: repo,
      // No update check runs against a real Claude Code here.
      env: { ...process.env, CLAUDE_CONFIG_DIR: claudeDir, CLAUDE_CODE_PLUGIN_CACHE_DIR: "", DISABLE_AUTOUPDATER: "1", FORCE_AUTOUPDATE_PLUGINS: "" },
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
    });
    children.push(child);
    let out = "";
    child.stdout!.on("data", (piece) => (out += piece));
    let code: number | null | undefined;
    const exited = new Promise<number | null>((resolve) => child.on("exit", (c) => resolve((code = c))));
    return { pid: child.pid!, hasExited: () => code !== undefined, lines: () => out.split("\n").filter(Boolean).map((l) => JSON.parse(l) as { type: string; text?: string }), exited };
  };
  // Session s1 reported as the runner reports it for a hooks module of `version`, in this process, until the test ends.
  const hooked = (version: string, extra: Partial<ReportSessionOptions> = {}) => {
    vi.stubEnv("CLAUDE_CONFIG_DIR", claudeDir);
    vi.stubEnv("CLAUDE_CODE_PLUGIN_CACHE_DIR", "");
    // No update check runs against a real Claude Code here.
    vi.stubEnv("DISABLE_AUTOUPDATER", "1");
    vi.stubEnv("FORCE_AUTOUPDATE_PLUGINS", "");
    const out: DataLayerLine[] = [];
    let stop = () => {};
    const closed = new Promise<void>((resolve) => (stop = resolve));
    const done = reportSession({ sessionId: "s1", cwd: repo, by: "hooks", appDir: modDir, root: folder(version), emit: (line) => void out.push(line), closed, ...extra });
    reporting.push({ stop, done });
    return { lines: () => out as (DataLayerLine & { text?: string })[], done, stop };
  };
  return { claudeDir, lock, run, hooked, holder: () => (fs.existsSync(lock) ? (JSON.parse(fs.readFileSync(lock, "utf8")).pid as number) : null) };
}

test("for a hooks module on a copy an update left behind, the runner says so once, installs nothing and checks for nothing; dist/data-layer.js started --detached by an older wake hook ends at once, saying why in the session's log", async () => {
  const v = versions();
  const loaded = v.hooked("0.2.0");
  await until(() => loaded.lines().some((l) => l.type === "updated"));
  await wait(1500);
  expect(fs.existsSync(path.join(v.claudeDir, "isoplan", "wake.json"))).toBe(false);
  expect(fs.existsSync(path.join(v.claudeDir, "isoplan", "update.json"))).toBe(false);
  expect(loaded.lines().filter((l) => l.type === "updated")).toHaveLength(1);
  loaded.stop();
  await loaded.done;

  const detached = v.run("0.3.0", "--detached");
  expect(await detached.exited).toBe(0);
  expect(fs.existsSync(v.lock)).toBe(false);
  expect(fs.readFileSync(path.join(v.claudeDir, "isoplan", "logs", "s1.log"), "utf8")).toContain("the runner reports it now, so this data layer ends");
});

test("started --detached by an earlier version's wake hook, it puts this version's wake hook and runner in place, starts the runner hidden, and says so in the session's log", async () => {
  const root = tempRoot();
  const claudeDir = path.join(root, "claude");
  vi.stubEnv("CLAUDE_CONFIG_DIR", claudeDir);
  vi.stubEnv("CLAUDE_CODE_PLUGIN_CACHE_DIR", "");
  const spawned: { args: string[]; cwd: string }[] = [];
  await startDetached({ sessionId: "s1", project: root, appDir: modDir, spawn: (args, cwd) => void spawned.push({ args, cwd }) });
  const wake = JSON.parse(fs.readFileSync(path.join(claudeDir, "isoplan", "wake.json"), "utf8")) as { dataLayer: string; runner: string };
  expect(wake.runner).toBe(path.join(claudeDir, "isoplan", "runner", "app", "dist", "runner.mjs"));
  expect(fs.existsSync(wake.runner)).toBe(true);
  expect(fs.readFileSync(path.join(claudeDir, "settings.json"), "utf8")).toContain("wake.mjs");
  expect(spawned.map(({ args, cwd }) => ({ args: args.map((a) => (a.startsWith("--") ? a : path.resolve(a))), cwd: path.resolve(cwd) }))).toEqual([{ args: [wake.runner, "--claude-dir", path.resolve(claudeDir), "--inherited-env"], cwd: path.resolve(claudeDir) }]);
  expect(fs.readFileSync(path.join(claudeDir, "isoplan", "logs", "s1.log"), "utf8")).toContain("the runner reports it now, so this data layer ends (started the runner)");
});

test("the runner, reporting a session whose plugin is turned off for its folder, says so in the session's log as it stops", async () => {
  const root = tempRoot();
  const claudeDir = path.join(root, "claude");
  const repo = session(claudeDir, root);
  const ended = await inRunner(claudeDir, repo, { isOff: async () => true });
  expect(ended.why).toMatch(/^Claude Code lists the Isoplan plugin as uninstalled or disabled here/);
  expect(fs.readFileSync(path.join(claudeDir, "isoplan", "logs", "s1.log"), "utf8")).toContain("stopping: Claude Code lists the Isoplan plugin as uninstalled or disabled here");
  expect(fs.existsSync(path.join(claudeDir, "isoplan", "live", "s1.json"))).toBe(false);
});

test("while a data layer of an earlier version holds the session's lock, fresh, the runner takes it over for a newer copy's hooks module, and otherwise doesn't report the session for it and tells that hooks module so; a stale lock counts for nothing", async () => {
  const v = versions();
  // A live process of its own stands in for the earlier version's data layer.
  const other = spawn(process.execPath, ["-e", "setTimeout(() => {}, 60000)"], { stdio: "ignore", windowsHide: true });
  children.push(other);
  const lockOf = (ageMs: number, version: string, since: number) => {
    fs.mkdirSync(path.dirname(v.lock), { recursive: true });
    fs.writeFileSync(v.lock, JSON.stringify({ pid: other.pid, dataLayer: path.join(v.claudeDir, "plugins", "cache", "isoplan", "isoplan", version, "dist", "data-layer.js"), detached: false, since, parent: other.pid }));
    const t = new Date(Date.now() - ageMs);
    fs.utimesSync(v.lock, t, t);
  };
  // Of the same copy, in a window that started later: left to it.
  lockOf(0, "0.3.0", 10);
  const refused = v.hooked("0.3.0", { since: 5 });
  const ended = await refused.done;
  expect(ended.why).toBe("an earlier version's data layer already reports this session");
  expect(refused.lines()).toContainEqual({ type: "superseded", reason: "earlier" });
  expect(v.holder()).toBe(other.pid);

  // Of an older copy: taken over.
  lockOf(0, "0.2.0", 10);
  const over = v.hooked("0.3.0", { since: 5 });
  await until(() => v.holder() === process.pid);
  expect(over.lines().some((l) => l.type === "superseded")).toBe(false);
  over.stop();
  await over.done;

  // Not refreshed for five minutes: its pid may be another process's.
  lockOf(5 * 60000, "0.3.0", 10);
  const taken = v.hooked("0.3.0", { since: 5 });
  await until(() => v.holder() === process.pid);
  expect(taken.lines().some((l) => l.type === "superseded")).toBe(false);
});

test("the session's context window reaches the office only once the hooks module has written it where the window line says", async () => {
  const o = await office();
  o.state.repos = ["github.com/team/app"];
  const v = versions(o.url);
  const file = path.join(v.claudeDir, "isoplan", "windows", "s1.json");
  // One left by an earlier run: the runner deletes it as it starts reporting for the hooks module, so it is never sent.
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ contextWindow: 200000 }));
  const r = v.hooked("0.2.0");
  await until(() => r.lines().some((l) => l.type === "window"));
  expect(r.lines().find((l) => l.type === "window")).toEqual({ type: "window", file });
  type Sent = { type: string; facts?: { session: Record<string, unknown> }; upsert?: { session?: Record<string, unknown> } };
  const sent = () => (o.state.connections[0]?.messages ?? []) as Sent[];
  await until(() => sent().some((m) => m.type === "full"));
  await wait(1500);
  expect(sent().find((m) => m.type === "full")!.facts!.session).not.toHaveProperty("contextWindow");
  // Without messages, the session doesn't say it takes messages from the floor.
  expect(sent().find((m) => m.type === "full")!.facts!.session).not.toHaveProperty("takesMessages");
  // It says its hooks module runs in it.
  expect(sent().find((m) => m.type === "full")!.facts!.session.hooks).toBe(true);
  expect(sent().some((m) => m.upsert?.session && "contextWindow" in m.upsert.session)).toBe(false);

  fs.writeFileSync(file, JSON.stringify({ contextWindow: 1000000 }));
  await until(() => sent().some((m) => m.upsert?.session?.contextWindow === 1000000));

  // Emptied, or written as null, mid-write: the data layer keeps running and the size stays.
  const upserts = () => sent().filter((m) => m.upsert?.session && "contextWindow" in m.upsert.session).length;
  const before = upserts();
  for (const text of ["", "null", '{"contextW']) {
    fs.writeFileSync(file, text);
    await wait(700);
  }
  expect(upserts()).toBe(before);
  fs.writeFileSync(file, JSON.stringify({ contextWindow: 200000 }));
  await until(() => sent().some((m) => m.upsert?.session?.contextWindow === 200000));
});

test("a session whose hooks module can submit says it takes messages; its owner's message goes to the hooks module and the reply to the office, and anyone else's is refused", async () => {
  const o = await office();
  o.state.repos = ["github.com/team/app"];
  const v = versions(o.url);
  const r = v.hooked("0.2.0", { takesMessages: true });
  type Sent = { type: string; id?: string; code?: string; account?: { id: string }; facts?: { session: Record<string, unknown> } };
  const sent = () => (o.state.connections[0]?.messages ?? []) as Sent[];
  await until(() => sent().some((m) => m.type === "full"));
  expect(sent().find((m) => m.type === "full")!.facts!.session.takesMessages).toBe(true);
  const owner = sent().find((m) => m.type === "hello")!.account!;
  const request = (id: string, from: { id: string; name: string }) => ({ type: "request", v: 1, id, kind: "owner-message", session: "claude-code:s1", from, text: "Now run the tests." });

  o.state.connections[0]!.send(request("m1", { id: "claude:someone-else", name: "Sam" }));
  await until(() => sent().some((m) => m.id === "m1"));
  expect(sent().find((m) => m.id === "m1")).toMatchObject({ type: "refusal", reason: "unavailable", code: "not-owner" });
  expect(r.lines().some((l) => l.type === "owner-message")).toBe(false);

  o.state.connections[0]!.send(request("m2", { id: owner.id, name: "Ada" }));
  await until(() => r.lines().some((l) => l.type === "owner-message"));
  const line = r.lines().find((l) => l.type === "owner-message") as unknown as { session: string; text: string; file: string };
  expect(line).toMatchObject({ session: "s1", text: "Now run the tests." });
  expect(path.dirname(line.file)).toBe(path.join(v.claudeDir, "isoplan", "messages", "s1"));
  fs.writeFileSync(line.file, JSON.stringify({ taken: true, queued: true }));
  await until(() => sent().some((m) => m.id === "m2"));
  expect(sent().find((m) => m.id === "m2")).toEqual({ type: "reply", v: 1, id: "m2", kind: "owner-message", queued: true });
});

test("several messages the owner sends back to back reach the hooks module in the order they were sent", async () => {
  const o = await office();
  o.state.repos = ["github.com/team/app"];
  const r = versions(o.url).hooked("0.2.0", { takesMessages: true });
  const sent = () => (o.state.connections[0]?.messages ?? []) as { type: string; account?: { id: string } }[];
  await until(() => sent().some((m) => m.type === "full"));
  const owner = sent().find((m) => m.type === "hello")!.account!;
  const texts = Array.from({ length: 8 }, (_, i) => `message ${i}`);
  for (const [i, text] of texts.entries()) o.state.connections[0]!.send({ type: "request", v: 1, id: `m${i}`, kind: "owner-message", session: "claude-code:s1", from: { id: owner.id, name: "Ada" }, text });
  const lines = () => r.lines().filter((l) => l.type === "owner-message");
  await until(() => lines().length === texts.length);
  expect(lines().map((l) => l.text)).toEqual(texts);
});

test("the runner refuses its owner's message for a session it reports and leaves no messages folder behind", async () => {
  const o = await office();
  o.state.repos = ["github.com/team/app"];
  const { claudeDir } = start(o.url);
  type Sent = { type: string; id?: string; account?: { id: string } };
  const sent = () => (o.state.connections[0]?.messages ?? []) as Sent[];
  await until(() => sent().some((m) => m.type === "full"));
  const owner = sent().find((m) => m.type === "hello")!.account!;
  o.state.connections[0]!.send({ type: "request", v: 1, id: "m1", kind: "owner-message", session: "claude-code:s1", from: { id: owner.id, name: "Ada" }, text: "hi" });
  await until(() => sent().some((m) => m.id === "m1"));
  expect(sent().find((m) => m.id === "m1")).toMatchObject({ type: "refusal", code: "detached" });
  expect(fs.existsSync(path.join(claudeDir, "isoplan", "messages"))).toBe(false);
});
