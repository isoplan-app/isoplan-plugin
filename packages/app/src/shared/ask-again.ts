// When the window of what's running asks the app again, kept apart from the window so it can be tested.

// setTimeout's longest wait; a longer one fires at once.
const LONGEST_MS = 2 ** 31 - 1;

/** How long the window waits before it asks again: the answer's refreshMs, or `fallback` when that isn't a wait above zero. */
export function askAgainMs(refreshMs: unknown, fallback: number): number {
  return typeof refreshMs === "number" && Number.isFinite(refreshMs) && refreshMs > 0 ? Math.min(refreshMs, LONGEST_MS) : fallback;
}
