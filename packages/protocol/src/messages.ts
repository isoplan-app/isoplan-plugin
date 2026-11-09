import { z } from "zod";
import { FactRemoveSchema, FactsSchema, FactUpsertSchema, ProjectSchema, SourceSchema } from "./facts.js";

/**
 * The protocol version every message carries as `v`. Adding optional fields doesn't change it;
 * changing what a field means, or removing one, does.
 */
export const PROTOCOL_VERSION = 1;

const Version = z.literal(PROTOCOL_VERSION);
const Seq = z.number().int().nonnegative();

const Account = z.object({ id: z.string().min(1), name: z.string() });
const Machine = z.object({ name: z.string().min(1) });

/** Matches a request with its reply or refusal. */
const RequestId = z.string().min(1);

/** A handoff's id. It names the handoff's branch, `isoplan/handoff/<id>`, so it keeps to safe characters. */
const HandoffId = z
  .string()
  .max(64)
  .regex(/^[a-z0-9][a-z0-9-]*$/, "lowercase letters, digits and dashes");

/**
 * Whether a path segment is one Windows reads as `.git`: the name before any NTFS stream
 * (`.git::$INDEX_ALLOCATION`), its trailing dots and spaces dropped, in any case, or the 8.3 short
 * name of a folder that starts with `.git`.
 */
export const isGitFolder = (segment: string) => {
  const name = segment.split(":")[0]!.replace(/[. ]+$/, "").toLowerCase();
  return name === ".git" || /^git~\d+$/.test(name);
};

/**
 * One repo a handoff pushed: its path in the session's folder (`.` for the folder itself), remote,
 * branch and commit. A handoff drives git on the receiver's machine, so the path stays inside the
 * folder, out of any `.git` folder (in any spelling Windows reads as one: `.GIT.`, `.git `, `GIT~1`),
 * with no `:` (an NTFS stream, such as `.git::$INDEX_ALLOCATION`), and the remote can't name a transport helper such as `ext::`, which runs a command.
 */
export const HandoffRepoSchema = z.object({
  path: z
    .string()
    .min(1)
    .refine((path) => !/^([\\/]|[A-Za-z]:)/.test(path), "a path relative to the session's folder")
    .refine((path) => !path.split(/[\\/]/).includes(".."), "a path inside the session's folder, with no `..`")
    .refine((path) => !path.startsWith("-"), "a path that doesn't start with `-`, which git would read as an option")
    .refine((path) => !path.split(/[\\/]/).some(isGitFolder), "a path that isn't in a `.git` folder")
    .refine((path) => !path.includes(":"), "a path with no `:`, which Windows reads as a drive or a file's stream")
    .refine((path) => path === "." || !path.split(/[\\/]/).some((part) => part === "" || part === "." || part === ".."), "`.` itself, or a path of named folders, with no empty, `.` or `..` part"),
  remote: z
    .string()
    .min(1)
    .refine((remote) => !/^[A-Za-z0-9+.-]+::/.test(remote), "a remote with no transport helper (`<transport>::`)")
    .refine((remote) => !remote.startsWith("-"), "a remote that doesn't start with `-`, which git would read as an option"),
  branch: z.string().min(1),
  commit: z.string().regex(/^([0-9a-f]{40}|[0-9a-f]{64})$/, "a full commit hash"),
});

/** The longest task a handoff of its own task (a spin-off) carries (protocol 0.10.0). */
export const MAX_TASK_LENGTH = 4000;

/** A spin-off's task: what the new session is to do, as the person handing over typed it. */
const Task = z.string().trim().min(1).max(MAX_TASK_LENGTH);

/**
 * What the receiver gets: the brief, and every repo pushed for it, each on the handoff's own branch,
 * `isoplan/handoff/<id>`. Repos that push to the same remote can't share one, so each after the
 * first has `isoplan/handoff/<id>--<its path, as lowercase letters, digits and dashes>`.
 * `task` (protocol 0.10.0): the handoff is a spin-off, a new task of its own for the new session,
 * and the brief is written for that task; without it, the new session carries on this work.
 */
export const HandoffSchema = z
  .object({
    id: HandoffId,
    brief: z.string().min(1),
    repos: z.array(HandoffRepoSchema).min(1),
    task: Task.optional(),
  })
  .superRefine((handoff, context) => {
    handoff.repos.forEach((repo, i) => {
      const own = `isoplan/handoff/${handoff.id}`;
      if (repo.branch !== own && !(repo.branch.startsWith(`${own}--`) && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(repo.branch.slice(own.length + 2)))) {
        context.addIssue({ code: "custom", path: ["repos", i, "branch"], message: `the handoff's branch, isoplan/handoff/${handoff.id} or isoplan/handoff/${handoff.id}--<slug>` });
      }
    });
  });

/**
 * The machine's access token from pairing, which an office server that signs people in requires.
 * It refuses a hello without one as `not-paired`, an expired or unknown one as `token-expired`, one
 * whose pairing was revoked or has lapsed as `pairing-ended`, and one for a session another paired
 * machine reports as `forged-hello`. A server that signs nobody in ignores it.
 */
const Token = z.string().min(1).max(200).optional();

// Driven sessions (protocol 0.5.0): a Claude Code session the runner runs on its person's machine,
// which that person drives from the floor: starts, instructs, reads, answers its permission prompts,
// stops and hands back to their terminal (isoplan-app docs/designs/web-session-view.md). The server
// sends `drive` requests and `drive-policy`; the runner sends `driven` messages. Only the session's
// owner acts on it: the server checks, and every `drive` request names who is acting (`by`) so the
// runner checks again.

