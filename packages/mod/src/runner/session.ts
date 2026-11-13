// The session driver (#41, design R1, R3, R5, R8): a person's own Claude Code session, run by the
// runner on their machine and driven from the floor through the office server (protocol 0.5.0's
// `drive` requests and `driven` messages, packages/protocol/src/messages.ts).
//
//   claude -p (--resume <uuid> | --session-id <uuid>) --input-format stream-json
//     --output-format stream-json --verbose --permission-mode (auto | bypassPermissions)
//     --permission-prompts host --permission-prompt-tool stdio [--name <name>] [--add-dir <folder>]
//
// - One long-lived process per held session, on the answerer's pattern (claude.ts), but this is the
//   person's own working session: their settings, tools, MCP servers and plugins load, and it is
//   saved, so the plugin's own hooks show it on the floor as their agent. Its environment is the
//   runner's less what ties a process to the session that started the runner (forkEnv).
// - Probed on Claude Code 2.1.318 (6 Nov 2026, Haiku, a temp folder): one process takes turn after
//   turn while stdin stays open; each user line starts a turn (a `system` `init` line first, about
//   0.6 s after the line is written), and each turn ends with exactly one `result`, `num_turns` ≥ 1,
//   `result` the agent's last words. Closing stdin ends the process, exit code 0, within a second.
//   `--resume <uuid>` keeps the same session id (no fork). A missing transcript writes "No
//   conversation found with session ID: <uuid>" to stderr and a `result` with `is_error`,
//   `subtype` "error_during_execution", `num_turns` 0 and that text in `errors`, then exits 1. A tool
//   use comes as an `assistant` line with a `tool_use` block, its result as a `user` line with a
//   `tool_result` block. Something that needs permission, with nobody answering, is denied at once:
//   a `system` line, `subtype` "permission_denied", naming `tool_name`, then an error tool result,
//   whether `--permission-prompts` is the default `host` or `none`.
// - Probed on Claude Code 2.1.318 (6 Nov 2026, Haiku, a temp folder, --no-session-persistence, no
//   settings files, `echo hi > probe.txt` through Bash): `--permission-prompts host` alone still
//   denies at once as above (`permission_decision` source "config"); with `--permission-prompt-tool
//   stdio` as well, the prompt comes to the runner instead, after the `assistant` line with the
//   `tool_use`, as one line: `{"type":"control_request","request_id":"<uuid>","request":{"subtype":
//   "can_use_tool","tool_name":"Bash","display_name":"Bash","input":{"command":"echo hi > probe.txt",
//   "description":"Write hi into probe.txt"},"description":"Write hi into probe.txt",
//   "permission_suggestions":[...],"blocked_path":"<the file>","tool_use_id":"toolu_..."}}`. It
//   waits for as long as it takes (90 s and more, Claude Code sets no limit). The answer is one stdin
//   line: `{"type":"control_response","response":{"subtype":"success","request_id":"<its id>",
//   "response":{"behavior":"allow","updatedInput":<its input>}}}` runs the tool (the file was made),
//   and `"response":{"behavior":"deny","message":"<words>"}` doesn't: the tool's result is an error
//   whose text is the message, and the turn goes on, with no `permission_denied` line. An interrupt
//   while one waits makes Claude Code send `{"type":"control_cancel_request","request_id":"<its
//   id>"}`, then end the turn with an error `result` (`subtype` "error_during_execution"). Closing
//   stdin while one waits aborts it ("Tool permission stream closed before response received" as the
//   tool's error result) and the turn goes on to its end. In `auto` mode the same holds: a prompt
//   comes only for what auto mode would still ask (an `ask` rule in the settings, `decision_reason_
//   type` "rule"), and a `deny` rule still gives the `permission_denied` line, as Claude Code's own
//   denial. `--permission-mode bypassPermissions` is taken (`init` says `permissionMode`
//   "bypassPermissions") and ran the write with no prompt.
// - Probed on Claude Code 2.1.318 (6 Nov 2026, Haiku, a temp folder, --no-session-persistence): an
//   instruction that is one of Claude Code's own commands, such as `/cost`, runs no turn of the
//   model's. It gives a `system` `init` line, an `assistant` line with `local_command_source` and
//   the command's text, then one `result`: `subtype` "success", `is_error` false, `num_turns` 0,
//   `local_command` "cost", and that text in `result`. The next instruction runs as usual. So a
//   result with `local_command` ends the turn too, though its `num_turns` is 0.
// - A start opens a new session (--session-id, a fresh uuid) in the folder of the first of the
//   room's sessions this machine has its own record of: Claude Code's transcript of that session
//   says the folder it ran in (`office.folder`, which also needs the folder to be there and in a
//   repo the office takes). Never a path from the server. None: refused `no-folder`.
// - Where a new session can start (#67): with each connection's first drive-policy, after
//   `holding`, and again whenever a check every `repoFoldersCheckMinutes` finds it changed, the
//   office is sent `folders`, the folders sessions on this machine ran in for each repo it takes
//   (`office.repoFolders`, repo-folders.ts). A start with `folder` and no room opens a fresh session
//   there, in a room of its own (`room:<session>`), with nothing from any room passed in, only when
//   the folder is one the office was last told of for the start's project and is still in that repo
//   (`office.home`); otherwise it is refused `no-folder`. The server's path is checked against
//   what this runner listed, never used unchecked.
// - From #84 each repo is listed once, by its main checkout, with the branches on its remote
//   (repo-folders.ts, checkouts.ts), and the check runs at least every `branchRefreshMinutes`, so
//   the office's list stays current. A start with `branch` too is refused `no-folder` unless that
//   branch was listed for the repo; it opens in the checkout when the checkout is on that branch, and
//   otherwise in a worktree of it (`office.branchFolder`), never switching the checkout's branch.
// - A start with a `mode` other than `driven` (#85), in a folder listed as above and on a branch
//   listed for it, opens there as a take does (start-where.ts, handoff/take.ts openSession), with
//   its instruction the first message and nothing from any room; it is answered `opened` with the
//   session's id and room, or `refused` `unavailable` with why. Its `permissions` and the cap don't
//   count: the runner doesn't hold it, and its own data layer reports it to the floor.
// - A turn is named by the instruction that started it; one at a time (`busy`). Each tool use is
//   sent as `tool` with a short summary of what for; the turn's `result` text as `reply`; then
//   `turn-ended`. The turn's full output (instruction, the agent's words, tools and their results) is
//   kept in memory for `output`; the whole session's comes from its transcript on disk.
// - Held: while a process holds the session (registry.ts records it). `stop` ends the process at
//   once, mid-turn or not; `hand-back` closes stdin and gives it `drivenCloseSeconds` to finish by
//   itself, then ends it, and answers with `claude --resume <uuid>` and the folder: the session is
//   the person's again and is forgotten here. A process that still hasn't closed after that (or,
//   for a stop, KILL_WAIT_MS after it was ended) keeps the session held, and the request is refused
//   `unavailable`, to try again. A process with no turn running and no output for
//   `drivenIdleMinutes` is closed the same way (`idle-closed`); the next instruction opens it again
//   with --resume (`held reopened`). A process that writes nothing within `drivenStartSeconds` of an
//   instruction is ended as stuck; one that ends by itself is `released crashed`, its turn `failed`.
//   A working turn is never cut short: stopping is the person's to do.
// - `stop` with `remove` (protocol 0.12.0): ended as a stop ends it, answered `released` `removed`,
//   then forgotten here, so it is never opened again, `holding` goes again without it, and its
//   reporting ends (`removed`), so its agent leaves the floor once the office supports it
//   (isoplan-app#245; an office before that shows it disconnected).
// - Closed from this computer (the desktop app's Close session and End and remove, `end`): the same
//   as the floor's `stop` and `stop` with `remove`, with no request to answer. Close session keeps the
//   session, released `stopped`, so the floor's next instruction opens it again.
// - `interrupt` (protocol 0.12.0) stops the reply in progress and keeps the process: the runner
//   writes Claude Code's own interrupt, the control request the Agent SDK sends. Probed on Claude Code
//   2.1.319 (9 Nov 2026, Windows, Haiku, a temp folder, --no-session-persistence, no settings): mid-
//   turn, `{"type":"control_request","request_id":"<id>","request":{"subtype":"interrupt"}}` is
//   answered at once with a `control_response` `success` naming that id, then the turn ends with a
//   `result`, `subtype` "error_during_execution", `is_error` true; the same process takes the next
//   instruction as usual. The turn ends `turn-ended` `stopped`, with no error said. With no turn
//   running Claude Code answers `success` and nothing else happens; the runner sends it nothing then,
//   and the floor nothing back.
// - A session started from the floor gets a short name from its first instruction (naming.ts), off
//   its turn: Claude Code writes no title for a headless session. The name passes the secret scan,
//   then is kept in the registry as the session's `name`, `named`, which the desktop app's menu shows
//   and its data layer gives the floor as the session's title. A take keeps the name it opened with.
// - At most `drivenPerProject` held sessions per project on the machine (sessions opening and takes
//   about to open count too); a start or reopen past it is refused `cap-reached` with the limit.
// - The runner's restart: a session whose process an earlier run left is ended by the registry
//   (`restore`, under the runner's lock), listed in `holding` as not held, and opened again with
//   --resume on the next instruction (`held restored`).
// - Only the runner's own person acts: every request whose `by` isn't the account the runner links
//   as is refused `not-owner`, and for an existing session `by` must be the person who started it.
//   A session is acted on only through the office it was started through.
// - Everything built from the session (a reply, a tool's name and summary, the words for a tool that
//   wasn't allowed, an output) passes the secret scan first. A matched reply or output is sent as a
//   note with a `withheld` id, and only the owner's `release` sends it, as the runner's withheld
//   answers are released (runner.ts); a tool use whose name or summary matched is sent as `tool`,
//   with no summary, and a tool that wasn't allowed as "a tool". A prompt whose tool name matched
//   goes as `tool`, and one whose description matched with a description that only says so, both
//   `withheld`; neither is released. At most MAX_HELD are held, the oldest dropped, each cut to what
//   its release sends.
// - Every message is cut to the protocol's limits and checked against DrivenMessageSchema before it
//   goes, so one bad message can't make the server close the runner's link, and is sent only while
//   the office's link is up (`office.send`) and its connection's first `drive-policy` has come,
//   never kept in the reply outbox. A server that drives sessions sends that first on every
//   connection; one from before driven sessions sends none, and closes the link on a `driven` (#58),
//   so it is sent none. Until then a message is dropped, an answer to a drive request too, as one is
//   while the link is down. With the connection's first drive-policy, `holding` says where each of
//   the office's sessions stands; a later one on it doesn't send it again.
// - A handoff taken as a driven session (handoff/take.ts, mode `driven`): `takeProblem` before
//   anything is made, `prepareTake` once the worktree is ready (the cap), and `taken` once the take
//   has ended. When its `taken` was handed to the link (which sends it now, or after the next hello)
//   and the server hadn't dropped the take, nor the runner given it up, that opens it under the
//   take's uuid with the take's prompt as its first turn, named by that uuid, after `held`
//   `started`; otherwise it only frees the take's place under the cap.
// - Permissions (#42, design R2): a session runs in Claude Code's `auto` mode, or in
//   `bypassPermissions` when its person asked for that (the start's or the driven take's
//   `permissions`, kept in the registry as `asked` for a reopen or restore) and the latest
//   `drive-policy` on the current connection to its office lists its project. Before one arrives on a
//   connection, and from the link's drop until the next one, nothing opens with bypassPermissions.
//   A start asking for it where it isn't allowed is refused `bypass-off`; a take, reopen or restore
//   opens in `auto` all the same, its `held` says so, and an `error` says why. A drive-policy that no
//   longer lists the project of a session running in bypassPermissions ends its process at once, as
//   a stop does, with an `error` saying why and `released` `stopped`; the next instruction opens it
//   in `auto`. A link drop alone ends nothing: it doesn't change the admin's choice.
// - Whatever the mode, what still asks permission comes to the runner (`--permission-prompts host
//   --permission-prompt-tool stdio`, see the probe above) and goes to the floor as `prompt`, under
//   the runner's own id, with a plain description of what it asks (`promptDescription`) and
//   `expires`, `drivenPromptMinutes` on. Only the owner's `answer` naming a prompt still waiting
//   allows or denies it; with none by `expires` it is denied, `timed-out`. A stop, a hand-back, the
//   process ending or Claude Code cancelling it ends it `cancelled`. Each ends once, with
//   `prompt-ended`, and Claude Code gets an answer for each it still waits on; a `control_request`
//   that isn't a prompt gets an error at once, so a turn never waits on one. No idle close or
//   stuck timeout runs while one waits. With each connection's first drive-policy the waiting ones
//   go again, right after `holding`, unchanged; while the link is down they aren't kept anywhere else.

