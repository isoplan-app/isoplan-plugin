// Writing the file of who was contacted (isoplan-app#341, who-was-contacted.ts) from the employee's
// own writable clone of its project, employees/<key>/who-was-contacted/, which only this writer
// touches, so it resets it freely. Never the clone its runs read (expert-checkout.ts), nor Isoplan's
// clone for hidden starts, which is never reset (isoplan-clone.ts).
//
// - Made by #315's recipe (isoplan-clone.ts): from the origin of this computer's checkout (the job
//   file's `repo`), borrowing its objects (--reference-if-able, then --dissociate, or borrowing
//   nothing when that fails); else from the project's addresses (cloneUrls) in order; never from a
//   local path, a file:// URL or a share; built in `.new` and renamed in; long paths on Windows;
//   through RunGit, so git asks nothing, with this person's own git access, credentials and identity,
//   and with no hooks of the repo's.
// - Each change goes first in who-was-contacted-changes-waiting.json, once per prospect, change and
//   draft. A write: fetch origin's default branch, reset to it, apply every waiting change to the
//   newest file (who-was-contacted.ts decides which claims another sender's row now covers), commit
//   with a message naming counts only, unsigned (`-c commit.gpgSign=false commit --no-gpg-sign`, as
//   handoff/git.ts commits, so no signing program opens a window), and push to the default branch.
//   "Nothing to commit" (the changes were there already, as after a crash) counts as pushed.
// - A push rejected because origin moved on is never rebased: the clone is reset to the newest origin
//   and the changes applied again, up to `tries` times, 2, 4, 8, 16 seconds apart. A refusal by the
//   remote (a protected branch, required signatures or reviews, a hook that declined) is told apart
//   from not reaching it (`refused`), and isn't tried again until the next run's start. Changes not
//   pushed wait, and go with the next write; `problem()` says why meanwhile.
// - One write or fetch at a time.

import fs from "node:fs/promises";
import path from "node:path";
import type { GitResult, RunGit } from "../handoff/git.js";
import { noHooks, onTheWire } from "../handoff/take.js";
import { borrowFrom, cloneBorrowing, longPaths, renamed } from "./expert-checkout.js";
import { readJson, writeJson } from "./expert-state.js";
import { cloneUrls } from "./project-checkout-for-expert.js";
import { applyChanges, commitMessage, emptyTable, lookUp, parseTable, tableText, type Applied, type Row, type Sender, type Table, type WhoWasContactedChange } from "./who-was-contacted.js";

export interface WhoWasContactedWriterOptions {
  git: RunGit;
  /** The employee's folder, employees/<key>: its clone and its waiting changes. */
  dir: string;
  /** This computer's checkout of the project, borrowed from; null when there is none. */
  repo: () => string | null;
  /** The project's id, for its addresses where there is no checkout. */
  project: () => string;
  /** The file's path in the project. */
  file: () => string;
  me: () => Sender;
  /** The employee's name as people read it, for the commit message. */
  employeeName: () => string;
  timeoutMs: () => Promise<number>;
  log: (text: string) => void;
  /** How many writes a push rejected for being behind is tried in all. */
  tries: () => Promise<number>;
  /** The wait before try `n` again (1, 2, …). */
  delayMs?: (n: number) => number;
  cloneFrom?: (remote: string) => boolean;
  platform?: NodeJS.Platform;
}

export type WriteResult =
  | { pushed: true; someoneElseHad: string[]; contactedTwice: Applied["contactedTwice"] }
  | { pushed: false; detail: string; refused?: true };

export interface WhoWasContactedWriter {
  /** The newest file, fetched now into memory; why not when it couldn't be. */
  fetch(): Promise<{ ok: true } | { ok: false; detail: string }>;
  /** What the file says of a prospect: as last fetched, with the changes waiting here. */
  lookUp(address: string): { mine: Row | null; others: Row[] };
  /** Kept in the waiting file before anything else; once per prospect, change and draft. */
  add(changes: readonly WhoWasContactedChange[]): Promise<void>;
  /** Pushes what waits; `runStart` tries a remote that refused before. `alreadySent`: drafts whose claims are made whatever the file says now. */
  write(o?: { runStart?: boolean; alreadySent?: ReadonlySet<string> }): Promise<WriteResult>;
  /** Why the last write didn't push, until one does. */
  problem(): { detail: string; refused?: true } | null;
  waiting(): readonly WhoWasContactedChange[];
  /** Reads the waiting changes; settles before anything else is asked. */
  load(): Promise<void>;
  /** Deletes the clone and the waiting file. */
  remove(): Promise<void>;
}

