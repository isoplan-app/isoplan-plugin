// The signal behind an offer to make an employee (isoplan-app#341, E6, ADR 0013): the same job
// started by hand on a rhythm, measured on this computer from the sessions the runner reports.
//
// - A session's job is its first message from its person (data-layer/claude-code.ts firstMessages):
//   a command counts only when it is one of the person's skills or commands (~/.claude/skills/<x>/,
//   ~/.claude/commands/<x>.md, the repo's .claude/skills/<x>/ or .claude/commands/<x>.md, or a
//   plugin's, `<plugin>:<x>`, which no built-in is named like); any other command is a built-in
//   (/model, /effort) and is skipped, so the first message left decides. A skill start is its name;
//   a prompt is its text normalised (lower case, white space collapsed, the first 2000 characters),
//   hashed with sha256, so two prompts that differ in a word never match. A helper prompt
//   (config.json's `helperPrompts`) never counts.
// - The rhythm (runner.json's `employees.offerAfter`): the same job started on `daysOfTheLastSeven`
//   of the last 7 local days, or in each of the last `weeksRunning` weeks, each 7-day window back
//   from today holding one start.
// - Kept in ~/.claude/isoplan/runner/jobs-started-by-hand.json: per session, its first local day,
//   its skill or its prompt's hash, its office and project; `rememberStartsDays`. Never sent.

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { FirstMessage } from "../data-layer/claude-code.js";
import { readJson, writeJson } from "./expert-state.js";

const DAY = 24 * 3600000;

export type Rhythm = { kind: "days"; days: number } | { kind: "weeks"; weeks: number };

export interface StartedByHand {
  session: string;
  /** Its first local day, YYYY-MM-DD. */
  day: string;
  at: number;
  /** `skill:<name>` or `prompt:<sha256>`. */
  job: string;
  skill?: string;
  server: string;
  project: string;
  cwd: string;
}

export interface JobsStartedByHandOptions {
  file: string;
  claudeDir: string;
  settings: () => Promise<{ offerAfter: { daysOfTheLastSeven: number; weeksRunning: number }; rememberStartsDays: number }>;
  helperPrompts: () => Promise<readonly string[]>;
  now?: () => number;
  /** A job's rhythm crossed its threshold: its starts, newest first. */
  onRhythm: (job: string, rhythm: Rhythm, starts: StartedByHand[]) => void;
  log: (text: string) => void;
}

export interface JobsStartedByHand {
  load(): Promise<void>;
  seen(s: { server: string; bare: string; cwd: string; project: { id: string }; at: number; messages: FirstMessage[] }): Promise<void>;
  starts(job: string): StartedByHand[];
}

/** A prompt as it is matched: lower case, white space collapsed, its first 2000 characters. */
export const normalisedPrompt = (text: string) => text.toLowerCase().replace(/\s+/g, " ").trim().slice(0, 2000);
const localDay = (t: number) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/** Whether `name` is one of the person's skills or commands for a session in `cwd`. */
export function personsSkill(name: string, claudeDir: string, cwd: string): boolean {
  if (name.includes(":")) return true;
  const places = [path.join(claudeDir, "skills", name), path.join(claudeDir, "commands", `${name}.md`)];
  for (let dir = cwd, n = 0; n < 4; n++, dir = path.dirname(dir)) {
    places.push(path.join(dir, ".claude", "skills", name), path.join(dir, ".claude", "commands", `${name}.md`));
    if (path.dirname(dir) === dir) break;
  }
  return places.some((p) => fs.existsSync(p));
}

/** The rhythm of `starts` at `now`, by local day, or null below the threshold. */
export function rhythmOf(starts: readonly { at: number }[], now: number, after: { daysOfTheLastSeven: number; weeksRunning: number }): Rhythm | null {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const daysAgo = (t: number) => {
    const d = new Date(t);
    d.setHours(0, 0, 0, 0);
    return Math.round((today.getTime() - d.getTime()) / DAY);
  };
  const ago = new Set(starts.map((s) => daysAgo(s.at)).filter((n) => n >= 0));
  const days = [...ago].filter((n) => n < 7).length;
  if (days >= after.daysOfTheLastSeven) return { kind: "days", days };
  let weeks = 0;
  while ([...ago].some((n) => n >= weeks * 7 && n < (weeks + 1) * 7)) weeks++;
  if (weeks >= after.weeksRunning) return { kind: "weeks", weeks };
  return null;
}

export function createJobsStartedByHand(o: JobsStartedByHandOptions): JobsStartedByHand {
  const now = o.now ?? Date.now;
  let starts: StartedByHand[] = [];
  let writing: Promise<void> = Promise.resolve();
  const save = () => {
    const copy = structuredClone(starts);
    writing = writing.then(() => writeJson(o.file, { version: 1, starts: copy })).catch((err: Error) => o.log(`couldn't write ${o.file}: ${err.message}`));
    return writing;
  };
  return {
    async load() {
      const read = (await readJson(o.file)) as { version?: unknown; starts?: unknown } | null;
      if (read?.version === 1 && Array.isArray(read.starts)) starts = read.starts as StartedByHand[];
    },
    async seen(s) {
      if (starts.some((x) => x.session === s.bare)) return;
      let job: { job: string; skill?: string } | null = null;
      for (const m of s.messages) {
        if ("command" in m) {
          if (personsSkill(m.command, o.claudeDir, s.cwd)) {
            job = { job: `skill:${m.command}`, skill: m.command };
            break;
          }
          continue;
        }
        const opening = m.prompt.trimStart().toLowerCase();
        if ((await o.helperPrompts()).some((p) => p && opening.startsWith(p.toLowerCase()))) return;
        job = { job: `prompt:${createHash("sha256").update(normalisedPrompt(m.prompt)).digest("hex")}` };
        break;
      }
      if (!job) return;
      const settings = await o.settings();
      starts = starts.filter((x) => now() - x.at < settings.rememberStartsDays * DAY);
      const start: StartedByHand = { session: s.bare, day: localDay(s.at), at: s.at, ...job, server: s.server, project: s.project.id.toLowerCase(), cwd: s.cwd };
      starts.push(start);
      await save();
      const same = starts.filter((x) => x.job === job.job).sort((a, b) => b.at - a.at);
      const rhythm = rhythmOf(same, now(), settings.offerAfter);
      if (rhythm) o.onRhythm(job.job, rhythm, same);
    },
    starts: (job) => starts.filter((x) => x.job === job).sort((a, b) => b.at - a.at),
  };
}
