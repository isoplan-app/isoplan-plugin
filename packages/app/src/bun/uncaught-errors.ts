// What the app's main process does with an error nothing caught (index.ts, isoplan-app#375): it
// reports it to the offices (error-reports.ts) and writes it to app.log, its text checked for
// secrets. Electrobun's own handlers, which electrobun/main registers as it loads (its
// proc/native.ts), stay: a rejected promise nothing caught is written to stderr and the app goes on;
// an exception nothing caught is written to stderr and ends the app, now once its report has gone or
// `lastReportMs` has passed. With no handler of Electrobun's, an exception ends the app as Bun would.
// An exception that comes while the app ends is only reported.

export type UncaughtHandler = (err: unknown, origin?: unknown) => void;

export interface UncaughtErrorsOptions {
  on: (event: "uncaughtException" | "unhandledRejection", handler: UncaughtHandler) => void;
  /** Electrobun's exception handlers, taken off the process before these go on. */
  electrobun: UncaughtHandler[];
  /** Reports the error to the offices; never rejects. */
  report: (err: unknown) => Promise<void>;
  /** The error's text, checked for secrets. */
  said: (err: unknown) => Promise<string>;
  log: (text: string) => void;
  /** Resolves once app.log holds what was logged. */
  logged: () => Promise<void>;
  /** Ends the app as Bun would: the error on stderr, exit code 1. */
  end: (err: unknown) => void;
  lastReportMs: number;
}

export function onUncaughtErrors(o: UncaughtErrorsOptions): void {
  // A rejection that comes again with the same text is logged once.
  let lastRejection = "";
  o.on("unhandledRejection", (reason) => {
    void o.report(reason);
    void o.said(reason).then((text) => {
      if (text !== lastRejection) o.log(`the app caught a rejected promise nothing else did, and goes on: ${text}`);
      lastRejection = text;
    });
  });
  let ending = false;
  o.on("uncaughtException", (err, origin) => {
    const report = o.report(err);
    if (ending) return;
    ending = true;
    void (async () => {
      try {
        o.log(`the app caught an error nothing else did, so it ends: ${await o.said(err)}`);
        await Promise.race([report, new Promise((r) => setTimeout(r, o.lastReportMs))]);
        await o.logged();
      } finally {
        if (!o.electrobun.length) o.end(err);
        for (const handler of o.electrobun) handler(err, origin);
      }
    })();
  });
}
