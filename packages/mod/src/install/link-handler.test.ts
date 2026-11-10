import fs from "node:fs";
import path from "node:path";
import { expect, test } from "vitest";
import type { Exec } from "../connect/dialog.js";
import { tempRoot } from "../data-layer/fixture.js";
import { connectScriptPath, installWake, uninstall } from "./install.js";
import { hiddenLauncher, launcherPaths, wscriptPath } from "./hidden-launch.js";
import { desktopEntry, directCommand, linkLauncherPath, macAppPath, macScript, registerLinkHandler, unregisterLinkHandler, windowsCommand } from "./link-handler.js";

const NODE = "C:\\Program Files\\nodejs\\node.exe";
const SCRIPT = "C:\\Users\\ada\\.claude\\isoplan\\runner\\app\\dist\\connect.mjs";

/** A stand-in for the operating system's commands: what was run, and what `answer` says to each. */
function fakeOs(answer: (file: string, args: string[]) => { code: number | null; stdout?: string } = () => ({ code: 0 })) {
  const calls: string[][] = [];
  const run: Exec = async (file, args) => {
    calls.push([path.basename(file), ...args]);
    const a = answer(file, args);
    return { code: a.code, stdout: a.stdout ?? "" };
  };
  return { calls, run };
}

const queried = (value: string) => ({ code: 0, stdout: `\r\nHKEY_CURRENT_USER\\Software\\Classes\\isoplan\\shell\\open\\command\r\n    (Default)    REG_SZ    ${value}\r\n\r\n` });
const COMMAND_KEY = "HKCU\\Software\\Classes\\isoplan\\shell\\open\\command";
/** Windows Script Host turned off by policy, as `reg query` prints it. */
const SCRIPT_HOST_OFF = { code: 0, stdout: "\r\nHKEY_LOCAL_MACHINE\\Software\\Microsoft\\Windows Script Host\\Settings\r\n    Enabled    REG_DWORD    0x0\r\n\r\n" };
/** An OS where the protocol's command is `command` (none when null) and Script Host is on unless `off`. */
const windows = (command: string | null, off = false) =>
  fakeOs((_, args) => {
    if (args[0] !== "query") return { code: 0 };
    if (args[1] === COMMAND_KEY) return command === null ? { code: 1 } : queried(command);
    return off ? SCRIPT_HOST_OFF : { code: 1 };
  });

test("Windows: the isoplan URL protocol goes under HKCU, named Isoplan, through a launcher that hands the link to node hidden, once", async () => {
  const claudeDir = path.join(tempRoot(), ".claude");
  const os = windows(null);
  const h = { platform: "win32" as const, claudeDir, home: "C:\\Users\\ada", node: NODE, script: SCRIPT, run: os.run };
  const launcher = linkLauncherPath(claudeDir);
  expect(await registerLinkHandler(h)).toEqual([`registered isoplan:// links to open ${SCRIPT}, through ${launcher}`]);
  expect(os.calls).toEqual([
    ["reg", "query", COMMAND_KEY, "/ve"],
    ["reg", "query", "HKCU\\Software\\Microsoft\\Windows Script Host\\Settings", "/v", "Enabled"],
    ["reg", "query", "HKLM\\Software\\Microsoft\\Windows Script Host\\Settings", "/v", "Enabled"],
    ["reg", "add", "HKCU\\Software\\Classes\\isoplan", "/ve", "/d", "URL:Isoplan", "/f"],
    ["reg", "add", "HKCU\\Software\\Classes\\isoplan", "/v", "URL Protocol", "/d", "", "/f"],
    ["reg", "add", "HKCU\\Software\\Classes\\isoplan\\shell\\open", "/v", "FriendlyAppName", "/d", "Isoplan", "/f"],
    ["reg", "add", COMMAND_KEY, "/ve", "/d", `"${wscriptPath()}" //B //NoLogo //E:JScript "${launcher}" "%1"`, "/f"],
  ]);
  // The launcher puts the link in node's environment, never on its command line, and starts it with window style 0.
  const text = fs.readFileSync(launcher, "utf8");
  expect(text).toBe(hiddenLauncher(NODE, SCRIPT, { link: true }));
  expect(text).toContain('shell.Environment("PROCESS")("ISOPLAN_CONNECT_URL") = WScript.Arguments(0);');
  expect(text).toContain(`shell.Run(${JSON.stringify(`"${NODE}" "${SCRIPT}"`)}, 0, false);`);
  expect(launcherPaths(text)).toEqual({ node: NODE, script: SCRIPT });
});