import { randomUUID } from "node:crypto";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import fsp from "node:fs/promises";
import path from "node:path";
import {
  DrivenMessageSchema,
  MAX_COMMAND_LENGTH,
  MAX_DETAIL_LENGTH,
  MAX_DRIVEN_SESSION_ID_LENGTH,
  MAX_FOLDER_LENGTH,
  MAX_HOLDING,
  MAX_OUTPUT_LENGTH,
  MAX_PROMPT_LENGTH,
  MAX_REPLY_LENGTH,
  MAX_ROOM_ID_LENGTH,
  MAX_SUMMARY_LENGTH,
  MAX_TOOL_NAME_LENGTH,
  PROTOCOL_VERSION,
  type DriveMessage,
  type DrivePermissions,
  type DrivePolicyMessage,
  type DrivenMessage,
  type DriveRefusalReason,
  type StartMode,
} from "@isoplan/protocol";
import { pathKey } from "../data-layer/git.js";
import { claudeCommand } from "./claude-binary.js";
import { forkEnv, hiddenSpawn, killTree, userTurn, type Spawn } from "./claude.js";
import type { DrivenFields, ProcessRecord, Registry } from "./registry.js";
import type { RepoFolders } from "./repo-folders.js";
import { MAX_HELD } from "./runner.js";

/** What runner.json says of driven sessions. */
export interface DriveSettings {
  /** A held session's process is closed after this long with no instruction or output. */
  drivenIdleMinutes: number;
  /** The most sessions a project may have held on this machine at once. */
  drivenPerProject: number;
  /** How long a process asked to end (handed back, or idle) has to exit by itself before it is ended. */
  drivenCloseSeconds: number;
  /** How long a process may take to start on an instruction (its first output) before it is ended as stuck. */
  drivenStartSeconds: number;
  /** How long a permission prompt waits for its owner's answer from the floor before it is denied. */
  drivenPromptMinutes: number;
  /** How often the folders a new session can start in are checked again, and sent when they changed. */
  repoFoldersCheckMinutes: number;
  /** How often, at most, the branches on each repo's remote are listed again, and the folders sent when they changed. */
  branchRefreshMinutes: number;
}

/** One office server's side of the driver. */
export interface DriveOffice {
  /** The office's address, as the registry records a session's office. */
  server: string;
  /** Sends the message now if the office's link is up; false when it was dropped. Never kept for later. */
  send(message: DrivenMessage): boolean;
  /** The folder of the first of these sessions this machine has its own record of, still there and in a repo the office takes; null with none. */
  folder(roomSessions: string[]): Promise<string | null>;
  /** For each repo the office takes, the folders on this machine a new session can start in, as `folders` lists them. */
  repoFolders(): Promise<RepoFolders[]>;
  /** The project id, lower-cased, of the repo the office takes that `folder` is in; null when it is gone or the office takes none. */
  home(folder: string): Promise<string | null>;
  /** The folder a session on `branch` of the checkout `folder` opens in: the checkout when it is on it, else a worktree of it; or why there is none. */
  branchFolder(folder: string, branch: string): Promise<string | { error: string }>;
}

/** A start that opens outside the floor (#85): where, in the folder the runner listed, on `branch` if named, with `instruction` its first message, under `session`, a fresh bare uuid. */
export interface StartElsewhere {
  id: string;
  mode: StartMode;
  folder: string;
  branch?: string;
  instruction: string;
  session: string;
}

/** A handoff taken as a driven session, once its worktree is ready. */
export interface PreparedTake {
  /** The take's session id, the bare uuid: the session's id and its first turn's name. */
  session: string;
  folder: string;
  prompt: string;
  name: string;
  /** The handoff's own folder, with its brief, which the session reads. */
  addDir: string;
  room: string;
  by: { id: string };
  /** The permission mode the person taking it asked for. */
  permissions: DrivePermissions;
}

export interface DriverOptions {
  claudeDir: string;
  /** The runner's own person: the account its links say hello as. */
  account: { id: string };
  offices: DriveOffice[];
  registry: Registry;
  /** The `claude` binary, or null when none can be found. */
  binary: () => Promise<string | null>;
  settings: () => Promise<DriveSettings>;
  /** The name of the secret pattern `text` matches, or null. */
  scan: (text: string) => Promise<string | null>;
  log: (text: string) => void;
  /** The id of the project a folder is in, for a driven take's cap. */
  projectOf: (folder: string) => Promise<string | null>;
  /** Opens a start outside the floor (start-where.ts): `opened`, and what still needs the person, or why it didn't open. */
  elsewhere?: (start: StartElsewhere, bin: string) => Promise<{ opened: boolean; problem: string | null }>;
  /** Writes a short name for a session from its first instruction (naming.ts); without one, sessions keep their folder's name. */
  namer?: { name(instruction: string): Promise<string | null> };
  /** The session was ended and removed: its reporting ends, so its agent leaves the floor once the office supports it (isoplan-app#245). */
  removed?: (session: string) => Promise<void>;
  /** Installs Claude Code, or signs it in, for a request whose `by` is the runner's own person (claude-setup.ts). */
  setup?: (m: Extract<DriveMessage, { kind: "install-claude" | "sign-in-claude" }>) => void;
  spawn?: Spawn;
  env?: Record<string, string | undefined>;
  now?: () => number;
  newId?: () => string;
  platform?: NodeJS.Platform;
}

export interface Driver {
  /** A drive request or drive-policy from the office at `server`. */
  take(server: string, message: DriveMessage | DrivePolicyMessage): void;
  /** The office's link has said hello again, on a new connection: nothing goes on it until its first drive-policy, and then where its sessions stand and the prompts still waiting go. */
  linked(server: string): void;
  /** The office's link has dropped: its drive-policy no longer holds. */
  unlinked(server: string): void;
  /** Sends a message that is no session's to every office whose connection's first drive-policy has come. */
  say(message: DrivenMessage): void;
  /** How many sessions a process holds now, or is opening. */
  held(): number;
  /** Why this runner won't take a handoff as a driven session for `by`, or null. */
  takeProblem(by: { id: string } | undefined): string | null;
  /** Readies a driven take whose worktree is made: null, or why it can't be opened. */
  prepareTake(server: string, take: PreparedTake): Promise<string | null>;
  /** The take has ended: with `opens` (its `taken` was handed to the link, and it wasn't dropped or given up) its session opens now; without, its place under the cap is freed. */
  taken(session: string, opens: boolean): void;
  /**
   * Ends the session from this machine (the desktop app's Close session, or End and remove with
   * `remove`): its process tree ends, as a stop ends it. Kept, it is released `stopped`, and the next
   * instruction opens it again; removed, it is released `removed`, forgotten here, so it isn't opened
   * again, its office is sent `holding` again without it, and its reporting ends. False when there is
   * no such session, or its process didn't end.
   */
  end(session: string, remove?: boolean): Promise<boolean>;
  /** Ends every process at once, as the worker exits. */
  close(): void;
  /** Resolves once every request and message so far has been handled. */
  settled(): Promise<void>;
}

