// The stand-ins an expert runs against in the tests (expert.test.ts and the instance tests): a fake
// `claude` driven by rules in a file, a fake git over one repo, and the files of its read checkout.

import fs from "node:fs";
import path from "node:path";
import type { GitResult, RunGit } from "../handoff/git.js";

export const C0 = "0".repeat(40);
export const C1 = "1".repeat(40);
export const C2 = "2".repeat(40);

/** Waits until `check` holds, polling, or throws after `ms`. */
export async function until(check: () => boolean, ms = 20000) {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 10));
  }
}

// A stand-in for `claude`: it logs its argv and each turn, and answers each turn by the first rule
// in FAKE_RULES (read again every turn) whose kind, text and trunk match: a reply with the context
// its call had, Read calls of files in its folder, other tool calls, a compaction, a delay, a wait
// for a file to be there, an exit, or none.
export const FAKE_CLAUDE = `
const fs = require("node:fs");
const path = require("node:path");
const argv = process.argv.slice(2);
const kind = argv.includes("--session-id") ? "trunk" : argv.includes("--fork-session") ? "fork" : argv.includes("--resume") ? "append" : "judge";
const trunk = kind === "judge" ? null : argv[argv.indexOf(kind === "trunk" ? "--session-id" : "--resume") + 1];
const log = (x) => fs.appendFileSync(process.env.FAKE_LOG, JSON.stringify(x) + "\\n");
const out = (x) => process.stdout.write(JSON.stringify(x) + "\\n");
log({ kind, trunk, argv, background: process.env.CLAUDE_CODE_DISABLE_BACKGROUND_TASKS ? "off" : "on", memory: process.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY ? "off" : "on" });
let turn = 0, buf = "";
function respond(text) {
  const rules = JSON.parse(fs.readFileSync(process.env.FAKE_RULES, "utf8"));
  const rule = rules.find((r) => (!r.kind || r.kind === kind) && (!r.text || text.includes(r.text)) && (!r.trunk || r.trunk === trunk)) || { reply: "no rule" };
  if (turn === 1) out({ type: "system", subtype: "init", model: rule.model || "claude-sonnet-5-5", tools: ["Read", "Grep", "Glob", "Agent"] });
  if (rule.exit) process.exit(1);
  if (rule.hang) return;
  if (rule.until && !fs.existsSync(rule.until)) {
    const wait = setInterval(() => fs.existsSync(rule.until) && (clearInterval(wait), reply(rule)), 20);
    return;
  }
  reply(rule);
}
function reply(rule) {
  setTimeout(() => {
    const ctx = rule.context || 1000;
    const usage = { input_tokens: 0, cache_read_input_tokens: ctx - 10, cache_creation_input_tokens: 0, output_tokens: 10 };
    const content = [
      ...(rule.reads || []).map((f, i) => ({ type: "tool_use", id: "r" + i, name: "Read", input: { file_path: path.join(process.cwd(), f) } })),
      ...(rule.tools || []).map((n, i) => ({ type: "tool_use", id: "t" + i, name: n, input: {} })),
    ];
    out({ type: "assistant", parent_tool_use_id: null, message: { id: "m" + turn, usage, content } });
    if (rule.compact) out({ type: "system", subtype: "compact_boundary" });
    out({ type: "result", subtype: "success", num_turns: 1, result: rule.reply || "", usage });
  }, rule.delayMs || 0);
}
process.stdin.setEncoding("utf8").on("data", (d) => {
  buf += d;
  let i;
  while ((i = buf.indexOf("\\n")) >= 0) {
    const text = JSON.parse(buf.slice(0, i)).message.content[0].text;
    buf = buf.slice(i + 1);
    turn++;
    log({ kind, trunk, turn, text });
    respond(text);
  }
}).on("end", () => process.exit(0));
setInterval(() => {}, 1000);
`;

export interface Rule {
  kind?: "trunk" | "fork" | "append" | "judge";
  text?: string;
  trunk?: string;
  model?: string;
  reply?: string;
  context?: number;
  reads?: string[];
  tools?: string[];
  compact?: boolean;
  hang?: boolean;
  /** Exits at once, as a crash. */
  exit?: boolean;
  delayMs?: number;
  /** A file the reply waits for. */
  until?: string;
}

export const ANSWER = "<answer>The relay holds it while it is in flight.</answer>\n<cited>\nsrc/relay.ts:1-2\n</cited>";
// The usual expert: it grounds reading two files, passes its proof, and answers.
export const BASE: Rule[] = [
  { kind: "trunk", text: "Reply with only the word: ready", reply: "ready", context: 20000 },
  { kind: "trunk", text: "Now read what your subject rests on", reply: "grounded", context: 50000, reads: ["CONTEXT.md", "src/relay.ts"] },
  { kind: "fork", text: "Question proof-", reply: "<answer>Forty-two.</answer>" },
  { kind: "judge", reply: "PASS: it says forty-two." },
  { kind: "append", reply: "noted", context: 60000 },
  { kind: "fork", text: "Question x-", reply: ANSWER },
];

/** A stand-in for git over one repo: a HEAD and an origin tip, the files changed, a dirty flag, and origin out of reach. */
export function fakeGit(readDir: string) {
  const calls: { cwd: string; args: string[] }[] = [];
  const repo = { head: C1, origin: C1, changed: [] as string[], dirty: false, offline: false };
  const ok = (stdout = ""): GitResult => ({ code: 0, stdout, stderr: "", timedOut: false });
  const git: RunGit = async (argv, { cwd }) => {
    let args = argv;
    while (args[0] === "-c") args = args.slice(2); // after the no-hooks prefix, and Windows' long paths for a clone
    calls.push({ cwd, args });
    const at = (word: string) => args.includes(word);
    if (args[0] === "remote" && args[1] === "get-url") return ok("https://github.com/acme/app.git\n");
    if (args[0] === "ls-remote") return repo.offline ? { ...ok(), code: 128, stderr: "could not read from remote" } : ok("ref: refs/heads/main\tHEAD\n");
    if (args[0] === "clone") return (makeRead(args.at(-1)!), ok());
    if (args[0] === "rev-parse" && args[1] === "--verify" && args[2]?.startsWith("refs/remotes/")) return ok(repo.origin);
    if (at("rev-parse") && args.at(-1) === "HEAD") return ok(repo.head + "\n");
    if (at("checkout")) return ((repo.head = args.at(-1)!.startsWith("refs/remotes/") ? repo.origin : args.at(-1)!), ok());
    if (at("status")) return ok(repo.dirty ? " M src/relay.ts\n" : "");
    if (at("reset")) return ((repo.dirty = false), ok());
    if (at("diff")) return ok(args.at(-1) === `${repo.head}..HEAD` ? "" : repo.changed.join("\n"));
    return ok();
  };
  return { git, calls, repo };
}

export function makeRead(readDir: string) {
  const write = (file: string, text: string) => (fs.mkdirSync(path.dirname(path.join(readDir, file)), { recursive: true }), fs.writeFileSync(path.join(readDir, file), text));
  write("CONTEXT.md", "**Relay**: what carries questions.");
  write("src/relay.ts", "export const relay = 1;\n");
  write("src/other.ts", "export const other = 1;\n");
  write("docs/adr/0004-x.md", "# What leaves a machine\n");
  fs.mkdirSync(path.join(readDir, ".git"), { recursive: true });
}
