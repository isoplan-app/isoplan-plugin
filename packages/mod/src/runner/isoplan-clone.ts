// The clone Isoplan keeps for itself of each project (isoplan-app#315), for a start from the floor
// with `hidden`: its session works in a folder the person's other tools (Orca, an IDE) don't list,
// since it is neither their clone nor a worktree of it.
//
// - One per project, <claude dir>/isoplan/clones/<name>, or <clonesFolder>/clones/<name> when
//   runner.json's `clonesFolder` names a folder, the name from the project id (cloneName). One made
//   earlier is used where it is: at its longer name from before (earlierCloneName), or in a folder
//   clonesFolder named before (repo-folders.ts readClonesFolders). On Windows git takes long paths
//   in it (core.longpaths, set as it is cloned, so the agent's git has it too).
//   It is made as an expert's read/ is (expert-checkout.ts): from the origin of the person's
//   checkout the start names, only one on the wire, never a local path, a file:// URL or a share;
//   borrowing the checkout's objects while it is made (--reference-if-able, then --dissociate, or
//   borrowing nothing when that fails, as in a folder too deep for the repack on Windows), and
//   built in <name>.new, then renamed into place, so one cut short never looks finished.
// - Unlike read/ it is a working clone: every branch, on origin's default branch as a branch of its
//   own, not detached, with the repo's hooks and Git LFS as git has them. It is never reset or
//   cleaned, since a session may have left work in it.
// - One already there is fetched before each use, every branch by an explicit refspec, with origin
//   set to the checkout's current one in case it moved. Its own checkout is left on whatever it is
//   on, as a visible start leaves the person's.
// - A start with a branch gets a worktree of the clone beside it (checkouts.ts branchFolder), so in
//   clones/ too. Nothing in <claude dir>/isoplan/, nor in clones/ of a clonesFolder, is listed for
//   New session, nor taken for the clone a take works beside (repo-folders.ts isoplanFolder).
// - The person's checkout is only read: its origin and where its objects are. One make or fetch at
//   a time for each project, so two starts at once don't both clone.

import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { RunGit } from "../handoff/git.js";
import { onTheWire } from "../handoff/take.js";
import { borrowFrom, cloneBorrowing, longPaths, renamed } from "./expert-checkout.js";

const NO_REMOTE = "This repo has no remote, so Isoplan can't keep a copy of its own and nothing was started.";
const NOT_ON_WIRE = "This repo's remote is a folder or a share, not an https or ssh address, so Isoplan can't keep a copy of its own and nothing was started.";
const NOT_MADE = "Isoplan's own copy of this repo couldn't be made on this computer, so nothing was started. Its runner log says why.";
const NOT_FETCHED = "Isoplan's own copy of this repo couldn't be brought up to date on this computer, so nothing was started. Its runner log says why.";

/** Where Isoplan keeps its clones: in runner.json's `clonesFolder` when it names one, else under <claude dir>/isoplan. */
export const clonesDir = (claudeDir: string, clonesFolder = "") => (clonesFolder ? path.join(clonesFolder, "clones") : path.join(claudeDir, "isoplan", "clones"));

const slugged = (text: string) => text.replace(/[^a-z0-9._-]+/g, "-").replace(/^[.-]+|[.-]+$/g, "");
const hashOf = (id: string) => createHash("sha256").update(id).digest("hex").slice(0, 8);

/** A project id as a folder's name: its repo's name, letters, digits, . _ - kept, the rest as -, cut to 20, then a hash of the id, so two ids never share one. */
export function cloneName(project: string): string {
  const id = project.toLowerCase();
  const repo = slugged(id.split("/").filter(Boolean).pop() ?? "").slice(0, 20).replace(/[.-]+$/, "");
  return `${repo || "repo"}-${hashOf(id)}`;
}

/** The name a clone was given before cloneName took only the repo's name: the whole id, cut to 60. One made then is still used at it. */
export function earlierCloneName(project: string): string {
  const id = project.toLowerCase();
  return `${slugged(id).slice(0, 60) || "repo"}-${hashOf(id)}`;
}

export interface IsoplanClonesOptions {
  git: RunGit;
  claudeDir: string;
  /** runner.json's `clonesFolder`, where a new clone goes; "" for <claude dir>/isoplan/clones. */
  clonesFolder?: string;
  /** Every folder `clonesFolder` has named (repo-folders.ts readClonesFolders), where a clone made earlier may be. */
  clonesFolders?: readonly string[];
  timeoutMs: () => Promise<number>;
  log: (text: string) => void;
  /** Whether the clone may be made from origin's URL: onTheWire, which a test loosens for a local origin. */
  cloneFrom?: (remote: string) => boolean;
  platform?: NodeJS.Platform;
}

