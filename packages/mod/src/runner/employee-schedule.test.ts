import { expect, test } from "vitest";
import { missedRunWindowMs, scheduledAfter, scheduledAtOrBefore } from "./employee-schedule.js";

const H = 3600000;
const at = (iso: string) => Date.parse(iso);

test("scheduled times for each kind of schedule in a zone, across a daylight-saving change, and the default window is half the gap after the time", () => {
  const daily = { every: "day" as const, at: "09:00", timeZone: "Europe/London" };
  // Summer time: 09:00 in London is 08:00 UTC; after the clocks go back on 25 Oct 2026, 09:00 UTC.
  expect(new Date(scheduledAtOrBefore(daily, at("2026-10-24T12:00:00Z"))).toISOString()).toBe("2026-10-24T08:00:00.000Z");
  expect(new Date(scheduledAfter(daily, at("2026-10-24T12:00:00Z"))).toISOString()).toBe("2026-10-25T09:00:00.000Z");
  // 01:30 doesn't exist on 29 Mar 2026 in London (01:00 goes to 02:00): it runs at the first minute after the gap, 02:00 local.
  expect(new Date(scheduledAfter({ every: "day", at: "01:30", timeZone: "Europe/London" }, at("2026-03-28T12:00:00Z"))).toISOString()).toBe("2026-03-29T01:00:00.000Z");
  // 01:30 happens twice on 25 Oct 2026: the first.
  expect(new Date(scheduledAfter({ every: "day", at: "01:30", timeZone: "Europe/London" }, at("2026-10-24T12:00:00Z"))).toISOString()).toBe("2026-10-25T00:30:00.000Z");

  const weekdays = { every: "weekday" as const, at: "09:00", timeZone: "UTC" };
  // Friday 27 Nov 2026 09:00, then Monday 30 Nov.
  const friday = at("2026-11-27T09:00:00Z");
  expect(scheduledAtOrBefore(weekdays, at("2026-11-29T10:00:00Z"))).toBe(friday);
  expect(scheduledAfter(weekdays, friday)).toBe(at("2026-11-30T09:00:00Z"));
  expect(missedRunWindowMs({ schedule: weekdays }, friday)).toBe(36 * H);
  expect(missedRunWindowMs({ schedule: daily }, at("2026-11-26T09:00:00Z"))).toBe(12 * H);

  const weekly = { every: "week" as const, on: "tuesday" as const, at: "15:30", timeZone: "UTC" };
  expect(scheduledAtOrBefore(weekly, at("2026-11-26T10:00:00Z"))).toBe(at("2026-11-24T15:30:00Z"));
  expect(missedRunWindowMs({ schedule: weekly }, at("2026-11-24T15:30:00Z"))).toBe(3.5 * 24 * H);
  expect(missedRunWindowMs({ schedule: weekly, missedRunWindowMinutes: 90 }, at("2026-11-24T15:30:00Z"))).toBe(1.5 * H);
});
