import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test } from "vitest";
import { alive } from "../wake/lock.js";
import type { Proc } from "./processes.js";
import { chooseStrays, endCommand, endIfSame, endStrays, inFolder, type EndOutcome } from "./strays.js";
import { listProcesses } from "./processes.js";

const S = "claude-code:1111";
const proc = (pid: number, extra: Partial<Proc> = {}): Proc => ({ pid, ppid: 1, name: `p${pid}`, command: `p${pid}`, startMs: pid, memory: 0, ...extra });

test("strays: only a process carrying the removed session's marker, in its folder, is ended; every other one there is left, with why", () => {
  const folder = String.raw`C:\w\app`;
  const procs = [
    proc(10, { name: "node.exe", cwd: String.raw`C:\w\app`, marker: S }),
    // In the folder by its command line, its working folder elsewhere.
    proc(11, { command: "node C:/w/app/node_modules/vite/bin/vite.js", cwd: String.raw`C:\Windows`, marker: S }),
    proc(12, { cwd: String.raw`C:\w\app\src`, marker: "" }),
    proc(13, { cwd: String.raw`C:\w\app` }),
    proc(14, { cwd: String.raw`C:\w\app`, marker: "claude-code:2222" }),
    proc(15, { cwd: String.raw`C:\w\other`, marker: S }),
    // A folder whose name only starts with the session's.
    proc(16, { cwd: String.raw`C:\w\app-2`, marker: S }),
    proc(17, { cwd: String.raw`C:\w\other` }),
  ];
  const { end, left } = chooseStrays(procs, { session: S, folder, self: 999, platform: "win32" });
  expect(end.map((p) => p.pid)).toEqual([10, 11]);
  expect(left.map(({ proc: p, why }) => [p.pid, why])).toEqual([
    [12, "Isoplan didn't start it"],
    [13, "its environment couldn't be read, so it can't be told whether Isoplan started it"],
    [14, "another of Isoplan's sessions started it"],
    [15, "Isoplan started it for this session, but it runs outside the session's folder"],
    [16, "Isoplan started it for this session, but it runs outside the session's folder"],
  ]);
});

test("strays: the runner and the app above it are never ended, even carrying the marker", () => {
  const procs = [proc(1, { ppid: 0, cwd: "/w/app", marker: S }), proc(5, { ppid: 1, cwd: "/w/app", marker: S }), proc(6, { ppid: 5, cwd: "/w/app", marker: S })];
  const { end, left } = chooseStrays(procs, { session: S, folder: "/w/app", self: 5, platform: "darwin" });
  expect(end.map((p) => p.pid)).toEqual([6]);
  expect(left.map((l) => l.proc.pid)).toEqual([1, 5]);
  expect([inFolder("/w/app/x", "/w/app/"), inFolder("/w/appx", "/w/app"), inFolder(String.raw`C:\W\App`, "c:/w/app")]).toEqual([true, false, true]);
});

test("strays: each process ended and each left is logged, also one that changed or couldn't be checked again just before; with no listing nothing is ended", async () => {
  const logs: string[] = [];
  const ended: number[] = [];
  const outcomes = new Map<number, EndOutcome>([
    [10, "ended"],
    [11, "failed"],
    [13, "changed"],
  ]);
  const list = async () => [10, 11, 13, 14].map((pid) => proc(pid, { cwd: "/w/app", marker: S })).concat(proc(12, { cwd: "/w/app", marker: "" }));
  await endStrays(S, "/w/app", { log: (t) => void logs.push(t), list, end: async (procs) => (ended.push(...procs.map((p) => p.pid)), outcomes), self: 999, platform: "darwin" });
  expect(ended).toEqual([10, 11, 13, 14]);
  expect(logs).toEqual([
    `ended p10 (10), which ${S} left running in /w/app`,
    `couldn't end p11 (11), which ${S} left running in /w/app: it may have ended already`,
    `left p13 (13) running in /w/app when ${S} was removed: it isn't the process that was listed any more (its pid was reused, or its environment changed)`,
    `left p14 (14) running in /w/app when ${S} was removed: it couldn't be checked again just before it was to be ended`,
    `left p12 (12) running in /w/app when ${S} was removed: Isoplan didn't start it`,
  ]);
  logs.length = 0;
  await endStrays(S, "/w/app", { log: (t) => void logs.push(t), list: async () => null, end: async () => (ended.push(-1), new Map()) });
  expect(ended).not.toContain(-1);
  expect(logs).toEqual([`couldn't list this computer's processes, so nothing ${S} left running in /w/app was ended`]);
});

