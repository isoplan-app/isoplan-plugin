// The `claude -p` calls behind expert offers (offers.ts): whether a person's message corrected the
// agent, and an expert's draft. Each runs as the naming call does (naming.ts):
//
//   claude -p --no-session-persistence --tools "" --setting-sources "" NO_HOOKS --strict-mcp-config
//     --model <draftModel> --system-prompt <prompts/correction.md or prompts/expert-draft.md> --output-format json
//
// with its input on stdin: no tools, no MCP servers, no settings file (so no plugin loads in it), no
// hook (NO_HOOKS), never saved, hidden, in the OS's temp folder, so no project's CLAUDE.md loads.
// One that takes longer than runner.json's `expertOffers.timeoutSeconds` is ended with its process
// tree. It runs on the person's own Claude account, so what the draft and the correction check are
// given goes only to that account, never to the office (ADR 0004 counts that as staying on the
// machine); the caller scans the draft for secrets before anything of it is sent to the office.
//
// - The check is given the agent's reply and the person's next message, and answers YES or NO.
// - The draft is given the repo's name, the folder, its files' names, the start of a few of them
//   (it reads nothing itself, so its proof is taken from those) and what the session said there,
//   and answers with one JSON object, { key, subject, proof: { question, answer } }. A key is lower-cased
//   and its spaces and underscores made dashes, then it must be an expert's name (expert-file.ts);
//   a field that is missing, empty, or longer than the protocol takes gives no draft, never one cut.

import type { ChildProcessWithoutNullStreams } from "node:child_process";
import os from "node:os";
import { ExpertNameSchema, MAX_EXPERT_ANSWER_LENGTH, MAX_EXPERT_SUBJECT_LENGTH, MAX_QUESTION_LENGTH, type Project } from "@isoplan/protocol";
import { claudeCommand } from "./claude-binary.js";
import { forkEnv, hiddenSpawn, killTree, NO_HOOKS, type Spawn } from "./claude.js";

/** An expert as the local model drafted it. */
export interface Draft {
  key: string;
  subject: string;
  proof: { question: string; answer: string };
}

/** What a draft is made from: it goes only to the person's own Claude account, never to the office. */
export interface DraftInput {
  project: Project;
  /** The folder, relative to the repo's root. */
  folder: string;
  /** Its files, relative to the repo's root. */
  files: string[];
  /** The start of a few of them, which the proof is taken from. */
  excerpts: { file: string; text: string }[];
  /** What the session said while it worked there (claude-code.ts SourceRead.said). */
  said: string[];
}

/** What the calls need of runner.json's `expertOffers`. */
export interface OfferModelSettings {
  draftModel: string;
  timeoutSeconds: number;
}

// The end of a call's stderr kept for the local log.
const STDERR_CHARS = 500;

/** Every flag of a call's command line, after the binary. */
export function offerModelArgs(model: string, system: string): string[] {
  return ["-p", "--no-session-persistence", "--tools", "", "--setting-sources", "", ...NO_HOOKS, "--strict-mcp-config", "--model", model, "--system-prompt", system, "--output-format", "json"];
}

/** The text of the call's result, the one JSON object `--output-format json` writes; null for a failure. */
export function resultOf(stdout: string): string | null {
  let e: Record<string, unknown>;
  try {
    e = JSON.parse(stdout.trim());
  } catch {
    return null;
  }
  if (!e || e.type !== "result" || e.is_error === true || e.subtype !== "success" || typeof e.result !== "string") return null;
  return e.result;
}

/** The check's word: YES true, NO false, anything else null. */
export function verdictFrom(text: string): boolean | null {
  const word = /^\W*(yes|no)\b/i.exec(text.trim())?.[1]?.toLowerCase();
  return word === "yes" ? true : word === "no" ? false : null;
}

/** The draft in the model's reply: its one JSON object, fenced or not; null when it isn't a whole draft. */
export function draftFrom(text: string): Draft | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < start) return null;
  let o: Record<string, unknown>;
  try {
    o = JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
  const proof = (o?.proof ?? {}) as Record<string, unknown>;
  const words = (v: unknown, max: number) => (typeof v === "string" && v.trim() && v.trim().length <= max ? v.trim() : null);
  const key = typeof o?.key === "string" ? o.key.trim().toLowerCase().replace(/[\s_]+/g, "-") : "";
  const subject = words(o?.subject, MAX_EXPERT_SUBJECT_LENGTH);
  const question = words(proof.question, MAX_QUESTION_LENGTH);
  const answer = words(proof.answer, MAX_EXPERT_ANSWER_LENGTH);
  if (!ExpertNameSchema.safeParse(key).success || !subject || !question || !answer) return null;
  return { key, subject, proof: { question, answer } };
}

