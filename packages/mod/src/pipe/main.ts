// The hooks module's end of the runner's pipe (client.ts), which it spawns for its session:
//
//   node dist/pipe.js --session <session id> --cwd <the session's folder> [--since <ms>] [--messages] [--ends-turns]
//
// As it starts, unless a newer version of the plugin is on disk, it puts this version's wake hook
// and the runner's copy in place and starts the runner (startMachine), as the plugin's data layer
// did, so a session that loads a new version brings the machine's runner up to it, and, in the
// background, the desktop app this version names (src/install/app.ts). Then it relays
// the runner's lines for the session to stdout. Claude Code ends it with the session; as a backstop
// it also ends when stdout breaks or its parent process has gone (on POSIX an orphan is re-parented,
// so a changed ppid means gone even if the old pid is reused).

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { DataLayerLine } from "../lines.js";
import { loadConfig } from "../data-layer/config.js";
import { claudePaths } from "../data-layer/identity.js";
import { nodeIo } from "../data-layer/io.js";
import { appComputer, sessionLog, spawnHidden, startMachine, systemPlaces } from "../data-layer/report-session.js";
import { managedDir, newestDataLayer, pluginDirsOf, pluginsDir, type Place } from "../install/state.js";
import { startRunner } from "../runner/start.js";
import { alive } from "../wake/lock.js";
import { relay } from "./client.js";
import { sessionEnv } from "./pipe.js";

// How often it checks that its parent is still there.
const PARENT_CHECK_MS = 5000;

const value = (argv: string[], flag: string) => {
  const i = argv.indexOf(flag);
  return i >= 0 && argv[i + 1] && !argv[i + 1]!.startsWith("--") ? argv[i + 1]! : null;
};

/** Runs the pipe's end for the session the arguments name; `appDir` is the plugin's folder. */
export async function pipeMain(argv: string[], appDir: string): Promise<number> {
  const session = value(argv, "--session");
  const cwd = value(argv, "--cwd");
  if (!session || !cwd) {
    process.stderr.write("usage: node pipe.js --session <id> --cwd <dir> [--since <ms>] [--messages] [--ends-turns]\n");
    return 2;
  }
  const { dir: claudeDir } = claudePaths(process.env, os.homedir());
  const parent = process.ppid;
  let isOut = true;
  process.stdout.on("error", () => (isOut = false));
  const out = (line: DataLayerLine) => {
    if (isOut) process.stdout.write(JSON.stringify(line) + "\n");
  };
  const goOn = () => isOut && process.ppid === parent && alive(parent);
  setInterval(() => goOn() || process.exit(0), PARENT_CHECK_MS).unref();

  const here = path.join(appDir, "dist");
  const place: Place = { claudeDir, plugins: pluginsDir(claudeDir, process.env), managed: managedDir(process.platform), pluginDirs: pluginDirsOf(process.env) };
  // dist/data-layer.js names the plugin's copy, as Claude Code's records and the wake hook know it (state.ts).
  const self = path.join(here, "data-layer.js");
  // An outdated copy installs nothing, so it never hands the wake hook and the runner back to older code.
  const outdated = (await newestDataLayer(place.plugins, self, cwd).catch(() => self)) !== self;
  // The desktop app installs in the background while the session runs (startMachine's `app`).
  if (!outdated) await startMachine({ place, here, spawn: spawnHidden, log: (text) => out({ type: "log", text }), ...systemPlaces(), app: appComputer() }).started;

  const io = nodeIo();
  const version = await fs
    .readFile(path.join(appDir, ".claude-plugin", "plugin.json"), "utf8")
    .then((text) => String((JSON.parse(text) as { version?: unknown }).version ?? "0.0.0"))
    .catch(() => "0.0.0");
  const said = sessionLog(claudeDir, session);
  await relay({
    claudeDir,
    // The session's own plugin folders and update switches go with it: the runner's environment isn't the session's.
    hello: { session, cwd, since: Number(value(argv, "--since")) || Date.now(), messages: argv.includes("--messages"), endsTurns: argv.includes("--ends-turns"), root: appDir, version, env: sessionEnv(process.env) },
    out,
    goOn,
    startRunner: () => startRunner({ claudeDir, spawn: spawnHidden }),
    say: said.say,
    retryMs: async () => (await loadConfig(io, path.join(appDir, "config.json"), path.join(claudeDir, "isoplan", "config.json"))).runnerRetrySeconds * 1000,
  });
  await said.flushed();
  return 0;
}

/** Runs it as the process's whole job, from a script one folder below the plugin's folder. */
export async function runPipe(scriptUrl: string): Promise<void> {
  const crash = (err: unknown): never => {
    process.stderr.write(`${String((err as Error)?.stack ?? err)}\n`);
    process.exit(1);
  };
  process.on("uncaughtException", crash).on("unhandledRejection", crash);
  process.exitCode = await pipeMain(process.argv.slice(2), path.join(path.dirname(fileURLToPath(scriptUrl)), "..")).catch(crash);
  process.exit();
}
