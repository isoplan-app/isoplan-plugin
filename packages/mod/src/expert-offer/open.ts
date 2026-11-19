// /isoplan:expert's script (commands/expert.md):
//
//   node dist/expert-offer.js
//
// Opens the person's default browser on the review of this session's open expert offer
// (isoplan-app#328), on the office's floor, or says plainly there is none. The runner keeps each
// session's open offers in <claude dir>/isoplan/offers/<session id>.json, `{ "offers":
// ExpertOfferLine[] }`, one entry per office an offer is open in, rewritten whole on each change and
// gone once none is open (runner/offers.ts). The session id is Claude Code's own,
// $CLAUDE_CODE_SESSION_ID, which the hooks module's pipe and the runner go by too. This reads that
// file rather than the pipe: the session's end of the pipe belongs to its hooks module, and this
// runs apart from it, in the Bash tool. With several offers open it opens the newest, at the first
// office it is open in, and gives the others' links.
//
// Opening the browser is the person's own action, so the browser's window is expected; nothing else
// shows one. On Windows it is `start` through cmd with an empty title (cmd's own console hidden), on
// a Mac `open`, elsewhere `xdg-open`. Only an http(s) link of plain characters is handed to them, so
// cmd never reads one as more than a link (& % ^ and the like); any other is printed to click.

import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import type { ExpertOfferLine } from "../lines.js";
import { folderWords } from "./text.js";

/** The file of a session's open offers. */
export const offersPath = (claudeDir: string, session: string) => path.join(claudeDir, "isoplan", "offers", `${session}.json`);

/** The open offers in the file, in its order; none when it isn't there or doesn't parse. */
export async function readOffers(file: string): Promise<ExpertOfferLine[]> {
  let value: unknown;
  try {
    value = JSON.parse(await fs.readFile(file, "utf8"));
  } catch {
    return [];
  }
  const offers = (value as { offers?: unknown })?.offers;
  if (!Array.isArray(offers)) return [];
  return offers.filter((o): o is ExpertOfferLine => !!o && typeof o === "object" && ["id", "name", "folder", "url"].every((k) => typeof (o as Record<string, unknown>)[k] === "string"));
}

// An http(s) link with nothing a shell or cmd reads as more than the link.
const PLAIN_URL = /^https?:\/\/[A-Za-z0-9.:[\]-]+\/[A-Za-z0-9._~/?=-]*$/;

/** The command that opens `url` in the default browser on `platform`, or null when the link isn't one to hand to it. */
export function opener(platform: NodeJS.Platform, url: string, comspec = "cmd.exe"): { command: string; args: string[] } | null {
  if (!PLAIN_URL.test(url)) return null;
  // As Node runs a shell command on Windows: /s takes the outer quotes off, leaving start "" "<url>".
  if (platform === "win32") return { command: comspec, args: ["/d", "/s", "/c", `"start "" "${url}""`] };
  return { command: platform === "darwin" ? "open" : "xdg-open", args: [url] };
}

/** Opens `url` in the default browser; rejects, saying why, when it couldn't. */
export function openUrl(platform: NodeJS.Platform, url: string, run: typeof spawn = spawn): Promise<void> {
  const how = opener(platform, url, process.env.ComSpec || "cmd.exe");
  if (!how) return Promise.reject(new Error("its address has characters the system's opener could misread"));
  return new Promise((resolve, reject) => {
    const child = run(how.command, how.args, { stdio: "ignore", detached: true, windowsHide: true, windowsVerbatimArguments: platform === "win32" });
    // `start` and `open` return once the browser has the link; an xdg-open that waits for the browser counts as done.
    const timer = setTimeout(() => (child.unref(), resolve()), 10000);
    child.on("error", (err) => (clearTimeout(timer), reject(err)));
    child.on("exit", (code) => (clearTimeout(timer), code === 0 ? resolve() : reject(new Error(`${how.command} exited with code ${code}`))));
  });
}

const what = (o: ExpertOfferLine) => `the ${o.name}, offered for ${folderWords(o.folder)}`;

/** What /isoplan:expert prints: the newest open offer opened, or why not, and the other offers' links. */
export async function expertOffer(o: { claudeDir: string; session: string | undefined; open: (url: string) => Promise<void> }): Promise<string> {
  if (!o.session || !/^[\w-]{1,200}$/.test(o.session)) return "This runs inside a Claude Code session, which sets CLAUDE_CODE_SESSION_ID; it isn't set here, so this session's expert offer can't be found. Use the review link in Isoplan's status line.";
  const all = await readOffers(offersPath(o.claudeDir, o.session));
  // One per offer, at the first office it is open in, newest first.
  const offers = all.filter((x, i) => all.findIndex((y) => y.id === x.id) === i).reverse();
  const [newest, ...others] = offers;
  if (!newest) return "This session has no open expert offer.";
  let text: string;
  try {
    await o.open(newest.url);
    text = `Opened the review of ${what(newest)}, in your browser: ${newest.url}`;
  } catch (err) {
    text = `Your browser couldn't be opened (${(err as Error).message}). Open this link to review ${what(newest)}: ${newest.url}`;
  }
  if (!others.length) return text;
  return [text, `This session has ${others.length === 1 ? "another open offer" : `${others.length} more open offers`}:`, ...others.map((x) => `- ${what(x)}: ${x.url}`)].join("\n");
}
