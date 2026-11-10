import fs from "node:fs";
import path from "node:path";
import { expect, test } from "vitest";
import { createGit, pathKey } from "../data-layer/git.js";
import { nodeIo } from "../data-layer/io.js";
import { tempRoot } from "../data-layer/fixture.js";
import { createRunGit } from "../handoff/git.js";
import { fakeOrca, git, remoteAndClone, setIdentity } from "../handoff/fixture.js";
import { orcaRunner } from "../handoff/orca.js";
import { branchFolder, createCheckouts, createRemoteBranches, mainCheckout, orcaBranchFolder, parseHeads } from "./checkouts.js";

const run = createRunGit();
const isDir = async (p: string) => fs.existsSync(p) && fs.statSync(p).isDirectory();
const resolver = () => {
  const g = createGit(nodeIo());
  return (dir: string) => g.resolve(dir);
};
const same = (a: string | null, b: string) => expect(a && pathKey(a)).toBe(pathKey(b));

test.each([
  ["Windows", { toplevel: "C:/Users/Ada/orca/workspaces/app/wt", commonDir: "C:/Users/Ada/code/app/.git", branch: "wt" }, "C:/Users/Ada/code/app"],
  ["macOS", { toplevel: "/Users/ada/orca/workspaces/app/wt", commonDir: "/Users/ada/code/app/.git", branch: "wt" }, "/Users/ada/code/app"],
  ["a bare repo's worktree", { toplevel: "/Users/ada/app/wt", commonDir: "/Users/ada/app.git", branch: "wt" }, "/Users/ada/app/wt"],
])("%s: a worktree's main checkout is the folder holding its shared .git", (_, where, main) => {
  expect(mainCheckout(where)).toBe(main);
});

test.each([
  ["Windows", "C:\\Users\\Ada\\orca\\wt", "C:\\Users\\Ada\\code\\app", { toplevel: "C:/Users/Ada/orca/wt", commonDir: "C:/Users/Ada/code/app/.git", branch: "wt" }],
  ["macOS", "/Users/ada/orca/wt", "/Users/ada/code/app", { toplevel: "/Users/ada/orca/wt", commonDir: "/Users/ada/code/app/.git", branch: "wt" }],
])("%s: a worktree gives its main checkout, spelled as the platform spells it, and once gone, the one remembered for it, until it is no longer seen", async (_, wt, main, where) => {
  const file = path.join(tempRoot(), "checkouts.json");
  const there = new Set([pathKey(wt), pathKey(main)]);
  const checkouts = createCheckouts({ file, resolve: async () => where, isDir: async (p) => there.has(pathKey(p)) });
  expect(await checkouts.of(wt)).toBe(main);
  await checkouts.keep([wt]);
  there.delete(pathKey(wt));
  // A runner started later reads what was remembered.
  const later = createCheckouts({ file, resolve: async () => null, isDir: async (p) => there.has(pathKey(p)) });
  expect(await later.of(wt)).toBe(main);
  // The main checkout gone too: nothing to list.
  there.delete(pathKey(main));
  expect(await later.of(wt)).toBeNull();
  there.add(pathKey(main));
  await later.keep([]);
  expect(await createCheckouts({ file, resolve: async () => null, isDir: async (p) => there.has(pathKey(p)) }).of(wt)).toBeNull();
});

test("with real git: a repo seen only in a deleted worktree is found by its main checkout; a folder git can't place is its own", async () => {
  const root = tempRoot();
  const { clone } = remoteAndClone(root);
  const wt = path.join(root, "wt");
  git(clone, "worktree", "add", "-q", "-b", "wt", wt);
  const file = path.join(root, "checkouts.json");
  const checkouts = createCheckouts({ file, resolve: resolver(), isDir });
  same(await checkouts.of(wt), clone);
  same(await checkouts.of(clone), clone);
  const plain = path.join(root, "notes");
  fs.mkdirSync(plain);
  expect(await checkouts.of(plain)).toBe(plain);
  await checkouts.keep([wt, clone, plain]);
  git(clone, "worktree", "remove", "--force", wt);
  same(await createCheckouts({ file, resolve: resolver(), isDir }).of(wt), clone);
});

