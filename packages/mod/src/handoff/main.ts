// The handoff commands' script, which the plugin's /isoplan:handover and /isoplan:take run inside
// the session (commands/):
//
//   node dist/handoff.js prepare --to <name> [--spin-off] [--office <label>]     a new handoff id, where to write the brief (and the task) and what to write
//   node dist/handoff.js hand-over --id <id> --to <name> --brief <file> [--task <file>] [--office <label>] [--push-anyway [<repo>=]<commit>]...   commits, pushes and hands the room over
//   node dist/handoff.js take <code> [--office <label>]                          checks out the handoff here and prints its brief
//
// With several office servers in config.json (#105), a hand-over goes to the one office whose list
// takes the session's repo; when more than one does, prepare and hand-over name them and stop until
// `--office` picks one (its label, its address or its host). A take asks only the office `--office`
// names; without it, each office in config.json's order, and takes it from the first that knows the
// code (offices.ts); the session then asks the room in that office.
//
// The session is $CLAUDE_CODE_SESSION_ID and its folder $CLAUDE_PROJECT_DIR (else this process's
// folder, which a cd in the agent's shell may have moved), both of which Claude Code sets for the
// commands it runs. Each talks to the office server over its own short link (connection.ts), as that
// session. With sign-in on, its hello carries this machine's pairing token (#23), renewed once when
// the server says it has run out; the commands never pair the machine, and say what to do when the
// server refuses them for it.
//
// On the command path the live agent writes the brief, in its own turn, then runs hand-over. That
// adds the runner's note (the branch and the untracked files), scans the brief for secrets, asks
// the server whether it would take the hand-over, does the git work (git.ts) and sends it. A brief
// that matches a secret pattern isn't sent: the agent is told which pattern, so it can take it out.
// A commit whose added lines match isn't pushed: the agent is told the file and the commit, and only
// --push-anyway with that commit, on the person's say, pushes it, exactly as it was. With several
// repos in the session's folder (#56) the file is named by its path there, and the flag is
// `--push-anyway <repo>=<commit>` for a repo under the folder, one per held repo. The brief's
// folder (isoplan/handoffs/out/<id>) goes once it is sent, and any left by a prepare that wasn't
// followed up goes after a day.
//
// A spin-off (#91) is a hand-over with a task of its own: prepare `--spin-off` names a task file,
// which the agent writes the task to as the person gave it, and asks for the brief written for that
// task (prompts/spin-off.md); hand-over `--task <file>`, or that task file when --task is left out,
// sends it, at most MAX_TASK_LENGTH characters, on the check and in the handoff, once it has
// cleared the secret scan with the brief.
// Nothing here stops or pauses the session handing over, a spin-off or not.
//
// `--to me` (or `myself`) hands the room to a new session of the person's own (isoplan-app/isoplan#109):
// the office server takes it as the sender when nobody in the office is called that, the brief is
// asked for as written for that new session, and what is printed says so.

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MAX_TASK_LENGTH, PROTOCOL_VERSION, type HandedOverMessage, type HandOverReadyMessage, type HandoffMessage, type HandoffRepo, type HelloMessage, type OfficeServerMessage, type Project } from "@isoplan/protocol";
import { loadConfig, loadSettings, officeNamed, officesOf, type Office } from "../data-layer/config.js";
import { findRoom, handOverOffice } from "./offices.js";
import { recordTakenOffice } from "./taken-office.js";

import { approvedPath, cachedRepos } from "../data-layer/approved.js";
import { commandHome, machineHomeIo, takesFrom } from "../data-layer/home.js";
import { cachedRemoteNames } from "../data-layer/remote-names.js";
import { accountOf, claudePaths } from "../data-layer/identity.js";
import { nodeIo } from "../data-layer/io.js";
import { fill, loadPrompts } from "../runner/prompts.js";
import { loadPatterns, scan } from "../runner/scan.js";
import { httpUrl, isPlainRemote, pairingEntry, pairingPath, postJson, readPairing } from "../data-layer/pairing.js";
import { NEEDS_PAIRING, openPairedLink, PairingRefused, type CommandPairing } from "./connection.js";
import { createRunGit, gitFailed, handoffBranch, handoffNote, HandoffGitError, newHandoffId, prepare, pushHandoff, repoBranch, untrackedLine, type Takes } from "./git.js";
import { checkoutHere, handoffDir, setupCommand, type TakeSettings } from "./take.js";

