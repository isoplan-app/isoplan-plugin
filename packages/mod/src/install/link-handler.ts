// Registers the isoplan:// link handler (src/connect) with the operating system, for this person
// only and without admin rights, and takes it out again. Install does it with the wake hook
// (install.ts), so it follows the plugin's own copy of the handler, which outlives plugin updates.
//
// - Windows: HKCU\Software\Classes\isoplan, a URL protocol whose open command runs wscript on a
//   launcher, <claude dir>/isoplan/open-link.js, which hands the link to node on the handler, hidden
//   and in the environment (hidden-launch.ts), so a link opens no console window. Its open verb's
//   FriendlyAppName is Isoplan, which is what the browser's "open this link?" prompt names
//   (AssocQueryString's friendly app name, probed on Windows 11: without it, "Microsoft Windows
//   Based Script Host"). Where Windows Script Host is turned off, the command runs node on the
//   handler with the link ("%1") instead, which shows a console window for a moment. A registration
//   of that older form is redone through the launcher once Script Host is on, and one through the
//   launcher is redone in that form once Script Host is turned off.
// - macOS: a small AppleScript app, <claude dir>/isoplan/Isoplan Connect.app, made with osacompile,
//   claiming the isoplan scheme in its Info.plist (CFBundleURLTypes), signed again ad hoc once that
//   is changed, and registered with LaunchServices (lsregister). It hands the link to node in the
//   background, in the environment rather than on a command line.
// - Linux, as far as the desktop allows: isoplan-connect.desktop in ~/.local/share/applications,
//   for x-scheme-handler/isoplan, made the default with xdg-mime.
//
// Install runs as every session starts, so registering is done under a lock (link-handler.lock) and
// only when nothing is registered, or what is registered names a node or a handler that no longer
// exists: a working registration stays as it is, even when this session's node is another one, or it
// is another config folder's. So with several config folders on one machine, the first to register
// keeps the scheme until its registration breaks, and only then does the next one's install take
// it. Each is taken out only when it runs this config folder's handler, so another config folder's,
// or another program's, is never touched. Every command runs hidden, through `run`.

import fs from "node:fs/promises";
import path from "node:path";
import { exec, type Exec } from "../connect/dialog.js";
import { alive, releaseLock, takeLock } from "../wake/lock.js";
import { hiddenLauncher, launchCommand, launcherOf, launcherPaths, scriptHostOff } from "./hidden-launch.js";
import { stableNode } from "./stable-node.js";

export interface LinkHandler {
  platform: NodeJS.Platform;
  claudeDir: string;
  home: string;
  /** $XDG_DATA_HOME, on Linux. */
  dataHome?: string;
  /** The node binary, and the handler it runs. */
  node: string;
  script: string;
  /** The environment, for the version managers' paths (stable-node.ts). */
  env?: Record<string, string | undefined>;
  run?: Exec;
}

const KEY = "HKCU\\Software\\Classes\\isoplan";
const OPEN_KEY = `${KEY}\\shell\\open`;
const COMMAND_KEY = `${OPEN_KEY}\\command`;
const LSREGISTER = "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister";
const DESKTOP = "isoplan-connect.desktop";

export const macAppPath = (claudeDir: string) => path.join(claudeDir, "isoplan", "Isoplan Connect.app");
const macMarker = (app: string) => path.join(app, "Contents", "Resources", "isoplan-handler.json");
const desktopPath = (h: Pick<LinkHandler, "home" | "dataHome">) => path.join(h.dataHome || path.join(h.home, ".local", "share"), "applications", DESKTOP);

/** The Windows launcher the open command runs. */
export const linkLauncherPath = (claudeDir: string) => path.join(claudeDir, "isoplan", "open-link.js");
/** The Windows open command: wscript on the launcher, and the link. */
export const windowsCommand = (launcher: string) => launchCommand(launcher, '"%1"');
/** The open command where Windows Script Host is off: node and the handler, quoted, and the link. */
export const directCommand = (node: string, script: string) => `"${node}" "${script}" "%1"`;

/** The value `reg query` prints for a key's default or a named value, whatever the language of its "(Default)" label. */
export const regValue = (stdout: string) => /REG_SZ[ \t]+(.*?)\s*$/m.exec(stdout)?.[1] ?? null;
// A path as Windows compares it.
const norm = (p: string) => p.replace(/\\/g, "/").toLowerCase();