/** The longest instruction a person may send a driven session, a start's first one included. */
export const MAX_INSTRUCTION_LENGTH = 20000;
/** The longest agent reply a `driven` reply carries; a longer one is cut to fit and marked `cut`. */
export const MAX_REPLY_LENGTH = 20000;
/** The longest full output a `driven` output carries; a longer one is cut to fit and marked `cut`. */
export const MAX_OUTPUT_LENGTH = 200000;
/** The longest summary of what a tool use was for. */
export const MAX_SUMMARY_LENGTH = 500;
/** The longest description of what a permission prompt asks to do. */
export const MAX_PROMPT_LENGTH = 2000;
/** The longest error text or refusal detail. */
export const MAX_DETAIL_LENGTH = 1000;
/** The longest id of a drive request, an instruction, a prompt or a withheld text. */
export const MAX_DRIVE_ID_LENGTH = 100;
/** The longest driven session id. */
export const MAX_DRIVEN_SESSION_ID_LENGTH = 200;
/** The longest room id. */
export const MAX_ROOM_ID_LENGTH = 200;
/** The longest tool name, as Claude Code or an MCP server names it (`mcp__<server>__<tool>`). */
export const MAX_TOOL_NAME_LENGTH = 100;
/** The longest command a `handed-back` gives to continue the session in a terminal. */
export const MAX_COMMAND_LENGTH = 500;
/** The longest folder a `handed-back`, a `folders` or a start names. */
export const MAX_FOLDER_LENGTH = 4096;
/** The most folders a `folders` message lists for one repo. */
export const MAX_REPO_FOLDERS = 5;
/** The most repos a `folders` message lists. */
export const MAX_FOLDER_REPOS = 100;
/** The most remote branches a `folders` message lists for one repo (protocol 0.9.0). */
export const MAX_REPO_BRANCHES = 100;
/** The longest branch name a `folders` or a start names. */
export const MAX_BRANCH_LENGTH = 255;
/** The most room sessions a start names. */
export const MAX_ROOM_SESSIONS = 20;
/** The most driven sessions a `holding` message lists. */
export const MAX_HOLDING = 200;

/** The longest sign-in link a `driven` `claude` carries. */
export const MAX_SIGN_IN_URL_LENGTH = 4000;

/**
 * Claude Code for the terminal on the runner's machine (protocol 0.7.0, #180), as the runner finds
 * it the way it finds it for driven sessions: `ready`, found and signed in, or found with a sign-in
 * `claude auth status` couldn't say; `signed-out`, found, and `claude auth status` says it isn't
 * signed in; `missing`, no claude binary found.
 */
export const ClaudeCliSchema = z.enum(["ready", "signed-out", "missing"]);

/** A drive request's, an instruction's, a prompt's or a withheld text's id. */
const DriveId = z.string().min(1).max(MAX_DRIVE_ID_LENGTH);
/** A driven session, by its id as its facts name it (`claude-code:<uuid>`). */
const DrivenSessionId = z.string().min(1).max(MAX_DRIVEN_SESSION_ID_LENGTH);
/** A room on the floor, by the server's id for it. */
const Room = z.string().min(1).max(MAX_ROOM_ID_LENGTH);
const Instruction = z.string().trim().min(1).max(MAX_INSTRUCTION_LENGTH);
const ToolName = z.string().min(1).max(MAX_TOOL_NAME_LENGTH);
const Detail = z.string().min(1).max(MAX_DETAIL_LENGTH);
/** A folder on the runner's machine, as the runner names it. */
const Folder = z.string().min(1).max(MAX_FOLDER_LENGTH);
/** A branch on a repo's remote, by its name under `refs/heads/`. */
const BranchName = z.string().min(1).max(MAX_BRANCH_LENGTH);
/** The text was longer than its field's limit, so the runner cut it to fit. */
const Cut = z.literal(true).optional();
/** The secret scan matched the text: it only says so, and its owner can release it by this id (drive `release`). */
const Withheld = z.object({ id: DriveId }).optional();

/**
 * The permission mode a driven session runs in: Claude Code's `auto`, the default, or
 * `bypassPermissions`, which skips its permission prompts, for a person who opted in, and only in a
 * project whose office allows it (`drive-policy`).
 */
export const DrivePermissionsSchema = z.enum(["auto", "bypassPermissions"]);

/** Where a new session from the floor opens other than run from the floor (protocol 0.10.0): a start's `mode`, as a take's. */
export const StartModeSchema = z.enum(["terminal", "headless", "orca", "desktop"]);

// Data layer → office server.

/** The first message on a connection: who is reporting, from where, about which session. */
export const HelloMessageSchema = z.object({
  type: z.literal("hello"),
  v: Version,
  source: SourceSchema,
  account: Account,
  machine: Machine,
  session: z.string().min(1),
  project: ProjectSchema,
  token: Token,
});

/**
 * The first message on a runner's link: the one link per machine that answers requests for its rooms.
 * `orca`: Orca's CLI is on this machine, so a handoff can be taken into Orca (mode `orca`).
 * `desktop` (protocol 0.4.0): Claude Code for the terminal, new enough to hand a session to the Claude
 * app, is on this machine, a Mac or Windows x64, so a handoff can be opened in the Claude app (mode `desktop`).
 * `drive` (protocol 0.5.0): this runner drives sessions from the floor: it takes `drive` requests and
 * `drive-policy`, sends `driven` messages, and takes a handoff as a driven session (mode `driven`). The
 * server sends none of these to a runner that didn't say it. A machine with no claude binary still says
 * it, and refuses each start `no-claude`.
 * `claude` (protocol 0.7.0, #180): Claude Code for the terminal on this machine (ClaudeCli), which
 * driven sessions, a take into a terminal and a headless one all need. A runner that says it says it
 * on every hello, says `driven` `claude` whenever it changes, and takes the `install-claude` and
 * `sign-in-claude` drive requests; the server sends neither to a runner that didn't say it.
 * `starts` (protocol 0.10.0, isoplan-plugin#85): the places other than the floor a new session from
 * the floor can open in on this machine, the start's `mode`: `terminal` and `headless` where this
 * runner can open them, and `orca` and `desktop` only where `orca` and `desktop` are said. The server
 * sends a start with a `mode` only to a runner that says `starts`, and only one of its places: a
 * runner from before 0.10.0 drops the field it doesn't know and would run the session from the floor.
 */
export const RunnerHelloMessageSchema = z.object({
  type: z.literal("runner"),
  v: Version,
  account: Account,
  machine: Machine,
  token: Token,
  orca: z.boolean().optional(),
  desktop: z.boolean().optional(),
  drive: z.boolean().optional(),
  claude: ClaudeCliSchema.optional(),
  starts: z.array(StartModeSchema).max(4).optional(),
});

/** All of the session's facts. Sent on connect and on repair. */
export const FullMessageSchema = z.object({
  type: z.literal("full"),
  v: Version,
  seq: Seq,
  facts: FactsSchema,
});

/** What changed since the last message. `seq` goes up by one per message, so a gap shows. */
export const ChangesMessageSchema = z.object({
  type: z.literal("changes"),
  v: Version,
  seq: Seq,
  upsert: FactUpsertSchema,
  remove: FactRemoveSchema,
});

/** The longest message an owner sends their open session from the floor (protocol 0.8.0 on). */
export const MAX_OWNER_MESSAGE_LENGTH = 20000;