test("Windows: a launcher is pure ASCII, as wscript reads a file with no byte-order mark in the ANSI code page, and still names paths outside it", () => {
  const node = "C:\\Users\\José\\nodejs\\node.exe";
  const script = "C:\\Users\\José\\张\\.claude\\isoplan\\runner\\app\\dist\\connect.mjs";
  const text = hiddenLauncher(node, script, { args: "--login", link: true });
  expect(text).toMatch(/^[\x20-\x7e\r\n]*$/);
  expect(launcherPaths(text)).toEqual({ node, script });
  // The command shell.Run is given, read as JScript reads the literal.
  expect(JSON.parse(/^shell\.Run\((.*), 0, false\);\r?$/m.exec(text)![1]!)).toBe(`"${node}" "${script}" --login`);
});

/** A node and a handler that exist, in a temp folder. */
function realFiles() {
  const root = tempRoot();
  const node = path.join(root, "node.exe");
  const script = path.join(root, "connect.mjs");
  fs.writeFileSync(node, "");
  fs.writeFileSync(script, "");
  return { node, script };
}

test("Windows: a launcher whose node and handler exist is left alone, even another folder's; one naming a path that has gone, or the old direct command, is redone", async () => {
  const claudeDir = path.join(tempRoot(), ".claude");
  const there = realFiles();
  const h = { platform: "win32" as const, claudeDir, home: "C:\\Users\\ada", node: NODE, script: SCRIPT };
  const theirs = path.join(tempRoot(), "open-link.js");
  fs.writeFileSync(theirs, hiddenLauncher(there.node, there.script, { link: true }));
  const working = windows(windowsCommand(theirs));
  expect(await registerLinkHandler({ ...h, run: working.run })).toEqual([]);
  // The command, then Script Host's two settings.
  expect(working.calls).toHaveLength(3);
  fs.writeFileSync(theirs, hiddenLauncher(there.node, path.join(path.dirname(there.script), "gone.mjs"), { link: true }));
  const broken = windows(windowsCommand(theirs));
  expect(await registerLinkHandler({ ...h, run: broken.run })).toHaveLength(1);
  expect(broken.calls).toHaveLength(7);
  // Node straight from the registry opens a console window, so a working one of that form goes through the launcher now.
  const direct = windows(directCommand(there.node, there.script));
  expect(await registerLinkHandler({ ...h, run: direct.run })).toHaveLength(1);
  expect(direct.calls.at(-1)).toEqual(["reg", "add", COMMAND_KEY, "/ve", "/d", windowsCommand(linkLauncherPath(claudeDir)), "/f"]);
  // Another install registering at the same moment leaves it to that one.
  fs.writeFileSync(path.join(claudeDir, "isoplan", "link-handler.lock"), JSON.stringify({ pid: process.ppid }));
  const held = fakeOs(() => ({ code: 1 }));
  expect(await registerLinkHandler({ ...h, run: held.run })).toEqual([]);
  expect(held.calls).toEqual([]);
});

