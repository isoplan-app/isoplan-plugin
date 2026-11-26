// The stand-ins an employee runs against in the tests: a fake `claude` that talks to the runner's
// real MCP endpoint (employee-tools.ts) as Claude Code does, a real git origin for its project, and a
// temp Claude folder with the registry (employees.ts) running in it on a clock the test moves.

import fs from "node:fs";
import path from "node:path";
import { PROTOCOL_VERSION, type EmployeeDraftDecidedMessage } from "@isoplan/protocol";
import { modDir, tempRoot } from "../data-layer/fixture.js";
import { git, remoteAndClone } from "../handoff/fixture.js";
import { createRunGit, type RunGit } from "../handoff/git.js";
import type { RunAnswer } from "./employee-drafts-here.js";
import { createEmployeeTools, type EmployeeTools } from "./employee-tools.js";
import type { EmployeeSettings } from "./employee.js";
import { NOTHING_TIED } from "./expert-fixture.js";
import type { WhatWasLearnedBinding } from "./what-was-learned-for-one-expert.js";
import { createEmployees, type Employees } from "./employees.js";
import { parseTable } from "./who-was-contacted.js";

export const RECORD = "7a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
export const ADAM = { id: "claude:acc-adam", name: "Adam" };

/** Waits until `check` holds, polling, or throws after `ms`. */
export async function until(check: () => boolean | Promise<boolean>, ms = 30000, what = "") {
  const end = Date.now() + ms;
  while (!(await check())) {
    if (Date.now() > end) throw new Error(`timed out${what ? `: ${what}` : ""}`);
    await new Promise((r) => setTimeout(r, 20));
  }
}

