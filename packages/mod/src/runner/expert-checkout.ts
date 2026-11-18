// An expert's own clone of its repo, read/, never anyone's working tree nor a worktree of one:
//
// - read/ is cloned from the person's repo's origin, detached at origin's default branch, so it
//   doesn't show under their repo in Orca or `git worktree list`, where a person could come across
//   a trunk and resume it. Every trunk and fork runs in it, and its folder never moves, since forks
//   resume a trunk by its folder's path. It is moved to a newer commit only under the checkout lock's
//   exclusive hold (expert-lock.ts), and reset if a fork ever changed it.
// - The clone borrows the person's repo's objects while it is made (--reference-if-able, then
//   --dissociate, so it never depends on them after), and holds the default branch alone, no tags.
//   An origin that is a local path, a file:// URL or a \\server share is refused, as a handoff's is.
//
// The person's repo is only ever read: its origin URL and origin's default branch. Every git call
// that changes anything runs in read/, through RunGit (hidden, no prompt, under gitTimeoutSeconds),
// without hooks (noHooks), and clone, checkout and reset without Git LFS's download. Each prepare
// sets read/'s origin to the person's repo's current one, in case it moved. A read/ that isn't a
// clone of its own (a worktree from an earlier build, whose .git is a file) is refused, never
// deleted. Which files changed since a commit is asked once per distinct commit with no pathspec,
// since a list of paths could pass Windows' command-line limit, and intersected in memory.

import fs from "node:fs/promises";
import path from "node:path";
import type { RunGit } from "../handoff/git.js";
import { noHooks, onTheWire } from "../handoff/take.js";
import { inside } from "./expert-claude.js";

// Git LFS downloads nothing into read/: an expert reads source, not large files.
const NO_LFS = { GIT_LFS_SKIP_SMUDGE: "1" };

// A rename, tried again for a moment: on Windows a scanner can hold a folder just written.
async function renamed(from: string, to: string) {
  for (let n = 1; ; n++) {
    try {
      return await fs.rename(from, to);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (n >= 5 || (code !== "EPERM" && code !== "EBUSY" && code !== "EACCES")) throw err;
      await new Promise((r) => setTimeout(r, 200));
    }
  }
}

export interface ExpertCheckoutOptions {
  git: RunGit;
  repo: string;
  /** The expert's folder, ~/.claude/isoplan/experts/<name>. */
  dir: string;
  name: string;
  timeoutMs: number | (() => number | Promise<number>);
  log: (text: string) => void;
  /** How long a fetch counts as fresh: the expert file's `fetchSeconds`. */
  fetchSeconds?: () => number;
  now?: () => number;
  /** Told why, besides the log, when a fetch fails: the expert's health log says so too. */
  onFetchFailed?: (why: string) => void;
  /** Whether read/ may be cloned from origin's URL: onTheWire, which a test loosens for a local origin. */
  cloneFrom?: (remote: string) => boolean;
}

export interface ExpertCheckout {
  /** Finds origin's default branch, clones read/ if it isn't there, else fetches it; its branch and HEAD. */
  prepare(): Promise<{ branch: string; commit: string }>;
  /** Fetches origin's default branch, at most every fetchSeconds; its commit when it is ahead of the read checkout, else null. */
  fetch(): Promise<string | null>;
  /** Moves the read checkout to `commit`. Under the exclusive hold only. */
  move(commit: string): Promise<void>;
  head(): Promise<string>;
  /** Whether anything in the read checkout changed. */
  dirty(): Promise<boolean>;
  /** Puts the read checkout back as its HEAD has it. Under the exclusive hold only. */
  reset(): Promise<void>;
  /** The files of `index` (file → commit) that changed between their commit and HEAD; a commit git doesn't know counts all its files. */
  changed(index: Readonly<Record<string, string>>): Promise<Set<string>>;
  /** Deletes read/ when it is a clone of its own: for a change of repo. */
  remove(): Promise<void>;
  /** The file names in one of the read checkout's folders, sorted; none when it isn't there. */
  list(dir: "docs/adr"): Promise<string[]>;
  /** A file of the read checkout, cut to `max` characters; null when it isn't there. */
  read(file: string, max: number): Promise<string | null>;
  /** Whether a repo-relative file is in the read checkout: at its HEAD, since no fork may change it. */
  has(file: string): Promise<boolean>;
}