/**
 * Why an owner-message didn't reach its session (protocol 0.8.0 on), on its `unavailable` refusal:
 * `not-owner`, it came from someone other than the session's owner; `detached`, the session is seen
 * only through the wake hook, with no plugin in it to pass the message on; `no-submit`, its Claude
 * Code build can't take a message from a plugin; `ended`, the session has ended or moved on (a
 * /clear); `dropped`, Claude Code didn't let the message in (a hook or its own limits); `no-answer`,
 * the plugin in the session never said whether it took the message (the session may have closed).
 */
export const OwnerMessageRefusalSchema = z.enum(["not-owner", "detached", "no-submit", "ended", "dropped", "no-answer"]);

/** A cap on the answers a machine gives: a room's per hour, the owner's per day, or the owner's tokens per day. */
export const CapSchema = z.enum(["room-hour", "owner-day", "owner-tokens"]);

/** The answer to a request, carrying the request's id and kind. */
export const ReplyMessageSchema = z.discriminatedUnion("kind", [
  z.object({ type: z.literal("reply"), v: Version, id: RequestId, kind: z.literal("answer-question"), answer: z.string().min(1) }),
  // `fallback`: the fork couldn't write the brief, so `brief` is only the runner's note of what was
  // pushed, and the server writes the rest from the room's feed. The branch is pushed either way.
  // `cap`: the cap that stopped the fork running, when that is why, named as in an over-cap refusal.
  // `noClaude` (protocol 0.4.0): the fork couldn't run because the machine has no claude binary.
  z.object({ type: z.literal("reply"), v: Version, id: RequestId, kind: z.literal("write-brief"), handoff: HandoffSchema, fallback: z.literal(true).optional(), cap: CapSchema.optional(), noClaude: z.literal(true).optional() }),
  // The owner's answer reached the question that was waiting for it. `closed`: the session never said
  // whether it took the answer, but the question has closed, by this answer or the terminal's. `late`:
  // it took the answer after this request was refused for taking too long, so this reply follows that
  // refusal, with the same id.
  z.object({ type: z.literal("reply"), v: Version, id: RequestId, kind: z.literal("owner-answer"), closed: z.literal(true).optional(), late: z.literal(true).optional() }),
  // The owner's message went into their session as a turn of its own (protocol 0.8.0 on). With
  // `queued`, it hasn't gone in yet: the session accepted it to run after the running turn.
  z.object({ type: z.literal("reply"), v: Version, id: RequestId, kind: z.literal("owner-message"), queued: z.literal(true).optional() }),
  // The handoff's session is in front in Orca now (protocol 0.3.8); one that couldn't be is refused `unavailable`.
  z.object({ type: z.literal("reply"), v: Version, id: RequestId, kind: z.literal("focus") }),
]);

/**
 * A request the machine won't answer, sent in place of its reply. `over-cap` names the cap it would
 * go over. `withheld` means the secret scan matched; the reply follows if the owner releases it.
 * `unavailable` is anything else that stops the room answering now, such as its checkout being gone,
 * its lead being mid-turn or a push being rejected.
 */
export const RefusalMessageSchema = z.discriminatedUnion("reason", [
  z.object({
    type: z.literal("refusal"),
    v: Version,
    id: RequestId,
    reason: z.literal("over-cap"),
    cap: CapSchema,
  }),
  // `file`: what was withheld is the handoff's commit, whose added lines in that file matched (the
  // pattern itself stays on the machine); without it, the brief or answer. With several matches, or
  // several repos (#56), it names every such file by its path in the session's folder, joined by ", ".
  // `held`: how many files `file` names, as a path may itself hold ", " (protocol 0.3.5 on).
  // `unchecked`: files the commit adds that the scan can't read (binary), named so the owner knows.
  z.object({
    type: z.literal("refusal"),
    v: Version,
    id: RequestId,
    reason: z.literal("withheld"),
    file: z.string().min(1).optional(),
    held: z.number().int().positive().optional(),
    unchecked: z.array(z.string().min(1)).optional(),
  }),
  // `code` (protocol 0.8.0 on): on an owner-message's refusal, why, for the floor to tell apart.
  z.object({ type: z.literal("refusal"), v: Version, id: RequestId, reason: z.literal("unavailable"), detail: z.string().min(1), code: OwnerMessageRefusalSchema.optional() }),
]);

/**
 * The sender's session handed its room over with the command: its agent wrote the brief and pushed.
 * `to` is the receiver as the sender named them, for the server to find in the office.
 */
export const HandOverMessageSchema = z.object({
  type: z.literal("hand-over"),
  v: Version,
  to: z.string().min(1),
  handoff: HandoffSchema,
});

/**
 * The sender's session asks, before it pushes, whether a hand-over with this id to `to` would be
 * taken: the server answers hand-over-ready, or an error saying why not. `task` (protocol 0.10.0):
 * the hand-over will be a spin-off with this task, the same as its handoff's `task`.
 */
export const HandOverCheckMessageSchema = z.object({
  type: z.literal("hand-over-check"),
  v: Version,
  to: z.string().min(1),
  handoff: HandoffId,
  task: Task.optional(),
});

/** The receiver's session asks for the handoff a take code stands for. */
export const TakeMessageSchema = z.object({
  type: z.literal("take"),
  v: Version,
  code: z.string().min(1),
});

/**
 * The receiver took the handoff and joins its room. Each step that failed is listed with the repo it
 * was for and the end of its output; a failed setup step doesn't stop the session opening. From a runner, `session` is the
 * session it opened, which joins the room; without one no session opened (no clone to work in, or
 * no terminal), so the handoff is still there to take. From a session, the session itself joins.
 * `clone` is a missing repo under the folder whose git clone failed.
 */
export const TakenMessageSchema = z.object({
  type: z.literal("taken"),
  v: Version,
  handoff: HandoffId,
  session: z.string().min(1).optional(),
  failures: z.array(
    z.object({
      step: z.enum(["worktree", "clone", "setup", "checkout", "open"]),
      repo: z.string().min(1).optional(),
      output: z.string(),
    }),
  ),
});

/** The longest question a session may ask the room. */
export const MAX_QUESTION_LENGTH = 4000;

/**
 * The receiver's session asks the room it was handed a question (#49), on its own short link with
 * the session's hello: the room's lead, on its owner's machine, answers it. The server answers
 * `asked`, or an error (`ask-refused`) when the session may not ask. `key`, the asking side's own id
 * for this ask, makes a retry of it the same question rather than a second one.
 */
export const AskRoomMessageSchema = z.object({
  type: z.literal("ask-room"),
  v: Version,
  question: z.string().trim().min(1).max(MAX_QUESTION_LENGTH),
  key: z.string().min(1).max(100).optional(),
});

/** The asking session polls a question it asked: the server answers `asked`. */
export const AskCheckMessageSchema = z.object({
  type: z.literal("ask-check"),
  v: Version,
  question: RequestId,
});