/** The permission mode a driven session runs in, unless its person asked for bypassPermissions where its office allows it. */
export const DRIVEN_PERMISSIONS: DrivePermissions = "auto";

/**
 * The permission flags of a driven session's process: `mode`, the one it runs in, and what still
 * asks permission handed to the runner, as control requests on its stdout (see the probe above).
 */
export function permissionArgs(mode: DrivePermissions): string[] {
  return ["--permission-mode", mode, "--permission-prompts", "host", "--permission-prompt-tool", "stdio"];
}

/** Every flag of a driven session's command line, after the binary. --add-dir takes every argument after it, so it is last. */
export function drivenArgs({ uuid, resume, permissions, name, addDir }: { uuid: string; resume: boolean; permissions: DrivePermissions; name?: string; addDir?: string }): string[] {
  return [
    "-p",
    ...(resume ? ["--resume", uuid] : ["--session-id", uuid]),
    "--input-format",
    "stream-json",
    "--output-format",
    "stream-json",
    "--verbose",
    ...permissionArgs(permissions),
    ...(name && !resume ? ["--name", name] : []),
    ...(addDir ? ["--add-dir", addDir] : []),
  ];
}

// The end of a process's stderr kept for the local log.
const STDERR_CHARS = 2000;
// A tool result's text kept in an output.
const TOOL_RESULT_CHARS = 2000;
// The end of a transcript read for a session's output.
const TRANSCRIPT_TAIL_BYTES = 4 * 1024 * 1024;
// Finished turns' outputs kept per session, newest last.
const TURNS_KEPT = 10;
// Start request ids remembered, so one sent twice opens one session.
const STARTS_KEPT = 200;
// Driven takes waiting for their `taken` to be sent.
const TAKES_KEPT = 20;
// How long a process that was ended at once gets to say it has gone.
const KILL_WAIT_MS = 10000;

/**
 * How long a Close from the desktop app's menu waits for the runner's answer: a fork or a take's first
 * turn gets drivenCloseSeconds to end, a driven session KILL_WAIT_MS, and then what is reporting it
 * ends. Twice the longer covers both.
 */
export const menuCloseWaitMs = (drivenCloseSeconds: number) => 2 * Math.max(drivenCloseSeconds * 1000, KILL_WAIT_MS);

const NO_CLAUDE = "Claude Code for the terminal isn't installed on this computer, so no session can run here.";
const NO_FOLDER = "This computer has no folder for this session: open Claude Code once in the session's repo here, then try again.";
const NOT_LISTED = "That folder isn't one this computer offers for this repo any more, so nothing was started. Pick one of the folders it offers now.";
const BRANCH_NOT_LISTED = "That branch isn't one this computer offers for this repo any more, so nothing was started. Pick one of the branches it offers now.";
const NO_WORKTREE = "A separate folder for that branch couldn't be made on this computer, so nothing was started. Its runner log says why.";
const NOT_STARTED = "Claude Code couldn't be started on this computer. Its runner log says why.";
const NOT_ELSEWHERE = "This computer's Isoplan can only run new sessions from the floor, so nothing was started.";
const PROBLEM_WITHHELD = "What went wrong is held back on this computer: it may contain a secret. Its runner log says what.";
const BUSY = "The agent is still working on the last instruction. Wait for it to finish, or stop it.";
const NOT_CLOSED = "Claude Code couldn't be closed for this session on this computer, so it is still running there. Try again in a moment.";
const TURN_GONE = "This computer no longer has that instruction's output (Isoplan restarted since, or it was long ago). Ask for the whole session's output instead.";
const RELEASE_GONE = "Nothing is held back under that id on this computer any more: Isoplan may have restarted since.";
const MISSING = "Claude Code can't find this session's saved conversation on this computer any more, so it can't be continued from the floor.";
const WITHHELD = "Held back on this computer: it may contain a secret. Release it from the floor to see it.";
const NOT_YOURS_TAKE = "This handoff was taken from the floor by someone other than this computer's own person, so nothing was opened here.";
const capReached = (limit: number) => `This project already has ${limit} sessions running from the floor on this computer, the most allowed. Stop one, then try again.`;
const BYPASS_OFF = "This office doesn't let sessions in this project skip permission prompts, so nothing was started. Start it again with prompts on.";
const PROMPTS_ON = "This office doesn't let sessions in this project skip permission prompts, so this one runs with them on: whenever the agent needs your permission, it asks you here first.";
const BYPASS_TURNED_OFF = "Skipping permission prompts was turned off for this project, so this session was closed. Your next instruction reopens it with prompts on.";
const BYPASS_STILL_RUNNING = "Skipping permission prompts was turned off for this project, but Claude Code couldn't be closed for this session on this computer yet. Try again in a moment.";
const NO_PROMPT = "That permission request isn't waiting for an answer any more: it was answered already, ran out of time, or the session stopped.";
const PROMPT_WITHHELD = "Held back on this computer: what the agent wants to do may contain a secret, so it isn't shown here.";
// What Claude Code, and so the agent, is told of a prompt the floor didn't allow.
const DENIED_TO_CLAUDE = "The user denied this permission request from the Isoplan floor.";
const TIMED_OUT_TO_CLAUDE = "No answer to this permission request came from the Isoplan floor in time, so it was denied.";
const UNSUPPORTED_TO_CLAUDE = "Not supported: the Isoplan runner driving this session answers only permission requests.";
// runner.json may say 2.5, but the cap is a whole number of sessions, and at least one.
const capOf = (st: DriveSettings) => Math.max(1, Math.floor(st.drivenPerProject));

type Ending = "stopped" | "handed-back" | "idle-closed";

/** A reply or output the secret scan held back, for the owner's release. */
interface Held {
  session: string;
  turn?: string;
  text: string;
  cut: boolean;
}

type PromptMessage = Extract<DrivenMessage, { kind: "prompt" }>;

/** A permission prompt Claude Code waits on, under the runner's own id. */
interface Waiting {
  id: string;
  /** Claude Code's id for it, which the answer on stdin names. */
  request: string;
  /** The process that asked: only it is answered. */
  child: ChildProcessWithoutNullStreams;
  turn: string | null;
  /** The tool's input, which an allow hands back unchanged. */
  input: unknown;
  /** As it was sent, once made: sent again unchanged with each connection's first drive-policy. */
  message: PromptMessage | null;
  timer: ReturnType<typeof setTimeout> | null;
}

interface Session {
  record: ProcessRecord & { driven: DrivenFields };
  child: ChildProcessWithoutNullStreams | null;
  opening: boolean;
  /** Resolves once the current process has closed. */
  closed: Promise<void>;
  turn: string | null;
  /** The running turn's output so far, and whether its start was cut off. */
  output: string;
  cut: boolean;
  outputs: Map<string, { text: string; cut: boolean }>;
  /** Why the runner is ending the process, while it does. */
  ending: Ending | null;
  /** The turn an interrupt was sent for, until it ends. */
  interrupting: string | null;
  /** Whether a name was asked for in this run. */
  naming: boolean;
  /** What to say when the process ends by itself, when known before it does. */
  failure: string | null;
  /** From before the runner's restart: it opens again as `restored`. */
  fromBefore: boolean;
  stderr: string;
  idle: ReturnType<typeof setTimeout> | null;
  idleToken: number;
  starting: ReturnType<typeof setTimeout> | null;
  /** The permission prompts waiting on the owner, by the runner's id. */
  prompts: Map<string, Waiting>;
  /** Requests on the session, one at a time. */
  work: Promise<void>;
  /** Its messages, in order. */
  out: Promise<void>;
}

const uuidOf = (session: string) => session.slice(session.indexOf(":") + 1);
const iso = (ms: number) => new Date(ms).toISOString();

/** `text` within `max`, its start kept, and whether it was cut. */
function cutStart(text: string, max: number): { text: string; cut: boolean } {
  return text.length <= max ? { text, cut: false } : { text: text.slice(0, max - 1) + "…", cut: true };
}

/** `text` within `max`, its end kept, and whether it was cut. */
function cutEnd(text: string, max: number): { text: string; cut: boolean } {
  return text.length <= max ? { text, cut: false } : { text: "…" + text.slice(-(max - 1)), cut: true };
}

/** A short summary of what a tool use was for, from its input: its description, else the file, pattern, command or address it names. */
export function summaryOf(input: unknown): string | undefined {
  if (!input || typeof input !== "object") return undefined;
  const i = input as Record<string, unknown>;
  for (const key of ["description", "file_path", "notebook_path", "path", "pattern", "command", "url", "query", "prompt", "skill", "subject"]) {
    const value = i[key];
    if (typeof value === "string" && value.trim()) return cutStart(value.replace(/\s+/g, " ").trim(), MAX_SUMMARY_LENGTH).text;
  }
  return undefined;
}

/**
 * What a permission prompt asks, in plain words, from its tool and the tool's input: the command it
 * would run, the file it would write, change or read, the address it would open, what it would search
 * the web for, or else the tool and its input as they are; then what for, when the agent said.
 */
export function promptDescription(tool: string, input: unknown): string {
  const i = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const said = (key: string) => (typeof i[key] === "string" && (i[key] as string).trim() ? (i[key] as string).trim() : undefined);
  const command = said("command");
  const file = said("file_path") ?? said("notebook_path");
  const url = said("url");
  const query = said("query");
  const verb = tool === "Write" ? "Write" : ["Edit", "MultiEdit", "NotebookEdit"].includes(tool) ? "Change" : tool === "Read" ? "Read" : null;
  const json = Object.keys(i).length ? JSON.stringify(i) : "";
  const what = command
    ? `Run this command: ${command}`
    : file && verb
      ? `${verb} the file ${file}`
      : url
        ? `Open the web address ${url}`
        : query
          ? `Search the web for: ${query}`
          : `Use ${tool}${json ? ` with: ${json}` : ""}`;
  const why = said("description");
  return why && (command || (file && verb) || url || query) ? `${what}\nWhat for: ${why}` : what;
}

