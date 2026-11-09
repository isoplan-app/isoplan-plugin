import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { expect, test } from "vitest";
import { tempRoot } from "../data-layer/fixture.js";
import { createRegistry, drivenName, infoCommand, isOurs, parsePsInfo, parseRegistry, parseWindowsInfo, processInfo, registryPath, SPAWN_MATCH_MS, type ProcessRecord } from "./registry.js";

const UUID = "11111111-1111-4111-8111-111111111111";
const AT = "2026-11-06T10:00:00.000Z";
const driven: ProcessRecord = {
  kind: "driven",
  pid: 4242,
  spawned: AT,
  session: `claude-code:${UUID}`,
  folder: "C:\\Users\\ada\\app",
  started: AT,
  lastActivity: AT,
  state: "idle",
  driven: { room: "room-1", project: "github.com/ada/app", office: "wss://office.example", owner: "claude:ada", permissions: "auto", transcript: true },
};

test("registry: one versioned file, written whole by a rename, so a reader never sees half of it", async () => {
  const root = tempRoot();
  const file = registryPath(path.join(root, ".claude"));
  expect(file).toBe(path.join(root, ".claude", "isoplan", "runner", "processes.json"));
  const registry = createRegistry({ file, log: () => {}, pid: 77, now: () => Date.parse(AT) });
  registry.put(driven);
  registry.put({ ...driven, state: "working" });
  await registry.flushed();
  expect(JSON.parse(fs.readFileSync(file, "utf8"))).toEqual({ about: expect.stringContaining("README"), version: 1, runner: 77, written: AT, processes: [{ ...driven, state: "working" }] });
  expect(fs.readdirSync(path.dirname(file))).toEqual(["processes.json"]);
  expect(parseRegistry(JSON.stringify({ version: 2, processes: [driven] }))).toBe(null);
  expect(parseRegistry("{ not json")).toBe(null);
  registry.remove(driven.session);
  await registry.flushed();
  expect(JSON.parse(fs.readFileSync(file, "utf8")).processes).toEqual([]);
});

test("registry: a fork is in while it runs and out once it closes; as the worker exits, driven sessions stay with no process", async () => {
  const root = tempRoot();
  const file = registryPath(root);
  const registry = createRegistry({ file, log: () => {} });
  const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 300)"], { stdio: "ignore", windowsHide: true });
  registry.track(child, { kind: "fork", session: `claude-code:${UUID}`, folder: root });
  registry.put(driven);
  expect(registry.list().map((r) => [r.kind, r.pid])).toEqual([
    ["fork", child.pid],
    ["driven", 4242],
  ]);
  await new Promise((r) => child.once("close", r));
  await registry.flushed();
  expect(JSON.parse(fs.readFileSync(file, "utf8")).processes.map((r: ProcessRecord) => r.kind)).toEqual(["driven"]);
  const other = spawn(process.execPath, ["-e", "setTimeout(() => {}, 5000)"], { stdio: "ignore", windowsHide: true });
  registry.track(other, { kind: "desktop-read", session: `claude-code:${UUID}`, folder: root });
  registry.closeSync();
  other.kill();
  expect(JSON.parse(fs.readFileSync(file, "utf8")).processes).toEqual([{ ...driven, pid: null, spawned: null, state: "closed" }]);
});

test("registry: the write as the worker exits has a file of its own beside it, so a save still being written can't be mixed into it", async () => {
  const root = tempRoot();
  const file = registryPath(root);
  const registry = createRegistry({ file, log: () => {}, pid: 77 });
  registry.put(driven);
  await registry.flushed();
  // What a save still being written has written so far.
  fs.writeFileSync(`${file}.77.tmp`, "{ half");
  registry.closeSync();
  expect(fs.readFileSync(`${file}.77.tmp`, "utf8")).toBe("{ half");
  expect(JSON.parse(fs.readFileSync(file, "utf8")).processes).toEqual([{ ...driven, pid: null, spawned: null, state: "closed" }]);
});

