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
// Claude account or, after a change of login, the one it was paired under (src/data-layer/pairing.ts; a link to approve goes to the log, and to the status
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
// and list. A hooks module gets its session's lines down the pipe, and the ask_earlier_session script asks the
// room through it (src/ask/machine.ts), only for a session whose hooks module is connected. Its
// address and token are in <claude dir>/isoplan/runner/pipe.json, which the worker writes as it starts.
// Each office's link, and the links waiting to pair the machine, go to <claude dir>/isoplan/runner/status.json
// as they change (status.ts), for the desktop app's menu (packages/app), with the email each office's
// pairing belongs to and, every `trayRefreshSeconds`, the sessions it reports or runs. The menu's Close
// of a headless one comes down the pipe: the worker ends its process tree, and forgets a driven one so
// it isn't opened again. A driven session or a take's first turn stops being reported, so its links to
// the offices close; a fork shares its lead's session, whose report goes on.
//
// The worker also drives its person's sessions from the floor (session.ts; its hello says `drive`),
// for every office through one driver, and records every process it starts for that, and every
// fork and take into the Claude app's first turn, in <claude dir>/isoplan/runner/processes.json
// (registry.ts). As it starts, under the runner's lock, it ends what an earlier run left there that
// is verifiably Isoplan's, keeping driven sessions to open again. It doesn't stop for lights-off
// while a driven session's process runs, or while `startAtLogin` is on: then a person who works only
// on the floor keeps a runner up.
//
// It keeps this computer's instance of each expert its sessions ask (experts.ts, expert-instance.ts,
// isoplan-app#340), and says so in its hello (`expertInstances`): an owner's expert files in
// <claude dir>/isoplan/experts, published to each office as expert records, and instance files in
// <claude dir>/isoplan/expert-instances, set up from those records with one click on the floor or
// offered (expert-instance-set-up-offer.ts), each office over its own link (expert-record-link.ts).
// The sessions' ask_expert questions are answered here, from this computer's own instance
// (expert-questions-asked-here.ts): nothing of a question leaves the computer but a record with no
// words. Their trunks are never reported; a question or a grounding running keeps the runner up.
// What an instance's forks learn goes to its expert records, checked for secrets and personal data
// first, and what other instances learned comes back from them (what-was-learned-link.ts,
// isoplan-app#366); its hello says `sharesWhatExpertInstancesLearn`.
//
// It suggests creating experts where a session it reports would have been helped by one (expert-creation-suggestions.ts; its hello
// says `canCreateExpertsFromSuggestions`): from each session's areas, drafted by a local model (expert-creation-suggestion-model-calls.ts), and it creates
// the expert an office's `create-expert-from-suggestion` asks for, writing its file in <claude dir>/isoplan/experts.

import { spawn } from "node:child_process";
import fsSync from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PROTOCOL_VERSION, type DrivenMessage, type RefusalMessage, type ReplyMessage, type TakenMessage } from "@isoplan/protocol";
import { loadConfig, loadSettings, officesOf, type Office } from "../data-layer/config.js";
import { approvedHome, machineHomeIo, takesFrom } from "../data-layer/home.js";
import { askingRemoteNames } from "../data-layer/remote-names.js";
import { accountOf, claudePaths } from "../data-layer/identity.js";
import { nodeIo } from "../data-layer/io.js";
import { createLink, type RunnerExpertCreationSuggestionMessage, type RunnerExpertRecordMessage } from "../data-layer/link.js";
import { pairingEntry, pairingPath, readPairing } from "../data-layer/pairing.js";
import { HOLD_OFF_MS, alive, holdOff, refreshLock, releaseLock, takeLock } from "../wake/lock.js";
import { openLedger } from "./caps.js";
import { createClaudeAnswerer, forkableId, forkEnv, killPid } from "./claude.js";
import { endStrays } from "./strays.js";
import { claudeBinary } from "./claude-binary.js";
import { createClaudeSetup } from "./claude-setup.js";
import { anyRoomSince, askableMs, NOT_WANTED_CODE, onEscapes, supervise, UNPAIRED_CODE } from "./lifecycle.js";
import { loadPrompts } from "./prompts.js";
import { createRunGit, gitFailed, handoffBranch, handoffNote, HandoffGitError, prepare, pushHandoff, type Prepared } from "../handoff/git.js";
import { focusHandoff } from "../handoff/focus.js";
import { findOrca, orcaRunner } from "../handoff/orca.js";
import { CLOSED_FROM_MENU, desktopProblem, removeOldNoHooks, sessionFolders, takeHandoff, type TakeSettings } from "../handoff/take.js";
import { recordTakenOffice } from "../handoff/taken-office.js";
import { answerOffices } from "./offices.js";
import { createForkSlots, createRunner, PushFailed, type RunnerSettings } from "./runner.js";
import { errorText, loadPatterns, scan } from "./scan.js";
import { createRegistry, registryPath } from "./registry.js";
import { branchFolder, createCheckouts, createRemoteBranches, orcaBranchFolder } from "./checkouts.js";
import { createIsoplanClones } from "./isoplan-clone.js";
import { readClonesFolders, repoFolders, useClonesFolder } from "./repo-folders.js";
import { createNamer, type NamingSettings } from "./naming.js";
import { createExpertCreationSuggestionModelCalls } from "./expert-creation-suggestion-model-calls.js";
import { createExpertCreationSuggestions, type ExpertCreationSuggestions, type ExpertCreationSuggestionsRunnerSettings } from "./expert-creation-suggestions.js";
import { createDriver, type DriveOffice, type Driver, type DriveSettings } from "./session.js";
import { watchSessions } from "./reporting.js";
import { managedDir, pluginDirsOf, pluginsDir } from "../install/state.js";
import { recordedState } from "../install/install.js";
import { reportSession, sessionLog } from "../data-layer/report-session.js";
import { askFromMachine } from "../ask/machine.js";
import { expertText } from "../ask/expert-text.js";
import { createExpertInstances } from "./expert-instance.js";
import { createExpertInstanceSetUpOffers } from "./expert-instance-set-up-offer.js";
import { createExpertQuestionsAskedHere, type ExpertQuestionsAskedHere, type ExpertQuestionsAskedHereSettings } from "./expert-questions-asked-here.js";
import { createExpertRecordLink, type ExpertRecordLink } from "./expert-record-link.js";
import { createExpertRecordsPerOffice, expertRecordsPerOfficePath } from "./expert-records-per-office.js";
import { createExpertRightsOnThisComputer, type ExpertRightsOnThisComputer } from "./expert-rights-on-this-computer.js";
import { createExperts, expertIgnored, type Experts } from "./experts.js";
import { createCheckBeforeItLeaves } from "./what-was-learned-before-it-leaves.js";
import { createWhatWasLearnedLink, type WhatWasLearnedLink } from "./what-was-learned-link.js";
import { createEmployeeLink, type EmployeeLink } from "./employee-link.js";
import { createEmployeeTies } from "./employee-ties.js";
import { createEmployeeTools } from "./employee-tools.js";
import type { EmployeesSettings } from "./employee.js";
import { createEmployees, employeeIgnored, type Employees } from "./employees.js";
import { createJobFromSessionsModelCall } from "./job-from-sessions-model-call.js";
import { createJobsStartedByHand, type JobsStartedByHand } from "./jobs-started-by-hand.js";
import { createMakeAnEmployee } from "./make-an-employee.js";
import { createOffersToMakeAnEmployee, type OffersToMakeAnEmployee } from "./offers-to-make-an-employee.js";
import { bindWhatEmployeesLearned, whatWasLearnedOfExpertsAndEmployees } from "./what-was-learned-of-employees.js";
import { readJson } from "./expert-state.js";
import { createPipeServer, type Hooked } from "../pipe/server.js";
import { createPairLinks } from "./pair-links.js";
import { createSharedOffices } from "./shared-offices.js";
import { startPlaces, startWhere, tidyStarts } from "./start-where.js";
import { runnerEnvPath } from "./environment.js";
import { applyClaudeDir, LOCK_REFRESH_MS, RUNNER_FRESH_MS, runnerCode, runnerLockPath } from "./start.js";
import { closeProcess, createStatus, sessionsSeen, statusPath } from "./status.js";

