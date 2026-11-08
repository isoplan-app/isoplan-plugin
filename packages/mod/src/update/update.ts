// Keeping the plugin up to date (#96). The plugin's version is pinned in plugin.json, and a release
// is a bump of it: Claude Code installs a new copy only when that version changes. A session's data
// layer runs this as it starts and every `updateCheckHours`, hidden and in the background:
//
// - it turns on Claude Code's own auto-update for the plugin's marketplace, by setting
//   `"autoUpdate": true` on the marketplace's entry under `extraKnownMarketplaces` in the user's
//   settings.json, a documented setting, which `claude plugin marketplace add` writes. Only an entry
//   that is there, with a source and no `autoUpdate` of its own, is changed: a person who turned it
//   off keeps it off, and no entry or source is ever made up. update.json records the entry as the
//   plugin left it, and when, so uninstall takes `autoUpdate` out only from an entry nothing else
//   has changed since, and otherwise leaves it on (install.ts). Claude Code's own records
//   (known_marketplaces.json and the rest) are never written.
// - it runs `claude plugin marketplace update <marketplace>`, then `claude plugin update <id>
//   --scope <scope>` for each install installed_plugins.json records (in its project's folder for a
//   project or local one), which put the version the marketplace offers in Claude Code's plugin
//   cache if it is newer. A running session keeps the version it loaded until /reload-plugins, which
//   the status line asks for (state.ts, `newestDataLayer`).
//
// The commands run with no window and no shell, never prompting: git with no terminal prompt and no
// credential manager window, and, unless the person set their own, an askpass that answers nothing
// and ssh in batch mode; without the variables that tie a process to the session that started it.
// A command is done when it exits, whatever still holds its output open (an ssh ControlMaster, say),
// and one still running after COMMAND_TIMEOUT_MS is stopped with everything it started.
//
// One check runs at a time on the machine (update.lock), and update.json records when the last one
// started: a check is skipped when any session on the machine started one within its floor, which
// is START_GAP_MS for the check a session makes as it starts and `updateCheckHours` for the timed
// ones, so the machine checks about once per interval however many sessions are open. Nothing runs
// when DISABLE_UPDATES, DISABLE_AUTOUPDATER or CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC is set, as
// with Claude Code's own plugin auto-update, unless FORCE_AUTOUPDATE_PLUGINS is set too. A data
// layer outside the plugin cache (a checkout, --plugin-dir, a marketplace added from a local folder,
// which loads in place) has nothing to update, and its caller doesn't run this.

import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { noPromptEnv } from "../handoff/git.js";
import { readSettings, writeSettings } from "../install/install.js";
import { installs, type Install } from "../install/state.js";
import { machineNode } from "../runner/claude-binary.js";
import { forkEnv, killTree } from "../runner/claude.js";
import { alive, releaseLock, takeLock } from "../wake/lock.js";

export const updateRecordPath = (claudeDir: string) => path.join(claudeDir, "isoplan", "update.json");
export const updateLockPath = (claudeDir: string) => path.join(claudeDir, "isoplan", "update.lock");

/** A check at session start is skipped when one started this recently. */
export const START_GAP_MS = 10 * 60000;
/** The most each `claude plugin` command may take. */
export const COMMAND_TIMEOUT_MS = 5 * 60000;
// The end of a command's output kept.
const OUTPUT_CHARS = 8000;
// How long after a command exits its output is still read, before the pipes are let go.
const EXIT_GRACE_MS = 1000;

/** The variables that turn updates off, and the one that turns plugin updates back on. */
export const OFF_VARIABLES = ["DISABLE_UPDATES", "DISABLE_AUTOUPDATER", "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC"] as const;
export const FORCE_VARIABLE = "FORCE_AUTOUPDATE_PLUGINS";

const isSet = (value: string | undefined) => !!value && !/^(0|false|no|off)$/i.test(value.trim());

/** The variable that turns updates off here; null when none does, or FORCE_AUTOUPDATE_PLUGINS turns them back on. */
export function updatesOffBy(env: Record<string, string | undefined>): string | null {
  if (isSet(env[FORCE_VARIABLE])) return null;
  return OFF_VARIABLES.find((name) => isSet(env[name])) ?? null;
}

/** What git's own config sets that the commands' environment has to leave alone. */
export interface GitChoices {
  /** core.sshCommand: the person's own ssh, which isn't put in batch mode. */
  sshCommand: boolean;
  /** core.askPass: the person's own askpass, which isn't replaced. */
  askPass: boolean;
}