/** The check's input: the agent's reply, then the person's message. It goes only to the person's own Claude account, never to the office. */
export const correctionInput = (text: string, reply: string | null) => `The agent's reply:\n${reply ?? "(none)"}\n\nThe person's next message:\n${text}`;

/** The draft's input. */
export function draftInput(d: DraftInput): string {
  return [
    `Repo: ${d.project.name}`,
    `Folder: ${d.folder}`,
    "",
    `Its files (${d.files.length}):`,
    ...(d.files.length ? d.files : ["(none listed)"]),
    "",
    "The start of some of them:",
    ...d.excerpts.map((e) => `=== ${e.file}\n${e.text}`),
    "",
    "What the session said while it worked there, oldest first:",
    d.said.length ? d.said.join("\n---\n") : "(nothing kept)",
  ].join("\n");
}

export interface OfferModel {
  /** Whether `text`, after the agent's `reply`, tells the agent it was wrong; null when no word came. */
  corrects(text: string, reply: string | null, settings: OfferModelSettings): Promise<boolean | null>;
  /** The draft of an expert on the input's folder; null when none usable came. */
  draft(input: DraftInput, settings: OfferModelSettings): Promise<Draft | null>;
  /** Ends every call still running, as the worker exits. */
  close(): void;
}

export interface OfferModelOptions {
  /** The `claude` binary, or null when none can be found. */
  binary: () => Promise<string | null>;
  /** A system prompt from prompts/, by its file name. */
  prompt: (name: "correction.md" | "expert-draft.md") => Promise<string>;
  log: (text: string) => void;
  spawn?: Spawn;
  env?: Record<string, string | undefined>;
  cwd?: string;
  platform?: NodeJS.Platform;
}

export function createOfferModel(o: OfferModelOptions): OfferModel {
  const spawn = o.spawn ?? hiddenSpawn;
  const env = o.env ?? process.env;
  const platform = o.platform ?? process.platform;
  const running = new Set<ChildProcessWithoutNullStreams>();

  // The result's text, or null with why in the log.
  async function ask(what: string, prompt: "correction.md" | "expert-draft.md", input: string, s: OfferModelSettings): Promise<string | null> {
    const bin = await o.binary();
    if (!bin) return null;
    const system = (await o.prompt(prompt)).trim();
    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawn([...claudeCommand(bin), ...offerModelArgs(s.draftModel, system)], { cwd: o.cwd ?? os.tmpdir(), env: forkEnv(env) });
    } catch (err) {
      o.log(`couldn't start claude to ${what}: ${(err as Error).message}`);
      return null;
    }
    running.add(child);
    return new Promise<string | null>((resolve) => {
      let stdout = "";
      let stderr = "";
      let over = false;
      const finish = (text: string | null, why?: string) => {
        if (over) return;
        over = true;
        clearTimeout(timer);
        running.delete(child);
        if (why) o.log(`couldn't ${what}: ${why}`);
        resolve(text);
      };
      const timer = setTimeout(() => {
        killTree(child, platform);
        finish(null, `it took longer than ${s.timeoutSeconds} s`);
      }, s.timeoutSeconds * 1000);
      timer.unref?.();
      child.stdout.setEncoding("utf8").on("data", (piece: string) => (stdout += piece));
      child.stderr.setEncoding("utf8").on("data", (piece: string) => (stderr = (stderr + piece).slice(-STDERR_CHARS)));
      child.stdin.on("error", () => {});
      child.on("error", (err) => finish(null, `claude failed: ${err.message}`));
      child.on("close", (code) => {
        const text = resultOf(stdout);
        finish(text, text !== null ? undefined : `claude exited${code === null ? "" : ` with code ${code}`} with no result${stderr.trim() ? `: ${stderr.trim().split("\n").slice(-2).join(" ")}` : ""}`);
      });
      child.stdin.end(input);
    });
  }

  return {
    async corrects(text, reply, s) {
      const said = await ask("check whether a message corrected the agent", "correction.md", correctionInput(text, reply), s);
      return said === null ? null : verdictFrom(said);
    },
    async draft(input, s) {
      const said = await ask(`draft an expert on ${input.folder}`, "expert-draft.md", draftInput(input), s);
      if (said === null) return null;
      const draft = draftFrom(said);
      if (!draft) o.log(`the draft of an expert on ${input.folder} wasn't usable: no key, subject, proof question and answer that fit`);
      return draft;
    },
    close() {
      for (const child of running) killTree(child, platform);
      running.clear();
    },
  };
}
