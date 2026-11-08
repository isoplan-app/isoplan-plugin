// The install script: puts the wake hook in Claude Code's user settings without a session, as the
// plugin's data layer does when it starts, or takes out everything install and the plugin put in
// place (install.ts), leaving wake.json marking the hook as uninstalled, so the plugin's data layer
// doesn't put it back. It also records the `claude` binary and starts the machine's runner
// (src/runner), with an environment recorded from this shell: the runner answers for the machine's
// rooms, and as it starts reports every session written inside the lights-off window, so an install
// that starts it fills the office back in; one already running reports those sessions already.
// Before it starts the runner it installs the desktop app this plugin version names, which then is
// the runner, with its icon in the tray or menu bar (app.ts); without one, the runner runs on node.
//
//   node dist/install.js [--uninstall]
//
// The config folder is $CLAUDE_CONFIG_DIR when it is set, else ~/.claude, as Claude Code's own.

import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { claudePaths } from "../data-layer/claude-paths.js";
import { loadConfig, officesOf } from "../data-layer/config.js";
import { nodeIo } from "../data-layer/io.js";
import { claudeBinaryPath, findClaude } from "../runner/claude-binary.js";
import { recordEnv, runnerEnvPath } from "../runner/environment.js";
import { startRunner } from "../runner/start.js";
import { installApp } from "./app.js";
import { installWake, processCommand, settleMs, uninstall as uninstallAll } from "./install.js";
import { managedDir, pluginDirsOf, pluginsDir } from "./state.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const claudeDir = claudePaths(process.env, os.homedir()).dir;
const paths = { claudeDir, settings: path.join(claudeDir, "settings.json"), plugins: pluginsDir(claudeDir, process.env), managed: managedDir(process.platform), pluginDirs: pluginDirsOf(process.env) };
// How long uninstall waits for the runner to exit before it removes its files.
const RUNNER_EXIT_MS = 10000;
const uninstall = process.argv.includes("--uninstall");
// Where the operating system keeps the isoplan:// link handler (link-handler.ts), which runs this node.
const linkHandler = { platform: process.platform, home: os.homedir(), dataHome: process.env.XDG_DATA_HOME, node: process.execPath };
// And the login item that starts the runner as this person logs in (login-item.ts).
const loginItem = { platform: process.platform, home: os.homedir(), configHome: process.env.XDG_CONFIG_HOME, uid: process.getuid?.(), node: process.execPath };

const start = (args: string[], cwd: string, env?: Record<string, string>) => spawn(process.execPath, args, { cwd, env, detached: true, stdio: "ignore", windowsHide: true }).on("error", () => {}).unref();

try {
  const settle = () => settleMs(claudeDir, path.join(here, "..", "config.json"));
  const changes = uninstall
    ? (await uninstallAll(paths, { optOut: true, settleMs: await settle(), runner: { commandOf: processCommand, waitMs: RUNNER_EXIT_MS }, linkHandler, loginItem })).changes
    : await installWake(paths, path.join(here, "data-layer.js"), path.join(here, "wake.js"), {
        runnerFrom: path.join(here, ".."),
        findClaude: () => findClaude(process.env, process.platform, os.homedir()),
        linkHandler,
        loginItem,
      });
  for (const change of changes) console.log(change);
  if (!changes.length) console.log(uninstall ? "Nothing of Isoplan's was installed; nothing to remove." : "The wake hook is already installed; nothing changed.");
  if (!uninstall) {
    if (!(await fs.stat(claudeBinaryPath(claudeDir)).catch(() => null))) console.log("Couldn't find the claude binary, so the runner can't answer for this machine's rooms; set its path in " + claudeBinaryPath(claudeDir) + ' as { "path": "..." }.');
    // The runner starts with this shell's environment, not a session's (src/runner/environment.ts).
    if (await recordEnv(claudeDir, process.env)) console.log(`recorded the runner's environment in ${runnerEnvPath(claudeDir)}`);
    // The desktop app, where this plugin version has one for this computer, is then the runner (app.ts).
    for (const change of (await installApp({ claudeDir, from: path.join(here, ".."), platform: process.platform, arch: process.arch, home: os.homedir(), env: process.env })).changes) console.log(change);
    const runner = await startRunner({ claudeDir, spawn: start });
    console.log(
      {
        started: "Started the runner, which answers for this machine's rooms.",
        running: "The runner is already running.",
        "held-off": `The runner is holding off for now (the office server didn't want it, or it kept crashing); see ${path.join(claudeDir, "isoplan", "logs", "runner.log")}.`,
        "not-installed": "The runner wasn't started: its copy isn't in place.",
      }[runner],
    );
    const config = await loadConfig(nodeIo(), path.join(here, "..", "config.json"), path.join(claudeDir, "isoplan", "config.json"));
    if (runner === "started") console.log(`The runner reports this machine's sessions from the last ${config.lightsOffHours} hours to ${officesOf(config).map((o) => o.server).join(", ")} as it starts.`);
  }
} catch (err) {
  process.stderr.write(`isoplan install: ${(err as Error).message}\n`);
  process.exitCode = 1;
}
