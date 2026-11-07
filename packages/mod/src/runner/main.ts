// The runner: one per machine, answering the office server's requests for any of the machine's
// rooms from a fork of the room's lead (src/runner/runner.ts).
//
//   node <claude dir>/isoplan/runner/app/dist/runner.mjs --claude-dir <claude dir>             the supervisor
//   node <claude dir>/isoplan/runner/app/dist/runner.mjs --claude-dir <claude dir> --worker    the worker, which the supervisor starts
//
// Without --claude-dir the config folder is $CLAUDE_CONFIG_DIR or ~/.claude, as Claude Code's own.
// A folder other than ~/.claude is set as CLAUDE_CONFIG_DIR, so the fork finds its sessions there.
//
// It runs from a copy install makes (src/install), not from the plugin's own folder, which a
// plugin update deletes. The copy holds the defaults it reads beside it: config.json, runner.json,
// secret-patterns.json and prompts/.
//
// Install, a session's hooks module (through its end of the pipe, src/pipe) and the wake hook start the supervisor, detached (start.ts). It
// takes <claude dir>/isoplan/runner/lock.json, so a second one exits at once, writes the code it
// runs into it and keeps it fresh, and runs the worker, starting it again after a crash
// (lifecycle.ts). After MAX_FAST_FAILURES quick crashes in a row it gives up and lets the lock go.
// The worker holds one link to each office server in config.json (#105), opened with a runner hello
// carrying the machine's pairing token with that server when it signs people in, under the machine's
// Claude account (src/data-layer/pairing.ts; a link to approve goes to the log, and to the status
// line of each session waiting for it, through its hooks module, pair-links.ts), and stays up while any session on the machine is inside its
// lights-off window. Each office's link answers for that office alone: only for sessions in a repo
// it takes, from the same list the data layers read (src/data-layer/approved.ts). The forks, their
// cap (`maxForks`, one for the machine), the ledger and its caps are shared by every office. When a
// server doesn't want this machine's runner, or says its pairing has ended, only that office's link
// closes, and opens again later (offices.ts); a runner none wants holds off starting again for
// HOLD_OFF_MS. The worker exits when its supervisor has gone too, since its stdin closes then, and
// ends its forks as it goes.
//
// Its settings are runner.json, overridden per key by ~/.claude/isoplan/runner.json; the secret
// patterns are secret-patterns.json plus ~/.claude/isoplan/secret-patterns.json. Its ledger of
// answers is <claude dir>/isoplan/runner/ledger.json, and it logs to
// <claude dir>/isoplan/logs/runner.log.
//
// The worker reports every Claude Code session on the machine (reporting.ts, ADR 0007): headless
// ones, those it drives, those without the plugin, and those whose hooks module is connected to its
// pipe (src/pipe/server.ts), each on a link of its own to each office, sharing the runner's pairing
// and list. A hooks module gets its session's lines down the pipe, and the ask_room script asks the
// room through it (src/ask/machine.ts), only for a session whose hooks module is connected. Its
// address and token are in <claude dir>/isoplan/runner/pipe.json, which the worker writes as it starts.
//
// The worker also drives its person's sessions from the floor (session.ts; its hello says `drive`),
// for every office through one driver, and records every process it starts for that, and every
// fork and take into the Claude app's first turn, in <claude dir>/isoplan/runner/processes.json
// (registry.ts). As it starts, under the runner's lock, it ends what an earlier run left there that
// is verifiably Isoplan's, keeping driven sessions to open again. It doesn't stop for lights-off
// while a driven session's process runs, or while `startAtLogin` is on: then a person who works only
// on the floor keeps a runner up.

