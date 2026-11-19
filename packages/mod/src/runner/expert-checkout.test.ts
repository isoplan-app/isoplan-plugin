import fs from "node:fs";
import path from "node:path";
import { expect, test, vi } from "vitest";
import { tempRoot } from "../data-layer/fixture.js";
import { git as gitIn, remoteAndClone } from "../handoff/fixture.js";
import { createRunGit, type GitResult, type RunGit } from "../handoff/git.js";
import { cloneBorrowing, createExpertCheckout, keepLongPaths } from "./expert-checkout.js";

// The empty folder git runs with as its hooks (handoff/take.ts noHooks) is made in the Claude folder: a temp one, never this machine's.
vi.stubEnv("CLAUDE_CONFIG_DIR", path.join(tempRoot(), "claude"));

const MAIN = "1".repeat(40);
const MOVED = "2".repeat(40);
const OLD = "3".repeat(40);
const URL = "https://github.com/acme/app.git";
const NO_LFS = { GIT_LFS_SKIP_SMUDGE: "1" };
const ok = (stdout = ""): GitResult => ({ code: 0, stdout, stderr: "", timedOut: false });
const failed = (stderr = "fatal"): GitResult => ({ code: 128, stdout: "", stderr, timedOut: false });

interface Call {
  cwd: string;
  args: string[];
  env?: Record<string, string>;
}

/**
 * A stand-in for git: it records every call (without the no-hooks prefix, which it checks), and
 * answers by `answer`, falling back to success with nothing said.
 */
function fakeGit(answer: (args: string[]) => GitResult | undefined | Promise<GitResult | undefined> = () => undefined) {
  const calls: Call[] = [];
  const git: RunGit = async (argv, { cwd, env }) => {
    expect(argv[0]).toBe("-c");
    expect(argv[1]).toMatch(/^core\.hooksPath=/);
    const args = argv.slice(2);
    calls.push({ cwd, args, ...(env && { env }) });
    return (await answer(args)) ?? ok();
  };
  return { git, calls };
}

function setUp(answer?: Parameters<typeof fakeGit>[0], o: { fetchSeconds?: number; now?: () => number } = {}) {
  const root = tempRoot();
  const repo = path.join(root, "app");
  const dir = path.join(root, "experts", "adr");
  const read = path.join(dir, "read");
  const staging = path.join(dir, "read.new");
  const g = fakeGit(answer);
  const logged: string[] = [];
  // Not Windows, where a clone's arguments carry long paths too (tested with real git below).
  const checkout = createExpertCheckout({ git: g.git, repo, dir, name: "adr", timeoutMs: 1000, log: (t) => void logged.push(t), fetchSeconds: () => o.fetchSeconds ?? 60, ...(o.now && { now: o.now }), platform: "linux" });
  return { ...g, checkout, repo, dir, read, staging, logged };
}

// read/ as a clone of its own leaves it: a .git folder.
const makeClone = (read: string) => fs.mkdirSync(path.join(read, ".git"), { recursive: true });

test("prepare: only reads in the person's repo, then clones read/ from origin borrowing its objects, detached at origin's default branch, without hooks or LFS's download", async () => {
  const t = setUp((args) => {
    if (args[0] === "remote") return ok(URL + "\n");
    if (args[0] === "ls-remote") return ok(`ref: refs/heads/trunk\tHEAD\n${MAIN}\tHEAD\n`);
    // The person's repo is a linked worktree: its objects are in the main checkout's .git.
    if (args.at(-1) === "--git-common-dir") return ok(path.join(t.dir, "main", ".git") + "\n");
    if (args[0] === "clone") makeClone(args.at(-1)!);
    if (args.at(-1) === "HEAD") return ok(MAIN + "\n");
  });
  expect(await t.checkout.prepare()).toEqual({ branch: "trunk", commit: MAIN });
  expect(t.calls).toEqual([
    { cwd: t.repo, args: ["remote", "get-url", "origin"] },
    { cwd: t.repo, args: ["ls-remote", "--symref", "origin", "HEAD"] },
    { cwd: t.repo, args: ["rev-parse", "--path-format=absolute", "--git-common-dir"] },
    { cwd: t.dir, args: ["clone", "-q", "--no-checkout", "--reference-if-able", path.join(t.dir, "main", ".git"), "--dissociate", "--single-branch", "--branch", "trunk", "--no-tags", "--", URL, t.staging], env: NO_LFS },
    { cwd: t.staging, args: ["checkout", "-q", "--detach", "refs/remotes/origin/trunk"], env: NO_LFS },
    { cwd: t.read, args: ["rev-parse", "HEAD"] },
  ]);
  expect(fs.existsSync(path.join(t.read, ".git"))).toBe(true);
  expect(fs.existsSync(t.staging)).toBe(false);
  // Just cloned: the next question's fetch waits fetchSeconds.
  await t.checkout.fetch();
  expect(t.calls.some((c) => c.args[0] === "fetch")).toBe(false);
});

