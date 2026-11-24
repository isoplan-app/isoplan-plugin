// Starts the machine's runner when this person logs in: a login item, for this person only and with
// no admin rights, that runs `node <claude dir>/isoplan/wake.mjs --login` with no window. That does
// what the wake hook does for the machine (src/wake/outside.ts), so the runner's lock decides whether
// one is already running. Install registers it beside the isoplan:// link handler (install.ts), and
// takes it out when `startAtLogin` in runner.json is off; uninstall takes it out with the handler.
//
// Each config folder runs its own runner, so each has its own item, named with a short id of the
// folder's path (`loginItemId`):
//
// - Windows: a value, "Isoplan runner <id>", under HKCU\Software\Microsoft\Windows\CurrentVersion\Run,
//   running wscript on a launcher, <claude dir>/isoplan/start-at-login.js, which starts node hidden
//   (hidden-launch.ts): node straight from the Run key would show a console window for as long as it
//   ran. While Windows Script Host is turned off, the value runs conhost with no window on node
//   instead (hidden-launch.ts), and the launcher goes.
// - macOS: a LaunchAgent, ~/Library/LaunchAgents/dev.isoplan.runner.<id>.plist, with RunAtLoad and no
//   KeepAlive, so launchd starts it once at login and never again behind the runner's own lifecycle,
//   loaded now into this person's GUI domain with `launchctl bootstrap gui/<uid>`.
// - Linux, as far as the desktop allows: an XDG autostart entry,
//   $XDG_CONFIG_HOME/autostart/isoplan-runner-<id>.desktop (~/.config by default), Terminal=false.
//
// Registering is done under a lock (login-item.lock), and only when the item is missing or names a
// node or a script that has gone. Every command runs hidden, through `run`.

import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { exec, type Exec } from "../connect/dialog.js";
import { loadSettings } from "../data-layer/config.js";
import { nodeIo } from "../data-layer/io.js";
import { alive, releaseLock, takeLock } from "../wake/lock.js";
import { headlessCommand, headlessPaths, hiddenLauncher, launchCommand, launcherPaths, scriptHostOff } from "./hidden-launch.js";
import { execArg, regValue, works } from "./link-handler.js";
import { stableNode } from "./stable-node.js";
import { normalPath } from "./state.js";

export interface LoginItem {
  platform: NodeJS.Platform;
  claudeDir: string;
  home: string;
  /** $XDG_CONFIG_HOME, on Linux. */
  configHome?: string;
  /** This person's user id, for launchctl on macOS. */
  uid?: number;
  /** The node binary, and the script it runs: this config folder's wake.mjs. */
  node: string;
  script: string;
  /** The environment, for the version managers' paths (stable-node.ts). */
  env?: Record<string, string | undefined>;
  run?: Exec;
}

/** Where the operating system keeps the login item: what it needs besides the config folder and the script. */
export type LoginItemPlace = Omit<LoginItem, "claudeDir" | "script">;

/** What the item passes the wake hook. */
export const LOGIN_ARG = "--login";

const RUN_KEY = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run";

/** A short id of the config folder, so each folder's item has its own name. */
export const loginItemId = (claudeDir: string, platform: NodeJS.Platform) => createHash("sha256").update(normalPath(claudeDir, platform)).digest("hex").slice(0, 8);

export const runValueName = (claudeDir: string) => `Isoplan runner ${loginItemId(claudeDir, "win32")}`;
export const loginLauncherPath = (claudeDir: string) => path.join(claudeDir, "isoplan", "start-at-login.js");
export const launchAgentLabel = (claudeDir: string) => `dev.isoplan.runner.${loginItemId(claudeDir, "darwin")}`;
export const launchAgentPath = (home: string, claudeDir: string) => path.join(home, "Library", "LaunchAgents", `${launchAgentLabel(claudeDir)}.plist`);
export const autostartPath = (h: Pick<LoginItem, "home" | "configHome" | "claudeDir">) =>
  path.join(h.configHome || path.join(h.home, ".config"), "autostart", `isoplan-runner-${loginItemId(h.claudeDir, "linux")}.desktop`);