test("restore: a file that can't be read, or is of another version, ends nothing, keeps nothing, and is written anew", async () => {
  for (const text of ["{ not json", JSON.stringify({ version: 2, processes: [driven] })]) {
    const root = tempRoot();
    const file = registryPath(root);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
    const killed: number[] = [];
    const logs: string[] = [];
    // Every pid alive, and each would pass as Isoplan's: still nothing is ended.
    const registry = createRegistry({ file, log: (l) => void logs.push(l), pid: 77, now: () => Date.parse(AT), isAlive: () => true, info: async () => ({ startMs: Date.parse(AT), command: `claude -p --resume ${UUID}` }), kill: (p) => void killed.push(p) });
    await registry.restore();
    expect(killed).toEqual([]);
    expect(registry.list()).toEqual([]);
    expect(JSON.parse(fs.readFileSync(file, "utf8"))).toMatchObject({ version: 1, runner: 77, processes: [] });
    expect(logs).toEqual([expect.stringContaining("couldn't be read, or is of another version, so nothing in it was ended or kept")]);
  }
});

test("identity: Windows asks PowerShell's Win32_Process, a Mac and Linux ps; each answer gives the start time and the command line", () => {
  expect(infoCommand(4242, "win32").slice(0, 4)).toEqual(["powershell.exe", "-NoProfile", "-NonInteractive", "-Command"]);
  expect(infoCommand(4242, "win32")[4]).toContain('Get-CimInstance Win32_Process -Filter "ProcessId = 4242"');
  for (const platform of ["darwin", "linux"] as const) expect(infoCommand(4242, platform)).toEqual(["ps", "-o", "etime=", "-o", "command=", "-p", "4242"]);
  expect(parseWindowsInfo(`1793926662883\r\nC:\\Users\\ada\\.local\\bin\\claude.exe -p --resume ${UUID}\r\n`)).toEqual({ startMs: 1793926662883, command: `C:\\Users\\ada\\.local\\bin\\claude.exe -p --resume ${UUID}` });
  expect(parseWindowsInfo("")).toBe(null);
  const now = Date.parse(AT);
  expect(parsePsInfo(`   05:07 /Users/ada/.local/bin/claude -p --resume ${UUID}\n`, now)).toEqual({ startMs: now - 307000, command: `/Users/ada/.local/bin/claude -p --resume ${UUID}` });
  expect(parsePsInfo(" 2-03:04:05 claude -p", now)).toEqual({ startMs: now - (2 * 86400 + 3 * 3600 + 4 * 60 + 5) * 1000, command: "claude -p" });
  expect(parsePsInfo("", now)).toBe(null);
});

test("identity: a process is Isoplan's only when it started when the record says and its command line names the session", () => {
  const start = Date.parse(AT);
  const command = `claude -p --resume ${UUID} --input-format stream-json`;
  expect(isOurs(driven, { startMs: start + 2000, command })).toBe(true);
  expect(isOurs(driven, { startMs: start + SPAWN_MATCH_MS + 1, command })).toBe(false);
  expect(isOurs(driven, { startMs: start, command: "notepad.exe" })).toBe(false);
  expect(isOurs({ ...driven, spawned: null }, { startMs: start, command })).toBe(false);
  expect(isOurs(driven, null)).toBe(false);
});

test("identity: on this machine, a running process's start time and command line, as the OS says", async () => {
  const marker = `isoplan-${UUID}`;
  const spawned = Date.now();
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)", "--", marker], { stdio: "ignore", windowsHide: true });
  try {
    const info = await processInfo(child.pid!);
    expect(info?.command).toContain(marker);
    expect(Math.abs(info!.startMs - spawned)).toBeLessThan(SPAWN_MATCH_MS);
  } finally {
    child.kill();
  }
});

test("drivenName: the name the runner wrote from a driven session's first instruction, for its data layer; a take's name, or none, gives null", async () => {
  const file = registryPath(path.join(tempRoot(), ".claude"));
  expect(await drivenName(file, driven.session)).toBeNull();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const take = { ...driven, session: "claude-code:take", driven: { ...driven.driven!, name: "Isoplan handoff h1" } };
  fs.writeFileSync(file, JSON.stringify({ version: 1, processes: [{ ...driven, driven: { ...driven.driven!, name: "Fix the login page", named: true } }, take] }));
  expect(await drivenName(file, driven.session)).toBe("Fix the login page");
  expect(await drivenName(file, "claude-code:take")).toBeNull();
  expect(await drivenName(file, "claude-code:other")).toBeNull();
});
