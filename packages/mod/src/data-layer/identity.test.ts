import { expect, test } from "vitest";
import type { Run } from "./git.js";
import { accountOf, claudePaths, projectOf } from "./identity.js";

const CLAUDE_JSON = "/home/ada/.claude.json";
const git = (answers: Record<string, string>): Run => (argv) => {
  const out = answers[argv.slice(1).join(" ")];
  return out === undefined ? { code: 1, stdout: "" } : { code: 0, stdout: out + "\n" };
};
const account = (claudeJson: object | string | null, run: Run | null = git({ "config user.name": "Ada Lovelace" })) => {
  const read: string[] = [];
  const io = {
    readText: (p: string) => {
      read.push(p);
      return claudeJson === null ? null : typeof claudeJson === "string" ? claudeJson : JSON.stringify(claudeJson);
    },
    run,
  };
  return accountOf(io, CLAUDE_JSON, "/repo").then((a) => ({ ...a, read }));
};

test("identity: the Claude account's uuid and display name, never the email; only ~/.claude.json is read", async () => {
  const a = await account({ userID: "install-1", oauthAccount: { accountUuid: "4f9c-uuid", displayName: "Ada", emailAddress: "ada@example.com" } });
  expect(a).toEqual({ id: "claude:4f9c-uuid", name: "Ada", read: [CLAUDE_JSON] });
});

test("identity: without an account, the install's userID, named by git", async () => {
  expect(await account({ userID: "install-1" })).toMatchObject({ id: "claude-install:install-1", name: "Ada Lovelace" });
  expect(await account({ userID: "install-1", oauthAccount: { accountUuid: "" } })).toMatchObject({ id: "claude-install:install-1" });
});

test("identity: then git's user.name; with nothing at all, unknown", async () => {
  expect(await account(null)).toMatchObject({ id: "git:Ada Lovelace", name: "Ada Lovelace" });
  expect(await account("{ not json")).toMatchObject({ id: "git:Ada Lovelace" });
  expect(await account(null, null)).toMatchObject({ id: "git:unknown", name: "" });
});

test("Claude's folder and .claude.json: in $CLAUDE_CONFIG_DIR when it is set, else ~/.claude and ~/.claude.json", () => {
  expect(claudePaths({}, "C:\\Users\\ada")).toEqual({ dir: "C:/Users/ada/.claude", json: "C:/Users/ada/.claude.json" });
  expect(claudePaths({ CLAUDE_CONFIG_DIR: "" }, "/home/ada")).toEqual({ dir: "/home/ada/.claude", json: "/home/ada/.claude.json" });
  expect(claudePaths({ CLAUDE_CONFIG_DIR: "/home/ada/.claude-work" }, "/home/ada")).toEqual({ dir: "/home/ada/.claude-work", json: "/home/ada/.claude-work/.claude.json" });
});

test("project: the remote names it; without one, the main checkout's folder on this machine", async () => {
  const where = { toplevel: "C:/w/repo-wt", commonDir: "C:/w/repo/.git", branch: "x" };
  expect(await projectOf(git({ "remote get-url origin": "git@github.com:Adam/Isoplan.git" }), where, "C:/w/repo-wt", "sevengill")).toEqual({ id: "github.com/adam/isoplan", name: "Isoplan" });
  expect(await projectOf(git({}), where, "C:/w/repo-wt", "sevengill", { caseless: false })).toEqual({ id: "local:sevengill/C:/w/repo", name: "repo" });
  expect(await projectOf(null, null, "C:\\w\\loose", "sevengill", { caseless: false })).toEqual({ id: "local:sevengill/C:/w/loose", name: "loose" });
  // Where the file system ignores case, a local project is one whatever spelling reached it.
  expect(await projectOf(null, null, "C:\\W\\Loose", "Sevengill", { caseless: true })).toEqual({ id: "local:sevengill/c:/w/loose", name: "Loose" });
  expect(await projectOf(git({ "remote get-url origin": "git@github.com:Adam/Isoplan.git" }), where, "C:/w/repo-wt", "sevengill", { caseless: true })).toEqual({ id: "github.com/adam/isoplan", name: "Isoplan" });
});

test("project: strict, a remote git can't read rejects; exit 2 (no such remote) is still a local project", async () => {
  const where = { toplevel: "C:/w/repo", commonDir: "C:/w/repo/.git", branch: "x" };
  const exits = (code: number): Run => () => ({ code, stdout: "" });
  const throws: Run = () => Promise.reject(new Error("spawn git ENOENT"));
  const local = { id: "local:sevengill/C:/w/repo", name: "repo" };
  expect(await projectOf(exits(2), where, "C:/w/repo", "sevengill", { caseless: false, strict: true })).toEqual(local);
  expect(await projectOf(exits(0), where, "C:/w/repo", "sevengill", { caseless: false, strict: true })).toEqual(local);
  await expect(projectOf(exits(128), where, "C:/w/repo", "sevengill", { strict: true })).rejects.toThrow(/exit 128/);
  await expect(projectOf(exits(1), where, "C:/w/repo", "sevengill", { strict: true })).rejects.toThrow(/exit 1/);
  await expect(projectOf(throws, where, "C:/w/repo", "sevengill", { strict: true })).rejects.toThrow(/ENOENT/);
  // Without strict, as before: any of those is a local project.
  expect(await projectOf(exits(128), where, "C:/w/repo", "sevengill", { caseless: false })).toEqual(local);
  expect(await projectOf(throws, where, "C:/w/repo", "sevengill", { caseless: false })).toEqual(local);
});