import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PROTOCOL_VERSION, type DrivenMessage, type RefusalMessage, type ReplyMessage, type TakenMessage } from "@isoplan/protocol";
import { loadConfig, loadSettings, officesOf, type Office } from "../data-layer/config.js";
import { approvedPath, createApproved } from "../data-layer/approved.js";
import { approvedHome, machineHomeIo, takesFrom } from "../data-layer/home.js";
import { askingRemoteNames } from "../data-layer/remote-names.js";
import { accountOf, claudePaths } from "../data-layer/identity.js";
import { nodeIo } from "../data-layer/io.js";
import { createLink } from "../data-layer/link.js";
import { createPairing, pairingEntry, pairingLockPath, pairingPath, pairingWriteLockPath, readPairing } from "../data-layer/pairing.js";
import { HOLD_OFF_MS, alive, holdOff, refreshLock, releaseLock, takeLock } from "../wake/lock.js";
import { openLedger } from "./caps.js";
import { createClaudeAnswerer, forkableId, forkEnv } from "./claude.js";
import { claudeBinary } from "./claude-binary.js";
import { createClaudeSetup } from "./claude-setup.js";
import { anyRoomSince, askableMs, NOT_WANTED_CODE, onEscapes, supervise, UNPAIRED_CODE } from "./lifecycle.js";
import { loadPrompts } from "./prompts.js";
import { createRunGit, gitFailed, handoffBranch, handoffNote, HandoffGitError, prepare, pushHandoff, type Prepared } from "../handoff/git.js";
import { focusHandoff } from "../handoff/focus.js";
import { findOrca, orcaRunner } from "../handoff/orca.js";
import { desktopProblem, sessionFolders, takeHandoff, type TakeSettings } from "../handoff/take.js";
import { recordTakenOffice } from "../handoff/taken-office.js";
import { answerOffices } from "./offices.js";
import { createForkSlots, createRunner, PushFailed, type RunnerSettings } from "./runner.js";
import { errorText, loadPatterns, scan } from "./scan.js";
import { createRegistry, registryPath } from "./registry.js";
import { branchFolder, createCheckouts, createRemoteBranches, orcaBranchFolder } from "./checkouts.js";
import { repoFolders } from "./repo-folders.js";
import { createDriver, type DriveOffice, type Driver, type DriveSettings } from "./session.js";
import { watchSessions } from "./reporting.js";
import { managedDir, pluginDirsOf, pluginsDir } from "../install/state.js";
import { recordedState } from "../install/install.js";
import { reportSession, sessionLog } from "../data-layer/report-session.js";
import { askFromMachine } from "../ask/machine.js";
import { createPipeServer, type Hooked } from "../pipe/server.js";
import { createPairLinks } from "./pair-links.js";
import { startPlaces, startWhere } from "./start-where.js";
import { runnerEnvPath } from "./environment.js";
import { applyClaudeDir, LOCK_REFRESH_MS, RUNNER_FRESH_MS, runnerCode, runnerLockPath } from "./start.js";

// The runner's log starts over once it is this big.
const LOG_CAP_BYTES = 256 * 1024;
// How often the worker checks whether any room is still lit.
const CHECK_MS = 60000;
// How often the runner checks again whether the Claude app can take handoffs here.
const DESKTOP_CHECK_MS = 3600000;
// Prepares kept for their pushes; past this the oldest goes.
const MAX_PREPARED = 20;

const self = fileURLToPath(import.meta.url);
const here = path.dirname(self);
const appDir = path.join(here, "..");
applyClaudeDir(process.argv, process.env, os.homedir());
const { dir: claudeDir, json: claudeJson } = claudePaths(process.env, os.homedir());
const isoplanDir = path.join(claudeDir, "isoplan");
const logFile = path.join(isoplanDir, "logs", "runner.log");

let logging = Promise.resolve();
function log(text: string) {
  const line = `${new Date().toISOString()} ${text}\n`;
  logging = logging.then(() => writeLog(line)).catch(() => {});
}

async function writeLog(text: string): Promise<void> {
  const size = (await fs.stat(logFile).catch(() => null))?.size ?? 0;
  await fs.mkdir(path.dirname(logFile), { recursive: true });
  if (size > LOG_CAP_BYTES) await fs.writeFile(logFile, text);
  else await fs.appendFile(logFile, text);
}