test("Windows: with Script Host turned off, links run node directly, a working direct command is kept, and a working launcher is redone directly", async () => {
  const claudeDir = path.join(tempRoot(), ".claude");
  const there = realFiles();
  const h = { platform: "win32" as const, claudeDir, home: "C:\\Users\\ada", node: NODE, script: SCRIPT };
  const none = windows(null, true);
  expect(await registerLinkHandler({ ...h, run: none.run })).toEqual([expect.stringContaining("Windows Script Host is turned off")]);
  expect(none.calls.at(-1)).toEqual(["reg", "add", COMMAND_KEY, "/ve", "/d", `"${NODE}" "${SCRIPT}" "%1"`, "/f"]);
  expect(fs.existsSync(linkLauncherPath(claudeDir))).toBe(false);
  const kept = windows(directCommand(there.node, there.script), true);
  expect(await registerLinkHandler({ ...h, run: kept.run })).toEqual([]);
  expect(kept.calls.filter((c) => c[1] === "add")).toEqual([]);
  // Turned off after a launcher was registered: wscript would show its message on every link.
  const theirs = path.join(tempRoot(), "open-link.js");
  fs.writeFileSync(theirs, hiddenLauncher(there.node, there.script, { link: true }));
  const launched = windows(windowsCommand(theirs), true);
  expect(await registerLinkHandler({ ...h, run: launched.run })).toEqual([expect.stringContaining("Windows Script Host is turned off")]);
  expect(launched.calls.at(-1)).toEqual(["reg", "add", COMMAND_KEY, "/ve", "/d", directCommand(NODE, SCRIPT), "/f"]);
});

test("Windows: uninstall takes the protocol out only when it runs this config folder's handler or launcher, and the launcher goes", async () => {
  const claudeDir = path.join(tempRoot(), ".claude");
  const h = { platform: "win32" as const, claudeDir, home: "C:\\Users\\ada", script: SCRIPT };
  const launcher = linkLauncherPath(claudeDir);
  fs.mkdirSync(path.dirname(launcher), { recursive: true });
  fs.writeFileSync(launcher, hiddenLauncher(NODE, SCRIPT, { link: true }));
  const mine = windows(windowsCommand(launcher));
  expect(await unregisterLinkHandler({ ...h, run: mine.run })).toEqual(["removed the isoplan:// link handler"]);
  expect(mine.calls.at(-1)).toEqual(["reg", "delete", "HKCU\\Software\\Classes\\isoplan", "/f"]);
  expect(fs.existsSync(launcher)).toBe(false);
  const direct = windows(directCommand(NODE, SCRIPT.replace(/\\/g, "/")));
  expect(await unregisterLinkHandler({ ...h, run: direct.run })).toEqual(["removed the isoplan:// link handler"]);
  const another = windows(windowsCommand("D:\\other\\.claude\\isoplan\\open-link.js"));
  expect(await unregisterLinkHandler({ ...h, run: another.run })).toEqual([]);
  expect(another.calls).toHaveLength(1);
});

test("macOS: an AppleScript app claims the isoplan scheme, is signed again and registered with LaunchServices; uninstall unregisters and removes it", async () => {
  const claudeDir = path.join(tempRoot(), ".claude");
  const app = macAppPath(claudeDir);
  let source = "";
  // osacompile makes the app; nothing else here touches the disk.
  const os = fakeOs((file, args) => {
    if (file === "osacompile") {
      source = fs.readFileSync(args[2]!, "utf8");
      fs.mkdirSync(path.join(app, "Contents", "Resources"), { recursive: true });
    }
    return { code: 0 };
  });
  const h = { platform: "darwin" as const, claudeDir, home: "/Users/ada", ...realFiles(), run: os.run };
  expect(await registerLinkHandler(h)).toHaveLength(1);
  expect(source).toBe(macScript(fs.realpathSync(h.node), h.script));
  expect(macScript("/opt/homebrew/bin/node", "/x/connect.mjs")).toContain('do shell script "ISOPLAN_CONNECT_URL=" & quoted form of theURL & " " & quoted form of "/opt/homebrew/bin/node"');
  const plist = path.join(app, "Contents", "Info.plist");
  expect(os.calls.map((c) => c.slice(0, 2))).toEqual([
    ["osacompile", "-o"],
    ["plutil", "-replace"],
    ["plutil", "-replace"],
    ["plutil", "-replace"],
    ["codesign", "--force"],
    ["lsregister", "-f"],
  ]);
  expect(os.calls[2]).toEqual(["plutil", "-replace", "CFBundleURLTypes", "-json", '[{"CFBundleURLName":"Isoplan link","CFBundleURLSchemes":["isoplan"]}]', plist]);
  expect(os.calls).toHaveLength(6);
  // The source it compiled is gone, and a second install, even with another node, leaves the working app alone.
  expect(fs.readdirSync(path.join(claudeDir, "isoplan"))).toEqual(["Isoplan Connect.app"]);
  expect(await registerLinkHandler({ ...h, node: realFiles().node })).toEqual([]);
  expect(os.calls).toHaveLength(6);

  expect(await unregisterLinkHandler(h)).toHaveLength(1);
  expect(os.calls.at(-1)).toEqual(["lsregister", "-u", app]);
  expect(fs.existsSync(app)).toBe(false);
});

