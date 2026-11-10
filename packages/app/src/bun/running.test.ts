import path from "node:path";
import { expect, test } from "vitest";
import type { RunnerStatus } from "../../../mod/src/runner/status.js";
import type { Proc } from "./processes.ts";
import { commandPaths, parseClaudeSession, runningView, workTreeFinder, type RunningInput } from "./running.ts";

const T = Date.parse("2026-11-10T12:00:00Z");
const MB = 1024 * 1024;
const at = (ms: number) => new Date(ms).toISOString();

const status: RunnerStatus = {
  pid: 50,
  offices: [],
  pairs: [],
  sessions: [
    { name: "Fix login", headless: true, close: "claude-code:u-d", folder: "C:\\w\\app", id: "u-d", pid: 100 },
    { name: "site", headless: false, folder: "C:\\w\\site\\src", id: "u-t" },
    { name: "docs", headless: false, folder: "C:\\w\\site", id: "u-gone" },
  ],
};
const proc = (pid: number, ppid: number, name: string, command: string, startMs: number, memory: number, cwd?: string): Proc => ({ pid, ppid, name, command, startMs, memory, ...(cwd && { cwd }) });
const processes: Proc[] = [
  proc(50, 1, "bun.exe", "C:\\Users\\ada\\AppData\\Local\\Programs\\Isoplan\\bin\\bun.exe", T - 9000, 80 * MB),
  proc(100, 50, "claude.exe", "claude -p --resume u-d", T - 5000, 300 * MB),
  proc(101, 100, "node.exe", "node C:\\w\\app\\node_modules\\vitest\\vitest.mjs", T - 4000, 60 * MB),
  proc(150, 1, "pwsh.exe", "pwsh.exe", T - 8000, 30 * MB),
  proc(200, 150, "claude.exe", "claude", T - 7000, 250 * MB),
  proc(201, 200, "bash.exe", 'bash -c "API=sk-SECRET pnpm test"', T - 3000, 4 * MB),
  // Its session's process ended: a stray, by the path in its command line.
  proc(400, 999, "node.exe", "node C:\\w\\app\\node_modules\\vite\\bin\\vite.js --port 5173", T - 6000, 90 * MB),
  // No path of its own: in the folder of what started it.
  proc(401, 400, "esbuild.exe", "esbuild --service=0.25", T - 5900, 20 * MB),
  // In no work tree.
  proc(500, 1, "explorer.exe", "C:\\Windows\\Explorer.EXE", T - 99_000, 120 * MB),
  // Its parent's pid is the session's, but it started before it: that pid was reused, so it isn't the session's.
  proc(600, 100, "node.exe", '"C:\\Program Files\\nodejs\\node.exe" "C:\\w\\site\\scripts\\watch.js"', T - 20_000, 40 * MB),
];
const trees = new Set(["C:\\w\\app\\.git", "C:\\w\\site\\.git"]);
const input = (over: Partial<RunningInput> = {}): RunningInput => ({
  status,
  processes,
  claudeSessions: [
    { pid: 200, sessionId: "u-t", startedAt: T - 6800, status: "busy" },
    // A record left by a process that has gone, whose pid another has now.
    { pid: 150, sessionId: "u-gone", startedAt: T - 900_000, status: "idle" },
  ],
  workTree: workTreeFinder((p) => trees.has(p), path.win32),
  cut: (command) => command.replace("sk-SECRET", "[secret cut]"),
  refreshMs: 5000,
  ...over,
});