/**
 * The asking session's agent was shown how a question ended (answered or dropped): the server stops
 * sending it again.
 */
export const AskedAckMessageSchema = z.object({
  type: z.literal("asked-ack"),
  v: Version,
  question: RequestId,
});

const driven = { type: z.literal("driven"), v: Version };

/**
 * Why a runner won't do what a `drive` request asked, sent in place of its answer (protocol 0.5.0).
 * `not-owner`: the acting person isn't the session's owner, this runner's person. `not-found`: this
 * machine has no driven session by that id that it would act on, or, for a release, holds nothing
 * withheld under that id (it was dropped, or the runner restarted since). `bypass-off`: the start asked for
 * `bypassPermissions` in a project whose office doesn't allow it (`drive-policy`). `no-folder`: this
 * machine has no folder for the room's project, or a start named a folder it didn't list in `folders` for that project, or that is no longer in it, or a branch it didn't list for it. `no-claude`: it has no claude binary. `busy`: the
 * session can't take this now, such as while a turn runs, or an install or sign-in of Claude Code runs already. `no-prompt`: an answer names a prompt the
 * session isn't waiting on (never raised by this runner, answered already, timed out or cancelled).
 * `cap-reached`: the project already has `limit` driven sessions running on this machine.
 * `unavailable` is anything else, saying what in `detail`. A runner never refuses `offline`: that is
 * the server's own (FloorDriveRefusalReason).
 */
const DrivenRefusedSchema = z.discriminatedUnion("reason", [
  z.object({
    ...driven,
    kind: z.literal("refused"),
    id: DriveId,
    reason: z.enum(["not-owner", "not-found", "bypass-off", "no-folder", "no-claude", "busy", "no-prompt"]),
    detail: Detail.optional(),
  }),
  z.object({ ...driven, kind: z.literal("refused"), id: DriveId, reason: z.literal("cap-reached"), limit: z.number().int().positive(), detail: Detail.optional() }),
  z.object({ ...driven, kind: z.literal("refused"), id: DriveId, reason: z.literal("unavailable"), detail: Detail }),
]);

/**
 * What a runner says of the driven sessions it holds (protocol 0.5.0), sent only by a runner that said
 * `drive`. `started`, `output` (for an output request or a release) and `handed-back` answer a `drive`
 * request by its `id`, and `refused` is sent in place of any answer; the rest are the sessions' own
 * events, in the order they happened. A turn is named by the instruction that started it (`turn`): a
 * start's first instruction by the start's `id`, and a driven take's first turn by the handoff
 * message's `session`, the bare uuid. A driven take is answered by `taken`, as every take is (its
 * failures say why no session opened), and then by `held` with why `started`. A turn that ends with no
 * reply text sends no `reply`.
 *
 * Every `driven` message is live-only: it goes only while the runner's link is up and never waits in
 * the link's reply outbox, so a long turn can't push the replies to the server's requests out of it,
 * and a prompt that has timed out isn't shown again. The runner sends none on a connection until the
 * server's first `drive-policy` on it has come, so a server from before driven sessions, which sends
 * no drive-policy, is never sent one. With that first drive-policy, `holding` says where each session
 * stands, and right after it the runner sends `prompt` again for each prompt still waiting, with the
 * same `prompt` id and `expires`, so one raised while the link was down, or before the server
 * restarted, can still be answered. A later drive-policy on the same connection sends neither again.
 *
 * The runner keeps every field within its limit (the MAX_* constants), cutting what it doesn't pick
 * itself, such as a tool name, to fit: the server refuses a message over any limit and closes the
 * runner's link.
 *
 * Nothing from a session leaves the machine without the runner's secret scan. A reply or output it
 * matched has a `text` that only says so, and `withheld.id` for the owner to release it (drive
 * `release`); a tool summary it matched isn't sent, and a prompt description it matched only says so,
 * both marked `withheld`.
 */
