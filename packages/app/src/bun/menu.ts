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
  paused: "Isoplan is paused",
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
  if (engine !== "running") return [engine === "paused" ? "Paused: no office is told anything" : "Not running"];
  // Its worker is starting, or starting again: it hasn't said yet.
  if (!status) return ["Starting…"];
  if (!status.offices.length) return ["No office yet"];
  return status.offices.map((office) => {
    const state = linkState(office, status.pairs, now, unreachableMs);
    return `${office.label}: ${state === "connected" ? connected(office.email) : LINK[state]}`;
  });
}

/** The action that closes a headless session, by the id status.json gives it. */
export const closeAction = (close: string) => `close:${close}`;

/** The Sessions submenu: each session the worker reports or runs; a headless one can be closed, one in a terminal or the Claude app can't. */
export function sessionItems({ engine, status }: MenuInput): MenuItem[] {
  const line = (label: string): MenuItem[] => [{ type: "normal", label, enabled: false }];
  if (engine !== "running") return line(engine === "paused" ? "Paused: no session is reported" : "Not running");
  if (!status) return line("Starting…");
  if (!status.sessions) return line("Not listed: Isoplan's runner needs updating");
  if (!status.sessions.length) return line("No session on this computer");
  return status.sessions.map((s) => {
    const where = s.fork ? "headless, a fork" : s.headless ? "headless" : "in a terminal or the Claude app";
    return s.headless && s.close
      ? { type: "normal", label: `${s.name} (${where})`, submenu: [{ type: "normal", label: "Close", action: closeAction(s.close) }] }
      : { type: "normal", label: `${s.name} (${where})`, enabled: false };
  });
}

/** The session a Close action names, if the status lists it as one that can be closed now. */
export function closing(action: string, status: RunnerStatus | null): string | null {
  if (!action.startsWith("close:")) return null;
  const close = action.slice("close:".length);
  return status?.sessions?.some((s) => s.headless && s.close === close) ? close : null;
}

export function trayMenu(input: MenuInput): MenuItem[] {
  const waiting = input.engine === "running" ? pairsWaiting(input.status, input.now).length : 0;
  return [
    { type: "normal", label: HEADLINE[input.engine], enabled: false },
    { type: "divider" },
    { type: "normal", label: "Offices", submenu: officeLines(input).map((label) => ({ type: "normal", label, enabled: false })) },
    { type: "normal", label: "Sessions", submenu: sessionItems(input) },
    input.engine === "paused" ? { type: "normal", label: "Resume", action: "resume" } : { type: "normal", label: "Pause", action: "pause", enabled: input.engine === "running" },
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
