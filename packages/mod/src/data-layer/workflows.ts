// Claude Code workflows (the Workflow tool, also used by ultracode): every assumption about what a
// workflow run leaves on disk lives in this one file, as claude-code.ts keeps the transcripts'. The
// format is undocumented Claude Code internals, checked on real runs (6 Nov 2026):
//
// - <session>/subagents/workflows/<run id>/journal.jsonl: {type:"launched"}, then
//   {type:"started", agentId, label, phase, key} as each agent starts and {type:"result", agentId,
//   key, result} as each one ends. A started agent with no result is still at work; the journal has
//   no end-of-run line.
// - the same folder's agent-<id>.jsonl and agent-<id>.meta.json: a transcript like any subagent's,
//   and a meta.json with agentType, description (the label) and workflowPhase, but no toolUseId.
// - <session>/workflows/<run id>.json, written only when the run ends: status (completed, killed),
//   startTime, durationMs, totalTokens, workflowName, summary and phases.
// - <session>/workflows/scripts/<name>-<first run id>.js: the script, whose `export const meta`
//   gives name, description and phases. Later runs of a script reuse the first run's file, so a
//   run's id comes from its folder, never the script's file name.
// - the Workflow tool's result in the transcript that called it: { taskType: "local_workflow",
//   runId, taskId, workflowName, summary, scriptPath }.
//
// Nothing here runs the script: its meta is read as a plain object literal, and anything else in it
// is never read. Prompts, the script and its arguments never leave the machine; the labels, phases,
// name and description do, once `prepareWorkflows` has secret-checked them.

import {
  MAX_WORKFLOW_AGENTS,
  MAX_WORKFLOW_DESCRIPTION_LENGTH,
  MAX_WORKFLOW_LABEL_LENGTH,
  MAX_WORKFLOW_NAME_LENGTH,
  MAX_WORKFLOW_PHASE_DETAIL_LENGTH,
  MAX_WORKFLOW_PHASE_TITLE_LENGTH,
  MAX_WORKFLOW_PHASES,
  type Facts,
  type WorkflowFact,
} from "@isoplan/protocol";
import type { Config } from "./config.js";
import { join, type MaybePromise, type Stat } from "./git.js";
import type { DirEntry } from "./io.js";
import { scan, type Pattern } from "../runner/scan.js";

export interface WorkflowIo {
  listDir(dir: string): MaybePromise<DirEntry[]>;
  stat(path: string): MaybePromise<Stat | null>;
  read(path: string, start?: number, end?: number): MaybePromise<string>;
}

/** A workflow agent's transcript and meta.json, as claude-code.ts reads every subagent's. */
export interface WorkflowAgentFile extends Stat {
  id: string;
  path: string;
  metaPath: string;
  /** The run it is an agent of. */
  run: string;
}

/** One run's files, as listed. */
export interface WorkflowFiles {
  id: string;
  journal: (Stat & { path: string }) | null;
  record: (Stat & { path: string }) | null;
  agents: WorkflowAgentFile[];
  /** The newest write to any of them, in ms. */
  lastActive: number;
}

/** What the Workflow tool's result says of the run it launched. */
export interface WorkflowLaunch {
  runId: string;
  name: string | null;
  description: string | null;
  /** The script's file name, in the session's workflows/scripts folder. */
  script: string | null;
}

/** A run as read off disk. */
export interface RunState {
  /** Started agents, by agent id, in the order they started. */
  started: Map<string, { label: string; phase: string }>;
  /** Each ended agent's result as report text, null when it gave none, by agent id. */
  results: Map<string, string | null>;
  record: RunRecord | null;
  meta: ScriptMeta | null;
}

interface RunRecord {
  status: string;
  startedAt: number | null;
  endedAt: number;
  tokens: number | null;
  name: string | null;
  description: string | null;
  phases: WorkflowFact["phases"] | null;
}

interface ScriptMeta {
  name: string | null;
  description: string | null;
  phases: WorkflowFact["phases"] | null;
}

