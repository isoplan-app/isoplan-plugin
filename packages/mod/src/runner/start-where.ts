// A new session from the floor that opens outside it (#85): a start with a `mode` other than
// `driven`, which session.ts has checked (its person, its folder, its branch) before it comes here.
//
// - The folder: for Orca, the checkout when there is no branch or it is on it, else a worktree Orca
//   makes in the repo's Orca workspace (checkouts.ts orcaBranchFolder); for the rest, the folder the
//   runner offers for the branch, as for a driven start (checkouts.ts branchFolder).
// - It opens as a take does (handoff/take.ts openSession), under a fresh session id, with the typed
//   task its first message and nothing from any room: a terminal window, the person's own pick; a
//   background session; a terminal in Orca; or the Claude app, its first turn run hidden first.
// - The task goes on Claude Code's command line as it is, unless it can't safely: one that starts
//   with `-` would be read as an option, and on Windows a terminal runs it from a .cmd launcher, where
//   a quote or a line break would end the argument and a `\` at its end would escape the closing
//   quote, and cmd.exe can't run a line much over 8,000 characters, so a long task can't go there
//   either. Such a task is written to task.md in the start's own folder (<claude dir>/isoplan/starts/
//   <session>/, which holds the launcher too), which is added to the session, and the first message
//   says to read it. The runner removes a start's own folder once it is 7 days old (tidyStarts).
// - For the Claude app the task is always in task.md: its hidden first turn runs with no one to
//   approve what it does, so it only reads the task and says how it will go about it, and the work
//   itself runs in the app, which asks the person as it goes.

import fs from "node:fs/promises";
import path from "node:path";
import type { StartMode } from "@isoplan/protocol";
import type { RunOrca } from "../handoff/orca.js";
import { desktopProblem, openSession, type OpenOptions, type OpenWords, type TakeSettings } from "../handoff/take.js";
import { forkEnv } from "./claude.js";
import type { StartElsewhere } from "./session.js";

export interface StartWhereOptions extends OpenOptions {
  machine: string;
  /** The processor, as Node names it: by default this one's. */
  arch?: string;
  settings: () => Promise<TakeSettings>;
  /** Orca's CLI, or null when Orca isn't on this machine. */
  orca: () => Promise<RunOrca | null>;
  /** The folder a session on `branch` of the checkout `folder` opens in (checkouts.ts branchFolder). */
  branchFolder: (folder: string, branch: string) => Promise<string | { error: string }>;
  /** The same in Orca (checkouts.ts orcaBranchFolder). */
  orcaFolder: (orca: RunOrca, folder: string, branch: string | undefined) => Promise<string | { error: string }>;
  now?: () => number;
}

/** Where a start may open other than the floor, for the runner's hello: a terminal only where take.ts can open one, Orca and the Claude app only where they are found. */
export function startPlaces(platform: NodeJS.Platform, orca: boolean, desktop: boolean): StartMode[] {
  return [...(platform === "win32" || platform === "darwin" ? (["terminal"] as const) : []), "headless", ...(orca ? (["orca"] as const) : []), ...(desktop ? (["desktop"] as const) : [])];
}

/** The start's own folder: its launcher, and its task when that can't go on the command line. */
export const startDir = (claudeDir: string, session: string) => path.join(claudeDir, "isoplan", "starts", session);

/** How long a start's own folder is kept: its session isn't the runner's to hold, so it can't tell when the session is done with it. */
const START_KEPT_MS = 7 * 86400000;

/** Removes the starts' own folders last changed more than 7 days before `now`; an error is ignored. */
export async function tidyStarts(claudeDir: string, now = Date.now()): Promise<void> {
  const starts = path.join(claudeDir, "isoplan", "starts");
  const names = await fs.readdir(starts).catch(() => []);
  await Promise.all(
    names.map(async (name) => {
      const dir = path.join(starts, name);
      const st = await fs.stat(dir).catch(() => null);
      if (st?.isDirectory() && now - st.mtimeMs > START_KEPT_MS) await fs.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(() => {});
    }),
  );
}

/** The longest task a Windows launcher's line takes, leaving room in cmd.exe's 8,191 for the rest of it. */
const LAUNCHER_TASK_MAX = 4000;

/** Whether `task` can go on Claude Code's command line as it is, for `mode` on `platform`. */
export function onCommandLine(task: string, mode: StartElsewhere["mode"], platform: NodeJS.Platform): boolean {
  if (task.startsWith("-")) return false;
  const launcher = mode === "terminal" || mode === "orca";
  return !(launcher && platform === "win32" && (task.length > LAUNCHER_TASK_MAX || /["\r\n]/.test(task) || task.endsWith("\\")));
}

/** The first message, when the task is in `file`. */
export const taskPrompt = (file: string) => `Your task, typed on the Isoplan floor, is in ${file}. Read it, then do it.`;

/** The Claude app's hidden first turn: it reads the task in `file` and changes nothing. */
export const desktopTaskPrompt = (file: string) => `Your task, typed on the Isoplan floor, is in ${file}. Read it and say briefly how you will do it; wait for the person in the Claude app before changing anything.`;

/** Opens the start where it asks; never throws for what it expects. */
export async function startWhere(start: StartElsewhere, bin: string, o: StartWhereOptions): Promise<{ opened: boolean; problem: string | null }> {
  const startedAt = (o.now ?? Date.now)();
  const env = forkEnv(o.env);
  const again = "start it again from the floor another way";
  let orca: RunOrca | null = null;
  if (start.mode === "orca") {
    orca = await o.orca();
    if (!orca) return { opened: false, problem: `Orca wasn't found on ${o.machine}, so nothing was started: ${again}.` };
  }
  if (start.mode === "desktop") {
    const problem = await desktopProblem(bin, env, o.platform, o.arch ?? process.arch, o.machine, "start it again");
    if (problem) return { opened: false, problem };
  }
  const dir = orca ? await o.orcaFolder(orca, start.folder, start.branch) : start.branch !== undefined ? await o.branchFolder(start.folder, start.branch) : start.folder;
  if (typeof dir !== "string") {
    o.log(`start ${start.id}: no folder for ${start.branch ?? "its folder"} of ${start.folder}: ${dir.error}`);
    return { opened: false, problem: `A folder for ${start.branch ? `the branch ${start.branch}` : start.folder} couldn't be readied on ${o.machine}, so nothing was started. Its runner log says why.` };
  }
  const folder = startDir(o.claudeDir, start.session);
  await fs.mkdir(folder, { recursive: true });
  const desktop = start.mode === "desktop";
  const plain = !desktop && onCommandLine(start.instruction, start.mode, o.platform);
  let prompt = start.instruction;
  if (!plain) {
    const file = path.join(folder, "task.md");
    await fs.writeFile(file, start.instruction + "\n");
    prompt = desktop ? desktopTaskPrompt(file) : taskPrompt(file);
  }
  const words: OpenWords = {
    read: "start on the task",
    did: "Claude Code started on the task",
    stopped: "the new session stopped",
    again: "start it again from the floor",
    at: "The folder is",
    yourself: `The folder is ${dir}: open Claude Code there yourself.`,
    changed: null,
  };
  return openSession({ mode: start.mode, bin, env, dir, folder, addDir: !plain, prompt, session: start.session, name: "Isoplan new session", orca, settings: await o.settings(), startedAt, label: `start ${start.id}`, words }, o);
}
