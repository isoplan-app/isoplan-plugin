import { MAX_BRANCH_LENGTH, MAX_FOLDER_LENGTH, MAX_FOLDER_REPOS, MAX_REPO_BRANCHES } from "@isoplan/protocol";
import { expect, test } from "vitest";
import { pathKey } from "../data-layer/git.js";
import { repoFolders, type RepoFoldersOptions } from "./repo-folders.js";

// A fake AWS key id, split so no key-shaped string sits in the source.
const AWS_KEY = "AKIA" + "ABCDEFGHIJKLMNOP";
const APP = "github.com/ada/app";
const API = "github.com/ada/api";

// Each folder's main checkout and each checkout's repo, by key, as checkouts.ts and the office's home
// would say; a folder with no checkout given is its own; a checkout with no repo is in none the office takes.
const options = ({ checkouts = {}, homes, branches = {}, logs = [], claudeDir = "/Users/ada/.claude" }: { checkouts?: Record<string, string>; homes: Record<string, string>; branches?: Record<string, string[] | null>; logs?: string[]; claudeDir?: string }): RepoFoldersOptions => {
  const by = <T>(o: Record<string, T>) => new Map(Object.entries(o).map(([k, v]) => [pathKey(k), v]));
  const [c, h, b] = [by(checkouts), by(homes), by(branches)];
  return {
    claudeDir,
    checkout: async (folder) => c.get(pathKey(folder)) ?? folder,
    home: async (folder) => h.get(pathKey(folder)) ?? null,
    branches: async (checkout) => b.get(pathKey(checkout)) ?? null,
    scan: async (text) => (text.includes(AWS_KEY) ? "aws-access-key" : null),
    log: (t) => void logs.push(t),
    leftOut: new Set<string>(),
  };
};

test.each([
  ["Windows", { app: "C:\\Users\\Ada\\code\\app", wt: (i: number) => `C:\\Users\\Ada\\orca\\workspaces\\app\\wt-${i}`, api: "D:\\work\\api", apiWt: "D:\\work\\api-wt", other: "C:\\Users\\Ada\\notes" }],
  ["macOS", { app: "/Users/ada/code/app", wt: (i: number) => `/Users/ada/orca/workspaces/app/wt-${i}`, api: "/Volumes/work/api", apiWt: "/Volumes/work/api-wt", other: "/Users/ada/notes" }],
])("%s: each repo once, by its main checkout, the most recently used first, with its remote's branches; a repo used only in worktrees is offered", async (_, f) => {
  const worktrees = Array.from({ length: 6 }, (_, i) => f.wt(i));
  const seen = [...worktrees.map((folder, i) => ({ folder, at: 100 - i })), { folder: f.apiWt, at: 50 }, { folder: f.other, at: 200 }];
  const checkouts = { ...Object.fromEntries(worktrees.map((w) => [w, f.app])), [f.apiWt]: f.api };
  expect(await repoFolders(seen, options({ checkouts, homes: { [f.app]: APP, [f.api]: API }, branches: { [f.app]: ["main", "feat/dark"] } }))).toEqual([
    { project: APP, folders: [f.app], branches: ["main", "feat/dark"] },
    // Its remote couldn't be asked: listed with no branches.
    { project: API, folders: [f.api] },
  ]);
});

