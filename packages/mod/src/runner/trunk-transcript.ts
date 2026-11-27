// A trunk's transcript: an ordinary Claude Code session's, under whichever project folder Claude
// Code named for the folder it runs in. Moved out of expert.ts unchanged, so an employee's trunk
// (employee.ts, isoplan-app#341) reads its own the same way: where it is, the uuid of its last user
// or assistant entry, and whether every user turn after one is the runner's own.

import fs from "node:fs/promises";
import path from "node:path";

export interface TrunkTranscripts {
  /** A trunk's transcript, under whichever project folder Claude Code named; null when it is gone. */
  transcriptOf(trunk: string): Promise<string | null>;
  /** The uuid of a trunk transcript's last user or assistant entry: Claude Code writes other kinds of line too. */
  lastTurn(trunk: string): Promise<string | null>;
  /** Whether every user turn after `after` (from the start when null) is one of `ours`. Tool results and Claude Code's own entries (isMeta, a subagent's) are user entries too. */
  onlyOurs(trunk: string, after: string | null, ours: string[]): Promise<boolean>;
  /** Forgets where a trunk's transcript was found. */
  forget(trunk: string): void;
}

export function createTrunkTranscripts(projectsDir: string): TrunkTranscripts {
  const transcripts = new Map<string, string>(); // trunk → its transcript's path, once found

  async function transcriptOf(trunk: string): Promise<string | null> {
    const there = (file: string) => fs.stat(file).then(() => true, () => false);
    const known = transcripts.get(trunk);
    if (known && (await there(known))) return known;
    const dirs = await fs.readdir(projectsDir, { withFileTypes: true }).catch(() => []);
    for (const d of dirs) {
      const file = path.join(projectsDir, d.name, `${trunk}.jsonl`);
      if (d.isDirectory() && (await there(file))) return (transcripts.set(trunk, file), file);
    }
    return null;
  }

  async function lastTurn(trunk: string): Promise<string | null> {
    const file = await transcriptOf(trunk);
    const lines = (file ? await fs.readFile(file, "utf8").catch(() => "") : "").split("\n");
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const e = JSON.parse(lines[i]!) as { type?: unknown; uuid?: unknown };
        if ((e.type === "user" || e.type === "assistant") && typeof e.uuid === "string") return e.uuid;
      } catch {
        // a blank line, or one still being written
      }
    }
    return null;
  }

  async function onlyOurs(trunk: string, after: string | null, ours: string[]): Promise<boolean> {
    const file = await transcriptOf(trunk);
    const entries = (file ? await fs.readFile(file, "utf8").catch(() => "") : "").split("\n").flatMap((l) => {
      try {
        return [JSON.parse(l) as { type?: unknown; uuid?: unknown; isMeta?: unknown; isSidechain?: unknown; message?: { content?: unknown } }];
      } catch {
        return []; // a blank line, or one still being written
      }
    });
    const from = after === null ? 0 : entries.findIndex((e) => e.uuid === after) + 1;
    if (from === 0 && after !== null) return false;
    const wanted = new Set(ours.map((t) => t.trim()));
    return entries.slice(from).every((e) => {
      if (e.type !== "user" || e.isMeta === true || e.isSidechain === true) return true;
      const content = e.message?.content;
      const blocks = typeof content === "string" ? [{ type: "text", text: content }] : Array.isArray(content) ? (content as { type?: unknown; text?: unknown }[]) : [];
      if (blocks.some((b) => b?.type === "tool_result")) return true;
      return wanted.has(blocks.map((b) => (b?.type === "text" && typeof b.text === "string" ? b.text : "")).join("").trim());
    });
  }

  return { transcriptOf, lastTurn, onlyOurs, forget: (trunk) => void transcripts.delete(trunk) };
}
