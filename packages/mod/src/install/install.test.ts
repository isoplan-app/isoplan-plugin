import fs from "node:fs";
import path from "node:path";
import { expect, test } from "vitest";
import { tempRoot } from "../data-layer/fixture.js";
import { runnerLockPath } from "../runner/start.js";
import {
  copiedAs,
  installWake,
  isUninstalling,
  recordedState,
  RUNNER_FILES,
  runnerAppDir,
  stopOurRunner,
  uninstall,
  uninstallInBackground,
  uninstallLockPath,
  uninstallLogPath,
  wakeCommand,
  wakeScriptPath,
} from "./install.js";

const other = { matcher: "Bash", hooks: [{ type: "command", command: "echo other" }] };

// A config folder with a dist/ beside it holding a stand-in data layer and wake script.
function setup(settings?: unknown) {
  const root = tempRoot();
  const claudeDir = path.join(root, ".claude");
  const dist = path.join(root, "dist");
  fs.mkdirSync(dist, { recursive: true });
  fs.writeFileSync(path.join(dist, "data-layer.js"), "");
  fs.writeFileSync(path.join(dist, "wake.js"), "// wake");
  const paths = { claudeDir, settings: path.join(claudeDir, "settings.json"), plugins: path.join(claudeDir, "plugins"), managed: path.join(root, "managed") };
  if (settings !== undefined) {
    fs.mkdirSync(claudeDir, { recursive: true });
    fs.writeFileSync(paths.settings, typeof settings === "string" ? settings : JSON.stringify(settings));
  }
  const install = () => installWake(paths, path.join(dist, "data-layer.js"), path.join(dist, "wake.js"));
  const read = () => JSON.parse(fs.readFileSync(paths.settings, "utf8"));
  const wake = { type: "command", command: wakeCommand(wakeScriptPath(claudeDir)), timeout: 10 };
  return { root, claudeDir, dist, paths, install, read, wake };
}

test("install: adds one hook on UserPromptSubmit and Stop, copies wake.mjs and records the data layer", async () => {
  const s = setup();
  const changes = await s.install();
  expect(changes).toHaveLength(4);
  expect(s.read()).toEqual({ hooks: { UserPromptSubmit: [{ hooks: [s.wake] }], Stop: [{ hooks: [s.wake] }] } });
  expect(s.wake.command).toMatch(/^node ".*\/\.claude\/isoplan\/wake\.mjs"$/);
  expect(fs.readFileSync(path.join(s.claudeDir, "isoplan", "wake.mjs"), "utf8")).toBe("// wake");
  expect(JSON.parse(fs.readFileSync(path.join(s.claudeDir, "isoplan", "wake.json"), "utf8"))).toEqual({ dataLayer: path.join(s.dist, "data-layer.js") });
});

test("install: a second run changes nothing and adds no second hook", async () => {
  const s = setup();
  await s.install();
  const before = fs.readFileSync(s.paths.settings, "utf8");
  expect(await s.install()).toEqual([]);
  expect(fs.readFileSync(s.paths.settings, "utf8")).toBe(before);
});

test("install: other hooks and settings are kept as they were", async () => {
  const s = setup({ model: "opus", hooks: { PreToolUse: [other], Stop: [other] } });
  await s.install();
  expect(s.read()).toEqual({ model: "opus", hooks: { PreToolUse: [other], Stop: [other, { hooks: [s.wake] }], UserPromptSubmit: [{ hooks: [s.wake] }] } });
});

test("install: this folder's wake hook in an old form is updated in place, a duplicate goes, and another folder's stays", async () => {
  const s = setup();
  const script = wakeScriptPath(s.claudeDir);
  // Unquoted with the platform's separators, or in another letter case where the file system ignores case.
  const old = { type: "command", command: `node ${script}` };
  const spelled = { type: "command", command: `node "${process.platform === "linux" ? script : script.toUpperCase().replace(/\\/g, "/")}"` };
  const another = { type: "command", command: 'node "C:/Other/.claude/isoplan/wake.mjs"' };
  // A path that only contains this one's is someone else's too.
  const longer = { type: "command", command: `node "${script}.old"` };
  fs.mkdirSync(s.claudeDir, { recursive: true });
  fs.writeFileSync(s.paths.settings, JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: "command", command: "echo mine" }, old] }, { hooks: [spelled, another, longer] }] } }));
  expect(await s.install()).toContain(`updated the wake hook in ${s.paths.settings} on Stop`);
  expect(s.read().hooks.Stop).toEqual([{ hooks: [{ type: "command", command: "echo mine" }, s.wake] }, { hooks: [another, longer] }]);
  await uninstall(s.paths);
  expect(s.read().hooks.Stop).toEqual([{ hooks: [{ type: "command", command: "echo mine" }] }, { hooks: [another, longer] }]);
});