function resultText(block: Record<string, unknown>): string {
  const c = block.content;
  const text = typeof c === "string" ? c : Array.isArray(c) ? c.map((x) => (x && typeof x === "object" && typeof (x as { text?: unknown }).text === "string" ? (x as { text: string }).text : "")).join("\n") : "";
  return cutStart(text.trim(), TOOL_RESULT_CHARS).text;
}

/**
 * The plain text of one message line, as stream-json writes it and as the transcript keeps it: an
 * instruction as `> ...`, the agent's words, `[Tool] what for`, and a tool's result. Empty for
 * anything else, and for a subagent's own lines.
 */
export function messageText(e: unknown): string {
  if (!e || typeof e !== "object") return "";
  const line = e as { type?: unknown; isSidechain?: unknown; isMeta?: unknown; parent_tool_use_id?: unknown; message?: { content?: unknown } };
  if ((line.type !== "user" && line.type !== "assistant") || line.isSidechain === true || line.isMeta === true || line.parent_tool_use_id) return "";
  const content = line.message?.content;
  if (typeof content === "string") return line.type === "user" ? `> ${content.trim()}` : content.trim();
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const block of content as Record<string, unknown>[]) {
    if (!block || typeof block !== "object") continue;
    if (block.type === "text" && typeof block.text === "string" && block.text.trim()) parts.push(line.type === "user" ? `> ${block.text.trim()}` : block.text.trim());
    else if (block.type === "tool_use") {
      const summary = summaryOf(block.input);
      parts.push(`[${typeof block.name === "string" ? block.name : "tool"}]${summary ? ` ${summary}` : ""}`);
    } else if (block.type === "tool_result") {
      const text = resultText(block);
      if (text) parts.push(text);
    }
  }
  return parts.join("\n");
}

/** The session's transcript: where Claude Code puts it for the folder, else wherever it is under projects/. */
export async function transcriptOf(claudeDir: string, folder: string, uuid: string): Promise<string | null> {
  const projects = path.join(claudeDir, "projects");
  const exists = (p: string) => fsp.stat(p).then((s) => s.isFile(), () => false);
  const guess = path.join(projects, folder.replace(/[^a-zA-Z0-9]/g, "-"), `${uuid}.jsonl`);
  if (await exists(guess)) return guess;
  for (const dir of await fsp.readdir(projects).catch(() => [] as string[])) {
    const p = path.join(projects, dir, `${uuid}.jsonl`);
    if (await exists(p)) return p;
  }
  return null;
}

/** The plain text of the end of a transcript, at most TRANSCRIPT_TAIL_BYTES of it, and whether its start was left out. */
export async function transcriptText(file: string): Promise<{ text: string; cut: boolean }> {
  const handle = await fsp.open(file, "r");
  try {
    const { size } = await handle.stat();
    const start = Math.max(0, size - TRANSCRIPT_TAIL_BYTES);
    const buffer = Buffer.alloc(size - start);
    await handle.read(buffer, 0, buffer.length, start);
    const lines = buffer.toString("utf8").split("\n");
    if (start > 0) lines.shift(); // cut by the window's edge
    const parts: string[] = [];
    for (const l of lines) {
      if (!l.trim()) continue;
      try {
        const text = messageText(JSON.parse(l));
        if (text) parts.push(text);
      } catch {
        // Not a line of the transcript's own.
      }
    }
    return { text: parts.join("\n"), cut: start > 0 };
  } finally {
    await handle.close();
  }
}

/** The message cut to the protocol's limits in every free-text field it has. */
function fit(m: DrivenMessage): DrivenMessage {
  const out = { ...m } as Record<string, unknown>;
  const limit = (key: string, max: number) => {
    if (typeof out[key] === "string" && (out[key] as string).length > max) out[key] = cutStart(out[key] as string, max).text;
  };
  limit("tool", MAX_TOOL_NAME_LENGTH);
  limit("summary", MAX_SUMMARY_LENGTH);
  limit("room", MAX_ROOM_ID_LENGTH);
  limit("command", MAX_COMMAND_LENGTH);
  limit("folder", MAX_FOLDER_LENGTH);
  limit("detail", MAX_DETAIL_LENGTH);
  limit("note", MAX_DETAIL_LENGTH);
  limit("description", MAX_PROMPT_LENGTH);
  limit("text", m.kind === "reply" ? MAX_REPLY_LENGTH : m.kind === "output" ? MAX_OUTPUT_LENGTH : MAX_DETAIL_LENGTH);
  if (m.kind === "holding") out.sessions = m.sessions.map((s) => ({ ...s, room: cutStart(s.room, MAX_ROOM_ID_LENGTH).text, session: s.session.slice(0, MAX_DRIVEN_SESSION_ID_LENGTH) }));
  return out as DrivenMessage;
}

const driven = { type: "driven", v: PROTOCOL_VERSION } as const;

