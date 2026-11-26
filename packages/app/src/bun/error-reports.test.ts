import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, expect, test } from "vitest";
import { loadPatterns } from "../../../mod/src/runner/scan.js";
import { reportOffices } from "./error-report-offices.ts";
import { whoOf } from "./error-report-scrub.ts";
import { createErrorReports, type ErrorReportsOptions, type ReportFetch } from "./error-reports.ts";

const modDir = path.resolve(import.meta.dirname, "..", "..", "..", "mod");
const A = "wss://a.example.com/data-layer";
const B = "wss://b.example.com/data-layer";

const roots: string[] = [];
afterAll(() => roots.forEach((r) => fs.rmSync(r, { recursive: true, force: true, maxRetries: 5 })));

/** A computer whose config.json names offices A and B, paired with A only. */
function computer() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "isoplan-app-errors-"));
  roots.push(root);
  const claudeDir = path.join(root, ".claude");
  fs.mkdirSync(path.join(claudeDir, "isoplan"), { recursive: true });
  fs.writeFileSync(path.join(claudeDir, "isoplan", "config.json"), JSON.stringify({ servers: [{ label: "A", server: A }, { label: "B", server: B }] }));
  const entry = { server: A, credential: "cred-a", token: "token-a", tokenExpires: Date.now() + 3600000 };
  fs.writeFileSync(path.join(claudeDir, "isoplan", "pairing.json"), JSON.stringify({ machine: "m1", accounts: {}, offices: { [A]: { "claude:u1": entry } } }));
  return { claudeDir, claudeJson: path.join(root, ".claude.json") };
}

function reporter(options: Partial<ErrorReportsOptions> = {}) {
  const { claudeDir, claudeJson } = computer();
  const sent: { url: string; init: RequestInit }[] = [];
  const logs: string[] = [];
  let status: number | Error = 204;
  const fetch: ReportFetch = async (url, init) => {
    sent.push({ url, init });
    if (status instanceof Error) throw status;
    return { status };
  };
  const log = (text: string) => logs.push(text);
  const reports = createErrorReports({
    release: "0.1.0",
    os: "windows",
    who: whoOf("C:\\Users\\adamr"),
    patterns: () => loadPatterns(path.join(modDir, "secret-patterns.json"), path.join(claudeDir, "isoplan", "secret-patterns.json"), log),
    // The plugin's own config.json is the runner copy's defaults.
    offices: () => reportOffices({ claudeDir, claudeJson, appDir: modDir, log }),
    log,
    fetch,
    ...options,
  });
  return { reports, sent, logs, answer: (s: number | Error) => (status = s) };
}

test("an error goes to each paired office with its token, scrubbed and with secrets cut", async () => {
  const { reports, sent } = reporter();
  await reports.report({ message: "Error: key AKIAIOSFODNN7EXAMPLE for adamr@example.com", stack: "Error: key\n    at run (C:\\Users\\adamr\\w\\take.ts:120:5)" });
  // B isn't paired, so it gets nothing.
  expect(sent).toHaveLength(1);
  const [{ url, init }] = sent as [{ url: string; init: RequestInit }];
  expect(url).toBe("https://a.example.com/data-layer/errors");
  expect(init).toMatchObject({ method: "POST", redirect: "error", headers: { "content-type": "application/json", authorization: "Bearer token-a" } });
  expect(JSON.parse(String(init.body))).toEqual({ message: "Error: key [secret cut] for <email>", stack: "at run (take.ts:120:5)", release: "0.1.0", os: "windows" });
});

test("the same error again within the minute isn't sent", async () => {
  const { reports, sent } = reporter();
  await reports.report({ message: "Error: once" });
  await reports.report({ message: "Error: once" });
  expect(sent).toHaveLength(1);
});

test("nothing is sent while the secret patterns can't be read, and the log says so once", async () => {
  const { reports, sent, logs } = reporter({ patterns: async () => null });
  await reports.report({ message: "Error: one" });
  await reports.report({ message: "Error: two" });
  expect(sent).toHaveLength(0);
  expect(logs).toEqual(["the secret patterns can't be read, so the app's errors aren't reported to its offices"]);
});

test("a report an office doesn't take is dropped and logged once, never sent again, and never throws", async () => {
  const { reports, sent, logs, answer } = reporter();
  answer(404);
  await reports.report({ message: "Error: one" });
  await reports.report({ message: "Error: two" });
  expect(sent).toHaveLength(2);
  expect(logs).toEqual([`${A} doesn't take the app's error reports yet (it answered 404), so they are dropped until it is updated`]);
  answer(new Error("fetch failed"));
  await expect(reports.report({ message: "Error: three" })).resolves.toBeUndefined();
  expect(sent).toHaveLength(3);
  expect(logs.at(-1)).toBe(`couldn't send the app's error report to ${A}, so it is dropped: fetch failed`);
});