test("what's running: each folder lists its sessions with their processes, and the processes there that belong to no session; with memory per folder and in all", () => {
  expect(runningView(input())).toEqual({
    sessionsListed: true,
    processesListed: true,
    refreshMs: 5000,
    memory: (300 + 60 + 90 + 20 + 250 + 4 + 40) * MB,
    folders: [
      {
        folder: "C:\\w\\app",
        memory: (300 + 60 + 90 + 20) * MB,
        sessions: [
          {
            name: "Fix login",
            how: "from the floor",
            found: true,
            processes: [
              { pid: 100, name: "claude.exe", command: "claude -p --resume u-d", started: at(T - 5000), memory: 300 * MB, parent: { pid: 50, name: "bun.exe" }, session: "Fix login" },
              { pid: 101, name: "node.exe", command: "node C:\\w\\app\\node_modules\\vitest\\vitest.mjs", started: at(T - 4000), memory: 60 * MB, parent: { pid: 100, name: "claude.exe" }, session: "Fix login" },
            ],
          },
        ],
        strays: [
          { pid: 400, name: "node.exe", command: "node C:\\w\\app\\node_modules\\vite\\bin\\vite.js --port 5173", started: at(T - 6000), memory: 90 * MB, parent: { pid: 999 }, session: null },
          { pid: 401, name: "esbuild.exe", command: "esbuild --service=0.25", started: at(T - 5900), memory: 20 * MB, parent: { pid: 400, name: "node.exe" }, session: null },
        ],
      },
      {
        // The terminal session's folder is the work tree its folder is in.
        folder: "C:\\w\\site",
        memory: (250 + 4 + 40) * MB,
        sessions: [
          // Claude Code's record of it names a process that started at another time: not believed.
          { name: "docs", how: "in a terminal or the Claude app", found: false, processes: [] },
          {
            name: "site",
            how: "in a terminal or the Claude app",
            state: "working",
            found: true,
            processes: [
              { pid: 200, name: "claude.exe", command: "claude", started: at(T - 7000), memory: 250 * MB, parent: { pid: 150, name: "pwsh.exe" }, session: "site" },
              { pid: 201, name: "bash.exe", command: 'bash -c "API=[secret cut] pnpm test"', started: at(T - 3000), memory: 4 * MB, parent: { pid: 200, name: "claude.exe" }, session: "site" },
            ],
          },
        ],
        strays: [{ pid: 600, name: "node.exe", command: '"C:\\Program Files\\nodejs\\node.exe" "C:\\w\\site\\scripts\\watch.js"', started: at(T - 20_000), memory: 40 * MB, parent: { pid: 100 }, session: null }],
      },
    ],
  });
});

test("what's running: on macOS a process's working folder places it; how each kind of session runs is said", () => {
  const view = runningView(
    input({
      status: {
        ...status,
        sessions: [
          { name: "api", headless: true, close: "pid:12", fork: true, folder: "/w/api", id: "u-l", pid: 12 },
          { name: "take", headless: true, close: "pid:13", folder: "/w/api", id: "u-k", pid: 13 },
          { name: "bg", headless: true, folder: "/w/api", id: "u-b" },
        ],
      },
      processes: [proc(12, 1, "claude", "claude -p", T, MB), proc(30, 1, "node", "node server.js", T, 2 * MB, "/w/api/server"), proc(31, 1, "zsh", "-zsh", T, MB, "/Users/ada")],
      claudeSessions: [],
      workTree: workTreeFinder((p) => p === "/w/api/.git", path.posix),
    }),
  );
  expect(view.folders.map((f) => f.folder)).toEqual(["/w/api"]);
  expect(view.folders[0]!.sessions.map((s) => [s.name, s.how, s.found])).toEqual([
    ["api", "a fork answering for its room", true],
    ["bg", "headless", false],
    ["take", "a take's first turn", false],
  ]);
  expect(view.folders[0]!.strays.map((p) => p.pid)).toEqual([30]);
});

test("what's running: with the runner not running, every process is in no session; unreadable secret patterns show no command; an OS that can't be asked lists none", () => {
  const stopped = runningView(input({ status: null, cut: () => null }));
  expect(stopped.sessionsListed).toBe(false);
  expect(stopped.folders.flatMap((f) => f.sessions)).toEqual([]);
  expect(stopped.folders.flatMap((f) => f.strays.map((p) => p.pid))).toEqual([400, 401, 101, 600]);
  expect(stopped.folders.flatMap((f) => f.strays.map((p) => p.command))).toEqual([null, null, null, null]);
  // A runner older than the window lists sessions without their folders.
  const older = runningView(input({ status: { ...status, sessions: [{ name: "app", headless: false } as never] } }));
  expect([older.sessionsListed, older.folders.flatMap((f) => f.sessions)]).toEqual([false, []]);
  const unlisted = runningView(input({ processes: null }));
  expect(unlisted.processesListed).toBe(false);
  expect(unlisted.folders.flatMap((f) => f.sessions.map((s) => s.found))).toEqual([false, false, false]);
  expect(unlisted.memory).toBe(0);
});

test("what's running: paths are read from a command line quoted or not, and after a flag's =; Claude Code's session record is read for its pid, id, start and status", () => {
  expect(commandPaths('"C:\\Program Files\\nodejs\\node.exe" C:\\w\\app\\x.js --dir=C:\\w\\b; /usr/bin/env --flag x')).toEqual(["C:\\Program Files\\nodejs\\node.exe", "C:\\w\\app\\x.js", "C:\\w\\b", "/usr/bin/env"]);
  expect(parseClaudeSession(JSON.stringify({ pid: 7, sessionId: "u", startedAt: 1, status: "idle", cwd: "C:\\w" }))).toEqual({ pid: 7, sessionId: "u", startedAt: 1, status: "idle" });
  expect(parseClaudeSession("{}")).toBeNull();
  expect(parseClaudeSession("nope")).toBeNull();
});
