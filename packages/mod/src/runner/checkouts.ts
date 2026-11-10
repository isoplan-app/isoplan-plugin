// Each repo's main checkout, the branches on its remote, and a worktree for one of them (#84), for
// where a new session can start from the floor (repo-folders.ts, session.ts).
//
// - A folder's main checkout is the folder above `git rev-parse --git-common-dir` when that is a
//   `.git` folder: the checkout every worktree of the repo shares. A worktree whose main checkout
//   was found is remembered in `~/.claude/isoplan/runner/checkouts.json`, so a repo seen only in
//   worktrees since deleted is still offered while its main checkout is there.
// - The branches are the remote's own, `git ls-remote --symref origin HEAD refs/heads/*` (origin is
//   the remote the project id comes from, identity.ts), never local or `refs/remotes` ones, which can
//   be stale. The remote's default branch, its HEAD, is listed first.
//   Hidden, never prompting (handoff/git.ts createRunGit), under gitTimeoutSeconds, and asked again
//   once older than branchRefreshMinutes. One that fails is logged when it starts failing, not on
//   every check, and its repo is offered with no branches.
// - A branch other than the one the checkout is on opens in a worktree of it: one already on it
//   anywhere (one whose folder was deleted by hand is pruned first), else a new one beside the
//   checkout, `<checkout>-branch-<branch>`, characters other than letters, digits, . _ - as -. The
//   checkout's own branch is never switched, and none of the repo's hooks runs while the branch is
//   checked out: they would be whoever pushed it, from that branch.
// - A start into Orca (#85, start-where.ts) gets a worktree Orca makes in the repo's Orca workspace
//   where one is needed and Orca can make it (orcaBranchFolder), else branchFolder's.

import fs from "node:fs/promises";
import path from "node:path";
import { dirname, isWindowsPath, normalize, pathKey, type Where } from "../data-layer/git.js";
import type { RunGit } from "../handoff/git.js";
import type { RunOrca } from "../handoff/orca.js";
import { inOrca, noHooks, orcaWorktree, worktreeOn } from "../handoff/take.js";

/** The main checkout of the repo at `where`: the folder holding its shared `.git`, or, for a bare repo's worktree, the worktree itself. */
export function mainCheckout(where: Where): string {
  return /\/\.git$/.test(where.commonDir) ? dirname(where.commonDir) : where.toplevel;
}

