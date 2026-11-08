import fs from "node:fs";
import path from "node:path";
import { expect, test, vi } from "vitest";
import { tempRoot } from "../data-layer/fixture.js";
import type { Lead } from "./answerer.js";
import { commandEnv } from "../update/update.js";
import { atLeast, claudeCommand, findClaude, machineNode, versionOf } from "./claude-binary.js";
import { alive } from "../wake/lock.js";
import { createClaudeAnswerer, FORK_ENV_DROPPED, forkArgs, forkEnv, forkableId, killPid } from "./claude.js";

test("fork: the command line is pinned, flag by flag", () => {
  expect(forkArgs("e8fd707b", "opus")).toEqual([
    "-p",
    "--resume",
    "e8fd707b",
    "--fork-session",
    "--no-session-persistence",
    "--tools",
    "",
    // Reads no settings file, so neither the plugin nor the wake hook loads in the fork.
    "--setting-sources",
    "",
    "--strict-mcp-config",
    "--model",
    "opus",
    "--input-format",
    "stream-json",
    "--output-format",
    "stream-json",
    "--verbose",
  ]);
});

test("fork: the variables tying it to the session it was started from go; auth and provider ones stay", () => {
  const session = { CLAUDECODE: "1", CLAUDE_CODE_ENTRYPOINT: "cli", CLAUDE_CODE_SESSION_ID: "s", CLAUDE_CODE_CHILD_SESSION: "1", CLAUDE_CODE_MESSAGING_SOCKET: "p", CLAUDE_CODE_MESSAGING_TOKEN: "t", CLAUDE_CODE_PLUGIN_DIRS: "d", CLAUDE_PID: "1" };
  const kept = { PATH: "/bin", CLAUDE_CONFIG_DIR: "/c", ANTHROPIC_API_KEY: "k", CLAUDE_CODE_USE_BEDROCK: "1", CLAUDE_CODE_USE_VERTEX: "1", CLAUDE_CODE_OAUTH_TOKEN: "o", AWS_REGION: "us-east-1" };
  expect(forkEnv({ ...session, ...kept, GONE: undefined })).toEqual(kept);
});

test("fork: a session id that would read as an option, or isn't a plain name, is refused", () => {
  expect(forkableId("claude-code:e8fd707b-1")).toBe("e8fd707b-1");
  for (const bad of ["claude-code:-p", "claude-code:--resume", "claude-code:a/b", "claude-code:", "codex:s"]) expect(forkableId(bad)).toBe(null);
});

// A stand-in for `claude`: it logs its argv and every stdin line, replays two empty results before
// turn 1's real one (as a lead with leftover background tasks does), and answers turn 2.
const FAKE = `
import fs from "node:fs";
import { spawn } from "node:child_process";
const log = (x) => fs.appendFileSync(process.env.FAKE_LOG, JSON.stringify(x) + "\\n");
const out = (x) => process.stdout.write(JSON.stringify(x) + "\\n");
const usage = (input, write, read, output) => ({ input_tokens: input, cache_creation_input_tokens: write, cache_read_input_tokens: read, output_tokens: output });
log({ argv: process.argv.slice(2), cwd: process.cwd(), env: Object.keys(process.env).filter((k) => k.startsWith("CLAUDE")) });
if (process.env.FAKE_MODE === "hang") log({ grandchild: spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" }).pid });
let turn = 0, realSent = false, buf = "";
process.stdin.setEncoding("utf8").on("data", (d) => {
  buf += d;
  let i;
  while ((i = buf.indexOf("\\n")) >= 0) {
    const line = JSON.parse(buf.slice(0, i));
    buf = buf.slice(i + 1);
    turn++;
    log({ turn, text: line.message.content[0].text, afterReal: realSent });
    if (process.env.FAKE_MODE === "hang") continue;
    if (turn === 1) {
      out({ type: "system", subtype: "init" });
      out({ type: "result", subtype: "success", num_turns: 0, result: "", usage: usage(9, 9, 9, 9), total_cost_usd: 4.58 });
      out({ type: "result", subtype: "success", num_turns: 0, result: "", usage: usage(9, 9, 9, 9) });
      setTimeout(() => {
        realSent = true;
        out({ type: "result", subtype: "success", num_turns: 1, result: "ready", usage: usage(2, 570000, 2700, 4), total_cost_usd: 99 });
      }, 50);
    } else {
      out({ type: "result", subtype: "success", num_turns: 1, result: process.env.FAKE_MODE === "error" ? "boom" : "  It was 79.16%.  ", is_error: process.env.FAKE_MODE === "error", usage: usage(3, 400, 572000, 300) });
    }
  }
}).on("end", () => {
  log({ closed: true });
  // A fork that answered but doesn't exit.
  if (process.env.FAKE_MODE === "linger") setInterval(() => {}, 1000);
  else process.exit(0);
});
`;

