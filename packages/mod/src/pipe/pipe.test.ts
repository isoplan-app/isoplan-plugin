// The runner's pipe (ADR 0007 step 2) on a real pipe: a named pipe with a name of its own for each
// test on Windows (a Unix socket elsewhere), in a throwaway config folder. The hooks module's end
// (client.ts) against the runner's (server.ts), and the ask_earlier_session script (dist/ask.js, rebuilt with
// every change) against the runner's.

import { execFile } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import type { DataLayerLine } from "../lines.js";
import { modDir, tempRoot } from "../data-layer/fixture.js";
import { relay } from "./client.js";
import { closeSession, openPipe, pipeAddress, pipeInfoPath, preparePipe, proofOf, readLines, readPipeInfo, writeLine, writePipeInfo } from "./pipe.js";
import { createPipeServer, keeps, type PipeServer } from "./server.js";

vi.setConfig({ testTimeout: 20000 });

const closing: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const close of closing.splice(0)) await close();
});

async function until(check: () => boolean, ms = 10000) {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 10));
  }
}

/** The runner's end in a throwaway config folder, recording each change it reports and each ask. */
async function runnerEnd(claudeDir = path.join(tempRoot(), "claude")) {
  const changes: string[] = [];
  const asked: unknown[] = [];
  const server = await createPipeServer({ claudeDir, log: () => {}, onChange: (s) => void changes.push(s), ask: async (request) => (asked.push(request), `answered: ${request.question}`) });
  closing.push(() => server.close());
  return { claudeDir, server, changes, asked };
}

/** A hooks module's end for session `session`, in this process, until `stop`. */
function hooksEnd(claudeDir: string, more: { session?: string; since?: number; version?: string; started?: () => string; env?: Record<string, string> } = {}) {
  const out: DataLayerLine[] = [];
  const said: string[] = [];
  let on = true;
  const started: number[] = [];
  const ended = relay({
    claudeDir,
    hello: { session: more.session ?? "s1", cwd: "C:/w/repo", since: more.since ?? 1, messages: true, root: modDir, version: more.version ?? "0.12.0", ...(more.env && { env: more.env }) },
    out: (line) => void out.push(line),
    goOn: () => on,
    startRunner: async () => (started.push(Date.now()), more.started?.() ?? "running"),
    say: (text) => void said.push(text),
    retryMs: async () => 50,
  });
  closing.push(async () => {
    on = false;
  });
  return { out, ended, started, said };
}

/** A connection to the pipe at `address` that says `first` and collects what comes back, until it closes. */
function rawClient(address: string, first: unknown) {
  const got: unknown[] = [];
  const socket = net.connect(address);
  readLines(socket, (value) => void got.push(value));
  const closed = new Promise<void>((resolve) => socket.on("close", () => resolve()).on("error", () => {}));
  socket.on("connect", () => writeLine(socket, first));
  return { socket, got, closed };
}

test("pipe: each worker's pipe has a name of its own: a named pipe on Windows, a socket in the user's own isoplan folder on macOS and Linux", () => {
  const dir = "C:\\Users\\ada\\.claude";
  expect(pipeAddress(dir, "win32", () => "abc")).toBe("\\\\.\\pipe\\isoplan-runner-abc");
  expect(pipeAddress("/Users/ada/.claude", "darwin", () => "abc")).toBe("/Users/ada/.claude/isoplan/pipe/runner-abc.sock");
  expect(pipeAddress("/home/ada/.claude", "linux", () => "abc")).toBe("/home/ada/.claude/isoplan/pipe/runner-abc.sock");
  for (const platform of ["win32", "darwin", "linux"] as const) expect(pipeAddress("/home/ada/.claude", platform)).not.toBe(pipeAddress("/home/ada/.claude", platform));
  // Short enough for a Unix socket's path (104 bytes on macOS) under a usual home.
  expect(pipeAddress("/Users/someone-long/.claude", "darwin").length).toBeLessThan(104);
});

test("pipe: a worker's pipe that closes leaves the next worker's alone (a runner replaced mid-session)", async () => {
  const before = await runnerEnd();
  const after = await runnerEnd(before.claudeDir);
  expect(after.server.address).not.toBe(before.server.address);
  await before.server.close();
  const info = (await readPipeInfo(before.claudeDir))!;
  expect(info.address).toBe(after.server.address);
  expect(await openPipe(info, () => {})).not.toBeNull();
});

