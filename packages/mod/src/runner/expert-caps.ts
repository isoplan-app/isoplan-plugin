// An expert's caps on its host, from its expert file, so a looping agent can't spend its owner's
// subscription: open questions per asking session, questions per asking session in the last day,
// and the expert's own token budget for the last day. They are counted in the expert's own ledger
// (caps.ts's openLedger, in <name>/ledger.json): an entry per question, its room the asking
// session's id, and one per grounding, proof or append under "expert", which counts toward the
// budget only. Tokens are weighted as runner.json says. The machine's own caps (runner.json's
// per-room, per-machine and budget) don't count expert work, and these don't count theirs.

import type { ExpertCap } from "@isoplan/protocol";
import type { Usage } from "./answerer.js";
import { weighted, type CapSettings, type Entry } from "./caps.js";
import type { ExpertCaps } from "./expert-file.js";

const DAY_MS = 24 * 3600000;

/** The room an expert's own work (grounding, proof, appends) is counted under. */
export const EXPERT_ROOM = "expert";

/** The cap one more question from `asker`, with `open` of its questions in flight already and expected to use `expected`, would go over, with its limit and when it frees; or null. */
export function expertOverCap(entries: Entry[], asker: string, open: number, expected: Usage, now: number, caps: ExpertCaps, weights: CapSettings): { cap: ExpertCap; limit: number; frees?: number } | null {
  if (open >= caps.openPerAsker) return { cap: "asker-open", limit: caps.openPerAsker };
  const day = entries.filter((e) => now - e.at < DAY_MS);
  const oldest = (list: Entry[]) => Math.min(...list.map((e) => e.at)) + DAY_MS;
  const asked = day.filter((e) => e.room === asker);
  if (asked.length >= caps.perAskerPerDay) return { cap: "asker-day", limit: caps.perAskerPerDay, frees: oldest(asked) };
  const spent = day.reduce((sum, e) => sum + weighted(e.usage, weights), 0);
  if (spent + weighted(expected, weights) > caps.tokenBudgetPerDay) return { cap: "expert-tokens", limit: caps.tokenBudgetPerDay, ...(day.length && { frees: oldest(day) }) };
  return null;
}