test("install: a moved data layer is recorded again", async () => {
  const s = setup();
  await s.install();
  const moved = path.join(s.root, "v2", "data-layer.js");
  expect(await installWake(s.paths, moved, path.join(s.dist, "wake.js"))).toEqual([`recorded the data layer at ${moved}`]);
});

test("install: a settings.json that doesn't parse is left alone, and nothing is written", async () => {
  const s = setup("{ broken");
  await expect(s.install()).rejects.toThrow("isn't valid JSON; left it alone");
  expect(fs.readFileSync(s.paths.settings, "utf8")).toBe("{ broken");
  expect(fs.existsSync(path.join(s.claudeDir, "isoplan"))).toBe(false);
});

test("install: a symlinked settings.json stays a link, and a leading byte order mark is read past", async () => {
  const s = setup();
  const real = path.join(s.root, "dotfiles", "settings.json");
  fs.mkdirSync(path.dirname(real), { recursive: true });
  fs.writeFileSync(real, '﻿{"model":"opus"}');
  fs.mkdirSync(s.claudeDir, { recursive: true });
  fs.symlinkSync(real, s.paths.settings, "file");
  await s.install();
  expect(fs.lstatSync(s.paths.settings).isSymbolicLink()).toBe(true);
  expect(fs.readFileSync(real, "utf8")).toMatch(/^\{\n {2}"model": "opus",/);
  expect(fs.readdirSync(path.dirname(real))).toEqual(["settings.json"]);
});

test("uninstall: takes out the hooks and everything the plugin wrote, and keeps the files a person writes", async () => {
  const s = setup({ model: "opus", hooks: { Stop: [other] } });
  await s.install();
  const dir = path.join(s.claudeDir, "isoplan");
  for (const file of ["live/s1.json", "logs/runner.log", "titles/s1.json", "released/s1.json", "pairing.json", "pairing.lock", "pairing.write.lock", "update.json", "update.lock", "waits/s1/q1.json", "answers/s1/q1.json", "windows/s1.json", "handoffs/h1/taken.json", "handoffs/out/h2/brief.md", "handoffs/sessions/s1.json", "offices/0123456789ab/approved.json", "offices/0123456789ab/pairing.lock", "offices/0123456789ab/released/s1.json", "approved.json", "runner/ledger.json", "runner/environment.json", "pipe/runner-0123456789abcdef.sock", "config.json", "runner.json", "secret-patterns.json"]) {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.writeFileSync(path.join(dir, file), "{}");
  }
  fs.writeFileSync(path.join(dir, "claude-binary.json"), JSON.stringify({ path: "/bin/claude", auto: true }));
  const { changes, isDone } = await uninstall(s.paths);
  expect(isDone).toBe(true);
  expect(changes).toContain(`removed the wake hook from ${s.paths.settings} on UserPromptSubmit`);
  expect(s.read()).toEqual({ model: "opus", hooks: { Stop: [other] } });
  expect(fs.readdirSync(dir).sort()).toEqual(["config.json", "runner.json", "secret-patterns.json"]);
  expect((await uninstall(s.paths)).changes).toEqual([]);

  // With nothing of the person's in it, the folder goes too; a claude binary set by hand stays.
  fs.rmSync(dir, { recursive: true });
  await s.install();
  expect((await uninstall(s.paths)).changes).toContain(`removed ${dir}`);
  expect(fs.existsSync(dir)).toBe(false);
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, "claude-binary.json"), JSON.stringify({ path: "D:/tools/claude.exe" }));
  await uninstall(s.paths);
  expect(fs.readdirSync(dir)).toEqual(["claude-binary.json"]);
});