test("pipe: the runner proves it knows the token before a client sends it; a pipe that can't is dropped, and is sent nothing", async () => {
  const { claudeDir, server } = await runnerEnd();
  const info = (await readPipeInfo(claudeDir))!;
  const hi = rawClient(info.address, { type: "hi", v: 1, nonce: "n-1" });
  await until(() => hi.got.length > 0);
  expect(hi.got).toEqual([{ type: "proof", proof: proofOf(info.token, "n-1") }]);
  hi.socket.destroy();

  // A pipe of another user's under the name pipe.json gives, which answers without the token.
  const impostor = await runnerEnd(path.join(tempRoot(), "other"));
  const heard: unknown[] = [];
  const stray = net.createServer((socket) => {
    socket.on("error", () => {});
    readLines(socket, (value) => {
      heard.push(value);
      writeLine(socket, { type: "proof", proof: "0".repeat(64) });
    });
  });
  const strayAddress = pipeAddress(path.join(tempRoot(), "stray"));
  await preparePipe(strayAddress);
  await new Promise<void>((resolve) => stray.listen(strayAddress, resolve));
  closing.push(() => new Promise((resolve) => stray.close(resolve)));
  expect(await openPipe({ address: strayAddress, token: info.token }, () => {})).toBeNull();
  // Another runner's, with another token.
  expect(await openPipe({ address: impostor.server.address, token: info.token }, () => {})).toBeNull();
  expect(heard).toEqual([{ type: "hi", v: 1, nonce: expect.stringMatching(/^[0-9a-f]{32}$/) }]);

  // A hooks module's end that pipe.json sends there says hello to it never, and the runner is down for it.
  const lost = path.join(tempRoot(), "lost");
  await writePipeInfo(lost, { address: strayAddress, token: info.token });
  const end = hooksEnd(lost);
  await until(() => end.started.length >= 2);
  expect(heard.length).toBeGreaterThan(1);
  expect(heard.every((m) => (m as { type: string }).type === "hi")).toBe(true);
  expect(end.out).toEqual([{ type: "runner", state: "down" }]);
  expect(server.hooked("s1")).toBeNull();
});

test("pipe: a token of 64 characters, some not ASCII, is refused without taking the runner down", async () => {
  const { claudeDir, server } = await runnerEnd();
  const info = (await readPipeInfo(claudeDir))!;
  const odd = rawClient(info.address, { type: "hello", v: 1, token: "é" + "0".repeat(63), session: "s1", cwd: "C:/w", since: 1, messages: true, root: "C:/p", version: "0.12.0" });
  await odd.closed;
  expect(server.hooked("s1")).toBeNull();
  hooksEnd(claudeDir);
  await until(() => !!server.hooked("s1"));
});

test("pipe: a runner that won't start is said with a line of its own, and in the session's log, each time that changes", async () => {
  const claudeDir = path.join(tempRoot(), "claude");
  let result = "held-off";
  const end = hooksEnd(claudeDir, { started: () => result });
  await until(() => end.started.length >= 3);
  expect(end.out).toEqual([
    { type: "runner", state: "down" },
    { type: "runner", state: "down", held: "held-off" },
  ]);
  expect(end.said).toEqual(["Isoplan's runner is holding off for now (runner.log says why), so this session isn't reported until it starts again"]);
  result = "not-installed";
  await until(() => end.out.length === 3);
  expect(end.out[2]).toEqual({ type: "runner", state: "down", held: "not-installed" });
  result = "started";
  await until(() => end.out.length === 4);
  expect(end.out[3]).toEqual({ type: "runner", state: "down" });
  expect(end.said).toHaveLength(2);
});

test("pipe: the session's own plugin folders and update switches go with its hello", async () => {
  const { claudeDir, server } = await runnerEnd();
  hooksEnd(claudeDir, { env: { CLAUDE_CODE_PLUGIN_DIRS: "C:/p", DISABLE_AUTOUPDATER: "1" } });
  await until(() => !!server.hooked("s1"));
  expect(server.hooked("s1")!.env).toEqual({ CLAUDE_CODE_PLUGIN_DIRS: "C:/p", DISABLE_AUTOUPDATER: "1" });
});