// A stand-in for `claude`: it logs its argv and each turn, answers each turn by the first rule in
// FAKE_RULES (read again every turn) whose kind and text match, and, as Claude Code does, connects
// to the MCP server its --mcp-config names over HTTP (initialize, tools/list) and lists it in its init
// event, then makes each tool call a rule names, logging what the runner answered. A trunk's turns go
// in a transcript under FAKE_PROJECTS, as Claude Code saves a session; a fork's don't.
export const FAKE_EMPLOYEE_CLAUDE = `
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const argv = process.argv.slice(2);
const kind = argv.includes("--session-id") ? "trunk" : argv.includes("--fork-session") ? "fork" : "append";
const trunk = argv[argv.indexOf(kind === "trunk" ? "--session-id" : "--resume") + 1];
const config = JSON.parse(fs.readFileSync(argv[argv.indexOf("--mcp-config") + 1], "utf8")).mcpServers.isoplan;
const tools = argv[argv.indexOf("--tools") + 1].split(",").filter(Boolean);
const log = (x) => fs.appendFileSync(process.env.FAKE_LOG, JSON.stringify(x) + "\\n");
const out = (x) => process.stdout.write(JSON.stringify(x) + "\\n");
const transcript = path.join(process.env.FAKE_PROJECTS, "fake", trunk + ".jsonl");
const save = (type, text) => kind !== "fork" && (fs.mkdirSync(path.dirname(transcript), { recursive: true }), fs.appendFileSync(transcript, JSON.stringify({ type, uuid: randomUUID(), ...(text !== undefined && { message: { content: [{ type: "text", text }] } }) }) + "\\n"));
log({ kind, trunk, argv, env: { MCP_TOOL_TIMEOUT: process.env.MCP_TOOL_TIMEOUT } });
let id = 0;
const rpc = async (method, params) => {
  const res = await fetch(config.url, { method: "POST", headers: { ...config.headers, "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }) });
  return (await res.json()).result;
};
let turn = 0, buf = "", queue = Promise.resolve();
async function respond(text) {
  const rules = JSON.parse(fs.readFileSync(process.env.FAKE_RULES, "utf8"));
  const rule = rules.find((r) => (!r.kind || r.kind === kind) && (!r.text || text.includes(r.text))) || { reply: "no rule" };
  if (turn === 1) {
    let mcp = [];
    if (rule.mcp !== "failed") {
      await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "fake", version: "1" } });
      mcp = (await rpc("tools/list", {})).tools.map((t) => "mcp__isoplan__" + t.name).filter((t) => !(rule.dropTools || []).includes(t));
    }
    out({ type: "system", subtype: "init", model: rule.model || "claude-sonnet-5-5", tools: [...tools, ...mcp, ...(rule.initTools || [])], mcp_servers: [{ name: "isoplan", status: rule.mcp === "failed" ? "failed" : "connected" }] });
  }
  if (rule.exit) process.exit(1);
  let context = rule.context || 1000;
  for (const call of rule.calls || []) {
    const name = "mcp__isoplan__" + call.tool;
    const usage = { input_tokens: 0, cache_read_input_tokens: context - 10, cache_creation_input_tokens: 0, output_tokens: 10 };
    out({ type: "assistant", parent_tool_use_id: null, message: { id: "m" + turn + "-" + id, usage, content: [{ type: "tool_use", id: "t" + id, name, input: call.arguments }] } });
    const result = await rpc("tools/call", { name: call.tool, arguments: call.arguments });
    log({ kind, trunk, turn, call: call.tool, result: result.content[0].text });
    context += rule.contextStep || 0;
    if (rule.callDelayMs) await new Promise((r) => setTimeout(r, rule.callDelayMs));
  }
  if (rule.hang) return new Promise(() => {});
  for (const tool of rule.subagentTools || []) out({ type: "assistant", parent_tool_use_id: "agent-1", message: { id: "s" + turn + tool, usage: { input_tokens: 10, output_tokens: 10 }, content: [{ type: "tool_use", id: "s" + tool, name: tool, input: {} }] } });
  await new Promise((r) => setTimeout(r, rule.delayMs || 0));
  const usage = { input_tokens: 0, cache_read_input_tokens: context - 10, cache_creation_input_tokens: 0, output_tokens: 10 };
  const content = (rule.reads || []).map((f, i) => ({ type: "tool_use", id: "r" + i, name: "Read", input: { file_path: path.join(process.cwd(), f) } }));
  out({ type: "assistant", parent_tool_use_id: null, message: { id: "m" + turn, usage, content } });
  save("user", text);
  save("assistant");
  out({ type: "result", subtype: "success", num_turns: 1, result: rule.reply || "", usage });
}
process.stdin.setEncoding("utf8").on("data", (d) => {
  buf += d;
  let i;
  while ((i = buf.indexOf("\\n")) >= 0) {
    const text = JSON.parse(buf.slice(0, i)).message.content[0].text;
    buf = buf.slice(i + 1);
    turn++;
    log({ kind, trunk, turn, text });
    const t = turn;
    queue = queue.then(() => respond(text)).catch((err) => log({ kind, trunk, turn: t, error: String(err) }));
  }
}).on("end", () => queue.then(() => process.exit(0)));
setInterval(() => {}, 1000);
`;

export interface EmployeeRule {
  kind?: "trunk" | "fork" | "append";
  text?: string;
  model?: string;
  reply?: string;
  context?: number;
  /** Each tool call's context grows by this. */
  contextStep?: number;
  reads?: string[];
  calls?: { tool: "ask_expert" | "leave_draft"; arguments: Record<string, unknown> }[];
  callDelayMs?: number;
  subagentTools?: string[];
  /** Tools its init lists beside its own and Isoplan's. */
  initTools?: string[];
  /** Isoplan's tools it leaves out of its init. */
  dropTools?: string[];
  mcp?: "failed";
  exit?: boolean;
  hang?: boolean;
  delayMs?: number;
}

/** The usual employee: it grounds reading its documents, and each run leaves what its rule says. */
export const GROUNDS: EmployeeRule[] = [
  { kind: "trunk", text: "Reply with only the word: ready", reply: "ready", context: 20000 },
  { kind: "trunk", text: "Now read your job's documents", reply: "grounded", context: 40000, reads: ["outreach/who-qualifies.md"] },
  { kind: "trunk", text: "you learned what follows", reply: "added", context: 42000 },
  { kind: "append", reply: "added", context: 45000 },
];

export const draftTo = (address: string, text = `Hello from Adam, for ${address}.`) => ({ tool: "leave_draft" as const, arguments: { text, subject: "A question", to: { name: address.split("@")[0], address, organisation: "Agency" } } });