test("uninstall: a settings.json that doesn't parse stops it before the hooks, with wake.mjs kept and settings.json not written", async () => {
  const s = setup();
  await s.install();
  fs.writeFileSync(s.paths.settings, "{ broken");
  await expect(uninstall(s.paths)).rejects.toThrow("isn't valid JSON; left it alone");
  expect(fs.readFileSync(s.paths.settings, "utf8")).toBe("{ broken");
  expect(fs.readdirSync(path.join(s.claudeDir, "isoplan")).sort()).toEqual(["wake.json", "wake.mjs"]);
});

test("uninstall: a plugin installed again part way stops it, with the hooks and wake.mjs still in place", async () => {
  const s = setup();
  await s.install();
  fs.mkdirSync(path.join(s.claudeDir, "isoplan", "logs"));
  let asked = 0;
  const { changes, isDone } = await uninstall(s.paths, { confirm: async () => ++asked < 3 });
  expect(isDone).toBe(false);
  expect(changes[changes.length - 1]).toBe("stopped: Claude Code lists the plugin as installed again");
  expect(s.read().hooks.UserPromptSubmit).toEqual([{ hooks: [s.wake] }]);
  expect(fs.existsSync(wakeScriptPath(s.claudeDir))).toBe(true);
});

test("uninstall: with confirm, a session's files written again during it keep the hooks for a later try", async () => {
  const s = setup();
  await s.install();
  const live = path.join(s.claudeDir, "isoplan", "live");
  let asked = 0;
  // A session's data layer takes its lock again while the uninstall runs, after live/ went.
  const confirm = async () => (++asked === 8 && fs.mkdirSync(live, { recursive: true }), true);
  const first = await uninstall(s.paths, { confirm });
  expect(first.isDone).toBe(false);
  expect(first.changes[first.changes.length - 1]).toMatch(/wrote its files again; the hook stays/);
  expect(s.read().hooks.Stop).toEqual([{ hooks: [s.wake] }]);
  expect((await uninstall(s.paths, { confirm: async () => true })).isDone).toBe(true);
  expect(fs.existsSync(path.join(s.claudeDir, "isoplan"))).toBe(false);
});

test("uninstall: stops the runner, and one with a stale lock only when its command line is this folder's runner", async () => {
  const s = setup();
  const lock = runnerLockPath(s.claudeDir);
  const runner = path.join(runnerAppDir(s.claudeDir), "dist", "runner.mjs");
  const writeLock = (ageMs: number) => {
    fs.mkdirSync(path.dirname(lock), { recursive: true });
    fs.writeFileSync(lock, JSON.stringify({ pid: 4242, code: "1-1" }));
    const t = new Date(Date.now() - ageMs);
    fs.utimesSync(lock, t, t);
  };
  let living = true;
  const killed: number[] = [];
  const options = (command: string | null) => ({ isAlive: () => living, kill: (pid: number) => (killed.push(pid), (living = false)), commandOf: async () => command, waitMs: 1000 });
  writeLock(0);
  expect(await stopOurRunner(s.claudeDir, options(null))).toBe(true);
  expect(killed).toEqual([4242]);
  expect(fs.existsSync(lock)).toBe(false);

  living = true;
  writeLock(10 * 60000);
  expect(await stopOurRunner(s.claudeDir, options("C:/Windows/notepad.exe"))).toBe(false);
  expect(await stopOurRunner(s.claudeDir, { isAlive: () => true })).toBe(false); // no way to tell
  expect(await stopOurRunner(s.claudeDir, options(`node ${runner} --claude-dir ${s.claudeDir}`))).toBe(true);
  expect(killed).toEqual([4242, 4242]);

  await s.install();
  writeLock(0);
  living = true;
  expect((await uninstall(s.paths, { runner: options(null) })).changes).toContain("stopped the runner, which answered for this machine's rooms");
});

test("uninstall with optOut: wake.json stays, marked, so the plugin's data layer leaves the hook out; the install script puts it back", async () => {
  const s = setup();
  await s.install();
  expect((await uninstall(s.paths, { optOut: true })).changes).toContain(`marked the wake hook as uninstalled in ${path.join(s.claudeDir, "isoplan", "wake.json")}, so the plugin won't put it back`);
  expect(fs.readdirSync(path.join(s.claudeDir, "isoplan"))).toEqual(["wake.json"]);
  expect(JSON.parse(fs.readFileSync(path.join(s.claudeDir, "isoplan", "wake.json"), "utf8"))).toEqual({ disabled: true });
  expect((await uninstall(s.paths, { optOut: true })).changes).toEqual([]);

  expect(await installWake(s.paths, path.join(s.dist, "data-layer.js"), path.join(s.dist, "wake.js"), { auto: true })).toEqual([]);
  expect(s.read().hooks).toBeUndefined();
  await s.install();
  expect(s.read().hooks.UserPromptSubmit).toEqual([{ hooks: [s.wake] }]);
});

