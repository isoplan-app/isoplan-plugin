// Temp fixture trees for the tests: a fake home with ~/.claude/projects transcripts, and fake git
// repositories and worktrees made of plain files (no git binary involved).

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll } from "vitest";
import { createClaudeCode, type ReadInput, type SourceRead } from "./claude-code.js";
import type { Config } from "./config.js";
import type { Project } from "@isoplan/protocol";
import { createGit, type Where } from "./git.js";
import { projectOf } from "./identity.js";
import { nodeIo, type NodeIo } from "./io.js";

/** The mod's own folder, which holds config.json. */
export const modDir = path.resolve(import.meta.dirname, "..", "..");
export const defaults: Config = JSON.parse(fs.readFileSync(path.join(modDir, "config.json"), "utf8"));
export const NOW = Date.parse("2026-10-09T12:00:00Z");

// Every temp root made in a test file is removed when that file's tests are done.
const roots: string[] = [];
afterAll(async () => {
  // A write still finishing as the tests end (a session's log, say) holds its folder on Windows for a
  // moment. The async rm, because rmSync doesn't retry an EPERM (Node 24).
  await Promise.all(roots.map((root) => fs.promises.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })));
});

export function tempRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "isoplan-mod-"));
  roots.push(root);
  return root;
}

function write(p: string, text: string, ageSeconds?: number): void {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, text);
  if (ageSeconds !== undefined) touch(p, ageSeconds);
}

export function touch(p: string, ageSeconds: number): void {
  const t = new Date(NOW - ageSeconds * 1000);
  fs.utimesSync(p, t, t);
}

/** A main checkout: <dir>/.git as a directory, on `branch`. */
export function gitRepo(dir: string, branch = "main"): string {
  write(path.join(dir, ".git", "HEAD"), `ref: refs/heads/${branch}\n`);
  return dir;
}

/** A linked worktree of `mainDir` at `dir`: a .git file pointing at .git/worktrees/<name>. */
export function gitWorktree(mainDir: string, dir: string, name: string, branch: string, { absoluteCommondir = false } = {}): string {
  const gitDir = path.join(mainDir, ".git", "worktrees", name);
  write(path.join(gitDir, "HEAD"), `ref: refs/heads/${branch}\n`);
  write(path.join(gitDir, "commondir"), absoluteCommondir ? path.join(mainDir, ".git") + "\n" : "../..\n");
  write(path.join(dir, ".git"), `gitdir: ${gitDir}\n`);
  return dir;
}

export const at = (ageSeconds: number) => new Date(NOW - ageSeconds * 1000).toISOString();

type Extra = Record<string, unknown>;
type Line = Record<string, unknown> | string;

// Transcript lines, shaped as the probe found them.
export const line = {
  user: (cwd: string, text: unknown, age = 30, extra: Extra = {}) => ({ type: "user", cwd, timestamp: at(age), message: { role: "user", content: text }, ...extra }),
  text: (cwd: string, text: string, age = 30, extra: Extra = {}) => ({ type: "assistant", cwd, timestamp: at(age), message: { role: "assistant", content: [{ type: "text", text }] }, ...extra }),
  tool: (cwd: string, name: string, input: Extra, age = 30, extra: Extra = {}) => ({
    type: "assistant",
    cwd,
    timestamp: at(age),
    message: { role: "assistant", content: [{ type: "tool_use", id: "t" + Math.random(), name, input }] },
    ...extra,
  }),
  spawn: (cwd: string, toolUseId: string, input: Extra = {}, age = 30) => ({
    type: "assistant",
    cwd,
    timestamp: at(age),
    message: { role: "assistant", content: [{ type: "tool_use", id: toolUseId, name: "Agent", input }] },
  }),
  result: (cwd: string, toolUseId: string, toolUseResult: unknown, age = 30, isError = false) => ({
    type: "user",
    cwd,
    timestamp: at(age),
    message: { role: "user", content: [{ type: "tool_result", tool_use_id: toolUseId, content: "…", is_error: isError }] },
    toolUseResult,
  }),
  // One content block of a reply: each block is its own line, carrying the reply's id and usage.
  reply: (cwd: string, id: string, usage: Extra, age = 30, model = "claude-opus-5-5") => ({
    type: "assistant",
    cwd,
    timestamp: at(age),
    message: { id, model, role: "assistant", content: [{ type: "text", text: "ok" }], usage },
  }),
  title: (aiTitle: string) => ({ type: "ai-title", aiTitle }),
  notify: (agentId: string, status: string, age = 10) => ({
    type: "queue-operation",
    operation: "enqueue",
    timestamp: at(age),
    content: `<task-notification>\n<task-id>${agentId}</task-id>\n<status>${status}</status>\n<result>finished</result>\n</task-notification>`,
  }),
};

