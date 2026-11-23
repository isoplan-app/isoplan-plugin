// Which projects a session may report as (isoplan-app/isoplan#91), in order: its folder's repo, or,
// for a workspace (a folder git can't place that holds one to `workspaceRepos` repos directly, never
// the home folder or one above it), each of those repos by name. The session reports as the first
// the office takes (approved.ts SessionGate), and a workspace's own folder needs no approving: it is
// never named. A plain folder that isn't a workspace is its own local project, as before.

import os from "node:os";
import type { Facts, Project } from "@isoplan/protocol";
import { createGit, join, pathKey, relativeTo, type MaybePromise, type Stat, type Where } from "./git.js";
import { cachedRepos } from "./approved.js";
import { projectOf } from "./identity.js";
import { nodeIo, type DirEntry } from "./io.js";
import type { RemoteNames } from "./remote-names.js";

export interface HomeIo {
  resolve(dir: string): Promise<Where | null>;
  projectOf(where: Where | null, dir: string): MaybePromise<Project>;
  stat(path: string): Promise<Stat | null>;
  listDir(dir: string): Promise<DirEntry[]>;
  /** The person's home folder: never a workspace, nor any folder above it. */
  home: string;
  workspaceRepos: number;
}

/** The projects `folder` may report as, and whether it is a workspace. */
export async function candidatesOf(folder: string, io: HomeIo): Promise<{ projects: Project[]; workspace: boolean }> {
  const where = await io.resolve(folder);
  if (where) return { projects: [await io.projectOf(where, folder)], workspace: false };
  const tooWide = pathKey(folder) === pathKey(io.home) || relativeTo(folder, io.home) !== null;
  const st = await io.stat(folder);
  const repos: string[] = [];
  if (!tooWide && st?.isDir) {
    for (const e of await io.listDir(folder)) if (e.isDir && (await io.stat(join(folder, `${e.name}/.git`)))) repos.push(join(folder, e.name));
  }
  if (!repos.length || repos.length > io.workspaceRepos) return { projects: [await io.projectOf(null, folder)], workspace: false };
  const projects: Project[] = [];
  for (const dir of repos.sort()) {
    const at = await io.resolve(dir);
    if (at) projects.push(await io.projectOf(at, dir));
  }
  return { projects, workspace: true };
}

/**
 * A workspace's facts as they may leave the machine: only its work inside a repo, each named by its
 * repo; files outside every repo, and a command's file there, stay on the machine. Which of those
 * repos may go is the link's filter (attribution.ts forOffice), by the server's welcome.
 */
export function inRepos(facts: Facts): Facts {
  const placed = <T extends { project?: unknown }>(list: T[]) => (list.every((f) => f.project) ? list : list.filter((f) => f.project));
  return {
    ...facts,
    edits: placed(facts.edits),
    reads: placed(facts.reads),
    ...(facts.areas && { areas: placed(facts.areas) }),
    agents: facts.agents.map((a) => (a.doing && !a.doing.project && a.doing.file !== undefined ? { ...a, doing: { kind: a.doing.kind, since: a.doing.since } } : a)),
  };
}

/** The first of `folder`'s candidates on `repos`: what a session there reports as. Null when none is, or there is no list. */
export async function approvedHome(folder: string, io: HomeIo, repos: ReadonlySet<string> | null): Promise<Project | null> {
  if (!repos) return null;
  const { projects } = await candidatesOf(folder, io);
  return projects.find((p) => repos.has(p.id.toLowerCase())) ?? null;
}

/** Whether the repo whose top is `dir` is on `repos`, for a handoff's prepare (handoff/git.ts). */
export const takesFrom =
  (io: Pick<HomeIo, "resolve" | "projectOf">, repos: ReadonlySet<string> | null) =>
  async (dir: string): Promise<boolean> => {
    const where = repos && (await io.resolve(dir));
    return !!where && repos!.has((await io.projectOf(where, dir)).id.toLowerCase());
  };

/**
 * A HomeIo on this machine, for the runner and the commands, naming GitHub repos as `names` does.
 * `strict` makes a git that can't read a remote reject rather than give a local project (identity.ts).
 * Where a folder sits in git is looked up again once older than `gitMaxAgeMs`, so the runner, which
 * keeps its HomeIo while it runs, sees a folder cloned into or `git init`-ed since (#87); a
 * command's lives only as long as the command, and keeps its answers.
 */
export function machineHomeIo(workspaceRepos: number, names: RemoteNames | null = null, machine = os.hostname(), strict = false, gitMaxAgeMs = Infinity): HomeIo {
  const io = nodeIo();
  const git = createGit(io);
  return {
    resolve: (dir) => git.resolve(dir, { now: Date.now(), maxAgeMs: gitMaxAgeMs }),
    projectOf: (where, dir) => projectOf(io.run, where, dir, machine, { names, strict }),
    stat: (p) => Promise.resolve(io.stat(p)),
    listDir: (d) => io.listDir(d),
    home: os.homedir(),
    workspaceRepos,
  };
}

/**
 * What a command (hand-over, ask the room) may say hello as: the session's home, by this machine's
 * copy of the office's list, which the session's data layer keeps fresh; or, when there is none, or
 * no fresh copy, why nothing is sent.
 */
export async function commandHome(folder: string, io: HomeIo, list: { file: string; server: string; maxAgeMs: number; now?: number }): Promise<{ home: Project } | { refused: string }> {
  const repos = await cachedRepos(list.file, list.server, list.maxAgeMs, list.now);
  if (!repos) {
    return { refused: `Can't tell which repos ${list.server} takes (this machine's copy of its list is missing or older than ${Math.round(list.maxAgeMs / 60000)} minutes), so nothing is sent. A Claude Code session with the Isoplan plugin reads it again within a few minutes.` };
  }
  const { projects, workspace } = await candidatesOf(folder, io);
  const home = projects.find((p) => repos.has(p.id.toLowerCase()));
  if (home) return { home };
  return { refused: `${workspace ? "No repo in this folder is" : "This repo isn't"} one the office at ${list.server} takes, so nothing of it is sent there. An admin adds it under Repos on the floor.` };
}