// An AppleScript string literal.
const appleString = (text: string) => `"${text.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
/** The macOS app's script: the link to node in the background, quoted by the shell's own rules. */
export const macScript = (node: string, script: string) =>
  [
    "on open location theURL",
    `\tdo shell script "ISOPLAN_CONNECT_URL=" & quoted form of theURL & " " & quoted form of ${appleString(node)} & " " & quoted form of ${appleString(script)} & " >/dev/null 2>&1 &"`,
    "end open location",
    "",
  ].join("\n");

const exists = (file: string) => fs.stat(file).then(() => true, () => false);
/** Whether a registration naming this node and this handler still works: both are there. */
export const works = async (paths: { node?: unknown; script?: unknown } | null) =>
  !!paths && typeof paths.node === "string" && typeof paths.script === "string" && (await exists(paths.node)) && (await exists(paths.script));
/** The node and handler a direct Windows open command names, as directCommand writes it. */
const directPaths = (command: string | null) => {
  const m = command ? /^"([^"]+)" "([^"]+)" "%1"$/.exec(command) : null;
  return m ? { node: m[1], script: m[2] } : null;
};

/** A desktop entry's Exec argument, quoted as the Desktop Entry spec asks, then escaped as its strings are. */
export const execArg = (value: string) => `"${value.replace(/(["`$\\])/g, "\\$1")}"`.replace(/\\/g, "\\\\");
/** The Linux desktop entry. */
export const desktopEntry = (node: string, script: string) =>
  [
    "[Desktop Entry]",
    "Type=Application",
    "Name=Isoplan Connect",
    `Exec=${execArg(node)} ${execArg(script)} %u`,
    "NoDisplay=true",
    "Terminal=false",
    "MimeType=x-scheme-handler/isoplan;",
    `X-Isoplan-Handler=${JSON.stringify({ node, script })}`,
    "",
  ].join("\n");
const desktopPaths = (entry: string | null) => {
  const line = entry ? /^X-Isoplan-Handler=(.*)$/m.exec(entry)?.[1] : undefined;
  try {
    return line ? (JSON.parse(line) as { node?: unknown; script?: unknown }) : null;
  } catch {
    return null;
  }
};

export const linkHandlerLockPath = (claudeDir: string) => path.join(claudeDir, "isoplan", "link-handler.lock");

/** Registers the handler when none works; says what it changed. Another install registering at the same moment leaves it to that one. */
export async function registerLinkHandler(given: LinkHandler): Promise<string[]> {
  const lock = linkHandlerLockPath(given.claudeDir);
  if (!(await takeLock(lock, process.pid, alive, false, Date.now(), { freshMs: 2 * 60 * 1000 }))) return [];
  try {
    return await register(given);
  } finally {
    await releaseLock(lock, process.pid).catch(() => {});
  }
}

