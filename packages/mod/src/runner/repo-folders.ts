// Where on this machine a new session can start from the floor (#67, isoplan-app#182): each repo the
// office takes that Claude Code sessions here ran in, once, by its main checkout (#84), with the
// branches on its remote. The runner's driver sends the list as a `folders` message (session.ts),
// and a start naming a folder, or a branch, is opened only in one it listed.
//
// A folder a session ran in counts for its repo's main checkout (checkouts.ts): a worktree, even one
// since deleted, finds its repo's checkout, so a repo worked on only in worktrees is offered. A folder
// git can't place counts as itself. The checkout counts for the repo a session there reports as
// (data-layer/home.ts approvedHome): its repo, or, for a folder above several repos, the first the
// office takes. One that is gone, or in no repo the office takes, isn't listed. The checkout and
// each branch pass the secret scan before they may leave the machine; one it matches, or one longer
// than the protocol takes, is left out, never cut. Isoplan's own folders are never listed.

import fs from "node:fs/promises";
import path from "node:path";
import { MAX_BRANCH_LENGTH, MAX_FOLDER_LENGTH, MAX_FOLDER_REPOS, MAX_REPO_BRANCHES } from "@isoplan/protocol";
import { join, pathKey, relativeTo } from "../data-layer/git.js";

/** A folder a session ran in, and when it was last used, in ms since the epoch. */
export interface FolderSeen {
  folder: string;
  at: number;
}

/** One repo, as a `folders` message lists it. */
export interface RepoFolders {
  /** The repo's project id, lower-cased. */
  project: string;
  /** Its main checkout, alone. */
  folders: string[];
  /** The branches on its remote; absent when they couldn't be listed. */
  branches?: string[];
}

/**
 * Whether `folder` is one of Isoplan's own: anything inside <claude dir>/isoplan/, such as an
 * expert's read/ or a clone Isoplan keeps for itself, or inside the clones/ or experts/ of any of
 * `clonesFolders`, the folders runner.json's `clonesFolder` has named (readClonesFolders). Never the
 * person's clone, so never offered to start a session in, nor the clone a take works beside
 * (handoff/take.ts). Windows paths compare case-insensitively.
 */
export function isoplanFolder(claudeDir: string, folder: string, clonesFolders: readonly string[] = []): boolean {
  const own = [join(claudeDir, "isoplan"), ...clonesFolders.flatMap((f) => [join(f, "clones"), join(f, "experts")])];
  return own.some((dir) => pathKey(folder) === pathKey(dir) || relativeTo(dir, folder) !== null);
}

/** The runner's record of every folder runner.json's `clonesFolder` has named, so clones and experts' copies made there are still found, and still Isoplan's own, once it names another. */
export const clonesFoldersPath = (claudeDir: string) => path.join(claudeDir, "isoplan", "clones-folders.json");

/** The folders `clonesFolder` has named on this machine; none when the record is missing or doesn't parse. */
export async function readClonesFolders(claudeDir: string): Promise<string[]> {
  try {
    const value: unknown = JSON.parse(await fs.readFile(clonesFoldersPath(claudeDir), "utf8"));
    return Array.isArray(value) ? value.filter((f): f is string => typeof f === "string" && path.isAbsolute(f)) : [];
  } catch {
    return [];
  }
}

/**
 * runner.json's `clonesFolder` as the runner starts: "" for the places under <claude dir>/isoplan;
 * one that isn't an absolute path is ignored, with a log line. A folder it names is added to the
 * record first. `folders` is every folder the record holds, this one included.
 */
export async function useClonesFolder(claudeDir: string, setting: string, log: (text: string) => void): Promise<{ folder: string; folders: string[] }> {
  const folders = await readClonesFolders(claudeDir);
  if (!setting) return { folder: "", folders };
  if (!path.isAbsolute(setting)) {
    log(`clonesFolder in runner.json, ${setting}, isn't an absolute path, so it is ignored: new clones and experts' copies go under ${path.join(claudeDir, "isoplan")}`);
    return { folder: "", folders };
  }
  if (!folders.some((f) => pathKey(f) === pathKey(setting))) {
    folders.push(setting);
    await fs.mkdir(path.dirname(clonesFoldersPath(claudeDir)), { recursive: true });
    await fs.writeFile(clonesFoldersPath(claudeDir), JSON.stringify(folders, null, 2) + "\n");
  }
  return { folder: setting, folders };
}