/** A workflow agent's place and state, as the agent loop needs it. */
export interface WorkflowAgentView {
  workflow: { id: string; phase: string; label: string };
  status: "working" | "stalled" | "done" | "stopped" | "failed";
  since: number;
  endState?: string;
  /** Its result, sent as its report once it is done. */
  report: string | null;
}

const RUN_ID = /^wf_[A-Za-z0-9_-]+$/;
const SCRIPT_NAME = /^[A-Za-z0-9_.-]+\.js$/;
const encoder = new TextEncoder();

/** The run a Workflow tool result launched, or null when it isn't one. */
export function workflowLaunch(toolUseResult: unknown): WorkflowLaunch | null {
  if (!toolUseResult || typeof toolUseResult !== "object") return null;
  const r = toolUseResult as Record<string, unknown>;
  if (r.taskType !== "local_workflow" || typeof r.runId !== "string" || !RUN_ID.test(r.runId)) return null;
  const base = typeof r.scriptPath === "string" ? r.scriptPath.split(/[\\/]/).pop()! : "";
  return { runId: r.runId, name: text(r.workflowName), description: text(r.summary), script: SCRIPT_NAME.test(base) ? base : null };
}

/**
 * The runs under a session's folder (its transcript's path without .jsonl): each folder in
 * subagents/workflows with its journal, end record and agents. A run whose end record is older than
 * `keepMs` is left out without listing its folder.
 */
export async function listWorkflows(io: WorkflowIo, sessionDir: string, now: number, keepMs: number): Promise<WorkflowFiles[]> {
  const root = join(sessionDir, "subagents/workflows");
  const out: WorkflowFiles[] = [];
  for (const d of await io.listDir(root)) {
    if (!d.isDir || !RUN_ID.test(d.name)) continue;
    const recordPath = join(sessionDir, `workflows/${d.name}.json`);
    const rst = await io.stat(recordPath);
    if (rst && now - rst.mtimeMs > keepMs) continue;
    const dir = join(root, d.name);
    const jpath = join(dir, "journal.jsonl");
    const jst = await io.stat(jpath);
    const agents: WorkflowAgentFile[] = [];
    for (const f of await io.listDir(dir)) {
      const m = /^agent-(.+)\.jsonl$/.exec(f.name);
      if (f.isDir || !m) continue;
      const ast = await io.stat(join(dir, f.name));
      if (ast) agents.push({ id: m[1]!, path: join(dir, f.name), metaPath: join(dir, `agent-${m[1]}.meta.json`), run: d.name, ...ast });
    }
    if (!jst && !agents.length) continue;
    const lastActive = Math.max(jst?.mtimeMs ?? -Infinity, rst?.mtimeMs ?? -Infinity, ...agents.map((a) => a.mtimeMs));
    out.push({ id: d.name, journal: jst && { ...jst, path: jpath }, record: rst && { ...rst, path: recordPath }, agents, lastActive });
  }
  return out;
}

/**
 * Keep it for the life of the data layer: it reads each journal incrementally and each end record
 * and script once per change. `prune` drops what the latest pass didn't use; `frozen` keeps an
 * ended run's fact, which never changes again.
 */
