// An expert's context meter and the rules its promotion threshold has to meet.
//
// A headless trunk draws no status line, so it can't say its own context window: the runner keeps
// a copy of the office server's model→window table (packages/server/src/context-windows.ts in the
// app repo), and an expert file's `window` overrides it. The meter is the context of the trunk's
// last top-level call (`TurnResult.context`), never a result's usage, which sums every call of a
// turn. A threshold has to stay 100,000 tokens below the compaction point, so the largest fork still
// fits, and leave room above a new junior's grounding for at least 20 learned notes, so promotion
// can't loop.

import type { TurnResult } from "./expert-claude.js";

export interface ContextWindow {
  window: number;
  /** Where Claude Code compacts the conversation, or null to count the whole window. */
  compactAt: number | null;
}

const native1m = { window: 1_000_000, compactAt: 967_000 };
const window200k = { window: 200_000, compactAt: null };

/** The office server's table as of 6 Nov 2026: a model id matches the longest key it starts with, at a "-" or "[" or its end. */
export const EXPERT_WINDOWS: Record<string, ContextWindow> = {
  "claude-fable-5-1": native1m,
  "claude-opus-5-5": native1m,
  "claude-sonnet-5-5": native1m,
  "claude-haiku-5-5": native1m,
  "claude-fable-5": native1m,
  "claude-opus-5": native1m,
  "claude-sonnet-5": native1m,
  "claude-opus-4-8": native1m,
  "claude-opus-4-7": native1m,
  "claude-opus-4-6": window200k,
  "claude-opus-4-6[1m]": native1m,
  "claude-sonnet-4-6": window200k,
  "claude-sonnet-4-6[1m]": native1m,
  "claude-opus-4-5": window200k,
  "claude-opus-4-5-20251101": window200k,
  "claude-sonnet-4-5": window200k,
  "claude-sonnet-4-5-20250929": window200k,
  "claude-haiku-4-5": window200k,
  "claude-haiku-4-5-20251001": window200k,
};

/** How far below the compaction point a threshold has to stay. */
export const THRESHOLD_MARGIN = 100_000;
/** How many learned notes a new junior needs room for, at about this many tokens each. */
export const NOTES_ROOM = 20;
export const NOTE_TOKENS = 500;

/**
 * The window of the model the trunk resolved to: the expert file's `window` when it sets one (with
 * the table's compaction point only when the table gives that same window), else the table's entry.
 * With neither, why the generation can't run.
 */
export function windowFor(modelId: string, override?: number): ({ ok: true } & ContextWindow) | { ok: false; why: string } {
  const key = Object.keys(EXPERT_WINDOWS)
    .filter((k) => modelId.startsWith(k) && (modelId.length === k.length || "-[".includes(modelId.charAt(k.length))))
    .sort((x, y) => y.length - x.length)[0];
  const listed = key === undefined ? null : EXPERT_WINDOWS[key]!;
  if (override !== undefined) return { ok: true, window: override, compactAt: listed?.window === override ? listed.compactAt : null };
  if (listed) return { ok: true, ...listed };
  return { ok: false, why: `no context window is known for ${modelId}; set "window" in the expert file` };
}

/** A trunk's meter after a turn: that turn's context. */
export const meterOf = (turn: TurnResult) => turn.context;

/** Why `promoteAt` is too close to the compaction point (the table's `compactAt`, else the window), or null. */
export function thresholdProblem(promoteAt: number, compactAt: number): string | null {
  if (promoteAt <= compactAt - THRESHOLD_MARGIN) return null;
  return `promoteAtTokens ${promoteAt} is within ${THRESHOLD_MARGIN.toLocaleString("en")} tokens of the compaction point at ${compactAt}; set it lower in the expert file`;
}

/** Why a junior grounded at `grounded` tokens leaves too little room below `promoteAt` for learned notes, or null. */
export function notesRoomProblem(promoteAt: number, grounded: number): string | null {
  if (promoteAt - grounded >= NOTES_ROOM * NOTE_TOKENS) return null;
  return `room for fewer than ${NOTES_ROOM} learned notes: grounded at ${grounded} tokens, promoteAtTokens ${promoteAt}; raise promoteAtTokens in the expert file`;
}