export function createDriver(o: DriverOptions): Driver {
  const now = o.now ?? Date.now;
  const spawn = o.spawn ?? hiddenSpawn;
  const env = o.env ?? process.env;
  const newId = o.newId ?? randomUUID;
  const platform = o.platform ?? process.platform;
  const offices = new Map(o.offices.map((office) => [office.server, office]));
  const sessions = new Map<string, Session>();
  const withheld = new Map<string, Held>(); // oldest first
  // Office → the projects whose sessions may run in bypassPermissions, from the latest drive-policy on
  // its current connection; none until one arrives on it, and until then nothing is sent to it.
  const policies = new Map<string, Set<string>>();
  const takes = new Map<string, PreparedTake & { server: string; project: string }>();
  const starts = new Set<string>();
  // Office -> what its last `folders` said: the message as sent, and for each project its folders, pathKey -> the folder as listed, and its branches.
  const listed = new Map<string, { said: string; repos: Map<string, { folders: Map<string, string>; branches: Set<string> }> }>();
  let foldersOut = Promise.resolve();
  let foldersCheck: ReturnType<typeof setTimeout> | "arming" | null = null;
  let closed = false;

  function newSession(record: ProcessRecord & { driven: DrivenFields }, fromBefore: boolean): Session {
    return { record, child: null, opening: false, closed: Promise.resolve(), turn: null, output: "", cut: false, outputs: new Map(), ending: null, interrupting: null, naming: false, failure: null, fromBefore, stderr: "", idle: null, idleToken: 0, starting: null, prompts: new Map(), work: Promise.resolve(), out: Promise.resolve() };
  }

  const bypassAllowed = (server: string, project: string) => policies.get(server)?.has(project) === true;
  // A record from before #42 has no `asked`: its person asked for the mode it ran in.
  const askedOf = (s: Session) => s.record.driven.asked ?? s.record.driven.permissions;
  /** The mode the session's process opens in now. */
  const modeFor = (s: Session): DrivePermissions => (askedOf(s) === "bypassPermissions" && bypassAllowed(s.record.driven.office, s.record.driven.project) ? "bypassPermissions" : DRIVEN_PERMISSIONS);

  // Work and messages still to finish, for `settled`.
  let busy = 0;
  const waiting: (() => void)[] = [];
  function count(p: Promise<void>): Promise<void> {
    busy++;
    void p.finally(() => {
      if (--busy === 0) for (const resolve of waiting.splice(0)) resolve();
    });
    return p;
  }

  function sendTo(server: string, m: DrivenMessage): void {
    const office = offices.get(server);
    // Nothing goes on a connection before its first drive-policy: a server from before driven sessions sends none, and closes the link on a `driven` (#58).
    if (!office || !policies.has(server)) return;
    const parsed = DrivenMessageSchema.safeParse(fit(m));
    if (!parsed.success) {
      o.log(`a driven ${m.kind} message wasn't sent, as it doesn't fit the protocol: ${parsed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`);
      return;
    }
    office.send(parsed.data);
  }

  const refuse = (server: string, id: string, reason: DriveRefusalReason, extra: { detail?: string; limit?: number } = {}) =>
    sendTo(server, { ...driven, kind: "refused", id, reason, ...extra } as DrivenMessage);

  // The session's messages go in the order they were made, however long a scan takes.
  function emit(s: Session, make: () => DrivenMessage | null | Promise<DrivenMessage | null>): void {
    const server = s.record.driven.office;
    s.out = count(
      s.out
        .then(async () => {
          const m = await make();
          if (m) sendTo(server, m);
        })
        .catch((err: Error) => o.log(`couldn't send a message of ${s.record.session}: ${err.message}`)),
    );
  }

  function queue(s: Session, run: () => Promise<void>): void {
    s.work = count(s.work.then(run).catch((err: Error) => o.log(`driving ${s.record.session} failed: ${err?.stack ?? String(err)}`)));
  }

  const current = (s: Session) => sessions.get(s.record.session) === s;

  function save(s: Session, patch: Partial<ProcessRecord> = {}): void {
    s.record = { ...s.record, ...patch };
    if (current(s)) o.registry.put(s.record);
  }

  function heldIn(project: string): number {
    let n = 0;
    for (const s of sessions.values()) if ((s.child || s.opening) && s.record.driven.project === project) n++;
    for (const t of takes.values()) if (t.project === project) n++;
    return n;
  }

  // Sessions with no process past MAX_HOLDING are forgotten, the least recently active first.
  function prune(): void {
    const closed = [...sessions.values()].filter((s) => !s.child && !s.opening).sort((a, b) => Date.parse(b.record.lastActivity) - Date.parse(a.record.lastActivity));
    for (const s of closed.slice(Math.max(0, MAX_HOLDING - (sessions.size - closed.length)))) forget(s);
  }

  function forget(s: Session): void {
    clearIdle(s);
    if (s.starting) clearTimeout(s.starting);
    if (!current(s)) return;
    sessions.delete(s.record.session);
    o.registry.remove(s.record.session);
    for (const [id, w] of withheld) if (w.session === s.record.session) withheld.delete(id);
  }

  // Kept as its release sends it: cut to MAX_OUTPUT_LENGTH, so a held output is never the whole transcript's tail.
  function hold({ text, cut = false, ...about }: { session: string; turn?: string; text: string; cut?: boolean }): string {
    const id = `w-${randomUUID()}`;
    const c = cutEnd(text, MAX_OUTPUT_LENGTH);
    withheld.set(id, { ...about, text: c.text, cut: cut || c.cut });
    if (withheld.size > MAX_HELD) withheld.delete(withheld.keys().next().value!);
    return id;
  }

  function clearIdle(s: Session): void {
    s.idleToken++;
    if (s.idle) clearTimeout(s.idle);
    s.idle = null;
  }

  // Counts from now: a process with no turn running, no prompt waiting and nothing from it closes when it runs out.
  function armIdle(s: Session): void {
    clearIdle(s);
    const token = s.idleToken;
    void o.settings().then((st) => {
      if (token !== s.idleToken || !s.child || s.turn || s.prompts.size) return;
      s.idle = setTimeout(() => queue(s, () => closeIdle(s)), st.drivenIdleMinutes * 60000);
      s.idle.unref?.();
    });
  }

  function addOutput(s: Session, text: string): void {
    if (!text) return;
    s.output += text + "\n";
    if (s.output.length > MAX_OUTPUT_LENGTH) {
      s.output = s.output.slice(-MAX_OUTPUT_LENGTH);
      s.cut = true;
    }
  }

  function keepTurn(s: Session, turn: string): void {
    s.outputs.set(turn, { text: s.output, cut: s.cut });
    if (s.outputs.size > TURNS_KEPT) s.outputs.delete(s.outputs.keys().next().value!);
  }

  /** Opens the session's process: null, or why it couldn't. */
  async function open(s: Session, bin?: string | null): Promise<{ reason: "no-claude" | "unavailable"; detail: string } | null> {
    s.opening = true;
    try {
      bin ??= await o.binary();
      if (!bin) return { reason: "no-claude", detail: NO_CLAUDE };
      const d = s.record.driven;
      const uuid = uuidOf(s.record.session);
      // A session that crashed in its first turn has a transcript too. One that had a turn end but
      // whose transcript is gone is resumed all the same, and Claude Code says it can't find it.
      const resume = d.transcript || (await transcriptOf(o.claudeDir, s.record.folder, uuid)) !== null;
      // Decided with no await before the spawn, so a drive-policy can't come between the two.
      const mode = modeFor(s);
      const argv = [...claudeCommand(bin), ...drivenArgs({ uuid, resume, permissions: mode, ...(d.name ? { name: d.name } : {}), ...(d.addDir ? { addDir: d.addDir } : {}) })];
      let child: ChildProcessWithoutNullStreams;
      try {
        child = spawn(argv, { cwd: s.record.folder, env: forkEnv(env) });
      } catch (err) {
        o.log(`couldn't start claude for ${s.record.session} in ${s.record.folder}: ${(err as Error).message}`);
        return { reason: "unavailable", detail: NOT_STARTED };
      }
      wire(s, child);
      const at = iso(now());
      save(s, { pid: child.pid ?? null, spawned: at, state: "idle", lastActivity: at, driven: { ...s.record.driven, permissions: mode } });
      o.log(`opened driven session ${s.record.session} in ${s.record.folder} (process ${child.pid}, permission mode ${mode})`);
      armIdle(s);
      return null;
    } finally {
      s.opening = false;
    }
  }

  function wire(s: Session, child: ChildProcessWithoutNullStreams): void {
    s.child = child;
    s.stderr = "";
    let closed = () => {};
    s.closed = new Promise<void>((resolve) => (closed = resolve));
    let buffer = "";
    child.stdout.setEncoding("utf8").on("data", (piece: string) => {
      buffer += piece;
      let nl;
      while ((nl = buffer.indexOf("\n")) >= 0) {
        const text = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!text) continue;
        let e: Record<string, unknown>;
        try {
          e = JSON.parse(text);
        } catch {
          continue; // Claude Code's own output, not an event
        }
        if (e && typeof e === "object") onEvent(s, child, e);
      }
    });
    child.stderr.setEncoding("utf8").on("data", (piece: string) => (s.stderr = (s.stderr + piece).slice(-STDERR_CHARS)));
    child.stdin.on("error", () => {}); // a process that has gone breaks the pipe; its close says why
    let over = false;
    const end = (code: number | null) => {
      if (over) return;
      over = true;
      closed();
      ended(s, child, code);
    };
    child.on("error", (err) => {
      o.log(`claude for ${s.record.session} failed: ${err.message}`);
      end(null);
    });
    child.on("close", (code) => end(code));
  }

  function onEvent(s: Session, child: ChildProcessWithoutNullStreams, e: Record<string, unknown>): void {
    if (s.child !== child) return;
    if (s.starting) clearTimeout(s.starting);
    s.starting = null;
    s.record.lastActivity = iso(now());
    o.registry.touch(s.record.session, now());
    // A prompt is answered whenever it comes, a subagent's and one outside a turn too, or the turn would hang on it.
    if (e.type === "control_request") return ask(s, child, e);
    if (e.type === "control_cancel_request") {
      const w = [...s.prompts.values()].find((p) => p.request === e.request_id);
      if (w) endPrompt(s, w, "cancelled");
      return;
    }
    const turn = s.turn;
    if (!turn) {
      armIdle(s);
      return;
    }
    if (e.parent_tool_use_id) return;
    if (e.type === "assistant" || e.type === "user") {
      addOutput(s, messageText(e));
      if (e.type !== "assistant") return;
      const content = (e.message as { content?: unknown } | undefined)?.content;
      for (const block of Array.isArray(content) ? (content as Record<string, unknown>[]) : []) {
        if (block?.type !== "tool_use") continue;
        const tool = typeof block.name === "string" && block.name ? block.name : "tool";
        const summary = summaryOf(block.input);
        emit(s, async () => {
          // A tool's name can be anyone's words (an MCP server names its own), so it is scanned with the summary.
          if (await o.scan(summary === undefined ? tool : `${tool} ${summary}`)) return { ...driven, kind: "tool", session: s.record.session, turn, tool: "tool", withheld: true };
          return { ...driven, kind: "tool", session: s.record.session, turn, tool, ...(summary !== undefined ? { summary } : {}) };
        });
      }
    } else if (e.type === "system" && e.subtype === "permission_denied") {
      // Claude Code's own denial, with no prompt for it: a deny rule in the settings (the probe above),
      // or, not probed, maybe auto mode's own safety check. The words cover both.
      const tool = typeof e.tool_name === "string" && e.tool_name ? e.tool_name : "a tool";
      addOutput(s, `(${tool} wasn't allowed by Claude Code on this computer)`);
      const said = (name: string) => `The agent wanted to use ${name}, but Claude Code on this computer didn't allow it (its permission rules, or its own safety check), so it wasn't used.`;
      emit(s, async () => ({ ...driven, kind: "error", session: s.record.session, turn, text: (await o.scan(said(tool))) ? said("a tool") : said(tool) }));
    } else if (e.type === "result" && ((typeof e.num_turns === "number" && e.num_turns >= 1) || e.is_error === true || typeof e.local_command === "string")) {
      // A Claude Code command (`/cost`) is answered with num_turns 0 and `local_command`: see the probe above.
      endTurn(s, turn, e);
    }
    // Any other result, with no turn in it, is a leftover background task replayed (claude.ts): the turn goes on.
  }

  // A permission prompt from Claude Code: to the floor under the runner's own id, denied when nobody answers in time.
  function ask(s: Session, child: ChildProcessWithoutNullStreams, e: Record<string, unknown>): void {
    const request = e.request as Record<string, unknown> | undefined;
    // With its stdin closed (a hand-back), Claude Code gives it up at once: nobody could answer it.
    if (typeof e.request_id !== "string" || child.stdin.writableEnded) return;
    if (request?.subtype !== "can_use_tool") {
      // None came in the probes (the runner sends no `initialize`), but Claude Code may wait on one as
      // it does on a prompt, so it gets the error the Agent SDK gives a request it doesn't support.
      const subtype = typeof request?.subtype === "string" ? request.subtype.slice(0, 60) : "(none)";
      child.stdin.write(JSON.stringify({ type: "control_response", response: { subtype: "error", request_id: e.request_id, error: UNSUPPORTED_TO_CLAUDE } }) + "\n");
      o.log(`answered Claude Code's request of subtype ${subtype} in ${s.record.session} with an error: only permission prompts are answered`);
      return;
    }
    const tool = typeof request.tool_name === "string" && request.tool_name ? request.tool_name : "tool";
    const w: Waiting = { id: `p-${randomUUID()}`, request: e.request_id, child, turn: s.turn, input: request.input, message: null, timer: null };
    s.prompts.set(w.id, w);
    clearIdle(s);
    const session = s.record.session;
    const waiting = () => s.prompts.get(w.id) === w;
    // Its time counts from when it goes, in order with the session's other messages.
    emit(s, async () => {
      if (!waiting()) return null;
      const ms = (await o.settings()).drivenPromptMinutes * 60000;
      const expires = now() + ms;
      w.timer = setTimeout(() => endPrompt(s, w, "timed-out"), ms);
      w.timer.unref?.();
      const description = promptDescription(tool, request.input);
      // A tool's name can be anyone's words (an MCP server names its own), so it is scanned too.
      const toolHeld = (await o.scan(tool)) !== null;
      const descriptionHeld = (await o.scan(description)) !== null;
      if (!waiting()) return null;
      if (toolHeld || descriptionHeld) o.log(`withheld what permission prompt ${w.id} of ${session} asks: it matches a secret pattern`);
      w.message = {
        ...driven,
        kind: "prompt",
        session,
        ...(w.turn ? { turn: w.turn } : {}),
        prompt: w.id,
        tool: toolHeld ? "tool" : tool,
        description: descriptionHeld ? PROMPT_WITHHELD : description,
        ...(toolHeld || descriptionHeld ? { withheld: true as const } : {}),
        expires: iso(expires),
      };
      return w.message;
    });
  }

  // Ends a waiting prompt once: Claude Code gets the answer (none for a cancel, which it no longer waits on), and the floor `prompt-ended`.
  function endPrompt(s: Session, w: Waiting, outcome: "allowed" | "denied" | "timed-out" | "cancelled", id?: string): void {
    if (s.prompts.get(w.id) !== w) return;
    s.prompts.delete(w.id);
    if (w.timer) clearTimeout(w.timer);
    if (outcome !== "cancelled" && s.child === w.child && !w.child.stdin.writableEnded) {
      const response = outcome === "allowed" ? { behavior: "allow", updatedInput: w.input } : { behavior: "deny", message: outcome === "denied" ? DENIED_TO_CLAUDE : TIMED_OUT_TO_CLAUDE };
      w.child.stdin.write(JSON.stringify({ type: "control_response", response: { subtype: "success", request_id: w.request, response } }) + "\n");
    }
    o.log(`permission prompt ${w.id} of ${s.record.session} ended: ${outcome}`);
    const session = s.record.session;
    // One that never went has nothing to end on the floor.
    emit(s, () => (w.message ? { ...driven, kind: "prompt-ended", session, prompt: w.id, outcome, ...(id ? { id } : {}) } : null));
    if (s.child && !s.turn && !s.prompts.size) armIdle(s);
  }

  const endPrompts = (s: Session) => {
    for (const w of [...s.prompts.values()]) endPrompt(s, w, "cancelled");
  };

  function answer(s: Session, id: string, prompt: string, said: "allow" | "deny"): void {
    const w = s.prompts.get(prompt);
    if (!w) return refuse(s.record.driven.office, id, "no-prompt", { detail: NO_PROMPT });
    endPrompt(s, w, said === "allow" ? "allowed" : "denied", id);
  }

  function endTurn(s: Session, turn: string, e: Record<string, unknown>): void {
    s.turn = null;
    keepTurn(s, turn);
    const failed = e.is_error === true || e.subtype !== "success";
    // Claude Code ends an interrupted turn as an error (see the probe above): it was stopped, not failed.
    const interrupted = s.interrupting === turn && failed;
    s.interrupting = null;
    if (interrupted) {
      emit(s, () => ({ ...driven, kind: "turn-ended", session: s.record.session, turn, outcome: "stopped" }));
      save(s, { state: "idle", driven: { ...s.record.driven, transcript: true } });
      armIdle(s);
      return;
    }
    const missing = Array.isArray(e.errors) && e.errors.some((x) => typeof x === "string" && x.includes("No conversation found"));
    const session = s.record.session;
    if (missing) s.failure = MISSING;
    else if (failed) {
      const kind = typeof e.subtype === "string" && /^[a-z_]+$/.test(e.subtype) ? ` (${e.subtype})` : "";
      emit(s, () => ({ ...driven, kind: "error", session, turn, text: `Claude Code stopped this instruction with an error${kind}.` }));
    }
    const text = !failed && typeof e.result === "string" ? e.result.trim() : "";
    if (text) {
      emit(s, async () => {
        const matched = await o.scan(text);
        if (matched) {
          o.log(`withheld the reply to ${turn} in ${session}: it matches the secret pattern "${matched}"`);
          return { ...driven, kind: "reply", session, turn, text: WITHHELD, withheld: { id: hold({ session, turn, text }) } };
        }
        const c = cutStart(text, MAX_REPLY_LENGTH);
        return { ...driven, kind: "reply", session, turn, text: c.text, ...(c.cut ? { cut: true as const } : {}) };
      });
    }
    emit(s, () => ({ ...driven, kind: "turn-ended", session, turn, outcome: failed ? "failed" : "done" }));
    save(s, { state: "idle", driven: { ...s.record.driven, transcript: s.record.driven.transcript || !missing } });
    armIdle(s);
  }

  function ended(s: Session, child: ChildProcessWithoutNullStreams, code: number | null): void {
    if (s.child !== child) return;
    s.child = null;
    clearIdle(s);
    if (s.starting) clearTimeout(s.starting);
    s.starting = null;
    endPrompts(s);
    const turn = s.turn;
    s.turn = null;
    s.interrupting = null;
    if (turn) keepTurn(s, turn);
    const session = s.record.session;
    const why = s.ending;
    s.record = { ...s.record, pid: null, spawned: null, state: "closed" };
    if (why) {
      if (turn) emit(s, () => ({ ...driven, kind: "turn-ended", session, turn, outcome: "stopped" }));
      save(s);
      return;
    }
    const missing = s.failure === MISSING || /No conversation found/i.test(s.stderr);
    const said = missing ? MISSING : (s.failure ?? "Claude Code stopped running for this session unexpectedly. Send another instruction to start it again.");
    s.failure = null;
    o.log(`the process of driven session ${session} ended by itself${code === null ? "" : ` with code ${code}`}${s.stderr.trim() ? `: ${s.stderr.trim().split("\n").slice(-3).join(" ")}` : ""}`);
    emit(s, () => ({ ...driven, kind: "error", session, ...(turn ? { turn } : {}), text: said }));
    if (turn) emit(s, () => ({ ...driven, kind: "turn-ended", session, turn, outcome: "failed" }));
    emit(s, () => ({ ...driven, kind: "released", session, why: "crashed" }));
    if (missing) forget(s);
    else save(s);
  }

  async function within(p: Promise<void>, ms: number): Promise<boolean> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const done = await Promise.race([p.then(() => true), new Promise<boolean>((r) => (timer = setTimeout(() => r(false), ms)))]);
    clearTimeout(timer);
    return done;
  }

  // Closes stdin and gives the process drivenCloseSeconds to finish by itself, then ends it.
  async function closeGently(s: Session): Promise<void> {
    const st = await o.settings();
    const child = s.child;
    if (!child) return;
    child.stdin.end();
    // Claude Code gives up a prompt it waits on as its stdin closes (see the probe above).
    endPrompts(s);
    if (await within(s.closed, st.drivenCloseSeconds * 1000)) return;
    o.log(`driven session ${s.record.session} didn't end within ${st.drivenCloseSeconds} s of being closed, so its process was ended`);
    if (s.child === child) killTree(child, platform);
    await within(s.closed, KILL_WAIT_MS);
  }

  async function beginTurn(s: Session, turn: string, text: string): Promise<void> {
    const st = await o.settings();
    const child = s.child;
    if (!child) return;
    clearIdle(s);
    s.turn = turn;
    s.interrupting = null;
    s.output = "";
    s.cut = false;
    s.failure = null;
    addOutput(s, `> ${text}`);
    s.starting = setTimeout(() => {
      if (s.child !== child || s.turn !== turn) return;
      o.log(`driven session ${s.record.session} wrote nothing within ${st.drivenStartSeconds} s of instruction ${turn}, so its process was ended`);
      s.failure = `Claude Code didn't start on the instruction within ${st.drivenStartSeconds} seconds, so it was stopped. Send the instruction again to retry.`;
      killTree(child, platform);
    }, st.drivenStartSeconds * 1000);
    s.starting.unref?.();
    save(s, { state: "working", lastActivity: iso(now()) });
    emit(s, () => ({ ...driven, kind: "turn-started", session: s.record.session, turn }));
    child.stdin.write(userTurn(text));
  }

  async function start(server: string, m: Extract<DriveMessage, { kind: "start" }>): Promise<void> {
    if (starts.has(m.id)) {
      o.log(`start ${m.id} was handled already, so it isn't run again`);
      return;
    }
    starts.add(m.id);
    if (starts.size > STARTS_KEPT) starts.delete(starts.values().next().value!);
    const project = m.project.id.toLowerCase();
    // Opened anywhere but the floor, it isn't the runner's to hold: its permissions are Claude Code's own, as a take's are.
    const elsewhere = m.mode !== undefined && m.mode !== "driven" ? m.mode : null;
    if (!elsewhere && m.permissions === "bypassPermissions" && !bypassAllowed(server, project)) return refuse(server, m.id, "bypass-off", { detail: BYPASS_OFF });
    const bin = await o.binary();
    if (!bin) return refuse(server, m.id, "no-claude", { detail: NO_CLAUDE });
    const office = offices.get(server)!;
    let folder: string | null;
    if (m.folder !== undefined) {
      // Only a folder this runner listed for the project, still in its repo, spelled as listed: never the server's path unchecked.
      const repo = listed.get(server)?.repos.get(project);
      const own = repo?.folders.get(pathKey(m.folder));
      folder = own !== undefined && (await office.home(own).catch(() => null)) === project ? own : null;
      if (!folder) return refuse(server, m.id, "no-folder", { detail: NOT_LISTED });
      if (m.branch !== undefined && !repo!.branches.has(m.branch)) return refuse(server, m.id, "no-folder", { detail: BRANCH_NOT_LISTED });
      if (elsewhere) return startElsewhere(server, m, elsewhere, folder, bin);
      if (m.branch !== undefined) {
        // A start the cap refuses now makes no worktree. One made for a start refused later (the cap
        // reached meanwhile, or the session not opening) is kept, and the next start on that branch reuses it.
        const cap = capOf(await o.settings());
        if (heldIn(project) >= cap) return refuse(server, m.id, "cap-reached", { limit: cap, detail: capReached(cap) });
        const made = await office.branchFolder(folder, m.branch).catch((err: Error) => ({ error: err?.stack ?? String(err) }));
        if (typeof made !== "string") {
          o.log(`start ${m.id}: no folder for branch ${m.branch} of ${folder}: ${made.error}`);
          return refuse(server, m.id, "unavailable", { detail: NO_WORKTREE });
        }
        folder = made;
      }
    } else {
      folder = await office.folder(m.roomSessions ?? []);
      if (!folder) return refuse(server, m.id, "no-folder", { detail: NO_FOLDER });
    }
    const st = await o.settings();
    const cap = capOf(st);
    // Checked and taken with no await between, so two starts can't both take the last place.
    if (heldIn(project) >= cap) return refuse(server, m.id, "cap-reached", { limit: cap, detail: capReached(cap) });
    const at = iso(now());
    const session = `claude-code:${newId()}`;
    // A start in a folder opens a new room: the session's own, as the server gives a session that says hello alone.
    const room = m.room ?? `room:${session}`;
    const s = newSession(
      { kind: "driven", pid: null, spawned: null, session, folder, started: at, lastActivity: at, state: "closed", driven: { room, project, office: server, owner: m.by.id, permissions: DRIVEN_PERMISSIONS, asked: m.permissions, transcript: false } },
      false,
    );
    s.opening = true;
    sessions.set(s.record.session, s);
    queue(s, async () => {
      const problem = await open(s, bin);
      if (problem) {
        forget(s);
        return refuse(server, m.id, problem.reason, { detail: problem.detail });
      }
      prune();
      const { permissions } = s.record.driven;
      emit(s, () => ({ ...driven, kind: "started", id: m.id, session: s.record.session, room, permissions }));
      emit(s, () => ({ ...driven, kind: "held", session: s.record.session, room, why: "started", permissions }));
      // A drive-policy that came after the check above.
      sayPromptsOn(s);
      if (m.instruction) {
        await beginTurn(s, m.id, m.instruction);
        nameLater(s, m.instruction);
      }
    });
  }

  // A start that opens outside the floor (#85), in the folder checked above: answered `opened`, in a
  // room of its own, or refused `unavailable` with why, through the secret scan. Not held here, so
  // not under the cap: its data layer reports it, as any session its person opened.
  async function startElsewhere(server: string, m: Extract<DriveMessage, { kind: "start" }>, mode: StartMode, folder: string, bin: string): Promise<void> {
    if (!o.elsewhere || m.instruction === undefined) return refuse(server, m.id, "unavailable", { detail: NOT_ELSEWHERE });
    const uuid = newId();
    const r = await o.elsewhere({ id: m.id, mode, folder, ...(m.branch !== undefined ? { branch: m.branch } : {}), instruction: m.instruction, session: uuid }, bin);
    if (r.problem) o.log(`start ${m.id} (${mode}): ${r.problem}`);
    const said = r.problem && (await o.scan(r.problem)) ? PROBLEM_WITHHELD : r.problem;
    if (!r.opened) return refuse(server, m.id, "unavailable", { detail: said ?? NOT_STARTED });
    const session = `claude-code:${uuid}`;
    sendTo(server, { ...driven, kind: "opened", id: m.id, session, room: `room:${session}`, mode, ...(said ? { note: said } : {}) });
  }

  async function instruct(s: Session, id: string, text: string): Promise<void> {
    const server = s.record.driven.office;
    if (!current(s)) return refuse(server, id, "not-found");
    if (s.turn) return refuse(server, id, "busy", { detail: BUSY });
    // Its bypassPermissions was withdrawn, but its process couldn't be ended: it is tried again, and takes nothing meanwhile.
    if (s.child && s.record.driven.permissions === "bypassPermissions" && policies.has(server) && modeFor(s) !== "bypassPermissions") {
      queue(s, () => closeForPolicy(s));
      return refuse(server, id, "unavailable", { detail: BYPASS_STILL_RUNNING });
    }
    if (!s.child) {
      const cap = capOf(await o.settings());
      if (heldIn(s.record.driven.project) >= cap) return refuse(server, id, "cap-reached", { limit: cap, detail: capReached(cap) });
      const why = s.fromBefore ? "restored" : "reopened";
      const problem = await open(s);
      if (problem) return refuse(server, id, problem.reason, { detail: problem.detail });
      s.fromBefore = false;
      const { room, permissions } = s.record.driven;
      emit(s, () => ({ ...driven, kind: "held", session: s.record.session, room, why, permissions }));
      sayPromptsOn(s);
    }
    await beginTurn(s, id, text);
    nameLater(s, text);
  }

  // A session with no name gets one from its first instruction, once, off its turn; a take keeps its own.
  function nameLater(s: Session, instruction: string): void {
    if (!o.namer || s.naming || s.record.driven.name) return;
    s.naming = true;
    const namer = o.namer;
    const session = s.record.session;
    void count(
      (async () => {
        const name = await namer.name(instruction);
        if (!name) return;
        const matched = await o.scan(name);
        if (matched) return o.log(`the name written for driven session ${session} wasn't used: it matches the secret pattern "${matched}"`);
        if (!current(s)) return;
        save(s, { driven: { ...s.record.driven, name, named: true } });
        o.log(`named driven session ${session}`);
      })().catch((err: Error) => o.log(`naming driven session ${session} failed: ${err?.stack ?? String(err)}`)),
    );
  }

  // Stops the reply in progress, keeping the process: its turn ends `stopped` once Claude Code says it has. Idle, nothing.
  function interrupt(s: Session): void {
    const child = s.child;
    const turn = s.turn;
    if (!child || !turn || s.interrupting === turn || child.stdin.writableEnded) return;
    s.interrupting = turn;
    child.stdin.write(JSON.stringify({ type: "control_request", request_id: `i-${randomUUID()}`, request: { subtype: "interrupt" } }) + "\n");
    o.log(`interrupted instruction ${turn} in driven session ${s.record.session}`);
  }

  // A session asked to skip permission prompts that opened with them on says why.
  function sayPromptsOn(s: Session): void {
    if (askedOf(s) === "bypassPermissions" && s.record.driven.permissions !== "bypassPermissions") emit(s, () => ({ ...driven, kind: "error", session: s.record.session, text: PROMPTS_ON }));
  }

  // Ends a process running in bypassPermissions that its office's drive-policy no longer allows, at once, as a stop does.
  async function closeForPolicy(s: Session): Promise<void> {
    const child = s.child;
    if (!current(s) || !child || s.record.driven.permissions !== "bypassPermissions" || modeFor(s) === "bypassPermissions") return;
    s.ending = "stopped";
    killTree(child, platform);
    await within(s.closed, KILL_WAIT_MS);
    s.ending = null;
    if (s.child === child) {
      o.log(`driven session ${s.record.session}'s process ${child.pid} didn't end when skipping permission prompts was turned off for its project, so it is still held`);
      return;
    }
    o.log(`closed driven session ${s.record.session}: skipping permission prompts was turned off for its project`);
    emit(s, () => ({ ...driven, kind: "error", session: s.record.session, text: BYPASS_TURNED_OFF }));
    emit(s, () => ({ ...driven, kind: "released", session: s.record.session, why: "stopped" }));
  }

  // Ends the session's process tree at once, if it has one: false when it is still running after KILL_WAIT_MS.
  async function endProcess(s: Session, how: string): Promise<boolean> {
    const child = s.child;
    if (!child) return true;
    s.ending = "stopped";
    killTree(child, platform);
    await within(s.closed, KILL_WAIT_MS);
    s.ending = null;
    if (s.child !== child) return true;
    // Still running: the session stays held, so nothing says it was let go.
    o.log(`driven session ${s.record.session}'s process ${child.pid} didn't end when ${how}, so it is still held`);
    return false;
  }

  // Released `removed` and forgotten, so it is never opened again; holding goes without it, and its reporting ends.
  async function remove(s: Session, id?: string): Promise<void> {
    const session = s.record.session;
    const server = s.record.driven.office;
    emit(s, () => ({ ...driven, kind: "released", session, why: "removed", ...(id ? { id } : {}) }));
    forget(s);
    await s.out;
    if (policies.has(server)) sayHolding(server);
    await o.removed?.(session).catch((err: Error) => o.log(`couldn't stop reporting ${session}: ${err?.message ?? String(err)}`));
    o.log(`ended and removed driven session ${session}: it won't be opened again`);
  }

  async function stop(s: Session, id: string, removing: boolean): Promise<void> {
    if (!current(s)) return refuse(s.record.driven.office, id, "not-found");
    if (!(await endProcess(s, "stopped"))) return refuse(s.record.driven.office, id, "unavailable", { detail: NOT_CLOSED });
    if (removing) return remove(s, id);
    emit(s, () => ({ ...driven, kind: "released", session: s.record.session, why: "stopped", id }));
    o.log(`ended driven session ${s.record.session} from the floor: the next instruction opens it again`);
  }

  async function end(s: Session, removing: boolean): Promise<boolean> {
    if (!current(s)) return false;
    const had = !!s.child;
    if (!(await endProcess(s, "closed from this computer"))) return false;
    if (removing) {
      await remove(s);
      return true;
    }
    if (had) emit(s, () => ({ ...driven, kind: "released", session: s.record.session, why: "stopped" }));
    o.log(`ended driven session ${s.record.session} from this computer: the next instruction opens it again`);
    return true;
  }

  async function handBack(s: Session, id: string): Promise<void> {
    if (!current(s)) return refuse(s.record.driven.office, id, "not-found");
    const child = s.child;
    if (child) {
      s.ending = "handed-back";
      await closeGently(s);
      s.ending = null;
      // Still running: resuming it in a terminal would make two writers, so it stays held here.
      if (s.child === child) {
        o.log(`driven session ${s.record.session}'s process ${child.pid} didn't end when handed back, so it is still held`);
        return refuse(s.record.driven.office, id, "unavailable", { detail: NOT_CLOSED });
      }
    }
    const session = s.record.session;
    emit(s, () => ({ ...driven, kind: "released", session, why: "handed-back", id }));
    emit(s, () => ({ ...driven, kind: "handed-back", id, session, command: `claude --resume ${uuidOf(session)}`, folder: s.record.folder }));
    o.log(`handed driven session ${session} back to its person, in ${s.record.folder}`);
    forget(s);
  }

  async function closeIdle(s: Session): Promise<void> {
    if (!current(s) || !s.child || s.turn || s.prompts.size || s.ending) return;
    s.ending = "idle-closed";
    await closeGently(s);
    s.ending = null;
    o.log(`closed driven session ${s.record.session}: nothing happened in it for a while`);
    emit(s, () => ({ ...driven, kind: "released", session: s.record.session, why: "idle-closed" }));
  }

  async function output(s: Session, id: string, turn: string | undefined): Promise<void> {
    const server = s.record.driven.office;
    const session = s.record.session;
    let found: { text: string; cut: boolean };
    if (turn !== undefined) {
      const kept = s.turn === turn ? { text: s.output, cut: s.cut } : s.outputs.get(turn);
      if (!kept) return refuse(server, id, "unavailable", { detail: TURN_GONE });
      found = kept;
    } else {
      const file = await transcriptOf(o.claudeDir, s.record.folder, uuidOf(session));
      found = file ? await transcriptText(file).catch(() => ({ text: "", cut: false })) : { text: "", cut: false };
    }
    const text = found.text.trim();
    emit(s, async () => {
      const matched = text ? await o.scan(text) : null;
      if (matched) {
        o.log(`withheld the output of ${turn ?? "the whole session"} in ${session}: it matches the secret pattern "${matched}"`);
        return { ...driven, kind: "output", id, session, ...(turn !== undefined ? { turn } : {}), text: WITHHELD, withheld: { id: hold({ session, ...(turn !== undefined ? { turn } : {}), text, cut: found.cut }) } };
      }
      const c = cutEnd(text, MAX_OUTPUT_LENGTH);
      return { ...driven, kind: "output", id, session, ...(turn !== undefined ? { turn } : {}), text: c.text, ...(c.cut || found.cut ? { cut: true as const } : {}) };
    });
  }

  function release(s: Session, id: string, withheldId: string): void {
    const w = withheld.get(withheldId);
    if (!w || w.session !== s.record.session) return refuse(s.record.driven.office, id, "not-found", { detail: RELEASE_GONE });
    withheld.delete(withheldId);
    emit(s, () => ({ ...driven, kind: "output", id, session: w.session, ...(w.turn !== undefined ? { turn: w.turn } : {}), text: w.text, ...(w.cut ? { cut: true as const } : {}) }));
  }

  // Where each of the office's sessions stands, then the prompts still waiting, on a connection whose first drive-policy has come.
  function sayHolding(server: string): void {
    const ofOffice = [...sessions.values()].filter((s) => s.record.driven.office === server);
    // One with no process says the mode it would open in now.
    const list = ofOffice
      .sort((a, b) => Number(!!b.child) - Number(!!a.child) || Date.parse(b.record.lastActivity) - Date.parse(a.record.lastActivity))
      .slice(0, MAX_HOLDING)
      .map((s) => ({ session: s.record.session, room: s.record.driven.room, held: !!s.child, permissions: s.child ? s.record.driven.permissions : modeFor(s), ...(s.turn ? { turn: s.turn } : {}) }));
    sendTo(server, { ...driven, kind: "holding", sessions: list });
    // Unchanged, so the floor can still answer one raised while the link was down, or before the server restarted.
    for (const s of ofOffice) for (const w of s.prompts.values()) if (w.message) sendTo(server, w.message);
  }

  // The folders a new session can start in, to the office: on a connection's first drive-policy
  // (`again`), and otherwise only when they changed. One at a time, so they go in order.
  function sayFolders(server: string, again: boolean): void {
    foldersOut = count(
      foldersOut
        .then(async () => {
          const office = offices.get(server);
          if (!office || !policies.has(server)) return;
          const repos = await office.repoFolders();
          if (!policies.has(server)) return;
          const said = JSON.stringify(repos);
          if (!again && listed.get(server)?.said === said) return;
          listed.set(server, { said, repos: new Map(repos.map((r) => [r.project, { folders: new Map(r.folders.map((f) => [pathKey(f), f])), branches: new Set(r.branches ?? []) }])) });
          sendTo(server, { ...driven, kind: "folders", repos });
        })
        .catch((err: Error) => o.log(`couldn't list the folders new sessions can start in for ${server}: ${err?.stack ?? String(err)}`)),
    );
  }

  // Checks the folders again every repoFoldersCheckMinutes, or branchRefreshMinutes when sooner, while any office's connection has had its first drive-policy.
  function checkFoldersLater(): void {
    if (foldersCheck || closed) return;
    foldersCheck = "arming";
    void o.settings().then(
      (st) => {
        if (closed) return;
        foldersCheck = setTimeout(() => {
          foldersCheck = null;
          for (const server of policies.keys()) sayFolders(server, false);
          // Armed again only once this round's listings are done, so a slow one never piles up checks.
          void foldersOut.then(() => {
            if (policies.size) checkFoldersLater();
          });
        }, Math.min(st.repoFoldersCheckMinutes, st.branchRefreshMinutes) * 60000);
        foldersCheck.unref?.();
      },
      () => (foldersCheck = null),
    );
  }

  // The driven sessions an earlier run left, with no process now (registry.restore ended theirs).
  for (const r of o.registry.list()) if (r.kind === "driven" && r.driven) sessions.set(r.session, newSession(r as Session["record"], true));
  prune();

  return {
    take(server, m) {
      if (!offices.has(server)) return;
      if (m.type === "drive-policy") {
        const allowed = new Set(m.bypassAllowed.map((p) => p.toLowerCase()));
        const first = !policies.has(server);
        policies.set(server, allowed);
        if (first) {
          sayHolding(server);
          sayFolders(server, true);
          checkFoldersLater();
        }
        for (const s of sessions.values()) {
          const d = s.record.driven;
          if (d.office === server && s.child && d.permissions === "bypassPermissions" && !allowed.has(d.project)) queue(s, () => closeForPolicy(s));
        }
        return;
      }
      if (m.by.id !== o.account.id) return refuse(server, m.id, "not-owner");
      if (m.kind === "install-claude" || m.kind === "sign-in-claude") return o.setup ? o.setup(m) : refuse(server, m.id, "unavailable", { detail: "This runner can't install Claude Code." });
      if (m.kind === "start") {
        void start(server, m).catch((err: Error) => (o.log(`start ${m.id} failed: ${err?.stack ?? String(err)}`), refuse(server, m.id, "unavailable", { detail: NOT_STARTED })));
        return;
      }
      const s = sessions.get(m.session);
      if (!s || s.record.driven.office !== server) return refuse(server, m.id, "not-found");
      if (s.record.driven.owner !== m.by.id) return refuse(server, m.id, "not-owner");
      if (m.kind === "instruct") queue(s, () => instruct(s, m.id, m.text));
      else if (m.kind === "stop") queue(s, () => stop(s, m.id, m.remove === true));
      else if (m.kind === "interrupt") interrupt(s);
      else if (m.kind === "hand-back") queue(s, () => handBack(s, m.id));
      else if (m.kind === "output") void output(s, m.id, m.turn).catch((err: Error) => o.log(`output ${m.id} failed: ${err.message}`));
      else if (m.kind === "release") release(s, m.id, m.withheld);
      else answer(s, m.id, m.prompt, m.answer);
    },
    linked(server) {
      // A new connection: its drive-policy is still to come, and nothing driven goes until it has.
      policies.delete(server);
    },
    unlinked(server) {
      policies.delete(server);
    },
    say(m) {
      for (const server of offices.keys()) sendTo(server, m);
    },
    held: () => [...sessions.values()].filter((s) => s.child || s.opening).length,
    end(session, removing = false) {
      const s = sessions.get(session);
      if (!s) return Promise.resolve(false);
      return new Promise((resolve) => queue(s, () => end(s, removing).then(resolve, (err) => (resolve(false), Promise.reject(err)))));
    },
    takeProblem: (by) => (by?.id === o.account.id ? null : NOT_YOURS_TAKE),
    async prepareTake(server, take) {
      const project = ((await o.projectOf(take.folder).catch(() => null)) ?? take.folder).toLowerCase();
      const cap = capOf(await o.settings());
      if (heldIn(project) >= cap) return capReached(cap);
      takes.set(take.session, { ...take, server, project });
      if (takes.size > TAKES_KEPT) takes.delete(takes.keys().next().value!);
      return null;
    },
    taken(uuid, opens) {
      const t = takes.get(uuid);
      if (!t) return;
      takes.delete(uuid);
      if (!opens) {
        o.log(`driven take ${uuid} won't open: the server dropped it, it was given up, or its taken wasn't sent`);
        return;
      }
      const at = iso(now());
      const s = newSession(
        {
          kind: "driven",
          pid: null,
          spawned: null,
          session: `claude-code:${uuid}`,
          folder: t.folder,
          started: at,
          lastActivity: at,
          state: "closed",
          driven: { room: t.room, project: t.project, office: t.server, owner: t.by.id, permissions: DRIVEN_PERMISSIONS, asked: t.permissions, transcript: false, addDir: t.addDir, name: t.name },
        },
        false,
      );
      s.opening = true;
      sessions.set(s.record.session, s);
      queue(s, async () => {
        const problem = await open(s);
        if (problem) {
          emit(s, () => ({ ...driven, kind: "error", session: s.record.session, text: problem.detail }));
          emit(s, () => ({ ...driven, kind: "released", session: s.record.session, why: "crashed" }));
          forget(s);
          return;
        }
        prune();
        const { permissions } = s.record.driven;
        emit(s, () => ({ ...driven, kind: "held", session: s.record.session, room: t.room, why: "started", permissions }));
        sayPromptsOn(s);
        await beginTurn(s, uuid, t.prompt);
      });
    },
    close() {
      closed = true;
      if (foldersCheck && foldersCheck !== "arming") clearTimeout(foldersCheck);
      for (const s of sessions.values()) {
        if (!s.child) continue;
        s.ending = "stopped";
        killTree(s.child, platform);
      }
      o.registry.closeSync();
    },
    settled: () => (busy === 0 ? Promise.resolve() : new Promise<void>((resolve) => waiting.push(resolve))),
  };
}