// A plugin installed from the marketplace: its data layer is in Claude Code's cache.
function marketplace() {
  const s = setup();
  const dataLayer = path.join(s.paths.plugins, "cache", "isoplan", "isoplan", "0.1.0", "dist", "data-layer.js");
  fs.mkdirSync(path.dirname(dataLayer), { recursive: true });
  fs.writeFileSync(dataLayer, "");
  const record = (ids: string[]) => {
    fs.mkdirSync(s.paths.plugins, { recursive: true });
    fs.writeFileSync(path.join(s.paths.plugins, "installed_plugins.json"), JSON.stringify({ version: 2, plugins: Object.fromEntries(ids.map((id) => [id, [{ scope: "user" }]])) }));
  };
  const auto = () => installWake(s.paths, dataLayer, path.join(s.dist, "wake.js"), { auto: true });
  return { ...s, dataLayer, record, auto };
}

test("uninstalled: the plugin's data layer doesn't put the hook back, and an unknown record never counts as uninstalled", async () => {
  const s = marketplace();
  // No installed_plugins.json, or one of a shape not known: unknown, so it installs.
  expect(await s.auto()).not.toEqual([]);
  fs.writeFileSync(path.join(s.paths.plugins, "installed_plugins.json"), JSON.stringify({ version: 2, plugins: { "isoplan@isoplan": {} } }));
  expect(await recordedState(s.paths)).toBe("enabled");
  s.record(["other@market"]);
  expect(await recordedState(s.paths)).toBe("uninstalled");
  await uninstall(s.paths);
  expect(await s.auto()).toEqual([]);
  expect(fs.existsSync(path.join(s.claudeDir, "isoplan"))).toBe(false);
});

