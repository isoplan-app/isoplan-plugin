// The Claude Code answerer: answers from a fork of a session's lead, run as #44's probe settled.
//
//   claude -p --resume <lead> --fork-session --no-session-persistence --tools "" --setting-sources ""
//     NO_HOOKS --strict-mcp-config --model <model> --input-format stream-json --output-format stream-json --verbose
//
// - The fork runs in the lead's folder. It has no tools and no MCP servers; `--setting-sources ""`
//   reads no settings file, so this plugin doesn't load in it, and nothing it does reaches the office
//   server. The person's hooks still ran with that flag alone (Claude Code 2.1.328, 19 Nov 2026: a
//   UserPromptSubmit hook's routing note took over a Haiku judge's first line, failing 7 of 12
//   correct answers), so NO_HOOKS turns every hook off, the wake hook's too. It is never saved. A login that comes from settings.json
//   (apiKeyHelper, its env block) doesn't reach it either; Claude Code's own login and auth from
//   environment variables do.
// - Its environment is the runner's, less the variables that tie a process to the Claude Code
//   session it was started from (FORK_ENV_DROPPED): the runner is started from hooks, so it
//   inherits them, and a fork that kept them would pass as part of that session or load its
//   plugins. Provider and auth variables (CLAUDE_CODE_USE_BEDROCK, CLAUDE_CODE_USE_VERTEX,
//   CLAUDE_CODE_OAUTH_TOKEN, ANTHROPIC_*, CLAUDE_CONFIG_DIR...) are kept.
// - Two turns. Turn 1 is the fixed instruction block, the same bytes every time, so its end is a
//   cache breakpoint every later fork of the lead reads; turn 2 is the question or the brief request.
// - A lead with leftover background tasks first replays them as empty results (`num_turns: 0`).
//   Turn 2 goes only after a result with `num_turns` ≥ 1. Turn 2's result is the reply, taken as
//   soon as it arrives; a fork that doesn't exit soon after is ended.
// - Stdin closes after turn 2, or the process waits for more.
// - Tokens come from each turn's `result.usage`, never `total_cost_usd` or `modelUsage`, into which
//   a resumed fork restores the lead's own earlier cost. `result.usage` is that turn's alone, not a
//   running total: on a resumed Haiku fork (29 Oct 2026, Claude Code 2.1.312) turn 2 read 4,706
//   cached tokens, turn 1's 3,877 read plus its 829 written, and wrote 286 output tokens against
//   turn 1's 151, the same as its `model_usage_since_last_result`. So the two turns are summed.
// - A fork that times out, or is still running when the runner exits, is ended with its whole
//   process tree. While it runs it is in the process registry (registry.ts), so a runner that
//   crashed leaves nothing the next one can't find and end.

import { spawn as nodeSpawn, spawnSync, type ChildProcess, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createClaudeCode } from "../data-layer/claude-code.js";
import type { Config } from "../data-layer/config.js";
import { nodeIo } from "../data-layer/io.js";
import type { Answered, Answerer, Ask, FailureKind, Usage } from "./answerer.js";
import { claudeCommand } from "./claude-binary.js";

const PREFIX = "claude-code:";
// The end of the fork's stderr kept for the local log.
const STDERR_CHARS = 2000;
// How long a fork that has answered gets to exit by itself.
const EXIT_GRACE_MS = 5000;

/** Turns off every hook in a process Isoplan runs for itself: the person's hooks read their prompts too, even with `--setting-sources ""`. */
export const NO_HOOKS = ["--settings", JSON.stringify({ disableAllHooks: true })];

/** Every flag of the fork's command line, after the binary. */
export function forkArgs(sessionId: string, model: string): string[] {
  return [
    "-p",
    "--resume",
    sessionId,
    "--fork-session",
    "--no-session-persistence",
    "--tools",
    "",
    "--setting-sources",
    "",
    ...NO_HOOKS,
    "--strict-mcp-config",
    "--model",
    model,
    "--input-format",
    "stream-json",
    "--output-format",
    "stream-json",
    "--verbose",
  ];
}

/**
 * The variables Claude Code sets for the processes it starts, which tie them to that session: its
 * marker and entrypoint, the session's ids, its messaging socket and token, its own path and pid,
 * the session's plugin folders and effort, and its IDE port. And Isoplan's own marker of a driven
 * session's processes, which only the driven session it names is given.
 */
