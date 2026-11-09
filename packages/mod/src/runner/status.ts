// What the runner's worker tells the desktop app (packages/app) about each office's link:
// <claude dir>/isoplan/runner/status.json, written whole each time something changes. It holds what
// the worker saw, not a verdict: whether each office's link is open and since when, whether the
// office stopped it (doesn't want this machine's runner, or its pairing ended), and the links to pair
// the machine that are waiting to be approved. The app turns that into a state for its menu
// (`linkState`) every time it looks, so a link down for long enough becomes unreachable without the
// worker writing again. Each office's entry names the email of the person its pairing belongs to, once
// the office has said it (pairing.ts). It also lists the machine's sessions the worker reports or runs
// (`sessions`): headless ones, a process of the runner's, carry the id the app asks the worker to
// close them by, over the runner's pipe (src/pipe). The file never leaves the machine.

import fs from "node:fs/promises";
import path from "node:path";
import type { PairLine } from "../lines.js";

export const statusPath = (claudeDir: string) => path.join(claudeDir, "isoplan", "runner", "status.json");

export interface OfficeSeen {
  server: string;
  label: string;
  open: boolean;
  /** When the link last opened or closed, in ms since the epoch; the worker's start before either. */
  since: number;
  /** The office stopped the link: it doesn't want this machine's runner, or the pairing ended. */
  stopped?: "not-wanted" | "unpaired";
  /** The email of the person this machine's pairing with the office belongs to; none while the office hasn't said it. */
  email?: string;
}

/** A session on this machine, as the app's Sessions menu lists it. */
export interface SessionSeen {
  /** Its folder's name, or the name a driven session was given. */
  name: string;
  /** A process the runner started (driven from the floor, a fork, a take's first turn), not a terminal or the Claude app. */
  headless: boolean;
  /** What the app asks the worker to close it by; headless ones alone have one. */
  close?: string;
}

export interface RunnerStatus {
  /** The worker that wrote it. */
  pid: number;
  offices: OfficeSeen[];
  /** Links to pair this machine, one per office waiting for it. */
  pairs: Pick<PairLine, "server" | "label" | "url" | "expires">[];
  /** The sessions it reports or runs now; none from a worker older than that. */
  sessions?: SessionSeen[];
}

export type LinkState = "connected" | "reconnecting" | "unreachable" | "pairing" | "not-answering";

/** An office's link now: down for `unreachableMs` or longer it is unreachable, unless a pairing link waits for it. */
export function linkState(office: OfficeSeen, pairs: RunnerStatus["pairs"], now: number, unreachableMs: number): LinkState {
  if (office.open) return "connected";
  if (office.stopped) return "not-answering";
  if (pairs.some((p) => p.server === office.server && Date.parse(p.expires) > now)) return "pairing";
  return now - office.since < unreachableMs ? "reconnecting" : "unreachable";
}

export interface StatusWriter {
  /** The office's link is being opened (again): what stopped it no longer holds. */
  opening(server: string): void;
  opened(server: string): void;
  closed(server: string): void;
  stopped(server: string, why: "not-wanted" | "unpaired"): void;
  pair(line: PairLine): void;
  /** The email of the person the office's pairing belongs to, or none. */
  email(server: string, email: string | undefined): void;
  /** The sessions now; written only when they changed. */
  sessions(list: SessionSeen[]): void;
  /** Resolves once every change so far is on disk. */
  written(): Promise<void>;
}

export function createStatus({ file, offices, pid = process.pid, now = Date.now }: { file: string; offices: { server: string; label: string }[]; pid?: number; now?: () => number }): StatusWriter {
  const status: RunnerStatus = { pid, offices: offices.map(({ server, label }) => ({ server, label, open: false, since: now() })), pairs: [], sessions: [] };
  let writing = Promise.resolve();
  const write = () => {
    const text = JSON.stringify(status, null, 2) + "\n";
    writing = writing.then(async () => {
      await fs.mkdir(path.dirname(file), { recursive: true });
      const temp = `${file}.${pid}`;
      await fs.writeFile(temp, text);
      await fs.rename(temp, file);
    }).catch(() => {});
  };
  const change = (server: string, to: (o: OfficeSeen) => void) => {
    const office = status.offices.find((o) => o.server === server);
    if (!office) return;
    to(office);
    write();
  };
  write();
  return {
    opening: (server) => change(server, (o) => delete o.stopped),
    opened: (server) =>
      change(server, (o) => {
        o.open = true;
        o.since = now();
        // Open, the machine is paired with it.
        status.pairs = status.pairs.filter((p) => p.server !== server);
      }),
    closed: (server) =>
      change(server, (o) => {
        if (o.open) o.since = now();
        o.open = false;
      }),
    stopped: (server, why) => change(server, (o) => (o.stopped = why)),
    pair: (line) => {
      status.pairs = [...status.pairs.filter((p) => p.server !== line.server), { server: line.server, ...(line.label && { label: line.label }), url: line.url, expires: line.expires }];
      write();
    },
    email: (server, email) => {
      if (status.offices.find((o) => o.server === server)?.email === email) return;
      change(server, (o) => {
        if (email) o.email = email;
        else delete o.email;
      });
    },
    sessions: (list) => {
      if (JSON.stringify(list) === JSON.stringify(status.sessions)) return;
      status.sessions = list;
      write();
    },
    written: () => writing,
  };
}

const uuidOf = (session: string) => session.slice(session.indexOf(":") + 1);

/**
 * The sessions for the menu: each one reported now (its transcript's id and folder), and each process
 * of the runner's still running (registry.ts). A driven session or a take's first turn is headless,
 * closed by its session's id or its process's; a fork, which shares its lead's id, is listed on its own
 * and closed by its process's. A session in a terminal or the Claude app has no close.
 */
export function sessionsSeen(reported: { session: string; cwd: string }[], records: { kind: "driven" | "fork" | "desktop-read"; pid: number | null; session: string; folder: string; driven?: { name?: string } }[]): SessionSeen[] {
  const closeOf = (r: (typeof records)[number]) => (r.kind === "driven" ? r.session : `pid:${r.pid}`);
  const nameOf = (r: (typeof records)[number]) => r.driven?.name || path.basename(r.folder);
  const own = new Map(records.filter((r) => r.kind !== "fork" && (r.kind === "driven" || r.pid !== null)).map((r) => [uuidOf(r.session), r]));
  const listed = new Set<(typeof records)[number]>();
  const seen: SessionSeen[] = reported.map(({ session, cwd }) => {
    const r = own.get(session);
    if (!r) return { name: path.basename(cwd), headless: false };
    listed.add(r);
    return { name: nameOf(r), headless: true, close: closeOf(r) };
  });
  for (const r of records) if (r.pid !== null && !listed.has(r)) seen.push({ name: nameOf(r), headless: true, close: closeOf(r) });
  return seen.sort((a, b) => a.name.localeCompare(b.name) || Number(b.headless) - Number(a.headless));
}

/** The status the worker last wrote; null when there is none or it doesn't parse. */
export async function readStatus(file: string): Promise<RunnerStatus | null> {
  try {
    const value = JSON.parse(await fs.readFile(file, "utf8")) as RunnerStatus;
    return Array.isArray(value?.offices) && Array.isArray(value.pairs) ? value : null;
  } catch {
    return null;
  }
}