test("prepare: a clone cut short leaves no read/, and the half-made one is cleared before the next clone", async () => {
  let cut = true;
  const t = setUp((args) => {
    if (args[0] === "remote") return ok(URL + "\n");
    if (args[0] === "ls-remote") return ok(`ref: refs/heads/main\tHEAD\n${MAIN}\tHEAD\n`);
    if (args[0] === "clone") {
      makeClone(args.at(-1)!);
      if (cut) return { code: 128, stdout: "", stderr: "", timedOut: true };
    }
    if (args.at(-1) === "HEAD") return ok(MAIN + "\n");
  });
  await expect(t.checkout.prepare()).rejects.toThrow(/git clone .* failed \(it took too long\)/);
  expect(fs.existsSync(t.read)).toBe(false);
  fs.writeFileSync(path.join(t.staging, "left-over"), "");
  cut = false;
  expect(await t.checkout.prepare()).toEqual({ branch: "main", commit: MAIN });
  expect(fs.existsSync(path.join(t.read, "left-over"))).toBe(false);
});

test("keepLongPaths: on Windows long paths are written only while git hasn't them, and a write that fails is only told; elsewhere git isn't asked", async () => {
  for (const [platform, got, write, calls, told] of [
    ["win32", ok("true\n"), ok(), 1, 0],
    ["win32", failed(""), ok(), 2, 0],
    ["win32", failed(""), failed("could not lock config file"), 2, 1],
    ["linux", failed(""), ok(), 0, 0],
  ] as const) {
    const asked: string[][] = [];
    const why: string[] = [];
    await keepLongPaths(async (args) => (asked.push(args), args[1] === "--get" ? got : write), platform, (w) => void why.push(w));
    expect(asked).toEqual([["config", "--get", "core.longpaths"], ["config", "core.longpaths", "true"]].slice(0, calls));
    expect(why).toEqual(told ? ["git failed: could not lock config file"] : []);
  }
});

test("cloneBorrowing: a clone that fails borrowing is made once more borrowing nothing, after its folder is emptied; one that works or takes too long isn't", async () => {
  for (const [first, tries] of [[failed("unable to write file"), 2], [ok(), 1], [{ ...failed(), timedOut: true }, 1]] as const) {
    const borrows: string[][] = [];
    let cleaned = 0;
    const r = await cloneBorrowing(async (borrow) => (borrows.push(borrow), borrows.length === 1 ? first : ok()), "C:/repo/.git", async () => cleaned++);
    expect(borrows).toEqual([["--reference-if-able", "C:/repo/.git", "--dissociate"], ...(tries === 2 ? [[]] : [])]);
    expect(cleaned).toBe(tries - 1);
    expect(r.code).toBe(tries === 2 ? 0 : first.code);
  }
});

