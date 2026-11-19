import { EventEmitter } from "node:events";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { spawn } from "node:child_process";
import { afterEach, expect, test } from "vitest";
import type { ExpertCreationSuggestionLine } from "../lines.js";
import { openReviewOfNewestExpertCreationSuggestion, opener, openUrl } from "./open.js";

const cleanups: (() => unknown)[] = [];
afterEach(() => {
  for (const c of cleanups.splice(0)) c();
});

const DEV = "ws://127.0.0.1:4747/data-layer";
const TEAM = "wss://office.team.example/data-layer";
const suggestion = (id: string, server: string, key = "parser"): ExpertCreationSuggestionLine => ({
  type: "expert-creation-suggestion",
  server,
  id,
  key,
  name: key[0]!.toUpperCase() + key.slice(1) + " Expert",
  folder: `src/${key}`,
  url: `${server === DEV ? "http://127.0.0.1:4747" : "https://office.team.example"}/?expert-creation-suggestion=${id}`,
  why: { share: 0.2, tokens: 40000, minutes: 3, corrections: 0 },
});

// A Claude config folder whose session s1 has `suggestions` open, as the runner writes them; none when null.
function claudeDir(suggestions: unknown | null): string {
  const dir = mkdtempSync(path.join(tmpdir(), "isoplan-expert-creation-suggestion-"));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  if (suggestions !== null) {
    mkdirSync(path.join(dir, "isoplan", "expert-creation-suggestions"), { recursive: true });
    writeFileSync(path.join(dir, "isoplan", "expert-creation-suggestions", "s1.json"), JSON.stringify(suggestions));
  }
  return dir;
}

test("/isoplan:review-expert-suggestion opens the session's newest open expert creation suggestion, at the first office it is open in, and gives the others' links", async () => {
  const opened: string[] = [];
  const dir = claudeDir({ expertCreationSuggestions: [suggestion("o1", DEV, "billing"), suggestion("o2", DEV), suggestion("o2", TEAM), { id: 3 }] });
  expect(await openReviewOfNewestExpertCreationSuggestion({ claudeDir: dir, session: "s1", open: async (url) => void opened.push(url) })).toBe(
    ["Opened the review of the Parser Expert, suggested for src/parser, in your browser: http://127.0.0.1:4747/?expert-creation-suggestion=o2", "This session has another open expert creation suggestion:", "- the Billing Expert, suggested for src/billing: http://127.0.0.1:4747/?expert-creation-suggestion=o1"].join("\n"),
  );
  expect(opened).toEqual(["http://127.0.0.1:4747/?expert-creation-suggestion=o2"]);
});

test("/isoplan:review-expert-suggestion says plainly when the session has no open expert creation suggestion, or isn't a Claude Code session's", async () => {
  const open = async () => expect.unreachable();
  expect(await openReviewOfNewestExpertCreationSuggestion({ claudeDir: claudeDir(null), session: "s1", open })).toBe("This session has no open expert creation suggestion.");
  expect(await openReviewOfNewestExpertCreationSuggestion({ claudeDir: claudeDir(null), session: undefined, open })).toMatch(/^This runs inside a Claude Code session, which sets CLAUDE_CODE_SESSION_ID; it isn't set here/);
});

test("/isoplan:review-expert-suggestion says the session's expert creation suggestions couldn't be read when their file isn't as the runner writes it, rather than that there are none", async () => {
  const open = async () => expect.unreachable();
  const dir = claudeDir("not expert creation suggestions");
  const file = path.join(dir, "isoplan", "expert-creation-suggestions", "s1.json");
  expect(await openReviewOfNewestExpertCreationSuggestion({ claudeDir: dir, session: "s1", open })).toBe(`This session's open expert creation suggestions couldn't be read from ${file} (it has no list of expert creation suggestions). Use the review link in Isoplan's status line.`);
  writeFileSync(file, "{ not json");
  expect(await openReviewOfNewestExpertCreationSuggestion({ claudeDir: dir, session: "s1", open })).toMatch(/\(it isn't JSON\)/);
});

test("/isoplan:review-expert-suggestion gives the link to click when the browser couldn't be opened", async () => {
  const dir = claudeDir({ expertCreationSuggestions: [suggestion("o1", DEV)] });
  expect(await openReviewOfNewestExpertCreationSuggestion({ claudeDir: dir, session: "s1", open: async () => Promise.reject(new Error("spawn xdg-open ENOENT")) })).toBe(
    "Your browser couldn't be opened (spawn xdg-open ENOENT). Open this link to review the Parser Expert, suggested for src/parser: http://127.0.0.1:4747/?expert-creation-suggestion=o1",
  );
});

test("the browser is opened with start through cmd and an empty title on Windows, open on a Mac and xdg-open elsewhere; a link cmd could misread isn't handed over", () => {
  const url = "https://office.team.example/?expert-creation-suggestion=aB3_-x";
  expect(opener("win32", url, "C:\\Windows\\system32\\cmd.exe")).toEqual({ command: "C:\\Windows\\system32\\cmd.exe", args: ["/d", "/s", "/c", `"start "" "${url}""`] });
  expect(opener("darwin", url)).toEqual({ command: "open", args: [url] });
  expect(opener("linux", url)).toEqual({ command: "xdg-open", args: [url] });
  expect(opener("win32", "http://[::1]:4747/?expert-creation-suggestion=o1")).not.toBeNull();
  for (const bad of ["https://x.example/?expert-creation-suggestion=a&calc", "https://x.example/%PATH%", "file:///C:/x", 'https://x.example/"'] ) expect(opener("win32", bad)).toBeNull();
});

test("opening runs the opener hidden and detached, and says why when it couldn't", async () => {
  const runs: { command: string; args: readonly string[]; options: Record<string, unknown> }[] = [];
  const fake = (then: (child: EventEmitter) => void) =>
    ((command: string, args: readonly string[], options: Record<string, unknown>) => {
      runs.push({ command, args, options });
      const child = Object.assign(new EventEmitter(), { unref: () => {} });
      setTimeout(() => then(child));
      return child;
    }) as unknown as typeof spawn;
  await openUrl("darwin", "http://127.0.0.1:4747/?expert-creation-suggestion=o1", fake((c) => c.emit("exit", 0)));
  expect(runs[0]).toEqual({ command: "open", args: ["http://127.0.0.1:4747/?expert-creation-suggestion=o1"], options: { stdio: "ignore", detached: true, windowsHide: true, windowsVerbatimArguments: false } });
  await expect(openUrl("linux", "http://127.0.0.1:4747/?expert-creation-suggestion=o1", fake((c) => c.emit("error", new Error("spawn xdg-open ENOENT"))))).rejects.toThrow("spawn xdg-open ENOENT");
  await expect(openUrl("linux", "http://127.0.0.1:4747/?expert-creation-suggestion=o1", fake((c) => c.emit("exit", 3)))).rejects.toThrow("xdg-open exited with code 3");
  await expect(openUrl("win32", "https://x.example/?expert-creation-suggestion=a&calc", fake(() => {}))).rejects.toThrow("its address has characters the system's opener could misread");
  expect(runs).toHaveLength(3);
});