export const job = (o: Record<string, unknown> = {}) => ({
  version: 1,
  name: "adams-outreach",
  subject: "Drafts cold emails to agencies in Adam's voice.",
  model: "sonnet",
  brief: "Each run, draft one email to one person at each agency that qualifies.",
  rules: ["One email per agency."],
  documents: ["outreach/who-qualifies.md"],
  examples: [],
  schedule: { every: "day", at: "09:00", timeZone: "UTC" },
  tools: ["Read", "Grep", "Glob"],
  experts: ["adams-writing"],
  ...o,
});

export interface EmployeeSetUp {
  rules?: EmployeeRule[];
  job?: Record<string, unknown>;
  /** The clock's start. */
  at?: string;
  settings?: Partial<EmployeeSettings["employees"]>;
  /** Not tied to a published record. */
  untied?: boolean;
  ask?: (expert: string, question: string) => Promise<{ text: string; answer?: RunAnswer }>;
  root?: string;
  /** Real Claude Code in place of the fake, with the environment it runs in for this Claude folder. */
  claude?: { binary: string; env: (claudeDir: string) => Record<string, string | undefined> };
  /** No job file to start with: one made from the floor writes it. */
  noJob?: boolean;
  /** Wraps the real git, to put another computer's push between two of this one's calls. */
  git?: (real: RunGit) => RunGit;
  /** What its record of what it learned is bound to: nothing tied unless given. */
  learned?: WhatWasLearnedBinding;
  /** The registry's own minute timer, as the runner has it, in place of ticking by hand. */
  minuteTimer?: boolean;
  /** This computer's experts of its project, with their areas. */
  expertAreas?: { expert: string; areas: string[] }[];
}

