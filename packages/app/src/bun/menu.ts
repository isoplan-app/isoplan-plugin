// What the tray / menu-bar menu says, from the engine's state and the worker's status file
// (packages/mod/src/runner/status.ts), and what the pairing window lists. Pure, so the menu can be
// tested without a tray.

import { linkState, type LinkState, type RunnerStatus } from "../../../mod/src/runner/status.js";
import type { EngineState } from "./engine.ts";

export type MenuItem = { type: "divider" } | { type: "normal"; label: string; action?: string; enabled?: boolean; submenu?: MenuItem[] };

export interface MenuInput {
  engine: EngineState;
  /** What the current worker last wrote (currentStatus); only read while the engine runs. */
  status: RunnerStatus | null;
  now: number;
  unreachableMs: number;
}

const HEADLINE: Record<EngineState, string> = {
  starting: "Isoplan is starting",
  running: "Isoplan is running",
  stopped: "Isoplan has stopped",
};

const LINK: Record<LinkState, string> = {
  connected: "connected",
  reconnecting: "reconnecting…",
  unreachable: "can't be reached",
  pairing: "waiting to be paired",
  "not-answering": "not answering for this computer",
};

/**
 * The status file's, if the worker that wrote it is still alive: a crashed or stopped worker's last
 * word ("connected") isn't what the offices see now.
 */
export const currentStatus = (status: RunnerStatus | null, isAlive: (pid: number) => boolean): RunnerStatus | null => (status && isAlive(status.pid) ? status : null);

/** A connected office's line: the email of the person its pairing belongs to, or that the office hasn't said it (one older than that). */
const connected = (email: string | undefined) => (email ? `connected as ${email}` : "connected (account not known yet: the office needs updating)");

/** Each office's line in the Offices submenu. */
export function officeLines({ engine, status, now, unreachableMs }: MenuInput): string[] {
  if (engine !== "running") return ["Not running"];
  // Its worker is starting, or starting again: it hasn't said yet.
  if (!status) return ["Starting…"];
  if (!status.offices.length) return ["No office yet"];
  return status.offices.map((office) => {
    const state = linkState(office, status.pairs, now, unreachableMs);
    return `${office.label}: ${state === "connected" ? connected(office.email) : LINK[state]}`;
  });
}

/** The action that closes a headless session, by the id status.json gives it: for a driven session, Close session. */
export const closeAction = (close: string) => `close:${close}`;
/** The action that ends a driven session and removes it, so it is never opened again. */
export const removeAction = (close: string) => `remove:${close}`;

/** What a headless session's submenu offers: a driven one, closed by its session's id, Close session or End and remove; a fork or a take's first turn, by its process's, Close. */
const closeItems = (close: string): MenuItem[] =>
  close.startsWith("pid:")
    ? [{ type: "normal", label: "Close", action: closeAction(close) }]
    : [
        { type: "normal", label: "Close session", action: closeAction(close) },
        { type: "normal", label: "End and remove", action: removeAction(close) },
      ];

/** The Sessions submenu: each session the worker reports or runs; a headless one can be closed, one in a terminal or the Claude app can't. */
export function sessionItems({ engine, status }: MenuInput): MenuItem[] {
  const line = (label: string): MenuItem[] => [{ type: "normal", label, enabled: false }];
  if (engine !== "running") return line("Not running");
  if (!status) return line("Starting…");
  if (!status.sessions) return line("Not listed: Isoplan's runner needs updating");
  if (!status.sessions.length) return line("No session on this computer");
  return status.sessions.map((s) => {
    const where = s.fork ? "headless, a fork" : s.headless ? "headless" : "in a terminal or the Claude app";
    return s.headless && s.close
      ? { type: "normal", label: `${s.name} (${where})`, submenu: closeItems(s.close) }
      : { type: "normal", label: `${s.name} (${where})`, enabled: false };
  });
}

/** The session a Close, Close session or End and remove action names, and whether to remove it, if the status lists it as one that can be closed now. */
export function closing(action: string, status: RunnerStatus | null): { close: string; remove: boolean } | null {
  const remove = action.startsWith("remove:");
  if (!remove && !action.startsWith("close:")) return null;
  const close = action.slice(action.indexOf(":") + 1);
  // Only a driven session is removed: a fork or a take's first turn is only closed.
  if (remove && close.startsWith("pid:")) return null;
  return status?.sessions?.some((s) => s.headless && s.close === close) ? { close, remove } : null;
}

export function trayMenu(input: MenuInput): MenuItem[] {
  const waiting = input.engine === "running" ? pairsWaiting(input.status, input.now).length : 0;
  return [
    { type: "normal", label: HEADLINE[input.engine], enabled: false },
    { type: "divider" },
    { type: "normal", label: "Offices", submenu: officeLines(input).map((label) => ({ type: "normal", label, enabled: false })) },
    { type: "normal", label: "Sessions", submenu: sessionItems(input) },
    { type: "normal", label: waiting ? `Pair this computer… (${waiting} waiting)` : "Open pairing…", action: "pairing" },
    { type: "divider" },
    { type: "normal", label: "Quit Isoplan", action: "quit" },
  ];
}

/** The links to pair this computer that haven't expired: what the pairing window lists. */
export function pairsWaiting(status: RunnerStatus | null, now: number): { office: string; url: string; expires: string }[] {
  if (!status) return [];
  return status.pairs
    .filter((p) => Date.parse(p.expires) > now)
    .map((p) => ({ office: p.label ?? status.offices.find((o) => o.server === p.server)?.label ?? new URL(p.server).host, url: p.url, expires: p.expires }));
}

/** What the pairing window shows. */
export interface PairingView {
  running: boolean;
  waiting: { office: string; url: string; expires: string }[];
  connected: string[];
  /** How often the window asks again, from `trayRefreshSeconds`. */
  refreshMs: number;
}

export function pairingView(input: MenuInput, refreshMs: number): PairingView {
  const running = input.engine === "running";
  const status = running ? input.status : null;
  return {
    refreshMs,
    running,
    waiting: pairsWaiting(status, input.now),
    connected: (status?.offices ?? []).filter((o) => o.open).map((o) => o.label),
  };
}