// The runner's log starts over once it is this big.
const LOG_CAP_BYTES = 256 * 1024;
// How often the worker checks whether any room is still lit.
const CHECK_MS = 60000;
// How often the runner checks again whether the Claude app can take handoffs here.
const DESKTOP_CHECK_MS = 3600000;
// Prepares kept for their pushes; past this the oldest goes.
const MAX_PREPARED = 20;
// Why a driven session's reporting ended when it was ended and removed.
const REMOVED = "it was ended and removed";

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
    log(`runner ${process.pid} stopped: ${stopped === "done" ? "no session on this machine is lit" : "the office server says this machine's pairing has ended"}`);
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
  // The patterns an error's text is checked against before the logs say it.
  const errorPatterns = () => loadPatterns(path.join(appDir, "secret-patterns.json"), path.join(isoplanDir, "secret-patterns.json"), () => {});
  onEscapes({
    on: (event, handler) => void process.on(event, handler),
    said: async (err) => errorText(err, await errorPatterns()),
    log,
    exit: () => void logging.then(() => process.exit(1)),
  });
  const io = nodeIo();
  const config = () => loadConfig(io, path.join(appDir, "config.json"), path.join(isoplanDir, "config.json"));
  const settings = () => loadSettings<RunnerSettings & TakeSettings & DriveSettings & NamingSettings & ExpertCreationSuggestionsRunnerSettings & ExpertQuestionsAskedHereSettings & { claudeModel: string; repoSearchDepth: number; startAtLogin: boolean; trayRefreshSeconds: number; expertJudgeModel: string; clonesFolder: string; employees: EmployeesSettings }>(io, path.join(appDir, "runner.json"), path.join(isoplanDir, "runner.json"));
  const first = await config();
  // Plain ws:// to another machine would send the machine's credential unencrypted.
  const offices = officesOf(first);
  for (const { server } of offices.filter((o) => o.plainRefused)) log(`the runner doesn't answer through ${server}: it is plain ws:// to another machine; use wss://, or set "allowPlainWs": true in config.json`);
  if (offices.every((o) => o.plainRefused)) return 0;
  const started = await settings(); // a broken runner.json of the plugin's is a crash to see at once
  // Where new clones and experts' copies go, read as the runner starts, and every folder it has
  // named, where those made earlier are still used (repo-folders.ts useClonesFolder).
  const clones = await useClonesFolder(claudeDir, started.clonesFolder, log).catch(async (err: Error) => {
    log(`couldn't record clonesFolder in runner.json, so new clones and experts' copies go under ${isoplanDir}: ${err.message}`);
    return { folder: "", folders: await readClonesFolders(claudeDir) };
  });
  // Left by earlier versions, or by sessions started outside the floor a week ago or more.
  void removeOldNoHooks(os.tmpdir());
  void tidyStarts(claudeDir);
  const answering = offices.filter((o) => !o.plainRefused);
  const account = await accountOf({ readText: (p) => fs.readFile(p, "utf8").catch(() => null), run: io.run }, claudeJson, os.homedir());
  // The machine's links to pair it, to the sessions waiting for them.
  const pairLinks = createPairLinks();
  // Each office's link and the links to pair the machine, for the desktop app's menu (status.ts).
  const status = createStatus({ file: statusPath(claudeDir), offices: answering.map(({ server, label }) => ({ server, label })) });
  const emitFor = ({ server, label }: Office): Parameters<typeof createLink>[0]["emit"] => (line) => {
    if (line.type === "log") log(line.text);
    else if (line.type === "error") log(`the office server at ${server} says: ${line.message} (${line.code})`);
    else if (line.type === "pair") {
      log(`to answer for this machine's sessions through ${line.server}, pair it: click ${line.url} on this computer and approve it in the office (it works until ${line.expires})`);
      // The machine's one pairing: its link is in the status line of each session waiting for it.
      pairLinks.pair({ ...line, ...(label && { label }) });
      status.pair({ ...line, ...(label && { label }) });
    }
  };
  // Each office's pairing and list of repos, one of each for the machine (shared-offices.ts).
  const shared = createSharedOffices({ claudeDir, account, emitFor, onEmail: (server, email) => status.email(server, email), log });
  for (const office of answering) shared(office, first);
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
  let closeFor = async (_close: string, _remove: boolean) => false;
  // The expert creation suggestions (expert-creation-suggestions.ts), made once the offices' links and the experts are; a session's
  // report and its hooks module reach them from the start, so they are looked up when used.
  let expertCreationSuggestionsOnceStarted: ExpertCreationSuggestions | null = null;
  // The sessions' questions to experts, answered from this computer's instances (expert-questions-asked-here.ts),
  // what each session may ask (expert-rights-on-this-computer.ts), and the set-up offers' lines to
  // sessions that connect again: made once the experts are; looked up when used.
  let expertQuestionsOnceStarted: ExpertQuestionsAskedHere | null = null;
  let expertRightsOnceStarted: ExpertRightsOnThisComputer | null = null;
  let rehookOffers = (_session: string) => {};
  // Rights a session's office sent before those were made, given to them once they are.
  const rightsBeforeStart: Parameters<ExpertRightsOnThisComputer["tap"]>[] = [];
  const pipe = await createPipeServer({
    claudeDir,
    log,
    onChange: (session) => (rehook(session), expertCreationSuggestionsOnceStarted?.rehooked(session), expertQuestionsOnceStarted?.rehooked(session), rehookOffers(session), offersToMakeAnEmployeeOnceStarted?.rehooked(session)),
    // An ack of an expert question's end is the asking module's; every other ask goes to the office.
    ask: (request) => (request.ack && expertQuestionsOnceStarted?.holds(request.ack) ? expertQuestionsOnceStarted.ack(request.session, request.ack) : askFromMachine({ ...request, appDir, scan: scanText })),
    askExpert: async (request) => expertQuestionsOnceStarted?.ask(request) ?? { text: expertText("EXPERT_RUNNER_UNREACHABLE", { expert: request.expert, id: request.key, words: "Isoplan's runner is still starting; try again in a minute" }), failed: true, code: "EXPERT_RUNNER_UNREACHABLE" },
    close: (close, remove) => closeFor(close, remove),
  }).catch((err: Error) => (log(`the runner couldn't open its pipe for the sessions' hooks modules: ${err.message}`), null));
  // Each session's title as its latest report pass worked out for the offices, by bare id, for the desktop app's
  // menu (status.ts sessionsSeen); in memory only.
  const titles = new Map<string, string>();
  // The experts this machine hosts (experts.ts), made once git is; declared here because the first
  // look below runs before that, and must not read a const declared after it. Their trunks are
  // never reported: each one's folder is under expertsDir, or experts/ of a folder clonesFolder has
  // named, which keeps them out from the first look.
  const expertsDir = path.join(isoplanDir, "experts");
  let experts: Experts | null = null;
  // This computer's employees (employees.ts, isoplan-app#341), made once the experts are: their trunks and runs are never reported either.
  const employeesDir = path.join(isoplanDir, "employees");
  let employees: Employees | null = null;
  let jobsStartedByHandOnceStarted: JobsStartedByHand | null = null;
  let offersToMakeAnEmployeeOnceStarted: OffersToMakeAnEmployee | null = null;
  const reporting = watchSessions<Hooked>({
    claudeDir,
    io,
    config,
    isOff,
    log,
    patterns: errorPatterns,
    ignored: (id, cwd) => expertIgnored(expertsDir, () => experts, clones.folders)(id, cwd) || employeeIgnored(employeesDir, () => employees, clones.folder)(id, cwd),
    hooked: (id) => pipe?.hooked(id) ?? null,
    removedFile: path.join(isoplanDir, "runner", "removed.json"),
    held: (id, hooks) => {
      sessionLog(claudeDir, id).say("an earlier version's data layer reports this session, so the runner doesn't: its hooks module is told so, and tries again later");
      hooks.send({ type: "superseded", reason: "earlier" });
    },
    report: async ({ sessionId, cwd, notWanted, closed, hooks }) => {
      const said = sessionLog(claudeDir, sessionId);
      said.say(hooks ? `the runner reports this session for its hooks module, in ${cwd}` : `the runner reports this session, in ${cwd}`);
      const titled = (title: string) => void titles.set(sessionId, title);
      // Each pass's areas, and the local model's word on which messages corrected the agent (expert-creation-suggestions.ts).
      const expertCreationSuggestionSignals = {
        areas: (s: Parameters<ExpertCreationSuggestions["seen"]>[0]) => expertCreationSuggestionsOnceStarted?.seen(s),
        corrected: (key: string, text: string, reply: string | null) => expertCreationSuggestionsOnceStarted?.corrected(sessionId, key, text, reply) ?? null,
        // How the session started, for the offers to make an employee (jobs-started-by-hand.ts).
        startedByHand: (s: Parameters<JobsStartedByHand["seen"]>[0]) => void jobsStartedByHandOnceStarted?.seen(s).catch((err: Error) => log(`couldn't count how a session started: ${err.message}`)),
      };
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
            endsTurns: hooks.endsTurns,
            asksExperts: hooks.experts,
            emit: (line) => {
              said.emit(line);
              // What the session may ask is this computer's to rewrite first (expert-rights-on-this-computer.ts).
              if (line.type === "expert-rights") {
                if (expertRightsOnceStarted) expertRightsOnceStarted.tap(sessionId, cwd, line);
                else rightsBeforeStart.push([sessionId, cwd, line]);
                return;
              }
              hooks.send(line);
              pairLinks.sent(sessionId, line, hooks.send);
            },
            closed: Promise.race([closed, hooks.closed.then(() => "its hooks module's link to the runner closed")]),
            shared,
            titled,
            ...expertCreationSuggestionSignals,
          }).finally(() => pairLinks.ended(sessionId, hooks.send));
        return await reportSession({ sessionId, cwd, by: "runner", appDir, emit: said.emit, closed, notWanted, isOff: () => isOff(cwd), shared, titled, ...expertCreationSuggestionSignals });
      } catch (err) {
        said.say(`stopping: something went wrong: ${errorText(err, await errorPatterns().catch(() => null))}`);
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
  // The bare ids of the sessions it started with `claude --bg`, which the registry doesn't hold (no
  // process of its own runs them), kept in memory only (status.ts sessionsSeen); and of the takes'
  // first turns closed from the desktop app's menu, each taken out once its failure has read it.
  const background = new Set<string>();
  const closedFromMenu = new Set<string>();
  const binary = () => claudeBinary(claudeDir, process.env, process.platform, os.homedir());
  const answerer = createClaudeAnswerer({
    claudeDir,
    binary,
    model: async () => (await settings()).claudeModel,
    config,
    track: registry.track,
  });
  // A session started from the floor is named from its first instruction (naming.ts).
  const namer = createNamer({ binary, settings, system: () => fs.readFile(path.join(appDir, "prompts", "naming.md"), "utf8"), log });
  // An expert creation suggestion's draft and the correction check, local model calls as naming is (expert-creation-suggestion-model-calls.ts).
  const expertCreationSuggestionModelCalls = createExpertCreationSuggestionModelCalls({ binary, prompt: (name) => fs.readFile(path.join(appDir, "prompts", name), "utf8"), log });
  // The job an offer to make an employee writes from its sessions, a local model call as those are (job-from-sessions-model-call.ts).
  const jobFromSessions = createJobFromSessionsModelCall({ binary, prompt: () => fs.readFile(path.join(appDir, "prompts", "employee-job-from-sessions.md"), "utf8"), log });
  let driver: Driver | null = null;
  // However the worker ends, its forks, naming calls, expert creation suggestions' model calls and driven sessions end with it.
  process.on("exit", () => {
    answerer.close();
    namer.close();
    expertCreationSuggestionModelCalls.close();
    expertCreationSuggestionsOnceStarted?.close();
    driver?.close();
    experts?.close();
    employees?.close();
    jobFromSessions.close();
  });
  const git = createRunGit();
  const gitMs = async () => (await settings()).gitTimeoutSeconds * 1000;
  // Ready once the expert files and their states are read; checkouts and groundings go on in the background.
  const hosted = createExperts({
    expertsDir,
    instancesDir: path.join(isoplanDir, "expert-instances"),
    clonesFolder: clones.folder,
    clonesFolders: clones.folders,
    logsDir: path.join(isoplanDir, "logs"),
    projectsDir: path.join(claudeDir, "projects"),
    appDir,
    binary,
    settings,
    scan: scanText,
    git,
    gitTimeoutMs: gitMs,
    track: registry.track,
    log,
  });
  experts = hosted;
  await hosted.start();
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
  // Where a folder sits in git is looked up again once older than config.json's gitCacheSeconds, as a session's data layer does.
  const gitCacheMs = first.gitCacheSeconds * 1000;
  const homeIo = machineHomeIo(first.workspaceRepos, names, os.hostname(), false, gitCacheMs);
  // For experts alone, a git that can't read a repo's remote rejects rather than making it a local
  // project: what each office was last told of them stands (expert-record-link.ts).
  const expertHomeIo = machineHomeIo(first.workspaceRepos, names, os.hostname(), true, gitCacheMs);
  const ledger = await openLedger(path.join(isoplanDir, "runner", "ledger.json"));
  // What each brief's prepare found, by handoff, for its push and any push anyway after it.
  const preparedFor = new Map<string, Prepared>();
  // One fork cap for the machine, whichever office asks.
  const forks = createForkSlots();
  let send = (_index: number): Parameters<typeof createRunner>[0]["send"] => () => {};
  let live = (_index: number) => (_message: DrivenMessage | RunnerExpertRecordMessage | RunnerExpertCreationSuggestionMessage): boolean => false;
  const isDir = (p: string) => fs.stat(p).then((s) => s.isDirectory(), () => false);
  const drives: DriveOffice[] = [];
  // Each office's list of this computer's repos (repo-folders.ts), with branches or without.
  const repoLists: ((withBranches: boolean) => Promise<Awaited<ReturnType<typeof repoFolders>>>)[] = [];
  // What each transcript says its folder is, read once, for every office's list of folders.
  const transcriptFolders = new Map<string, string>();
  // Each repo's main checkout, remembered for its worktrees, and the branches on its remote (#84), for every office's list.
  const checkouts = createCheckouts({ file: path.join(isoplanDir, "runner", "checkouts.json"), resolve: (dir) => homeIo.resolve(dir), isDir });
  const remoteBranches = createRemoteBranches({ run: git, timeoutMs: gitMs, refreshMs: async () => (await settings()).branchRefreshMinutes * 60000, log });

  // The runner answering what one office asks, for that office alone; it outlives its office's link.
  const runnerFor = (office: Office, index: number) => {
    const { server } = office;
    const { pairing, approved } = shared(office, first);
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
    const expertCreationSuggestionFoldersLeftOut = new Set<string>();
    // The repos of the folders Claude Code sessions here ran in, within cloneSearchDays, gone or not,
    // and those of the sessions driven from here; with their remotes' branches, or without, for an
    // expert creation suggestion, which needs only the checkout.
    const listRepos = async (withBranches: boolean) => {
      const since = Date.now() - (await settings()).cloneSearchDays * 86400000;
      const seen = await sessionFolders(io, path.join(claudeDir, "projects"), since, transcriptFolders, { gone: true });
      for (const r of registry.list()) if (r.kind === "driven" && r.folder) seen.push({ folder: r.folder, at: Date.parse(r.lastActivity) || 0 });
      // Never one of Isoplan's own folders, such as an expert trunk's: not one a person worked in here.
      const repos = await repoFolders(seen, {
        claudeDir,
        clonesFolders: clones.folders,
        checkout: checkouts.of,
        home,
        // Only a git checkout of a repo with a remote has branches to offer: not a folder above several repos.
        branches: async (checkout, project) => (withBranches && !project.startsWith("local:") && (await homeIo.resolve(checkout)) ? remoteBranches(checkout) : null),
        scan: scanText,
        log,
        leftOut: withBranches ? foldersLeftOut : expertCreationSuggestionFoldersLeftOut,
      });
      await checkouts.keep(seen.map((s) => s.folder)).catch((err: Error) => log(`couldn't save which checkout each worktree belongs to: ${err.message}`));
      return repos;
    };
    repoLists[index] = listRepos;
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
      repoFolders: () => listRepos(true),
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
      // would report it. Never an expert's trunk, which isn't reported at all.
      isReported: async (session, lead) => {
        const id = forkableId(session);
        if (!id || reporting.heldOff(id) || hosted.isExpertSession(id) || employees?.isEmployeeSession(id)) return false;
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
          background: (id) => background.add(id),
          closed: (id) => closedFromMenu.delete(id),
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
  // One for hidden starts, experts created from suggestions and instances set up from records alike, so one project is never cloned twice at once.
  const isoplanClone = createIsoplanClones({ git, claudeDir, clonesFolder: clones.folder, clonesFolders: clones.folders, timeoutMs: gitMs, log });
  const indexOf = (server: string) => answering.findIndex((o) => o.server === server);
  // This computer's checkout of a project, as New session finds one for the office (repo-folders.ts).
  const checkoutFor = async (index: number, project: { id: string }) => (repoLists[index] ? (await repoLists[index](false)).find((r) => r.project === project.id.toLowerCase())?.folders[0] ?? null : null);
  // The project an office takes that a folder is in, with that office's approved list.
  const projectFor = async (server: string, folder: string) => {
    const index = indexOf(server);
    if (index < 0) return null;
    const { approved } = shared(answering[index]!, first);
    await approved.refresh();
    return approvedHome(folder, expertHomeIo, approved.repos());
  };
  // This computer's instances of experts (expert-instance.ts), each office's record link, what each office last said, and the set-up offers.
  const expertRecordsPerOffice = createExpertRecordsPerOffice({ file: expertRecordsPerOfficePath(isoplanDir), keptHours: async () => (await settings()).expertInstances.questionsKeptHours, log });
  await expertRecordsPerOffice.load();
  const instances = createExpertInstances({
    experts: hosted,
    isoplanDir,
    scan: scanText,
    log,
    checkoutOf: (server, project) => checkoutFor(indexOf(server), project),
    clone: (url, project) => isoplanClone({ url }, project),
  });
  await instances.start();
  const recordLinks = new Map<string, ExpertRecordLink>();
  // What instances learn and employees' jobs, checked for secrets and personal data before they leave, the patterns read again each time.
  const checkBeforeItLeaves = createCheckBeforeItLeaves({
    secretPatterns: () => loadPatterns(path.join(appDir, "secret-patterns.json"), path.join(isoplanDir, "secret-patterns.json"), log),
    personalDataPatterns: () => loadPatterns(path.join(appDir, "personal-data-patterns.json"), path.join(isoplanDir, "personal-data-patterns.json"), log),
  });

  // This computer's employees (isoplan-app#341): Isoplan's two tools served here on 127.0.0.1, the
  // job files and their runs (employees.ts), and each one's tie to its record on one office.
  const employeeTools = createEmployeeTools({ log });
  await employeeTools.start();
  const servers = answering.map((office) => office.server);
  // Set below, once the asking module is made: a run's question to one of its job's experts.
  let askForARun: ((r: Parameters<ExpertQuestionsAskedHere["askForAnEmployeeRun"]>[0]) => ReturnType<ExpertQuestionsAskedHere["askForAnEmployeeRun"]>) | null = null;
  const expertHasKey = (key: string) => hosted.running(key) !== null || [hosted.expertFilePath(key), hosted.instanceFilePath(key)].some((p) => fsSync.existsSync(p));
  const employeesOnThisComputer = createEmployees({
    employeesDir,
    clonesFolder: clones.folder,
    logsDir: path.join(isoplanDir, "logs"),
    projectsDir: path.join(claudeDir, "projects"),
    appDir,
    binary,
    settings,
    scan: scanText,
    git,
    gitTimeoutMs: gitMs,
    tools: employeeTools,
    account,
    expertHasKey,
    // The subjects of the job's experts, as this computer's instances of them have them.
    expertsOf: (key) => (employeesOnThisComputer.get(key)?.file?.job.experts ?? []).map((k) => ({ key: k, subject: hosted.running(k)?.file.subject ?? "not set up on this computer yet" })),
    // This computer's experts whose record is of the employee's project, for the warning that one's area covers its file of who was contacted.
    expertAreasOf: (key) => {
      const project = employeesOnThisComputer.get(key)?.project;
      if (!project) return [];
      return hosted.all().flatMap((x) => (servers.some((s) => instances.heldOn(s, x.key)?.record?.definition.project.id === project) ? [{ expert: x.key, areas: x.file.areas }] : []));
    },
    ask: async (key, run, expert, question, deadline) => {
      const server = employeeTies.serverOf(key);
      if (!server || !askForARun) return { text: `Expert ${expert}: Isoplan's runner can't ask it now. Carry on without it.` };
      const waitMs = Math.min((await settings()).employees.expertAnswerWaitMinutes * 60000, deadline - Date.now() - 120000);
      return askForARun({ employee: key, server, run, expert, question, waitMs });
    },
    teach: async (expert, corrections) => (await hosted.running(expert)?.expert.learnFromCorrections(corrections)) ?? "waiting",
    track: registry.track,
    log,
  });
  employees = employeesOnThisComputer;
  await employeesOnThisComputer.start();
  const employeeTies = createEmployeeTies({
    employees: employeesOnThisComputer,
    servers,
    account,
    saysEmployees: (server) => recordLinks.get(server)?.directory()?.employees === true,
    projectOn: (server, folder) => projectFor(server, folder).catch(() => undefined),
    check: checkBeforeItLeaves,
    settings,
    isoplanDir,
    log,
  });
  await employeeTies.start();
  const offers = createExpertInstanceSetUpOffers({
    file: path.join(isoplanDir, "runner", "expert-instance-set-up-offers.json"),
    setUpWithoutAsking: async () => (await settings()).expertInstances.setUpWithoutAsking,
    setUp: (server, entry) => void instances.setUp(server, entry).catch((err: Error) => log(`expert ${entry.key}: couldn't set it up: ${err.message}`)),
    send: (server, m) => recordLinks.get(server)?.sendNow(m) ?? false,
    hooked: (session) => pipe?.hooked(session) ?? null,
    hasInstance: (server, key, expertRecordId) => {
      const found = instances.lookUp(server, key, null);
      return !!found && found.kind !== "set-up-failed" && found.expertRecordId === expertRecordId;
    },
    log,
  });
  await offers.start();
  instances.onChange(() => offers.instancesChanged());
  rehookOffers = (session) => offers.rehooked(session);
  answering.forEach((office, index) => {
    const link = createExpertRecordLink({
      server: office.server,
      account,
      experts: hosted,
      instances,
      store: expertRecordsPerOffice,
      offerEnded: (server, m) => offers.ended(server, m),
      approved: shared(office, first).approved,
      home: (folder, repos) => approvedHome(folder, expertHomeIo, repos),
      scan: scanText,
      log,
      send: (m) => live(index)(m),
      checkMs: first.approvedRefreshMinutes * 60000,
      employeeTies,
      onEmployeesChange: (listener) => employeesOnThisComputer.onChange(() => listener()),
    });
    link.onDirectory(() => offers.afterDirectory(office.server));
    recordLinks.set(office.server, link);
  });
  // What instances learn, and what employees learn from their owners' corrections, over each office's link.
  const learnedLinks = new Map<string, WhatWasLearnedLink>();
  answering.forEach((office, index) => {
    const recordLink = recordLinks.get(office.server)!;
    const link = createWhatWasLearnedLink({
      server: office.server,
      recordLink,
      ...whatWasLearnedOfExpertsAndEmployees({ instances, experts: hosted, employees: employeesOnThisComputer, employeeTies }),
      check: checkBeforeItLeaves,
      send: (m) => live(index)(m),
      log,
      checkMs: first.approvedRefreshMinutes * 60000,
    });
    recordLink.onWhatWasLearned((m) => link.take(m));
    learnedLinks.set(office.server, link);
  });
  hosted.bindWhatWasLearned((key) => ({
    tied: () => instances.tiedRecordsOf(key),
    held: (server) => instances.heldOn(server, key)?.record?.expertRecordId,
    servers: answering.map((office) => office.server),
    catchUp: (server, expertRecordId) => learnedLinks.get(server)?.catchUp(expertRecordId) ?? "cannot",
    waiting: () => learnedLinks.forEach((l) => l.sendWaiting()),
  }));
  instances.onChange(() => hosted.tiesMayHaveChanged());
  bindWhatEmployeesLearned(employeesOnThisComputer, employeeTies, servers, learnedLinks);
  const expertRights = createExpertRightsOnThisComputer({
    instances,
    store: expertRecordsPerOffice,
    person: () => account.name,
    projectOf: projectFor,
    send: (session, line) => {
      const hooks = pipe?.hooked(session);
      if (!hooks) return;
      hooks.send(line);
      pairLinks.sent(session, line, hooks.send);
    },
    log,
  });
  expertRightsOnceStarted = expertRights;
  for (const tap of rightsBeforeStart.splice(0)) expertRights.tap(...tap);
  const expertQuestions = createExpertQuestionsAskedHere({
    file: path.join(isoplanDir, "runner", "expert-questions-asked-here.json"),
    claudeDir,
    config,
    settings,
    links: recordLinks,
    instances,
    offers,
    rights: (session, server) => expertRights.rights(session, server),
    hooked: (session) => pipe?.hooked(session) ?? null,
    log,
  });
  await expertQuestions.start();
  expertQuestionsOnceStarted = expertQuestions;
  askForARun = (r) => expertQuestions.askForAnEmployeeRun(r);

  // Each office's employee link (employee-link.ts): runs, drafts and decisions, offers to make an employee, and making one from the floor.
  const employeeLinks = new Map<string, EmployeeLink>();
  answering.forEach((office, index) => {
    employeeLinks.set(office.server, createEmployeeLink({ server: office.server, recordLink: recordLinks.get(office.server)!, employees: employeesOnThisComputer, ties: employeeTies, send: (m) => live(index)(m), log, checkMs: first.approvedRefreshMinutes * 60000 }));
  });
  // The office an employee of a project would be published to: the first in config.json's order that takes employees and the project.
  const officeFor = async (project: string, cwd: string) => {
    for (const server of servers) {
      if (recordLinks.get(server)?.directory()?.employees !== true) continue;
      const home = await projectFor(server, cwd).catch(() => null);
      if (home && home.id.toLowerCase() === project && !project.startsWith("local:")) return { server, project: home };
    }
    return null;
  };
  const offersToMakeAnEmployee = createOffersToMakeAnEmployee({
    file: path.join(isoplanDir, "runner", "offers-to-make-an-employee.json"),
    projectsDir: path.join(claudeDir, "projects"),
    claudeDir,
    account,
    settings: async () => (await settings()).employees,
    officeFor,
    send: (server, m) => employeeLinks.get(server)?.sendNow(m) ?? false,
    write: async (input) => {
      const s = (await settings()).employees;
      return jobFromSessions.write(input, { model: s.jobFromSessionsModel, timeoutSeconds: s.jobFromSessionsTimeoutSeconds });
    },
    check: checkBeforeItLeaves,
    // The experts the sessions asked, from the asking module's own file.
    expertsAsked: async (sessions) => {
      const read = (await readJson(path.join(isoplanDir, "runner", "expert-questions-asked-here.json"))) as { questions?: { session?: string; key?: string }[] } | null;
      return [...new Set((read?.questions ?? []).filter((q) => q.session && sessions.includes(q.session) && q.key).map((q) => q.key!))];
    },
    madeHere: () => false,
    hooked: (session) => pipe?.hooked(session) ?? null,
    log,
  });
  await offersToMakeAnEmployee.load();
  offersToMakeAnEmployeeOnceStarted = offersToMakeAnEmployee;
  const jobsStartedByHand = createJobsStartedByHand({
    file: path.join(isoplanDir, "runner", "jobs-started-by-hand.json"),
    claudeDir,
    settings: async () => (await settings()).employees,
    helperPrompts: async () => (await config()).helperPrompts,
    onRhythm: (startedWith, rhythm, starts) => void offersToMakeAnEmployee.rhythm(startedWith, rhythm, starts).catch((err: Error) => log(`couldn't offer to make an employee: ${err.message}`)),
    log,
  });
  await jobsStartedByHand.load();
  jobsStartedByHandOnceStarted = jobsStartedByHand;
  const makeAnEmployee = createMakeAnEmployee({
    account,
    employees: employeesOnThisComputer,
    ties: employeeTies,
    expertHasKey,
    checkoutOf: (server, project) => checkoutFor(indexOf(server), project),
    clone: (url, project) => isoplanClone({ url }, project),
    expertEntry: (server, key) => recordLinks.get(server)?.directory()?.experts.find((e) => e.key === key && !e.employee) ?? null,
    hasInstance: (server, key) => {
      const found = instances.lookUp(server, key, null);
      return !!found && found.kind !== "set-up-failed";
    },
    setUpExpert: (server, entry) => void instances.setUp(server, entry).catch((err: Error) => log(`expert ${entry.key}: couldn't set it up: ${err.message}`)),
    expertSetUpDone: (server, key) => {
      const found = instances.lookUp(server, key, null);
      return found?.kind !== "setting-up" && (found?.kind !== "running" || found.running.expert.hosted().state !== "starting");
    },
    waitMinutes: async () => (await settings()).employees.makingWaitMinutes,
    check: checkBeforeItLeaves,
    scan: scanText,
    log,
  });
  for (const [server, link] of employeeLinks) {
    link.handle({
      offerEnded: (m) => offersToMakeAnEmployee.ended(server, m),
      offerJobWanted: (m) => void offersToMakeAnEmployee.jobWanted(server, m).catch((err: Error) => log(`couldn't send the job of an offer to make an employee: ${err.message}`)),
      make: (m) => void makeAnEmployee.take(server, m, (x) => link.sendNow(x)).catch((err: Error) => log(`couldn't make an employee: ${err.message}`)),
      opened: () => offersToMakeAnEmployee.opened(server),
    });
  }
  const drive: Driver = createDriver({
    claudeDir,
    account,
    offices: drives,
    registry,
    binary,
    settings,
    scan: scanText,
    log,
    namer,
    // Kept on disk, so it isn't reported again after a runner restart either; it is once its
    // transcript is written again (resumed in a terminal, say), or its hooks module connects.
    removed: (session) => reporting.end(session.slice(session.indexOf(":") + 1), REMOVED, true),
    endStrays: (session, folder) => endStrays(session, folder, { log }),
    projectOf: async (folder) => (await homeIo.projectOf(await homeIo.resolve(folder), folder)).id,
    isoplanClone,
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
        background: (id) => background.add(id),
        closed: (id) => closedFromMenu.delete(id),
      }),
    // An install or sign-in ends with the Claude app's check again, for the next hello.
    setup: (m) => {
      claude.take(m);
      void claude.settled().then(checkDesktop).catch(() => {});
    },
  });
  driver = drive;

  // The desktop app's Close of a headless session (status.ts sessionsSeen names it): a driven one by
  // its session, a fork or a take's first turn by its process, only while the registry records it.
  // A driven one is ended as the floor's stop ends it, and with `remove` removed as well (#129).
  closeFor = async (close, remove) => {
    if (close.startsWith("pid:")) {
      // A take's first turn that ends now says why to the office (handoff/take.ts).
      const record = await closeProcess(close, registry.list(), { kill: killPid, alive, waitMs: (await settings()).drivenCloseSeconds * 1000, closing: closedFromMenu });
      if (!record) return false;
      log(`closed the ${record.kind} process ${record.pid} of ${record.session} from the desktop app's menu`);
      if (record.kind === "desktop-read") await reporting.end(record.session.slice(record.session.indexOf(":") + 1), CLOSED_FROM_MENU);
      return true;
    }
    return drive.end(close, remove);
  };
  // The sessions, for the desktop app's menu.
  // Until the settings can first be read, it looks again as the app does (LOCK_REFRESH_MS).
  let listMs = LOCK_REFRESH_MS;
  const listSessions = async () => {
    try {
      status.sessions(sessionsSeen(reporting.sessions(), registry.list(), background, titles));
      listMs = (await settings()).trayRefreshSeconds * 1000;
    } catch (err) {
      log(`couldn't list the sessions for the desktop app's menu: ${String((err as Error)?.message ?? err)}`);
    } finally {
      setTimeout(() => void listSessions(), listMs).unref();
    }
  };
  await listSessions();

  // Expert creation suggestions, to each office over its own link (expert-creation-suggestions.ts), read from expert-creation-suggestions.json before any link opens.
  const expertCreationSuggestions = createExpertCreationSuggestions({
    isoplanDir,
    settings,
    offices: answering.map((office, index) => ({ server: office.server, label: office.label, send: (m) => live(index)(m) })),
    account,
    scan: scanText,
    draft: (input, t) => expertCreationSuggestionModelCalls.draft(input, t),
    corrects: (text, reply, t) => expertCreationSuggestionModelCalls.corrects(text, reply, t),
    experts: () => hosted.hosted(),
    projectOf: async (folder) => (await homeIo.projectOf(await homeIo.resolve(folder), folder)).id.toLowerCase(),
    checkout: checkoutFor,
    // With none, Isoplan's own hidden clone, as a hidden start makes it.
    clone: (url, project) => isoplanClone({ url }, project),
    hooked: (bare) => pipe?.hooked(bare) ?? null,
    log,
  });
  await expertCreationSuggestions.start();
  expertCreationSuggestionsOnceStarted = expertCreationSuggestions;

  // The supervisor holds stdin open; it closes when the supervisor has gone.
  const gone = new Promise<void>((resolve) => process.stdin.on("end", resolve).on("error", resolve).resume());
  const links = answerOffices<Office, ReplyMessage | RefusalMessage | TakenMessage, DrivenMessage | RunnerExpertRecordMessage | RunnerExpertCreationSuggestionMessage>({
    offices: answering,
    name: (office) => office.server,
    open: (office, said) => {
      const { pairing, runner } = answerers[answering.indexOf(office)]!;
      const records = recordLinks.get(office.server)!;
      const learned = learnedLinks.get(office.server)!;
      const employeeLink = employeeLinks.get(office.server)!;
      log(`the runner's worker ${process.pid} is answering for this machine through ${office.server}`);
      status.opening(office.server);
      return createLink({
        url: office.server,
        emit: emitFor(office),
        pairing,
        onMessage: (message) => runner.take(message),
        onDrive: (message) => drive.take(office.server, message),
        onExpertRecordMessages: (message) => records.take(message),
        onExpertCreationSuggestionMessages: (message) => {
          // A first dismissals with no directory before it: a server from before 0.17.0 (expert-record-link.ts).
          if (message.type === "expert-creation-suggestion-dismissals") records.dismissals();
          expertCreationSuggestions.take(answering.indexOf(office), message);
        },
        // At every hello and every drop, this office's drive-policy no longer holds; nothing driven goes on the new connection until its first one, which `holding` follows.
        // Nor does it take an expert creation suggestion's message until its first expert-creation-suggestion-dismissals.
        onOpen: () => {
          status.opened(office.server);
          drive.linked(office.server);
          records.onOpen();
          learned.onOpen();
          employeeLink.onOpen();
          expertCreationSuggestions.linked(answering.indexOf(office));
          // The renewal before this hello kept the email the office named, if it did.
          void readPairing(pairingPath(claudeDir)).then((all) => status.email(office.server, pairingEntry(all, office.server, account.id)?.email));
        },
        onClose: () => (status.closed(office.server), drive.unlinked(office.server), records.onClose(), learned.onClose(), employeeLink.onClose(), expertCreationSuggestions.linked(answering.indexOf(office))),
        onNotWanted: () => (status.stopped(office.server, "not-wanted"), said.notWanted()),
        // A revoked or lapsed pairing closes this link: the sessions' links pair the machine again.
        onPairingEnded: () => (status.stopped(office.server, "unpaired"), said.unpaired()),
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
          hiddenStarts: true,
          canCreateExpertsFromSuggestions: true,
          expertInstances: true,
          sharesWhatExpertInstancesLearn: true,
          employees: true,
        },
      });
    },
    paired: async (office) => !!pairingEntry(await readPairing(pairingPath(claudeDir)), office.server, account.id)?.credential,
    // Nor while it reports sessions: their links, and the pairing they share, would end with it.
    idle: () => answerers.every((a) => a.runner.idle()) && reporting.reporting().length === 0 && !pipe?.all().length && hosted.idle() && employeesOnThisComputer.idle() && expertQuestions.idle() && expertCreationSuggestions.idle(),
    lit: async () => anyRoomSince(io, path.join(claudeDir, "projects"), Date.now() - askableMs(await config().catch(() => first))),
    // An employee tied to a published record keeps its runner up for its runs.
    keep: async () => drive.held() > 0 || employeesOnThisComputer.anyTied() || (await settings()).startAtLogin,
    gone,
    log,
    checkMs: CHECK_MS,
    holdOffMs: HOLD_OFF_MS,
  });
  send = links.sender;
  live = links.live;
  const ended = await links.ended;
  for (const link of recordLinks.values()) link.stop();
  for (const link of learnedLinks.values()) link.stop();
  for (const link of employeeLinks.values()) link.stop();
  employeesOnThisComputer.close();
  await employeeTools.stop();
  expertQuestions.close();
  await expertRecordsPerOffice.written();
  // Each session's link closes, and its log says so, before the worker exits; one stuck in a pass is left after STOP_WAIT_MS (reporting.ts).
  await reporting.stop();
  await pipe?.close();
  await status.written();
  return ended === "not-wanted" ? NOT_WANTED_CODE : ended === "unpaired" ? UNPAIRED_CODE : 0;
}

process.exitCode = await (process.argv.includes("--worker") ? worker() : supervisor());
await logging;
// The link's timers would keep the process up; it is done.
process.exit();
