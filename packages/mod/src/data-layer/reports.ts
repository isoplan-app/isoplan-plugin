// The secret scan for reports (#59): an agent's final report is checked on the owner's machine,
// with the runner's scan (src/runner/scan.ts), before the session's facts go to the office server.
// A report that matches goes out as a placeholder, `withheld`, until its owner releases it: the
// server sends `release` on the session's link with the placeholder's hold id, a random id for that
// one agent and text, so a release lets out only the report it names, and a newer report of the
// same agent, or the same text from another agent, stays held. A hold id lasts while its report is
// held and the data layer runs; after a restart the placeholder carries a new one. While the
// patterns can't be read, every report not already released is held. A report already sent isn't
// recalled by a pattern added later.
//
// A release is kept as the sha256 of the agent and the released text in <claude dir>/isoplan/
// released/<session>.json, so the report stays released when the data layer starts again. The
// hashes never leave the machine. Each office server keeps its own (#105): a release on one
// office's floor lets the report out to that office alone, so another office's are in
// <claude dir>/isoplan/offices/<id>/released/<session>.json (releasedPath).

import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { MAX_REPORT_LENGTH, type Facts, type ReportFact } from "@isoplan/protocol";
import { officeDir } from "./approved-file.js";
import { scan, type Pattern } from "../runner/scan.js";

/** Where the reports released on one office's floor are kept for `session`; the server a version before #105 reports to keeps the old place. */
export const releasedPath = (claudeDir: string, office: { server: string; legacy?: boolean }, session: string) =>
  path.join(office.legacy ? path.join(claudeDir, "isoplan") : officeDir(claudeDir, office.server), "released", `${session}.json`);

/**
 * `report` within MAX_REPORT_LENGTH (#71). The facts are cut as they are built, so the secret
 * check and the hold read only what is sent. A longer report keeps its start, up to the last
 * whitespace that fits, ends in "…" and is marked `cut`. It is cut at whitespace so that no token,
 * address or assigned value is split: the first part of a split secret matches no pattern, so the
 * check would let it out. A text with no whitespace within the limit is cut at the limit.
 */
export function cutReport(report: ReportFact): ReportFact {
  const { text } = report;
  if (text.length <= MAX_REPORT_LENGTH) return report;
  const room = MAX_REPORT_LENGTH - 1; // one character for the "…"
  let end = room; // text[end] is the first character left out
  while (end >= 0 && !/\s/.test(text[end]!)) end--;
  if (end < 0) end = /[\ud800-\udbff]/.test(text[room - 1]!) ? room - 1 : room;
  return { ...report, text: text.slice(0, end).trimEnd() + "…", cut: true };
}

/** What a withheld report says in place of its text. */
export const WITHHELD_TEXT = "Held for its owner to check: the secret check found what may be a secret in this report.";

export interface ReportHold {
  /** `facts` with each report the owner has yet to release, and that the scan matches, held. `patterns` is null when they couldn't be read. */
  apply(facts: Facts, patterns: Pattern[] | null): Facts;
  /** Releases the report held under hold id `id` at the last `apply`; false when none was. */
  release(id: string): Promise<boolean>;
}

// One report: its agent and its text.
const hash = (agent: string, text: string) => createHash("sha256").update(`${agent}
${text}`).digest("hex");

export async function openReportHold(file: string, log: (text: string) => void): Promise<ReportHold> {
  const released = new Set(await readReleased(file));
  let held = new Map<string, { agent: string; hash: string }>(); // hold id → the report held under it
  let ids = new Map<string, string>(); // the hash of a held report → its hold id, kept while it is held
  const told = new Set<string>(); // the hashes of held reports already logged

  return {
    apply(facts, patterns) {
      held = new Map();
      const kept = new Map<string, string>();
      const reports = facts.reports.map((report) => {
        const h = hash(report.agent, report.text);
        if (released.has(h)) return report;
        const matched = patterns ? scan(report.text, patterns) : null;
        if (patterns && !matched) return report;
        const id = ids.get(h) ?? kept.get(h) ?? randomUUID();
        kept.set(h, id);
        held.set(id, { agent: report.agent, hash: h });
        if (!told.has(h)) {
          told.add(h);
          log(`withheld the report of ${report.agent}: ${matched ? `it matches the secret pattern "${matched}"` : "the secret patterns couldn't be read"}; its owner can release it from the floor`);
        }
        return { agent: report.agent, at: report.at, text: WITHHELD_TEXT, withheld: { id } };
      });
      ids = kept;
      return held.size ? { ...facts, reports } : facts;
    },
    async release(id) {
      const report = held.get(id);
      if (!report) {
        log(`the office server released the report held as ${id}, but none is held under that id here; it may have been replaced by a newer report, or the data layer restarted`);
        return false;
      }
      const { agent } = report;
      held.delete(id);
      released.add(report.hash);
      log(`the report of ${agent} was released, so it is sent`);
      await fs
        .mkdir(path.dirname(file), { recursive: true })
        .then(() => fs.writeFile(file, JSON.stringify({ released: [...released] }) + "\n"))
        .catch((err: unknown) => log(`couldn't save the release of ${agent}'s report, so it is withheld again after a restart: ${(err as Error).message}`));
      return true;
    },
  };
}

async function readReleased(file: string): Promise<string[]> {
  try {
    const list = (JSON.parse(await fs.readFile(file, "utf8")) as { released?: unknown }).released;
    return Array.isArray(list) ? list.filter((h): h is string => typeof h === "string") : [];
  } catch {
    return [];
  }
}
