// The isoplan:// link handler, which the operating system runs when the floor's Connect Claude Code
// opens a link (connect.ts says what it does; src/install/link-handler.ts registers it):
//
//   node dist/connect.js <isoplan://connect?...>
//
// Install runs it from its copy beside the runner's (<claude dir>/isoplan/runner/app/dist/connect.mjs),
// which outlives plugin updates, with the mod's config.json one folder up as here. Given the link
// as an argument, it starts itself again, hidden and detached, with the link in its environment,
// says so in one line, and returns at once: the floor's set-up message has Claude run it from a shell
// whose command would otherwise wait for the dialog's answer, up to five minutes, and on Windows
// where Script Host is off the link starts node in conhost's console, which has no window, and closes at
// once. (The Mac handler and the Windows launcher pass the link in the environment, already in the
// background.) What it did, and why it didn't, goes to <claude dir>/isoplan/logs/connect.log as well
// as the dialog.
//
// isoplan://start-runner, which the web app's "Restart Isoplan on this machine" opens, starts this
// computer's runner instead, as the login item does (src/wake/outside.ts), with no dialog and no
// window, and says in connect.log what it did. A runner already running is left as it is.
//
// /isoplan:connect (commands/connect.md), and the floor's set-up message, run it two more ways, and
// what they print is status.ts's one plain sentence:
//
//   node dist/connect.js --wait <isoplan://connect?...>   starts it as above, then reads connect.log until it says how that ended, for up to WAIT_MS (status.ts)
//   node dist/connect.js --status                         which offices this computer is connected to
//
// `--wait` hands the copy it starts a random run id ($ISOPLAN_CONNECT_RUN), which tags each of its
// lines, so only its own lines are read, never another link's.

import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig, officesOf } from "../data-layer/config.js";
import { accountOf, claudePaths } from "../data-layer/identity.js";
import { nodeIo } from "../data-layer/io.js";
import { pairingEntry, pairingPath, readPairing } from "../data-layer/pairing.js";
import { managedDir, pluginDirsOf, pluginsDir } from "../install/state.js";
import { startFromOutside, type FromOutside } from "../wake/outside.js";
import { connect, stopReporting } from "./connect.js";
import { ask, tell } from "./dialog.js";
import { isStartRunnerLink, parseLink } from "./link.js";
import { resultSentence, runTag, statusSentence, waitForResult } from "./status.js";

const ENV = "ISOPLAN_CONNECT_URL";
const RUN_ENV = "ISOPLAN_CONNECT_RUN";
const run = /^[0-9a-f]{16}$/.test(process.env[RUN_ENV] ?? "") ? process.env[RUN_ENV]! : null;
const here = path.dirname(fileURLToPath(import.meta.url));
const mode = !process.env[ENV] && (process.argv[2] === "--wait" || process.argv[2] === "--status") ? process.argv[2] : null;
const link = process.env[ENV] ?? process.argv[mode ? 3 : 2];
const { dir: claudeDir, json: claudeJson } = claudePaths(process.env, os.homedir());
const logFile = path.join(claudeDir, "isoplan", "logs", "connect.log");
const defaultsPath = path.join(here, "..", "config.json");
const account = () => accountOf({ readText: (p) => fs.readFile(p, "utf8").catch(() => null), run: nodeIo().run }, claudeJson, os.homedir());
const startDetached = (link: string, run?: string) => {
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url)], { detached: true, windowsHide: true, stdio: "ignore", env: { ...process.env, [ENV]: link, ...(run && { [RUN_ENV]: run }) } });
  child.unref();
  let running = true;
  child.on("exit", () => (running = false)).on("error", () => (running = false));
  return () => running;
};
const log = (text: string) => {
  void fs
    .mkdir(path.dirname(logFile), { recursive: true })
    .then(() => fs.appendFile(logFile, `${new Date().toISOString()} ${run ? `${runTag(run)} ` : ""}${text}\n`))
    .catch(() => {});
};
// What isoplan://start-runner did, in a sentence.
const STARTED: Record<FromOutside, string> = {
  started: "Started Isoplan on this computer.",
  running: "Isoplan was already running on this computer.",
  "held-off": "Isoplan is holding off on this computer for up to an hour (the office didn't want it, or it kept stopping); see runner.log beside this log.",
  "not-installed": "Isoplan isn't set up on this computer yet: start Claude Code once, so the plugin sets itself up.",
  disabled: "Isoplan's plugin is turned off on this computer, so nothing was started.",
  uninstalling: "Isoplan's plugin was uninstalled, so it is being taken off this computer.",
  off: "Isoplan no longer starts when you log in on this computer.",
};

if (link && !mode && isStartRunnerLink(link)) {
  const hidden = (args: string[], cwd: string, env?: Record<string, string>) => spawn(process.execPath, args, { cwd, env, detached: true, stdio: "ignore", windowsHide: true }).on("error", () => {}).unref();
  const paths = { claudeDir, settings: path.join(claudeDir, "settings.json"), plugins: pluginsDir(claudeDir, process.env), managed: managedDir(process.platform), pluginDirs: pluginDirsOf(process.env) };
  const said = STARTED[await startFromOutside({ paths, spawn: hidden })];
  log(`isoplan://start-runner: ${said}`);
  process.stdout.write(said + "\n");
} else if (mode === "--status") {
  const offices = officesOf(await loadConfig(nodeIo(), defaultsPath, path.join(claudeDir, "isoplan", "config.json")));
  const [pairing, who] = await Promise.all([readPairing(pairingPath(claudeDir)), account()]);
  process.stdout.write(statusSentence(offices.map((o) => ({ label: o.label, server: o.server, connected: !!pairingEntry(pairing, o.server, who.id)?.credential }))) + "\n");
} else if (mode === "--wait" && link) {
  const parsed = parseLink(link);
  if (typeof parsed === "string") {
    process.stdout.write(`Not connected, because ${parsed}; press Connect Claude Code on the Isoplan page to try again.\n`);
    process.exitCode = 1;
  } else {
    const id = randomBytes(8).toString("hex");
    const running = startDetached(link, id);
    const result = await waitForResult(() => fs.readFile(logFile, "utf8").catch(() => ""), id, { alive: running });
    process.stdout.write(resultSentence(result, parsed.host) + "\n");
    if (result?.kind !== "connected") process.exitCode = 1;
  }
} else if (!process.env[ENV] && link) {
  startDetached(link);
  process.stdout.write(`A window is opening on this computer to connect Claude Code to Isoplan: answer it there. Run this only once. What happens is written to ${logFile}.\n`);
} else if (!link) {
  process.stderr.write("usage: node connect.js [--wait] <isoplan://connect?...>, node connect.js isoplan://start-runner, or node connect.js --status\n");
  process.exitCode = 2;
} else {
  try {
    await connect(link, {
      claudeDir,
      defaultsPath,
      account,
      machine: os.hostname(),
      ask: (title, text) => ask(process.platform, title, text),
      tell: (title, text, problem) => tell(process.platform, title, text, problem),
      restart: () => stopReporting(claudeDir),
      log,
    });
  } catch (err) {
    log(`couldn't connect: ${String((err as Error)?.stack ?? err)}`);
    await tell(process.platform, "Connect Claude Code to Isoplan", `Claude Code wasn't connected: ${String((err as Error)?.message ?? err)}`, true).catch(() => {});
    process.exitCode = 1;
  }
}
