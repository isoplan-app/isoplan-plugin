import { expect, test } from "vitest";
import { createErrorReportPace } from "./error-report-pace.ts";

test("one error is reported once a minute", () => {
  let now = 0;
  const pace = createErrorReportPace(() => now);
  expect(pace("a")).toBe(true);
  now = 59999;
  expect(pace("a")).toBe(false);
  expect(pace("b")).toBe(true);
  now = 60000;
  expect(pace("a")).toBe(true);
});

test("at most ten are reported in a minute", () => {
  let now = 0;
  const pace = createErrorReportPace(() => now);
  const allowed = Array.from({ length: 12 }, (_, i) => pace(`e${i}`));
  expect(allowed.filter(Boolean)).toHaveLength(10);
  expect(allowed.slice(10)).toEqual([false, false]);
  now = 60000;
  // One held back by the limit wasn't counted as reported, so it goes now.
  expect(pace("e11")).toBe(true);
});