function fake(mode = "") {
  const root = tempRoot();
  const bin = path.join(root, "claude.js");
  const logFile = path.join(root, "log.jsonl");
  fs.writeFileSync(bin, FAKE);
  const cwd = fs.mkdtempSync(path.join(root, "lead-"));
  const lead: Lead = { cwd, working: false, compacted: false, context: 572000, lastActive: Date.now() };
  const tracked: { kind: string; session: string; folder: string }[] = [];
  const answerer = createClaudeAnswerer({
    claudeDir: path.join(root, ".claude"),
    binary: async () => bin,
    model: async () => "opus",
    config: async () => ({ tailBytes: 1048576, stalledMinutes: 5 }),
    env: { ...process.env, FAKE_LOG: logFile, FAKE_MODE: mode, CLAUDECODE: "1", CLAUDE_CODE_ENTRYPOINT: "cli" },
    track: (_child, about) => void tracked.push(about),
  });
  const logged = () => fs.readFileSync(logFile, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  return { answerer, lead, logged, cwd, logFile, tracked };
}

const ask = { instructions: "Reply with only the word: ready", request: "What was the coverage?", timeoutMs: 10000 };

test("fork: turn 2 goes after turn 1's real result, stdin closes, and the last result is the reply", async () => {
  const f = fake();
  const answered = await f.answerer.ask("claude-code:e8fd707b", f.lead, ask);
  expect(answered).toEqual({ ok: true, text: "It was 79.16%.", usage: { input: 5, output: 304, cacheRead: 574700, cacheWrite: 570400 } });
  const [start, ...rest] = f.logged();
  expect(start.argv).toEqual(forkArgs("e8fd707b", "opus"));
  expect(fs.realpathSync(start.cwd)).toBe(fs.realpathSync(f.cwd));
  expect(start.env.filter((k: string) => FORK_ENV_DROPPED.includes(k))).toEqual([]);
  // The fork is in the process registry while it runs.
  expect(f.tracked).toEqual([{ kind: "fork", session: "claude-code:e8fd707b", folder: f.cwd }]);
  expect(rest).toEqual([
    { turn: 1, text: ask.instructions, afterReal: false },
    { turn: 2, text: ask.request, afterReal: true },
    { closed: true },
  ]);
});

test("fork: an error result fails the answer, keeping what was metered", async () => {
  const f = fake("error");
  expect(await f.answerer.ask("claude-code:s", f.lead, ask)).toEqual({ ok: false, kind: "failed", detail: "turn 2 stopped with success: boom", usage: { input: 5, output: 304, cacheRead: 574700, cacheWrite: 570400 } });
});

// The pid of the process the fake started, once it has logged it.
async function grandchildOf(f: ReturnType<typeof fake>): Promise<number> {
  for (let i = 0; i < 200; i++) {
    const found = fs.existsSync(f.logFile) ? f.logged().find((l) => l.grandchild) : undefined;
    if (found) return found.grandchild;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error("no grandchild");
}

async function gone(pid: number) {
  for (let i = 0; i < 200 && alive(pid); i++) await new Promise((r) => setTimeout(r, 25));
  return !alive(pid);
}

test("fork: no answer inside the timeout fails it and ends the fork's whole process tree", async () => {
  const f = fake("hang");
  const asked = f.answerer.ask("claude-code:s", f.lead, { ...ask, timeoutMs: 1500 });
  const grandchild = await grandchildOf(f);
  expect(await asked).toEqual({ ok: false, kind: "timed-out", detail: "no answer within 2 s", usage: null });
  expect(await gone(grandchild)).toBe(true);
});

test("fork: close ends every fork still running, with what it started", async () => {
  const f = fake("hang");
  const asked = f.answerer.ask("claude-code:s", f.lead, { ...ask, timeoutMs: 60000 });
  const grandchild = await grandchildOf(f);
  f.answerer.close();
  expect(await asked).toMatchObject({ ok: false, kind: "failed" });
  expect(await gone(grandchild)).toBe(true);
});

test("fork: the reply is taken when turn 2's result arrives, even if the fork never exits", async () => {
  const f = fake("linger");
  const started = Date.now();
  expect(await f.answerer.ask("claude-code:s", f.lead, { ...ask, timeoutMs: 20000 })).toMatchObject({ ok: true, text: "It was 79.16%." });
  expect(Date.now() - started).toBeLessThan(5000);
  f.answerer.close();
  await new Promise((r) => setTimeout(r, 200));
});

test("fork: a session that isn't Claude Code's, or no binary, is a failure with the reason", async () => {
  const f = fake();
  expect(await f.answerer.ask("codex:s", f.lead, ask)).toMatchObject({ ok: false, kind: "not-set-up", detail: "codex:s isn't a Claude Code session this runner can fork" });
  const none = createClaudeAnswerer({ claudeDir: "/x", binary: async () => null, model: async () => "opus", config: async () => ({ tailBytes: 1, stalledMinutes: 1 }) });
  expect(await none.ask("claude-code:s", f.lead, ask)).toMatchObject({ ok: false, kind: "no-claude", detail: expect.stringContaining("claude binary wasn't found") });
  expect(await none.lead("codex:s")).toBe(null);
});

test("binary: PATH first, then the installers' places, on Windows and on Mac", async () => {
  const has = (...files: string[]) => async (p: string) => files.includes(p);
  const win = { Path: "C:\\Tools;C:\\Users\\ada\\AppData\\Roaming\\npm" };
  expect(await findClaude(win, "win32", "C:\\Users\\ada", has("C:\\Tools\\claude.exe", "C:\\Users\\ada\\.local\\bin\\claude.exe"))).toBe("C:\\Tools\\claude.exe");
  expect(await findClaude(win, "win32", "C:\\Users\\ada", has("C:\\Users\\ada\\.local\\bin\\claude.exe"))).toBe("C:\\Users\\ada\\.local\\bin\\claude.exe");
  // An npm install leaves a .cmd shim, which needs a shell: its cli.js runs with node instead.
  const npm = "C:\\Users\\ada\\AppData\\Roaming\\npm";
  const cli = `${npm}\\node_modules\\@anthropic-ai\\claude-code\\cli.js`;
  expect(await findClaude(win, "win32", "C:\\Users\\ada", has(`${npm}\\claude.cmd`, cli))).toBe(cli);
  expect(claudeCommand(cli, "node")).toEqual(["node", cli]);
  expect(claudeCommand("C:\\Tools\\claude.exe")).toEqual(["C:\\Tools\\claude.exe"]);

  const mac = { PATH: "/usr/bin:/bin" };
  expect(await findClaude(mac, "darwin", "/Users/ada", has("/Users/ada/.local/bin/claude", "/opt/homebrew/bin/claude"))).toBe("/Users/ada/.local/bin/claude");
  expect(await findClaude(mac, "darwin", "/Users/ada", has("/opt/homebrew/bin/claude"))).toBe("/opt/homebrew/bin/claude");
  expect(await findClaude(mac, "darwin", "/Users/ada", has())).toBe(null);
});

test("binary: under Bun (the desktop app's worker), a cli.js and git's askpass run on the machine's node from PATH, not on Bun", () => {
  const has = (...files: string[]) => (p: string) => files.includes(p);
  const bun = { execPath: "C:\\Isoplan\\bin\\bun.exe", bun: "1.3.0" };
  expect(machineNode({ Path: "C:\\Tools;C:\\nodejs" }, "win32", bun, has("C:\\nodejs\\node.exe"))).toBe("C:\\nodejs\\node.exe");
  expect(machineNode({ PATH: "/usr/bin:/opt/homebrew/bin" }, "darwin", { execPath: "/Applications/Isoplan.app/Contents/MacOS/bun", bun: "1.3.0" }, has("/opt/homebrew/bin/node"))).toBe("/opt/homebrew/bin/node");
  // No node on PATH: Bun's own. Not under Bun: this process's node.
  expect(machineNode({ Path: "C:\\Tools" }, "win32", bun, has())).toBe(bun.execPath);
  expect(machineNode({ Path: "C:\\nodejs" }, "win32", { execPath: "C:\\nodejs\\node.exe" }, has())).toBe("C:\\nodejs\\node.exe");

  // The defaults, as the worker gets them on the app's Bun.
  const root = tempRoot();
  const node = path.join(root, process.platform === "win32" ? "node.exe" : "node");
  fs.writeFileSync(node, "");
  const savedPath = process.env.PATH;
  Object.defineProperty(process.versions, "bun", { value: "1.3.0", configurable: true, enumerable: true });
  try {
    process.env.PATH = root;
    expect(claudeCommand("/x/cli.js")).toEqual([node, "/x/cli.js"]);
    expect(commandEnv({}).GIT_ASKPASS).toBe(node);
    expect(commandEnv({}).SSH_ASKPASS).toBe(node);
  } finally {
    delete (process.versions as Record<string, string | undefined>).bun;
    process.env.PATH = savedPath;
  }
  expect(claudeCommand("/x/cli.js")).toEqual([process.execPath, "/x/cli.js"]);
  expect(commandEnv({}).GIT_ASKPASS).toBe(process.execPath);
});

test("claude --version: the version on its own line wins over any other, else the last one in the output", () => {
  expect(versionOf("Node 22.13.0 is old\n2.1.317 (Claude Code)\nUpdate 2.1.400 is out\n")).toBe("2.1.317");
  expect(versionOf("a 1.2.3 then 2.1.300\n")).toBe("2.1.300");
  expect(versionOf("no version")).toBe(null);
  expect([atLeast("2.1.285", "2.1.285"), atLeast("2.1.284", "2.1.285"), atLeast("2.2.0", "2.1.285")]).toEqual([true, false, true]);
});

test("killPid: on a Mac or Linux the process's whole group is ended, and when it leads none, the process alone", () => {
  // Stands in for the system's kill: nothing real is signalled.
  const kill = vi.spyOn(process, "kill").mockImplementation(() => true);
  const gone = () => {
    throw Object.assign(new Error("kill ESRCH"), { code: "ESRCH" });
  };
  try {
    killPid(4242, "darwin");
    expect(kill.mock.calls).toEqual([[-4242, "SIGKILL"]]);
    kill.mockClear();
    kill.mockImplementationOnce(gone);
    const fallback = vi.fn();
    killPid(4242, "linux", fallback);
    expect(kill.mock.calls).toEqual([[-4242, "SIGKILL"]]);
    expect(fallback).toHaveBeenCalledTimes(1);
    // By default the fallback ends the process alone, and one gone already is no error.
    kill.mockClear();
    kill.mockImplementation(gone);
    expect(() => killPid(4242, "darwin")).not.toThrow();
    expect(kill.mock.calls).toEqual([
      [-4242, "SIGKILL"],
      [4242, "SIGKILL"],
    ]);
  } finally {
    kill.mockRestore();
  }
});