test("uninstall in the background: holds a lock, says why it failed and holds off a day, and gives way to a reinstall", async () => {
  const s = marketplace();
  await s.auto();
  s.record(["other@market"]);
  fs.writeFileSync(s.paths.settings, "{ broken");
  expect(await isUninstalling(s.claudeDir)).toBe(false);
  await uninstallInBackground(s.paths, { recheckMs: 0 });
  expect(fs.readFileSync(uninstallLogPath(s.claudeDir), "utf8")).toMatch(/isn't valid JSON; left it alone\. Trying again in a day/);
  expect(await isUninstalling(s.claudeDir)).toBe(true);
  expect(fs.existsSync(wakeScriptPath(s.claudeDir))).toBe(true);
  // Held off: nothing happens until the day is out.
  fs.writeFileSync(s.paths.settings, "{}");
  await uninstallInBackground(s.paths, { recheckMs: 0 });
  expect(fs.existsSync(wakeScriptPath(s.claudeDir))).toBe(true);
  await uninstallInBackground(s.paths, { now: () => Date.now() + 25 * 3600000, recheckMs: 0 });
  expect(fs.existsSync(path.join(s.claudeDir, "isoplan"))).toBe(false);

  // Installed again before it starts: it stops at once, leaves no log, and lets go of its lock.
  const t = marketplace();
  await t.auto();
  t.record(["isoplan@isoplan"]);
  await uninstallInBackground(t.paths, { recheckMs: 0 });
  expect(fs.existsSync(uninstallLogPath(t.claudeDir))).toBe(false);
  expect(await isUninstalling(t.claudeDir)).toBe(false);
  expect(t.read().hooks.Stop).toEqual([{ hooks: [t.wake] }]);
});

test("uninstall in the background: an uninstalled reading that doesn't hold a few seconds later (an update rewriting the record) removes nothing", async () => {
  const s = marketplace();
  await s.auto();
  s.record(["other@market"]);
  const running = uninstallInBackground(s.paths, { recheckMs: 300 });
  s.record(["isoplan@isoplan"]);
  await running;
  expect(fs.existsSync(wakeScriptPath(s.claudeDir))).toBe(true);
  expect(s.read().hooks.Stop).toEqual([{ hooks: [s.wake] }]);
  expect(await isUninstalling(s.claudeDir)).toBe(false);
});

test("uninstall: takes out the auto-update the plugin turned on from an entry nothing else changed, and otherwise leaves it on", async () => {
  const source = { source: "github", repo: "isoplan-app/isoplan-plugin" };
  const added = (entry: unknown) => JSON.stringify({ checkedAt: 1, autoUpdateOn: { marketplace: "isoplan", entry: JSON.stringify(entry), at: 1 } });
  const s = setup({ extraKnownMarketplaces: { isoplan: { source, autoUpdate: true }, other: { source, autoUpdate: true } } });
  await s.install();
  fs.writeFileSync(path.join(s.claudeDir, "isoplan", "update.json"), added({ source, autoUpdate: true }));
  expect((await uninstall(s.paths)).changes).toContain(`took out the auto-update the plugin turned on for the isoplan marketplace in ${s.paths.settings}`);
  expect(s.read()).toEqual({ extraKnownMarketplaces: { isoplan: { source }, other: { source, autoUpdate: true } } });

  // Not recorded as the plugin's, or the entry changed since: left on.
  const t = setup({ extraKnownMarketplaces: { isoplan: { source, autoUpdate: true } } });
  await t.install();
  await uninstall(t.paths);
  expect(t.read()).toEqual({ extraKnownMarketplaces: { isoplan: { source, autoUpdate: true } } });
  const moved = { source: "git", url: "https://git.example.com/isoplan.git" };
  const u = setup({ extraKnownMarketplaces: { isoplan: { source: moved, autoUpdate: true } } });
  await u.install();
  fs.writeFileSync(path.join(u.claudeDir, "isoplan", "update.json"), added({ source, autoUpdate: true }));
  await uninstall(u.paths);
  expect(u.read()).toEqual({ extraKnownMarketplaces: { isoplan: { source: moved, autoUpdate: true } } });
});

test("install: every prompt the runner reads is among the runner's files it copies", () => {
  const prompts = fs.readdirSync(path.join(import.meta.dirname, "..", "..", "prompts")).map((name) => `prompts/${name}`);
  expect(prompts).toContain("prompts/naming.md");
  for (const file of prompts) expect(RUNNER_FILES).toContain(file);
});

test("install: copies the runner and its defaults out of the plugin's folder, and records the copy", async () => {
  const s = setup();
  // A stand-in plugin folder holding the runner's files.
  const plugin = path.join(s.root, "plugin-1.0.0");
  for (const file of RUNNER_FILES) {
    fs.mkdirSync(path.dirname(path.join(plugin, file)), { recursive: true });
    fs.writeFileSync(path.join(plugin, file), `// ${file} v1`);
  }
  const install = () => installWake(s.paths, path.join(s.dist, "data-layer.js"), path.join(s.dist, "wake.js"), { runnerFrom: plugin });
  const app = runnerAppDir(s.claudeDir);
  const runner = path.join(app, "dist", "runner.mjs");
  const changes = await install();
  expect(changes).toContain(`copied the runner to ${app}`);
  expect(changes).toContain(`recorded the data layer at ${path.join(s.dist, "data-layer.js")} and the runner at ${runner}`);
  for (const file of RUNNER_FILES) expect(fs.readFileSync(path.join(app, copiedAs(file)), "utf8")).toBe(`// ${file} v1`);
  expect(JSON.parse(fs.readFileSync(path.join(s.claudeDir, "isoplan", "wake.json"), "utf8"))).toEqual({ dataLayer: path.join(s.dist, "data-layer.js"), runner });
  expect(await install()).toEqual([]);
  // The plugin folder is replaced by an update; the copy is too, and the old folder can go.
  fs.writeFileSync(path.join(plugin, "dist", "runner.js"), "// v2");
  expect(await install()).toEqual([`copied the runner to ${app}`]);
  expect(fs.readFileSync(runner, "utf8")).toBe("// v2");
});

test("install: records the claude binary it finds, and keeps one set by hand", async () => {
  const s = setup();
  const claude = path.join(s.root, "bin", "claude.exe");
  const install = (found: string | null) => installWake(s.paths, path.join(s.dist, "data-layer.js"), path.join(s.dist, "wake.js"), { findClaude: async () => found });
  const record = path.join(s.claudeDir, "isoplan", "claude-binary.json");
  expect(await install(claude)).toContain(`recorded the claude binary at ${claude}`);
  expect(JSON.parse(fs.readFileSync(record, "utf8"))).toEqual({ path: claude, auto: true });
  // Found again unchanged, nothing is written; not found, the old record stays.
  expect(await install(claude)).toEqual([]);
  expect(await install(null)).toEqual([]);
  // Found somewhere new, an install's own record moves; one set by hand stays.
  expect(await install("/elsewhere/claude")).toEqual(["recorded the claude binary at /elsewhere/claude"]);
  fs.writeFileSync(record, JSON.stringify({ path: "D:/tools/claude.exe" }));
  expect(await install(claude)).toEqual([]);
  expect(JSON.parse(fs.readFileSync(record, "utf8"))).toEqual({ path: "D:/tools/claude.exe" });
});

test("install: waits for a running uninstall, and clears a failed one's hold-off and log", async () => {
  const s = setup();
  const dir = path.join(s.claudeDir, "isoplan");
  fs.mkdirSync(dir, { recursive: true });
  // An uninstall running in this very process, so its pid is alive.
  fs.writeFileSync(uninstallLockPath(s.claudeDir), JSON.stringify({ pid: process.pid }));
  const dataLayer = path.join(s.dist, "data-layer.js");
  expect(await installWake(s.paths, dataLayer, path.join(s.dist, "wake.js"), { auto: true, waitMs: 300 })).toEqual([]);
  expect(fs.existsSync(s.paths.settings)).toBe(false);
  await expect(installWake(s.paths, dataLayer, path.join(s.dist, "wake.js"), { waitMs: 300 })).rejects.toThrow("an uninstall is running");

  fs.writeFileSync(uninstallLockPath(s.claudeDir), JSON.stringify({ pid: 0, until: Date.now() + 3600000 }));
  fs.writeFileSync(uninstallLogPath(s.claudeDir), "it failed\n");
  const changes = await installWake(s.paths, dataLayer, path.join(s.dist, "wake.js"), { auto: true, waitMs: 300 });
  expect(changes).toContain(`removed ${uninstallLockPath(s.claudeDir)}, left by an uninstall that didn't finish`);
  expect(fs.existsSync(uninstallLogPath(s.claudeDir))).toBe(false);
  expect(s.read().hooks.Stop).toEqual([{ hooks: [s.wake] }]);
});

test("install: once the hook was uninstalled, the plugin's data layer finishes what that uninstall left", async () => {
  const s = setup();
  await s.install();
  // An uninstall that stopped after taking the hooks out: the opt-out and wake.mjs are still there.
  fs.writeFileSync(path.join(s.claudeDir, "isoplan", "wake.json"), JSON.stringify({ disabled: true }));
  fs.writeFileSync(s.paths.settings, "{}");
  expect(await installWake(s.paths, path.join(s.dist, "data-layer.js"), path.join(s.dist, "wake.js"), { auto: true })).toEqual([`removed ${wakeScriptPath(s.claudeDir)}, left by an uninstall`]);
  expect(fs.readdirSync(path.join(s.claudeDir, "isoplan"))).toEqual(["wake.json"]);
});

test("claude-binary.json that doesn't parse is kept, by install and uninstall alike, and said so", async () => {
  const s = setup();
  const record = path.join(s.claudeDir, "isoplan", "claude-binary.json");
  fs.mkdirSync(path.dirname(record), { recursive: true });
  fs.writeFileSync(record, '{ "path": "D:/tools/claude.exe" ');
  const changes = await installWake(s.paths, path.join(s.dist, "data-layer.js"), path.join(s.dist, "wake.js"), { findClaude: async () => "/bin/claude" });
  expect(changes).toContain(`kept ${record}, which doesn't parse: it may have been edited by hand`);
  expect((await uninstall(s.paths)).changes).toContain(`kept ${record}, which doesn't parse: it may have been edited by hand`);
  expect(fs.readFileSync(record, "utf8")).toBe('{ "path": "D:/tools/claude.exe" ');
});
