import { afterEach, expect, test, vi } from "vitest";
import { onUncaughtErrors, type UncaughtHandler } from "./uncaught-errors.ts";

afterEach(() => vi.useRealTimers());

/** The main process with its handlers, and Electrobun's exception handler unless `electrobun` is false. */
function app({ report = async () => {}, electrobun = true }: { report?: () => Promise<void>; electrobun?: boolean } = {}) {
  const handlers: Partial<Record<"uncaughtException" | "unhandledRejection", UncaughtHandler>> = {};
  const reported: unknown[] = [];
  const logs: string[] = [];
  const ran: unknown[][] = [];
  const ended: unknown[] = [];
  onUncaughtErrors({
    on: (event, handler) => void (handlers[event] = handler),
    electrobun: electrobun ? [(err, origin) => ran.push([err, origin])] : [],
    report: (err) => (reported.push(err), report()),
    said: async (err) => (err as Error).message,
    log: (text) => logs.push(text),
    logged: async () => {},
    end: (err) => ended.push(err),
    lastReportMs: 5000,
  });
  return { handlers, reported, logs, ran, ended };
}

test("an exception is reported and logged, and Electrobun's handlers run once its report has gone", async () => {
  const a = app();
  const err = new Error("boom");
  a.handlers.uncaughtException!(err, "uncaughtException");
  await vi.waitFor(() => expect(a.ran).toEqual([[err, "uncaughtException"]]));
  expect(a.reported).toEqual([err]);
  expect(a.logs).toEqual(["the app caught an error nothing else did, so it ends: boom"]);
});

test("an exception whose report doesn't go ends the app after 5 s, as Bun would with no handler of Electrobun's; one more while it ends is only reported", async () => {
  vi.useFakeTimers();
  const a = app({ report: () => new Promise(() => {}), electrobun: false });
  const err = new Error("boom");
  a.handlers.uncaughtException!(err);
  a.handlers.uncaughtException!(new Error("again"));
  await vi.advanceTimersByTimeAsync(4999);
  expect(a.ended).toEqual([]);
  await vi.advanceTimersByTimeAsync(1);
  expect(a.ended).toEqual([err]);
  expect(a.reported).toHaveLength(2);
  expect(a.logs).toHaveLength(1);
});

test("a rejection is reported, logged once for the same text, and the app goes on", async () => {
  const a = app();
  a.handlers.unhandledRejection!(new Error("a promise broke"));
  a.handlers.unhandledRejection!(new Error("a promise broke"));
  await new Promise((r) => setTimeout(r, 0));
  expect(a.reported).toHaveLength(2);
  expect(a.logs).toEqual(["the app caught a rejected promise nothing else did, and goes on: a promise broke"]);
  expect([a.ran, a.ended]).toEqual([[], []]);
});
