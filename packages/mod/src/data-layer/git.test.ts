import fs from "node:fs";
import path from "node:path";
import { expect, test } from "vitest";
import { createGit, normalize, pathKey, relativeTo, type Run } from "./git.js";
import { nodeIo } from "./io.js";
import { tempRoot, gitRepo, gitWorktree } from "./fixture.js";

const filesOnly = () => createGit(nodeIo({ run: null }));
const withRunner = (run: Run) => createGit({ ...nodeIo(), run });

test("normalize: Windows and POSIX shapes, dots folded, drive upper-cased", () => {
  expect(normalize("c:\\Users\\a\\.\\b\\..\\repo\\")).toBe("C:/Users/a/repo");
  expect(normalize("/home/a/./b/../repo/")).toBe("/home/a/repo");
  expect(normalize("C:\\")).toBe("C:/");
  expect(pathKey("C:\\Users\\Adam")).toBe(pathKey("c:/users/adam"));
  expect(pathKey("/home/Adam")).not.toBe(pathKey("/home/adam"));
});

test("relativeTo: Windows paths compare case-insensitively and keep the file's spelling; outside paths are null", () => {
  expect(relativeTo("C:/Users/Adam/Repo", "c:\\users\\adam\\repo\\Lib\\Wizard.MJS")).toBe("Lib/Wizard.MJS");
  expect(relativeTo("C:/Users/Adam/Repo", "C:\\Users\\Adam\\Repo-other\\x.js")).toBe(null);
  expect(relativeTo("/home/adam/repo", "/home/adam/repo/Lib/X.mjs")).toBe("Lib/X.mjs");
  expect(relativeTo("/home/adam/repo", "/home/adam/elsewhere/x")).toBe(null);
});

test("pointer files: a main checkout is its own common dir; walks up from a subfolder", async () => {
  const root = tempRoot();
  const main = gitRepo(path.join(root, "main"), "main");
  fs.mkdirSync(path.join(main, "src", "deep"), { recursive: true });
  const r = await filesOnly().resolve(path.join(main, "src", "deep"));
  expect(r).toEqual({ toplevel: normalize(main), commonDir: normalize(path.join(main, ".git")), branch: "main" });
});

test("pointer files: a linked worktree reaches the shared common dir (relative or absolute commondir)", async () => {
  const root = tempRoot();
  const main = gitRepo(path.join(root, "main"));
  const wt = gitWorktree(main, path.join(root, "elsewhere", "wt"), "wt", "feature/x");
  const wt2 = gitWorktree(main, path.join(root, "wt2"), "wt2", "other", { absoluteCommondir: true });
  const git = filesOnly();
  const a = (await git.resolve(wt))!;
  const b = (await git.resolve(wt2))!;
  expect(a.toplevel).toBe(normalize(wt));
  expect(a.branch).toBe("feature/x");
  expect(pathKey(a.commonDir)).toBe(pathKey(path.join(main, ".git")));
  expect(pathKey(b.commonDir)).toBe(pathKey(path.join(main, ".git")));
  expect(b.branch).toBe("other");
});

test("pointer files: a detached HEAD has no branch; no repository resolves to null", async () => {
  const root = tempRoot();
  const main = gitRepo(path.join(root, "main"));
  fs.writeFileSync(path.join(main, ".git", "HEAD"), "0123456789abcdef0123456789abcdef01234567\n");
  expect((await filesOnly().resolve(main))!.branch).toBe(null);
  // A folder with no .git in it or above it, whatever the machine's own folders hold.
  const bare = path.join(root, "plain");
  const noRepo = createGit({
    run: null,
    stat: (p) => (normalize(p) === normalize(bare) ? { isDir: true, mtimeMs: 0, size: 0 } : null),
    read: () => {
      throw new Error("unread");
    },
  });
  expect(await noRepo.resolve(bare)).toBe(null);
});

test("pointer files: a removed worktree inside a checkout does not resolve to that checkout", async () => {
  const root = tempRoot();
  const main = gitRepo(path.join(root, "main"));
  expect(await filesOnly().resolve(path.join(main, ".claude", "worktrees", "agent-gone"))).toBe(null);
});

test("runner first: its answer is used and cached per folder", async () => {
  const calls: [string, string][] = [];
  const git = withRunner((argv, { cwd }) => {
    calls.push([argv.join(" "), cwd]);
    if (argv.includes("--show-toplevel")) return { code: 0, stdout: "C:/repo/wt\nC:/repo/main/.git\n" };
    return { code: 0, stdout: "feature/y\n" };
  });
  const r = await git.resolve("C:\\repo\\wt");
  await git.resolve("c:/repo/wt");
  expect(r).toEqual({ toplevel: "C:/repo/wt", commonDir: "C:/repo/main/.git", branch: "feature/y" });
  expect(calls).toHaveLength(2);
  expect(calls[0]![0]).toMatch(/rev-parse --path-format=absolute --show-toplevel --git-common-dir/);
});

test("cache: an answer expires after maxAgeMs; calls at one `now` share one answer per folder", async () => {
  let calls = 0;
  const git = withRunner((argv) => {
    calls++;
    return argv.includes("--show-toplevel") ? { code: 0, stdout: "/r\n/r/.git\n" } : { code: 0, stdout: "main\n" };
  });
  const at = (now: number) => ({ now, maxAgeMs: 60000 });
  await git.resolve("/r", at(0));
  await git.resolve("/r/", at(0));
  expect(calls).toBe(2);
  await git.resolve("/r", at(60000));
  expect(calls).toBe(2);
  await git.resolve("/r", at(60001));
  await git.resolve("/r", at(60001));
  expect(calls).toBe(4);
});

test("runner failure falls back to the pointer files", async () => {
  const root = tempRoot();
  const main = gitRepo(path.join(root, "main"), "trunk");
  expect((await withRunner(() => ({ code: 128, stdout: "" })).resolve(main))!.branch).toBe("trunk");
  const throwing = withRunner(() => {
    throw new Error("git not found");
  });
  expect((await throwing.resolve(main))!.branch).toBe("trunk");
});
