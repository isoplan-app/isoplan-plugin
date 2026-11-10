// Isoplan's desktop app: the machine's runner (engine.ts) with its icon in the Windows tray or the
// macOS menu bar. It opens no window and takes no focus by itself: the pairing window opens only
// from its menu item, and a link to pair opens in the browser only from a click in that window.
//
// Its config folder is $CLAUDE_CONFIG_DIR or ~/.claude, as Claude Code's own: Electrobun's launcher
// doesn't pass arguments on, so startRunner sets the variable (packages/mod/src/runner/start.ts).
// It logs to <claude dir>/isoplan/logs/app.log; the worker logs to runner.log as before.
//
// Show what's running… opens the window of this user's processes by folder (running.ts), which reads
// them only while it is open, and ends none.
//
// Its Sessions submenu lists what the worker writes into status.json; Close on a headless one asks the
// worker over its pipe (src/pipe), whose address and token it reads with the runner's own code.

import { BrowserView, BrowserWindow, Tray, Utils } from "electrobun/main";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { claudePaths } from "../../../mod/src/data-layer/claude-paths.js";
import { loadSettings } from "../../../mod/src/data-layer/config.js";
import { nodeIo } from "../../../mod/src/data-layer/io.js";
import { LOCK_REFRESH_MS } from "../../../mod/src/runner/start.js";
import { readStatus, statusPath, type RunnerStatus } from "../../../mod/src/runner/status.js";
import { cut, loadPatterns } from "../../../mod/src/runner/scan.js";
import { closeSession } from "../../../mod/src/pipe/pipe.js";
import { menuCloseWaitMs } from "../../../mod/src/runner/session.js";
import { alive } from "../../../mod/src/wake/lock.js";
import type { PairingRPC } from "../shared/pairing-rpc.ts";
import type { RunningRPC } from "../shared/running-rpc.ts";
import { startEngine } from "./engine.ts";
import { closing, currentStatus, pairingView, trayMenu, type MenuInput } from "./menu.ts";
import { listProcesses } from "./processes.ts";
import { parseClaudeSession, runningView, workTreeFinder, type ClaudeSessionRecord, type RunningView } from "./running.ts";
import pkg from "../../package.json" with { type: "json" };

const LOG_CAP_BYTES = 256 * 1024;

const claudeDir = claudePaths(process.env, os.homedir()).dir;
const isoplanDir = path.join(claudeDir, "isoplan");
const logFile = path.join(isoplanDir, "logs", "app.log");
let logging = Promise.resolve();
function log(text: string) {
  const line = `${new Date().toISOString()} ${text}\n`;
  logging = logging
    .then(async () => {
      await fs.mkdir(path.dirname(logFile), { recursive: true });
      if (((await fs.stat(logFile).catch(() => null))?.size ?? 0) > LOG_CAP_BYTES) await fs.writeFile(logFile, line);
      else await fs.appendFile(logFile, line);
    })
    .catch(() => {});
}

// A menu-bar app: no Dock icon.
if (process.platform === "darwin") Utils.setDockIconVisible(false);

// The tray's settings, as the runner reads its own: its copy's runner.json, then the person's. One
// that can't be read keeps the last that could.
type TraySettings = { trayRefreshSeconds: number; officeUnreachableSeconds: number; drivenCloseSeconds: number; processRefreshSeconds: number };
let good: TraySettings | null = null;
async function settings(): Promise<TraySettings> {
  try {
    good = await loadSettings<TraySettings>(nodeIo(), path.join(isoplanDir, "runner", "app", "runner.json"), path.join(isoplanDir, "runner.json"));
  } catch (err) {
    if (!good) throw err;
  }
  return good;
}

// A menu that couldn't be brought up to date says why once, not at every refresh.
let lastProblem = "";
function problem(err: unknown): void {
  const text = String((err as Error)?.message ?? err);
  if (text !== lastProblem) log(`couldn't bring the menu up to date: ${text}`);
  lastProblem = text;
}

let tray: Tray | null = null;
let pairing: BrowserWindow | null = null;
let running: BrowserWindow | null = null;
let shown = "";
let status: RunnerStatus | null = null;

const engine = startEngine({ claudeDir, version: pkg.version, log, onChange: () => void update().catch(problem) });

async function input(): Promise<MenuInput> {
  const s = await settings();
  if (engine.state() === "running") status = currentStatus(await readStatus(statusPath(claudeDir)), alive);
  return { engine: engine.state(), status, now: Date.now(), unreachableMs: s.officeUnreachableSeconds * 1000 };
}

async function update(): Promise<void> {
  const state = engine.state();
  // The icon shows once this app is the runner: a second copy, or one with nothing to run, never shows one.
  if (!tray && state === "running") {
    const mac = process.platform === "darwin";
    tray = new Tray({ title: "", image: mac ? "views://assets/tray-template.png" : "views://assets/isoplan.ico", template: mac, width: mac ? 18 : 16, height: mac ? 18 : 16 });
    tray.on("tray-clicked", (event: unknown) => void act((event as { data?: { action?: string } }).data?.action ?? ""));
  }
  if (!tray) return;
  const menu = JSON.stringify(trayMenu(await input()));
  lastProblem = "";
  if (menu === shown) return;
  shown = menu;
  tray.setMenu(JSON.parse(menu));
}