export async function setUpEmployee(o: EmployeeSetUp = {}) {
  const root = o.root ?? tempRoot();
  const claudeDir = path.join(root, "claude");
  const isoplanDir = path.join(claudeDir, "isoplan");
  const employeesDir = path.join(isoplanDir, "employees");
  const rulesFile = path.join(root, "rules.json");
  const claudeLog = path.join(root, "claude.jsonl");
  const bin = path.join(root, "claude.js");
  fs.mkdirSync(employeesDir, { recursive: true });
  fs.writeFileSync(bin, FAKE_EMPLOYEE_CLAUDE);
  if (!fs.existsSync(claudeLog)) fs.writeFileSync(claudeLog, "");
  const rules = (r: EmployeeRule[]) => fs.writeFileSync(rulesFile, JSON.stringify(r));
  rules(o.rules ?? GROUNDS);
  // The project: a bare origin with its documents, and Adam's checkout of it.
  let checkout = path.join(root, "checkout");
  if (!fs.existsSync(checkout)) {
    const made = remoteAndClone(root, "checkout");
    checkout = made.clone;
    fs.mkdirSync(path.join(checkout, "outreach"), { recursive: true });
    fs.writeFileSync(path.join(checkout, "outreach", "who-qualifies.md"), "Agencies of 10 to 50 people.\n");
    git(checkout, "add", ".");
    git(checkout, "commit", "-q", "-m", "who qualifies");
    git(checkout, "push", "-q", "origin", "main");
  }
  const remote = path.join(root, "remote.git");
  const clock = { t: Date.parse(o.at ?? "2026-11-26T08:00:00Z") };
  const base = JSON.parse(fs.readFileSync(path.join(modDir, "runner.json"), "utf8")) as EmployeeSettings;
  const settings: EmployeeSettings = { ...base, employees: { ...base.employees, ...o.settings } };
  const tools: EmployeeTools = createEmployeeTools({ log: () => {} });
  await tools.start();
  const logs: string[] = [];
  const asked: { expert: string; question: string }[] = [];
  const env = o.claude ? o.claude.env(claudeDir) : { ...process.env, FAKE_RULES: rulesFile, FAKE_LOG: claudeLog, FAKE_PROJECTS: path.join(claudeDir, "projects") };
  const writeJob = (j: Record<string, unknown> = o.job ?? {}) => fs.writeFileSync(path.join(employeesDir, "adams-outreach.json"), JSON.stringify(job({ repo: checkout, ...j }), null, 2));
  if (!o.noJob) writeJob();
  let tied = !o.untied;
  const employees: Employees = createEmployees({
    employeesDir,
    logsDir: path.join(isoplanDir, "logs"),
    projectsDir: path.join(claudeDir, "projects"),
    appDir: modDir,
    binary: async () => o.claude?.binary ?? bin,
    settings: async () => settings,
    scan: async (text) => (text.includes("SECRET") ? "test secret" : null),
    git: o.git ? o.git(createRunGit()) : createRunGit(),
    gitTimeoutMs: async () => 20000,
    tools,
    account: ADAM,
    expertHasKey: () => false,
    expertsOf: () => [{ key: "adams-writing", subject: "How Adam writes." }],
    ...(o.expertAreas && { expertAreasOf: () => o.expertAreas! }),
    ask: async (_key, _run, expert, question) => (asked.push({ expert, question }), o.ask ? o.ask(expert, question) : { text: `${expert} answered: write warmly.` }),
    env,
    log: (t) => void logs.push(t),
    now: () => clock.t,
    lookMs: 50,
    minuteMs: 2000,
    ...(!o.minuteTimer && { tickMs: null }),
    cloneFrom: () => true,
    writeDelayMs: () => 10,
  });
  employees.bindTies((key) => (tied && key === "adams-outreach" ? RECORD : null));
  employees.bindWhatWasLearned(() => o.learned ?? NOTHING_TIED);
  employees.setProject("adams-outreach", "git.example.invalid/acme/docs");
  await employees.start();
  const e = () => employees.get("adams-outreach")!;
  const claude = () => fs.readFileSync(claudeLog, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l) as { kind: string; trunk: string; argv?: string[]; env?: Record<string, string>; turn?: number; text?: string; call?: string; result?: string; error?: string });
  const results = () => claude().filter((x) => x.call).map((x) => x.result!);
  const ready = () => until(async () => e().trunk?.state().state === "ready", 60000, "the employee grounded");
  const decided = (decision: "approved" | "rejected" | "skipped", draft: string, more: Record<string, unknown> = {}) =>
    employees.decide("adams-outreach", { type: "employee-draft-decided", v: PROTOCOL_VERSION, key: "adams-outreach", expertRecordId: RECORD, draft, by: ADAM, at: new Date(clock.t).toISOString(), decision, ...(decision === "rejected" && { correction: "Shorter, please.", teach: [] }), ...more } as EmployeeDraftDecidedMessage);
  // What the origin's main holds of who was contacted.
  const onRemote = () => {
    const look = path.join(root, `look-${Math.random().toString(36).slice(2)}`);
    git(root, "clone", "-q", remote, look);
    const file = path.join(look, "who-was-contacted.csv");
    return parseTable(fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null).rows;
  };
  const close = async () => {
    employees.close();
    await tools.stop();
  };
  // Another sender's computer pushing its own row of who was contacted.
  const valentinaPushes = (prospect: string, state = "contacted") => {
    const other = path.join(root, `valentina-${Math.random().toString(36).slice(2)}`);
    git(root, "clone", "-q", remote, other);
    const file = path.join(other, "who-was-contacted.csv");
    const before = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "prospect,state,sender,employee,since,name,organisation\r\n";
    fs.writeFileSync(file, before + `${prospect},${state},Valentina,valentinas-outreach,2026-11-24T10:00:00.000Z,,\r\n`);
    git(other, "-c", "user.name=V", "-c", "user.email=v@example.invalid", "add", ".");
    git(other, "-c", "user.name=V", "-c", "user.email=v@example.invalid", "commit", "-q", "-m", "Valentina");
    git(other, "push", "-q", "origin", "main");
  };
  return { valentinaPushes, root, claudeDir, employeesDir, remote, checkout, clock, settings, tools, logs, asked, employees, e, rules, claude, results, ready, decided, onRemote, writeJob, close, setTied: (t: boolean) => void (tied = t), dir: path.join(employeesDir, "adams-outreach") };
}
