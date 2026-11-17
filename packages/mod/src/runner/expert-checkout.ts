// An expert's two checkouts of its repo, never anyone's working tree:
//
// - read/, a worktree detached at origin's default branch. Every trunk and fork runs in it, and its
//   folder never moves, since forks resume a trunk by its folder's path. It is moved to a newer
//   commit only under the checkout lock's exclusive hold (expert-lock.ts), and reset if a fork ever
//   changed it.
// - notes/, a worktree on branch expert/<name>/notes, where the runner commits pattern notes for a
//   person to review and merge. It is never pushed: no git call here pushes anything.
//
// Every git call goes through RunGit (hidden, no prompt, under gitTimeoutSeconds), without the
// repo's hooks (noHooks), from the repo's own folder, with `-C` for the two worktrees. A pattern
// note is also committed without signing, which could ask for a passphrase. Which files changed
// since a commit is asked once per distinct commit with no pathspec, since a list of paths could
// pass Windows' command-line limit, and intersected in memory.

import fs from "node:fs/promises";
import path from "node:path";
import type { RunGit } from "../handoff/git.js";
import { noHooks } from "../handoff/take.js";
import { inside } from "./expert-claude.js";

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
}

export interface ExpertCheckout {
  /** Finds origin's default branch, fetches it, and makes the read checkout if it isn't there; its branch and HEAD. */
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
  /** Makes the notes worktree if it isn't there; its folder. */
  notes(): Promise<string>;
  /** Commits docs/patterns/<slug>.md on the notes branch; false when skipped (the slug exists, or there is none) or failed, logged. One at a time. */
  commitNote(slug: string, title: string, body: string, questionId: string): Promise<boolean>;
  /** Removes both worktrees from the repo, keeping the notes branch: for a change of repo. */
  remove(): Promise<void>;
  /** The file names in one of the read checkout's folders, sorted; none when it isn't there. */
  list(dir: "docs/adr" | "docs/patterns"): Promise<string[]>;
  /** A file of the read checkout, cut to `max` characters; null when it isn't there. */
  read(file: string, max: number): Promise<string | null>;
  /** Whether a repo-relative file is in the read checkout: at its HEAD, since no fork may change it. */
  has(file: string): Promise<boolean>;
}

/** A pattern note's file name: its title in lowercase letters, digits and dashes, at most 80. */
export const noteSlug = (title: string) =>
  title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, 80)
    .replace(/^-+|-+$/g, "");

export const notesBranch = (name: string) => `expert/${name}/notes`;