async function supervisor(): Promise<number> {
  const lock = runnerLockPath(claudeDir);
  const code = await runnerCode(self);
  if (!(await takeLock(lock, process.pid, alive, false, Date.now(), { freshMs: RUNNER_FRESH_MS, extra: { code } }).catch(() => false))) return 0;
  log(`runner ${process.pid} started`);
  if (process.argv.includes("--inherited-env")) log(`no environment is recorded in ${runnerEnvPath(claudeDir)}, so the runner runs with its starter's; run the plugin's install script to record one`);
  // Kept fresh, so a lock left by a crash or a reboot goes stale. One another runner took (a
  // newer version, say) ends this one; its worker follows, ending its forks, as its stdin closes.
  const refresh = setInterval(() => {
    void refreshLock(lock, process.pid).then((isHolder) => {
      if (isHolder) return;
      log(`runner ${process.pid} stopped: another runner took its lock`);
      process.exit(0);
    }, () => {});
  }, LOCK_REFRESH_MS);
  const stopped = await supervise({
    log,
    run: () =>
      new Promise((resolve) => {
        const child = spawn(process.execPath, [self, "--claude-dir", claudeDir, "--worker"], { cwd: claudeDir, stdio: ["pipe", "ignore", "pipe"], windowsHide: true });
        // A crash's stack trace goes to the log.
        let stderr = "";
        child.stderr.setEncoding("utf8").on("data", (piece: string) => (stderr = (stderr + piece).slice(-4000)));
        child.on("error", (err) => (log(`couldn't start the runner's worker: ${err.message}`), resolve(1)));
        child.on("close", (exit) => {
          if (stderr.trim()) log(`the runner's worker wrote: ${stderr.trim()}`);
          resolve(exit);
        });
      }),
  });
  clearInterval(refresh);
  if (stopped === "done" || stopped === "unpaired") {
    // Unpaired, it doesn't hold off: the sessions' links pair the machine again, and the next
    // start, from one of them, the wake hook or the login item, picks up the new credential. While
    // the worker reports sessions it doesn't end, and their shared pairing pairs the machine again.
    log(`runner ${process.pid} stopped: ${stopped === "done" ? "no room on this machine is lit" : "the office server says this machine's pairing has ended"}`);
    await releaseLock(lock, process.pid).catch(() => {});
  } else {
    // Neither goes away by starting again: it holds off, which a newer version ends for a crash loop.
    const why = stopped === "not-wanted" ? "the office server doesn't want this machine's runner" : "its worker kept crashing as it started";
    log(`runner ${process.pid} stopped: ${why}; it won't start again for ${HOLD_OFF_MS / 60000} minutes`);
    await holdOff(lock, process.pid, Date.now() + HOLD_OFF_MS, { reason: stopped, code }).catch(() => {});
  }
  return 0;
}