export const DrivenMessageSchema = z.discriminatedUnion("kind", [
  // The session a start asked for is running, in `room`; `permissions` is the mode it runs in.
  z.object({ ...driven, kind: z.literal("started"), id: DriveId, session: DrivenSessionId, room: Room, permissions: DrivePermissionsSchema }),
  // The agent took the instruction `turn`.
  z.object({ ...driven, kind: z.literal("turn-started"), session: DrivenSessionId, turn: DriveId }),
  // The agent used a tool in the turn: its name, and a short summary of what for, which one the scan
  // matched (`withheld`) doesn't carry.
  z
    .object({ ...driven, kind: z.literal("tool"), session: DrivenSessionId, turn: DriveId, tool: ToolName, summary: z.string().min(1).max(MAX_SUMMARY_LENGTH).optional(), withheld: z.literal(true).optional() })
    .superRefine((message, context) => {
      if (message.withheld && message.summary !== undefined) context.addIssue({ code: "custom", path: ["summary"], message: "no summary when the secret scan withheld it" });
    }),
  // The agent's own reply to the turn's instruction, what it said as the turn ended.
  z.object({ ...driven, kind: z.literal("reply"), session: DrivenSessionId, turn: DriveId, text: z.string().min(1).max(MAX_REPLY_LENGTH), cut: Cut, withheld: Withheld }),
  // The turn is over: `done`; `failed`, when Claude Code said it failed or its process ended mid-turn;
  // or `stopped`, when the session was stopped or handed back mid-turn.
  z.object({ ...driven, kind: z.literal("turn-ended"), session: DrivenSessionId, turn: DriveId, outcome: z.enum(["done", "failed", "stopped"]) }),
  // A start with a `mode` other than `driven` opened its session there (protocol 0.10.0): `session`,
  // in a room of its own, `room:<session>`. The runner doesn't hold it: it is reported as any session
  // the person opened, by its own data layer. `note`: what still needs the person, in the runner's own
  // words, such as a session the Claude app didn't open by itself.
  z.object({ ...driven, kind: z.literal("opened"), id: DriveId, session: DrivenSessionId, room: Room, mode: StartModeSchema, note: Detail.optional() }),
  // Something went wrong in the session, in the runner's own words: never the model's output.
  z.object({ ...driven, kind: z.literal("error"), session: DrivenSessionId, turn: DriveId.optional(), text: Detail }),
  // The full output asked for, as plain text: of `turn`, or of the whole session without one; empty
  // when there was none. In answer to a release, under the release's `id`: the released text, with
  // `turn` for a reply.
  z.object({ ...driven, kind: z.literal("output"), id: DriveId, session: DrivenSessionId, turn: DriveId.optional(), text: z.string().max(MAX_OUTPUT_LENGTH), cut: Cut, withheld: Withheld }),
  // The session asks permission for a tool use (`--permission-prompts host`), under the runner's own
  // `prompt` id, which an answer must name. With no answer by `expires` the runner denies it.
  z.object({ ...driven, kind: z.literal("prompt"), session: DrivenSessionId, turn: DriveId.optional(), prompt: DriveId, tool: ToolName, description: z.string().min(1).max(MAX_PROMPT_LENGTH), withheld: z.literal(true).optional(), expires: z.iso.datetime({ offset: true }) }),
  // How a prompt ended. `id`: the answer request that ended it, when one did.
  z.object({ ...driven, kind: z.literal("prompt-ended"), session: DrivenSessionId, prompt: DriveId, outcome: z.enum(["allowed", "denied", "timed-out", "cancelled"]), id: DriveId.optional() }),
  // A process of the runner's holds the session now, so resuming it in a terminal as well would make
  // two writers: just `started`, `reopened` for an instruction after it was closed, or `restored`
  // after the runner itself restarted.
  z.object({ ...driven, kind: z.literal("held"), session: DrivenSessionId, room: Room, why: z.enum(["started", "reopened", "restored"]), permissions: DrivePermissionsSchema }),
  // No process holds the session now: `stopped`, `handed-back`, `idle-closed` (nothing happened in it
  // for the runner's idle time) or `crashed`. `id`: the stop or hand-back request it answers, if any.
  z.object({ ...driven, kind: z.literal("released"), session: DrivenSessionId, why: z.enum(["stopped", "handed-back", "idle-closed", "crashed"]), id: DriveId.optional() }),
  // The session is back in its person's hands: `command` (`claude --resume <id>`) continues it in a
  // terminal opened in `folder`, a path on the runner's machine.
  z.object({ ...driven, kind: z.literal("handed-back"), id: DriveId, session: DrivenSessionId, command: z.string().min(1).max(MAX_COMMAND_LENGTH), folder: Folder }),
  DrivenRefusedSchema,
  // Claude Code for the terminal here (protocol 0.7.0, #180), sent to every office whenever it
  // changes: as the runner finds it again, and through an `install-claude` or `sign-in-claude`, whose
  // messages carry that request's `id`. `doing`: the install or sign-in running now; one with no
  // `doing` and an `id` is the request's last. `progress`: the installer's latest line, through the
  // secret scan. `url`: the sign-in page `claude auth login` opened in the browser on this machine,
  // for the floor to offer if no browser came up. `failed`: why the request ended without Claude
  // Code ready, in the runner's own words.
  z.object({
    ...driven,
    kind: z.literal("claude"),
    claude: ClaudeCliSchema,
    doing: z.enum(["installing", "signing-in"]).optional(),
    progress: Detail.optional(),
    url: z.url({ protocol: /^https$/ }).max(MAX_SIGN_IN_URL_LENGTH).optional(),
    failed: Detail.optional(),
    id: DriveId.optional(),
  }),
  // Sent once per connection, after its first drive-policy: the driven sessions the runner holds, or
  // would reopen for an instruction, at most MAX_HOLDING of them, held ones first, then the most
  // recently active. `held`: a process holds it now. `turn`: the turn running now, if any. The server
  // takes it in place of what it knew of this runner's driven sessions and forgets any it doesn't
  // list, so the floor's held state survives a reconnect. Right after it the runner sends `prompt`
  // again for each prompt still waiting.
  z.object({
    ...driven,
    kind: z.literal("holding"),
    sessions: z
      .array(z.object({ session: DrivenSessionId, room: Room, held: z.boolean(), permissions: DrivePermissionsSchema, turn: DriveId.optional() }))
      .max(MAX_HOLDING),
  }),
  // Where on this machine a new session can start, for a start with a `folder` (#67): for each repo
  // the office takes, by its project id, lower-cased, the folders a Claude Code session here ran in
  // that a session there reports as that repo (its checkout, or a folder above several repos, under
  // the first the office takes), still there, the most recently used first, at most MAX_REPO_FOLDERS of them,
  // for at most MAX_FOLDER_REPOS repos. A repo with none isn't listed. Sent with each connection's
  // first drive-policy, after `holding`, and again whenever it changes; each one replaces the
  // last. Every folder has passed the secret scan: one it matched, or one too long to send, is left
  // out. Only these are folders a start may name.
  // From protocol 0.9.0 (isoplan-plugin#84) a runner lists each repo once, by its main checkout, and
  // with `branches`: the branches on the remote the project id comes from (`git ls-remote --heads`),
  // by name, at most MAX_REPO_BRANCHES, each passed by the secret scan. Absent when the runner is older,
  // the repo has no remote or isn't a git checkout, or its remote couldn't be reached; empty when the
  // remote has no branches. It is
  // also sent unasked every few minutes when the list changed. Only these are branches a start may name.
  z.object({
    ...driven,
    kind: z.literal("folders"),
    repos: z
      .array(z.object({ project: z.string().min(1), folders: z.array(Folder).min(1).max(MAX_REPO_FOLDERS), branches: z.array(BranchName).max(MAX_REPO_BRANCHES).optional() }))
      .max(MAX_FOLDER_REPOS),
  }),
]);

export const DataLayerMessageSchema = z.discriminatedUnion("type", [
  HelloMessageSchema,
  RunnerHelloMessageSchema,
  FullMessageSchema,
  ChangesMessageSchema,
  ReplyMessageSchema,
  RefusalMessageSchema,
  HandOverMessageSchema,
  HandOverCheckMessageSchema,
  TakeMessageSchema,
  TakenMessageSchema,
  AskRoomMessageSchema,
  AskCheckMessageSchema,
  AskedAckMessageSchema,
  DrivenMessageSchema,
]);

// Office server → data layer.

/** Asks the data layer to send its facts in full. */
export const RepairMessageSchema = z.object({
  type: z.literal("repair"),
  v: Version,
  reason: z.string().optional(),
});

/** A note for the later editor of `file`, which the data layer adds to `agent`'s next tool result. */
export const ConflictMessageSchema = z.object({
  type: z.literal("conflict"),
  v: Version,
  agent: z.string().min(1),
  file: z.string().min(1),
  text: z.string().min(1),
});

/**
 * Sent after a hello is let in, by a server that reads where an edit or command lands (#74): the
 * projects of the session's office it may report work in, lower-cased: every one with a remote, and
 * of those with none (`local:`), only the hello's own machine's. A data layer reports a file,
 * command or worktree outside the session's own project only for one of these, and one that hasn't
 * had a welcome on its connection keeps them on the machine, as an older server would read them as
 * the session's own.
 */