export function createExpertCheckout({ git, repo, dir, name, timeoutMs, log, fetchSeconds = () => 60, now = Date.now, onFetchFailed, cloneFrom = onTheWire }: ExpertCheckoutOptions): ExpertCheckout {
  const read = path.join(dir, "read");
  const staging = path.join(dir, "read.new");
  let branch: string | null = null;
  let fetchedAt: number | null = null;

  const run = async (cwd: string, args: string[], env?: Record<string, string>) => git([...(await noHooks()), ...args], { cwd, ...(env && { env }), timeoutMs: typeof timeoutMs === "number" ? timeoutMs : await timeoutMs() });
  const must = async (cwd: string, args: string[], env?: Record<string, string>) => {
    const r = await run(cwd, args, env);
    if (r.code !== 0) throw new Error(`git ${args.join(" ")} failed${r.timedOut ? " (it took too long)" : ""}: ${r.stderr.trim()}`);
    return r.stdout.trim();
  };
  // Whether read/ is a clone of its own: a worktree's .git is a file, and a plain folder has none.
  const ownClone = () =>
    fs.lstat(path.join(read, ".git")).then(
      (s) => s.isDirectory(),
      () => false,
    );
  const defaultBranch = async () => {
    const remote = await run(repo, ["ls-remote", "--symref", "origin", "HEAD"]);
    const named = remote.code === 0 ? /^ref: refs\/heads\/(\S+)\s+HEAD$/m.exec(remote.stdout)?.[1] : undefined;
    if (named) return named;
    const local = await run(repo, ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"]);
    if (local.code === 0 && local.stdout.trim().startsWith("origin/")) return local.stdout.trim().slice("origin/".length);
    throw new Error(`couldn't find origin's default branch in ${repo}: ${(remote.stderr || local.stderr).trim()}`);
  };
  const tracking = () => `refs/remotes/origin/${branch}`;
  const originTip = () => must(read, ["rev-parse", "--verify", `${tracking()}^{commit}`]);
  const fetchOrigin = async () => {
    fetchedAt = now();
    // An explicit refspec, so the tracking ref moves even when origin's default branch isn't the one cloned.
    const r = await run(read, ["fetch", "--no-tags", "origin", `+refs/heads/${branch}:${tracking()}`]);
    if (r.code !== 0) {
      const why = `${r.timedOut ? "git took too long" : "git failed"}: ${r.stderr.trim()}`;
      log(`couldn't fetch origin ${branch} for expert ${name}, so it answers from its checkout as it is (${why})`);
      onFetchFailed?.(why);
    }
    return r.code === 0;
  };
  const head = () => must(read, ["rev-parse", "HEAD"]);

  return {
    async prepare() {
      const url = await must(repo, ["remote", "get-url", "origin"]);
      if (!cloneFrom(url)) throw new Error(`${repo}'s origin, ${url}, isn't an https, ssh or host:path remote, so expert ${name} wasn't cloned from it: an expert never clones from a local path, a file:// URL or a \\\\server share`);
      branch = await defaultBranch();
      const st = await fs.lstat(read).catch(() => null);
      if (!st || (st.isDirectory() && (await fs.readdir(read)).length === 0)) {
        // Made in read.new and moved into place once checked out, so a clone cut short (by
        // gitTimeoutSeconds, say) never leaves a read/ that looks like a clone of its own.
        await fs.mkdir(dir, { recursive: true });
        await fs.rm(staging, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
        // Borrowed from the repo's own .git folder: git won't borrow from a linked worktree (Orca's, say).
        const common = await run(repo, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
        const reference = common.code === 0 && common.stdout.trim() ? common.stdout.trim() : repo;
        await must(dir, ["clone", "-q", "--no-checkout", "--reference-if-able", reference, "--dissociate", "--single-branch", "--branch", branch, "--no-tags", "--", url, staging], NO_LFS);
        await must(staging, ["checkout", "-q", "--detach", tracking()], NO_LFS);
        if (st) await fs.rmdir(read);
        await renamed(staging, read);
        fetchedAt = now();
        return { branch, commit: await head() };
      }
      if (!st.isDirectory() || !(await ownClone())) {
        throw new Error(`${read} is there already and isn't a clone of its own (a worktree of ${repo} from an earlier Isoplan, say), so it was left as it is. Remove it (a worktree with \`git worktree remove --force ${read}\` in ${repo}), and the expert clones it again for its next question or at the runner's next start`);
      }
      await must(read, ["remote", "set-url", "origin", url]);
      if (!(await fetchOrigin())) await originTip(); // no fetch, but a branch fetched before: carry on
      return { branch, commit: await head() };
    },
    async fetch() {
      if (fetchedAt === null || now() - fetchedAt >= fetchSeconds() * 1000) await fetchOrigin();
      const tip = await run(read, ["rev-parse", "--verify", `${tracking()}^{commit}`]);
      if (tip.code !== 0) return null;
      const commit = tip.stdout.trim();
      return commit === (await head()) ? null : commit;
    },
    async move(commit) {
      await must(read, ["checkout", "-q", "--detach", "--force", commit], NO_LFS);
    },
    head,
    async dirty() {
      const r = await run(read, ["status", "--porcelain"]);
      return r.code !== 0 || r.stdout.trim() !== "";
    },
    async reset() {
      await must(read, ["reset", "-q", "--hard", "HEAD"], NO_LFS);
      await must(read, ["clean", "-fd"]);
    },
    async changed(index) {
      const byCommit = new Map<string, string[]>();
      for (const [file, commit] of Object.entries(index)) byCommit.set(commit, [...(byCommit.get(commit) ?? []), file]);
      const out = new Set<string>();
      for (const [commit, files] of byCommit) {
        const r = await run(read, ["diff", "--name-only", `${commit}..HEAD`]);
        const names = new Set(r.code === 0 ? r.stdout.split(/\r?\n/).filter(Boolean) : files);
        for (const file of files) if (names.has(file)) out.add(file);
      }
      return out;
    },
    async remove() {
      if (!(await ownClone())) {
        if (await fs.lstat(read).then(() => true, () => false)) log(`left ${read} as it is: it isn't expert ${name}'s own clone`);
        return;
      }
      // fs.promises.rm, since rmSync ignores maxRetries (Node 24): Windows holds a folder a moment after a process in it ends.
      await fs.rm(read, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
      log(`removed expert ${name}'s clone of ${repo}`);
    },
    async list(folder) {
      const entries = await fs.readdir(path.join(read, ...folder.split("/")), { withFileTypes: true }).catch(() => []);
      return entries
        .filter((e) => e.isFile())
        .map((e) => e.name)
        .sort();
    },
    async read(file, max) {
      // Through a link only to a file still in the read checkout: never a host file outside it.
      const real = await fs.realpath(path.join(read, ...file.split("/"))).catch(() => null);
      if (real === null || inside(await fs.realpath(read), real) === null) return null;
      const text = await fs.readFile(real, "utf8").catch(() => null);
      return text === null ? null : text.slice(0, max);
    },
    has: (file) =>
      fs.stat(path.join(read, ...file.split("/"))).then(
        (s) => s.isFile(),
        () => false,
      ),
  };
}
