// An expert's Claude Code processes: their command lines, and the conversation over their stream.
//
// Four kinds, each run hidden in the expert's read checkout with forkEnv's environment (claude.ts),
// except the judge, which runs in the expert's folder:
//
//   trunk       claude -p --session-id <trunk> --model <m> READ_ONLY STREAM          grounding, two turns
//   append      claude -p --resume <trunk> --model <m> READ_ONLY STREAM              a learned note, one turn
//   fork        claude -p --resume <trunk> --fork-session --no-session-persistence --model <m> READ_ONLY STREAM
//                                                                                      a question: junior, senior or proof
//   judge       claude -p --no-session-persistence --tools "" ... --model <judge> STREAM   the proof's judge, no tools
//
// - Read-only is enforced, not asked for: only Read, Grep, Glob and Agent (the subagent tool, for
//   Explore subagents) are offered, the rest are disallowed, no settings file or MCP server loads,
//   and nothing prompts (`dontAsk`). A disallowed tool offered in the init event, or used by the
//   session or one of its subagents, ends the process tree at once and fails the conversation.
// - Every trunk turn and every fork has the same tools and no MCP config, so a fork reads the trunk
//   from the prompt cache. `--autocompact 1000000` moves compaction to the window's edge; a
//   `compact_boundary` event still fails the conversation, since a trunk must never be summarised.
// - A turn ends with a `result` event whose `num_turns` is 1 or more (a resumed session may first
//   replay empty ones). Its `usage` sums every API call of the turn, so with tools it is several
//   times the context: it is never the meter. The meter (`context`) is the last top-level assistant
//   message's input, cache read, cache write and output tokens. A turn's cost is the result's usage,
//   which is complete for the top-level calls but leaves out subagents', plus the last event of each
//   subagent message (parent_tool_use_id set). The top-level messages aren't summed: their stream
//   events carry early, partial output counts. A turn cut short counts every message seen.
// - Files read (by Read, a subagent's too) inside the read checkout are kept, repo-relative with
//   forward slashes, for the runner's file → commit index.

import type { ChildProcessWithoutNullStreams } from "node:child_process";
import path from "node:path";
import type { Usage } from "./answerer.js";
import { killTree, userTurn } from "./claude.js";

/** The only tools a trunk or fork is offered. */
export const READ_TOOLS = ["Read", "Grep", "Glob", "Agent"];
/** Tools that end a trunk or fork at once when offered or used. */
export const DISALLOWED_TOOLS = ["Bash", "PowerShell", "Edit", "Write", "NotebookEdit", "WebFetch", "WebSearch"];
// The tools whose use counts as exploring; Task is the subagent tool's older name.
const EXPLORING = new Set([...READ_TOOLS, "Task"]);

const READ_ONLY = ["--tools", READ_TOOLS.join(","), "--disallowedTools", DISALLOWED_TOOLS.join(","), "--setting-sources", "", "--strict-mcp-config", "--permission-mode", "dontAsk", "--autocompact", "1000000"];
const STREAM = ["--input-format", "stream-json", "--output-format", "stream-json", "--verbose"];

// The end of a process's stderr kept for a failure's detail.
const STDERR_CHARS = 2000;
// How long a process that has had its last turn gets to exit by itself.
const EXIT_GRACE_MS = 5000;

/** A new trunk's grounding: it is saved under `trunk`. */
export const trunkArgs = (trunk: string, model: string) => ["-p", "--session-id", trunk, "--model", model, ...READ_ONLY, ...STREAM];
/** One turn appended to a trunk: a learned note. */
export const appendArgs = (trunk: string, model: string) => ["-p", "--resume", trunk, "--model", model, ...READ_ONLY, ...STREAM];
/** A fork of a trunk for one question, never saved. */
export const expertForkArgs = (trunk: string, model: string) => ["-p", "--resume", trunk, "--fork-session", "--no-session-persistence", "--model", model, ...READ_ONLY, ...STREAM];
/** The proof's judge: no tools, never saved. */
export const judgeArgs = (model: string) => ["-p", "--no-session-persistence", "--tools", "", "--setting-sources", "", "--strict-mcp-config", "--permission-mode", "dontAsk", "--model", model, ...STREAM];