/** The Run value: wscript on the launcher. */
export const windowsLoginCommand = (claudeDir: string) => launchCommand(loginLauncherPath(claudeDir));

const xml = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const unxml = (text: string) => text.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

/**
 * The LaunchAgent. AbandonProcessGroup, since launchd otherwise ends what is left in the job's
 * process group once the job exits, and the job exits as soon as it has started the runner.
 */
export const launchAgentPlist = (label: string, node: string, script: string) =>
  [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    "<dict>",
    "\t<key>Label</key>",
    `\t<string>${xml(label)}</string>`,
    "\t<key>ProgramArguments</key>",
    "\t<array>",
    ...[node, script, LOGIN_ARG].map((arg) => `\t\t<string>${xml(arg)}</string>`),
    "\t</array>",
    "\t<key>RunAtLoad</key>",
    "\t<true/>",
    "\t<key>AbandonProcessGroup</key>",
    "\t<true/>",
    "</dict>",
    "</plist>",
    "",
  ].join("\n");
const plistPaths = (text: string | null) => {
  const args = text ? /<key>ProgramArguments<\/key>\s*<array>([\s\S]*?)<\/array>/.exec(text)?.[1] : undefined;
  const [node, script] = args ? [...args.matchAll(/<string>([^<]*)<\/string>/g)].map((m) => unxml(m[1]!)) : [];
  return node && script ? { node, script } : null;
};

/** The XDG autostart entry. */
export const autostartEntry = (node: string, script: string) =>
  [
    "[Desktop Entry]",
    "Type=Application",
    "Name=Isoplan",
    "Comment=Starts Isoplan's runner when you log in",
    `Exec=${execArg(node)} ${execArg(script)} ${LOGIN_ARG}`,
    "Terminal=false",
    "NoDisplay=true",
    `X-Isoplan-Login=${JSON.stringify({ node, script })}`,
    "",
  ].join("\n");
const autostartPaths = (entry: string | null) => {
  const line = entry ? /^X-Isoplan-Login=(.*)$/m.exec(entry)?.[1] : undefined;
  try {
    return line ? (JSON.parse(line) as { node?: unknown; script?: unknown }) : null;
  } catch {
    return null;
  }
};

const read = (file: string) => fs.readFile(file, "utf8").catch(() => null);

/** Whether runner.json (`defaultsPath`, overridden by the person's `userPath`) has the runner start at login; on unless it says false. */
export async function startsAtLogin(defaultsPath: string, userPath: string): Promise<boolean> {
  const settings = await loadSettings<{ startAtLogin?: unknown }>(nodeIo(), defaultsPath, userPath).catch(() => null);
  return settings?.startAtLogin !== false;
}

export const loginItemLockPath = (claudeDir: string) => path.join(claudeDir, "isoplan", "login-item.lock");

/** Registers the login item unless a working one is there; says what it changed. Another install registering at the same moment leaves it to that one. */
export async function registerLoginItem(given: LoginItem): Promise<string[]> {
  const lock = loginItemLockPath(given.claudeDir);
  if (!(await takeLock(lock, process.pid, alive, false, Date.now(), { freshMs: 2 * 60 * 1000 }))) return [];
  try {
    return await register(given);
  } finally {
    await releaseLock(lock, process.pid).catch(() => {});
  }
}