const jsonl = (lines: Line[]) => lines.map((l) => (typeof l === "string" ? l : JSON.stringify(l))).join("\n") + "\n";

/** A session transcript under <home>/.claude/projects/<slug>/<id>.jsonl, last written `age` seconds ago. */
export function session(home: string, id: string, lines: Line[], { slug = "proj", age = 10 } = {}): string {
  const p = path.join(home, ".claude", "projects", slug, `${id}.jsonl`);
  write(p, jsonl(lines), age);
  return p;
}

/** A subagent transcript plus its meta.json, inside that session's subagents/ folder. */
export function agent(home: string, sessionId: string, agentId: string, meta: Extra, lines: Line[], { slug = "proj", age = 10 } = {}): string {
  const dir = path.join(home, ".claude", "projects", slug, sessionId, "subagents");
  write(path.join(dir, `agent-${agentId}.meta.json`), JSON.stringify(meta), age);
  const p = path.join(dir, `agent-${agentId}.jsonl`);
  write(p, jsonl(lines), age);
  return p;
}

export interface SourceOptions {
  now?: () => number;
  config?: Partial<Config>;
  io?: Partial<NodeIo>;
  /** The project a repo is; by default its local id on "test-machine", as with no remote. */
  projectOf?: (where: Where) => Project;
  /** The person's home folder; by default none. */
  home?: string;
  /** The local model's word on whether a message corrected the agent; by default none is asked. */
  corrected?: ReadInput["corrected"];
}

/**
 * A source reading <home>/.claude, with the clock at NOW and no git binary, kept across reads as
 * the data layer keeps it. read(id, cwd?) reads that session; `cwd` names its project folder, and
 * a session written under any other slug is found by name.
 */
export function sourceIn(home: string, opts: SourceOptions = {}) {
  const io = { ...nodeIo({ run: null }), ...opts.io };
  const source = createClaudeCode({ ...io, claudeDir: path.join(home, ".claude"), ...(opts.home ? { home: opts.home } : {}) });
  const git = createGit(io);
  return (sessionId: string, cwd = path.join(home, "elsewhere")): Promise<SourceRead> => {
    const now = (opts.now ?? (() => NOW))();
    const config = { ...defaults, ...opts.config };
    return source.read({ sessionId, cwd, now, config, resolve: (dir) => git.resolve(dir, { now, maxAgeMs: config.gitCacheSeconds * 1000 }), projectOf: opts.projectOf ?? ((where) => projectOf(null, where, where.toplevel, "test-machine")), ...(opts.corrected && { corrected: opts.corrected }) });
  };
}

/** One session's facts, read once. */
export async function factsOf(home: string, sessionId: string, opts?: SourceOptions) {
  const { facts } = await sourceIn(home, opts)(sessionId);
  if (!facts) throw new Error(`no facts for ${sessionId}`);
  return facts;
}

/** Records keyed by their id without the "claude-code:" prefix: a subagent's own id, or "<session>:lead". */
export const byId = <T extends { id: string }>(records: T[]): Record<string, T> => Object.fromEntries(records.map((r) => [r.id.replace(/^claude-code:/, ""), r]));
export const cc = (id: string) => "claude-code:" + id;