export function createWorkflowReader(io: WorkflowIo) {
  const journals = new Map<string, { offset: number; started: RunState["started"]; results: RunState["results"] }>();
  const files = new Map<string, { mtimeMs: number; value: unknown }>();
  const frozen = new Map<string, WorkflowFact>();
  let used = new Set<string>();

  async function readJournal(f: NonNullable<WorkflowFiles["journal"]>) {
    used.add(f.path);
    let st = journals.get(f.path);
    if (!st || f.size < st.offset) journals.set(f.path, (st = { offset: 0, started: new Map(), results: new Map() }));
    if (f.size <= st.offset) return st;
    const chunk = await io.read(f.path, st.offset, f.size);
    const lastNl = chunk.lastIndexOf("\n");
    if (lastNl < 0) return st;
    st.offset = f.size - encoder.encode(chunk.slice(lastNl + 1)).length;
    for (const line of chunk.slice(0, lastNl).split("\n")) {
      let ev: Record<string, unknown>;
      try {
        ev = JSON.parse(line);
      } catch {
        continue;
      }
      if (!ev || typeof ev !== "object" || typeof ev.agentId !== "string" || !ev.agentId) continue;
      if (ev.type === "started") st.started.set(ev.agentId, { label: text(ev.label) ?? "", phase: text(ev.phase) ?? "" });
      if (ev.type === "result") st.results.set(ev.agentId, resultText(ev.result));
    }
    return st;
  }

  // A JSON file or a script, parsed once per change; null when it is missing or doesn't parse.
  async function readFile<T>(path: string, parse: (text: string) => T | null): Promise<T | null> {
    used.add(path);
    const st = await io.stat(path);
    if (!st) return null;
    const hit = files.get(path);
    if (hit && hit.mtimeMs === st.mtimeMs) return hit.value as T | null;
    let value: T | null = null;
    try {
      value = parse(await io.read(path));
    } catch {
      // An unreadable file reads as missing.
    }
    files.set(path, { mtimeMs: st.mtimeMs, value });
    return value;
  }

  return {
    frozen,
    begin() {
      used = new Set();
    },
    prune(runs: Iterable<string>) {
      for (const cache of [journals, files]) for (const key of cache.keys()) if (!used.has(key)) cache.delete(key);
      const live = new Set(runs);
      for (const id of frozen.keys()) if (!live.has(id)) frozen.delete(id);
    },
    /** The run's journal, end record and script meta; `script` is the script's file name, from its launch. */
    async read(f: WorkflowFiles, sessionDir: string, script: string | null): Promise<RunState> {
      const j = f.journal ? await readJournal(f.journal) : null;
      const record = f.record ? await readFile(f.record.path, parseRecord) : null;
      let meta: ScriptMeta | null = null;
      if (!record?.phases) {
        const scripts = join(sessionDir, "workflows/scripts");
        // With no launch in view, the script a run's own id names: the first run of that script.
        const name = script ?? (await io.listDir(scripts)).find((e) => !e.isDir && e.name.endsWith(`-${f.id}.js`))?.name ?? null;
        if (name) meta = await readFile(join(scripts, name), parseScriptMeta);
      }
      return { started: j?.started ?? new Map(), results: j?.results ?? new Map(), record, meta };
    },
  };
}

/**
 * The run's agents in the order they started, then any whose start isn't in the journal yet, at
 * most MAX_WORKFLOW_AGENTS; `more` counts the rest.
 */
export function agentsInView(f: WorkflowFiles, run: RunState): { kept: WorkflowAgentFile[]; more: number } {
  const order = [...run.started.keys()];
  const rank = (id: string) => {
    const i = order.indexOf(id);
    return i < 0 ? order.length : i;
  };
  const all = [...f.agents].sort((a, b) => rank(a.id) - rank(b.id) || a.mtimeMs - b.mtimeMs);
  return { kept: all.slice(0, MAX_WORKFLOW_AGENTS), more: Math.max(0, all.length - MAX_WORKFLOW_AGENTS) };
}

export interface ViewInput {
  files: WorkflowFiles;
  run: RunState;
  /** The run's launch and who made it, when the call is in view. */
  launch: (WorkflowLaunch & { at: number; by: string }) | null;
  /** The agents in view, with what their transcripts and meta.json say. */
  agents: { file: WorkflowAgentFile; firstAt: number; lastAt: number; tokens: number; meta: { description?: unknown; workflowPhase?: unknown } }[];
  more: number;
  session: string;
  /** Who started it when its launch isn't in view: the lead. */
  lead: string;
  now: number;
  config: Pick<Config, "stalledMinutes" | "idleMinutes">;
  /** An ended run's fact as first built, which stays as it was. */
  frozen?: WorkflowFact;
}