export const WelcomeMessageSchema = z.object({
  type: z.literal("welcome"),
  v: Version,
  projects: z.array(z.string().min(1)),
});

/** Something the data layer should show. */
export const ErrorMessageSchema = z.object({
  type: z.literal("error"),
  v: Version,
  code: z.string().min(1),
  message: z.string(),
});

/**
 * Something for the machine to answer, with a reply or a refusal carrying the same id. `session` is
 * the session it concerns: the lead whose fork answers or writes the brief, or the session whose
 * agent asked its owner. `room` is the room the caps count against.
 */
export const RequestMessageSchema = z.discriminatedUnion("kind", [
  // Someone the room was handed to asks it a question.
  z.object({
    type: z.literal("request"),
    v: Version,
    id: RequestId,
    kind: z.literal("answer-question"),
    session: z.string().min(1),
    room: z.string().min(1),
    from: Account,
    question: z.string().min(1),
  }),
  // The sender handed the room over from the floor: write the brief and push, for this handoff.
  // `task` (protocol 0.10.0): a spin-off, so the brief is written for that task. The reply's handoff
  // doesn't repeat it: the server has it.
  z.object({
    type: z.literal("request"),
    v: Version,
    id: RequestId,
    kind: z.literal("write-brief"),
    session: z.string().min(1),
    room: z.string().min(1),
    handoff: HandoffId,
    to: Account,
    task: Task.optional(),
  }),
  // The owner answered their agent's question from the floor. `question` is the question fact's id,
  // and `answers` maps each question's text to its answer. `annotations` (protocol 0.11.0 on), keyed
  // by question text as `answers` is: the owner's notes on each answer, and the preview of the option
  // they chose, as Claude Code's own dialog gives them. `chat` (protocol 0.11.1 on): the owner chose
  // "Chat about this" instead of answering, which ends the call as Claude Code's own dialog does, with
  // the agent told the owner wants to clarify the questions; `answers` is then empty.
  z.object({
    type: z.literal("request"),
    v: Version,
    id: RequestId,
    kind: z.literal("owner-answer"),
    session: z.string().min(1),
    question: z.string().min(1),
    answers: z.record(z.string(), z.string()),
    annotations: z.record(z.string(), z.object({ notes: z.string().optional(), preview: z.string().optional() })).optional(),
    chat: z.literal(true).optional(),
  }),
  // The owner sends their session a message from the floor (protocol 0.8.0 on), sent only for a
  // session whose fact says `takesMessages`: the plugin in that session submits `text` as the owner's
  // own turn, or queues it behind the running one. `from` is the person sending, whom the data layer
  // checks is the session's owner (its hello's account), and refuses `not-owner` otherwise.
  z.object({
    type: z.literal("request"),
    v: Version,
    id: RequestId,
    kind: z.literal("owner-message"),
    session: z.string().min(1),
    from: Account,
    text: z.string().trim().min(1).max(MAX_OWNER_MESSAGE_LENGTH),
  }),
  // The receiver clicked Focus this session on the floor (protocol 0.3.8): the runner of the machine
  // that took this handoff into Orca brings its session to the front there.
  z.object({
    type: z.literal("request"),
    v: Version,
    id: RequestId,
    kind: z.literal("focus"),
    handoff: HandoffId,
  }),
]);

/**
 * The request is over (its handoff was cancelled, dismissed or replaced): the machine drops what it
 * holds for it, and doesn't send or push what it was still writing. From protocol 0.4.0 `id` may be
 * a take's session id, to a runner taking a handoff from the floor that was cancelled or timed out:
 * the take opens nothing more (a take into the Claude app doesn't open the app).
 */
export const DropMessageSchema = z.object({
  type: z.literal("drop"),
  v: Version,
  id: RequestId,
});

/**
 * The owner released what the secret scan withheld, so the machine sends it now. On the runner's
 * link `id` is the request whose reply was withheld; on a session's link it is the withheld
 * report's `withheld.id`, and only that exact report is released.
 */
export const ReleaseMessageSchema = z.object({
  type: z.literal("release"),
  v: Version,
  id: RequestId,
});

/**
 * A handoff for the receiver to take: sent to their runner when they take it from the floor, or to
 * their session in answer to a take code.
 */
export const HandoffMessageSchema = z
  .object({
    type: z.literal("handoff"),
    v: Version,
    handoff: HandoffSchema,
    // To a runner: how to open the session (a terminal, by default, headless, with no window, in Orca,
    // sent only to a runner that said `orca`, in the Claude app, sent only to a runner that said
    // `desktop`, or, from protocol 0.5.0, as a session driven from the floor, sent only to a runner that
    // said `drive`), and the session id to open it under, which is the one the server will let join the room.
    mode: z.enum(["terminal", "headless", "orca", "desktop", "driven"]).optional(),
    session: z.string().uuid().optional(),
    // With mode `driven`, and then all required: the person taking it, whom the runner checks is its
    // own person, as for a drive request; the room it joins; and the permission mode they asked for.
    by: Account.optional(),
    room: Room.optional(),
    permissions: DrivePermissionsSchema.optional(),
  })
  .superRefine((message, context) => {
    if (message.mode !== "driven") return;
    for (const key of ["session", "by", "room", "permissions"] as const) {
      if (message[key] === undefined) context.addIssue({ code: "custom", path: [key], message: "required for a take as a driven session" });
    }
  });

/** A hand-over-check passed: `to` is the receiver the server found for the name given. */
export const HandOverReadyMessageSchema = z.object({
  type: z.literal("hand-over-ready"),
  v: Version,
  handoff: HandoffId,
  to: Account,
});

/** The sender's hand-over reached the room: `to` is the receiver the server found for the name given. */
export const HandedOverMessageSchema = z.object({
  type: z.literal("handed-over"),
  v: Version,
  handoff: HandoffId,
  to: Account,
});

/**
 * Where a question asked of the room stands (#49), sent in answer to ask-room and ask-check, and
 * down the asking session's own link when an answer arrives after it stopped polling. `queued`: the
 * owner's machine can't answer now (it is off, its runner is away, a cap is reached, or the fork
 * couldn't answer), and it is asked again later; `note` says why. `asking`: the owner's runner is
 * answering. `withheld`: the answer matched a secret pattern on the owner's machine, which keeps it
 * until they release it. `answered`, with `answer`. `dropped`: it won't be answered (the owner
 * turned asking off, the handoff was dismissed, or it ran out of tries or time); `note` says why.
 * `text` is the question as it was asked, `owner` the name of the person whose session answers, and
 * `key` the ask's own key.
 * An answered or dropped question is sent again down the session's own link until it is acked.
 */
