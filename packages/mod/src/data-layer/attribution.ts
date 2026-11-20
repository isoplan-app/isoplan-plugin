// Which repo an edit, a read or a command lands in (#74), so the floor can show an agent working in
// another repo there. Home is the session's folder: a file in a repo inside it is home, whichever
// repo that is (a workspace folder holding several repos stays one room); a file in a repo outside
// it is away. The session's own project, reached through another worktree or a second clone with
// the same remote, is the session's own: no project is named for it.
//
// A file is credited to the innermost repo it is in, whatever folder the call was made from: git
// is asked once, at the file's nearest folder that exists (so a file not written yet is placed
// too), and remembers the answer. Paths are compared after symlinks are resolved, as git reports
// its top level resolved.
//
// What is worked out here never leaves the machine by itself: `forOffice` keeps a file, command or
// subagent's checkout in another repo only when the server's office holds that repo and the server
// said it reads them.

import type { Facts, Project } from "@isoplan/protocol";
import { dirname, normalize, pathKey, relativeTo, type MaybePromise, type Stat, type Where } from "./git.js";

/** Where something landed: `file` relative to its repo's root, and the repo when it isn't the session's. */
export interface Placed {
  file: string;
  project?: Project;
  away?: true;
}

export interface AttributionInput {
  /** The session's folder. */
  folder: string;
  /** Where that folder sits in git; null for a workspace folder above its repos. */
  where: Where | null;
  resolve: (dir: string) => Promise<Where | null>;
  projectOf: (where: Where) => MaybePromise<Project>;
  stat: (path: string) => MaybePromise<Stat | null>;
  /** The path with symlinks resolved; the path itself when it can't be. */
  realpath: (path: string) => MaybePromise<string>;
  /** Which folders exist and where links lead, kept across passes (attributionCache). */
  cache: AttributionCache;
  now: number;
}

/** How long what a folder is (there or not, where its links lead) is believed. */
const CACHE_MS = 10_000;

export interface AttributionCache {
  exists: Map<string, { at: number; value: Promise<boolean> }>;
  real: Map<string, { at: number; value: Promise<string> }>;
}

/** Keep one for the life of the data layer; an entry older than CACHE_MS is looked up again. */
export const attributionCache = (): AttributionCache => ({ exists: new Map(), real: new Map() });

export interface Attribution {
  /** The file at absolute `path`; null when it is in no repo and not in a workspace. */
  file(path: string): Promise<Placed | null>;
  /** The repo a command run in `dir` works in: {} for the session's own, null when it is in none. */
  dir(dir: string): Promise<Omit<Placed, "file"> | null>;
  /**
   * The nearest folder that exists at or above absolute `path` (a folder, or a file in one),
   * relative to its repo's root (`.` for the root itself), with the repo as for a file; null when
   * it is in no repo and not in a workspace.
   */
  folder(path: string): Promise<(Omit<Placed, "file"> & { folder: string }) | null>;
}