export interface RepoFoldersOptions {
  /** Claude's folder on this machine, whose isoplan/ holds Isoplan's own folders (isoplanFolder). */
  claudeDir: string;
  /** The folders runner.json's `clonesFolder` has named, whose clones/ and experts/ are Isoplan's own too. */
  clonesFolders?: readonly string[];
  /** The main checkout of the repo `folder` is in, or the folder itself when git can't place it; null when there is none to list. */
  checkout: (folder: string) => Promise<string | null>;
  /** The project id of the repo the office takes that `folder` is in, lower-cased; null when it is gone or the office takes none. */
  home: (folder: string) => Promise<string | null>;
  /** The branches on the remote of `checkout`, a checkout of `project`; null when there are none to offer, or they couldn't be listed. */
  branches: (checkout: string, project: string) => Promise<string[] | null>;
  /** The name of the secret pattern `text` matches, or null. */
  scan: (text: string) => Promise<string | null>;
  log: (text: string) => void;
  /** The keys of the folders and branches the scan left out last time, kept by the caller across checks: only one newly left out is logged. Updated in place. */
  leftOut: Set<string>;
}

/** The repos `seen` is in, the most recently used first: each once, by its main checkout, at most MAX_FOLDER_REPOS, each with at most MAX_REPO_BRANCHES branches. */
export async function repoFolders(seen: FolderSeen[], o: RepoFoldersOptions): Promise<RepoFolders[]> {
  const byRepo = new Map<string, RepoFolders>();
  const tried = new Set<string>();
  const leftOut = new Set<string>();
  const scanned = async (text: string, key: string, what: string, project: string) => {
    const matched = await o.scan(text);
    if (!matched) return true;
    leftOut.add(key);
    if (!o.leftOut.has(key)) o.log(`${what} of ${project} wasn't listed for starting sessions from the floor: it matches the secret pattern "${matched}"`);
    return false;
  };
  const chosen: { repo: RepoFolders; key: string }[] = [];
  for (const { folder } of [...seen].sort((a, b) => b.at - a.at)) {
    if (byRepo.size >= MAX_FOLDER_REPOS) break;
    if (isoplanFolder(o.claudeDir, folder, o.clonesFolders)) continue;
    const checkout = await o.checkout(folder).catch(() => null);
    if (!checkout || isoplanFolder(o.claudeDir, checkout, o.clonesFolders)) continue;
    const key = pathKey(checkout);
    if (tried.has(key)) continue;
    tried.add(key);
    if (checkout.length > MAX_FOLDER_LENGTH) continue;
    const project = await o.home(checkout).catch(() => null);
    if (!project || byRepo.has(project)) continue;
    if (!(await scanned(checkout, key, "a folder", project))) continue;
    const repo: RepoFolders = { project, folders: [checkout] };
    byRepo.set(project, repo);
    chosen.push({ repo, key });
  }
  // Every repo's remote is asked at once, so one slow or unreachable remote holds up the list only by its own wait.
  const listed = await Promise.all(chosen.map(({ repo }) => o.branches(repo.folders[0]!, repo.project).catch(() => null)));
  for (const [i, { repo, key }] of chosen.entries()) {
    const branches = listed[i];
    if (!branches) continue;
    repo.branches = [];
    for (const branch of branches) {
      if (repo.branches.length >= MAX_REPO_BRANCHES) break;
      if (branch.length > MAX_BRANCH_LENGTH) continue;
      if (await scanned(branch, `${key}
${branch}`, "a branch", repo.project)) repo.branches.push(branch);
    }
  }
  o.leftOut.clear();
  for (const key of leftOut) o.leftOut.add(key);
  return [...byRepo.values()];
}
