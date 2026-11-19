import fs from "node:fs";
import path from "node:path";
import { expect, test } from "vitest";
import { tempRoot } from "../data-layer/fixture.js";
import { git, remoteAndClone } from "../handoff/fixture.js";
import { createRunGit } from "../handoff/git.js";
import { cloneName, clonesDir, createIsoplanClones, earlierCloneName, type IsoplanClonesOptions } from "./isoplan-clone.js";

const PROJECT = "github.com/ada/app";
const MS = 30000;

// Real git: a bare repo as origin, and the person's clone of it. A local origin stands in for
// GitHub, so the wire check is loosened, except where a test checks it.
function setUp(cloneFrom: (remote: string) => boolean = () => true) {
  const root = tempRoot();
  const { remote, clone: checkout } = remoteAndClone(root, "app");
  const claudeDir = path.join(root, ".claude");
  const logged: string[] = [];
  const make = (o: Partial<IsoplanClonesOptions> = {}) => createIsoplanClones({ git: createRunGit(), claudeDir, timeoutMs: async () => MS, log: (t) => void logged.push(t), cloneFrom, ...o });
  const clones = make();
  const person = () => ({ refs: git(checkout, "for-each-ref"), config: fs.readFileSync(path.join(checkout, ".git", "config"), "utf8"), worktrees: git(checkout, "worktree", "list"), status: git(checkout, "status", "--porcelain") });
  return { root, remote, checkout, claudeDir, clones, make, logged, person, clone: path.join(clonesDir(claudeDir), cloneName(PROJECT)) };
}

test("a project's folder name is its repo's name, filesystem-safe and cut to 20, then a hash of the id, so two repos of one name get different ones", () => {
  expect(cloneName("github.com/ada/app")).toMatch(/^app-[0-9a-f]{8}$/);
  expect(cloneName("github.com/ada/My Repo!")).toMatch(/^my-repo-[0-9a-f]{8}$/);
  expect(cloneName("github.com/ada/abcdefghijklmnopqrs-tuvwxyz")).toMatch(/^abcdefghijklmnopqrs-[0-9a-f]{8}$/);
  expect(cloneName("github.com/ada/app")).not.toBe(cloneName("github.com/bob/app"));
});

test("first use clones a writable clone of its own on origin's default branch; the next fetches and reuses it, keeping its work; the person's repo is only read", async () => {
  const t = setUp();
  const before = t.person();
  expect(await t.clones(t.checkout, PROJECT)).toBe(t.clone);
  expect(fs.statSync(path.join(t.clone, ".git")).isDirectory()).toBe(true);
  expect(git(t.clone, "symbolic-ref", "--short", "HEAD")).toBe("main");
  expect(fs.existsSync(path.join(t.clone, ".git", "objects", "info", "alternates"))).toBe(false);
  expect(fs.existsSync(`${t.clone}.new`)).toBe(false);

  // A session's work in it, and a branch pushed to origin since.
  fs.writeFileSync(path.join(t.clone, "notes.md"), "work in progress\n");
  const pusher = remoteAndClone(t.root, "pusher").clone;
  git(pusher, "checkout", "-q", "-b", "feat/dark");
  fs.writeFileSync(path.join(pusher, "app.js"), "console.log(2);\n");
  git(pusher, "commit", "-q", "-am", "dark");
  git(pusher, "push", "-q", "origin", "feat/dark");

  expect(await t.clones(t.checkout, PROJECT)).toBe(t.clone);
  expect(git(t.clone, "rev-parse", "origin/feat/dark")).toBe(git(pusher, "rev-parse", "HEAD"));
  expect(fs.readFileSync(path.join(t.clone, "notes.md"), "utf8")).toBe("work in progress\n");
  expect(t.person()).toEqual(before);
}, 60000);

test("a repo with no remote, or whose origin is a local path, is refused with a reason for the floor, and nothing is cloned", async () => {
  const t = setUp((remote) => !path.isAbsolute(remote));
  expect(await t.clones(t.checkout, PROJECT)).toEqual({ problem: expect.stringContaining("not an https or ssh address, so Isoplan can't keep a copy of its own") });
  git(t.checkout, "remote", "remove", "origin");
  expect(await t.clones(t.checkout, PROJECT)).toEqual({ problem: expect.stringContaining("This repo has no remote, so Isoplan can't keep a copy of its own") });
  expect(fs.existsSync(clonesDir(t.claudeDir))).toBe(false);
}, 60000);