test("Linux: a desktop entry for x-scheme-handler/isoplan, made the default with xdg-mime; uninstall removes it", async () => {
  const root = tempRoot();
  const os = fakeOs();
  const h = { platform: "linux" as const, claudeDir: path.join(root, ".claude"), home: root, ...realFiles(), run: os.run };
  const file = path.join(root, ".local", "share", "applications", "isoplan-connect.desktop");
  expect(await registerLinkHandler(h)).toHaveLength(1);
  expect(fs.readFileSync(file, "utf8")).toBe(desktopEntry(fs.realpathSync(h.node), h.script));
  expect(desktopEntry("/usr/bin/node", "/x/connect.mjs")).toContain(`Exec="/usr/bin/node" "/x/connect.mjs" %u\nNoDisplay=true\nTerminal=false\nMimeType=x-scheme-handler/isoplan;`);
  expect(os.calls).toContainEqual(["xdg-mime", "default", "isoplan-connect.desktop", "x-scheme-handler/isoplan"]);
  expect(await unregisterLinkHandler(h)).toHaveLength(1);
  expect(fs.existsSync(file)).toBe(false);
});

test("install registers the handler for the copy beside the runner, and uninstall takes it out; an install without a place for it registers nothing", async () => {
  const root = tempRoot();
  const claudeDir = path.join(root, ".claude");
  const plugin = path.join(root, "plugin");
  fs.mkdirSync(path.join(plugin, "dist"), { recursive: true });
  for (const file of ["config.json", "runner.json", "secret-patterns.json", "prompts/instructions.md", "prompts/question.md", "prompts/brief.md", "prompts/spin-off.md", "prompts/naming.md", "dist/connect.js", "dist/runner.js", "dist/wake.js", "dist/data-layer.js"]) {
    fs.mkdirSync(path.dirname(path.join(plugin, file)), { recursive: true });
    fs.writeFileSync(path.join(plugin, file), "");
  }
  const paths = { claudeDir, settings: path.join(claudeDir, "settings.json"), plugins: path.join(claudeDir, "plugins"), managed: path.join(root, "managed") };
  const os = fakeOs();
  const linkHandler = { platform: "linux" as const, home: root, node: "/usr/bin/node", run: os.run };
  const install = (place?: typeof linkHandler) => installWake(paths, path.join(plugin, "dist", "data-layer.js"), path.join(plugin, "dist", "wake.js"), { runnerFrom: plugin, linkHandler: place });
  await install();
  expect(os.calls).toEqual([]);
  expect(await install(linkHandler)).toContainEqual(expect.stringContaining(`registered isoplan:// links to open ${connectScriptPath(claudeDir)}`));
  expect(fs.existsSync(connectScriptPath(claudeDir))).toBe(true);
  const { changes } = await uninstall(paths, { linkHandler });
  expect(changes).toContainEqual(expect.stringContaining("removed the isoplan:// link handler"));
  expect(fs.existsSync(path.join(root, ".local", "share", "applications", "isoplan-connect.desktop"))).toBe(false);
});