/** One finished turn: its reply, what it cost, and the context of its last top-level call (the meter). */
export interface TurnResult {
  text: string;
  usage: Usage;
  context: number;
}

export type ConversationFailure = { kind: "timed-out" | "failed" | "compacted" | "disallowed" | "not-set-up" | "no-claude"; detail: string };

export interface Conversation {
  /** Every turn ended, and `next` said there was no more. */
  ok: boolean;
  turns: TurnResult[];
  /** Every turn's cost, and the cost so far of one cut short. */
  usage: Usage;
  /** The files read inside `root`, repo-relative with forward slashes. */
  reads: Set<string>;
  /** Read, Grep, Glob or a subagent was used. */
  explored: boolean;
  compacted: boolean;
  /** The model id the init event named. */
  model?: string;
  failure?: ConversationFailure;
}

export interface ConverseOptions {
  /** The read checkout: reads inside it are kept. Without it none are. */
  root?: string;
  platform?: NodeJS.Platform;
  /** Told the model id as soon as the init event names it: a reason ends the conversation at once, failed with it. */
  check?: (model: string) => string | null;
}

/**
 * `file` relative to `root` with forward slashes, or null when it isn't under it. Both are resolved
 * (a relative `file` against `root`) and compared lower-case on Windows. `root` itself is "".
 */
export function inside(root: string, file: string, platform: NodeJS.Platform = process.platform): string | null {
  const p = platform === "win32" ? path.win32 : path.posix;
  const slashed = (x: string) => x.replace(/\\/g, "/").replace(/\/+$/, "");
  const r = slashed(p.resolve(root));
  const f = slashed(p.resolve(root, file));
  const [rk, fk] = platform === "win32" ? [r.toLowerCase(), f.toLowerCase()] : [r, f];
  if (fk === rk) return "";
  return fk.startsWith(rk + "/") ? f.slice(r.length + 1) : null;
}

const zero = (): Usage => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
const add = (a: Usage, b: Usage): Usage => ({ input: a.input + b.input, output: a.output + b.output, cacheRead: a.cacheRead + b.cacheRead, cacheWrite: a.cacheWrite + b.cacheWrite });
const usageOf = (u: unknown): Usage => {
  const o = u && typeof u === "object" ? (u as Record<string, unknown>) : {};
  const n = (key: string) => (Number.isFinite(o[key]) ? (o[key] as number) : 0);
  return { input: n("input_tokens"), output: n("output_tokens"), cacheRead: n("cache_read_input_tokens"), cacheWrite: n("cache_creation_input_tokens") };
};

/**
 * Runs a conversation over a started process: `first` is turn 1, and after each turn `next` gives
 * the next user turn, or null to close stdin and settle; it may take its time (a junior waiting on
 * its senior), with the time limit still running. Settles with a failure on a disallowed
 * tool, a compaction, an error result, an early exit, or `timeoutMs` for the whole conversation,
 * ending the process tree for each but an early exit.
 */