test("prepare: a clone already there gets origin's current URL and a fetch by refspec; with origin unreachable, the default branch from origin/HEAD and the clone kept as it is", async () => {
  const online = setUp((args) => {
    if (args[0] === "remote" && args[1] === "get-url") return ok(URL);
    if (args[0] === "ls-remote") return ok(`ref: refs/heads/main\tHEAD\n`);
    if (args.at(-1) === "HEAD") return ok(MAIN);
  });
  makeClone(online.read);
  await online.checkout.prepare();
  expect(online.calls.slice(2)).toEqual([
    { cwd: online.read, args: ["remote", "set-url", "origin", URL] },
    { cwd: online.read, args: ["fetch", "--no-tags", "origin", "+refs/heads/main:refs/remotes/origin/main"] },
    { cwd: online.read, args: ["rev-parse", "HEAD"] },
  ]);

  const t = setUp((args) => {
    if (args[0] === "remote" && args[1] === "get-url") return ok(URL);
    if (args[0] === "ls-remote" || args[0] === "fetch") return failed("could not read from remote");
    if (args[0] === "symbolic-ref") return ok("origin/main\n");
    if (args.at(-1) === "HEAD" || args.at(-1)?.startsWith("refs/remotes/")) return ok(OLD);
  });
  makeClone(t.read);
  expect(await t.checkout.prepare()).toEqual({ branch: "main", commit: OLD });
  expect(t.calls.some((c) => c.args[0] === "clone")).toBe(false);
  expect(t.calls.filter((c) => c.cwd === t.repo).map((c) => c.args[0])).toEqual(["remote", "ls-remote", "symbolic-ref"]);
  expect(t.logged).toEqual([expect.stringMatching(/^couldn't fetch origin main for expert adr, so it answers from its checkout as it is/)]);
});

test("prepare: an origin that is a local path, a file:// URL or a \\\\server share is refused, and nothing is cloned", async () => {
  for (const url of ["C:/repos/app", "/srv/app.git", "file:///srv/app.git", "\\\\server\\share\\app"]) {
    const t = setUp((args) => (args[0] === "remote" ? ok(url) : undefined));
    await expect(t.checkout.prepare()).rejects.toThrow(/isn't an https, ssh or host:path remote, so expert adr wasn't cloned from it/);
    expect(t.calls.map((c) => c.args[0])).toEqual(["remote"]);
  }
});

test("fetch: at most every fetchSeconds; origin's commit when it is ahead of the read checkout, else null", async () => {
  let now = 0;
  let tip = MAIN;
  const t = setUp(
    (args) => {
      if (args[0] === "remote" && args[1] === "get-url") return ok(URL);
      if (args[0] === "ls-remote") return ok(`ref: refs/heads/main\tHEAD\n`);
      if (args.at(-1)?.startsWith("refs/remotes/origin/main")) return ok(tip);
      if (args.at(-1) === "HEAD") return ok(MAIN);
    },
    { now: () => now },
  );
  makeClone(t.read);
  await t.checkout.prepare();
  const fetches = () => t.calls.filter((c) => c.args[0] === "fetch").length;
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

test("move, dirty and reset run in the clone, the checkout and reset without LFS's download", async () => {
  const t = setUp((args) => (args.includes("--porcelain") ? ok(" M a.ts\n") : undefined));
  await t.checkout.move(MOVED);
  expect(await t.checkout.dirty()).toBe(true);
  await t.checkout.reset();
  expect(t.calls).toEqual([
    { cwd: t.read, args: ["checkout", "-q", "--detach", "--force", MOVED], env: NO_LFS },
    { cwd: t.read, args: ["status", "--porcelain"] },
    { cwd: t.read, args: ["reset", "-q", "--hard", "HEAD"], env: NO_LFS },
    { cwd: t.read, args: ["clean", "-fd"] },
  ]);
});

test("changed: one diff per distinct commit with no pathspec, intersected with that commit's files; a commit git doesn't know counts all of its files", async () => {
  const t = setUp((args) => {
    if (args.at(-1) === `${MAIN}..HEAD`) return ok("a.ts\nunrelated.ts\n");
    if (args.at(-1) === `${OLD}..HEAD`) return failed("bad revision");
  });
  const changed = await t.checkout.changed({ "a.ts": MAIN, "b.ts": MAIN, "c.ts": OLD });
  expect([...changed].sort()).toEqual(["a.ts", "c.ts"]);
  expect(t.calls.map((c) => c.args)).toEqual([
    ["diff", "--name-only", `${MAIN}..HEAD`],
    ["diff", "--name-only", `${OLD}..HEAD`],
  ]);
});

test("list and read: names in the read checkout's folders, and a file cut to its limit", async () => {
  const t = setUp();
  fs.mkdirSync(path.join(t.read, "docs", "adr", "drafts"), { recursive: true });
  fs.writeFileSync(path.join(t.read, "docs", "adr", "0004-what-leaves-a-machine.md"), "");
  fs.writeFileSync(path.join(t.read, "docs", "adr", "0001-record.md"), "");
  fs.writeFileSync(path.join(t.read, "CONTEXT.md"), "abcdef");
  expect(await t.checkout.list("docs/adr")).toEqual(["0001-record.md", "0004-what-leaves-a-machine.md"]);
  expect(await t.checkout.read("CONTEXT.md", 4)).toBe("abcd");
  expect(await t.checkout.read("CLAUDE.md", 4)).toBe(null);
});

test("read: never through a link to a file outside the read checkout", async () => {
  const t = setUp();
  // A link the repo committed (a junction on Windows, which needs no privilege) to a folder outside.
  const outside = path.join(tempRoot(), "outside");
  fs.mkdirSync(outside, { recursive: true });
  fs.mkdirSync(t.read, { recursive: true });
  fs.symlinkSync(outside, path.join(t.read, "docs"), "junction");
  fs.writeFileSync(path.join(outside, "CLAUDE.md"), "a host file");
  expect(await t.checkout.read("docs/CLAUDE.md", 100)).toBe(null);
});

// Real git from here: a bare repo as origin, and the person's clone of it.
const MS = 30000;
function realSetUp(platform?: NodeJS.Platform) {
  const root = tempRoot();
  const { remote, clone: repo } = remoteAndClone(root, "app");
  const dir = path.join(root, "experts", "adr");
  const logged: string[] = [];
  // A local origin stands in for GitHub here, so the wire check is loosened.
  const checkout = createExpertCheckout({ git: createRunGit(), repo, dir, name: "adr", timeoutMs: MS, log: (t) => void logged.push(t), fetchSeconds: () => 0, cloneFrom: () => true, ...(platform && { platform }) });
  return { root, remote, repo, dir, read: path.join(dir, "read"), checkout, logged };
}

test("with real git: read/ is a clone of its own that follows origin, not a worktree of the person's repo, which is left as it was; remove deletes it", async () => {
  const t = realSetUp();
  const before = { refs: gitIn(t.repo, "for-each-ref"), config: fs.readFileSync(path.join(t.repo, ".git", "config"), "utf8"), worktrees: gitIn(t.repo, "worktree", "list") };
  const tip = gitIn(t.remote, "rev-parse", "main");
  expect(await t.checkout.prepare()).toEqual({ branch: "main", commit: tip });
  expect(fs.statSync(path.join(t.read, ".git")).isDirectory()).toBe(true);
  expect(gitIn(t.read, "rev-parse", "--abbrev-ref", "HEAD")).toBe("HEAD");
  expect(fs.readFileSync(path.join(t.read, "app.js"), "utf8")).toMatch(/^console\.log\(1\);\r?\n$/);
  // It stands alone: borrowed objects were copied, so nothing points back at the person's repo.
  expect(fs.existsSync(path.join(t.read, ".git", "objects", "info", "alternates"))).toBe(false);
  expect(gitIn(t.read, "tag")).toBe("");

  // Origin moves on: the next fetch sees it, and move checks it out.
  const pusher = remoteAndClone(t.root, "pusher").clone;
  fs.writeFileSync(path.join(pusher, "app.js"), "console.log(2);\n");
  gitIn(pusher, "commit", "-q", "-am", "second");
  gitIn(pusher, "push", "-q", "origin", "main");
  const moved = gitIn(pusher, "rev-parse", "HEAD");
  expect(await t.checkout.fetch()).toBe(moved);
  await t.checkout.move(moved);
  expect(await t.checkout.head()).toBe(moved);
  expect(await t.checkout.dirty()).toBe(false);
  fs.writeFileSync(path.join(t.read, "app.js"), "changed by a fork\n");
  expect(await t.checkout.dirty()).toBe(true);
  await t.checkout.reset();
  expect(await t.checkout.dirty()).toBe(false);
  await t.checkout.prepare();

  expect({ refs: gitIn(t.repo, "for-each-ref"), config: fs.readFileSync(path.join(t.repo, ".git", "config"), "utf8"), worktrees: gitIn(t.repo, "worktree", "list") }).toEqual(before);
  await t.checkout.remove();
  expect(fs.existsSync(t.read)).toBe(false);
  expect(t.logged).toContainEqual(`removed expert adr's clone of ${t.repo}`);
}, 60000);

test("with real git: a read/ that is a worktree of the person's repo, from an earlier build, is refused and never deleted", async () => {
  const t = realSetUp();
  fs.mkdirSync(t.dir, { recursive: true });
  gitIn(t.repo, "worktree", "add", "-q", "--detach", t.read);
  await expect(t.checkout.prepare()).rejects.toThrow(/is there already and isn't a clone of its own .*git worktree remove --force/);
  await t.checkout.remove();
  expect(fs.existsSync(path.join(t.read, "app.js"))).toBe(true);
  expect(t.logged).toEqual([`left ${t.read} as it is: it isn't expert adr's own clone`]);
}, 60000);

test("with real git on Windows: read/ takes long paths in its own config, and the person's repo's config is left as it was", async () => {
  const t = realSetUp("win32");
  const before = fs.readFileSync(path.join(t.repo, ".git", "config"), "utf8");
  await t.checkout.prepare();
  expect(gitIn(t.read, "config", "--local", "core.longpaths")).toBe("true");
  // One cloned before Isoplan set them takes them as it is next prepared.
  gitIn(t.read, "config", "--unset", "core.longpaths");
  await t.checkout.prepare();
  expect(gitIn(t.read, "config", "--get", "core.longpaths")).toBe("true");
  expect(fs.readFileSync(path.join(t.repo, ".git", "config"), "utf8")).toBe(before);
}, 60000);
