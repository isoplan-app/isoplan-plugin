// How often the app reports its errors to the offices (error-reports.ts, isoplan-app#375): one error
// (its fingerprint: its message and its stack's first frame) at most once a minute, and at most ten
// in a minute in all, as the floor's reports go. An error that comes back within the minute isn't reported again, so one
// thrown in a loop can't flood an office; the office counts the times it is reported.

export const SAME_ERROR_MS = 60000;
export const REPORTS_PER_MINUTE = 10;
const MINUTE_MS = 60000;

/** Whether an error with this fingerprint may be reported now; one that may is counted as reported. */
export type ErrorReportPace = (fingerprint: string) => boolean;

export function createErrorReportPace(now: () => number = Date.now): ErrorReportPace {
  const reported = new Map<string, number>(); // fingerprint → when it was last reported
  let times: number[] = [];
  return (fingerprint) => {
    const at = now();
    times = times.filter((t) => at - t < MINUTE_MS);
    for (const [key, t] of reported) if (at - t >= SAME_ERROR_MS) reported.delete(key);
    if (reported.has(fingerprint) || times.length >= REPORTS_PER_MINUTE) return false;
    reported.set(fingerprint, at);
    times.push(at);
    return true;
  };
}