async function register(given: LinkHandler): Promise<string[]> {
  // A path that outlives this Node version where there is one (stable-node.ts).
  const h = { ...given, node: await stableNode(given.node, given.env ?? process.env, given.platform) };
  const run = h.run ?? exec;
  const must = async (file: string, args: string[]) => {
    const r = await run(file, args);
    if (r.code !== 0) throw new Error(`${path.basename(file)} ${args[0] ?? ""} failed${r.code === null ? " to start" : ` (${r.code})`}`);
  };
  if (h.platform === "win32") {
    const current = regValue((await run("reg", ["query", COMMAND_KEY, "/ve"])).stdout);
    // With Script Host off, a launcher would show its message, so only a working direct command is kept.
    const off = await scriptHostOff(run);
    if (off && (await works(directPaths(current)))) return [];
    // Through a launcher, this config folder's or another's: kept while the node and handler it names are there.
    const launcher = launcherOf(current);
    if (!off && launcher && (await works(launcherPaths(await fs.readFile(launcher, "utf8").catch(() => null))))) return [];
    const file = linkLauncherPath(h.claudeDir);
    if (!off) {
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, hiddenLauncher(h.node, h.script, { link: true }));
    }
    await must("reg", ["add", KEY, "/ve", "/d", "URL:Isoplan", "/f"]);
    await must("reg", ["add", KEY, "/v", "URL Protocol", "/d", "", "/f"]);
    await must("reg", ["add", OPEN_KEY, "/v", "FriendlyAppName", "/d", "Isoplan", "/f"]);
    await must("reg", ["add", COMMAND_KEY, "/ve", "/d", off ? directCommand(h.node, h.script) : windowsCommand(file), "/f"]);
    return [off ? `registered isoplan:// links to open ${h.script}; Windows Script Host is turned off, so a link shows a console window for a moment` : `registered isoplan:// links to open ${h.script}, through ${file}`];
  }
  if (h.platform === "darwin") {
    const app = macAppPath(h.claudeDir);
    const marker = JSON.stringify({ node: h.node, script: h.script });
    const registered = await fs.readFile(macMarker(app), "utf8").then((t) => JSON.parse(t) as { node?: unknown; script?: unknown }, () => null);
    if (await works(registered)) return [];
    const source = path.join(h.claudeDir, "isoplan", "connect.applescript");
    await fs.rm(app, { recursive: true, force: true });
    await fs.mkdir(path.dirname(source), { recursive: true });
    await fs.writeFile(source, macScript(h.node, h.script));
    try {
      await must("osacompile", ["-o", app, source]);
    } finally {
      await fs.rm(source, { force: true });
    }
    const plist = path.join(app, "Contents", "Info.plist");
    await must("plutil", ["-replace", "CFBundleIdentifier", "-string", "dev.isoplan.connect", plist]);
    await must("plutil", ["-replace", "CFBundleURLTypes", "-json", JSON.stringify([{ CFBundleURLName: "Isoplan link", CFBundleURLSchemes: ["isoplan"] }]), plist]);
    await must("plutil", ["-replace", "LSUIElement", "-bool", "true", plist]);
    await must("codesign", ["--force", "--deep", "--sign", "-", app]);
    await fs.writeFile(macMarker(app), marker);
    await must(LSREGISTER, ["-f", app]);
    return [`registered isoplan:// links to open ${h.script}, through ${app}`];
  }
  if (h.platform === "linux") {
    const file = desktopPath(h);
    const want = desktopEntry(h.node, h.script);
    if ((await run("xdg-mime", ["query", "default", "x-scheme-handler/isoplan"])).stdout.trim() === DESKTOP && (await works(desktopPaths(await fs.readFile(file, "utf8").catch(() => null))))) return [];
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, want);
    await must("xdg-mime", ["default", DESKTOP, "x-scheme-handler/isoplan"]);
    await run("update-desktop-database", [path.dirname(file)]);
    return [`registered isoplan:// links to open ${h.script}, through ${file}`];
  }
  return [];
}

/** Takes the handler out when it is this config folder's; says what it changed. */
export async function unregisterLinkHandler(h: Omit<LinkHandler, "node">): Promise<string[]> {
  const run = h.run ?? exec;
  if (h.platform === "win32") {
    const value = regValue((await run("reg", ["query", COMMAND_KEY, "/ve"])).stdout);
    const launcher = linkLauncherPath(h.claudeDir);
    // This config folder's launcher goes whoever holds the scheme now; nothing else runs it.
    await fs.rm(launcher, { force: true });
    if (!value || ![h.script, launcher].some((p) => norm(value).includes(norm(p)))) return [];
    await run("reg", ["delete", KEY, "/f"]);
    return ["removed the isoplan:// link handler"];
  }
  if (h.platform === "darwin") {
    const app = macAppPath(h.claudeDir);
    if (!(await fs.stat(app).catch(() => null))) return [];
    await run(LSREGISTER, ["-u", app]);
    await fs.rm(app, { recursive: true, force: true });
    return [`removed the isoplan:// link handler, ${app}`];
  }
  if (h.platform === "linux") {
    const file = desktopPath(h);
    if (!(await fs.readFile(file, "utf8").catch(() => "")).includes(execArg(h.script))) return [];
    await fs.rm(file, { force: true });
    await run("update-desktop-database", [path.dirname(file)]);
    return [`removed the isoplan:// link handler, ${file}`];
  }
  return [];
}
