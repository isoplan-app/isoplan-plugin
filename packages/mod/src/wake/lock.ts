// One data layer per session: <claude dir>/isoplan/live/<session id>.json holds `{ pid }` of the
// one reporting it: the machine's runner, or the data layer process of an earlier version of the
// plugin (ADR 0007 step 2 removed it; a session on an older copy still runs one). The runner
// doesn't start while another live pid keeps it fresh; such a data layer takes it over from the
// runner, which notices on its next pass and stops (src/data-layer/report-session.ts). A lock whose
// pid has gone is stale and is taken over. The same takeLock and its hold-offs keep the runner's own
// lock (src/runner/start.ts) and the pairing's (src/data-layer/pairing.ts).

import fs from "node:fs/promises";
import path from "node:path";

export const lockPath = (claudeDir: string, sessionId: string) => path.join(claudeDir, "isoplan", "live", `${sessionId}.json`);

// How long a hold-off lasts: a runner that stopped for a reason a restart won't mend, or a session the runner holds off.
export const HOLD_OFF_MS = 3600000;

export interface LockBody {
  /** The pid it names, or null for none (a hold-off names 0). */
  pid: number | null;
  /** A hold-off's end, in ms since the epoch. */
  until: number | null;
  /** The file's last write, which a holder that keeps it fresh (`refreshLock`) moves. */
  mtimeMs: number;
  /** Anything else the holder wrote into it. */
  extra: Record<string, unknown>;
}

/**
 * How a lock counts as held. `freshMs` is for a holder that keeps its lock fresh: a lock not
 * written for that long counts as stale even if its pid is live, since the pid may have been
 * reused by another process (after a reboot, say).
 */
export interface HoldRule {
  isAlive?: (pid: number) => boolean;
  freshMs?: number;
}

async function readText(file: string): Promise<{ text: string; mtimeMs: number } | null> {
  try {
    const [text, st] = await Promise.all([fs.readFile(file, "utf8"), fs.stat(file)]);
    return { text, mtimeMs: st.mtimeMs };
  } catch {
    return null;
  }
}

function parseLock(text: string, mtimeMs: number): LockBody | null {
  try {
    const { pid, until, ...extra } = JSON.parse(text) as { pid?: unknown; until?: unknown };
    return { pid: Number.isSafeInteger(pid) && (pid as number) > 0 ? (pid as number) : null, until: typeof until === "number" ? until : null, mtimeMs, extra };
  } catch {
    return null;
  }
}

export async function readLock(file: string): Promise<LockBody | null> {
  const r = await readText(file);
  return r && parseLock(r.text, r.mtimeMs);
}

/** The pid the lock names, or null when there is none or it can't be read. */
export async function lockHolder(file: string): Promise<number | null> {
  return (await readLock(file))?.pid ?? null;
}

const held = (lock: LockBody | null, now: number, { isAlive = alive, freshMs }: HoldRule) =>
  !!lock && ((lock.until !== null && lock.until > now) || (lock.pid !== null && isAlive(lock.pid) && (freshMs === undefined || now - lock.mtimeMs < freshMs)));

/** Whether the lock is held: by a live pid (kept fresh, under `freshMs`), or by a hold-off that hasn't ended. */
export async function isHeld(file: string, now = Date.now(), isAlive = alive, rule: Omit<HoldRule, "isAlive"> = {}): Promise<boolean> {
  return held(await readLock(file), now, { ...rule, isAlive });
}

/**
 * Takes the lock for `pid`; false when it is held (`isHeld`). With `force` (the plugin's data
 * layer) it is taken regardless: the runner holding it sees that and steps aside. `extra` is
 * written into the lock beside the pid.
 *
 * A new lock is created exclusively, so of two takers at once only one gets it. A stale one is
 * taken over one taker at a time: only the taker that creates `<lock>.take` (exclusively too) may
 * remove it, after reading it again to check it is still the lock it judged stale, by its text and
 * its write time, so a lock its holder refreshed meanwhile, or another taker's new one, is never
 * removed. A taker that finds `.take` there loses; one older than TAKE_STALE_MS was left by a taker
 * that crashed holding it, and is cleared.
 *
 * With `force` a stale or held lock is moved aside by rename, and the taker checks that what it
 * moved is the lock it read: one that moved another's lock instead puts it back and looks again. A
 * lock that can't be moved (on Windows a scanner may have it open) is tried again after a short
 * wait, then overwritten, so the plugin's data layer always gets it.
 */
