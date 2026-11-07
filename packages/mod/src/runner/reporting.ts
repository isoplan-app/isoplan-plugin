// The runner reports every Claude Code session on the machine (ADR 0007): headless ones, those the
// runner drives from the floor, sessions without the plugin, and those whose hooks module is
// connected to the runner's pipe (src/pipe). It looks at <claude dir>/projects every `streamSeconds`,
// and reports each session in its own process (report-session.ts), one link per session to each
// office.
//
// A session whose hooks module is connected (`hooked`) is reported for that hooks module as soon as
// its transcript is there, however long ago it was written, and as long as the connection lasts.
// When the session's hooks module connects, changes (another window, a reload) or goes, the report
// under way stops and the session is reported again for the one it has now (`rehook`); with none,
// only once its transcript moves, so a session with the plugin that closes goes unreachable, as
// before. A hooks module's report that ended by itself (the plugin turned off, say) starts again
// once the transcript moves.
//
// Any other top-level transcript written within `idleMinutes` (on its first look, within
// `lightsOffHours`, so a runner just started fills the office back in) is reported without a hooks
// module. On its first look none starts before twice `runnerRetrySeconds` has passed: the hooks
// modules of a runner that started again say hello within one, and their sessions are reported for
// them from the start, not without them first. Not while the transcript names no folder yet or the folder has gone, or while Claude Code
// lists the plugin as uninstalled or disabled for the folder.
//
// Either way, not while the session's lock in <claude dir>/isoplan/live names another live process
// that keeps it fresh: the data layer process of an earlier version of the plugin, for a session
// still on that version; except one a hooks module's report takes the lock over from (takesOver in
// report-session.ts, for a copy that isn't outdated, as the report itself decides), and one that lets it go is reported for its hooks module at the next look.
// One that took the lock back from a hooks module's report (its copy goes by another newest copy) is
// left the session until it lets go, so the two don't take it from each other again and again. The runner counts a lock as fresh for three of its own slowest passes
// (lockFreshMs, from its config.json). A connected hooks module whose session such a data layer
// keeps is told so (`held`), once for each connection, and nothing is reported for it: the runner's
// worker tells it it is `superseded` (`earlier`), which closes its connection, and its hooks module
// connects again a while later, when the session is reported for it if the lock has let go (#114).
//
// A session it stopped reporting without a hooks module (quiet past `idleMinutes`, nothing to
// report, its link down five minutes, or an earlier version's data layer took its lock over) is
// reported again once its transcript moves; one it found such a data layer reporting, once its
// transcript moves after a look that found the lock let go, even when its last write and its lock
// letting go fall between two looks. One that ended with a hold-off (no office
// wants its project, git can't place its folder, or no office takes its repo) isn't reported again before the hold-off ends; one no office took is,
// as its transcript moves, once a fresh copy of one office's list takes one of its repos: only of an
// office it reported to or that config.json names now, never of one that didn't want it. The
// offices that didn't want it are left alone, each until its own hold-off ends. The hold-offs live
// here, in the runner's memory: a runner started again asks each office afresh.

import fs from "node:fs/promises";
import path from "node:path";
import { approvedFiles, freshRepos, readApproved } from "../data-layer/approved-file.js";
import { officesOf, type Config } from "../data-layer/config.js";
import type { NodeIo } from "../data-layer/io.js";
import { hookedEnv, lockFreshMs, outdatedCopy, takesOver, type Ended } from "../data-layer/report-session.js";
import { alive, lockPath, readLock } from "../wake/lock.js";

// On its first look, the gap between starting two sessions that are already quiet, so each is
// mostly reported before the next starts; those still at work start together, once the first look's
// hold of twice runnerRetrySeconds has passed.
export const GAP_MS = 250;
// How long stop() waits for its reports to end: one stuck in a pass (a slow git call or office)
// is left behind, so the runner's worker still exits.
export const STOP_WAIT_MS = 5000;

/** One session for `report`: it reports it until `closed` settles, or until it should stop. */
export interface ToReport<H = unknown> {
  sessionId: string;
  cwd: string;
  /** The offices that didn't want it, each until when. */
  notWanted: Record<string, number>;
  /** Settles when it should stop, with why. */
  closed: Promise<string>;
  /** The session's hooks module, connected to the runner's pipe, to report it for; none without. */
  hooks?: H;
}