test("the branches are the remote's own: one pushed from elsewhere is listed, a local one and a stale remote-tracking one aren't, and one deleted on the remote goes once the list is refreshed", async () => {
  const root = tempRoot();
  const { clone } = remoteAndClone(root);
  const { clone: other } = remoteAndClone(root, "other");
  git(other, "push", "-q", "origin", "main:feat/dark", "main:feat/old");
  git(clone, "fetch", "-q", "origin");
  git(clone, "branch", "local-only");
  let t = 0;
  const logs: string[] = [];
  const branches = createRemoteBranches({ run, timeoutMs: async () => 30000, refreshMs: async () => 1000, log: (l) => void logs.push(l), now: () => t });
  expect(await branches(clone)).toEqual(["main", "feat/dark", "feat/old"]);
  git(other, "push", "-q", "origin", "--delete", "feat/old");
  // Within the refresh time the list is kept; after it the remote is asked again, though the clone still has origin/feat/old.
  expect(await branches(clone)).toEqual(["main", "feat/dark", "feat/old"]);
  t = 1000;
  expect(await branches(clone)).toEqual(["main", "feat/dark"]);
  expect(git(clone, "branch", "-r")).toContain("origin/feat/old");
  expect(logs).toEqual([]);
});

test("a remote that can't be asked lists no branches, logged once while it keeps failing and again once it worked in between", async () => {
  const root = tempRoot();
  const { clone } = remoteAndClone(root);
  const url = git(clone, "remote", "get-url", "origin");
  git(clone, "remote", "set-url", "origin", path.join(root, "missing.git"));
  let t = 0;
  const logs: string[] = [];
  const branches = createRemoteBranches({ run, timeoutMs: async () => 30000, refreshMs: async () => 1, log: (l) => void logs.push(l), now: () => t++ });
  expect(await branches(clone)).toBeNull();
  expect(await branches(clone)).toBeNull();
  expect(logs).toHaveLength(1);
  expect(logs[0]).toContain("couldn't list the branches on the remote of");
  git(clone, "remote", "set-url", "origin", url);
  expect(await branches(clone)).toEqual(["main"]);
  git(clone, "remote", "set-url", "origin", path.join(root, "missing.git"));
  expect(await branches(clone)).toBeNull();
  expect(logs).toHaveLength(2);
});

test("ls-remote's heads are read by name, and one git would take for an option is left out", () => {
  expect(parseHeads("a1b2\trefs/heads/main\r\nc3d4\trefs/heads/feat/x\ne5f6\trefs/heads/-rf\n")).toEqual(["main", "feat/x"]);
});

test("a branch other than the checkout's opens in a new worktree beside it, then the same one again; the checkout's branch is never switched", async () => {
  const root = tempRoot();
  const { clone } = remoteAndClone(root, "app");
  const { clone: other } = remoteAndClone(root, "other");
  git(other, "push", "-q", "origin", "main:feat/dark");
  expect(await branchFolder(run, clone, "main", 30000)).toBe(clone);
  const made = await branchFolder(run, clone, "feat/dark", 30000);
  expect(typeof made).toBe("string");
  same(made as string, path.join(root, "app-branch-feat-dark"));
  expect(git(made as string, "rev-parse", "--abbrev-ref", "HEAD")).toBe("feat/dark");
  expect(git(made as string, "rev-parse", "--abbrev-ref", "@{upstream}")).toBe("origin/feat/dark");
  expect(git(clone, "rev-parse", "--abbrev-ref", "HEAD")).toBe("main");
  same((await branchFolder(run, clone, "feat/dark", 30000)) as string, made as string);
});

test("a local branch of that name is used as it is, its own commits kept; a branch on no remote is an error", async () => {
  const root = tempRoot();
  const { clone } = remoteAndClone(root, "app");
  git(clone, "branch", "mine");
  git(clone, "push", "-q", "origin", "mine");
  const wt = path.join(root, "scratch");
  git(clone, "worktree", "add", "-q", wt, "mine");
  setIdentity(wt);
  fs.writeFileSync(path.join(wt, "b.js"), "2\n");
  git(wt, "add", ".");
  git(wt, "commit", "-q", "-m", "mine");
  const tip = git(wt, "rev-parse", "HEAD");
  git(clone, "worktree", "remove", "--force", wt);
  const made = await branchFolder(run, clone, "mine", 30000);
  expect(git(made as string, "rev-parse", "HEAD")).toBe(tip);
  expect(await branchFolder(run, clone, "nowhere", 30000)).toMatchObject({ error: expect.stringContaining("git fetch origin nowhere") });
});