export const FORK_ENV_DROPPED = [
  "CLAUDECODE",
  "CLAUDE_CODE_ENTRYPOINT",
  "CLAUDE_CODE_SESSION_ID",
  "CLAUDE_CODE_CHILD_SESSION",
  "CLAUDE_CODE_SESSION_ATTENDED",
  "CLAUDE_CODE_MESSAGING_SOCKET",
  "CLAUDE_CODE_MESSAGING_TOKEN",
  "CLAUDE_CODE_EXECPATH",
  "CLAUDE_CODE_PLUGIN_DIRS",
  "CLAUDE_CODE_SSE_PORT",
  "CLAUDE_PID",
  "CLAUDE_EFFORT",
  "ISOPLAN_SESSION",
];

/**
 * The variable a driven session's process is started with, holding its session's id: every process
 * under it inherits it, even after its parent has ended, so the runner can tell the processes it
 * started from the person's own when the session is ended and removed (strays.ts, #144).
 */
export const SESSION_MARKER = "ISOPLAN_SESSION";

/** The fork's environment: this one's, less FORK_ENV_DROPPED. */
export function forkEnv(env: Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) if (value !== undefined && !FORK_ENV_DROPPED.includes(key)) out[key] = value;
  return out;
}

/** One user turn as a stream-json input line. */
export const userTurn = (text: string) => JSON.stringify({ type: "user", message: { role: "user", content: [{ type: "text", text }] } }) + "\n";

/** A session id names a transcript file and goes on the command line: a plain name, not an option. */
export const forkableId = (session: string): string | null => {
  const id = session.startsWith(PREFIX) ? session.slice(PREFIX.length) : null;
  return id && /^\w[\w-]*$/.test(id) ? id : null;
};

/** Ends a process and everything it started: on Windows `kill` reaches only the process itself. */
export function killTree(child: ChildProcessWithoutNullStreams, platform = process.platform): void {
  if (child.exitCode !== null || child.signalCode !== null || child.pid === undefined) return;
  killPid(child.pid, platform, () => child.kill("SIGKILL"));
}

/**
 * Ends the process `pid` and everything it started, as killTree does, for a process this runner
 * didn't start itself (one an earlier run left, from the process registry). Off Windows the process
 * leads its own group (spawned detached); `fallback` runs when it doesn't, and by default kills the
 * process alone.
 */
export function killPid(pid: number, platform = process.platform, fallback: () => unknown = () => process.kill(pid, "SIGKILL")): void {
  if (platform === "win32") spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
  else {
    try {
      process.kill(-pid, "SIGKILL");
    } catch {
      try {
        fallback();
      } catch {
        // Gone already.
      }
    }
  }
}

export type Spawn = (argv: string[], opts: { cwd: string; env: Record<string, string> }) => ChildProcessWithoutNullStreams;

/** What a fork is recorded as in the process registry (registry.ts) while it runs. */
export type Track = (child: ChildProcess, about: { kind: "fork" | "desktop-read"; session: string; folder: string }) => void;

export interface ClaudeAnswererOptions {
  claudeDir: string;
  /** The `claude` binary, or null when none can be found. */
  binary: () => Promise<string | null>;
  /** The model the fork answers with, from runner.json. */
  model: () => Promise<string>;
  /** How the lead's transcript is read and when its turn counts as open. */
  config: () => Promise<Pick<Config, "tailBytes" | "stalledMinutes">>;
  spawn?: Spawn;
  env?: Record<string, string | undefined>;
  now?: () => number;
  /** Records each fork in the process registry while it runs. */
  track?: Track;
}

/** Starts a process with no window and its three pipes; off Windows it leads its own process group, for killTree. */
export const hiddenSpawn: Spawn = ([cmd, ...args], { cwd, env }) =>
  nodeSpawn(cmd!, args, { cwd, env, stdio: ["pipe", "pipe", "pipe"], windowsHide: true, detached: process.platform !== "win32" });