export function converse(child: ChildProcessWithoutNullStreams, first: string, next: (turn: TurnResult) => string | null | Promise<string | null>, timeoutMs: number, o: ConverseOptions = {}): Promise<Conversation> {
  return new Promise((resolve) => {
    const c: Conversation = { ok: false, turns: [], usage: zero(), reads: new Set(), explored: false, compacted: false };
    // This turn's assistant messages, by id, the last event of each kept.
    let messages = new Map<string, { usage: Usage; top: boolean }>();
    let context = 0;
    let buffer = "";
    let stderr = "";
    let isDone = false;

    const finish = (failure?: ConversationFailure) => {
      if (isDone) return;
      isDone = true;
      clearTimeout(timer);
      if (failure) {
        c.failure = failure;
        c.usage = add(c.usage, [...messages.values()].reduce((sum, m) => add(sum, m.usage), zero()));
      } else c.ok = true;
      resolve(c);
      // A process told there is no more should exit by itself now; one that doesn't is ended.
      setTimeout(() => killTree(child), EXIT_GRACE_MS).unref();
    };
    const fail = (kind: ConversationFailure["kind"], detail: string, kill = true) => {
      finish({ kind, detail });
      if (kill) killTree(child);
    };
    const timer = setTimeout(() => fail("timed-out", `no reply within ${Math.round(timeoutMs / 1000)} s`), timeoutMs);

    const onTools = (names: unknown) => {
      const offered = Array.isArray(names) ? names.find((t) => DISALLOWED_TOOLS.includes(String(t))) : undefined;
      if (offered !== undefined) fail("disallowed", `a disallowed tool was offered: ${String(offered)}`);
    };
    const onAssistant = (e: Record<string, any>) => {
      const message = e.message && typeof e.message === "object" ? e.message : {};
      const top = !e.parent_tool_use_id;
      const u = usageOf(message.usage);
      if (typeof message.id === "string") messages.set(message.id, { usage: u, top });
      if (top && message.usage) context = u.input + u.cacheRead + u.cacheWrite + u.output;
      for (const block of Array.isArray(message.content) ? message.content : []) {
        if (block?.type !== "tool_use" || typeof block.name !== "string") continue;
        if (DISALLOWED_TOOLS.includes(block.name)) return fail("disallowed", `a disallowed tool was used: ${block.name}`);
        if (EXPLORING.has(block.name)) c.explored = true;
        const file = block.input?.file_path;
        if (block.name === "Read" && typeof file === "string" && o.root !== undefined) {
          const relative = inside(o.root, file, o.platform);
          if (relative) c.reads.add(relative);
        }
      }
    };
    const onResult = (e: Record<string, any>) => {
      if (!(typeof e.num_turns === "number" && e.num_turns >= 1)) return;
      if (e.is_error || e.subtype !== "success") {
        fail("failed", `turn ${c.turns.length + 1} stopped with ${String(e.subtype ?? "an error")}${typeof e.result === "string" && e.result ? `: ${e.result}` : ""}`);
        return;
      }
      const subagents = [...messages.values()].filter((m) => !m.top).reduce((sum, m) => add(sum, m.usage), zero());
      const turn: TurnResult = { text: typeof e.result === "string" ? e.result.trim() : "", usage: add(usageOf(e.usage), subagents), context };
      messages = new Map();
      c.turns.push(turn);
      c.usage = add(c.usage, turn.usage);
      const said = (s: string | null) => {
        if (isDone) return;
        if (s === null) {
          child.stdin.end();
          finish();
        } else child.stdin.write(userTurn(s));
      };
      const told = next(turn);
      if (told instanceof Promise) told.then(said, (err: Error) => fail("failed", `the runner couldn't go on: ${err.message}`));
      else said(told);
    };

    child.stdout.setEncoding("utf8").on("data", (piece: string) => {
      buffer += piece;
      let nl;
      while (!isDone && (nl = buffer.indexOf("\n")) >= 0) {
        const text = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!text) continue;
        let e: Record<string, any>;
        try {
          e = JSON.parse(text);
        } catch {
          continue; // not an event: Claude Code's own output
        }
        if (!e || typeof e !== "object") continue;
        if (e.type === "system" && e.subtype === "init") {
          if (typeof e.model === "string" && e.model) c.model = e.model;
          onTools(e.tools);
          const problem = !isDone && c.model && o.check ? o.check(c.model) : null;
          if (problem) fail("failed", problem);
        } else if (e.type === "system" && e.subtype === "compact_boundary") {
          c.compacted = true;
          fail("compacted", "the session compacted");
        } else if (e.type === "assistant") onAssistant(e);
        else if (e.type === "result") onResult(e);
      }
    });
    child.stderr.setEncoding("utf8").on("data", (piece: string) => (stderr = (stderr + piece).slice(-STDERR_CHARS)));
    // A process that exits early breaks the pipe; its exit says why.
    child.stdin.on("error", () => {});
    child.on("error", (err) => fail("not-set-up", `couldn't run claude: ${err.message}`, false));
    child.on("close", (code) =>
      fail("failed", `claude exited${code === null ? "" : ` with code ${code}`} before its last turn ended${stderr.trim() ? `: ${stderr.trim().split("\n").slice(-3).join(" ")}` : ""}`, false),
    );

    child.stdin.write(userTurn(first));
  });
}