/**
 * The environment the commands run with: this one's without the session's own variables (as the
 * runner's fork, claude.ts), and nothing that can prompt (as a handoff's git, handoff/git.ts). The
 * askpass, where the person set none (GIT_ASKPASS, SSH_ASKPASS, core.askPass), is node (machineNode), which takes
 * git's prompt for a script it can't find and fails, so git gives up at once instead of asking.
 */
export function commandEnv(env: Record<string, string | undefined>, git: GitChoices = { sshCommand: false, askPass: false }, node = machineNode()): Record<string, string> {
  const out = noPromptEnv(forkEnv(env), git.sshCommand);
  if (!git.askPass && !out.GIT_ASKPASS && !out.SSH_ASKPASS) Object.assign(out, { GIT_ASKPASS: node, SSH_ASKPASS: node, SSH_ASKPASS_REQUIRE: "never" });
  return out;
}

/** What git's config sets for core.sshCommand and core.askPass, as `cwd` sees it; nothing set when git can't say. */
export async function gitChoices(cwd: string, env: Record<string, string | undefined> = process.env): Promise<GitChoices> {
  const set = async (key: string) => {
    const r = await runHidden(["git", "config", "--get", key], cwd, { env: noPromptEnv(forkEnv(env), true), timeoutMs: 15000 });
    return r.code === 0 && r.output.trim() !== "";
  };
  return { sshCommand: await set("core.sshCommand"), askPass: await set("core.askPass") };
}

/** What a command run said: its exit code and the end of its output, or why it didn't run to the end. */
export interface Ran {
  code: number | null;
  output: string;
  /** It couldn't start, or ran past its time and was stopped. */
  error?: string;
}

export type Run = (argv: string[], cwd: string, env: Record<string, string>) => Promise<Ran>;

/**
 * Runs a command by argv, with no shell and no window, and keeps the end of what it printed. It is
 * done when the command exits: what it printed by then, and within EXIT_GRACE_MS, is kept, and its
 * pipes are let go even if a process it left behind holds them. Past `timeoutMs` it is stopped with
 * everything it started (on Windows taskkill /T; elsewhere its process group, which it leads).
 */
export function runHidden(argv: string[], cwd: string, { env = commandEnv(process.env), timeoutMs = COMMAND_TIMEOUT_MS }: { env?: Record<string, string>; timeoutMs?: number } = {}): Promise<Ran> {
  return new Promise((resolve) => {
    let output = "";
    let timedOut = false;
    const keep = (piece: string) => (output = (output + piece).slice(-OUTPUT_CHARS));
    const child = spawn(argv[0]!, argv.slice(1), { cwd, env, stdio: ["pipe", "pipe", "pipe"], windowsHide: true, detached: process.platform !== "win32" });
    child.stdin.end();
    child.stdout.setEncoding("utf8").on("data", keep);
    child.stderr.setEncoding("utf8").on("data", keep);
    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child);
    }, timeoutMs);
    let ended: Ran | null = null;
    const done = () => {
      child.stdout.destroy();
      child.stderr.destroy();
      resolve({ ...ended!, output });
    };
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ code: null, output, error: `couldn't start ${argv[0]}: ${err.message}` });
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      ended = timedOut ? { code: null, output, error: `didn't finish within ${Math.round(timeoutMs / 1000)} s, so it was stopped` } : { code, output };
      const grace = setTimeout(done, EXIT_GRACE_MS);
      child.on("close", () => (clearTimeout(grace), done()));
    });
  });
}

export interface UpdateOptions {
  claudeDir: string;
  /** The user's settings.json, which declares the marketplace. */
  settings: string;
  /** Claude Code's plugins folder, with installed_plugins.json. */
  plugins: string;
  /** The plugin's id, `<plugin>@<marketplace>`. */
  id: string;
  /** Where the commands run when no install names a folder: the session's project. */
  cwd: string;
  /** What runs `claude`: the binary, or node and its cli.js (claude-binary.ts). */
  claude: string[];
  /** The commands' environment (`commandEnv`). */
  env?: Record<string, string>;
  /** Skipped when a check started this recently, on any session. */
  gapMs: number;
  run?: Run;
  now?: () => number;
  isAlive?: (pid: number) => boolean;
}

/** What a check did, each step as a line for the log; `ran` is false when it was skipped. */
export interface Checked {
  ran: boolean;
  said: string[];
}