export function createClaudeAnswerer({ claudeDir, binary, model, config, spawn = hiddenSpawn, env = process.env, now = Date.now, track }: ClaudeAnswererOptions): Answerer {
  const forks = new Set<ChildProcessWithoutNullStreams>();
  return {
    async lead(session) {
      const id = forkableId(session);
      // A fresh read each time: the runner asks rarely, and a cache would keep every session it was asked about.
      return id ? createClaudeCode({ ...nodeIo(), claudeDir }).lead(id, now(), await config()) : null;
    },
    async ask(session, lead, ask) {
      const id = forkableId(session);
      if (!id) return { ok: false, kind: "not-set-up", detail: `${session} isn't a Claude Code session this runner can fork`, usage: null };
      const bin = await binary();
      if (!bin) return { ok: false, kind: "no-claude", detail: "the claude binary wasn't found; run the plugin's install script, or set its path in ~/.claude/isoplan/claude-binary.json", usage: null };
      let child: ChildProcessWithoutNullStreams;
      try {
        child = spawn([...claudeCommand(bin), ...forkArgs(id, await model())], { cwd: lead.cwd, env: forkEnv(env) });
      } catch (err) {
        return { ok: false, kind: "not-set-up", detail: `couldn't start claude: ${(err as Error).message}`, usage: null };
      }
      forks.add(child);
      child.on("close", () => forks.delete(child));
      track?.(child, { kind: "fork", session, folder: lead.cwd });
      return drive(child, ask);
    },
    close() {
      for (const child of forks) killTree(child);
      forks.clear();
    },
  };
}

/** Runs the two turns over a started fork and settles with turn 2's result, a failure or the timeout. */
export function drive(child: ChildProcessWithoutNullStreams, { instructions, request, timeoutMs }: Ask): Promise<Answered> {
  return new Promise((resolve) => {
    const usage: Usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
    let metered = false;
    let turn = 1;
    let buffer = "";
    let stderr = "";
    let isDone = false;

    const finish = (answered: Answered) => {
      if (isDone) return;
      isDone = true;
      clearTimeout(timer);
      resolve(answered);
      // An answered fork should exit by itself now; one that doesn't is ended.
      setTimeout(() => killTree(child), EXIT_GRACE_MS).unref();
    };
    const fail = (kind: FailureKind, detail: string) => finish({ ok: false, kind, detail, usage: metered ? usage : null });
    const timer = setTimeout(() => {
      fail("timed-out", `no answer within ${Math.round(timeoutMs / 1000)} s`);
      killTree(child);
    }, timeoutMs);

    const onResult = (e: Record<string, any>) => {
      // Leftover background tasks replay as empty results before the real one.
      if (!(typeof e.num_turns === "number" && e.num_turns >= 1)) return;
      const u = e.usage && typeof e.usage === "object" ? e.usage : {};
      const n = (key: string) => (Number.isFinite(u[key]) ? (u[key] as number) : 0);
      usage.input += n("input_tokens");
      usage.output += n("output_tokens");
      usage.cacheRead += n("cache_read_input_tokens");
      usage.cacheWrite += n("cache_creation_input_tokens");
      metered = true;
      if (e.is_error || e.subtype !== "success") {
        fail("failed", `turn ${turn} stopped with ${String(e.subtype ?? "an error")}${typeof e.result === "string" && e.result ? `: ${e.result}` : ""}`);
        killTree(child);
        return;
      }
      if (turn === 1) {
        turn = 2;
        child.stdin.write(userTurn(request));
        child.stdin.end();
        return;
      }
      const text = typeof e.result === "string" ? e.result.trim() : "";
      if (text) finish({ ok: true, text, usage });
      else fail("failed", "the fork answered with nothing");
    };

    child.stdout.setEncoding("utf8").on("data", (piece: string) => {
      buffer += piece;
      let nl;
      while ((nl = buffer.indexOf("\n")) >= 0) {
        const text = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!text) continue;
        try {
          const e = JSON.parse(text);
          if (e && e.type === "result") onResult(e);
        } catch {
          // Not an event: Claude Code's own output, ignored.
        }
      }
    });
    child.stderr.setEncoding("utf8").on("data", (piece: string) => (stderr = (stderr + piece).slice(-STDERR_CHARS)));
    // A fork that exits early breaks the pipe; its exit says why.
    child.stdin.on("error", () => {});
    child.on("error", (err) => fail("not-set-up", `couldn't run claude: ${err.message}`));
    child.on("close", (code) => fail("failed", `claude exited${code === null ? "" : ` with code ${code}`} before answering${stderr.trim() ? `: ${stderr.trim().split("\n").slice(-3).join(" ")}` : ""}`));

    child.stdin.write(userTurn(instructions));
  });
}
