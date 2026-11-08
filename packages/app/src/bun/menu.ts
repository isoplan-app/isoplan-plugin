// What the tray / menu-bar menu says, from the engine's state and the worker's status file
// (packages/mod/src/runner/status.ts), and what the pairing window lists. Pure, so the menu can be
// tested without a tray.

import { linkState, type LinkState, type RunnerStatus } from "../../../mod/src/runner/status.js";
import type { EngineState } from "./engine.ts";

export type MenuItem = { type: "divider" } | { type: "normal"; label: string; action?: string; enabled?: boolean; submenu?: MenuItem[] };

export interface MenuInput {
  engine: EngineState;
  /** What the worker last wrote; only read while the engine runs. */
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

/** Each office's line in the Offices submenu. */
export function officeLines({ engine, status, now, unreachableMs }: MenuInput): string[] {
  if (engine !== "running") return [engine === "paused" ? "Paused: no office is told anything" : "Not running"];
  if (!status?.offices.length) return ["No office yet"];
  return status.offices.map((office) => `${office.label}: ${LINK[linkState(office, status.pairs, now, unreachableMs)]}`);
}

export function trayMenu(input: MenuInput): MenuItem[] {
  const waiting = input.engine === "running" ? pairsWaiting(input.status, input.now).length : 0;
  return [
    { type: "normal", label: HEADLINE[input.engine], enabled: false },
    { type: "divider" },
    { type: "normal", label: "Offices", submenu: officeLines(input).map((label) => ({ type: "normal", label, enabled: false })) },
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
}

export function pairingView(input: MenuInput): PairingView {
  const running = input.engine === "running";
  const status = running ? input.status : null;
  return {
    running,
    waiting: pairsWaiting(status, input.now),
    connected: (status?.offices ?? []).filter((o) => o.open).map((o) => o.label),
  };
}