export const AskedMessageSchema = z.object({
  type: z.literal("asked"),
  v: Version,
  question: RequestId,
  text: z.string().min(1),
  state: z.enum(["queued", "asking", "withheld", "answered", "dropped"]),
  answer: z.string().min(1).optional(),
  note: z.string().min(1).optional(),
  owner: z.string().optional(),
  /** The `key` the question was asked under, so the asking side knows which of its asks it was. */
  key: z.string().min(1).max(100).optional(),
});

/**
 * Whether this session may ask `room` now (#49), sent down its own link when it connects in a room
 * that was handed to its person, and whenever that changes: a take grants it, and the owner can
 * turn it off and on again.
 */
export const AskRightsMessageSchema = z.object({
  type: z.literal("ask-rights"),
  v: Version,
  room: z.string().min(1),
  owner: Account,
  granted: z.boolean(),
});

const drive = { type: z.literal("drive"), v: Version, id: DriveId, by: Account };

/**
 * A person acting on a driven session from the floor (protocol 0.5.0), sent only to a runner that said
 * `drive`, and only to the owner's own runner. `by` is the person acting, whom the runner checks is its
 * own person, and refuses `not-owner` otherwise. The runner answers by `id` (see `driven`). Nothing is
 * queued: the server refuses a request for a runner that isn't linked at once (`offline`, see
 * FloorDriveRefusalReason).
 */
export const DriveMessageSchema = z.discriminatedUnion("kind", [
  // Start a driven session for `room`, a room of `project` that `by` is in. It opens in the folder of
  // the first of `roomSessions` (the room's sessions on this machine, newest first) that the runner
  // reports, by its own record of that folder, or else in a checkout of `project` it finds, as a take
  // does. `instruction`, the first, is the turn named by this request's id. `permissions` is the mode
  // the person asked for; the runner runs `bypassPermissions` only where `drive-policy` allows it.
  // Or, with `folder` and no `room` or `roomSessions` (#67): a fresh session in a new room, in one of
  // the folders the runner's last `folders` listed for `project`, with nothing from any room passed
  // in. Its room is its own, `room:<session>`, the one a session that says hello alone is given,
  // which `started`, `held` and `holding` name. A folder it didn't list for that project, or that is no longer in it, is refused `no-folder`.
  // With `branch` too (protocol 0.9.0, only with `folder`): one of the `branches` the runner listed
  // for that repo. The branch the folder is on opens the folder; another opens in a git worktree of
  // that branch beside it, so the folder's own branch is never switched. A branch it didn't list is
  // refused `no-folder`. A runner from before 0.9.0 ignores `branch` and opens the folder as it is.
  // With `mode` (protocol 0.10.0, only with `folder` and `instruction`, and only to a runner whose
  // hello says it in `starts`): where the session opens, as a take's mode: `driven`, the default, as
  // above; or in Orca (in a worktree of the branch Orca makes in the repo's Orca workspace, when the
  // folder isn't on it), the Claude app, a terminal window or a background session, in the folder and
  // on the branch above, with `instruction` its first message. Such a start is answered `opened`, or
  // `refused`; `permissions` counts only for `driven`, and the runner's cap is for those alone.
  z
    .object({
      ...drive,
      kind: z.literal("start"),
      room: Room.optional(),
      folder: Folder.optional(),
      branch: BranchName.optional(),
      project: ProjectSchema,
      roomSessions: z.array(DrivenSessionId).max(MAX_ROOM_SESSIONS).optional(),
      instruction: Instruction.optional(),
      permissions: DrivePermissionsSchema,
      mode: z.enum(["terminal", "headless", "orca", "desktop", "driven"]).optional(),
    })
    .superRefine((message, context) => {
      if (message.mode !== undefined && message.mode !== "driven") {
        if (message.folder === undefined) context.addIssue({ code: "custom", path: ["folder"], message: "a start that opens outside the floor names a folder" });
        if (message.instruction === undefined) context.addIssue({ code: "custom", path: ["instruction"], message: "a start that opens outside the floor names its first instruction" });
      }
      if (message.folder === undefined) {
        if (message.room === undefined) context.addIssue({ code: "custom", path: ["room"], message: "a start names a room, or a folder" });
        if (message.branch !== undefined) context.addIssue({ code: "custom", path: ["branch"], message: "a start names a branch only with a folder" });
        return;
      }
      for (const key of ["room", "roomSessions"] as const) {
        if (message[key] !== undefined) context.addIssue({ code: "custom", path: [key], message: "a start in a folder opens a new room, with nothing from another" });
      }
    }),
  // The next instruction, `text`; this request's id names the turn it starts.
  z.object({ ...drive, kind: z.literal("instruct"), session: DrivenSessionId, text: Instruction }),
  // End the session's process, mid-turn or not.
  z.object({ ...drive, kind: z.literal("stop"), session: DrivenSessionId }),
  // Take it back to my terminal: end the process cleanly and answer `handed-back` with the command.
  z.object({ ...drive, kind: z.literal("hand-back"), session: DrivenSessionId }),
  // Send the full output of `turn`, or of the whole session without one.
  z.object({ ...drive, kind: z.literal("output"), session: DrivenSessionId, turn: DriveId.optional() }),
  // The owner's answer to the runner's prompt `prompt`.
  z.object({ ...drive, kind: z.literal("answer"), session: DrivenSessionId, prompt: DriveId, answer: z.enum(["allow", "deny"]) }),
  // The owner released the reply or output the secret scan withheld as `withheld`: the runner answers
  // `output` under this request's id, with the released text, or `refused` `not-found` when it holds
  // nothing withheld under that id.
  z.object({ ...drive, kind: z.literal("release"), session: DrivenSessionId, withheld: DriveId }),
  // Install Claude Code for the terminal on this machine (protocol 0.7.0, #180), sent only to a runner
  // that said `claude`, on its person's press, which is their consent: the runner runs Anthropic's
  // native installer (claude.ai/install.ps1 on Windows, claude.ai/install.sh elsewhere) with no
  // window, and answers with `claude` messages under this id. One while another install or sign-in
  // runs is refused `busy`.
  z.object({ ...drive, kind: z.literal("install-claude") }),
  // Sign Claude Code for the terminal in (protocol 0.7.0): the runner runs `claude auth login` with no
  // window, which opens the sign-in in the browser on this machine, and answers with `claude`
  // messages under this id once it is signed in, or it gave up. With no claude binary it is refused
  // `no-claude`; while another install or sign-in runs, `busy`.
  z.object({ ...drive, kind: z.literal("sign-in-claude") }),
]);