async function register(given: LoginItem): Promise<string[]> {
  // A path that outlives this Node version where there is one (stable-node.ts).
  const h = { ...given, node: await stableNode(given.node, given.env ?? process.env, given.platform) };
  const run = h.run ?? exec;
  const must = async (file: string, args: string[]) => {
    const r = await run(file, args);
    if (r.code !== 0) throw new Error(`${path.basename(file)} ${args[0] ?? ""} failed${r.code === null ? " to start" : ` (${r.code})`}`);
  };
  if (h.platform === "win32") {
    // With Script Host off, an item through the launcher would show its message at every login.
    const off = await scriptHostOff(run);
    const launcher = loginLauncherPath(h.claudeDir);
    const current = regValue((await run("reg", ["query", RUN_KEY, "/v", runValueName(h.claudeDir)])).stdout);
    if (off) {
      const want = headlessCommand(h.node, h.script, LOGIN_ARG);
      if (current?.toLowerCase() === want.toLowerCase() && (await works(headlessPaths(current)))) return [];
      await fs.rm(launcher, { force: true });
      await must("reg", ["add", RUN_KEY, "/v", runValueName(h.claudeDir), "/d", want, "/f"]);
      return ["set the runner to start at login, through conhost with no window, since Windows Script Host is turned off"];
    }
    const want = windowsLoginCommand(h.claudeDir);
    // In any letter case, as Windows reads paths: %SystemRoot% may be C:\WINDOWS or C:\Windows.
    if (current?.toLowerCase() === want.toLowerCase() && (await works(launcherPaths(await read(launcher))))) return [];
    await fs.mkdir(path.dirname(launcher), { recursive: true });
    await fs.writeFile(launcher, hiddenLauncher(h.node, h.script, { args: LOGIN_ARG }));
    await must("reg", ["add", RUN_KEY, "/v", runValueName(h.claudeDir), "/d", want, "/f"]);
    return [`set the runner to start at login, through ${launcher}`];
  }
  if (h.platform === "darwin") {
    const file = launchAgentPath(h.home, h.claudeDir);
    const label = launchAgentLabel(h.claudeDir);
    if (await works(plistPaths(await read(file)))) return [];
    // One loaded from an earlier file goes first, or bootstrap refuses the label.
    await run("launchctl", ["bootout", `gui/${h.uid}/${label}`]);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, launchAgentPlist(label, h.node, h.script));
    await must("launchctl", ["bootstrap", `gui/${h.uid}`, file]);
    return [`set the runner to start at login, through ${file}`];
  }
  if (h.platform === "linux") {
    const file = autostartPath(h);
    if (await works(autostartPaths(await read(file)))) return [];
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, autostartEntry(h.node, h.script));
    return [`set the runner to start at login, through ${file}`];
  }
  return [];
}

/** Takes this config folder's login item out; says what it changed. */
export async function unregisterLoginItem(h: Omit<LoginItem, "node">): Promise<string[]> {
  const run = h.run ?? exec;
  const removed = (where: string) => [`took out the runner's start at login (${where})`];
  if (h.platform === "win32") {
    const name = runValueName(h.claudeDir);
    const had = (await run("reg", ["query", RUN_KEY, "/v", name])).code === 0;
    if (had) await run("reg", ["delete", RUN_KEY, "/v", name, "/f"]);
    const launcher = loginLauncherPath(h.claudeDir);
    const hadLauncher = !!(await fs.stat(launcher).catch(() => null));
    await fs.rm(launcher, { force: true });
    return had || hadLauncher ? removed(`${RUN_KEY}\\${name}`) : [];
  }
  if (h.platform === "darwin") {
    const file = launchAgentPath(h.home, h.claudeDir);
    if (!(await fs.stat(file).catch(() => null))) return [];
    // The file goes first: at login this runs in the agent's own job, which bootout may end.
    await fs.rm(file, { force: true });
    await run("launchctl", ["bootout", `gui/${h.uid}/${launchAgentLabel(h.claudeDir)}`]);
    return removed(file);
  }
  if (h.platform === "linux") {
    const file = autostartPath(h);
    if (!(await fs.stat(file).catch(() => null))) return [];
    await fs.rm(file, { force: true });
    return removed(file);
  }
  return [];
}