test("a folder or a branch the secret scan matches, or one too long to send, is left out, never cut; past the limits the least recently used repos and the last branches go", async () => {
  const logs: string[] = [];
  const secret = `/Users/ada/${AWS_KEY}/app`;
  const long = `/Users/ada/${"x".repeat(MAX_FOLDER_LENGTH)}`;
  const repos = Array.from({ length: MAX_FOLDER_REPOS + 1 }, (_, i) => `/Users/ada/repo-${i}`);
  const many = Array.from({ length: MAX_REPO_BRANCHES + 1 }, (_, i) => `feat/${i}`);
  const homes: Record<string, string> = { [secret]: APP, [long]: APP, "/Users/ada/app": APP };
  repos.forEach((r, i) => (homes[r] = `github.com/ada/repo-${i}`));
  const seen = [{ folder: secret, at: 1000 }, { folder: long, at: 999 }, { folder: "/Users/ada/app", at: 998 }, ...repos.map((folder, i) => ({ folder, at: 800 - i }))];
  const branches = { "/Users/ada/app": [`leak-${AWS_KEY}`, "x".repeat(MAX_BRANCH_LENGTH + 1), ...many] };
  const listed = await repoFolders(seen, options({ homes, branches, logs }));
  expect(listed[0]).toEqual({ project: APP, folders: ["/Users/ada/app"], branches: many.slice(0, MAX_REPO_BRANCHES) });
  expect(listed).toHaveLength(MAX_FOLDER_REPOS);
  expect(listed.at(-1)!.project).toBe(`github.com/ada/repo-${MAX_FOLDER_REPOS - 2}`);
  expect(logs).toEqual([
    `a folder of ${APP} wasn't listed for starting sessions from the floor: it matches the secret pattern "aws-access-key"`,
    `a branch of ${APP} wasn't listed for starting sessions from the floor: it matches the secret pattern "aws-access-key"`,
  ]);
});

test("a folder the secret scan leaves out is logged when it is first left out, not on every check after", async () => {
  const logs: string[] = [];
  const secret = `/Users/ada/${AWS_KEY}/app`;
  const o = options({ homes: { [secret]: APP }, logs });
  const seen = [{ folder: secret, at: 2 }];
  await repoFolders(seen, o);
  await repoFolders(seen, o);
  expect(logs).toHaveLength(1);
  // Gone for a check, then back: logged again.
  await repoFolders([], o);
  await repoFolders(seen, o);
  expect(logs).toHaveLength(2);
});

test("a folder with no checkout to list, or whose checkout is in no repo the office takes, isn't listed", async () => {
  const o = options({ checkouts: {}, homes: { "/Users/ada/app": APP } });
  o.checkout = async (folder) => (folder.endsWith("gone") ? null : folder);
  expect(await repoFolders([{ folder: "/Users/ada/wt-gone", at: 3 }, { folder: "/Users/ada/notes", at: 2 }, { folder: "/Users/ada/app", at: 1 }], o)).toEqual([{ project: APP, folders: ["/Users/ada/app"] }]);
});

test.each([
  // Spelt in another case, as Windows allows.
  ["Windows", "C:\\Users\\Ada\\.claude", "C:\\Users\\Ada\\code\\app", ["c:/users/ada/.CLAUDE/Isoplan/experts/adr/read", "C:\\Users\\Ada\\.claude\\isoplan\\clones\\app"]],
  ["macOS", "/Users/ada/.claude", "/Users/ada/code/app", ["/Users/ada/.claude/isoplan/experts/adr/read", "/Users/ada/.claude/isoplan/clones/app"]],
])("%s: Isoplan's own folders, an expert's read/ or Isoplan's clone, are never listed, even used more recently than the person's clone", async (_, claudeDir, app, own) => {
  const o = options({ claudeDir, homes: Object.fromEntries([app, ...own].map((f) => [f, APP])) });
  expect(await repoFolders([...own.map((folder, i) => ({ folder, at: 10 - i })), { folder: app, at: 1 }], o)).toEqual([{ project: APP, folders: [app] }]);
});

test("every repo's remote is asked at once: two slow ones hold the list up by one wait, not two, and the order is kept", async () => {
  const o = options({ homes: { "/code/app": APP, "/code/api": API } });
  const delay = 300;
  o.branches = (checkout) => new Promise((done) => setTimeout(() => done([pathKey(checkout).endsWith("app") ? "main" : "dev"]), delay));
  const started = Date.now();
  const repos = await repoFolders([{ folder: "/code/app", at: 2 }, { folder: "/code/api", at: 1 }], o);
  expect(Date.now() - started).toBeLessThan(delay * 1.8);
  expect(repos).toEqual([
    { project: APP, folders: ["/code/app"], branches: ["main"] },
    { project: API, folders: ["/code/api"], branches: ["dev"] },
  ]);
});
