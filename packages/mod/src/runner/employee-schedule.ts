// When a job runs (isoplan-app#341): the scheduled times of its schedule, worked out with Intl in
// its time zone, else this computer's own, across daylight saving: a time that doesn't exist that day
// (the clocks went forward over it) runs at the first minute after it, and one that happens twice
// (the clocks went back) the first time. Pure: no clock, no files.
//
// - `day`: every day at `at`; `weekday`: Monday to Friday; `week`: on `on`.
// - The missed-run window: how late a scheduled time may still run, the job's
//   `missedRunWindowMinutes`, else half the gap from that time to the next scheduled one (every day,
//   12 hours; a Friday's weekday time, 36 hours; weekly, 3.5 days).

import type { Job, JobSchedule } from "@isoplan/protocol";

const MINUTE = 60000;
const DAY = 24 * 60 * MINUTE;
const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] as const;

/** This computer's own time zone. */
export const computerTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

/** The schedule's zone: its own, else this computer's. */
export const zoneOf = (s: JobSchedule) => s.timeZone ?? computerTimeZone();

const formats = new Map<string, Intl.DateTimeFormat>();
function format(zone: string) {
  let f = formats.get(zone);
  if (!f) formats.set(zone, (f = new Intl.DateTimeFormat("en-GB", { timeZone: zone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })));
  return f;
}

/** The wall clock in `zone` at `t`: year, month (1-12), day, hour, minute. */
export function wallClock(t: number, zone: string): { y: number; mo: number; d: number; h: number; mi: number } {
  const parts = Object.fromEntries(format(zone).formatToParts(new Date(t)).map((p) => [p.type, p.value]));
  return { y: Number(parts.year), mo: Number(parts.month), d: Number(parts.day), h: Number(parts.hour) % 24, mi: Number(parts.minute) };
}

type Wall = ReturnType<typeof wallClock>;
const same = (a: Wall, b: Wall) => a.y === b.y && a.mo === b.mo && a.d === b.d && a.h === b.h && a.mi === b.mi;
const asUtc = (w: Wall) => Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi);
/** How far `zone`'s wall clock is ahead of UTC at `t`. */
const offsetAt = (t: number, zone: string) => asUtc(wallClock(t, zone)) - Math.floor(t / MINUTE) * MINUTE;

/** The instant the wall clock in `zone` reads that day at h:mi: the first of two, or the first minute after a time that doesn't exist. */
export function instantOf(y: number, mo: number, d: number, h: number, mi: number, zone: string): number {
  for (let skip = 0; skip <= 180; skip++) {
    const guess = Date.UTC(y, mo - 1, d, h, mi + skip);
    const wanted = wallClock(guess, "UTC");
    // The zone's offsets a day either side are the one before a change and the one after it.
    const found = [guess - DAY, guess, guess + DAY].map((t) => guess - offsetAt(t, zone)).filter((t) => same(wallClock(t, zone), wanted)).sort((a, b) => a - b)[0];
    if (found !== undefined) return found;
  }
  return Date.UTC(y, mo - 1, d, h, mi);
}

const runsOn = (s: JobSchedule, weekday: (typeof WEEKDAYS)[number]) => s.every === "day" || (s.every === "weekday" ? weekday !== "saturday" && weekday !== "sunday" : weekday === s.on);

/** The scheduled time of `s` on the day `offset` days from `t`'s day in its zone, or null when it doesn't run that day. */
function onDay(s: JobSchedule, zone: string, t: number, offset: number): number | null {
  const today = wallClock(t, zone);
  const date = new Date(Date.UTC(today.y, today.mo - 1, today.d + offset));
  if (!runsOn(s, WEEKDAYS[date.getUTCDay()]!)) return null;
  const [h, mi] = s.at.split(":").map(Number) as [number, number];
  return instantOf(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate(), h, mi, zone);
}

/** The latest scheduled time at or before `t`. */
export function scheduledAtOrBefore(s: JobSchedule, t: number, zone = zoneOf(s)): number {
  for (let k = 0; k <= 8; k++) {
    const at = onDay(s, zone, t, -k);
    if (at !== null && at <= t) return at;
  }
  throw new Error("no scheduled time in the week before");
}

/** The first scheduled time after `t`. */
export function scheduledAfter(s: JobSchedule, t: number, zone = zoneOf(s)): number {
  for (let k = 0; k <= 8; k++) {
    const at = onDay(s, zone, t, k);
    if (at !== null && at > t) return at;
  }
  throw new Error("no scheduled time in the week after");
}

/** How long after `scheduledFor` it may still run: the job's own window, else half the gap to the next scheduled time. */
export function missedRunWindowMs(job: Pick<Job, "schedule" | "missedRunWindowMinutes">, scheduledFor: number): number {
  if (job.missedRunWindowMinutes !== undefined) return job.missedRunWindowMinutes * MINUTE;
  return Math.floor((scheduledAfter(job.schedule, scheduledFor) - scheduledFor) / 2);
}

/** What of a schedule says when it runs: a change to it passes over every time before the change. */
export const scheduleKey = (s: JobSchedule) => JSON.stringify([s.every, s.at, s.on ?? null, s.timeZone ?? null]);