test("strays: on this computer, an orphan the session started is ended and the person's own process in the folder is left", async () => {
  const folder = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "isoplan-strays-")));
  const wait = ["-e", "setInterval(() => {}, 1000)"];
  // The marked parent starts a child and ends, so the child is an orphan only its marker ties to the session.
  const parent = spawn(process.execPath, ["-e", `const c = require("child_process").spawn(process.execPath, ${JSON.stringify(wait)}, { detached: true, stdio: "ignore", windowsHide: true }); console.log(c.pid); c.unref();`], { cwd: folder, env: { ...process.env, ISOPLAN_SESSION: S }, windowsHide: true });
  const orphan = Number(await new Promise<string>((resolve) => parent.stdout.on("data", (d) => resolve(String(d)))));
  await new Promise((r) => parent.on("close", r));
  const { ISOPLAN_SESSION: _, ...unmarked } = process.env;
  const own = spawn(process.execPath, wait, { cwd: folder, env: unmarked, stdio: "ignore", windowsHide: true });
  try {
    const logs: string[] = [];
    await endStrays(S, folder, { log: (t) => void logs.push(t) });
    for (let i = 0; i < 50 && alive(orphan); i++) await new Promise((r) => setTimeout(r, 100));
    expect(alive(orphan)).toBe(false);
    expect(alive(own.pid!)).toBe(true);
    expect(logs.some((l) => l.startsWith("ended ") && l.includes(`(${orphan})`))).toBe(true);
    expect(logs.some((l) => l.startsWith("left ") && l.includes(`(${own.pid})`) && l.endsWith("Isoplan didn't start it"))).toBe(true);
  } finally {
    own.kill();
    if (alive(orphan)) process.kill(orphan);
  }
}, 60000);

test("strays: on this computer, a pid that now names another process (another start, or no marker of the session) is left, and the one listed is ended", async () => {
  const marked = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { env: { ...process.env, ISOPLAN_SESSION: S }, stdio: "ignore", windowsHide: true });
  try {
    await new Promise((r) => setTimeout(r, 500));
    const listed = (await listProcesses())!.find((p) => p.pid === marked.pid)!;
    expect(listed.marker).toBe(S);
    // The pid reused by a process that started later, or one that doesn't carry this session's marker.
    expect([...(await endIfSame([{ ...listed, startMs: listed.startMs - 60_000 }], S))]).toEqual([[listed.pid, "changed"]]);
    expect([...(await endIfSame([listed], "claude-code:2222"))]).toEqual([[listed.pid, "changed"]]);
    expect(alive(listed.pid)).toBe(true);
    expect([...(await endIfSame([listed], S))]).toEqual([[listed.pid, "ended"]]);
    for (let i = 0; i < 50 && alive(listed.pid); i++) await new Promise((r) => setTimeout(r, 100));
    expect(alive(listed.pid)).toBe(false);
    // Gone: it can't be checked again, so nothing is ended.
    expect([...(await endIfSame([listed], S))]).toEqual([[listed.pid, "unknown"]]);
  } finally {
    if (alive(marked.pid!)) marked.kill();
  }
}, 60000);

test("strays: on macOS ps is asked again for the pid alone, and only the process listed is signalled", async () => {
  const NOW = 1_000_000_000;
  const listed = proc(801, { command: "node vite.js", startMs: NOW - 300_000, marker: S });
  const answers = (etime: string, command: string, env: string) => async (argv: string[]) => (argv.includes("-E") ? `  801 ${command} ${env}` : `${etime} ${command}`);
  const signalled: number[] = [];
  const signal = (pid: number) => void signalled.push(pid);
  const opts = { platform: "darwin" as const, now: () => NOW, signal };
  // The pid reused by a process that started later, by another command, or without the marker.
  expect((await endIfSame([listed], S, { ...opts, run: answers("00:30", "node vite.js", `ISOPLAN_SESSION=${S}`) })).get(801)).toBe("changed");
  expect((await endIfSame([listed], S, { ...opts, run: answers("05:00", "bash", `ISOPLAN_SESSION=${S}`) })).get(801)).toBe("changed");
  expect((await endIfSame([listed], S, { ...opts, run: answers("05:00", "node vite.js", "HOME=/Users/ada") })).get(801)).toBe("changed");
  // Gone, or ps -E failing: it can't be checked.
  expect((await endIfSame([listed], S, { ...opts, run: async () => null })).get(801)).toBe("unknown");
  expect((await endIfSame([listed], S, { ...opts, run: async (argv) => (argv.includes("-E") ? null : "05:00 node vite.js") })).get(801)).toBe("unknown");
  expect(signalled).toEqual([]);
  expect((await endIfSame([listed], S, { ...opts, run: answers("05:01", "node vite.js", `ISOPLAN_SESSION=${S}`) })).get(801)).toBe("ended");
  expect(signalled).toEqual([801]);
  // A session id that can't be put in the Windows check as it is ends nothing there.
  expect(endCommand([listed], "claude-code:x'; Stop-Computer; '")).toBeNull();
});
