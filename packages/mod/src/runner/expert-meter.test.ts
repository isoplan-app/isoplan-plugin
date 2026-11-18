import { expect, test } from "vitest";
import { meterOf, notesRoomProblem, thresholdProblem, windowFor } from "./expert-meter.js";

test("window: a dated or [1m] id finds its entry by the longest key; the expert file's window overrides it", () => {
  expect(windowFor("claude-sonnet-5-5-20261101")).toEqual({ ok: true, window: 1_000_000, compactAt: 967_000 });
  expect(windowFor("claude-opus-4-6")).toEqual({ ok: true, window: 200_000, compactAt: null });
  expect(windowFor("claude-opus-4-6[1m]")).toEqual({ ok: true, window: 1_000_000, compactAt: 967_000 });
  expect(windowFor("claude-opus-5-5", 400_000)).toEqual({ ok: true, window: 400_000, compactAt: null });
  expect(windowFor("claude-opus-5-5", 1_000_000)).toEqual({ ok: true, window: 1_000_000, compactAt: 967_000 });
  expect(windowFor("gateway-model", 300_000)).toEqual({ ok: true, window: 300_000, compactAt: null });
});

test("window: a model with no table entry and no window fails, naming the fix", () => {
  expect(windowFor("claude-haiku-5-55")).toEqual({ ok: false, why: 'no context window is known for claude-haiku-5-55; set "window" in the expert file' });
});

test("threshold: within 100,000 of the compaction point is refused; fewer than 20 notes of room is refused", () => {
  expect(thresholdProblem(867_000, 967_000)).toBe(null);
  expect(thresholdProblem(867_001, 967_000)).toMatch(/^promoteAtTokens 867001 is within 100,000 tokens of the compaction point at 967000/);
  expect(notesRoomProblem(45_000, 35_000)).toBe(null);
  expect(notesRoomProblem(45_000, 35_001)).toMatch(/^room for fewer than 20 learned notes/);
  expect(meterOf({ text: "grounded", context: 31_000, usage: { input: 1, output: 1, cacheRead: 1, cacheWrite: 1 } })).toBe(31_000);
});
