// A short name for a session driven from the floor (#129), from its first instruction. Claude Code
// writes no title (`ai-title`) for a headless `claude -p` session: none of 36 such transcripts on a
// Windows machine had one (9 Nov 2026, Claude Code 2.1.319), though most terminal sessions did. So the
// runner asks once, off the session's own turn:
//
//   claude -p --no-session-persistence --tools "" --setting-sources "" --strict-mcp-config
//     --model <namingModel> --system-prompt <prompts/naming.md> --output-format json
//
// with the instruction on stdin. As the answerer's fork (claude.ts), it has no tools and no MCP
// servers, reads no settings file, so no plugin or hook loads in it, and is never saved; it runs
// hidden in the OS's temp folder, so no project's CLAUDE.md loads either. Probed the same day: Haiku
// answered in about 3 s with one JSON object, `type` "result", `subtype` "success", `is_error`
// false, its `result` the name ("Fix login 500 error for plus-sign emails"). One that takes longer
// than `namingTimeoutSeconds` is ended with its process tree. The caller passes the name through the
// secret scan before it goes anywhere.

import type { ChildProcessWithoutNullStreams } from "node:child_process";
import os from "node:os";
import { cleanTitle } from "../data-layer/titles.js";
import { claudeCommand } from "./claude-binary.js";
import { forkEnv, hiddenSpawn, killTree, type Spawn } from "./claude.js";

/** What runner.json says of naming sessions. */
export interface NamingSettings {
  /** The small model that writes a session's name. */
  namingModel: string;
  /** How long the call may take before it is ended and the session keeps its folder's name. */
  namingTimeoutSeconds: number;
}

// The start of the instruction the name is written from: plenty for 3 to 6 words.
const INSTRUCTION_CHARS = 2000;
// The end of the call's stderr kept for the local log.
const STDERR_CHARS = 500;

/** Every flag of the naming call's command line, after the binary. */
export function namingArgs(model: string, system: string): string[] {
  return ["-p", "--no-session-persistence", "--tools", "", "--setting-sources", "", "--strict-mcp-config", "--model", model, "--system-prompt", system, "--output-format", "json"];
}

/** The name from the call's output, the one JSON object `--output-format json` writes; null for a failure or nothing usable. */
export function nameFrom(stdout: string): string | null {
  let e: Record<string, unknown>;
  try {
    e = JSON.parse(stdout.trim());
  } catch {
    return null;
  }
  if (!e || e.type !== "result" || e.is_error === true || e.subtype !== "success" || typeof e.result !== "string") return null;
  return cleanTitle(e.result);
}

export interface Namer {
  /** The name for a session whose first instruction is `instruction`, or null when none came. */
  name(instruction: string): Promise<string | null>;
  /** Ends every call still running, as the worker exits. */
  close(): void;
}

export interface NamerOptions {
  /** The `claude` binary, or null when none can be found. */
  binary: () => Promise<string | null>;
  settings: () => Promise<NamingSettings>;
  /** The system prompt, prompts/naming.md. */
  system: () => Promise<string>;
  log: (text: string) => void;
  spawn?: Spawn;
  env?: Record<string, string | undefined>;
  cwd?: string;
  platform?: NodeJS.Platform;
}

export function createNamer(o: NamerOptions): Namer {
  const spawn = o.spawn ?? hiddenSpawn;
  const env = o.env ?? process.env;
  const platform = o.platform ?? process.platform;
  const running = new Set<ChildProcessWithoutNullStreams>();
  return {
    async name(instruction) {
      const bin = await o.binary();
      if (!bin) return null;
      const st = await o.settings();
      const system = (await o.system()).trim();
      let child: ChildProcessWithoutNullStreams;
      try {
        child = spawn([...claudeCommand(bin), ...namingArgs(st.namingModel, system)], { cwd: o.cwd ?? os.tmpdir(), env: forkEnv(env) });
      } catch (err) {
        o.log(`couldn't start claude to name a session: ${(err as Error).message}`);
        return null;
      }
      running.add(child);
      return new Promise<string | null>((resolve) => {
        let stdout = "";
        let stderr = "";
        let over = false;
        const finish = (name: string | null, why?: string) => {
          if (over) return;
          over = true;
          clearTimeout(timer);
          running.delete(child);
          if (why) o.log(`no name was written for a session: ${why}`);
          resolve(name);
        };
        const timer = setTimeout(() => {
          killTree(child, platform);
          finish(null, `it took longer than ${st.namingTimeoutSeconds} s`);
        }, st.namingTimeoutSeconds * 1000);
        timer.unref?.();
        child.stdout.setEncoding("utf8").on("data", (piece: string) => (stdout += piece));
        child.stderr.setEncoding("utf8").on("data", (piece: string) => (stderr = (stderr + piece).slice(-STDERR_CHARS)));
        child.stdin.on("error", () => {});
        child.on("error", (err) => finish(null, `claude failed: ${err.message}`));
        child.on("close", (code) => {
          const name = nameFrom(stdout);
          finish(name, name ? undefined : `claude exited${code === null ? "" : ` with code ${code}`} with no name${stderr.trim() ? `: ${stderr.trim().split("\n").slice(-2).join(" ")}` : ""}`);
        });
        child.stdin.end(`Instruction:\n${instruction.slice(0, INSTRUCTION_CHARS)}`);
      });
    },
    close() {
      for (const child of running) killTree(child, platform);
      running.clear();
    },
  };
}
