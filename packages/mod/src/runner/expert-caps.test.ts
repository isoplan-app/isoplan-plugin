import { expect, test } from "vitest";
import type { CapSettings, Entry } from "./caps.js";
import { expertOverCap } from "./expert-caps.js";

const HOUR = 3600000;
const NOW = Date.parse("2026-11-17T12:00:00Z");
const WEIGHTS: CapSettings = { answersPerRoomPerHour: 10, answersPerMachinePerDay: 40, tokenBudgetPerMachinePerDay: 5e6, inputTokenWeight: 1, cacheWriteTokenWeight: 2, cacheReadTokenWeight: 0.1, outputTokenWeight: 5, estimatedOutputTokens: 2000 };
const CAPS = { perAskerPerDay: 3, openPerAsker: 2, tokenBudgetPerDay: 10000 };
const tokens = (input: number) => ({ input, output: 0, cacheRead: 0, cacheWrite: 0 });
const entry = (hoursAgo: number, room: string, input = 100): Entry => ({ at: NOW - hoursAgo * HOUR, room, usage: tokens(input) });
const over = (entries: Entry[], open = 0, expected = tokens(100)) => expertOverCap(entries, "s1", open, expected, NOW, CAPS, WEIGHTS);

test("caps: open questions per asking session, with no time it frees", () => {
  expect(over([], 1)).toBe(null);
  expect(over([], 2)).toEqual({ cap: "asker-open", limit: 2 });
});

test("caps: questions per asking session in the last day, freeing a day after its oldest; other sessions' and older ones don't count", () => {
  const others = [entry(1, "s2"), entry(1, "expert"), entry(25, "s1")];
  expect(over([...others, entry(20, "s1"), entry(2, "s1")])).toBe(null);
  expect(over([...others, entry(20, "s1"), entry(5, "s1"), entry(2, "s1")])).toEqual({ cap: "asker-day", limit: 3, frees: NOW + 4 * HOUR });
});

test("caps: the expert's daily budget, its own work counted, weighted, freeing a day after the oldest entry", () => {
  expect(over([entry(10, "expert", 9800)], 0, tokens(200))).toBe(null);
  expect(over([entry(10, "expert", 9800)], 0, tokens(201))).toEqual({ cap: "expert-tokens", limit: 10000, frees: NOW + 14 * HOUR });
  // Output weighs five times: 2,001 of it is over a budget of 10,000 alone.
  expect(over([], 0, { ...tokens(0), output: 2001 })).toEqual({ cap: "expert-tokens", limit: 10000 });
});
