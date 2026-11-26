// The desktop app's errors, reported to every office this computer is paired with (isoplan-app#375,
// ADR 0004): POST <office>/data-layer/errors, with this computer's pairing token for that office,
// as the office's list of repos is asked for (packages/mod/src/data-layer/approved.ts). The body is
// { message, stack?, release, os }: what error-report-scrub.ts leaves of the error, with every match
// of the plugin's secret scan cut out (packages/mod/src/runner/scan.ts, E8), the app's version and
// the computer's system. While the secret patterns can't be read nothing is sent.
//
// An error is reported at most once a minute, and at most ten in a minute in all
// (error-report-pace.ts). A report an office doesn't take (an office older than these reports
// answers 404) or can't be reached for is dropped, never sent again, and app.log says so once for
// that office until one reaches it. Nothing here throws.

import { httpUrl } from "../../../mod/src/data-layer/pairing.js";
import { cut, type Pattern } from "../../../mod/src/runner/scan.js";
import type { RawError } from "../shared/error-of.ts";
import { createErrorReportPace } from "./error-report-pace.ts";
import { framesOf, MESSAGE_MAX, scrubError, STACK_MAX, type Who } from "./error-report-scrub.ts";

export type ReportOs = "windows" | "mac" | "linux";
export const osOf = (platform: string): ReportOs => (platform === "win32" ? "windows" : platform === "darwin" ? "mac" : "linux");

/** The most of `release` an office keeps. */
const RELEASE_MAX = 40;

/** One office the reports may go to, and this computer's pairing token for it: undefined while it isn't paired, null once its pairing has ended. */
export interface ReportOffice {
  /** Its data-layer address, ws:// or wss://. */
  server: string;
  token(): Promise<string | null | undefined>;
}

/** What a report needs of `fetch`. */
export type ReportFetch = (url: string, init: RequestInit) => Promise<{ status: number }>;

export interface ErrorReportsOptions {
  /** The app's version. */
  release: string;
  os: ReportOs;
  who: Who;
  /** The secret scan's patterns, null while they can't be read (loadPatterns). */
  patterns: () => Promise<Pattern[] | null>;
  offices: () => Promise<ReportOffice[]>;
  log: (text: string) => void;
  fetch?: ReportFetch;
  now?: () => number;
}

export interface ErrorReports {
  /** Reports `error` to every paired office, unless it was reported within the minute or ten have been; resolves once sent or dropped, and never rejects. */
  report(error: RawError): Promise<void>;
}

const text = (err: unknown) => String((err as Error)?.message ?? err);

export function createErrorReports({ release, os, who, patterns, offices, log, fetch: send = (url, init) => fetch(url, init), now = Date.now }: ErrorReportsOptions): ErrorReports {
  const pace = createErrorReportPace(now);
  const said = new Map<string, string>(); // the last problem logged: for each office by its address, for the patterns, and for reading the offices
  const tell = (key: string, line: string) => {
    if (said.get(key) !== line) log(line);
    said.set(key, line);
  };

  async function sendTo(office: ReportOffice, body: string): Promise<void> {
    const { server } = office;
    let answer: number | string;
    try {
      const token = await office.token();
      if (token === undefined) return;
      if (token === null) return tell(server, `the app's error reports aren't sent to ${server}: it says this computer's pairing with it has ended`);
      const response = await send(httpUrl(server, "/errors"), {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body,
        // The token never follows a redirect to another address.
        redirect: "error",
        signal: AbortSignal.timeout(15000),
      });
      answer = response.status;
    } catch (err) {
      answer = text(err);
    }
    if (typeof answer === "number" && answer >= 200 && answer < 300) return void said.delete(server);
    tell(
      server,
      answer === 404
        ? `${server} doesn't take the app's error reports yet (it answered 404), so they are dropped until it is updated`
        : `couldn't send the app's error report to ${server}, so it is dropped: ${typeof answer === "number" ? `it answered ${answer}` : answer}`,
    );
  }

  async function reportNow(error: RawError): Promise<void> {
    // Told apart as it was thrown, which never leaves the computer, so one thrown in a loop is dropped before any scrubbing.
    if (!pace(`${error.message.slice(0, MESSAGE_MAX)}\n${error.stack ? (framesOf(error.stack, error.message)[0] ?? "") : ""}`)) return;
    const scrubbed = scrubError(error, who);
    const found = await patterns().catch(() => null);
    if (!found) return tell("patterns", "the secret patterns can't be read, so the app's errors aren't reported to its offices");
    said.delete("patterns");
    const message = cut(scrubbed.message, found)!.slice(0, MESSAGE_MAX);
    const stack = scrubbed.stack && cut(scrubbed.stack, found)!.slice(0, STACK_MAX);
    const body = JSON.stringify({ message, ...(stack && { stack }), release: release.slice(0, RELEASE_MAX), os });
    const to = await offices();
    said.delete("offices");
    await Promise.all(to.map((office) => sendTo(office, body)));
  }

  return {
    report: (error) => reportNow(error).catch((err: unknown) => tell("offices", `couldn't report the app's error to its offices: ${text(err)}`)),
  };
}