/** Isoplan's clone of `project`, from the person's `checkout`, made or fetched now: its folder, or why there is none, in words for the floor. */
export type IsoplanClone = (checkout: string, project: string) => Promise<string | { problem: string }>;

export function createIsoplanClones({ git, claudeDir, clonesFolder = "", clonesFolders = [], timeoutMs, log, cloneFrom = onTheWire, platform = process.platform }: IsoplanClonesOptions): IsoplanClone {
  const busy = new Map<string, Promise<unknown>>();
  const run = async (cwd: string, args: string[]) => git(args, { cwd, timeoutMs: await timeoutMs() });
  const why = (r: { timedOut: boolean; stderr: string }) => `${r.timedOut ? "git took too long" : "git failed"}: ${r.stderr.trim()}`;

  async function ready(checkout: string, project: string): Promise<string | { problem: string }> {
    const remote = await run(checkout, ["remote", "get-url", "origin"]);
    // Exit 2 is git's "no such remote"; anything else is a failure, not a repo without one.
    if (remote.code === 2) return { problem: NO_REMOTE };
    if (remote.code !== 0) {
      log(`couldn't read the origin of ${checkout} for Isoplan's own clone of ${project} (${why(remote)})`);
      return { problem: NOT_MADE };
    }
    const url = remote.stdout.trim();
    if (!cloneFrom(url)) {
      log(`didn't clone ${project} for a hidden start: ${checkout}'s origin, ${url}, isn't an https, ssh or host:path remote`);
      return { problem: NOT_ON_WIRE };
    }
    // One made earlier is used where it is, at its name then: under <claude dir>/isoplan, or in a folder clonesFolder names or named before.
    const earlier = [path.join(clonesDir(claudeDir), earlierCloneName(project)), ...["", clonesFolder, ...clonesFolders].map((f) => path.join(clonesDir(claudeDir, f), cloneName(project)))];
    const there = async (p: string) => ((await fs.lstat(p).catch(() => null)) ? p : null);
    const found = (await Promise.all(earlier.map(there))).find((p) => p !== null);
    const root = clonesDir(claudeDir, clonesFolder);
    const clone = found ?? path.join(root, cloneName(project));
    if (found) {
      const own = await fs.lstat(path.join(clone, ".git")).then((s) => s.isDirectory(), () => false);
      if (!own) {
        log(`${clone} is there already and isn't a clone of its own, so it was left as it is and the hidden start of ${project} was refused; remove it and Isoplan clones it again`);
        return { problem: NOT_MADE };
      }
      const set = await run(clone, ["remote", "set-url", "origin", url]);
      const fetched = set.code === 0 ? await run(clone, ["fetch", "origin", "+refs/heads/*:refs/remotes/origin/*"]) : set;
      if (fetched.code !== 0) {
        log(`couldn't fetch origin in Isoplan's own clone ${clone} (${why(fetched)})`);
        return { problem: NOT_FETCHED };
      }
      return clone;
    }
    const staging = `${clone}.new`;
    await fs.mkdir(root, { recursive: true });
    await fs.rm(staging, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    const long = longPaths(platform);
    const clean = () => fs.rm(staging, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    const made = await cloneBorrowing((borrow) => run(root, [...long.git, "clone", "-q", ...long.clone, ...borrow, "--", url, staging]), await borrowFrom(run, checkout), clean);
    if (made.code !== 0) {
      log(`couldn't clone ${project} into ${staging} for a hidden start (${why(made)})`);
      await fs.rm(staging, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(() => {});
      return { problem: NOT_MADE };
    }
    await renamed(staging, clone);
    log(`made Isoplan's own clone of ${project} in ${clone}`);
    return clone;
  }

  return (checkout, project) => {
    const key = cloneName(project);
    // Each one never rejects, so the next always runs.
    const next = (busy.get(key) ?? Promise.resolve())
      .then(() => ready(checkout, project))
      .catch((err: Error) => {
        log(`Isoplan's own clone of ${project} failed: ${err?.stack ?? String(err)}`);
        return { problem: NOT_MADE };
      });
    busy.set(key, next);
    void next.then(() => busy.get(key) === next && busy.delete(key));
    return next;
  };
}