export async function takeLock(file: string, pid: number, isAlive = alive, force = false, now = Date.now(), { freshMs, extra = {} }: { freshMs?: number; extra?: Record<string, unknown> } = {}): Promise<boolean> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const body = JSON.stringify({ pid, ...extra });
  for (let tries = 0; tries < 5; tries++) {
    if (tries && force) await new Promise((r) => setTimeout(r, 20 * tries));
    try {
      await fs.writeFile(file, body, { flag: "wx" });
      return true;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
    }
    const seen = await readText(file);
    if (!seen) continue; // gone since: try to create it again
    const lock = parseLock(seen.text, seen.mtimeMs);
    if (!force && lock?.pid !== pid && held(lock, now, { isAlive, freshMs })) return false;
    if (!force) {
      if (!(await removeStale(file, seen))) return false;
      continue;
    }
    const aside = `${file}.${pid}-${Math.random().toString(36).slice(2)}`;
    try {
      await fs.rename(file, aside);
    } catch (err) {
      // Another taker moved it first (or, on Windows, a reader has it open): look again.
      if (["ENOENT", ...BUSY].includes((err as NodeJS.ErrnoException).code ?? "")) continue;
      throw err;
    }
    const moved = await fs.readFile(aside, "utf8").catch(() => null);
    const movedAt = (await fs.stat(aside).catch(() => null))?.mtimeMs;
    if (moved !== seen.text || movedAt !== seen.mtimeMs) {
      // That was another taker's new lock: it goes back, unless a newer one is there already.
      await fs.link(aside, file).catch(() => {});
      await fs.rm(aside, { force: true });
      continue;
    }
    await fs.rm(aside, { force: true });
  }
  if (!force) return false;
  await fs.writeFile(file, body);
  return true;
}

// How old a `.take` must be to count as left by a taker that crashed: a takeover takes milliseconds.
const TAKE_STALE_MS = 5000;
const BUSY = ["EPERM", "EBUSY", "EACCES"];

/**
 * Removes the stale lock `seen` while holding `<lock>.take`, if it is still that one; false when
 * another taker holds `.take`. Either way the caller looks again.
 */
async function removeStale(file: string, seen: { text: string; mtimeMs: number }): Promise<boolean> {
  const take = `${file}.take`;
  try {
    await fs.writeFile(take, String(process.pid), { flag: "wx" });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
    const st = await fs.stat(take).catch(() => null);
    if (st && Date.now() - st.mtimeMs < TAKE_STALE_MS) return false;
    await fs.rm(take, { force: true });
    return true;
  }
  try {
    const now = await readText(file);
    if (now?.text === seen.text && now.mtimeMs === seen.mtimeMs) await fs.rm(file, { force: true });
  } catch (err) {
    // On Windows a reader may have it open: the caller looks again.
    if (!BUSY.includes((err as NodeJS.ErrnoException).code ?? "")) throw err;
  } finally {
    await fs.rm(take, { force: true });
  }
  return true;
}

/**
 * Marks the lock `pid` holds as fresh; false when another has taken it. A lock briefly missing (a
 * taker moved it aside to look, and is putting it back) is looked at again once, after `retryMs`.
 */
export async function refreshLock(file: string, pid: number, now = Date.now(), retryMs = 250): Promise<boolean> {
  let holder = await lockHolder(file);
  if (holder === null) {
    await new Promise((r) => setTimeout(r, retryMs));
    holder = await lockHolder(file);
  }
  if (holder !== pid) return false;
  const t = new Date(now);
  await fs.utimes(file, t, t);
  return true;
}

/** Removes the lock if it still names `pid`. */
export async function releaseLock(file: string, pid: number): Promise<void> {
  if ((await lockHolder(file)) === pid) await fs.rm(file, { force: true });
}

/** Turns the lock `pid` holds into a hold-off until `until`, with `extra` beside it; one another has taken is left. */
export async function holdOff(file: string, pid: number, until: number, extra: Record<string, unknown> = {}): Promise<void> {
  if ((await lockHolder(file)) === pid) await fs.writeFile(file, JSON.stringify({ pid: 0, until, ...extra }));
}

// Signal 0 tests for a process without touching it: ESRCH means it is gone, EPERM that it exists.
export function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}