/** The run's fact, and each of its agents' place and state. */
export function viewWorkflow(input: ViewInput): { fact: WorkflowFact; agents: Map<string, WorkflowAgentView> } {
  const { files, run, launch, now, config } = input;
  const record = run.record;
  const stalledMs = config.stalledMinutes * 60000;
  const journalAt = files.journal?.mtimeMs ?? -Infinity;
  const ended = record ? endStatus(record.status) : null;

  const agents = new Map<string, WorkflowAgentView>();
  for (const a of input.agents) {
    const started = run.started.get(a.file.id);
    const label = cut(started?.label || text(a.meta.description) || "", MAX_WORKFLOW_LABEL_LENGTH);
    const phase = cut(started?.phase || text(a.meta.workflowPhase) || "", MAX_WORKFLOW_PHASE_TITLE_LENGTH);
    const workflow = { id: files.id, phase, label };
    const lastAt = Number.isFinite(a.lastAt) ? a.lastAt : a.file.mtimeMs;
    if (run.results.has(a.file.id)) {
      agents.set(a.file.id, { workflow, status: "done", since: lastAt, endState: "completed", report: run.results.get(a.file.id)! });
    } else if (record && ended) {
      agents.set(a.file.id, { workflow, status: ended, since: record.endedAt, endState: record.status, report: null });
    } else {
      // At work while it or the journal has been written within stalledMinutes; stalled after.
      const quietSince = Math.max(a.file.mtimeMs, journalAt);
      const working = now - quietSince <= stalledMs;
      agents.set(a.file.id, { workflow, status: working ? "working" : "stalled", since: working ? (Number.isFinite(a.firstAt) ? a.firstAt : a.file.mtimeMs) : quietSince + stalledMs, report: null });
    }
  }
  if (input.frozen) return { fact: input.frozen, agents };

  const meta = run.meta;
  const firsts = input.agents.map((a) => a.firstAt).filter(Number.isFinite);
  const startedAt = record?.startedAt ?? launch?.at ?? (firsts.length ? Math.min(...firsts) : files.lastActive);
  const name = launch?.name ?? record?.name ?? meta?.name ?? files.id;
  const description = launch?.description ?? record?.description ?? meta?.description;
  // With no end record or script meta, the phases its agents ran in, in the order they first did.
  const phases: WorkflowFact["phases"] = record?.phases ?? meta?.phases ?? [...new Set([...run.started.values()].map((s) => s.phase).filter(Boolean))].map((title) => ({ title }));
  const quiet = now - files.lastActive;
  const status: WorkflowFact["status"] = ended ?? (quiet <= stalledMs ? "running" : quiet <= config.idleMinutes * 60000 ? "stalled" : "idle");
  const tokens = record?.tokens ?? input.agents.reduce((n, a) => n + a.tokens, 0);
  const fact: WorkflowFact = {
    id: files.id,
    session: input.session,
    startedBy: launch?.by ?? input.lead,
    name: cut(name, MAX_WORKFLOW_NAME_LENGTH),
    ...(description ? { description: cut(description, MAX_WORKFLOW_DESCRIPTION_LENGTH) } : {}),
    phases: phases.slice(0, MAX_WORKFLOW_PHASES).map((p) => ({ title: cut(p.title, MAX_WORKFLOW_PHASE_TITLE_LENGTH), ...(p.detail ? { detail: cut(p.detail, MAX_WORKFLOW_PHASE_DETAIL_LENGTH) } : {}) })),
    status,
    startedAt: iso(startedAt, files.lastActive),
    ...(record ? { endedAt: iso(record.endedAt, files.record!.mtimeMs) } : {}),
    ...(tokens > 0 ? { usage: { tokens } } : {}),
    ...(input.more ? { moreAgents: input.more } : {}),
  };
  return { fact, agents };
}

/** What withheld workflow text, or a withheld task or description, says in its place. */
export const WORKFLOW_WITHHELD = "Hidden by the secret check";

/**
 * The facts with each workflow's name, description, phase titles and details, its agents' labels
 * and phases, and every subagent's task and description, workflow or not, secret-checked: a text
 * the scan matches, and every one while `patterns` is null, goes out as WORKFLOW_WITHHELD. The task
 * and description are checked on their own: they come uncut from meta.json, while a workflow
 * agent's label is cut and may come from the journal.
 */