async function worker(): Promise<number> {
  onEscapes({
    on: (event, handler) => void process.on(event, handler),
    said: async (err) => errorText(err, await loadPatterns(path.join(appDir, "secret-patterns.json"), path.join(isoplanDir, "secret-patterns.json"), () => {})),
    log,
    exit: () => void logging.then(() => process.exit(1)),
  });
  const io = nodeIo();
  const config = () => loadConfig(io, path.join(appDir, "config.json"), path.join(isoplanDir, "config.json"));
  const settings = () => loadSettings<RunnerSettings & TakeSettings & DriveSettings & { claudeModel: string; repoSearchDepth: number; startAtLogin: boolean }>(io, path.join(appDir, "runner.json"), path.join(isoplanDir, "runner.json"));
  const first = await config();
  // Plain ws:// to another machine would send the machine's credential unencrypted.
  const offices = officesOf(first);
  for (const { server } of offices.filter((o) => o.plainRefused)) log(`the runner doesn't answer through ${server}: it is plain ws:// to another machine; use wss://, or set "allowPlainWs": true in config.json`);
  if (offices.every((o) => o.plainRefused)) return 0;
  await settings(); // a broken runner.json of the plugin's is a crash to see at once
  const answering = offices.filter((o) => !o.plainRefused);
  const account = await accountOf({ readText: (p) => fs.readFile(p, "utf8").catch(() => null), run: io.run }, claudeJson, os.homedir());
  // The machine's links to pair it, to the sessions waiting for them.
  const pairLinks = createPairLinks();
  const emitFor = (server: string): Parameters<typeof createLink>[0]["emit"] => (line) => {
    if (line.type === "log") log(line.text);
    else if (line.type === "error") log(`the office server at ${server} says: ${line.message} (${line.code})`);
    else if (line.type === "pair") {
      log(`to answer for this machine's rooms through ${line.server}, pair it: click ${line.url} on this computer and approve it in the office (it works until ${line.expires})`);
      // The machine's one pairing: its link is in the status line of each session waiting for it.
      const label = offices.find((o) => o.server === line.server)?.label;
      pairLinks.pair({ ...line, ...(label && { label }) });
    }
  };
  // Each office's pairing and list of repos (src/data-layer/approved.ts), one of each for the
  // machine: the runner answers only for sessions in a repo the office takes, and the sessions it
  // reports share them, so a machine not paired yet is paired once per office.
  const shared = new Map(
    answering.map((office) => {
      const { server } = office;
      const pairing = createPairing({
        file: pairingPath(claudeDir),
        lock: pairingLockPath(claudeDir, office),
        writeLock: pairingWriteLockPath(claudeDir),
        server,
        account,
        machine: os.hostname(),
        emit: emitFor(server),
        allowPlainWs: first.allowPlainWs,
        legacy: !!office.legacy,
      });
      const approved = createApproved({ server, file: approvedPath(claudeDir, server), pairing, refreshMs: first.approvedRefreshMinutes * 60000, maxAgeMs: first.approvedMaxAgeMinutes * 60000, log });
      return [server, { pairing, approved }] as const;
    }),
  );
  // Every session on the machine is reported from here (reporting.ts), started first, so a runner
  // started again has them on the floor again soon: those of hooks modules once they say hello, the
  // recent ones without once the first look's hold of twice runnerRetrySeconds has passed.
  const paths = { claudeDir, settings: path.join(claudeDir, "settings.json"), plugins: pluginsDir(claudeDir, process.env), managed: managedDir(process.platform), pluginDirs: pluginDirsOf(process.env) };
  const isOff = async (folder: string) => (await recordedState(paths, folder).catch(() => "enabled" as const)) !== "enabled";
  const scanText = async (text: string) => scan(text, await loadPatterns(path.join(appDir, "secret-patterns.json"), path.join(isoplanDir, "secret-patterns.json"), log));
  // Each session's hooks module reaches the runner here (src/pipe/server.ts), opened before the first
  // look, so the hooks modules of a runner started again can say hello before it. A worker that can't
  // serve the pipe still reports every session, without their hooks modules.
  let rehook = (_session: string) => {};
  const pipe = await createPipeServer({
    claudeDir,
    log,
    onChange: (session) => rehook(session),
    ask: (request) => askFromMachine({ ...request, appDir, scan: scanText }),
  }).catch((err: Error) => (log(`the runner couldn't open its pipe for the sessions' hooks modules: ${err.message}`), null));
  const reporting = watchSessions<Hooked>({
    claudeDir,
    io,
    config,
    isOff,
    log,
    hooked: (id) => pipe?.hooked(id) ?? null,
    held: (id, hooks) => {
      sessionLog(claudeDir, id).say("an earlier version's data layer reports this session, so the runner doesn't: its hooks module is told so, and tries again later");
      hooks.send({ type: "superseded", reason: "earlier" });
    },
    report: async ({ sessionId, cwd, notWanted, closed, hooks }) => {
      const said = sessionLog(claudeDir, sessionId);
      said.say(hooks ? `the runner reports this session for its hooks module, in ${cwd}` : `the runner reports this session, in ${cwd}`);
      const shares = (office: Office) => shared.get(office.server) ?? null;
      try {
        if (hooks)
          return await reportSession({
            sessionId,
            cwd,
            by: "hooks",
            appDir,
            root: hooks.root,
            since: hooks.since,
            env: hooks.env,
            takesMessages: hooks.messages,
            emit: (line) => {
              said.emit(line);
              hooks.send(line);
              pairLinks.sent(sessionId, line, hooks.send);
            },
            closed: Promise.race([closed, hooks.closed.then(() => "its hooks module's link to the runner closed")]),
            shared: shares,
          }).finally(() => pairLinks.ended(sessionId, hooks.send));
        return await reportSession({ sessionId, cwd, by: "runner", appDir, emit: said.emit, closed, notWanted, isOff: () => isOff(cwd), shared: shares });
      } catch (err) {
        said.say(`stopping: something went wrong: ${String((err as Error)?.stack ?? err)}`);
        throw err;
      } finally {
        await said.flushed();
      }
    },
  });
  rehook = reporting.rehook;

  // Every process it starts is recorded; what an earlier run left that is Isoplan's ends now. Only a
  // worker whose supervisor holds the runner's lock gets here.
  const registry = createRegistry({ file: registryPath(claudeDir), log });
  await registry.restore();
  const binary = () => claudeBinary(claudeDir, process.env, process.platform, os.homedir());
  const answerer = createClaudeAnswerer({
    claudeDir,
    binary,
    model: async () => (await settings()).claudeModel,
    config,
    track: registry.track,
  });
  let driver: Driver | null = null;
  // However the worker ends, its forks and driven sessions end with it.
  process.on("exit", () => {
    answerer.close();
    driver?.close();
  });
  const git = createRunGit();
  const gitMs = async () => (await settings()).gitTimeoutSeconds * 1000;
  // A git failure is told by its kind; git's own words stay in the log.
  const told = (err: unknown) => {
    if (!(err instanceof HandoffGitError)) throw err;
    log(`handoff git: ${err.detail}`);
    return new PushFailed(gitFailed(err));
  };
  // Orca's CLI, as the runner starts: the office offers a take into Orca only where it is.
  const orca = () => findOrca(process.env, process.platform, os.homedir());
  const hasOrca = (await orca()) !== null;
  const takeOrca = async () => {
    const bin = await orca();
    return bin ? orcaRunner(bin, forkEnv(process.env)) : null;
  };
  // The office offers a take into the Claude app only while this machine can do one (take.ts
  // desktopProblem): Claude Code for the terminal new enough, signed in with a subscription, on a Mac
  // or Windows x64. Checked as the runner starts and every hour after; each link says it in its hello
  // as it opens.
  let hasDesktop = false;
  const checkDesktop = async () => {
    const bin = await claudeBinary(claudeDir, process.env, process.platform, os.homedir());
    hasDesktop = !!bin && (await desktopProblem(bin, forkEnv(process.env), process.platform, process.arch, os.hostname())) === null;
  };
  await checkDesktop().catch((err: Error) => log(`couldn't check whether the Claude app can take handoffs here: ${err.message}`));
  // Claude Code for the terminal here (claude-setup.ts): each hello says it, and every office is told
  // when the hourly check, an install or a sign-in from the floor finds it changed.
  const claude = createClaudeSetup({ binary, send: (message) => driver?.say(message), scan: scanText, log, cwd: os.homedir(), env: forkEnv(process.env) });
  await claude.check().catch((err: Error) => log(`couldn't check for Claude Code here: ${err.message}`));
  setInterval(() => void checkDesktop().then(() => claude.check()).catch(() => {}), DESKTOP_CHECK_MS).unref();
  // A GitHub repo's current name, asked for before a remote first seen is used (remote-names.ts).
  const names = askingRemoteNames(claudeDir);
  const homeIo = machineHomeIo(first.workspaceRepos, names);
  const ledger = await openLedger(path.join(isoplanDir, "runner", "ledger.json"));
  // What each brief's prepare found, by handoff, for its push and any push anyway after it.
  const preparedFor = new Map<string, Prepared>();
  // One fork cap for the machine, whichever office asks.
  const forks = createForkSlots();
  let send = (_index: number): Parameters<typeof createRunner>[0]["send"] => () => {};
  let live = (_index: number) => (_message: DrivenMessage): boolean => false;
  const isDir = (p: string) => fs.stat(p).then((s) => s.isDirectory(), () => false);
  const drives: DriveOffice[] = [];
  // What each transcript says its folder is, read once, for every office's list of folders.
  const transcriptFolders = new Map<string, string>();
  // Each repo's main checkout, remembered for its worktrees, and the branches on its remote (#84), for every office's list.
  const checkouts = createCheckouts({ file: path.join(isoplanDir, "runner", "checkouts.json"), resolve: (dir) => homeIo.resolve(dir), isDir });
  const remoteBranches = createRemoteBranches({ run: git, timeoutMs: gitMs, refreshMs: async () => (await settings()).branchRefreshMinutes * 60000, log });

  // The runner answering what one office asks, for that office alone; it outlives its office's link.
  const runnerFor = (office: Office, index: number) => {
    const { server } = office;
    const { pairing, approved } = shared.get(server)!;
    // The repos a handoff from the lead's folder may hand over: the office's alone (#91).
    const takes = async () => {
      await approved.refresh();
      return takesFrom(homeIo, approved.repos());
    };
    // The repo the office takes that a folder still there is in, as a session there would report it.
    const home = async (folder: string) => {
      if (!(await isDir(folder))) return null;
      await approved.refresh();
      return (await approvedHome(folder, homeIo, approved.repos()))?.id.toLowerCase() ?? null;
    };
    // A session driven from the floor opens in the folder Claude Code's own transcript of a room
    // session on this machine names, still there and in a repo the office takes; or in one of the
    // folders the runner listed for a new room (#67): never a path the server sent unchecked.
    const foldersLeftOut = new Set<string>();
    drives[index] = {
      server,
      send: (message) => live(index)(message),
      folder: async (roomSessions) => {
        for (const session of roomSessions) {
          const lead = await answerer.lead(session);
          if (!lead || !(await isDir(lead.cwd))) continue;
          await approved.refresh();
          if ((await approvedHome(lead.cwd, homeIo, approved.repos())) !== null) return lead.cwd;
        }
        return null;
      },
      // The repos of the folders Claude Code sessions here ran in, within cloneSearchDays, gone or not, and those of the sessions driven from here.
      repoFolders: async () => {
        const since = Date.now() - (await settings()).cloneSearchDays * 86400000;
        const seen = await sessionFolders(io, path.join(claudeDir, "projects"), since, transcriptFolders, { gone: true });
        for (const r of registry.list()) if (r.kind === "driven" && r.folder) seen.push({ folder: r.folder, at: Date.parse(r.lastActivity) || 0 });
        const repos = await repoFolders(seen, {
          checkout: checkouts.of,
          home,
          // Only a git checkout of a repo with a remote has branches to offer: not a folder above several repos.
          branches: async (checkout, project) => (!project.startsWith("local:") && (await homeIo.resolve(checkout)) ? remoteBranches(checkout) : null),
          scan: scanText,
          log,
          leftOut: foldersLeftOut,
        });
        await checkouts.keep(seen.map((s) => s.folder)).catch((err: Error) => log(`couldn't save which checkout each worktree belongs to: ${err.message}`));
        return repos;
      },
      home,
      branchFolder: async (folder, branch) => branchFolder(git, folder, branch, await gitMs()),
    };
    const runner = createRunner({
      answerer,
      ledger,
      forks,
      settings,
      prompts: () => loadPrompts(path.join(appDir, "prompts")),
      scan: scanText,
      send: (message) => send(index)(message),
      log,
      isDir,
      // Only the rooms the data layer would report: inside the askable window, and not held off, as
      // the runner holds a session off when the server doesn't want its project (or git can't place
      // its folder) (reporting.ts). And only in a repo the office takes (#91), as the data layer
      // would report it.
      isReported: async (session, lead) => {
        const id = forkableId(session);
        if (!id || reporting.heldOff(id)) return false;
        if (Date.now() - lead.lastActive > askableMs(await config().catch(() => first))) return false;
        await approved.refresh();
        return (await approvedHome(lead.cwd, homeIo, approved.repos())) !== null;
      },
      // The handoff (#48): the brief names the untracked files, then the branch is pushed, both from
      // the lead's folder, in the background, with no prompts and under gitTimeoutSeconds.
      prepareBrief: async (lead, handoff) => {
        const ready = await prepare(git, lead.cwd, await gitMs(), (await settings()).repoSearchDepth, undefined, await takes()).catch((err) => Promise.reject(told(err)));
        // The repos the office doesn't take are named only here, never in the brief.
        if (ready.notInOffice.length) log(`handoff ${handoff}: left out, not in the office: ${ready.notInOffice.join(", ")}`);
        // The push hands over the repos the brief's note names (#56).
        preparedFor.set(handoff, ready);
        if (preparedFor.size > MAX_PREPARED) preparedFor.delete(preparedFor.keys().next().value!);
        const { from, files, repos, left } = ready;
        return { files, note: handoffNote({ branch: handoffBranch(handoff), from, files, at: new Date(), repos, left }) };
      },
      push: async (_session, lead, handoff, pushAnyway) => {
        const pushed = await pushHandoff(git, lead.cwd, handoff, await gitMs(), { scan: scanText, depth: (await settings()).repoSearchDepth, prepared: preparedFor.get(handoff), takes: await takes(), names, ...(pushAnyway ? { pushAnyway } : {}) }).catch((err) => Promise.reject(told(err)));
        return "held" in pushed ? pushed : pushed.repos;
      },
      // The session it opens asks the room in this office (handoff/taken-office.ts).
      take: async (message, dropped) => {
        const taken = await takeHandoff(message, {
          dropped,
          run: git,
          io,
          claudeDir,
          machine: os.hostname(),
          platform: process.platform,
          env: process.env,
          settings,
          claude: binary,
          claudeJson,
          scan: scanText,
          log,
          orca: takeOrca,
          driven: { problem: (by) => driver!.takeProblem(by), prepare: (take) => driver!.prepareTake(server, take) },
          track: registry.track,
          names,
        });
        if (taken.session) await recordTakenOffice(claudeDir, taken.session, server).catch(() => {});
        return taken;
      },
      // A driven take's session opens once its `taken` has been handed to the link, which sends it now
      // or after the next hello. One that won't open (dropped, given up, or failed) frees its place.
      onTaken: (message, taken, opens) => {
        if (message.mode === "driven" && message.session) driver!.taken(message.session, opens && !!taken?.session);
      },
      // Focus this session: the handoff's session, which a take into Orca opened, to the front in Orca.
      focus: (handoff) => focusHandoff(handoff, { claudeDir, platform: process.platform, orca: takeOrca, log }),
    });
    return { pairing, runner };
  };
  const answerers = answering.map(runnerFor);
  const drive: Driver = createDriver({
    claudeDir,
    account,
    offices: drives,
    registry,
    binary,
    settings,
    scan: scanText,
    log,
    projectOf: async (folder) => (await homeIo.projectOf(await homeIo.resolve(folder), folder)).id,
    // A start that opens outside the floor (#85), as a take opens its session.
    elsewhere: (start, bin) =>
      startWhere(start, bin, {
        run: git,
        claudeDir,
        claudeJson,
        platform: process.platform,
        env: process.env,
        log,
        machine: os.hostname(),
        settings,
        orca: takeOrca,
        branchFolder: async (folder, branch) => branchFolder(git, folder, branch, await gitMs()),
        orcaFolder: async (orca, folder, branch) => orcaBranchFolder(orca, git, folder, branch, await gitMs()),
        track: registry.track,
      }),
    // An install or sign-in ends with the Claude app's check again, for the next hello.
    setup: (m) => {
      claude.take(m);
      void claude.settled().then(checkDesktop).catch(() => {});
    },
  });
  driver = drive;

  // The supervisor holds stdin open; it closes when the supervisor has gone.
  const gone = new Promise<void>((resolve) => process.stdin.on("end", resolve).on("error", resolve).resume());
  const links = answerOffices<Office, ReplyMessage | RefusalMessage | TakenMessage, DrivenMessage>({
    offices: answering,
    name: (office) => office.server,
    open: (office, said) => {
      const { pairing, runner } = answerers[answering.indexOf(office)]!;
      log(`the runner's worker ${process.pid} is answering for this machine through ${office.server}`);
      return createLink({
        url: office.server,
        emit: emitFor(office.server),
        pairing,
        onMessage: (message) => runner.take(message),
        onDrive: (message) => drive.take(office.server, message),
        // At every hello and every drop, this office's drive-policy no longer holds; nothing driven goes on the new connection until its first one, which `holding` follows.
        onOpen: () => drive.linked(office.server),
        onClose: () => drive.unlinked(office.server),
        onNotWanted: said.notWanted,
        // A revoked or lapsed pairing closes this link: the sessions' links pair the machine again.
        onPairingEnded: said.unpaired,
        hello: {
          type: "runner",
          v: PROTOCOL_VERSION,
          account,
          machine: { name: os.hostname() },
          ...(hasOrca ? { orca: true } : {}),
          ...(hasDesktop ? { desktop: true } : {}),
          drive: true,
          claude: claude.state(),
          starts: startPlaces(process.platform, hasOrca, hasDesktop),
        },
      });
    },
    paired: async (office) => !!pairingEntry(await readPairing(pairingPath(claudeDir)), office.server, account.id)?.credential,
    // Nor while it reports sessions: their links, and the pairing they share, would end with it.
    idle: () => answerers.every((a) => a.runner.idle()) && reporting.reporting().length === 0 && !pipe?.all().length,
    lit: async () => anyRoomSince(io, path.join(claudeDir, "projects"), Date.now() - askableMs(await config().catch(() => first))),
    keep: async () => drive.held() > 0 || (await settings()).startAtLogin,
    gone,
    log,
    checkMs: CHECK_MS,
    holdOffMs: HOLD_OFF_MS,
  });
  send = links.sender;
  live = links.live;
  const ended = await links.ended;
  // Each session's link closes, and its log says so, before the worker exits; one stuck in a pass is left after STOP_WAIT_MS (reporting.ts).
  await reporting.stop();
  await pipe?.close();
  return ended === "not-wanted" ? NOT_WANTED_CODE : ended === "unpaired" ? UNPAIRED_CODE : 0;
}

process.exitCode = await (process.argv.includes("--worker") ? worker() : supervisor());
await logging;
// The link's timers would keep the process up; it is done.
process.exit();