const REFUSED = /remote rejected|protected branch|GH006|GH013|declined|pre-receive hook|signed|signature|review/i;
const BEHIND = /\[rejected\]|non-fast-forward|fetch first|stale info|updates were rejected/i;

export function createWhoWasContactedWriter(o: WhoWasContactedWriterOptions): WhoWasContactedWriter {
  const clone = path.join(o.dir, "who-was-contacted");
  const waitingFile = path.join(o.dir, "who-was-contacted-changes-waiting.json");
  const delayMs = o.delayMs ?? ((n: number) => 2000 * 2 ** (n - 1));
  const platform = o.platform ?? process.platform;
  let changes: WhoWasContactedChange[] = [];
  let table: Table = emptyTable();
  let branch: string | null = null;
  let problem: { detail: string; refused?: true } | null = null;
  let chain: Promise<unknown> = Promise.resolve();

  const run = async (cwd: string, args: string[]) => o.git([...(await noHooks()), ...args], { cwd, timeoutMs: await o.timeoutMs() });
  const why = (r: GitResult) => `${r.timedOut ? "git took too long" : "git failed"}: ${r.stderr.trim() || r.stdout.trim()}`;
  const one = <T>(work: () => Promise<T>): Promise<T> => {
    const next = chain.then(work, work);
    chain = next.catch(() => {});
    return next;
  };
  const saveWaiting = () => writeJson(waitingFile, { version: 1, changes });

  // The clone, made once by #315's recipe; its default branch, from origin's HEAD.
  async function ensure(): Promise<string | null> {
    const there = await fs.stat(path.join(clone, ".git")).then((s) => s.isDirectory(), () => false);
    if (!there) {
      const reasons: string[] = [];
      const repo = o.repo();
      const fromRepo = repo ? await run(repo, ["remote", "get-url", "origin"]) : null;
      const urls = [...(fromRepo?.code === 0 ? [fromRepo.stdout.trim()] : []), ...cloneUrls(o.project())].filter((u, i, all) => u && all.indexOf(u) === i);
      const staging = `${clone}.new`;
      const clean = () => fs.rm(staging, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
      const long = longPaths(platform);
      await fs.mkdir(o.dir, { recursive: true });
      let made = false;
      for (const url of urls) {
        if (!(o.cloneFrom ?? onTheWire)(url)) {
          reasons.push(`${url} isn't an https or ssh address`);
          continue;
        }
        await clean();
        const cloneWith = (borrow: string[]) => run(o.dir, [...long.git, "clone", "-q", ...long.clone, ...borrow, "--", url, staging]);
        const r = repo && url === fromRepo?.stdout.trim() ? await cloneBorrowing(cloneWith, await borrowFrom(run, repo), clean) : await cloneWith([]);
        if (r.code === 0) {
          made = true;
          break;
        }
        reasons.push(`from ${url}, ${why(r)}`);
      }
      if (!made) {
        await clean().catch(() => {});
        return `the clone it writes the file of who was contacted from couldn't be made: ${reasons.join("; ") || "its project has no address to clone"}`;
      }
      await renamed(staging, clone);
      o.log(`made the clone it writes the file of who was contacted from, in ${clone}`);
    }
    if (!branch) {
      const head = await run(clone, ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"]);
      branch = head.code === 0 && head.stdout.trim().startsWith("origin/") ? head.stdout.trim().slice("origin/".length) : "main";
    }
    return null;
  }

  async function fetchNow(): Promise<{ ok: true } | { ok: false; detail: string }> {
    const failed = await ensure();
    if (failed) return { ok: false, detail: failed };
    const fetched = await run(clone, ["fetch", "-q", "origin", `+refs/heads/${branch}:refs/remotes/origin/${branch}`]);
    if (fetched.code !== 0) return { ok: false, detail: `couldn't fetch ${branch}: ${why(fetched)}` };
    const reset = await run(clone, ["reset", "-q", "--hard", `refs/remotes/origin/${branch}`]);
    if (reset.code !== 0) return { ok: false, detail: `couldn't reset to ${branch}: ${why(reset)}` };
    table = parseTable(await fs.readFile(path.join(clone, o.file()), "utf8").catch(() => null));
    return { ok: true };
  }

  async function writeNow(runStart: boolean, alreadySent: ReadonlySet<string>): Promise<WriteResult> {
    if (problem?.refused && !runStart) return { pushed: false, ...problem };
    const tries = Math.max(1, await o.tries());
    for (let attempt = 1; ; attempt++) {
      const fetched = await fetchNow();
      if (!fetched.ok) return said({ pushed: false, detail: fetched.detail });
      if (!changes.length) return said({ pushed: true, someoneElseHad: [], contactedTwice: [] });
      const taking = [...changes];
      const applied = applyChanges(table, taking, o.me(), alreadySent);
      const file = path.join(clone, o.file());
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, tableText(applied.table));
      const added = await run(clone, ["add", "--", o.file()]);
      if (added.code !== 0) return said({ pushed: false, detail: `couldn't stage the file: ${why(added)}` });
      const message = commitMessage(o.me().sender, o.employeeName(), applied.counts);
      const committed = await run(clone, ["-c", "commit.gpgSign=false", "commit", "-q", "--no-gpg-sign", "-m", message]);
      const nothing = committed.code !== 0 && /nothing to commit|nothing added to commit/i.test(committed.stdout + committed.stderr);
      if (committed.code !== 0 && !nothing) return said({ pushed: false, detail: `couldn't commit: ${why(committed)}` });
      const pushed = nothing ? { code: 0, stdout: "", stderr: "", timedOut: false } : await run(clone, ["push", "-q", "origin", `HEAD:refs/heads/${branch}`]);
      if (pushed.code === 0) {
        table = applied.table;
        changes = changes.filter((c) => !taking.includes(c));
        await saveWaiting();
        return said({ pushed: true, someoneElseHad: applied.someoneElseHad, contactedTwice: applied.contactedTwice });
      }
      const words = pushed.stderr.trim() || pushed.stdout.trim();
      if (REFUSED.test(words) && !/fetch first|non-fast-forward/i.test(words)) return said({ pushed: false, detail: `the remote's ${branch} refuses Isoplan's pushes: ${words}`, refused: true });
      if (!BEHIND.test(words) || attempt >= tries) return said({ pushed: false, detail: BEHIND.test(words) ? `the remote kept moving on: ${words}` : `couldn't reach the remote: ${why(pushed)}` });
      o.log(`the push of who was contacted was behind its remote, so it is applied again to the newest file (try ${attempt + 1} of ${tries})`);
      await new Promise((r) => setTimeout(r, delayMs(attempt)));
    }
  }

  function said(r: WriteResult): WriteResult {
    problem = r.pushed ? null : { detail: r.detail, ...(r.refused && { refused: true as const }) };
    if (!r.pushed) o.log(`the file of who was contacted wasn't written: ${r.detail}`);
    return r;
  }

  return {
    fetch: () => one(fetchNow),
    lookUp(address) {
      const view = applyChanges(table, changes, o.me()).table;
      return lookUp(view, address, o.me());
    },
    async add(more) {
      for (const c of more) if (!changes.some((x) => x.op === c.op && x.prospect === c.prospect && x.draft === c.draft)) changes.push(c);
      await saveWaiting();
    },
    write: (w = {}) => one(() => writeNow(w.runStart === true, w.alreadySent ?? new Set())),
    problem: () => problem,
    waiting: () => changes,
    async load() {
      const read = (await readJson(waitingFile)) as { version?: unknown; changes?: unknown } | null;
      if (read?.version === 1 && Array.isArray(read.changes)) changes = read.changes as WhoWasContactedChange[];
      // A git a runner that stopped was running in the clone leaves its lock behind; only this writer
      // works here, and only one runner runs, so it is stale.
      await fs.rm(path.join(clone, ".git", "index.lock"), { force: true }).catch(() => {});
    },
    async remove() {
      await one(async () => {
        await fs.rm(clone, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
        await fs.rm(waitingFile, { force: true });
      });
    },
  };
}
