import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { expect, test, vi } from "vitest";
import { candidatesOf, commandHome, inRepos, machineHomeIo, type HomeIo } from "./home.js";
import { gitRepo, tempRoot } from "./fixture.js";
import { createGit } from "./git.js";
import { projectOf } from "./identity.js";
import { nodeIo } from "./io.js";

const MINUTE = 60000;

/** A HomeIo on fake repos (plain files), with no git binary: every repo is its local project on "desk". */
function homeIo(home: string): HomeIo {
  const io = nodeIo({ run: null });
  const git = createGit(io);
  return { resolve: (d) => git.resolve(d), projectOf: (w, d) => projectOf(null, w, d, "desk", { caseless: false }), stat: (p) => Promise.resolve(io.stat(p)), listDir: (d) => io.listDir(d), home, workspaceRepos: 12 };
}

const id = (dir: string) => `local:desk/${dir.replace(/\\/g, "/")}`;

test("a repo's folder reports as its repo; a workspace as its repos, by name; the home folder never is one", async () => {
  const root = tempRoot();
  const repo = gitRepo(path.join(root, "app"));
  const ws = path.join(root, "work");
  gitRepo(path.join(ws, "web"));
  gitRepo(path.join(ws, "api"));
  fs.mkdirSync(path.join(ws, "notes"));
  const io = homeIo(path.join(root, "home"));
  expect(await candidatesOf(repo, io)).toEqual({ projects: [expect.objectContaining({ id: id(repo) })], workspace: false });
  const { projects, workspace } = await candidatesOf(ws, io);
  expect(workspace).toBe(true);
  expect(projects.map((p) => p.id)).toEqual([id(path.join(ws, "api")), id(path.join(ws, "web"))]);
  // A plain folder holding no repo is its own local project, as before.
  const plain = path.join(root, "plain");
  fs.mkdirSync(plain);
  expect((await candidatesOf(plain, io)).projects.map((p) => p.id)).toEqual([id(plain)]);
  expect((await candidatesOf(ws, { ...io, home: ws })).workspace).toBe(false);
});

test("the runner's HomeIo asks git again once gitMaxAgeMs has passed: a folder git init-ed since is a repo (#87)", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  try {
    const folder = path.join(tempRoot(), "later");
    fs.mkdirSync(folder);
    const io = machineHomeIo(12, null, "desk", false, MINUTE);
    expect(await io.resolve(folder)).toBe(null);
    execFileSync("git", ["init", "-q"], { cwd: folder });
    expect(await io.resolve(folder)).toBe(null);
    vi.setSystemTime(Date.now() + MINUTE + 1);
    expect((await io.resolve(folder))?.toplevel).toMatch(/\/later$/);
  } finally {
    vi.useRealTimers();
  }
});

function list(file: string, repos: string[], checked: number) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ server: "wss://office.example/data-layer", version: "v1", repos, fetched: checked, checked }));
}

test("the commands say hello only as a repo on a fresh copy of the list: from a workspace, its first approved repo", async () => {
  const root = tempRoot();
  const ws = path.join(root, "work");
  gitRepo(path.join(ws, "api"));
  gitRepo(path.join(ws, "web"));
  const file = path.join(root, "approved.json");
  const io = homeIo(path.join(root, "home"));
  const now = Date.now();
  const at = { file, server: "wss://office.example/data-layer", maxAgeMs: 15 * MINUTE, now };

  expect(await commandHome(ws, io, at)).toEqual({ refused: expect.stringContaining("Can't tell which repos") });
  list(file, [id(path.join(ws, "web"))], now);
  expect(await commandHome(ws, io, at)).toEqual({ home: expect.objectContaining({ id: id(path.join(ws, "web")) }) });
  list(file, ["github.com/team/other"], now);
  expect(await commandHome(ws, io, at)).toEqual({ refused: expect.stringContaining("No repo in this folder is one the office") });
  expect(await commandHome(path.join(ws, "api"), io, at)).toEqual({ refused: expect.stringContaining("This repo isn't one the office") });
  // A copy past its maximum age approves nothing.
  list(file, [id(path.join(ws, "web"))], now - 16 * MINUTE);
  expect(await commandHome(ws, io, at)).toEqual({ refused: expect.stringContaining("older than 15 minutes") });
});

test("a workspace's facts leave only with what is inside a repo: its own files, and a command's file there, stay", () => {
  const at = "2026-10-30T09:00:00.000Z";
  const api = { id: "github.com/team/api", name: "api" };
  const lead = { id: "s:lead", source: "claude-code" as const, session: "s", startedBy: null, agentType: null, task: null, status: "working" as const, statusSince: at, lastActive: at, usage: null };
  const facts = {
    session: { id: "s", source: "claude-code" as const, lead: "s:lead", title: "t", titleFrom: "source" as const, branch: null, lastActive: at, status: "active" as const, lights: "on" as const },
    agents: [{ ...lead, doing: { kind: "write" as const, file: "notes.md", since: at } }, { ...lead, id: "s:a2", doing: { kind: "write" as const, file: "a.ts", since: at, project: api } }],
    edits: [{ agent: "s:lead", file: "a.ts", at, project: api }, { agent: "s:lead", file: "notes.md", at }],
    reads: [{ agent: "s:lead", file: "plan.md", at }],
    waits: [],
    reports: [],
  };
  const kept = inRepos(facts);
  expect(kept.edits).toEqual([facts.edits[0]]);
  expect(kept.reads).toEqual([]);
  expect(kept.agents.map((a) => a.doing)).toEqual([{ kind: "write", since: at }, facts.agents[1]!.doing]);
});