/**
 * Where people may skip permission prompts in driven sessions (protocol 0.5.0): `bypassAllowed` lists
 * the projects, lower-cased, whose office allows `bypassPermissions`; an admin can turn it off for the
 * whole office. A project id here is as long as it comes, as everywhere in the protocol, so any
 * project the server holds can be listed. Sent to a runner that said `drive` once its hello is let in,
 * before any drive request, and again whenever an admin changes it. The runner sends no `driven`
 * message on a connection before the first one has come on it. Until one arrives on a connection,
 * and in any project it doesn't list, the runner opens no session's process with `bypassPermissions`:
 * not to start, reopen or restore one. What a session already running does when its project leaves
 * the list is the runner's to decide (#42).
 *
 * It is a message of its own, not a field of each start, because the runner enforces it as a standing
 * rule: a change has to reach the runner while its sessions run, and a session the runner restores
 * after its own restart comes with no start. Kept apart from a start's `permissions`, which is the
 * person's own choice, a mistake in the server's start path alone can't skip prompts in a project
 * whose office hasn't allowed it. It is by project because one server can host several offices, and a
 * runner's link serves all of them.
 */
export const DrivePolicyMessageSchema = z.object({
  type: z.literal("drive-policy"),
  v: Version,
  bypassAllowed: z.array(z.string().min(1)).max(1000),
});

export const OfficeServerMessageSchema = z.discriminatedUnion("type", [
  RepairMessageSchema,
  WelcomeMessageSchema,
  ConflictMessageSchema,
  ErrorMessageSchema,
  RequestMessageSchema,
  ReleaseMessageSchema,
  HandoffMessageSchema,
  HandedOverMessageSchema,
  HandOverReadyMessageSchema,
  DropMessageSchema,
  AskedMessageSchema,
  AskRightsMessageSchema,
  DriveMessageSchema,
  DrivePolicyMessageSchema,
]);

export type HandoffRepo = z.infer<typeof HandoffRepoSchema>;
export type Handoff = z.infer<typeof HandoffSchema>;
export type HelloMessage = z.infer<typeof HelloMessageSchema>;
export type RunnerHelloMessage = z.infer<typeof RunnerHelloMessageSchema>;
export type FullMessage = z.infer<typeof FullMessageSchema>;
export type ChangesMessage = z.infer<typeof ChangesMessageSchema>;
export type ReplyMessage = z.infer<typeof ReplyMessageSchema>;
export type RefusalMessage = z.infer<typeof RefusalMessageSchema>;
export type OwnerMessageRefusal = z.infer<typeof OwnerMessageRefusalSchema>;
export type HandOverMessage = z.infer<typeof HandOverMessageSchema>;
export type TakeMessage = z.infer<typeof TakeMessageSchema>;
export type TakenMessage = z.infer<typeof TakenMessageSchema>;
export type DataLayerMessage = z.infer<typeof DataLayerMessageSchema>;
export type RepairMessage = z.infer<typeof RepairMessageSchema>;
export type ConflictMessage = z.infer<typeof ConflictMessageSchema>;
export type ErrorMessage = z.infer<typeof ErrorMessageSchema>;
export type RequestMessage = z.infer<typeof RequestMessageSchema>;
export type RequestKind = RequestMessage["kind"];
export type ReleaseMessage = z.infer<typeof ReleaseMessageSchema>;
export type HandoffMessage = z.infer<typeof HandoffMessageSchema>;
export type HandedOverMessage = z.infer<typeof HandedOverMessageSchema>;
export type HandOverCheckMessage = z.infer<typeof HandOverCheckMessageSchema>;
export type HandOverReadyMessage = z.infer<typeof HandOverReadyMessageSchema>;
export type DropMessage = z.infer<typeof DropMessageSchema>;
export type AskRoomMessage = z.infer<typeof AskRoomMessageSchema>;
export type AskCheckMessage = z.infer<typeof AskCheckMessageSchema>;
export type AskedMessage = z.infer<typeof AskedMessageSchema>;
export type AskedAckMessage = z.infer<typeof AskedAckMessageSchema>;
export type AskRightsMessage = z.infer<typeof AskRightsMessageSchema>;
export type OfficeServerMessage = z.infer<typeof OfficeServerMessageSchema>;
export type WelcomeMessage = z.infer<typeof WelcomeMessageSchema>;
export type DrivePermissions = z.infer<typeof DrivePermissionsSchema>;
export type StartMode = z.infer<typeof StartModeSchema>;
export type DriveMessage = z.infer<typeof DriveMessageSchema>;
export type DriveKind = DriveMessage["kind"];
export type DrivePolicyMessage = z.infer<typeof DrivePolicyMessageSchema>;
export type ClaudeCli = z.infer<typeof ClaudeCliSchema>;
export type DrivenMessage = z.infer<typeof DrivenMessageSchema>;
export type DrivenKind = DrivenMessage["kind"];
export type DriveRefusal = Extract<DrivenMessage, { kind: "refused" }>;
export type DriveRefusalReason = DriveRefusal["reason"];
/**
 * The reasons the floor shows for a refused drive request: a runner's, and `offline`, the server's
 * own, for a request it refused at once because the owner's runner isn't linked (nothing is queued).
 */
export type FloorDriveRefusalReason = DriveRefusalReason | "offline";

/**
 * A parsed message, or why it was refused: `unsupported-version` when it carries a protocol
 * version this side doesn't speak, `invalid` for anything else wrong with it.
 */
export type ParseResult<T> =
  | { ok: true; message: T }
  | { ok: false; kind: "invalid" | "unsupported-version"; error: string };

/** Validates a message an office server received from a data layer. */
export function parseDataLayerMessage(value: unknown): ParseResult<DataLayerMessage> {
  return parse(DataLayerMessageSchema, value);
}

/** Validates a message a data layer received from an office server. */
export function parseOfficeServerMessage(value: unknown): ParseResult<OfficeServerMessage> {
  return parse(OfficeServerMessageSchema, value);
}

function parse<T>(schema: z.ZodType<T>, value: unknown): ParseResult<T> {
  // The version is checked first, so a newer peer is told so rather than given a field-by-field
  // list of what changed.
  if (typeof value === "object" && value !== null && "v" in value && typeof value.v === "number" && value.v !== PROTOCOL_VERSION) {
    return {
      ok: false,
      kind: "unsupported-version",
      error: `protocol version ${JSON.stringify(value.v)} is not supported; this side speaks version ${PROTOCOL_VERSION}`,
    };
  }
  const result = schema.safeParse(value);
  if (result.success) return { ok: true, message: result.data };
  return { ok: false, kind: "invalid", error: z.prettifyError(result.error) };
}