/** `p`, from git's forward slashes, spelled as `like` is: with backslashes for a Windows path. */
const spelledAs = (like: string, p: string) => (isWindowsPath(like) ? normalize(p).replace(/\//g, "\\") : normalize(p));

export interface Checkouts {
  /** The main checkout of the repo `folder` is in, or the folder itself when git can't place it; for a folder that is gone, the one remembered for it. Null when that is gone too, or none was. */
  of(folder: string): Promise<string | null>;
  /** Forgets every folder not in `folders`, and saves what is remembered when it changed. */
  keep(folders: string[]): Promise<void>;
}

export function createCheckouts({ file, resolve, isDir }: { file: string; resolve: (dir: string) => Promise<Where | null>; isDir: (p: string) => Promise<boolean> }): Checkouts {
  let known: Promise<Record<string, string>> | null = null;
  let changed = false;
  let saving = Promise.resolve();
  const load = () =>
    (known ??= fs.readFile(file, "utf8").then(
      (text): Record<string, string> => {
        const parsed = JSON.parse(text) as unknown;
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
        return Object.fromEntries(Object.entries(parsed).filter((e): e is [string, string] => typeof e[1] === "string"));
      },
      (): Record<string, string> => ({}),
    ));
  return {
    async of(folder) {
      const remembered = await load();
      const key = pathKey(folder);
      let main: string | null;
      if (await isDir(folder)) {
        const where = await resolve(folder);
        if (!where) return folder;
        main = spelledAs(folder, mainCheckout(where));
        if (pathKey(main) === key) return folder;
        if (remembered[key] !== main) {
          remembered[key] = main;
          changed = true;
        }
      } else main = remembered[key] ?? null;
      return main && (await isDir(main)) ? main : null;
    },
    async keep(folders) {
      const remembered = await load();
      const wanted = new Set(folders.map(pathKey));
      for (const key of Object.keys(remembered)) {
        if (wanted.has(key)) continue;
        delete remembered[key];
        changed = true;
      }
      if (!changed) return;
      changed = false;
      // One write at a time, each through a temporary file; one that failed is tried again by the next keep.
      const write = saving.then(async () => {
        await fs.mkdir(path.dirname(file), { recursive: true });
        const temp = `${file}.${process.pid}.tmp`;
        await fs.writeFile(temp, JSON.stringify(remembered, null, 2) + "\n");
        await fs.rename(temp, file).catch(async (err: unknown) => {
          await fs.rm(temp, { force: true }).catch(() => {});
          throw err;
        });
      });
      saving = write.catch(() => {});
      await write.catch((err: unknown) => {
        changed = true;
        throw err;
      });
    },
  };
}

/** The branch names `git ls-remote --symref` printed, the one its HEAD names first; none that git would read as an option. */
export function parseHeads(stdout: string): string[] {
  const out: string[] = [];
  let head: string | null = null;
  for (const line of stdout.split(/\r?\n/)) {
    const m = /^[0-9a-f]+\trefs\/heads\/(.+)$/.exec(line.trim());
    if (m && !m[1]!.startsWith("-")) out.push(m[1]!);
    head ??= /^ref: refs\/heads\/(.+)\tHEAD$/.exec(line.trim())?.[1] ?? null;
  }
  const at = head === null ? -1 : out.indexOf(head);
  return at > 0 ? [out[at]!, ...out.slice(0, at), ...out.slice(at + 1)] : out;
}

export interface RemoteBranchesOptions {
  run: RunGit;
  timeoutMs: () => Promise<number>;
  /** How long a checkout's list is kept before its remote is asked again. */
  refreshMs: () => Promise<number>;
  log: (text: string) => void;
  now?: () => number;
}

/** The branches on `checkout`'s origin, by name; null when its remote couldn't be asked. */
export function createRemoteBranches({ run, timeoutMs, refreshMs, log, now = Date.now }: RemoteBranchesOptions): (checkout: string) => Promise<string[] | null> {
  const cache = new Map<string, { at: number; branches: Promise<string[] | null> }>();
  const failing = new Set<string>();
  return async (checkout) => {
    const key = pathKey(checkout);
    const hit = cache.get(key);
    if (hit && now() - hit.at < (await refreshMs())) return hit.branches;
    const branches = (async () => {
      const r = await run(["ls-remote", "--symref", "origin", "HEAD", "refs/heads/*"], { cwd: checkout, timeoutMs: await timeoutMs() });
      if (r.code !== 0) {
        if (!failing.has(key)) log(`couldn't list the branches on the remote of ${checkout} (${r.timedOut ? "git took too long" : `git ls-remote exited ${r.code}`}), so it is offered for new sessions with no branches; this is logged again only once it has worked`);
        failing.add(key);
        return null;
      }
      failing.delete(key);
      return parseHeads(r.stdout);
    })();
    cache.set(key, { at: now(), branches });
    return branches;
  };
}

/** A branch name as a folder's: characters other than letters, digits, . _ - as -, none of . - at its end. */
const asName = (branch: string) => branch.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/[.-]+$/, "");

/**
 * The folder a session on `branch` opens in: `checkout` when it is on that branch; else a worktree
 * already on it; else a new one beside the checkout, from the local branch of that name as it is, or,
 * with none, from origin's, fetched now and tracked. The error says why there is none.
 */
export async function branchFolder(run: RunGit, checkout: string, branch: string, timeoutMs: number): Promise<string | { error: string }> {
  const git = (args: string[]) => run(args, { cwd: checkout, timeoutMs });
  const head = await git(["symbolic-ref", "-q", "--short", "HEAD"]);
  if (head.code === 0 && head.stdout.trim() === branch) return checkout;
  const existing = await worktreeOn(run, checkout, branch, timeoutMs);
  const isDir = (p: string) => fs.stat(p).then((s) => s.isDirectory(), () => false);
  if (existing && (await isDir(existing))) return spelledAs(checkout, existing);
  // A worktree on the branch whose folder was deleted by hand: git still holds the branch for it until pruned.
  if (existing) await git(["worktree", "prune"]);
  const hooksOff = await noHooks();
  const main = normalize(checkout);
  const base = `${main}-branch-${asName(branch)}`;
  for (let n = 1; n < 10; n++) {
    const dir = spelledAs(checkout, n === 1 ? base : `${base}-${n}`);
    if (await fs.stat(dir).then(() => true, () => false)) continue;
    const local = (await git(["rev-parse", "--verify", "-q", `refs/heads/${branch}`])).code === 0;
    if (!local) {
      const fetched = await git([...hooksOff, "fetch", "origin", `+refs/heads/${branch}:refs/remotes/origin/${branch}`]);
      if (fetched.code !== 0) return { error: `git fetch origin ${branch} in ${checkout} failed${fetched.timedOut ? " (it took too long)" : ""}:\n${fetched.stderr}` };
    }
    const made = await git([...hooksOff, ...(local ? ["worktree", "add", dir, branch] : ["worktree", "add", "--track", "-b", branch, dir, `origin/${branch}`])]);
    return made.code === 0 ? dir : { error: `git worktree add ${dir} failed${made.timedOut ? " (it took too long)" : ""}:\n${made.stderr}` };
  }
  return { error: `${base} and the next eight names beside it are taken by other folders` };
}

/**
 * The folder a start from the floor into Orca opens in (#85), as branchFolder's, but in Orca: the
 * checkout when there is no `branch` or the checkout is on it; else a worktree Orca makes in the
 * repo's Orca workspace, `branch-<branch>`, from origin's branch, fetched now, when the repo has no
 * worktree on it and no local branch of its name (take.ts orcaWorktree); else the one branchFolder
 * finds or makes, which Orca finds by its path. The checkout is a repo in Orca, added when it isn't.
 */
export async function orcaBranchFolder(orca: RunOrca, run: RunGit, checkout: string, branch: string | undefined, timeoutMs: number): Promise<string | { error: string }> {
  const git = (args: string[]) => run(args, { cwd: checkout, timeoutMs });
  const head = await git(["symbolic-ref", "-q", "--short", "HEAD"]);
  if (branch === undefined || (head.code === 0 && head.stdout.trim() === branch)) {
    const unknown = await inOrca(orca, checkout);
    return unknown ? { error: unknown } : checkout;
  }
  if ((await git(["rev-parse", "--verify", "-q", `refs/heads/${branch}`])).code !== 0) {
    const fetched = await git([...(await noHooks()), "fetch", "origin", `+refs/heads/${branch}:refs/remotes/origin/${branch}`]);
    if (fetched.code !== 0) return { error: `git fetch origin ${branch} in ${checkout} failed${fetched.timedOut ? " (it took too long)" : ""}:
${fetched.stderr}` };
  }
  const made = { name: `branch-${asName(branch)}`, comment: `Isoplan: a new session on ${branch}` };
  const dir = await orcaWorktree(orca, run, { dir: checkout, remote: "origin" }, branch, made, () => branchFolder(run, checkout, branch, timeoutMs), timeoutMs);
  return typeof dir === "string" ? spelledAs(checkout, dir) : dir;
}
