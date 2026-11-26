// The `claude -p` call that writes a job from sessions in which a person started the same job by
// hand (isoplan-app#341, E6), run as expert-creation-suggestion-model-calls.ts runs its own:
//
//   claude -p --no-session-persistence --tools "" --setting-sources "" NO_HOOKS --strict-mcp-config
//     --model <jobFromSessionsModel> --system-prompt <prompts/employee-job-from-sessions.md> --output-format json
//
// with its input on stdin: no tools, no MCP server, no settings, no hook, never saved, hidden, in the
// OS's temp folder. It runs on the person's own Claude account, so what it is given goes only there.
// Its answer is one JSON object, each field checked against the protocol: a field that fails gives
// no job, never one cut.

import type { ChildProcessWithoutNullStreams } from "node:child_process";
import os from "node:os";
import { ExpertNameSchema, JobSchema, MAX_EXPERT_SUBJECT_LENGTH, type Job } from "@isoplan/protocol";
import { claudeCommand } from "./claude-binary.js";
import { forkEnv, hiddenSpawn, killTree, type Spawn } from "./claude.js";
import { expertCreationSuggestionModelCallArgs, resultOf } from "./expert-creation-suggestion-model-calls.js";

/** The job a model call wrote from sessions: never sent, but to its own person's browser. */
export interface JobFromSessions {
  key: string;
  subject: string;
  job: Job;
}

/** What it is given: the skill's own file where there is one, the sessions' first prompts and final reports, the experts they asked, and when they started. */
export interface JobFromSessionsInput {
  skill?: { name: string; text: string | null };
  sessions: { firstPrompt: string; finalReport: string; startedAt: string }[];
  experts: string[];
}

export function jobFromSessionsInput(i: JobFromSessionsInput): string {
  return [
    i.skill ? `The skill or command the sessions started with: /${i.skill.name}\n${i.skill.text ? `Its file:\n${i.skill.text}` : "(its file wasn't found)"}` : "The sessions started with the same prompt, not a skill.",
    "",
    `The experts the sessions asked: ${i.experts.length ? i.experts.join(", ") : "none"}`,
    "",
    "The sessions, newest first:",
    ...i.sessions.map((s, n) => `=== Session ${n + 1}, started ${s.startedAt}\nFirst prompt:\n${s.firstPrompt}\n\nFinal report:\n${s.finalReport || "(none)"}`),
  ].join("\n");
}

/** The job in the model's reply: its one JSON object, fenced or not; null when a field doesn't fit. */
export function jobFrom(text: string): JobFromSessions | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < start) return null;
  let o: Record<string, unknown>;
  try {
    o = JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
  const key = typeof o.key === "string" ? o.key.trim().toLowerCase().replace(/[\s_]+/g, "-") : "";
  const subject = typeof o.subject === "string" ? o.subject.trim() : "";
  if (!ExpertNameSchema.safeParse(key).success || !subject || subject.length > MAX_EXPERT_SUBJECT_LENGTH) return null;
  const job = JobSchema.safeParse({ brief: o.brief, rules: o.rules ?? [], documents: o.documents ?? [], examples: o.examples ?? [], schedule: o.schedule, tools: o.tools, experts: o.experts ?? [] });
  return job.success ? { key, subject, job: job.data } : null;
}

export interface JobFromSessionsModelCall {
  write(input: JobFromSessionsInput, s: { model: string; timeoutSeconds: number }): Promise<JobFromSessions | null>;
  close(): void;
}

export function createJobFromSessionsModelCall(o: { binary: () => Promise<string | null>; prompt: () => Promise<string>; log: (text: string) => void; spawn?: Spawn; env?: Record<string, string | undefined>; platform?: NodeJS.Platform }): JobFromSessionsModelCall {
  const spawn = o.spawn ?? hiddenSpawn;
  const platform = o.platform ?? process.platform;
  const running = new Set<ChildProcessWithoutNullStreams>();
  return {
    async write(input, s) {
      const bin = await o.binary();
      if (!bin) return null;
      let child: ChildProcessWithoutNullStreams;
      try {
        child = spawn([...claudeCommand(bin), ...expertCreationSuggestionModelCallArgs(s.model, (await o.prompt()).trim())], { cwd: os.tmpdir(), env: forkEnv(o.env ?? process.env) });
      } catch (err) {
        o.log(`couldn't start claude to write a job from sessions: ${(err as Error).message}`);
        return null;
      }
      running.add(child);
      const text = await new Promise<string | null>((resolve) => {
        let stdout = "";
        const timer = setTimeout(() => (killTree(child, platform), resolve(null)), s.timeoutSeconds * 1000);
        timer.unref?.();
        child.stdout.setEncoding("utf8").on("data", (piece: string) => (stdout += piece));
        child.stderr.resume();
        child.stdin.on("error", () => {});
        child.on("error", () => (clearTimeout(timer), resolve(null)));
        child.on("close", () => (clearTimeout(timer), resolve(resultOf(stdout))));
        child.stdin.end(jobFromSessionsInput(input));
      });
      running.delete(child);
      if (text === null) return (o.log("couldn't write a job from sessions: claude gave no result"), null);
      const job = jobFrom(text);
      if (!job) o.log("the job written from sessions wasn't usable: a field didn't fit the protocol");
      return job;
    },
    close() {
      for (const child of running) killTree(child, platform);
      running.clear();
    },
  };
}