test("a clone that fails, or a fetch that fails, is refused, its runner log saying why; a folder there already that isn't a clone is left as it is", async () => {
  const t = setUp();
  git(t.checkout, "remote", "set-url", "origin", path.join(t.root, "nowhere.git"));
  expect(await t.clones(t.checkout, PROJECT)).toEqual({ problem: expect.stringContaining("couldn't be made") });
  expect(fs.existsSync(`${t.clone}.new`)).toBe(false);
  git(t.checkout, "remote", "set-url", "origin", t.remote);
  expect(await t.clones(t.checkout, PROJECT)).toBe(t.clone);
  git(t.checkout, "remote", "set-url", "origin", path.join(t.root, "nowhere.git"));
  expect(await t.clones(t.checkout, PROJECT)).toEqual({ problem: expect.stringContaining("couldn't be brought up to date") });
  expect(t.logged.some((l) => l.includes("couldn't fetch origin"))).toBe(true);

  const other = path.join(clonesDir(t.claudeDir), cloneName("github.com/ada/other"));
  fs.mkdirSync(other, { recursive: true });
  fs.writeFileSync(path.join(other, "keep.txt"), "mine\n");
  git(t.checkout, "remote", "set-url", "origin", t.remote);
  expect(await t.clones(t.checkout, "github.com/ada/other")).toEqual({ problem: expect.stringContaining("couldn't be made") });
  expect(fs.readdirSync(other)).toEqual(["keep.txt"]);
}, 60000);

test("two uses at once clone once", async () => {
  const t = setUp();
  expect(await Promise.all([t.clones(t.checkout, PROJECT), t.clones(t.checkout, PROJECT)])).toEqual([t.clone, t.clone]);
  expect(t.logged.filter((l) => l.startsWith("made Isoplan's own clone"))).toHaveLength(1);
}, 60000);

test("a new clone goes in clonesFolder's clones/; one made earlier is still used where it is, at its earlier name or in a folder clonesFolder named before", async () => {
  const t = setUp();
  const first = path.join(t.root, "first");
  const made = path.join(first, "clones", cloneName(PROJECT));
  expect(await t.make({ clonesFolder: first, clonesFolders: [first] })(t.checkout, PROJECT)).toBe(made);
  // clonesFolder changed, then emptied: the clone stays where it was made.
  const second = path.join(t.root, "second");
  expect(await t.make({ clonesFolder: second, clonesFolders: [first, second] })(t.checkout, PROJECT)).toBe(made);
  expect(await t.make({ clonesFolders: [first, second] })(t.checkout, PROJECT)).toBe(made);
  expect(fs.existsSync(path.join(second, "clones"))).toBe(false);

  // One an earlier version made at its longer name is used there.
  const earlier = path.join(clonesDir(t.claudeDir), earlierCloneName("github.com/ada/older"));
  fs.mkdirSync(clonesDir(t.claudeDir), { recursive: true });
  git(clonesDir(t.claudeDir), "clone", "-q", t.remote, earlier);
  expect(await t.clones(t.checkout, "github.com/ada/older")).toBe(earlier);
  expect(fs.existsSync(path.join(clonesDir(t.claudeDir), cloneName("github.com/ada/older")))).toBe(false);
}, 60000);

test("on Windows a clone takes long paths in its own config, so later git in it has them; elsewhere, and in the person's repo, nothing changes", async () => {
  const t = setUp();
  const before = t.person();
  const windows = (await t.make({ platform: "win32" })(t.checkout, PROJECT)) as string;
  expect(git(windows, "config", "--local", "core.longpaths")).toBe("true");
  // One made before Isoplan set them takes them as it is next fetched.
  git(windows, "config", "--unset", "core.longpaths");
  expect(await t.make({ platform: "win32" })(t.checkout, PROJECT)).toBe(windows);
  expect(git(windows, "config", "--get", "core.longpaths")).toBe("true");
  expect(t.person()).toEqual(before);
  const mac = (await t.make({ platform: "darwin" })(t.checkout, "github.com/ada/mac")) as string;
  expect(() => git(mac, "config", "--local", "core.longpaths")).toThrow();
}, 60000);
