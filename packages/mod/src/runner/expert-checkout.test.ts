import fs from "node:fs";
import path from "node:path";
import { expect, test } from "vitest";
import { tempRoot } from "../data-layer/fixture.js";
import type { GitResult, RunGit } from "../handoff/git.js";
import { createExpertCheckout, noteSlug } from "./expert-checkout.js";

const MAIN = "1".repeat(40);
const MOVED = "2".repeat(40);
const OLD = "3".repeat(40);
const ok = (stdout = ""): GitResult => ({ code: 0, stdout, stderr: "", timedOut: false });
const failed = (stderr = "fatal"): GitResult => ({ code: 128, stdout: "", stderr, timedOut: false });

/**
 * A stand-in for git: it records every call (without the no-hooks prefix, which it checks), and
 * answers by `answer`, falling back to success with nothing said.
 */
function fakeGit(answer: (args: string[]) => GitResult | undefined | Promise<GitResult | undefined> = () => undefined) {
  const calls: string[][] = [];
  const cwds = new Set<string>();
  const git: RunGit = async (argv, { cwd }) => {
    expect(argv[0]).toBe("-c");
    expect(argv[1]).toMatch(/^core\.hooksPath=/);
    const args = argv.slice(2);
    calls.push(args);
    cwds.add(cwd);
    return (await answer(args)) ?? ok();
  };
  return { git, calls, cwds };
}

function setUp(answer?: Parameters<typeof fakeGit>[0], o: { fetchSeconds?: number; now?: () => number } = {}) {
  const root = tempRoot();
  const repo = path.join(root, "app");
  const dir = path.join(root, "experts", "adr");
  const read = path.join(dir, "read");
  const notes = path.join(dir, "notes");
  const g = fakeGit(answer);
  const logged: string[] = [];
  const checkout = createExpertCheckout({ git: g.git, repo, dir, name: "adr", timeoutMs: 1000, log: (t) => void logged.push(t), fetchSeconds: () => o.fetchSeconds ?? 60, ...(o.now && { now: o.now }) });
  return { ...g, checkout, repo, dir, read, notes, logged };
}

test("prepare: origin's default branch, a fetch of it, and the read checkout detached at it; all from the repo, without hooks", async () => {
  const t = setUp((args) => {
    if (args[0] === "ls-remote") return ok(`ref: refs/heads/trunk\tHEAD\n${MAIN}\tHEAD\n`);
    if (args.includes("--show-toplevel")) return failed("not a git repository");
    if (args.at(-1) === "HEAD") return ok(MAIN + "\n");
  });
  expect(await t.checkout.prepare()).toEqual({ branch: "trunk", commit: MAIN });
  expect(t.calls).toEqual([
    ["ls-remote", "--symref", "origin", "HEAD"],
    ["fetch", "--no-tags", "origin", "trunk"],
    ["-C", t.read, "rev-parse", "--show-toplevel"],
    ["worktree", "prune"],
    ["worktree", "add", "--detach", t.read, "origin/trunk"],
    ["-C", t.read, "rev-parse", "HEAD"],
  ]);
  expect([...t.cwds]).toEqual([t.repo]);
});