async function act(action: string): Promise<void> {
  if (action === "pairing") openPairing();
  else if (action === "running") openRunning();
  else if (action.startsWith("close:") || action.startsWith("remove:")) {
    const asked = closing(action, (await input()).status);
    if (asked) await close(asked.close, asked.remove);
  }
  else if (action === "quit") {
    log("quit from the menu: the runner stops");
    await engine.quit();
  }
  await update();
}

// A headless session the menu offers to close: this machine's runner closes it, as it owns its process, and with `remove` removes it.
async function close(id: string, remove: boolean): Promise<void> {
  const closed = await closeSession(claudeDir, id, menuCloseWaitMs((await settings()).drivenCloseSeconds), remove);
  log(
    closed === true
      ? `${remove ? "ended and removed" : "closed"} ${id} from the menu`
      : closed === false
        ? `the runner didn't close ${id}: runner.log says why`
        : closed === "no answer"
          ? `the runner didn't answer when asked to close ${id}: runner.log may say why`
          : `couldn't ask the runner to close ${id}: its pipe can't be reached`,
  );
}

// Only ever from a person's click on the menu item.
function openPairing(): void {
  if (pairing) return void pairing.focus();
  const rpc = BrowserView.defineRPC<PairingRPC>({
    maxRequestTime: 5000,
    handlers: {
      requests: { view: async () => pairingView(await input(), (await settings()).trayRefreshSeconds * 1000) },
      messages: {
        // Only a link the runner made to pair this computer, and only from a click in the window.
        open: async ({ url }) => {
          if (pairingView(await input(), 0).waiting.some((p) => p.url === url)) Utils.openExternal(url);
        },
      },
    },
  });
  pairing = new BrowserWindow({ title: "Pair this computer", url: "views://pairing/index.html", frame: { width: 440, height: 380, x: 240, y: 160 }, rpc });
  pairing.on("close", () => (pairing = null));
}

// Claude Code's own records of its running sessions, <claude dir>/sessions/<pid>.json, which name each
// session's process; only those files, never the others beside them.
async function claudeSessions(): Promise<ClaudeSessionRecord[]> {
  const dir = path.join(claudeDir, "sessions");
  const names = (await fs.readdir(dir).catch(() => [] as string[])).filter((name) => /^\d+\.json$/.test(name));
  const records = await Promise.all(names.map((name) => fs.readFile(path.join(dir, name), "utf8").then(parseClaudeSession, () => null)));
  return records.filter((r) => r !== null);
}

// Secret patterns the window can't use say why once, not at every refresh.
let lastPatternsProblem = "";
function patternsProblem(text: string): void {
  if (text && text !== lastPatternsProblem) log(`the secret patterns can't be used, so the window of what's running shows no command: ${text}`);
  lastPatternsProblem = text;
}

// What the window of what's running shows now: read only when the open window asks.
async function runningNow(): Promise<RunningView> {
  const s = await settings();
  const status = engine.state() === "running" ? currentStatus(await readStatus(statusPath(claudeDir)), alive) : null;
  const appDir = path.join(isoplanDir, "runner", "app");
  const problems: string[] = [];
  const patterns = await loadPatterns(path.join(appDir, "secret-patterns.json"), path.join(isoplanDir, "secret-patterns.json"), (text) => problems.push(text)).catch((err: Error) => (problems.push(err.message), null));
  patternsProblem(problems.join("; "));
  const [processes, claude] = await Promise.all([listProcesses(), claudeSessions()]);
  return runningView({ status, processes, claudeSessions: claude, workTree: workTreeFinder(existsSync, path), cut: (command) => cut(command, patterns), refreshMs: s.processRefreshSeconds * 1000 });
}

// Only ever from a person's click on the menu item.
function openRunning(): void {
  if (running) return void running.focus();
  const rpc = BrowserView.defineRPC<RunningRPC>({ maxRequestTime: 15000, handlers: { requests: { view: () => runningNow() }, messages: {} } });
  running = new BrowserWindow({ title: "What's running", url: "views://running/index.html", frame: { width: 900, height: 620, x: 200, y: 120 }, rpc });
  running.on("close", () => (running = null));
}

// The menu follows the runner every trayRefreshSeconds; until the settings can first be read, it
// tries again every lock refresh.
function refresh(): void {
  void update()
    .catch(problem)
    .finally(() => setTimeout(refresh, good ? good.trayRefreshSeconds * 1000 : LOCK_REFRESH_MS));
}
refresh();

engine.ended.then(async (why) => {
  log(`the app ends: ${why}`);
  tray?.remove();
  await logging;
  Utils.quit(0);
});
log(`the app ${process.pid} started (${pkg.version}, bun ${Bun.version}) for ${claudeDir}`);
