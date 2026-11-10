// The data layer's settings: the mod's config.json, overridden per key by the person's own
// ~/.claude/isoplan/config.json. A user value that is missing, null or the wrong shape leaves that
// key at the mod's default.
//
// The plugin reports to every office server in `servers` (#105), each `{ "label", "server" }`, the
// label naming it in the status line; without a usable one, to `server` alone, labelled by its host.

import type { MaybePromise, Stat } from "./git.js";

export interface Config {
  /** The office server's data-layer address: wss://, or ws:// to this machine, or anywhere with allowPlainWs. */
  server: string;
  /** Lets `server` be plain ws:// to another machine, which sends facts and credentials unencrypted. */
  allowPlainWs: boolean;
  /** A `server` set to plain ws:// to another machine without allowPlainWs: not used, and said why. */
  plainRefused?: string;
  /** The office servers to report to, each `{ label, server }`, in place of `server` (officesOf). */
  servers: unknown[];
  activeMinutes: number;
  idleMinutes: number;
  lightsOffHours: number;
  quietSeconds: number;
  stalledMinutes: number;
  /** How long an agent's check-in on another (a message sent, its output read) stays in the facts. */
  checkInSeconds: number;
  touchedWindowMinutes: number;
  touchedTools: string[];
  shellTools: string[];
  helperPrompts: string[];
  streamSeconds: number;
  tailBytes: number;
  gitCacheSeconds: number;
  /** A session folder git can't place is a workspace when it holds between one and this many repos directly. */
  workspaceRepos: number;
  /** How often the list of repos the office takes is checked again (approved.ts). */
  approvedRefreshMinutes: number;
  /** A copy of that list not confirmed by the server for this long approves nothing. */
  approvedMaxAgeMinutes: number;
  /** How often the plugin looks for a newer version of itself and installs it (src/update); 0 turns that off. */
  updateCheckHours: number;
  /** How long the runner, reporting a session whose transcript has nothing to report yet, waits for it before it stops. */
  factsWaitSeconds: number;
  /** How often a session's hooks module tries the runner's pipe again while it can't be reached (src/pipe/client.ts). */
  runnerRetrySeconds: number;
}

export interface ConfigIo {
  stat(path: string): MaybePromise<Stat | null>;
  read(path: string): MaybePromise<string>;
}

export async function loadConfig(io: ConfigIo, defaultsPath: string, userPath: string): Promise<Config> {
  const config = await loadSettings<Config>(io, defaultsPath, userPath);
  const asked = (await readJson(io, userPath, true)).server;
  if (typeof asked === "string" && URL.canParse(asked) && new URL(asked).protocol === "ws:" && !LOOPBACK.has(new URL(asked).hostname)) {
    if (config.allowPlainWs) config.server = asked;
    else config.plainRefused = asked;
  }
  return config;
}

/** One office server the plugin reports to. */
export interface Office {
  /** Its short name in the status line. */
  label: string;
  /** Its data-layer address. */
  server: string;
  /** Plain ws:// to another machine without allowPlainWs: not used, and said why. */
  plainRefused?: true;
  /**
   * The server a version before #105 reports to (config.json's `server`): its pairing lock and
   * released reports stay where that version keeps them, so the two never pair it at once.
   */
  legacy?: true;
}

/**
 * The offices to report to: each entry of `servers` with a ws:// or wss:// address (ws:// goes only
 * to this machine unless allowPlainWs; to another it is kept, to say why it isn't used), once per
 * address; with none, `server` alone. An entry without a label is labelled by its host, and a label
 * already taken gets -2, -3 and so on, so each names one office.
 */
export function officesOf(config: Config): Office[] {
  const offices: Office[] = [];
  const add = (server: string, label: string, refused: boolean) => {
    let unique = label;
    for (let n = 2; offices.some((o) => o.label.toLowerCase() === unique.toLowerCase()); n++) unique = `${label}-${n}`;
    offices.push({ label: unique, server, ...(refused && { plainRefused: true as const }), ...(server === config.server && { legacy: true as const }) });
  };
  for (const entry of config.servers) {
    const { label, server } = (entry ?? {}) as { label?: unknown; server?: unknown };
    if (typeof server !== "string" || !URL.canParse(server) || !["ws:", "wss:"].includes(new URL(server).protocol) || offices.some((o) => o.server === server)) continue;
    add(server, (typeof label === "string" && label.trim()) || new URL(server).host, !config.allowPlainWs && !isWebSocketUrl(server));
  }
  if (!offices.length) add(config.plainRefused ?? config.server, new URL(config.plainRefused ?? config.server).host, !!config.plainRefused);
  return offices;
}

/** The office `--office` names: by its label (in any case), its address, or its address's host. */
export function officeNamed(offices: readonly Office[], name: string): Office | undefined {
  const n = name.trim();
  return offices.find((o) => o.label.toLowerCase() === n.toLowerCase()) ?? offices.find((o) => o.server === n || new URL(o.server).host === n.toLowerCase());
}

/** The same per-key override for any settings file of the mod's, such as the runner's runner.json. */
export async function loadSettings<T>(io: ConfigIo, defaultsPath: string, userPath: string): Promise<T> {
  const defaults = await readJson(io, defaultsPath);
  const user = await readJson(io, userPath, true);
  const config: Record<string, unknown> = {};
  for (const [key, fallback] of Object.entries(defaults)) config[key] = fits(key, user[key], fallback) ? user[key] : fallback;
  return config as unknown as T;
}

// Keys used as a byte count or a file offset, which must be whole numbers.
const BYTE_KEYS = new Set(["tailBytes"]);

// Keys with a floor above zero. The read pace is one: a pass every few milliseconds would spin the
// machine; the app's process listing is another.
const FLOORS = new Map([
  ["streamSeconds", 0.25],
  ["processRefreshSeconds", 1],
]);

// Every number in config.json is a window or a size, so it must be finite and above zero; a
// window in ZERO_OFF may also be 0, which turns its feature off.
const ZERO_OFF = new Set(["lightsOffHours", "updateCheckHours"]);

function fits(key: string, value: unknown, fallback: unknown): boolean {
  if (key === "server") return typeof value === "string" && isWebSocketUrl(value);
  if (typeof fallback === "number") {
    if (BYTE_KEYS.has(key)) return Number.isSafeInteger(value) && (value as number) > 0;
    if (ZERO_OFF.has(key) && value === 0) return true;
    return typeof value === "number" && Number.isFinite(value) && value > 0 && value >= (FLOORS.get(key) ?? 0);
  }
  if (Array.isArray(fallback)) return Array.isArray(value);
  return value != null && typeof value === typeof fallback;
}

// wss:// anywhere; cleartext ws:// only to this machine, since the facts name files and agents' work.
const LOOPBACK = new Set(["127.0.0.1", "[::1]", "localhost"]);

function isWebSocketUrl(value: string): boolean {
  if (!URL.canParse(value)) return false;
  const url = new URL(value);
  return url.protocol === "wss:" || (url.protocol === "ws:" && LOOPBACK.has(url.hostname));
}

async function readJson(io: ConfigIo, p: string, optional = false): Promise<Record<string, unknown>> {
  if (optional && !(await io.stat(p))) return {};
  try {
    const value: unknown = JSON.parse(await io.read(p));
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  } catch (err) {
    // A broken override must not take the data layer down; a broken mod default is a bug to see.
    if (optional) return {};
    throw err;
  }
}