/** One pass's: what folders are is remembered across passes in `cache`. */
export function createAttribution({ folder, where: home, resolve, projectOf, stat, realpath, cache, now }: AttributionInput): Attribution {
  const homeProject = home ? Promise.resolve(projectOf(home)) : null;
  const remember = <T>(map: Map<string, { at: number; value: Promise<T> }>, p: string, look: () => Promise<T>): Promise<T> => {
    const key = pathKey(p);
    const hit = map.get(key);
    if (hit && now - hit.at <= CACHE_MS) return hit.value;
    const value = look();
    map.set(key, { at: now, value });
    return value;
  };
  const realOf = (p: string) => remember(cache.real, p, () => Promise.resolve(realpath(p)).then(normalize, () => normalize(p)));
  const isThere = (p: string) => remember(cache.exists, p, () => Promise.resolve(stat(p)).then((s) => !!s?.isDir, () => false));
  const homeFolder = realOf(folder);

  // `path`'s nearest folder that exists (`path` itself when it is one), with symlinks resolved and
  // the rest of the path after it, and the repo git places it in. `found` is that folder itself.
  async function locate(path: string, isDir: boolean): Promise<{ real: string; found: string; where: Where | null }> {
    const p = normalize(path);
    let at = isDir ? p : dirname(p);
    while (!(await isThere(at))) {
      const up = dirname(at);
      if (up === at) return { real: p, found: p, where: null };
      at = up;
    }
    const realAt = await realOf(at);
    const rest = p.slice(at.length).replace(/^\/+/, "");
    const where = await resolve(realAt);
    return { real: rest ? `${realAt.replace(/\/$/, "")}/${rest}` : realAt, found: realAt, where: where && { ...where, toplevel: await realOf(where.toplevel) } };
  }

  // `dir` relative to `root`: `.` for the root itself, null outside it.
  const under = (root: string, dir: string) => (pathKey(root) === pathKey(dir) ? "." : relativeTo(root, dir));

  async function elsewhere(where: Where, real: string): Promise<Omit<Placed, "file">> {
    if (home && pathKey(where.commonDir) === pathKey(home.commonDir)) return {};
    const project = await projectOf(where);
    if (homeProject && (await homeProject).id === project.id) return {};
    const inside = relativeTo(await homeFolder, real) !== null || pathKey(await homeFolder) === pathKey(real);
    return inside ? { project } : { project, away: true };
  }

  return {
    async file(path) {
      const { real: p, where } = await locate(path, false);
      const file = where && relativeTo(where.toplevel, p);
      if (where && file) return { file, ...(await elsewhere(where, p)) };
      // A workspace's own files, outside any of its repos.
      const own = !home && relativeTo(await homeFolder, p);
      return own ? { file: own } : null;
    },
    async dir(dir) {
      const { real: d, where } = await locate(dir, true);
      if (where) return elsewhere(where, d);
      return !home && (relativeTo(await homeFolder, d) !== null || pathKey(await homeFolder) === pathKey(d)) ? {} : null;
    },
    async folder(path) {
      const { found, where } = await locate(path, true);
      const folder = where && under(where.toplevel, found);
      if (where && folder) return { folder, ...(await elsewhere(where, found)) };
      // A workspace's own folders, outside any of its repos.
      const own = !home && under(await homeFolder, found);
      return own ? { folder: own } : null;
    },
  };
}

/**
 * The facts as they may leave the machine: a file, command, area or subagent's checkout in another repo
 * only when `projects`, the office's from the server's welcome, holds that repo. Without a welcome
 * (an older server, or none yet on this connection) none of them leave. `checkouts` names the
 * project of each subagent whose worktree is another repo's, by agent id.
 */
export function forOffice(facts: Facts, projects: ReadonlySet<string> | null, checkouts: Readonly<Record<string, string>> = {}): Facts {
  const held = (id: string) => projects !== null && projects.has(id.toLowerCase());
  const ok = (p: Project | undefined) => !p || held(p.id);
  const files = (list: Facts["edits"]) => (list.every((f) => ok(f.project)) ? list : list.filter((f) => ok(f.project)));
  return {
    ...facts,
    agents: facts.agents.map((a) => {
      let out = a.doing && !ok(a.doing.project) ? { ...a, doing: { kind: a.doing.kind, since: a.doing.since } } : a;
      const elsewhere = Object.hasOwn(checkouts, a.id) ? checkouts[a.id]! : null;
      if (elsewhere !== null && !held(elsewhere) && (out.checkout !== undefined || out.branch !== undefined)) {
        const { checkout: _c, branch: _b, ...rest } = out;
        out = rest;
      }
      return out;
    }),
    edits: files(facts.edits),
    reads: files(facts.reads),
    ...(facts.areas && { areas: facts.areas.every((a) => ok(a.project)) ? facts.areas : facts.areas.filter((a) => ok(a.project)) }),
  };
}
