import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, expect, test, vi } from "vitest";
import { loadPatterns } from "../../../mod/src/runner/scan.js";
import { reportOffices } from "./error-report-offices.ts";
import { whoOf } from "./error-report-scrub.ts";
import { createErrorReports, osOf, type ErrorReportsOptions, type ReportFetch, type ReportOffice } from "./error-reports.ts";

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
  // Both offices sign people in, so a call without a token is answered 401.
  const fetch: ReportFetch = async (url, init) => {
    sent.push({ url, init });
    if (!(init.headers as Record<string, string>).authorization) return { status: 401 };
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
  const { reports, sent, logs } = reporter();
  await reports.report({ message: "Error: key AKIAIOSFODNN7EXAMPLE for adamr@example.com", stack: "Error: key\n    at run (C:\\Users\\adamr\\w\\take.ts:120:5)" });
  expect(sent.map(({ url }) => url).sort()).toEqual(["https://a.example.com/data-layer/errors", "https://b.example.com/data-layer/errors"]);
  const { init } = sent.find(({ url }) => url.startsWith("https://a."))!;
  const toB = sent.find(({ url }) => url.startsWith("https://b."))!;
  expect(init).toMatchObject({ method: "POST", redirect: "error", headers: { "content-type": "application/json", authorization: "Bearer token-a" } });
  expect(JSON.parse(String(init.body))).toEqual({ message: "Error: key [secret cut] for <email>", stack: "at run (take.ts:120:5)", release: "0.1.0", os: "windows" });
  // B isn't paired, so it is sent no token, answers 401, and the report is dropped without a word.
  expect(toB.init.headers).toEqual({ "content-type": "application/json" });
  expect(logs).toEqual([]);
});

test("an office with sign-in off, which takes reports from its own machine, gets them with no token", async () => {
  const sent: { url: string; init: RequestInit }[] = [];
  const { reports, logs } = reporter({
    offices: async () => [{ server: "ws://localhost:8080/data-layer", token: async () => undefined }],
    fetch: async (url, init) => (sent.push({ url, init }), { status: 204 }),
  });
  await reports.report({ message: "Error: one" });
  expect(sent).toHaveLength(1);
  expect(sent[0]!.url).toBe("http://localhost:8080/data-layer/errors");
  expect(sent[0]!.init.headers).toEqual({ "content-type": "application/json" });
  expect(logs).toEqual([]);
});

test("the same error again within the minute isn't sent", async () => {
  const { reports, sent } = reporter();
  await reports.report({ message: "Error: once" });
  await reports.report({ message: "Error: once" });
  // Once to each office.
  expect(sent).toHaveLength(2);
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
  expect(sent).toHaveLength(4);
  expect(logs).toEqual([`${A} doesn't take the app's error reports yet (it answered 404), so they are dropped until it is updated`]);
  answer(new Error("fetch failed"));
  await expect(reports.report({ message: "Error: three" })).resolves.toBeUndefined();
  expect(sent).toHaveLength(6);
  expect(logs.at(-1)).toBe(`couldn't send the app's error report to ${A}, so it is dropped: fetch failed`);
});

test("an office whose pairing has ended gets nothing, and the log says so once", async () => {
  const { reports, sent, logs } = reporter({ offices: async () => [{ server: A, token: async () => null }] });
  await reports.report({ message: "Error: one" });
  await reports.report({ message: "Error: two" });
  expect(sent).toHaveLength(0);
  expect(logs).toEqual([`the app's error reports aren't sent to ${A}: it says this computer's pairing with it has ended`]);
});

test("errors close together read an office's token once", async () => {
  let release!: (token: string) => void;
  const pending = new Promise<string>((r) => (release = r));
  let reads = 0;
  let asked = 0;
  const office: ReportOffice = { server: A, token: () => (reads++, pending) };
  const { reports, sent } = reporter({ offices: async () => (asked++, [office]) });
  const both = Promise.all([reports.report({ message: "Error: one" }), reports.report({ message: "Error: two" })]);
  // Both have asked for the offices, so both are waiting on the token.
  await vi.waitFor(() => expect(asked).toBe(2));
  await new Promise((r) => setTimeout(r, 0));
  release("token-a");
  await both;
  expect(reads).toBe(1);
  expect(sent).toHaveLength(2);
});

test("the computer's system is named as the office keeps it", () => {
  expect(["win32", "darwin", "linux"].map(osOf)).toEqual(["windows", "mac", "linux"]);
});