export function prepareWorkflows(facts: Facts, patterns: Pattern[] | null, log: (text: string) => void): Facts {
  const check = (value: string, what: string) => {
    if (!value) return value;
    const matched = scan(value, patterns);
    if (!matched) return value;
    log(`withheld ${what}: ${patterns ? `it matches the secret pattern "${matched}"` : "the secret patterns couldn't be read"}`);
    return WORKFLOW_WITHHELD;
  };
  // What the lead wrote when it started an agent, from its meta.json, for every subagent.
  const agents = facts.agents.map((a) => {
    const task = a.task === null ? null : check(a.task, `the task of ${a.id}`);
    const said = a.extra?.description;
    const description = typeof said === "string" ? check(said, `the description of ${a.id}`) : said;
    const workflow = a.workflow && { ...a.workflow, label: check(a.workflow.label, `the label of ${a.id}`), phase: check(a.workflow.phase, `the phase of ${a.id}`) };
    if (task === a.task && description === said && workflow?.label === a.workflow?.label && workflow?.phase === a.workflow?.phase) return a;
    return {
      ...a,
      ...(workflow ? { workflow } : {}),
      task,
      ...(description === said ? {} : { extra: { ...a.extra, description } }),
    };
  });
  if (!facts.workflows?.length) return { ...facts, agents };
  const workflows = facts.workflows.map((w) => {
    const { description, ...rest } = w;
    const said = description === undefined ? undefined : check(description, `the description of workflow ${w.id}`);
    return {
      ...rest,
      name: check(w.name, `the name of workflow ${w.id}`),
      ...(said === undefined ? {} : { description: said }),
      phases: w.phases.map((p, i) => ({
        title: check(p.title, `phase ${i + 1}'s title in workflow ${w.id}`),
        ...(p.detail === undefined ? {} : { detail: check(p.detail, `phase ${i + 1}'s detail in workflow ${w.id}`) }),
      })),
    };
  });
  return { ...facts, agents, workflows };
}

/**
 * The agent state an end state means, for any subagent and for an agent an ended run leaves with no
 * result. Killed and stopped mean someone ended it early: it never answers, so it leaves no report.
 */
export function endStatus(state: string): "done" | "stopped" | "failed" {
  return state === "completed" ? "done" : state === "killed" || state === "stopped" ? "stopped" : "failed";
}

function parseRecord(textIn: string): RunRecord | null {
  const r = JSON.parse(textIn) as Record<string, unknown> | null;
  if (!r || typeof r !== "object") return null;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const start = num(r.startTime);
  const duration = num(r.durationMs);
  const stamp = typeof r.timestamp === "string" ? Date.parse(r.timestamp) : NaN;
  const endedAt = start !== null && duration !== null ? start + duration : stamp;
  const tokens = num(r.totalTokens);
  return {
    status: text(r.status) ?? "failed",
    startedAt: start,
    endedAt,
    tokens: tokens !== null && tokens >= 0 ? Math.round(tokens) : null,
    name: text(r.workflowName),
    description: text(r.summary),
    phases: phasesOf(r.phases),
  };
}

/** The script's `export const meta = {...}`, read as a plain object literal: nothing in it runs. */
export function parseScriptMeta(src: string): ScriptMeta | null {
  const m = /export\s+const\s+meta\s*=\s*/.exec(src);
  if (!m) return null;
  const value = literal(src, m.index + m[0].length);
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const o = value as Record<string, unknown>;
  return { name: text(o.name), description: text(o.description), phases: phasesOf(o.phases) };
}

function phasesOf(v: unknown): WorkflowFact["phases"] | null {
  if (!Array.isArray(v)) return null;
  const out: WorkflowFact["phases"] = [];
  for (const p of v) {
    const title = p && typeof p === "object" ? text((p as Record<string, unknown>).title) : null;
    if (!title) continue;
    const detail = text((p as Record<string, unknown>).detail);
    out.push({ title, ...(detail ? { detail } : {}) });
  }
  return out;
}

