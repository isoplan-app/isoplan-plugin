// Room titles: a short title written by a small model for a session whose title is only its
// branch (Claude Code hasn't written one yet, or never does, as in the Claude app). The hooks
// module makes the call on the owner's own login; this file decides what to ask, when, and what to
// keep from the reply.
//
// The prompt is built only from the session's facts: the branch, its edited files, and its
// subagents' types and task names. Never a user message, though the branch and task names can
// carry a person's words. So each of them goes through the secret scan first: one it matches is left
// out, and while the patterns can't be read no call is made, since the model could copy a secret into
// the title, or reword or clip it past what the scan can see. Whatever wrote it (this call, Claude
// Code's own ai-title, the branch stand-in, the runner's name for a driven session), the session's
// title is scanned again as it goes to an office (`prepareTitle`).

import type { Facts } from "@isoplan/protocol";
import { scan, type Pattern } from "../runner/scan.js";
import { WORKFLOW_WITHHELD } from "./workflows.js";

const ASK_EVERY_MS = 10 * 60000; // at most one call in this long
const MAX_FILES = 15;
const MAX_TASKS = 10;
const MAX_TITLE = 60;

export const TITLE_SYSTEM =
  "You name coding sessions for a floor plan of a team's work. From the facts given, write a title of 3 to 6 words saying what the session is working on. Reply with the title alone: no quotes and no full stop.";

export interface TitleInputs {
  branch: string | null;
  files: string[];
  types: string[];
  tasks: string[];
}

/** The session's last title call: the inputs it was written from, the title, and when it was asked. */
export interface TitleCache {
  key: string | null;
  title: string | null;
  at: number;
}

/** What the session's title is written from, each list sorted. */
export function titleInputs(facts: Facts): TitleInputs {
  const subs = facts.agents.filter((a) => a.startedBy !== null);
  // The newest edits and tasks, when there are more than a prompt needs. Files match
  // case-insensitively, named by the first spelling seen.
  const files = new Map<string, { file: string; at: string }>(); // lower-cased file → newest
  for (const e of facts.edits) {
    const hit = files.get(e.file.toLowerCase());
    if (!hit) files.set(e.file.toLowerCase(), { file: e.file, at: e.at });
    else if (e.at > hit.at) hit.at = e.at;
  }
  const tasks = subs.filter((a) => a.task).sort((a, b) => cmp(b.lastActive, a.lastActive));
  return {
    branch: facts.session.branch,
    files: [...files.values()]
      .sort((a, b) => cmp(b.at, a.at))
      .slice(0, MAX_FILES)
      .map((f) => f.file)
      .sort(),
    types: [...new Set(subs.map((a) => a.agentType).filter((t): t is string => !!t))].sort(),
    tasks: [...new Set(tasks.map((a) => a.task!))].slice(0, MAX_TASKS).sort(),
  };
}

/** The cache key for the inputs: a new call goes out only when this changes. */
export const titleKey = (inputs: TitleInputs) => JSON.stringify(inputs);

/** The prompt for the inputs. */
export function titlePrompt({ branch, files, types, tasks }: TitleInputs): string {
  const out = [`Branch: ${branch || "(none)"}`];
  if (files.length) out.push("Files edited:", ...files.map((f) => "- " + f));
  if (types.length) out.push(`Agent types: ${types.join(", ")}`);
  if (tasks.length) out.push("Subagent tasks:", ...tasks.map((t) => "- " + t));
  return out.join("\n");
}

/** The title from a reply's text: its first line, unquoted, clipped; null when nothing is left. */
export function cleanTitle(reply: string): string | null {
  const first =
    reply
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find(Boolean) || "";
  const title = first.replace(/^["'`*]+|["'`*.]+$/g, "").trim();
  if (!title) return null;
  return title.length <= MAX_TITLE ? title : title.slice(0, MAX_TITLE - 1).trimEnd() + "…";
}

/**
 * The title call due now, or null: when the session is titled by its branch, its inputs changed
 * since its last written title, and its last ask was at least ASK_EVERY_MS ago. An input the scan
 * matches is left out of it; with `patterns` null there is none.
 */
export function nextTitle(facts: Facts, cache: TitleCache | null, now: number, patterns: Pattern[] | null): { key: string; prompt: string } | null {
  if (facts.session.titleFrom !== "branch" || !patterns) return null;
  const clean = (text: string) => !scan(text, patterns);
  const all = titleInputs(facts);
  const inputs: TitleInputs = { branch: all.branch && clean(all.branch) ? all.branch : null, files: all.files.filter(clean), types: all.types.filter(clean), tasks: all.tasks.filter(clean) };
  if (!inputs.branch && !inputs.files.length && !inputs.tasks.length) return null; // nothing to go on
  const key = titleKey(inputs);
  if (cache && (cache.key === key || now - cache.at < ASK_EVERY_MS)) return null;
  return { key, prompt: titlePrompt(inputs) };
}

/**
 * The facts with the session's title secret-checked: one the scan matches, and every one while
 * `patterns` is null, goes out as WORKFLOW_WITHHELD.
 */
export function prepareTitle(facts: Facts, patterns: Pattern[] | null, log: (text: string) => void): Facts {
  const title = facts.session.title;
  const matched = title ? scan(title, patterns) : null;
  if (!matched) return facts;
  log(`withheld the session's title: ${patterns ? `it matches the secret pattern "${matched}"` : "the secret patterns couldn't be read"}`);
  return { ...facts, session: { ...facts.session, title: WORKFLOW_WITHHELD } };
}

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