/** A connected hooks module, as `hooked` gives it: its session's folder, the plugin's folder it runs from and when its window started, and the session's own environment it passed on. */
export interface HookedSession {
  cwd: string;
  root?: string;
  since?: number;
  env?: Record<string, string>;
}

export interface ReportingOptions<H extends HookedSession = HookedSession> {
  claudeDir: string;
  io: NodeIo;
  /** config.json as it is now. */
  config: () => Promise<Config>;
  /** Reports one session in this process (reportSession). */
  report: (session: ToReport<H>) => Promise<Ended>;
  /** The session's connected hooks module, or null. */
  hooked?: (sessionId: string) => H | null;
  /** Tells a connected hooks module that an earlier version's data layer keeps its session, so nothing reports it for that hooks module; once for each. */
  held?: (sessionId: string, hooks: H) => void;
  /** Whether Claude Code lists the plugin as uninstalled or disabled for a folder. */
  isOff: (folder: string) => Promise<boolean>;
  log: (text: string) => void;
  isAlive?: (pid: number) => boolean;
  /** This process's pid, which its sessions' locks name. */
  pid?: number;
  gapMs?: number;
  stopWaitMs?: number;
}

export interface Reporting {
  /** Whether a session is held off now (see above), so the runner answers no question for it. */
  heldOff(sessionId: string): boolean;
  /** The sessions it reports now. */
  reporting(): string[];
  /** Looks once (it looks by itself every `streamSeconds`). */
  look(): Promise<void>;
  /** The session's hooks module connected, changed or went: it is reported again for the one it has now. */
  rehook(sessionId: string): void;
  /** Stops reporting every session, and looking; waits for the reports to end at most `stopWaitMs`. */
  stop(): Promise<void>;
}

interface Seen {
  file: string;
  mtimeMs: number;
  size: number;
  cwd: string | null;
  running: { stop: (why: string) => void; done: Promise<void>; hooks: unknown } | null;
  /** The hooks module the last report was for (null for none), once it ended. */
  endedFor: unknown;
  /** Waiting its turn on the first look. */
  queued: boolean;
  /** The transcript's write time as it last ended, or was left; it is reported again once the transcript is written after that. */
  endedAt: number | null;
  holdOff: Ended["holdOff"] | null;
  notWanted: Record<string, number>;
  /** Another process held its lock at the last look that checked. */
  held: boolean;
  /** The process that held its lock as a hooks module's report ended: it took the lock back, and isn't taken it from again. */
  tookBack: number | null;
  /** The hooks module last told that an earlier version's data layer keeps the session. */
  told: unknown;
}

const HEAD_BYTES = 65536;

/** The first folder a transcript's lines name, from its first and last 64 KB. */
export async function cwdOf(io: NodeIo, file: string, size: number): Promise<string | null> {
  for (const [start, end] of [[0, HEAD_BYTES], [Math.max(0, size - HEAD_BYTES), size]] as const) {
    for (const text of (await io.read(file, start, end).catch(() => "")).split("\n")) {
      if (!text.includes('"cwd"')) continue;
      try {
        const cwd = (JSON.parse(text) as { cwd?: unknown }).cwd;
        if (typeof cwd === "string" && cwd) return cwd;
      } catch {
        // A line cut by the window's edge.
      }
    }
  }
  return null;
}

/** Why a report for hooks module `from` stops when the session has `to` (either none), as its log says it. */
const changed = (from: unknown, to: unknown) =>
  !to ? "its hooks module's link to the runner closed" : !from ? "its hooks module connected to the runner, which reports it for that hooks module now" : "another hooks module has the session now (another window, or a reload)";