// A JavaScript literal at `start`: objects, arrays, quoted and plain template strings, numbers,
// true, false and null, with comments and trailing commas. Anything else (a call, a name, a
// template with ${…}) makes it unreadable: null.
function literal(src: string, start: number): unknown {
  let i = start;
  const fail = (): never => {
    throw new Error("not a literal");
  };
  const space = () => {
    for (;;) {
      while (i < src.length && /\s/.test(src[i]!)) i++;
      if (src.startsWith("//", i)) {
        const end = src.indexOf("\n", i);
        i = end < 0 ? src.length : end;
      } else if (src.startsWith("/*", i)) {
        const end = src.indexOf("*/", i + 2);
        i = end < 0 ? fail() : end + 2;
      } else return;
    }
  };
  // The escape at i, decoded as JavaScript does; i moves past it.
  const escape = (): string => {
    const c = src[i + 1] ?? fail();
    i += 2;
    const hex = (n: number): number => {
      const h = src.slice(i, i + n);
      if (!new RegExp(`^[0-9a-fA-F]{${n}}$`).test(h)) fail();
      i += n;
      return parseInt(h, 16);
    };
    if (c === "u" && src[i] === "{") {
      const end = src.indexOf("}", i);
      const h = end < 0 ? fail() : src.slice(i + 1, end);
      const code = /^[0-9a-fA-F]{1,6}$/.test(h) ? parseInt(h, 16) : fail();
      if (code > 0x10ffff) fail();
      i = end + 1;
      return String.fromCodePoint(code);
    }
    if (c === "u") return String.fromCharCode(hex(4));
    if (c === "x") return String.fromCharCode(hex(2));
    // A backslash before a line break continues the line.
    if (c === "\r") {
      if (src[i] === "\n") i++;
      return "";
    }
    const simple: Record<string, string> = { n: "\n", t: "\t", r: "\r", b: "\b", f: "\f", v: "\v", "0": "\0", "\n": "", " ": "", " ": "" };
    return simple[c] ?? c;
  };
  const str = (): string => {
    const q = src[i++]!;
    let out = "";
    while (i < src.length && src[i] !== q) {
      if (q === "`" && src.startsWith("${", i)) fail();
      out += src[i] === "\\" ? escape() : src[i++];
    }
    if (src[i] !== q) fail();
    i++;
    return out;
  };
  const value = (depth: number): unknown => {
    if (depth > 20) fail();
    space();
    const c = src[i];
    if (c === "{") {
      i++;
      const o: Record<string, unknown> = {};
      for (;;) {
        space();
        if (src[i] === "}") return (i++, o);
        let key: string;
        if (src[i] === "'" || src[i] === '"') key = str();
        else {
          key = /^[A-Za-z_$][\w$]*/.exec(src.slice(i, i + 200))?.[0] ?? fail();
          i += key.length;
        }
        space();
        if (src[i++] !== ":") fail();
        // defineProperty, so a key named __proto__ is only a key.
        Object.defineProperty(o, key, { value: value(depth + 1), enumerable: true, writable: true, configurable: true });
        space();
        if (src[i] === ",") i++;
        else if (src[i] !== "}") fail();
      }
    }
    if (c === "[") {
      i++;
      const a: unknown[] = [];
      for (;;) {
        space();
        if (src[i] === "]") return (i++, a);
        a.push(value(depth + 1));
        space();
        if (src[i] === ",") i++;
        else if (src[i] !== "]") fail();
      }
    }
    if (c === "'" || c === '"' || c === "`") return str();
    const word = /^(?:-?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?|true|false|null)(?![\w$])/.exec(src.slice(i, i + 50))?.[0] ?? fail();
    i += word.length;
    return word === "true" ? true : word === "false" ? false : word === "null" ? null : Number(word);
  };
  try {
    return value(0);
  } catch {
    return null;
  }
}

// A result as its report: a text as it is, anything else as JSON; none, null.
function resultText(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  if (typeof v === "string") return v.trim() ? v : null;
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return null;
  }
}

const text = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

// A text cut to `max` characters, never splitting a surrogate pair.
function cut(s: string, max: number): string {
  if (s.length <= max) return s;
  let end = max;
  const code = s.charCodeAt(end - 1);
  if (code >= 0xd800 && code <= 0xdbff) end--;
  return s.slice(0, end);
}

function iso(ms: number, fallback: number): string {
  return new Date(Number.isFinite(ms) ? ms : fallback).toISOString();
}
