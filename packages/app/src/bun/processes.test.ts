import { expect, test } from "vitest";
import { listCommands, listProcesses, parseLsofCwd, parsePsList, parseWindowsList, type Run } from "./processes.ts";

const NOW = Date.parse("2026-11-10T12:00:00Z");

test("processes: on Windows one hidden PowerShell call lists this logon session's processes whose command line can be read", async () => {
  const [file, ...args] = listCommands("win32", -1).ps;
  expect(file).toBe("powershell.exe");
  expect(args.slice(0, 3)).toEqual(["-NoProfile", "-NonInteractive", "-Command"]);
  expect(args[3]).toContain("SessionId = $s");
  expect(args[3]).toContain("Where-Object { $_.CommandLine }");
  // Each one's working folder, read from its own memory: no admin for this user's own.
  expect(args[3]).toContain("Add-Type -TypeDefinition");
  expect(args[3]).toContain("cwd = [IsoplanCwd]::Of([int]$_.ProcessId)");
  const stdout = JSON.stringify([
    { pid: 4100, ppid: 4000, name: "node.exe", command: "node C:\\w\\app\\node_modules\\vitest\\vitest.mjs", start: NOW - 60_000, memory: 52_428_800 },
    { pid: 4200, ppid: 4100, name: "bash.exe", command: '"C:\\Program Files\\Git\\bin\\bash.exe" -c "pnpm test"', start: NOW - 30_000, memory: 4_194_304, cwd: "C:\\w\\app\\" },
    { pid: 4300, ppid: 1, name: "cmd.exe", command: "cmd.exe", start: NOW, memory: 1, cwd: "C:\\" },
    { pid: 4400, ppid: 1, name: "svc.exe", command: "svc.exe", start: NOW, memory: 1, cwd: null },
    { pid: "x", command: "bad" },
  ]);
  const asked: string[][] = [];
  const run: Run = async (argv) => (asked.push(argv), stdout);
  expect(await listProcesses({ platform: "win32", run })).toEqual([
    { pid: 4100, ppid: 4000, name: "node.exe", command: "node C:\\w\\app\\node_modules\\vitest\\vitest.mjs", startMs: NOW - 60_000, memory: 52_428_800 },
    { pid: 4200, ppid: 4100, name: "bash.exe", command: '"C:\\Program Files\\Git\\bin\\bash.exe" -c "pnpm test"', startMs: NOW - 30_000, memory: 4_194_304, cwd: "C:\\w\\app" },
    { pid: 4300, ppid: 1, name: "cmd.exe", command: "cmd.exe", startMs: NOW, memory: 1, cwd: "C:\\" },
    { pid: 4400, ppid: 1, name: "svc.exe", command: "svc.exe", startMs: NOW, memory: 1 },
  ]);
  expect(asked).toHaveLength(1);
  expect(parseWindowsList("not json")).toBeNull();
  expect(parseWindowsList("")).toEqual([]);
  expect(await listProcesses({ platform: "win32", run: async () => null })).toBeNull();
});

test("processes: on macOS ps lists this user's processes, a second ps their names and lsof their working folders", async () => {
  const commands = listCommands("darwin", 501);
  expect(commands.ps).toEqual(["ps", "-x", "-U", "501", "-o", "pid=,ppid=,rss=,etime=,command="]);
  expect(commands.cwd).toEqual(["lsof", "-a", "-d", "cwd", "-u", "501", "-Fn", "-w"]);
  const out: Record<string, string> = {
    ps: ["  700     1  20480 1-02:03:04 /Applications/Visual Studio Code.app/Contents/MacOS/Electron", "  801   700  10240    05:00 node /Users/ada/w/app/node_modules/.bin/vite --port 5173", "garbage"].join("\n"),
    names: ["  700 /Applications/Visual Studio Code.app/Contents/MacOS/Electron", "  801 node"].join("\n"),
    lsof: ["p700", "fcwd", "n/", "p801", "fcwd", "n/Users/ada/w/app"].join("\n"),
  };
  const run: Run = async (argv, allowFail) => (argv[0] === "lsof" ? (expect(allowFail).toBe(true), out.lsof!) : argv.includes("pid=,comm=") ? out.names! : out.ps!);
  expect(await listProcesses({ platform: "darwin", uid: 501, run, now: () => NOW })).toEqual([
    { pid: 700, ppid: 1, name: "Electron", command: "/Applications/Visual Studio Code.app/Contents/MacOS/Electron", startMs: NOW - (((24 + 2) * 60 + 3) * 60 + 4) * 1000, memory: 20480 * 1024, cwd: "/" },
    { pid: 801, ppid: 700, name: "node", command: "node /Users/ada/w/app/node_modules/.bin/vite --port 5173", startMs: NOW - 300_000, memory: 10240 * 1024, cwd: "/Users/ada/w/app" },
  ]);
  expect(parsePsList("", NOW)).toEqual([]);
  expect(parseLsofCwd("p9\nfcwd\n").size).toBe(0);
  // ps failing is no listing; lsof failing only loses the working folders.
  expect(await listProcesses({ platform: "darwin", uid: 501, run: async () => null })).toBeNull();
  expect((await listProcesses({ platform: "darwin", uid: 501, run: async (argv) => (argv[0] === "lsof" ? null : run(argv)), now: () => NOW }))?.[1]).not.toHaveProperty("cwd");
});