test("a worktree on the branch whose folder was deleted by hand is pruned, and a new one is made and returned", async () => {
  const root = tempRoot();
  const { clone } = remoteAndClone(root, "app");
  const { clone: other } = remoteAndClone(root, "other");
  git(other, "push", "-q", "origin", "main:feat/x");
  const wt = path.join(root, "gone");
  git(clone, "fetch", "-q", "origin");
  git(clone, "worktree", "add", "-q", "--track", "-b", "feat/x", wt, "origin/feat/x");
  fs.rmSync(wt, { recursive: true, force: true });
  const made = await branchFolder(run, clone, "feat/x", 30000);
  expect(typeof made).toBe("string");
  same(made as string, path.join(root, "app-branch-feat-x"));
  expect(git(made as string, "rev-parse", "--abbrev-ref", "HEAD")).toBe("feat/x");
});

test("none of the repo's hooks runs when a worktree is made for a branch", async () => {
  const root = tempRoot();
  const { clone } = remoteAndClone(root, "app");
  const { clone: other } = remoteAndClone(root, "other");
  git(other, "push", "-q", "origin", "main:feat/dark");
  const ran = path.join(root, "hook-ran");
  const hooks = path.join(clone, ".githooks");
  fs.mkdirSync(hooks);
  const marker = ran.split(path.sep).join("/");
  fs.writeFileSync(path.join(hooks, "post-checkout"), `#!/bin/sh\necho ran > "${marker}"\n`, { mode: 0o755 });
  // Relative, as husky sets it: without the override the hook would be the branch's own.
  git(clone, "config", "core.hooksPath", ".githooks");
  git(clone, "worktree", "add", "-q", path.join(root, "control"), "-b", "control");
  expect(fs.existsSync(ran)).toBe(true);
  fs.rmSync(ran);
  const made = await branchFolder(run, clone, "feat/dark", 30000);
  expect(typeof made).toBe("string");
  expect(fs.existsSync(ran)).toBe(false);
});

test("in Orca: the checkout when it is on the branch or none is named; else Orca's own worktree of the remote's branch, in its workspace; one with a local branch of that name gets branchFolder's, which Orca finds by its path", async () => {
  const root = tempRoot();
  const { clone } = remoteAndClone(root, "app");
  const { clone: other } = remoteAndClone(root, "other");
  git(other, "push", "-q", "origin", "main:feat/dark");
  const fake = fakeOrca(root);
  const orca = orcaRunner(fake.bin, { ...process.env } as Record<string, string>);
  expect(await orcaBranchFolder(orca, run, clone, "main", 30000)).toBe(clone);
  expect(await orcaBranchFolder(orca, run, clone, undefined, 30000)).toBe(clone);
  const made = await orcaBranchFolder(orca, run, clone, "feat/dark", 30000);
  same(made as string, path.join(fake.workspaces, "branch-feat-dark"));
  expect(git(made as string, "rev-parse", "--abbrev-ref", "HEAD")).toBe("feat/dark");
  expect(git(made as string, "rev-parse", "--abbrev-ref", "@{upstream}")).toBe("origin/feat/dark");
  expect(git(clone, "rev-parse", "--abbrev-ref", "HEAD")).toBe("main");
  expect(fake.calls().map((c) => c.slice(0, 2).join(" "))).toEqual(["repo show", "repo add", "repo show", "repo show", "worktree create"]);
  expect(fake.calls()[4]).toEqual(["worktree", "create", "--repo", `path:${clone}`, "--name", "branch-feat-dark", "--branch", "feat/dark", "--base-branch", "origin/feat/dark", "--no-parent", "--setup", "skip", "--comment", "Isoplan: a new session on feat/dark"]);
  // The branch has a worktree now: that one again, which Orca is asked to see, and no other is made.
  same((await orcaBranchFolder(orca, run, clone, "feat/dark", 30000)) as string, made as string);
  expect(fake.calls().slice(5).map((c) => c.slice(0, 2).join(" "))).toEqual(["repo show", "worktree show"]);
  git(clone, "branch", "mine");
  git(clone, "push", "-q", "origin", "mine");
  const mine = await orcaBranchFolder(orca, run, clone, "mine", 30000);
  same(mine as string, path.join(root, "app-branch-mine"));
  expect(fake.calls().at(-1)!.slice(0, 2)).toEqual(["worktree", "show"]);
  // Many git and Orca calls, each a process: slow on a loaded machine.
}, 30000);