export function createExpertCheckout({ git, repo, dir, name, timeoutMs, log, fetchSeconds = () => 60, now = Date.now, onFetchFailed }: ExpertCheckoutOptions): ExpertCheckout {
  const read = path.join(dir, "read");
  const notesDir = path.join(dir, "notes");
  const branchName = notesBranch(name);
  let branch: string | null = null;
  let fetchedAt: number | null = null;
  let noting: Promise<unknown> = Promise.resolve();

  const run = async (args: string[]) => git([...(await noHooks()), ...args], { cwd: repo, timeoutMs: typeof timeoutMs === "number" ? timeoutMs : await timeoutMs() });
  const must = async (args: string[]) => {
    const r = await run(args);
    if (r.code !== 0) throw new Error(`git ${args.join(" ")} failed${r.timedOut ? " (it took too long)" : ""}: ${r.stderr.trim()}`);
    return r.stdout.trim();
  };
  // Whether a folder is a worktree of its own (not a folder inside the repo's own tree).
  const isWorktree = async (folder: string) => {
    const r = await run(["-C", folder, "rev-parse", "--show-toplevel"]);
    return r.code === 0 && inside(folder, r.stdout.trim()) === "";
  };
  const defaultBranch = async () => {
    const remote = await run(["ls-remote", "--symref", "origin", "HEAD"]);
    const named = remote.code === 0 ? /^ref: refs\/heads\/(\S+)\s+HEAD$/m.exec(remote.stdout)?.[1] : undefined;
    if (named) return named;
    const local = await run(["symbolic-ref", "--short", "refs/remotes/origin/HEAD"]);
    if (local.code === 0 && local.stdout.trim().startsWith("origin/")) return local.stdout.trim().slice("origin/".length);
    throw new Error(`couldn't find origin's default branch in ${repo}: ${(remote.stderr || local.stderr).trim()}`);
  };
  const originTip = () => must(["rev-parse", "--verify", `refs/remotes/origin/${branch}^{commit}`]);
  const fetchOrigin = async () => {
    fetchedAt = now();
    const r = await run(["fetch", "--no-tags", "origin", branch!]);
    if (r.code !== 0) {
      const why = `${r.timedOut ? "git took too long" : "git failed"}: ${r.stderr.trim()}`;
      log(`couldn't fetch origin ${branch} for expert ${name}, so it answers from its checkout as it is (${why})`);
      onFetchFailed?.(why);
    }
    return r.code === 0;
  };
  const head = () => must(["-C", read, "rev-parse", "HEAD"]);
  const notes = async () => {
    if (await isWorktree(notesDir)) return notesDir;
    await must(["worktree", "prune"]);
    const exists = (await run(["rev-parse", "--verify", "-q", `refs/heads/${branchName}`])).code === 0;
    // No upstream: a push from the notes worktree (an IDE's sync) must not go to origin's default branch.
    await must(exists ? ["worktree", "add", notesDir, branchName] : ["worktree", "add", "--no-track", "-b", branchName, notesDir, `origin/${branch}`]);
    return notesDir;
  };

  return {
    async prepare() {
      branch = await defaultBranch();
      if (!(await fetchOrigin())) await originTip(); // no fetch, but a branch fetched before: carry on
      if (!(await isWorktree(read))) {
        await must(["worktree", "prune"]);
        await must(["worktree", "add", "--detach", read, `origin/${branch}`]);
      }
      return { branch, commit: await head() };
    },
    async fetch() {
      if (fetchedAt === null || now() - fetchedAt >= fetchSeconds() * 1000) await fetchOrigin();
      const tip = await run(["rev-parse", "--verify", `refs/remotes/origin/${branch}^{commit}`]);
      if (tip.code !== 0) return null;
      const commit = tip.stdout.trim();
      return commit === (await head()) ? null : commit;
    },
    async move(commit) {
      await must(["-C", read, "checkout", "--detach", "--force", commit]);
    },
    head,
    async dirty() {
      const r = await run(["-C", read, "status", "--porcelain"]);
      return r.code !== 0 || r.stdout.trim() !== "";
    },
    async reset() {
      await must(["-C", read, "reset", "--hard", "HEAD"]);
      await must(["-C", read, "clean", "-fd"]);
    },
    async changed(index) {
      const byCommit = new Map<string, string[]>();
      for (const [file, commit] of Object.entries(index)) byCommit.set(commit, [...(byCommit.get(commit) ?? []), file]);
      const out = new Set<string>();
      for (const [commit, files] of byCommit) {
        const r = await run(["-C", read, "diff", "--name-only", `${commit}..HEAD`]);
        const names = new Set(r.code === 0 ? r.stdout.split(/\r?\n/).filter(Boolean) : files);
        for (const file of files) if (names.has(file)) out.add(file);
      }
      return out;
    },
    notes,
    commitNote(slug, title, body, questionId) {
      const commit = async () => {
        if (!slug) {
          log(`expert ${name}'s pattern note "${title}" has no name to file it under, so it was skipped`);
          return false;
        }
        const relative = `docs/patterns/${slug}.md`;
        const root = await notes();
        const folder = path.join(root, "docs", "patterns");
        const file = path.join(folder, `${slug}.md`);
        // The repo decides what docs/ and docs/patterns are: a link out of the worktree is never followed.
        for (const f of [path.join(root, "docs"), folder]) {
          const s = await fs.lstat(f).catch(() => null);
          if (s && (s.isSymbolicLink() || !s.isDirectory())) {
            log(`expert ${name}'s pattern note was skipped: ${path.relative(root, f)} in its notes worktree isn't a plain folder`);
            return false;
          }
        }
        await fs.mkdir(folder, { recursive: true });
        if (inside(await fs.realpath(root), await fs.realpath(folder)) === null) {
          log(`expert ${name}'s pattern note was skipped: docs/patterns is outside its notes worktree`);
          return false;
        }
        // "wx": a file there already, or a link in its place, is never written through.
        const wrote = await fs.writeFile(file, `# ${title}\n\n${body}\n`, { flag: "wx" }).then(
          () => true,
          (err: NodeJS.ErrnoException) => {
            if (err.code !== "EEXIST") throw err;
            return false;
          },
        );
        if (!wrote) {
          log(`expert ${name}'s pattern note ${relative} is there already, so it was skipped`);
          return false;
        }
        await must(["-C", notesDir, "add", "--", relative]);
        await must(["-C", notesDir, "-c", "commit.gpgsign=false", "commit", "-q", "-m", `Pattern note from expert ${name} (question ${questionId})`, "--", relative]);
        return true;
      };
      const done = noting.then(commit).catch((err: Error) => {
        log(`couldn't commit expert ${name}'s pattern note: ${err.message}`);
        return false;
      });
      noting = done;
      return done;
    },
    async remove() {
      // Each goes on its own: a worktree never made, or gone already, doesn't keep the other.
      for (const folder of [read, notesDir]) {
        const r = await run(["worktree", "remove", "--force", folder]);
        if (r.code !== 0 && (await fs.stat(folder).then(() => true, () => false))) log(`couldn't remove expert ${name}'s worktree ${folder} from ${repo}: ${r.stderr.trim()}`);
      }
      await run(["worktree", "prune"]);
      log(`removed expert ${name}'s worktrees from ${repo}; its branch ${branchName} is kept there`);
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