/** Turns on Claude Code's auto-update for `marketplace` in `settings` (see above); what it changed, or null. */
export async function turnOnAutoUpdate(settings: string, marketplace: string): Promise<string | null> {
  const current = await readSettings(settings);
  const known = current.extraKnownMarketplaces;
  const entry = isObject(known) ? known[marketplace] : undefined;
  if (!isObject(entry) || !isObject(entry.source) || "autoUpdate" in entry) return null;
  entry.autoUpdate = true;
  await writeSettings(settings, current);
  return `turned on Claude Code's auto-update for the ${marketplace} marketplace in ${settings}`;
}

/**
 * The `claude plugin update` runs for the plugin `id`: one per install recorded (scope and project
 * folder), each with its scope; one with no scope, in `cwd`, when the record can't be read.
 */
export function updateRuns(list: Install[] | null, id: string, cwd: string): { args: string[]; cwd: string }[] {
  const mine = (list ?? []).filter((i) => i.id === id);
  if (!list || !mine.length) return [{ args: ["plugin", "update", id], cwd }];
  const runs = new Map<string, { args: string[]; cwd: string }>();
  for (const install of mine) {
    const inProject = (install.scope === "project" || install.scope === "local") && install.projectPath;
    const at = inProject ? install.projectPath! : cwd;
    const key = `${install.scope}|${inProject ? install.projectPath : ""}`;
    if (!runs.has(key)) runs.set(key, { args: ["plugin", "update", id, ...(install.scope ? ["--scope", install.scope] : [])], cwd: at });
  }
  return [...runs.values()];
}

/** One check (see above), unless another is running or one started within `gapMs`. */
export async function checkForUpdate({
  claudeDir,
  settings,
  plugins,
  id,
  cwd,
  claude,
  env = commandEnv(process.env),
  gapMs,
  run = (argv, at, e) => runHidden(argv, at, { env: e }),
  now = Date.now,
  isAlive = alive,
}: UpdateOptions): Promise<Checked> {
  const lock = updateLockPath(claudeDir);
  // Stale after both commands and every scope could have timed out, with time to spare.
  if (!(await takeLock(lock, process.pid, isAlive, false, now(), { freshMs: 10 * COMMAND_TIMEOUT_MS }))) return { ran: false, said: [] };
  try {
    const recordFile = updateRecordPath(claudeDir);
    const record = await fs.readFile(recordFile, "utf8").then((text) => JSON.parse(text) as Record<string, unknown>, () => ({}) as Record<string, unknown>);
    if (typeof record.checkedAt === "number" && now() - record.checkedAt < gapMs) return { ran: false, said: [] };
    const marketplace = id.slice(id.lastIndexOf("@") + 1);
    const write = () => fs.writeFile(recordFile, JSON.stringify(record) + "\n");
    record.checkedAt = now();
    await write();
    const said: string[] = [];
    const turnedOn = await turnOnAutoUpdate(settings, marketplace).catch((err: unknown) => `couldn't turn on Claude Code's auto-update for ${marketplace}: ${(err as Error).message}`);
    if (turnedOn) said.push(turnedOn);
    if (turnedOn?.startsWith("turned on")) {
      // The entry as the plugin left it, which uninstall compares (install.ts).
      const entry = ((await readSettings(settings)).extraKnownMarketplaces as Record<string, unknown>)[marketplace];
      record.autoUpdateOn = { marketplace, entry: JSON.stringify(entry), at: now() };
      await write();
    }
    const say = async (args: string[], at: string) => {
      const r = await run([...claude, ...args], at, env);
      const failed = r.error ?? (r.code === null ? "didn't finish" : r.code !== 0 ? `failed with exit code ${r.code}` : null);
      said.push(`claude ${args.join(" ")}: ${[failed, lastLine(r.output)].filter(Boolean).join(": ")}`);
      return !failed;
    };
    if (!(await say(["plugin", "marketplace", "update", marketplace], cwd))) return { ran: true, said };
    for (const step of updateRuns(await installs(plugins), id, cwd)) {
      if (await fs.stat(step.cwd).then((s) => s.isDirectory(), () => false)) await say(step.args, step.cwd);
      else said.push(`claude ${step.args.join(" ")}: skipped, its project folder ${step.cwd} isn't there`);
    }
    return { ran: true, said };
  } finally {
    await releaseLock(lock, process.pid).catch(() => {});
  }
}

// The last line a command printed that says something, without the terminal's colour codes.
const lastLine = (output: string) =>
  output
    .replace(/\u001b\[[0-9;]*[A-Za-z]/g, "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .at(-1) ?? "";

const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