test("pipe: of two hooks modules for a session, a newer version's keeps it, and of one version the later window's", () => {
  expect(keeps({ version: "0.12.0", since: 1 }, { version: "0.11.1", since: 9 })).toBe(true);
  expect(keeps({ version: "0.11.1", since: 9 }, { version: "0.12.0", since: 1 })).toBe(false);
  expect(keeps({ version: "0.12.0", since: 9 }, { version: "0.12.0", since: 1 })).toBe(true);
  expect(keeps({ version: "0.12.0", since: 1 }, { version: "0.12.0", since: 9 })).toBe(false);
});

test("pipe: the runner writes where its pipe is with a token; a hello without that token is refused and registers nothing", async () => {
  const { claudeDir, server, changes } = await runnerEnd();
  const info = (await readPipeInfo(claudeDir))!;
  expect(info.address).toBe(server.address);
  expect(info.token).toMatch(/^[0-9a-f]{64}$/);
  if (process.platform !== "win32") expect(fs.statSync(pipeInfoPath(claudeDir)).mode & 0o777).toBe(0o600);
  const socket = net.connect(info.address);
  const closed = new Promise((resolve) => socket.on("close", resolve).on("error", () => {}));
  socket.on("connect", () => writeLine(socket, { type: "hello", v: 1, token: "0".repeat(64), session: "s1", cwd: "C:/w", since: 1, messages: true, root: "C:/p", version: "0.12.0" }));
  await closed;
  expect(server.hooked("s1")).toBeNull();
  expect(changes).toEqual([]);
});

test("pipe: a hooks module's end registers its session and is sent that session's lines alone; another window's later one takes the session and the first is told", async () => {
  const { claudeDir, server, changes } = await runnerEnd();
  const first = hooksEnd(claudeDir, { since: 1 });
  const other = hooksEnd(claudeDir, { session: "s2" });
  await until(() => !!server.hooked("s1") && !!server.hooked("s2"));
  expect(server.hooked("s1")).toMatchObject({ session: "s1", cwd: "C:/w/repo", since: 1, messages: true, root: modDir, version: "0.12.0" });
  const status: DataLayerLine = { type: "status", server: "ws://office/data-layer", label: "dev", state: "connected" };
  server.hooked("s1")!.send(status);
  await until(() => first.out.length > 0);
  expect(first.out).toEqual([status]);
  expect(other.out).toEqual([]);

  const later = hooksEnd(claudeDir, { since: 2 });
  expect(await first.ended).toBe("superseded");
  expect(first.out.at(-1)).toEqual({ type: "superseded", reason: "window" });
  await until(() => server.hooked("s1")?.since === 2);
  // An older version's, for the same session, is told a newer version has it, and the later one keeps it.
  const older = hooksEnd(claudeDir, { since: 3, version: "0.11.1" });
  expect(await older.ended).toBe("superseded");
  expect(older.out).toEqual([{ type: "superseded", reason: "newer" }]);
  expect(server.hooked("s1")?.since).toBe(2);
  expect(changes.filter((s) => s === "s1")).toEqual(["s1", "s1"]);

  expect(later.out).toEqual([]);
});

test("pipe: a hooks module's connection that goes leaves no registration behind, and the runner hears of it", async () => {
  const { claudeDir, server, changes } = await runnerEnd();
  const info = (await readPipeInfo(claudeDir))!;
  const socket = net.connect(info.address);
  socket.on("connect", () => writeLine(socket, { type: "hello", v: 1, token: info.token, session: "s1", cwd: "C:/w", since: 1, messages: false, root: "C:/p", version: "0.12.0" }));
  await until(() => !!server.hooked("s1"));
  const closed = server.hooked("s1")!.closed;
  socket.destroy();
  await closed;
  await until(() => server.hooked("s1") === null);
  expect(changes).toEqual(["s1", "s1"]);
});

