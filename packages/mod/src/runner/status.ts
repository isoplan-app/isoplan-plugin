// What the runner's worker tells the desktop app (packages/app) about each office's link:
// <claude dir>/isoplan/runner/status.json, written whole each time something changes. It holds what
// the worker saw, not a verdict: whether each office's link is open and since when, whether the
// office stopped it (doesn't want this machine's runner, or its pairing ended), and the links to pair
// the machine that are waiting to be approved. The app turns that into a state for its menu
// (`linkState`) every time it looks, so a link down for long enough becomes unreachable without the
// worker writing again. The file never leaves the machine.

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
}

export interface RunnerStatus {
  /** The worker that wrote it. */
  pid: number;
  offices: OfficeSeen[];
  /** Links to pair this machine, one per office waiting for it. */
  pairs: Pick<PairLine, "server" | "label" | "url" | "expires">[];
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
  /** Resolves once every change so far is on disk. */
  written(): Promise<void>;
}

export function createStatus({ file, offices, pid = process.pid, now = Date.now }: { file: string; offices: { server: string; label: string }[]; pid?: number; now?: () => number }): StatusWriter {
  const status: RunnerStatus = { pid, offices: offices.map(({ server, label }) => ({ server, label, open: false, since: now() })), pairs: [] };
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
    written: () => writing,
  };
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