test("prepare: with origin unreachable, the default branch from origin/HEAD and a read checkout already there kept", async () => {
  const t = setUp((args) => {
    if (args[0] === "ls-remote" || args[0] === "fetch") return failed("could not read from remote");
    if (args[0] === "symbolic-ref") return ok("origin/main\n");
    if (args.includes("--show-toplevel")) return ok(t.read.replace(/\\/g, "/") + "\n");
    if (args.at(-1) === "HEAD" || args.at(-1)?.startsWith("refs/remotes/")) return ok(OLD);
  });
  expect(await t.checkout.prepare()).toEqual({ branch: "main", commit: OLD });
  expect(t.calls.some((c) => c[0] === "worktree")).toBe(false);
  expect(t.logged).toEqual([expect.stringMatching(/^couldn't fetch origin main for expert adr, so it answers from its checkout as it is/)]);
});

test("fetch: at most every fetchSeconds; origin's commit when it is ahead of the read checkout, else null", async () => {
  let now = 0;
  let tip = MAIN;
  const t = setUp(
    (args) => {
      if (args[0] === "ls-remote") return ok(`ref: refs/heads/main\tHEAD\n`);
      if (args.includes("--show-toplevel")) return ok(t.read);
      if (args.at(-1)?.startsWith("refs/remotes/origin/main")) return ok(tip);
      if (args.at(-1) === "HEAD") return ok(MAIN);
    },
    { now: () => now },
  );
  await t.checkout.prepare();
  const fetches = () => t.calls.filter((c) => c[0] === "fetch").length;
  expect(await t.checkout.fetch()).toBe(null);
  expect(fetches()).toBe(1);
  // Moved, but fetched less than a minute ago: the tip already fetched is compared, with no fetch.
  tip = MOVED;
  now = 59000;
  expect(await t.checkout.fetch()).toBe(MOVED);
  expect(fetches()).toBe(1);
  now = 60000;
  await t.checkout.fetch();
  expect(fetches()).toBe(2);
});

test("move, head, dirty and reset run in the read checkout", async () => {
  const t = setUp((args) => (args.includes("--porcelain") ? ok(" M a.ts\n") : undefined));
  await t.checkout.move(MOVED);
  expect(await t.checkout.dirty()).toBe(true);
  await t.checkout.reset();
  expect(t.calls).toEqual([
    ["-C", t.read, "checkout", "--detach", "--force", MOVED],
    ["-C", t.read, "status", "--porcelain"],
    ["-C", t.read, "reset", "--hard", "HEAD"],
    ["-C", t.read, "clean", "-fd"],
  ]);
});

test("changed: one diff per distinct commit with no pathspec, intersected with that commit's files; a commit git doesn't know counts all of its files", async () => {
  const t = setUp((args) => {
    if (args.at(-1) === `${MAIN}..HEAD`) return ok("a.ts\nunrelated.ts\n");
    if (args.at(-1) === `${OLD}..HEAD`) return failed("bad revision");
  });
  const changed = await t.checkout.changed({ "a.ts": MAIN, "b.ts": MAIN, "c.ts": OLD });
  expect([...changed].sort()).toEqual(["a.ts", "c.ts"]);
  expect(t.calls).toEqual([
    ["-C", t.read, "diff", "--name-only", `${MAIN}..HEAD`],
    ["-C", t.read, "diff", "--name-only", `${OLD}..HEAD`],
  ]);
});

test("pattern notes: committed one at a time on the notes branch, never pushed; one whose name exists is skipped", async () => {
  let release = () => {};
  const slow = new Promise<void>((r) => (release = r));
  const t = setUp(async (args) => {
    if (args[0] === "ls-remote") return ok(`ref: refs/heads/main\tHEAD\n`);
    if (args.includes("--show-toplevel")) return args[1] === t.notes && !fs.existsSync(t.notes) ? failed() : ok(args[1]);
    if (args.join(" ") === `worktree add --no-track -b expert/adr/notes ${t.notes} origin/main`) fs.mkdirSync(t.notes, { recursive: true });
    if (args.includes("add") && args.at(-1) === "docs/patterns/first-rule.md") await slow;
    if (args.at(-1) === "HEAD") return ok(MAIN);
    if (args[1] === "--verify" && args[2] === "-q") return failed(); // no notes branch yet
  });
  await t.checkout.prepare();
  t.calls.length = 0;
  const first = t.checkout.commitNote(noteSlug("First rule!"), "First rule!", "Because.", "x-0000000001");
  const second = t.checkout.commitNote(noteSlug("Second rule"), "Second rule", "Also because.", "x-0000000002");
  await new Promise((r) => setTimeout(r, 20));
  expect(t.calls.some((c) => c.at(-1) === "docs/patterns/second-rule.md")).toBe(false);
  release();
  expect(await Promise.all([first, second])).toEqual([true, true]);
  const writes = t.calls.filter((c) => c[0] === "-C" && c[1] === t.notes && !c.includes("--show-toplevel"));
  expect(writes).toEqual([
    ["-C", t.notes, "add", "--", "docs/patterns/first-rule.md"],
    ["-C", t.notes, "-c", "commit.gpgsign=false", "commit", "-q", "-m", "Pattern note from expert adr (question x-0000000001)", "--", "docs/patterns/first-rule.md"],
    ["-C", t.notes, "add", "--", "docs/patterns/second-rule.md"],
    ["-C", t.notes, "-c", "commit.gpgsign=false", "commit", "-q", "-m", "Pattern note from expert adr (question x-0000000002)", "--", "docs/patterns/second-rule.md"],
  ]);
  // With no upstream, so a push from it can't land on origin's default branch.
  expect(t.calls).toContainEqual(["worktree", "add", "--no-track", "-b", "expert/adr/notes", t.notes, "origin/main"]);
  expect(fs.readFileSync(path.join(t.notes, "docs", "patterns", "first-rule.md"), "utf8")).toBe("# First rule!\n\nBecause.\n");
  expect(await t.checkout.commitNote("first-rule", "First rule", "Again.", "x-0000000003")).toBe(false);
  expect(t.logged).toContainEqual(expect.stringMatching(/docs\/patterns\/first-rule\.md is there already/));
  expect(t.calls.flat()).not.toContain("push");
  expect(noteSlug("  A repo the office doesn't take sends nothing.  ")).toBe("a-repo-the-office-doesn-t-take-sends-nothing");
  expect(noteSlug("x".repeat(100))).toHaveLength(80);
});

test("remove: the read worktree, then the notes worktree, then prune, from the old repo; the notes branch kept", async () => {
  const t = setUp();
  await t.checkout.remove();
  expect(t.calls).toEqual([
    ["worktree", "remove", "--force", t.read],
    ["worktree", "remove", "--force", t.notes],
    ["worktree", "prune"],
  ]);
  expect(t.logged).toEqual([expect.stringMatching(/its branch expert\/adr\/notes is kept there$/)]);
});

test("list and read: names in the read checkout's folders, and a file cut to its limit", async () => {
  const t = setUp();
  fs.mkdirSync(path.join(t.read, "docs", "adr", "drafts"), { recursive: true });
  fs.writeFileSync(path.join(t.read, "docs", "adr", "0004-what-leaves-a-machine.md"), "");
  fs.writeFileSync(path.join(t.read, "docs", "adr", "0001-record.md"), "");
  fs.writeFileSync(path.join(t.read, "CONTEXT.md"), "abcdef");
  expect(await t.checkout.list("docs/adr")).toEqual(["0001-record.md", "0004-what-leaves-a-machine.md"]);
  expect(await t.checkout.list("docs/patterns")).toEqual([]);
  expect(await t.checkout.read("CONTEXT.md", 4)).toBe("abcd");
  expect(await t.checkout.read("CLAUDE.md", 4)).toBe(null);
});

// A link the repo committed (a junction on Windows, which needs no privilege) to a folder outside.
const linkOut = (from: string) => {
  const outside = path.join(tempRoot(), "outside");
  fs.mkdirSync(outside, { recursive: true });
  fs.mkdirSync(path.dirname(from), { recursive: true });
  fs.symlinkSync(outside, from, "junction");
  return outside;
};

test("read: never through a link to a file outside the read checkout", async () => {
  const t = setUp();
  const outside = linkOut(path.join(t.read, "docs"));
  fs.writeFileSync(path.join(outside, "CLAUDE.md"), "a host file");
  expect(await t.checkout.read("docs/CLAUDE.md", 100)).toBe(null);
});

test("pattern notes: never written through a docs/patterns that links out of the notes worktree", async () => {
  const t = setUp((args) => {
    if (args.includes("--show-toplevel")) return ok(args[1]);
  });
  const outside = linkOut(path.join(t.notes, "docs", "patterns"));
  expect(await t.checkout.commitNote("a-rule", "A rule", "Because.", "x-0000000001")).toBe(false);
  expect(fs.readdirSync(outside)).toEqual([]);
  expect(t.calls.some((c) => c.includes("commit"))).toBe(false);
  expect(t.logged).toEqual([expect.stringMatching(/docs[\\/]patterns in its notes worktree isn't a plain folder$/)]);
});