export function watchSessions<H extends HookedSession>(o: ReportingOptions<H>): Reporting {
  const { claudeDir, io, isAlive = alive, pid = process.pid, gapMs = GAP_MS, stopWaitMs = STOP_WAIT_MS } = o;
  const projectsDir = path.join(claudeDir, "projects");
  const seen = new Map<string, Seen>();
  // The sessions whose report stopped for a change of hooks module, to look again once it has ended.
  const rehooked = new Set<string>();
  let first = true;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let said = ""; // a lasting problem is logged once

  const start = (id: string, s: Seen, cwd: string, hooks: H | null = null) => {
    let close = (_why: string) => {};
    const closed = new Promise<string>((resolve) => (close = resolve));
    const now = Date.now();
    const notWanted = Object.fromEntries(Object.entries(s.notWanted).filter(([, until]) => until > now));
    const done = o
      .report({ sessionId: id, cwd, notWanted, closed, ...(hooks && { hooks }) })
      .then(
        (ended) => {
          if (ended.holdOff) {
            s.holdOff = ended.holdOff;
            s.notWanted = ended.holdOff.notWanted;
          }
        },
        (err: unknown) => o.log(`couldn't report session ${id}: ${String((err as Error)?.stack ?? err)}`),
      )
      .finally(async () => {
        if (hooks) {
          const lock = await readLock(lockPath(claudeDir, id)).catch(() => null);
          if (lock?.pid && lock.pid !== pid && isAlive(lock.pid)) s.tookBack = lock.pid;
        }
        // The write time first: a look between the two would start it again at once.
        s.endedAt = (await io.stat(s.file))?.mtimeMs ?? s.mtimeMs;
        s.endedFor = hooks;
        s.running = null;
        // Stopped for another hooks module (or none): reported again for it at once.
        if (rehooked.delete(id) && !stopped) void lookOnce();
      });
    s.running = { stop: close, done, hooks };
  };

  /** Whether a fresh copy of an office's list takes one of the repos a hold-off names (see above). */
  const nowTaken = async (holdOff: NonNullable<Ended["holdOff"]>, config: Config) => {
    const now = Date.now();
    const configured = officesOf(config).map((office) => office.server);
    for (const file of await approvedFiles(claudeDir)) {
      const copy = await readApproved(file);
      if (!copy || (!holdOff.offices.includes(copy.server) && !configured.includes(copy.server)) || (holdOff.notWanted[copy.server] ?? 0) > now) continue;
      const repos = freshRepos(copy, config.approvedMaxAgeMinutes * 60000, now);
      if (repos && holdOff.projects!.some((p) => repos.has(p))) return true;
    }
    return false;
  };

  /** Whether the session's lock names another live process that keeps it fresh, and that a report for `hooks` wouldn't take it over from (as reportSession decides it). */
  const heldByAnother = async (id: string, now: number, config: Config, hooks?: H, tookBack: number | null = null) => {
    const lock = await readLock(lockPath(claudeDir, id));
    if (hooks?.root && hooks.since !== undefined && lock?.pid !== tookBack) {
      const self = path.join(hooks.root, "dist", "data-layer.js");
      if (takesOver(lock, self, hooks.since, pid) && !(await outdatedCopy(claudeDir, hookedEnv(hooks.env), self, hooks.cwd))) return false;
    }
    return !!lock?.pid && lock.pid !== pid && isAlive(lock.pid) && now - lock.mtimeMs < lockFreshMs(config);
  };

  const look = async () => {
    const config = await o.config();
    const now = Date.now();
    const windowMs = Math.max(config.idleMinutes * 60000, first ? config.lightsOffHours * 3600000 : 0);
    const quiet: [string, Seen, string][] = [];
    const recent: [string, Seen, string][] = []; // on the first look, those to start once the hooks modules have said hello
    for (const dir of await io.listDir(projectsDir)) {
      if (!dir.isDir) continue;
      for (const entry of await io.listDir(path.join(projectsDir, dir.name))) {
        const id = entry.name.slice(0, -".jsonl".length);
        // The id names a file in the live folder, so it must be a plain name.
        if (entry.isDir || !entry.name.endsWith(".jsonl") || !/^[\w-]+$/.test(id)) continue;
        const file = path.join(projectsDir, dir.name, entry.name);
        const st = await io.stat(file);
        if (!st) continue;
        let s = seen.get(id);
        if (!s) seen.set(id, (s = { file, mtimeMs: st.mtimeMs, size: st.size, cwd: null, running: null, endedFor: null, queued: false, endedAt: null, holdOff: null, notWanted: {}, held: false, tookBack: null, told: null }));
        Object.assign(s, { file, mtimeMs: st.mtimeMs, size: st.size });
        const hooks = o.hooked?.(id) ?? null;
        if (s.running) {
          // Reported for another hooks module than the session has now: stopped, and reported again for this one.
          if (s.running.hooks !== hooks) {
            rehooked.add(id);
            s.running.stop(changed(s.running.hooks, hooks));
          }
          continue;
        }
        if (hooks) {
          // Its hooks module's report ended by itself: not again before the transcript moves.
          if (s.endedFor === hooks && s.endedAt !== null && st.mtimeMs <= s.endedAt) continue;
          // Looked at again each look, so it starts as soon as the lock lets go.
          if (await heldByAnother(id, now, config, hooks, s.tookBack)) {
            s.held = true;
            if (s.told !== hooks) {
              s.told = hooks;
              o.held?.(id, hooks);
            }
            continue;
          }
          s.held = false;
          s.queued = false;
          start(id, s, hooks.cwd, hooks);
          continue;
        }
        if (s.queued || st.mtimeMs < now - windowMs) continue;
        if (s.endedAt !== null && st.mtimeMs <= s.endedAt) {
          // The lock let go with no write after the one it was held at: the next write is taken.
          if (s.held && !(await heldByAnother(id, now, config))) s.held = false;
          continue;
        }
        if (s.holdOff) {
          const ends = s.holdOff.until <= now || (!!s.holdOff.projects && (await nowTaken(s.holdOff, config)));
          if (!ends) {
            s.endedAt = st.mtimeMs; // looked at again as the transcript moves
            continue;
          }
          s.holdOff = null;
        }
        if (await heldByAnother(id, now, config)) {
          s.held = true;
          s.endedAt = st.mtimeMs;
          continue;
        }
        if (s.held) {
          // The lock let go and the transcript moved between two looks: the session most likely
          // closed just after a turn, so this write is left too.
          s.held = false;
          s.endedAt = st.mtimeMs;
          continue;
        }
        s.cwd ??= await cwdOf(io, file, st.size);
        if (!s.cwd) continue; // nothing in it names a folder yet: looked at again next time
        if (!(await fs.stat(s.cwd).then((d) => d.isDirectory(), () => false)) || (await o.isOff(s.cwd))) {
          s.endedAt = st.mtimeMs;
          continue;
        }
        if (first) (st.mtimeMs < now - config.idleMinutes * 60000 ? quiet : recent).push([id, s, s.cwd]);
        else start(id, s, s.cwd);
      }
    }
    if (first && (recent.length || quiet.length)) {
      for (const [, s] of [...recent, ...quiet]) s.queued = true;
      const startQueued = ([id, s, cwd]: [string, Seen, string]) => {
        if (!s.queued) return; // its hooks module connected meanwhile, and it was started for that
        s.queued = false;
        if (!stopped && !s.running) start(id, s, cwd);
      };
      const holdMs = 2 * config.runnerRetrySeconds * 1000;
      void (async () => {
        await new Promise((r) => setTimeout(r, holdMs));
        recent.forEach(startQueued);
        for (const queued of quiet) {
          await new Promise((r) => setTimeout(r, gapMs));
          startQueued(queued);
        }
      })();
    }
    first = false;
  };

  // One look at a time: a look asked for while one is under way is that one.
  let looking: Promise<void> | null = null;
  const lookOnce = () => (looking ??= look().finally(() => (looking = null)));
  const next = async () => {
    let seconds = 1;
    try {
      await lookOnce();
      seconds = (await o.config()).streamSeconds;
      said = "";
    } catch (err) {
      const text = `couldn't look for this machine's sessions to report: ${String((err as Error)?.message ?? err)}`;
      if (text !== said) o.log(text);
      said = text;
    }
    if (stopped) return;
    timer = setTimeout(() => void next(), seconds * 1000);
    timer.unref?.();
  };
  void next();

  return {
    heldOff: (id) => {
      const holdOff = seen.get(id)?.holdOff;
      return !!holdOff && holdOff.until > Date.now();
    },
    reporting: () => [...seen].filter(([, s]) => s.running).map(([id]) => id),
    look: lookOnce,
    rehook: (id) => {
      const s = seen.get(id);
      const hooks = o.hooked?.(id) ?? null;
      if (s?.running && s.running.hooks !== hooks) {
        rehooked.add(id);
        s.running.stop(changed(s.running.hooks, hooks));
      } else void lookOnce();
    },
    async stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      const running = [...seen.values()].flatMap((s) => s.running ?? []);
      for (const r of running) r.stop("the runner stopped");
      let timeout: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([Promise.all(running.map((r) => r.done)), new Promise((r) => (timeout = setTimeout(r, stopWaitMs)))]);
      clearTimeout(timeout);
    },
  };
}