const ANSWER_MS = 20000;
// A prepare's folder not handed over within this long was abandoned.
const ABANDONED_MS = 24 * 60 * 60 * 1000;

const here = path.dirname(fileURLToPath(import.meta.url));
const modDir = path.join(here, "..");
const { dir: claudeDir, json: claudeJson } = claudePaths(process.env, os.homedir());
const isoplanDir = path.join(claudeDir, "isoplan");
const io = nodeIo();
const run = createRunGit();

const flag = (argv: string[], name: string) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1]! : null;
};

/** The session's own folder. */
const sessionDir = () => process.env.CLAUDE_PROJECT_DIR || process.cwd();
/** Where a prepare keeps the brief until it is sent. */
const outDir = (id: string) => path.join(claudeDir, "isoplan", "handoffs", "out", id);

// Removes the folders of prepares that were never handed over.
async function tidyOut(): Promise<void> {
  const root = path.join(claudeDir, "isoplan", "handoffs", "out");
  for (const name of await fs.readdir(root).catch(() => [] as string[])) {
    const dir = path.join(root, name);
    const st = await fs.stat(dir).catch(() => null);
    if (st?.isDirectory() && Date.now() - st.mtimeMs > ABANDONED_MS) await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

class Stop extends Error {}
const stop = (text: string): never => {
  throw new Stop(text);
};

async function settings() {
  return loadSettings<TakeSettings & { repoSearchDepth: number }>(io, path.join(modDir, "runner.json"), path.join(isoplanDir, "runner.json"));
}

/**
 * The session's hello, as `project`: what the session reports as (data-layer/home.ts), or for a take,
 * the project of the handoff's room. Nothing of a repo the office doesn't take is sent, its id
 * included (#91).
 */
async function hello(cwd: string, project: Project): Promise<HelloMessage> {
  const id = process.env.CLAUDE_CODE_SESSION_ID;
  if (!id) stop("This runs inside a Claude Code session, which sets CLAUDE_CODE_SESSION_ID; it isn't set here.");
  return {
    type: "hello",
    v: PROTOCOL_VERSION,
    source: "claude-code",
    account: await accountOf({ readText: (p) => fs.readFile(p, "utf8").catch(() => null), run: io.run }, claudeJson, cwd),
    machine: { name: os.hostname() },
    session: `claude-code:${id}`,
    project,
  };
}

const loadOwnConfig = () => loadConfig(io, path.join(modDir, "config.json"), path.join(isoplanDir, "config.json"));

/** The offices config.json names that may be used, and the one `--office` picks (by label, address or host), if any; stops when it names none, or one that can't be used. */
async function officesNamed(argv: string[]): Promise<{ offices: Office[]; picked: Office | null }> {
  const all = officesOf(await loadOwnConfig());
  const offices = all.filter((o) => !o.plainRefused);
  const name = flag(argv, "--office");
  const picked = name === null ? null : (officeNamed(all, name) ?? stop(`"${name}" isn't one of the offices in config.json: ${all.map((o) => o.label).join(", ")}.`));
  if (picked?.plainRefused) stop(`${picked.server} is plain ws:// to another machine, so nothing is sent to it: use wss://, or set "allowPlainWs": true in config.json.`);
  if (!offices.length) stop(`${all.map((o) => o.server).join(", ")} ${all.length > 1 ? "are" : "is"} plain ws:// to another machine, so nothing is sent: use wss://, or set "allowPlainWs": true in config.json.`);
  return { offices, picked };
}

/**
 * The office a hand-over from `cwd` goes to, what the session reports as there, by this machine's
 * fresh copy of each office's list, and whether more than one office takes it; stops the command
 * when no office takes it, or when more than one does and `--office` doesn't say which.
 */
async function officeHere(cwd: string, argv: string[]): Promise<{ office: Office; home: Project; several: boolean }> {
  const config = await loadOwnConfig();
  const { offices, picked } = await officesNamed(argv);
  const taking: { office: Office; home: Project }[] = [];
  let refused = "";
  for (const office of offices) {
    const here = await commandHome(cwd, machineHomeIo(config.workspaceRepos, cachedRemoteNames(claudeDir)), { file: approvedPath(claudeDir, office.server), server: office.server, maxAgeMs: config.approvedMaxAgeMinutes * 60000 });
    if ("home" in here) taking.push({ office, home: here.home });
    else refused ||= here.refused;
  }
  const chosen = handOverOffice(taking, picked, refused, (o) => o.label);
  return "refused" in chosen ? stop(chosen.refused) : chosen;
}

/** Which repos under `cwd` a handoff may take: the office's alone, by this machine's fresh copy of its list. */
async function takesHere(server: string): Promise<Takes> {
  const config = await loadOwnConfig();
  return takesFrom(machineHomeIo(config.workspaceRepos, cachedRemoteNames(claudeDir)), await cachedRepos(approvedPath(claudeDir, server), server, config.approvedMaxAgeMinutes * 60000));
}

// A kept token is used while it has longer than this left, as the data layer's renewal would.
const TOKEN_LEFT_MS = 5 * 60 * 1000;

/**
 * This machine's pairing with `server` (#23), as a command uses it: only read. The
 * kept token goes in the hello while it is current; otherwise the credential is swapped for one for
 * this command alone (POST <server>/token), which isn't written back. Nothing here takes the
 * pairing's locks, writes pairing.json or starts a pairing: the session's data layer does those,
 * with its link in the status line. When a token can't be had, the command says the machine needs
 * pairing.
 */
async function pairingWith(server: string): Promise<CommandPairing> {
  const config = await loadOwnConfig();
  const file = pairingPath(claudeDir);
  // The pairing is the machine's, whichever folder the session is in.
  const account = await accountOf({ readText: (p) => fs.readFile(p, "utf8").catch(() => null), run: io.run }, claudeJson, os.homedir());
  return {
    async token(renew) {
      const entry = pairingEntry(await readPairing(file), server, account.id);
      if (!entry?.credential) return undefined;
      if (!config.allowPlainWs && isPlainRemote(server)) throw new PairingRefused(`${server} is plain ws:// to another machine, so this machine's pairing isn't sent over it: use wss://, or set "allowPlainWs": true in config.json.`);
      if (!renew && entry.token && (entry.tokenExpires ?? 0) - TOKEN_LEFT_MS > Date.now()) return entry.token;
      const answer = await postJson(httpUrl(server, "/token"), { credential: entry.credential }).catch(() => null);
      if (answer?.status === 200 && typeof answer.body.token === "string") return answer.body.token;
      throw new PairingRefused(NEEDS_PAIRING);
    },
  };
}

// The link to `server` and its first answer, as this machine's pairing; a refusal for the pairing stops the command.
async function exchange<T extends OfficeServerMessage>(server: string, cwd: string, first: Parameters<typeof openPairedLink>[3], wanted: (m: OfficeServerMessage) => m is T, before: string, project: Project) {
  const pairing = await pairingWith(server);
  try {
    return await openPairedLink(server, await hello(cwd, project), pairing, first, wanted, ANSWER_MS);
  } catch (err) {
    if (err instanceof PairingRefused) stop(`${before}${err.message}`);
    throw err;
  }
}

const said = (m: Extract<OfficeServerMessage, { type: "error" }>) => `The office server says: ${m.message}`;

// What the commands accept: a take code is the floor's fixed alphabet; a name is letters, digits,
// spaces and . _ @ -, so nothing typed after a command can reach a shell as more than that.
const CODE = /^[A-HJ-NP-Z2-9]{4}-?[A-HJ-NP-Z2-9]{4}$/i;
const NAME = /^[\p{L}\p{N}][\p{L}\p{N} ._@-]{0,79}$/u;
const nameOf = (argv: string[]) => {
  const to = (flag(argv, "--to") ?? "").trim();
  if (!NAME.test(to)) stop(`"${to}" isn't a name to hand over to: use their name or account id, in letters, digits, spaces and . _ @ - only, or "me" for a new session of yours.`);
  return to;
};
/** Whether the name is "me": a new session of the person's own. */
const toSelf = (to: string) => /^(me|myself)$/i.test(to);

async function prepareCommand(argv: string[]): Promise<string> {
  const to = nameOf(argv);
  const s = await settings();
  await tidyOut();
  const { office, several } = await officeHere(sessionDir(), argv);
  const prepared = await prepare(run, sessionDir(), s.gitTimeoutSeconds * 1000, s.repoSearchDepth, undefined, await takesHere(office.server)).catch((err: unknown) => stop(err instanceof HandoffGitError ? `Can't hand over from here: ${gitFailed(err)}.` : String(err)));
  const id = newHandoffId();
  const folder = outDir(id);
  await fs.mkdir(folder, { recursive: true });
  const spinOff = argv.includes("--spin-off");
  const taskFile = path.join(folder, "task.md");
  const prompts = await loadPrompts(path.join(modDir, "prompts"));
  const values = { to: toSelf(to) ? "a new Claude Code session of this same person's" : to, untracked: untrackedLine(prepared.files) };
  const brief = spinOff ? fill(prompts.spinOff, { ...values, task: `The task as written in ${taskFile}.` }) : fill(prompts.brief, values);
  const subs = prepared.repos.filter((r) => r.path !== ".");
  const repos = subs.length ? [`Repos, by path in this folder: ${prepared.repos.map((r) => `${r.path} (${repoBranch(id, r)}${r.from ? `, from ${r.from}` : ""})`).join(", ")}`] : [];
  const left = prepared.left.length ? [`Left out: ${prepared.left.map((l) => `${l.path} (${l.why})`).join("; ")}`] : [];
  // Named to you alone: not in the brief, the note or anything else that leaves this machine.
  if (prepared.notInOffice.length) left.push(`Left out, not in the office (named here only, never sent): ${prepared.notInOffice.join(", ")}`);
  const offices = several ? [`Office: ${office.label} (pass --office "${office.label}" to hand-over)`] : [];
  const task = spinOff ? [`Task file: ${taskFile} (write the new task there first, as it was given)`] : [];
  return [`Handoff id: ${id}`, `Brief file: ${path.join(folder, "brief.md")}`, ...task, ...offices, `Branch: ${handoffBranch(id)}${prepared.from ? `, made from ${prepared.from}` : ""}`, ...repos, ...left, "", brief].join("\n");
}

// --push-anyway <commit> for the session folder's own repo, or <repo>=<commit> for one under it, once per held repo.
function pushAnywayOf(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  argv.forEach((arg, i) => {
    if (arg !== "--push-anyway") return;
    const value = argv[i + 1] ?? "";
    const at = value.lastIndexOf("=");
    const [repo, commit] = at >= 0 ? [value.slice(0, at), value.slice(at + 1)] : [".", value];
    if (!repo || !/^[0-9a-f]{40}([0-9a-f]{24})?$/.test(commit)) stop("--push-anyway takes the held commit's full hash, with its repo's path and = before it for a repo under the folder, as hand-over printed it.");
    out[repo] = commit;
  });
  return out;
}

async function handOverCommand(argv: string[]): Promise<string> {
  const id = flag(argv, "--id") || stop("Missing --id: run prepare first.");
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(id)) stop(`"${id}" isn't a handoff id.`);
  const to = nameOf(argv);
  const pushAnyway = pushAnywayOf(argv);
  const file = flag(argv, "--brief") || stop("Missing --brief <file>.");
  const written = (await fs.readFile(file, "utf8").catch(() => stop(`There is no brief at ${file}: write it there first.`))).trim();
  if (!written) stop(`The brief at ${file} is empty.`);
  if (argv.includes("--task") && flag(argv, "--task") === null) stop("hand-over --task needs the task file.");
  // A task written at prepare --spin-off goes out with the brief even when --task wasn't given.
  const preparedTask = path.join(outDir(id), "task.md");
  const taskPath = flag(argv, "--task") ?? (await fs.access(preparedTask).then(() => preparedTask, () => null));
  const task = taskPath === null ? null : (await fs.readFile(taskPath, "utf8").catch(() => stop(`There is no task at ${taskPath}: write it there first.`))).trim();
  if (task === "") stop(`The task at ${taskPath} is empty.`);
  if (task && task.length > MAX_TASK_LENGTH) stop(`The task at ${taskPath} is ${task.length} characters long; a task can be at most ${MAX_TASK_LENGTH}. Shorten it and run hand-over again.`);
  const cwd = sessionDir();
  const s = await settings();
  const timeoutMs = s.gitTimeoutSeconds * 1000;
  const { office, home } = await officeHere(cwd, argv);
  // Prepared once: the note names the repos the push then hands over.
  const prepared = await prepare(run, cwd, timeoutMs, s.repoSearchDepth, undefined, await takesHere(office.server)).catch((err: unknown) => stop(err instanceof HandoffGitError ? `Can't hand over from here: ${gitFailed(err)}.` : String(err)));
  const { from, files, repos, left } = prepared;
  const unknown = Object.keys(pushAnyway).filter((repo) => !repos.some((r) => r.path === repo));
  if (unknown.length) stop(`--push-anyway names ${unknown.map((r) => (r === "." ? "this folder's own repo" : r)).join(", ")}, which this doesn't hand over (it hands over ${repos.map((r) => r.path).join(", ")}). Nothing was pushed.`);
  const brief = `${written}\n\n${handoffNote({ branch: handoffBranch(id), from, files, at: new Date(), repos, left })}`;
  const patterns = await loadPatterns(path.join(modDir, "secret-patterns.json"), path.join(isoplanDir, "secret-patterns.json"), () => {});
  const matched = scan(brief, patterns);
  if (matched) stop(`The brief wasn't sent: it matches the secret pattern "${matched}". Take that out of ${file} and run hand-over again.`);
  const taskMatched = task ? scan(task, patterns) : null;
  if (taskMatched) stop(`The task wasn't sent: it matches the secret pattern "${taskMatched}". Take that out of ${taskPath} and run hand-over again.`);

  // The server says whether it would take this hand-over before anything is pushed.
  const { link, answer: ready } = await exchange(office.server, cwd, { type: "hand-over-check", v: PROTOCOL_VERSION, to, handoff: id, ...(task ? { task } : {}) }, (m): m is HandOverReadyMessage => m.type === "hand-over-ready" && m.handoff === id, "Nothing was pushed. ", home);
  try {
    if (ready.type === "error") stop(`Nothing was pushed. ${said(ready)}`);
    const pushed = await pushHandoff(run, cwd, id, timeoutMs, { scan: async (text) => scan(text, patterns), pushAnyway, prepared, names: cachedRemoteNames(claudeDir) }).catch((err: unknown) =>
      stop(
        err instanceof HandoffGitError
          ? `The handoff wasn't sent: ${gitFailed(err)}.${err.pushed.length ? ` Run hand-over again with --id ${id} once that is fixed: it pushes the rest.` : ""}\n${err.detail}`
          : String(err),
      ),
    );
    if ("held" in pushed) {
      const unchecked = pushed.unchecked.length ? ` These files couldn't be checked (binary): ${pushed.unchecked.join(", ")}.` : "";
      const again = Object.entries(pushed.commits).map(([repo, commit]) => `--push-anyway ${repo === "." ? commit : `${repo}=${commit}`}`);
      const kept = Object.keys(pushAnyway).length ? ", keeping the --push-anyway you gave already" : "";
      stop(`Nothing was pushed: the lines the push would send to ${pushed.held.join(", ")} match a secret pattern.${unchecked} Take the secrets out, or, if they aren't any, run hand-over again with ${again.join(" ")}${kept}, to push those exact commits.`);
    }
    const { repos: sent } = pushed as { repos: HandoffRepo[] };
    const branch = handoffBranch(id);
    link.send({ type: "hand-over", v: PROTOCOL_VERSION, to, handoff: { id, brief, repos: sent, ...(task ? { task } : {}) } });
    const answer = await link.next((m): m is HandedOverMessage => m.type === "handed-over" && m.handoff === id, ANSWER_MS);
    const pushedBranches = sent.map((r) => (r.path === "." ? r.branch : `${r.branch} in ${r.path}`)).join(", ");
    if (answer.type === "error") stop(`${said(answer)}\nPushed: ${pushedBranches}. Run hand-over again with the same id once that is fixed.`);
    const name = (answer as HandedOverMessage).to.name || (answer as HandedOverMessage).to.id;
    if (path.resolve(path.dirname(file)) === path.resolve(outDir(id))) await fs.rm(outDir(id), { recursive: true, force: true }).catch(() => {});
    const inRepos = sent.some((r) => r.path !== ".") ? ` in ${sent.map((r) => (r.branch === branch ? r.path : `${r.path} (as ${r.branch})`)).join(", ")}` : "";
    const what = task ? "Spun off, with its new task," : "Handed over";
    const carryOn = task ? " This session carries on with its own work." : "";
    if (toSelf(to)) return `${what} to a new session of yours, on ${branch}${inRepos}. Open it from the floor with Take handoff, or copy its prompt there into a session you have.${carryOn}`;
    return `${what} to ${name}, on ${branch}${inRepos}. They will see a Take handoff button on the floor.${carryOn}`;
  } finally {
    await link.close();
  }
}

/**
 * The project of the room `code` takes into (POST <server>/handoff-room), which the take says hello
 * from: whatever folder the session is in, its own id isn't sent, and the session joins that room
 * (#91); or what the office said when it doesn't know the code.
 */
async function roomOf(server: string, code: string, cwd: string): Promise<{ project: string } | { unknown: string }> {
  const pairing = await pairingWith(server);
  let token: string | undefined;
  try {
    token = await pairing.token(false);
  } catch (err) {
    return { unknown: err instanceof PairingRefused ? err.message : String(err) };
  }
  const account = await accountOf({ readText: (p) => fs.readFile(p, "utf8").catch(() => null), run: io.run }, claudeJson, cwd);
  const answer = await fetch(httpUrl(server, "/handoff-room"), {
    method: "POST",
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ code, account: account.id }),
    signal: AbortSignal.timeout(ANSWER_MS),
  }).catch(() => null);
  if (!answer) return { unknown: `The office server at ${server} couldn't be reached.` };
  const body = (await answer.json().catch(() => ({}))) as { project?: unknown; error?: unknown };
  if (answer.status === 401) return { unknown: NEEDS_PAIRING };
  if (answer.status !== 200 || typeof body.project !== "string") return { unknown: `The office server says: ${typeof body.error === "string" ? body.error : `it answered ${answer.status}`}` };
  return { project: body.project };
}

