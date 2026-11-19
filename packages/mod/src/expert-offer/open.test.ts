import { EventEmitter } from "node:events";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { spawn } from "node:child_process";
import { afterEach, expect, test } from "vitest";
import type { ExpertOfferLine } from "../lines.js";
import { expertOffer, opener, openUrl } from "./open.js";

const cleanups: (() => unknown)[] = [];
afterEach(() => {
  for (const c of cleanups.splice(0)) c();
});

const DEV = "ws://127.0.0.1:4747/data-layer";
const TEAM = "wss://office.team.example/data-layer";
const offer = (id: string, server: string, key = "parser"): ExpertOfferLine => ({
  type: "expert-offer",
  server,
  id,
  key,
  name: key[0]!.toUpperCase() + key.slice(1) + " Expert",
  folder: `src/${key}`,
  url: `${server === DEV ? "http://127.0.0.1:4747" : "https://office.team.example"}/?offer=${id}`,
  why: { share: 0.2, tokens: 40000, minutes: 3, corrections: 0 },
});

// A Claude config folder whose session s1 has `offers` open, as the runner writes them; none when null.
function claudeDir(offers: unknown | null): string {
  const dir = mkdtempSync(path.join(tmpdir(), "isoplan-offer-"));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  if (offers !== null) {
    mkdirSync(path.join(dir, "isoplan", "offers"), { recursive: true });
    writeFileSync(path.join(dir, "isoplan", "offers", "s1.json"), JSON.stringify(offers));
  }
  return dir;
}

test("/isoplan:expert opens the session's newest open offer, at the first office it is open in, and gives the others' links", async () => {
  const opened: string[] = [];
  const dir = claudeDir({ offers: [offer("o1", DEV, "billing"), offer("o2", DEV), offer("o2", TEAM), { id: 3 }] });
  expect(await expertOffer({ claudeDir: dir, session: "s1", open: async (url) => void opened.push(url) })).toBe(
    ["Opened the review of the Parser Expert, offered for src/parser, in your browser: http://127.0.0.1:4747/?offer=o2", "This session has another open offer:", "- the Billing Expert, offered for src/billing: http://127.0.0.1:4747/?offer=o1"].join("\n"),
  );
  expect(opened).toEqual(["http://127.0.0.1:4747/?offer=o2"]);
});

test("/isoplan:expert says plainly when the session has no open offer, or isn't a Claude Code session's", async () => {
  const open = async () => expect.unreachable();
  expect(await expertOffer({ claudeDir: claudeDir(null), session: "s1", open })).toBe("This session has no open expert offer.");
  expect(await expertOffer({ claudeDir: claudeDir("not offers"), session: "s1", open })).toBe("This session has no open expert offer.");
  expect(await expertOffer({ claudeDir: claudeDir(null), session: undefined, open })).toMatch(/^This runs inside a Claude Code session, which sets CLAUDE_CODE_SESSION_ID; it isn't set here/);
});

test("/isoplan:expert gives the link to click when the browser couldn't be opened", async () => {
  const dir = claudeDir({ offers: [offer("o1", DEV)] });
  expect(await expertOffer({ claudeDir: dir, session: "s1", open: async () => Promise.reject(new Error("spawn xdg-open ENOENT")) })).toBe(
    "Your browser couldn't be opened (spawn xdg-open ENOENT). Open this link to review the Parser Expert, offered for src/parser: http://127.0.0.1:4747/?offer=o1",
  );
});

test("the browser is opened with start through cmd and an empty title on Windows, open on a Mac and xdg-open elsewhere; a link cmd could misread isn't handed over", () => {
  const url = "https://office.team.example/?offer=aB3_-x";
  expect(opener("win32", url, "C:\\Windows\\system32\\cmd.exe")).toEqual({ command: "C:\\Windows\\system32\\cmd.exe", args: ["/d", "/s", "/c", `"start "" "${url}""`] });
  expect(opener("darwin", url)).toEqual({ command: "open", args: [url] });
  expect(opener("linux", url)).toEqual({ command: "xdg-open", args: [url] });
  expect(opener("win32", "http://[::1]:4747/?offer=o1")).not.toBeNull();
  for (const bad of ["https://x.example/?offer=a&calc", "https://x.example/%PATH%", "file:///C:/x", 'https://x.example/"'] ) expect(opener("win32", bad)).toBeNull();
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
  await openUrl("darwin", "http://127.0.0.1:4747/?offer=o1", fake((c) => c.emit("exit", 0)));
  expect(runs[0]).toEqual({ command: "open", args: ["http://127.0.0.1:4747/?offer=o1"], options: { stdio: "ignore", detached: true, windowsHide: true, windowsVerbatimArguments: false } });
  await expect(openUrl("linux", "http://127.0.0.1:4747/?offer=o1", fake((c) => c.emit("error", new Error("spawn xdg-open ENOENT"))))).rejects.toThrow("spawn xdg-open ENOENT");
  await expect(openUrl("linux", "http://127.0.0.1:4747/?offer=o1", fake((c) => c.emit("exit", 3)))).rejects.toThrow("xdg-open exited with code 3");
  await expect(openUrl("win32", "https://x.example/?offer=a&calc", fake(() => {}))).rejects.toThrow("its address has characters the system's opener could misread");
  expect(runs).toHaveLength(3);
});