test("pipe: when the runner goes, the hooks module's end says so once, starts it, and tries again; with the runner back it says hello afresh", async () => {
  const before = await runnerEnd();
  const end = hooksEnd(before.claudeDir);
  await until(() => !!before.server.hooked("s1"));
  await before.server.close();
  await until(() => end.out.some((l) => l.type === "runner"));
  expect(end.out).toEqual([{ type: "runner", state: "down" }]);
  await until(() => end.started.length >= 3);
  // Still down: said once.
  expect(end.out).toEqual([{ type: "runner", state: "down" }]);

  // A runner started again: a pipe of its own, with a token of its own.
  const after = await runnerEnd(before.claudeDir);
  expect(after.server.address).not.toBe(before.server.address);
  await until(() => !!after.server.hooked("s1"));
  expect(end.out).toEqual([
    { type: "runner", state: "down" },
    { type: "runner", state: "up" },
  ]);
  expect(after.changes).toEqual(["s1"]);
});

/** dist/ask.js run as the hooks module runs it, for session s1, in the config folder `claudeDir`. */
const askScript = (claudeDir: string, question: string, cwd = "C:/w/repo") =>
  new Promise<string>((resolve) => {
    const child = execFile(process.execPath, [path.join(modDir, "dist", "ask.js"), "--session", "s1", "--cwd", cwd, "--server", "ws://office/data-layer", "--key", "toolu_1"], { env: { ...process.env, CLAUDE_CONFIG_DIR: claudeDir }, windowsHide: true }, (_err, stdout) => resolve(stdout.trim()));
    child.stdin!.end(question);
  });

test("pipe: the ask_earlier_session script asks through the runner only for a session whose hooks module is connected; with no runner it says to carry on", async () => {
  const { claudeDir, server, asked } = await runnerEnd();
  expect(await askScript(claudeDir, "Why?")).toBe("The earlier session can't be asked from here: this session isn't connected to Isoplan's runner. Carry on without the answer.");
  expect(asked).toEqual([]);
  hooksEnd(claudeDir);
  await until(() => !!server.hooked("s1"));
  expect(await askScript(claudeDir, "Why?")).toBe("answered: Why?");
  expect(asked).toEqual([{ type: "ask", v: 1, token: (await readPipeInfo(claudeDir))!.token, session: "s1", cwd: "C:/w/repo", servers: ["ws://office/data-layer"], key: "toolu_1", question: "Why?" }]);
  // Asked as the session its hooks module registered, in that session's folder, whatever folder the ask names.
  expect(await askScript(claudeDir, "Where?", "C:/elsewhere")).toBe("answered: Where?");
  expect(asked.at(-1)).toMatchObject({ cwd: "C:/w/repo" });
  await server.close();
  expect(await askScript(claudeDir, "Why?")).toBe("The earlier session can't be asked right now: this session can't reach Isoplan's runner on this machine. Carry on without the answer.");
});

test("pipe: the desktop app's close, and its end and remove, reach the runner only with the token, and are told whether the session closed; with no runner it is told nothing", async () => {
  const claudeDir = path.join(tempRoot(), "claude");
  const asked: string[] = [];
  const server = await createPipeServer({ claudeDir, log: () => {}, onChange: () => {}, ask: async () => "", close: async (id, remove) => (asked.push(remove ? `remove ${id}` : id), id === "claude-code:1") });
  closing.push(() => server.close());
  expect(await closeSession(claudeDir, "claude-code:1", 5000)).toBe(true);
  expect(await closeSession(claudeDir, "claude-code:1", 5000, true)).toBe(true);
  expect(await closeSession(claudeDir, "pid:9", 5000)).toBe(false);
  const wrong = rawClient(server.address, { type: "close", v: 1, token: "0".repeat(64), close: "claude-code:2" });
  await wrong.closed;
  expect(wrong.got).toEqual([]);
  expect(asked).toEqual(["claude-code:1", "remove claude-code:1", "pid:9"]);
  expect(await closeSession(path.join(tempRoot(), "none"), "claude-code:1", 5000)).toBeNull();
});

test("pipe: a close the runner takes but never answers ends after the wait, as no answer", async () => {
  const claudeDir = path.join(tempRoot(), "claude");
  const server = await createPipeServer({ claudeDir, log: () => {}, onChange: () => {}, ask: async () => "", close: () => new Promise<boolean>(() => {}) });
  closing.push(() => server.close());
  expect(await closeSession(claudeDir, "claude-code:1", 300)).toBe("no answer");
});