async function takeCommand(argv: string[]): Promise<string> {
  const code = (argv[0] ?? "").trim();
  const { offices, picked } = await officesNamed(argv.slice(1));
  if (!CODE.test(code)) stop("That isn't a take code: it is the eight letters and digits the floor shows, like ABCD-EFGH.");
  const cwd = sessionDir();
  const s = await settings();
  const timeoutMs = s.gitTimeoutSeconds * 1000;
  const patterns = await loadPatterns(path.join(modDir, "secret-patterns.json"), path.join(isoplanDir, "secret-patterns.json"), () => {});
  const config = await loadOwnConfig();
  const room = await findRoom(offices, picked, code, {
    ask: (o, c) => roomOf(o.server, c, cwd),
    takes: async (o, project) => !!(await cachedRepos(approvedPath(claudeDir, o.server), o.server, config.approvedMaxAgeMinutes * 60000))?.has(project.toLowerCase()),
    label: (o) => o.label,
  });
  if ("refused" in room) stop(room.refused);
  const { office, project } = room as { office: Office; project: string };
  const { link, answer } = await exchange(office.server, cwd, { type: "take", v: PROTOCOL_VERSION, code }, (m): m is HandoffMessage => m.type === "handoff", "", { id: project, name: project.split("/").pop() || project });
  try {
    if (answer.type === "error") stop(said(answer));
    const { handoff } = answer as HandoffMessage;
    const { failures, remote, dir } = await checkoutHere(run, cwd, handoff, handoffDir(claudeDir, handoff.id), timeoutMs, { names: cachedRemoteNames(claudeDir) });
    // Git's output leaves this machine only after the scan.
    const sent = failures.map((f) => (scan(f.output, patterns) ? { ...f, output: "The end of its output is withheld here: it matches a secret pattern." } : f));
    link.send({ type: "taken", v: PROTOCOL_VERSION, handoff: handoff.id, failures: sent });
    // This session asks the room in the office it took the handoff from.
    await recordTakenOffice(claudeDir, process.env.CLAUDE_CODE_SESSION_ID ?? "", office.server).catch(() => {});
    const branch = handoffBranch(handoff.id);
    const own = failures.find((f) => !f.repo);
    const done = handoff.repos.filter((r) => r.path !== "." && !failures.some((f) => f.repo === r.path));
    const checkout = own
      ? `The checkout of ${branch} failed, so this folder and the repos in it are as they were:\n${own.output}`
      : [
          handoff.repos.some((r) => r.path === ".") ? `The repo at ${dir} is now on ${branch}.` : "",
          done.length ? `These repos in ${dir} are now on their handoff branches: ${done.map((r) => `${r.path} (${r.branch})`).join(", ")}.` : "",
          ...failures.map((f) => `The checkout of ${f.repo} failed, so that repo is as it was:\n${f.output}`),
        ]
          .filter(Boolean)
          .join("\n");
    // No setup runs on this path; the agent is told when the repo has one, in case it matters here.
    const setup = remote ? await setupCommand(run, { dir, remote }, process.platform, timeoutMs) : null;
    const setupNote = setup ? [`The repo's worktree setup script has NOT been run here: \`${setup}\` (from isoplan.json). Run it only if this folder isn't set up yet.`] : [];
    if (handoff.task) {
      return [`You have taken Isoplan spin-off ${handoff.id}: a new task of your own, and this session has it now.`, checkout, ...setupNote, "To ask the session it came from a question, use the Isoplan ask_earlier_session tool (ask_room in older Isoplan plugins); it carries on with its own work.", "", "Your task:", "", handoff.task, "", "The brief, written for that task:", "", handoff.brief].join("\n");
    }
    return [`You have taken Isoplan handoff ${handoff.id}, and this session has the work now.`, checkout, ...setupNote, "To ask the session it came from a question, use the Isoplan ask_earlier_session tool (ask_room in older Isoplan plugins).", "", "The brief:", "", handoff.brief].join("\n");
  } finally {
    await link.close();
  }
}

async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;
  try {
    const out =
      command === "prepare" ? await prepareCommand(rest) : command === "hand-over" ? await handOverCommand(rest) : command === "take" ? await takeCommand(rest) : stop("usage: handoff.js prepare | hand-over | take");
    process.stdout.write(out + "\n");
    return 0;
  } catch (err) {
    process.stdout.write(`${err instanceof Stop ? err.message : `The handoff failed: ${(err as Error)?.message ?? String(err)}`}\n`);
    return 1;
  }
}

process.exitCode = await main(process.argv.slice(2));
