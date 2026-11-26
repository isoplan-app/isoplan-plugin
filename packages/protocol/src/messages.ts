import { z } from "zod";
import { AreaPathSchema, FactRemoveSchema, FactsSchema, FactUpsertSchema, ProjectSchema, SourceSchema } from "./facts.js";

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
 * `experts` (protocol 0.13.0 to 0.16.0, the relay of experts' questions through the server) is gone:
 * a 0.17.0 runner never says it, and an older runner's hello still parses, with it dropped.
 * `hiddenStarts` (protocol 0.14.0, isoplan-app#315): this runner can start a session from the floor
 * hidden (a start's `hidden`), in a clone Isoplan keeps for itself. The server sends `hidden` only to
 * a runner that says it: a runner from before 0.14.0 drops the field it doesn't know and would start
 * the session in the person's own checkout.
 * `canCreateExpertsFromSuggestions` (protocol 0.15.0, isoplan-app#328): this runner suggests creating
 * an expert where a session would have been helped by one, and creates it when a person confirms
 * (see `expert-creation-suggestion`). It sends `expert-creation-suggestion`,
 * `expert-creation-suggestion-ended` and `expert-creation-progress`, and takes
 * `expert-creation-suggestion-dismissals`, `draft-office-wide-expert-creation-suggestion`,
 * `create-expert-from-suggestion` and `expert-creation-suggestion-ended`; the server sends none of
 * these to a runner that didn't say it.
 * `expertInstances` (protocol 0.17.0, isoplan-app#340): this runner keeps instances of experts set
 * up from their expert records and answers its own sessions' questions from them; it sends and
 * takes the messages of "Expert records and instances" (see `expert-directory`). The server sends
 * none of them to a runner that didn't say it.
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
  hiddenStarts: z.literal(true).optional(),
  canCreateExpertsFromSuggestions: z.literal(true).optional(),
  expertInstances: z.literal(true).optional(),
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

// Experts (protocol 0.13.0): read-only agents, each grounded in one repo, which any session in an
// office that holds that repo may ask (ask_expert). From 0.17.0 each computer keeps its own instance
// of an expert, set up from its expert record, and answers its own sessions' questions from it (see
// "Expert records and instances"). These shared pieces come before the messages that use them.

/** The most experts a session is told it may ask (protocol 0.13.0). */
export const MAX_EXPERTS = 20;
/** The longest subject an expert lists: what to ask it about, and before which changes. */
export const MAX_EXPERT_SUBJECT_LENGTH = 1000;
/**
 * The longest answer an expert's reply carries, citation block included: the hooks' ANSWER_MAX (mod
 * ask/text.ts), so quote() never cuts it. The runner cuts the answer's body to fit, never the block.
 */
export const MAX_EXPERT_ANSWER_LENGTH = 8000;

/** An expert's name, as its file is named: `~/.claude/isoplan/experts/<name>.json`. */
export const ExpertNameSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}$/, "lowercase letters, digits and dashes, at most 63");
/** A full commit hash, as a handoff repo's. */
const Commit = z.string().regex(/^([0-9a-f]{40}|[0-9a-f]{64})$/, "a full commit hash");
const Subject = z.string().trim().min(1).max(MAX_EXPERT_SUBJECT_LENGTH);

/**
 * Every situation ask_expert tells its agent about, by a stable code. `EXPERT_NOT_SET_UP` (protocol
 * 0.17.0): this computer has no instance of the expert yet, so its set-up is offered. No 0.17.0 side
 * sends `EXPERT_QUEUED` or `EXPERT_DROPPED`; an office from before 0.17.0 may still send them in a
 * late end. `EXPERT_QUESTION_HELD` is gone (0.17.0): a runner made it, and no office ever sent it.
 */
export const ExpertCodeSchema = z.enum([
  "EXPERT_RUNNER_UNREACHABLE",
  "EXPERT_UNKNOWN",
  "EXPERT_CAP",
  "EXPERT_PLUGIN_OLD",
  "EXPERT_NOT_SET_UP",
  "EXPERT_QUEUED",
  "EXPERT_STARTING",
  "EXPERT_FORK_FAILED",
  "EXPERT_DROPPED",
]);

/** The most folders or globs an expert's area names (protocol 0.15.0). */
export const MAX_AREA_PATHS = 20;

/**
 * An expert's name as people read it, from its key: the key's words, split on dashes, each
 * capitalised, then "Expert" (`pairing` is "Pairing Expert", `pairing-tokens` "Pairing Tokens Expert").
 */
export const expertDisplayName = (key: string) =>
  [...key.split("-").filter(Boolean).map((word) => word[0]!.toUpperCase() + word.slice(1)), "Expert"].join(" ");

/**
 * One expert a session may ask: `repo` is its project's short name, `host` a person's name: the
 * hosting person's until 0.17.0, and from 0.17.0 the expert's owner's, kept so an older plugin still
 * parses it.
 */
export const ExpertRightSchema = z.object({ name: ExpertNameSchema, subject: Subject, repo: z.string().min(1), host: z.string() });

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

/**
 * A session asks an expert a question (protocol 0.13.0), on its own short link with the session's
 * hello, as ask-room is. `key` is the tool call's id: asked again under it, it is the same question.
 * `blocking`: the agent waits a few seconds for the answer. The server answers `asked`, or an error
 * whose code is `EXPERT_UNKNOWN`, `EXPERT_CAP` or `EXPERT_PLUGIN_OLD` (or `ask-refused` and the
 * pairing codes, as for ask-room). It is a message of its own, not an ask-room with an expert, so a
 * server from before experts refuses it rather than asking a room. The session then polls it with
 * ask-check and acks its end with asked-ack, as for a room question.
 * From 0.17.0 a server answers it only with an error `EXPERT_PLUGIN_OLD`, and a 0.17.0 plugin never
 * sends it: it asks its own computer's instance of the expert (see `expert-question`).
 */
export const AskExpertMessageSchema = z.object({
  type: z.literal("ask-expert"),
  v: Version,
  expert: ExpertNameSchema,
  question: z.string().trim().min(1).max(MAX_QUESTION_LENGTH),
  blocking: z.boolean(),
  key: z.string().min(1).max(100),
});

// Expert creation suggestions (protocol 0.15.0, isoplan-app#328, ADR 0013): a runner notices, from a
// session's area facts, when the session would have been helped by an expert on one folder of its
// repo. It drafts one on its machine, with no hooks, checks the draft for secrets there (a match means
// no suggestion), and suggests creating it once (`expert-creation-suggestion`). Anyone signed in to
// the office may open it on the floor, change what they like, and press Make expert: the server sends
// `create-expert-from-suggestion` to one of that person's own connected runners, which writes the
// expert file and says how creating it goes (`expert-creation-progress`). An area several sessions
// search within a week becomes an office-wide expert creation suggestion, which the server asks the
// runner of the latest of them to draft (`draft-office-wide-expert-creation-suggestion`). The server
// tells each such runner its person's dismissed areas (`expert-creation-suggestion-dismissals`), and
// the runner that sent a suggestion how it ended (`expert-creation-suggestion-ended`). A runner that
// can says `canCreateExpertsFromSuggestions` in its hello. The server sends it
// `expert-creation-suggestion-dismissals` once its hello is let in, even an empty one, and the runner
// sends no `expert-creation-suggestion`, `expert-creation-suggestion-ended` or
// `expert-creation-progress` on a connection before that connection's first
// `expert-creation-suggestion-dismissals`, so a server from before expert creation suggestions, which
// sends none, is never sent one.

/** The most sessions a `draft-office-wide-expert-creation-suggestion` names. */
export const MAX_EXPERT_CREATION_SUGGESTION_SESSIONS = 20;
/** The most dismissed areas an `expert-creation-suggestion-dismissals` lists. */
export const MAX_EXPERT_CREATION_SUGGESTION_DISMISSALS = 1000;

/**
 * An expert creation suggestion's id, which the floor's link names
 * (`/?expert-creation-suggestion=<id>`), so it keeps to letters, digits, `_` and `-`: the runner's own
 * random id for a session's suggestion, or the `draft-office-wide-expert-creation-suggestion`'s
 * `request` for an office-wide one.
 */
const ExpertCreationSuggestionId = z.string().regex(/^[A-Za-z0-9_-]{1,100}$/, "letters, digits, `_` and `-`, at most 100");
/**
 * The model an expert grounds with, as Claude Code's `--model` takes it (`sonnet`,
 * `claude-opus-5-5`, `claude-sonnet-4-5[1m]`): kept to characters no shell reads, starting with a
 * letter or digit, as it goes into a command on the runner's machine.
 */
const Model = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:/[\]-]{0,199}$/, "a model name: letters, digits and . _ : / [ ] -, starting with a letter or digit, at most 200");
/** The proof question an expert must answer before it answers anyone, and the answer expected. */
const Proof = z.object({
  question: z.string().trim().min(1).max(MAX_QUESTION_LENGTH),
  answer: z.string().trim().min(1).max(MAX_EXPERT_ANSWER_LENGTH),
});
/** What an expert covers: folders and globs in its repo (AreaPathSchema). */
const Area = z.array(AreaPathSchema).min(1).max(MAX_AREA_PATHS);

/**
 * A runner suggests creating an expert (protocol 0.15.0), once per session and folder, for a session
 * in a repo the office takes. `session` is the session that showed the need (for an office-wide one,
 * the latest that searched the area), `project` its repo, and `folder` the folder whose signals passed
 * their threshold, which dismissals name. `scope`: `session`, from that session's own signals, or
 * `office`, in answer to a `draft-office-wide-expert-creation-suggestion`, whose `request` is then its
 * `id`. The draft: `key`, the expert's name (shown as `expertDisplayName(key)`), `subject`, `area`
 * and `proof`, as the runner's local model wrote them and the secret check passed them. `why`, the
 * signals that passed their thresholds, each other one 0: `share`, the share of the session's context
 * spent reading and searching the folder (0 to 1), and `tokens`, those tokens, which are one signal;
 * `minutes`, the time spent there; `corrections`, the person's corrections there. `repetition`
 * (from 0.16.0, a session's suggestion only), what was done in its area again, which suggested it:
 * its `folder`, the file read most, was read in `readings` turns over `sessions` sessions, the
 * area's `files` read again with it; or its folder was searched `searches` times. An older runner
 * sends none, and an older side ignores it. `at`: when it was suggested. Of its text, only these
 * leave the machine, under ADR 0004's case for an expert creation suggestion's draft.
 */
export const ExpertCreationSuggestionRepetitionSchema = z.union([
  z.object({ readings: z.number().int().min(2), sessions: z.number().int().positive(), files: z.number().int().positive() }),
  z.object({ searches: z.number().int().positive() }),
]);

export const ExpertCreationSuggestionMessageSchema = z.object({
  type: z.literal("expert-creation-suggestion"),
  v: Version,
  id: ExpertCreationSuggestionId,
  session: z.string().min(1),
  project: ProjectSchema,
  folder: AreaPathSchema,
  scope: z.enum(["session", "office"]),
  key: ExpertNameSchema,
  subject: Subject,
  area: Area,
  proof: Proof,
  why: z.object({
    share: z.number().min(0).max(1),
    tokens: z.number().int().nonnegative(),
    minutes: z.number().nonnegative(),
    corrections: z.number().int().nonnegative(),
  }),
  repetition: ExpertCreationSuggestionRepetitionSchema.optional(),
  at: z.iso.datetime({ offset: true }),
});

/**
 * A runner ends its expert creation suggestion `id` itself (protocol 0.15.0): `withdrawn`, it took the
 * suggestion back before anyone created the expert or dismissed it; `no-draft`, it couldn't draft the
 * office-wide suggestion the `draft-office-wide-expert-creation-suggestion` of that id asked for (the
 * secret check matched, or its model gave no usable draft).
 */
export const RunnerExpertCreationSuggestionEndedMessageSchema = z.object({
  type: z.literal("expert-creation-suggestion-ended"),
  v: Version,
  id: ExpertCreationSuggestionId,
  why: z.enum(["withdrawn", "no-draft"]),
});

/**
 * Where creating an expert stands on the runner that took the `create-expert-from-suggestion` request
 * `request`, for the expert creation suggestion `expertCreationSuggestionId` (protocol 0.15.0), sent
 * as each state is reached: `cloning`, it prepares the expert's own clone of the repo; `grounding`,
 * the expert reads what its subject rests on, as any expert grounds (its area decides only which
 * folders it covers, for expert creation suggestions); `proof`, it answers its
 * proof question; `ready`, it answers questions; `failed`, it stopped, with `detail` in the runner's
 * own words (no checkout of the repo on this machine, a key already used here, a failed proof).
 */
export const ExpertCreationProgressStateSchema = z.enum(["cloning", "grounding", "proof", "ready", "failed"]);
export const ExpertCreationProgressMessageSchema = z.object({
  type: z.literal("expert-creation-progress"),
  v: Version,
  request: RequestId,
  expertCreationSuggestionId: ExpertCreationSuggestionId,
  state: ExpertCreationProgressStateSchema,
  detail: Detail.optional(),
});

// Expert records and instances (protocol 0.17.0, isoplan-app#340): an expert's definition is kept in
// its expert record on the office server, which its owner's runner publishes from the expert file
// (`expert-definition`). Every computer whose sessions ask the expert keeps its own instance of it,
// set up from the record, and answers those questions itself: neither a question nor its answer
// leaves the computer, and the server is told only a record of each with no words
// (`expert-question`). A runner that can says `expertInstances` in its hello. The server sends such
// a runner `expert-directory` once that hello is let in, even an empty one, and whenever it changes,
// and sends none of the family to a runner that didn't say it. The runner sends nothing of the
// family on a connection before that connection's first `expert-directory`, so a server from before
// 0.17.0, which sends none, is never sent any. A runner sends the family only while its link is up,
// and counts a message sent only once it went: one that didn't, and one it must send again on a new
// connection, goes after that connection's first `expert-directory`. The server takes a repeat as
// the same message, so sending one again is always safe.
// Ownership is told, never worked out on the runner: the server marks what is this runner's
// person's own with `yours`, and names a person to the runner as the account that runner said hello
// as (`by`), since with sign-in on the server's id for a person isn't the Claude account the runner
// knows itself by.

/** The most expert records an `expert-directory` or an `expert-instance-states` names. */
export const MAX_EXPERT_RECORDS = 1000;
/** The most times an `expert-questions-asked-on-your-other-computers` lists for the last day. */
export const MAX_EXPERT_QUESTION_TIMES_IN_THE_LAST_DAY = 1000;

/** A definition's revision in its expert record: 1 when the record is made, one more at each change. */
const Revision = z.number().int().positive();
/**
 * Which expert record: made by the server when the record is made, so a record made again under the
 * key of a deleted one is told apart from the old one.
 */
export const ExpertRecordIdSchema = z.uuid();
/** The record and revision a computer last had of the definition it publishes. */
const BasedOn = z.object({ expertRecordId: ExpertRecordIdSchema, revision: Revision });

/**
 * What every computer's instance of an expert shares, as its owner's expert file says it: its key;
 * its project, one with a remote, never a folder on one computer (`local:`); its subject; the model
 * it grounds with; the context, in tokens, at which its junior is promoted (`promoteAtTokens`); the
 * folders and globs of its repo it covers (`areas`); and its proof question with the answer expected.
 * The rest of an expert file is that computer's own, and never leaves it.
 */
export const ExpertDefinitionSchema = z.object({
  key: ExpertNameSchema,
  project: ProjectSchema.refine((project) => !project.id.toLowerCase().startsWith("local:"), "a project with a remote: an expert's definition never names a folder on one computer"),
  subject: Subject,
  model: Model,
  promoteAtTokens: z.number().int().positive(),
  areas: z.array(AreaPathSchema).max(MAX_AREA_PATHS),
  proof: Proof,
});

/**
 * Where this computer's instance of the expert `key` stands, set up from (or, on its owner's
 * computer, published as) the record `expertRecordId`: `setting-up`, with its `step` (`cloning`,
 * finding this computer's checkout of the project or cloning it; `grounding`; `proof`); `ready`, its
 * junior answers; or `failed`, with its `failure`: `clone`, the project couldn't be cloned, with
 * git's words in `detail`, secret-checked on this computer; `proof`, its proof question failed;
 * `key-used-here`, this computer has its own expert with that key, whose publish was refused
 * `key-taken`, so the record can't be set up here until that one is renamed; `other`, with why in
 * `detail`. `senior`: it has a senior generation, which its junior can ask. `groundingTokens`: its
 * junior's context after grounding. No definition field: the record has it.
 */
export const ExpertInstanceStateSchema = z.object({
  key: ExpertNameSchema,
  expertRecordId: ExpertRecordIdSchema,
  state: z.enum(["setting-up", "ready", "failed"]),
  step: z.enum(["cloning", "grounding", "proof"]).optional(),
  senior: z.literal(true).optional(),
  groundingTokens: z.number().int().positive().optional(),
  failure: z.object({ why: z.enum(["clone", "proof", "key-used-here", "other"]), detail: Detail.optional() }).optional(),
});

/**
 * One expert record in an `expert-directory`: one whose project an office holds. `owner` is the
 * expert's owner, `yours` marks a record this runner's person owns, `revision` is its definition's
 * revision now, and `groundingTokens` a junior's context after grounding, as an instance last said.
 */
export const ExpertDirectoryEntrySchema = z.object({
  key: ExpertNameSchema,
  expertRecordId: ExpertRecordIdSchema,
  project: ProjectSchema,
  owner: Account,
  yours: z.literal(true).optional(),
  revision: Revision,
  groundingTokens: z.number().int().positive().optional(),
});

/** Adds an issue for each entry of the list `field` that names a key an earlier entry named. */
const checkEachKeyOnce = (field: string, entries: { key: string }[], context: z.RefinementCtx) => {
  const seen = new Set<string>();
  entries.forEach((entry, i) => {
    if (seen.has(entry.key)) context.addIssue({ code: "custom", path: [field, i, "key"], message: `the key ${entry.key} is named once only` });
    seen.add(entry.key);
  });
};

/**
 * The owner's runner publishes the expert's definition from the expert file (protocol 0.17.0), after
 * checking it for secrets on this computer (a match sends nothing). `basedOn`: the record and
 * revision this computer last had of it from this server; absent for a file never published there.
 * Sent on each new connection while the file differs from that revision, and on each change. The
 * server answers `expert-definition-result`; the same definition and `basedOn` again get the same
 * result.
 */
export const ExpertDefinitionMessageSchema = z.object({
  type: z.literal("expert-definition"),
  v: Version,
  definition: ExpertDefinitionSchema,
  basedOn: BasedOn.optional(),
});

/**
 * Send this computer the record `expertRecordId` of the expert `key` (protocol 0.17.0), answered
 * with `expert-record`. Sent only once this computer has a checkout or clone of the record's
 * project, and again after each new connection's first `expert-directory` while it is still wanted.
 */
export const ExpertRecordWantedMessageSchema = z.object({
  type: z.literal("expert-record-wanted"),
  v: Version,
  key: ExpertNameSchema,
  expertRecordId: ExpertRecordIdSchema,
});

/**
 * Every instance on this computer of this server's expert records whose project this server takes
 * (protocol 0.17.0), the whole list each time: the first on each connection always, even an empty
 * one, then only when it differs. An instance set up from one office server is never named to
 * another. Each key once.
 */
export const ExpertInstanceStatesMessageSchema = z
  .object({
    type: z.literal("expert-instance-states"),
    v: Version,
    instances: z.array(ExpertInstanceStateSchema).max(MAX_EXPERT_RECORDS),
  })
  .superRefine((message, context) => checkEachKeyOnce("instances", message.instances, context));

/**
 * A question this computer's session asked the expert `key` (protocol 0.17.0), as a record with no
 * words: never the question's or the answer's text. `id` is the tool call's id, `session` the asking
 * session as its hello names it (`claude-code:<id>`), `blocking` whether its agent waited, `state`
 * where it stands (`asking`, `answered` or `dropped`, with its `code`), `senior` that its junior asked
 * its senior, and `askedAt` and `endedAt` when it was asked and ended. Sent at each change of state,
 * and again after each new connection's first `expert-directory` until its end has gone. The same
 * `id` and `state` again is the same record.
 */
export const ExpertQuestionMessageSchema = z.object({
  type: z.literal("expert-question"),
  v: Version,
  id: z.string().min(1).max(100),
  key: ExpertNameSchema,
  expertRecordId: ExpertRecordIdSchema,
  session: z.string().min(1),
  blocking: z.boolean(),
  state: z.enum(["asking", "answered", "dropped"]),
  code: ExpertCodeSchema.optional(),
  senior: z.literal(true).optional(),
  askedAt: z.iso.datetime({ offset: true }),
  endedAt: z.iso.datetime({ offset: true }).optional(),
});

/**
 * An agent on this computer asked the expert `key`, of which this computer has no instance, so its
 * person is offered to set it up (protocol 0.17.0, ADR 0013). Sent once per computer per record,
 * ever, and again after each new connection's first `expert-directory` until it has gone. A repeat
 * for the same record, person and computer changes nothing. No text of the question.
 */
export const ExpertSetUpOfferedMessageSchema = z.object({
  type: z.literal("expert-set-up-offered"),
  v: Version,
  key: ExpertNameSchema,
  expertRecordId: ExpertRecordIdSchema,
});

/**
 * This computer's instance of the expert `key`, whose record isn't its person's own, failed its proof
 * question at `revision` until its tries ran out (protocol 0.17.0), for the expert's owner to see:
 * `answer`, what its fork answered, secret-checked on this computer, or `answerHeld`, that it matched
 * a secret pattern and so isn't sent. Exactly one of the two. Sent once per revision, and again after
 * each new connection's first `expert-directory` until it has gone. A repeat for the same record,
 * computer and revision changes nothing.
 */
export const ExpertProofFailedMessageSchema = z
  .object({
    type: z.literal("expert-proof-failed"),
    v: Version,
    key: ExpertNameSchema,
    expertRecordId: ExpertRecordIdSchema,
    revision: Revision,
    answer: z.string().min(1).max(MAX_EXPERT_ANSWER_LENGTH).optional(),
    answerHeld: z.literal(true).optional(),
  })
  .superRefine((message, context) => {
    if ((message.answer === undefined) === (message.answerHeld === undefined)) context.addIssue({ code: "custom", path: ["answer"], message: "the fork's answer, or answerHeld: one of the two" });
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
  // or `stopped`, when the session was stopped or handed back mid-turn, or the reply interrupted.
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
  // `removed` (protocol 0.12.0): ended and removed, by a stop with `remove` or from the machine's own
  // menu: the runner has forgotten it and never opens it again, so its agent can leave the floor.
  z.object({ ...driven, kind: z.literal("released"), session: DrivenSessionId, why: z.enum(["stopped", "handed-back", "idle-closed", "crashed", "removed"]), id: DriveId.optional() }),
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
  // by name, at most MAX_REPO_BRANCHES, each passed by the secret scan. A newer runner lists the
  // remote's default branch (its HEAD) first, where the remote names one. Absent when the runner is older,
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
  AskExpertMessageSchema,
  ExpertCreationSuggestionMessageSchema,
  RunnerExpertCreationSuggestionEndedMessageSchema,
  ExpertCreationProgressMessageSchema,
  ExpertDefinitionMessageSchema,
  ExpertRecordWantedMessageSchema,
  ExpertInstanceStatesMessageSchema,
  ExpertQuestionMessageSchema,
  ExpertSetUpOfferedMessageSchema,
  ExpertProofFailedMessageSchema,
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
 * A question asked of an expert (protocol 0.13.0) has `expert`, and `owner` is the host's name; its
 * `code` says where it stands for ask_expert, and an answered one has the `commit` and `branch` its
 * answer describes. From 0.17.0 no office sends one for an expert's question, which the asker's own
 * runner answers, though an office from before 0.17.0 may still send a late end.
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
  expert: ExpertNameSchema.optional(),
  code: ExpertCodeSchema.optional(),
  commit: Commit.optional(),
  branch: BranchName.optional(),
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

/**
 * The experts this session may ask now (protocol 0.13.0), the whole list each time, sorted by name:
 * sent down the session's own link after its `full`, and whenever the list changes, only to a session
 * whose fact says `asksExperts`. An empty list means none.
 */
export const ExpertRightsMessageSchema = z.object({
  type: z.literal("expert-rights"),
  v: Version,
  experts: z.array(ExpertRightSchema).max(MAX_EXPERTS),
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
  // has its own record of, still there and in a repo the office takes. With none, the start is
  // refused `no-folder`: the runner doesn't look for some other checkout of `project`, as a take does.
  // `instruction`, the first, is the turn named by this request's id. `permissions` is the mode
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
  // With `hidden: true` (protocol 0.14.0, isoplan-app#315, only with `folder`, never with mode `orca`,
  // which would list it, and only to a runner whose hello says `hiddenStarts`): the session works in
  // a clone of the repo Isoplan keeps for itself, not in the folder named, so the person's other tools
  // (Orca, IDEs) don't list its folder; with `branch`, in a worktree of that clone on it.
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
      hidden: z.boolean().optional(),
    })
    .superRefine((message, context) => {
      if (message.hidden && message.mode === "orca") context.addIssue({ code: "custom", path: ["hidden"], message: "a hidden start doesn't open in Orca, which would list its folder" });
      if (message.mode !== undefined && message.mode !== "driven") {
        if (message.folder === undefined) context.addIssue({ code: "custom", path: ["folder"], message: "a start that opens outside the floor names a folder" });
        if (message.instruction === undefined) context.addIssue({ code: "custom", path: ["instruction"], message: "a start that opens outside the floor names its first instruction" });
      }
      if (message.folder === undefined) {
        if (message.room === undefined) context.addIssue({ code: "custom", path: ["room"], message: "a start names a room, or a folder" });
        if (message.branch !== undefined) context.addIssue({ code: "custom", path: ["branch"], message: "a start names a branch only with a folder" });
        if (message.hidden) context.addIssue({ code: "custom", path: ["hidden"], message: "a start is hidden only with a folder" });
        return;
      }
      for (const key of ["room", "roomSessions"] as const) {
        if (message[key] !== undefined) context.addIssue({ code: "custom", path: [key], message: "a start in a folder opens a new room, with nothing from another" });
      }
    }),
  // The next instruction, `text`; this request's id names the turn it starts.
  z.object({ ...drive, kind: z.literal("instruct"), session: DrivenSessionId, text: Instruction }),
  // End the session's process, mid-turn or not; the next instruction opens it again. With `remove`
  // (protocol 0.12.0), the runner also forgets it, never to open it again, and answers `released`
  // `removed`. A runner from before 0.12.0 ignores `remove` and answers `released` `stopped`.
  z.object({ ...drive, kind: z.literal("stop"), session: DrivenSessionId, remove: z.literal(true).optional() }),
  // Stop the reply in progress (protocol 0.12.0), keeping the process and the session: the turn ends
  // `turn-ended` `stopped`. With no turn running it does nothing, and nothing is sent back.
  z.object({ ...drive, kind: z.literal("interrupt"), session: DrivenSessionId }),
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

/**
 * Create the expert the expert creation suggestion `expertCreationSuggestionId` drafted (protocol
 * 0.15.0), as the person who confirmed it (`by`) set it on the floor, sent to the runner of the
 * computer they chose, one of their own, which checks `by` is its own person. The runner finds its
 * checkout of `project`, writes the expert file `key` with `subject`, `model`, `area` and `proof`, and
 * answers with `expert-creation-progress` under `request`. Nothing is queued: the server refuses at
 * once when that runner isn't linked.
 */
export const CreateExpertFromSuggestionMessageSchema = z.object({
  type: z.literal("create-expert-from-suggestion"),
  v: Version,
  request: RequestId,
  expertCreationSuggestionId: ExpertCreationSuggestionId,
  key: ExpertNameSchema,
  subject: Subject,
  model: Model,
  project: ProjectSchema,
  area: Area,
  proof: Proof,
  by: Account,
});

/**
 * Draft an office-wide expert creation suggestion on `folder` of `project` (protocol 0.15.0), which
 * several sessions searched within the period: sent to the runner of the latest of them. `sessions`:
 * those on this runner's machine, newest first, whose work in the folder the draft is made from; the
 * first is the suggestion's `session`. The runner answers with `expert-creation-suggestion`, scope
 * `office`, whose `id` is `request`, or with `expert-creation-suggestion-ended` `no-draft`.
 * `searchedBySessions` and `searchWindowDays` let the runner say why it is office-wide.
 */
export const DraftOfficeWideExpertCreationSuggestionMessageSchema = z.object({
  type: z.literal("draft-office-wide-expert-creation-suggestion"),
  v: Version,
  request: ExpertCreationSuggestionId,
  project: ProjectSchema,
  folder: AreaPathSchema,
  sessions: z.array(z.string().min(1)).min(1).max(MAX_EXPERT_CREATION_SUGGESTION_SESSIONS),
  /** How many sessions in the office, on any machine, searched the folder within the window. */
  searchedBySessions: z.number().int().positive(),
  /** The window, in days: the office's `officeWideSuggestionWindowDays`. */
  searchWindowDays: z.number().positive(),
});

/**
 * One area this runner's person dismissed: a folder of a project, by its id, lower-cased. "Not now"
 * lasts `until` a time, after which the same area may be suggested again; "Don't suggest this again"
 * lasts `forever`. Exactly one of the two.
 */
const ExpertCreationSuggestionDismissalSchema = z
  .object({
    project: z.string().min(1),
    folder: AreaPathSchema,
    until: z.iso.datetime({ offset: true }).optional(),
    forever: z.literal(true).optional(),
  })
  .superRefine((dismissal, context) => {
    if ((dismissal.until === undefined) === (dismissal.forever === undefined)) context.addIssue({ code: "custom", path: ["until"], message: "a dismissal lasts until a time, or forever: one of the two" });
  });

/**
 * The areas this runner's person dismissed (protocol 0.15.0), the whole list each time: sent to a
 * runner that said `canCreateExpertsFromSuggestions` once its hello is let in, even an empty one, and
 * whenever the list changes. The runner suggests no expert on an area it lists, and sends none of its
 * expert creation suggestion messages on a connection before the connection's first one (see
 * `expert-creation-suggestion`).
 */
export const ExpertCreationSuggestionDismissalsMessageSchema = z.object({
  type: z.literal("expert-creation-suggestion-dismissals"),
  v: Version,
  dismissals: z.array(ExpertCreationSuggestionDismissalSchema).max(MAX_EXPERT_CREATION_SUGGESTION_DISMISSALS),
});

const expertCreationSuggestionEnded = { type: z.literal("expert-creation-suggestion-ended"), v: Version, id: ExpertCreationSuggestionId };

/**
 * How the expert creation suggestion `id` ended (protocol 0.15.0), sent to the runner that sent it:
 * `made`, once the expert `key` is created and ready (with the key the person set, which may differ
 * from the draft's), so the runner can tell the session that showed the need; `dismissed`, by a person
 * on the floor, and only that; `refused`, the office won't keep it (its repo isn't taken there, the
 * session is someone else's, it names an id the office didn't ask for, and the like); `expired`,
 * unopened or with no expert created for the period the server keeps expert creation suggestions.
 */
export const ServerExpertCreationSuggestionEndedMessageSchema = z.discriminatedUnion("why", [
  z.object({ ...expertCreationSuggestionEnded, why: z.literal("made"), key: ExpertNameSchema }),
  z.object({ ...expertCreationSuggestionEnded, why: z.enum(["dismissed", "refused", "expired"]) }),
]);

/**
 * Every expert record whose project an office on this server holds (protocol 0.17.0), the whole list
 * each time, each marked `yours` for this runner's person, and the caps of asks.json that the
 * asker's runner checks over its person's questions on all their computers (`asking`): open
 * questions per person per expert, questions per person in the last day, and the hours after which
 * a question still unanswered ends. Sent to a runner that said `expertInstances` once its hello is
 * let in, even an empty one, and whenever it changes; the first on a connection opens the family on
 * it (see "Expert records and instances"). Each key once.
 */
export const ExpertDirectoryMessageSchema = z
  .object({
    type: z.literal("expert-directory"),
    v: Version,
    experts: z.array(ExpertDirectoryEntrySchema).max(MAX_EXPERT_RECORDS),
    asking: z.object({
      openPerPersonPerExpert: z.number().int().positive(),
      perPersonPerDay: z.number().int().positive(),
      maxAgeHours: z.number().positive(),
    }),
  })
  .superRefine((message, context) => checkEachKeyOnce("experts", message.experts, context));

/**
 * The expert record `expertRecordId` at `revision`, with its definition (protocol 0.17.0): in answer
 * to `expert-record-wanted`, and sent unasked when the revision changes to every linked runner whose
 * `expert-instance-states` has that record at `grounding` or `proof`, `ready`, or failed for a reason
 * other than `clone` or `key-used-here`; a runner still cloning asks once it has the project.
 * `owner` is the expert's owner, and `yours` marks it as this runner's person's own.
 */
export const ExpertRecordMessageSchema = z.object({
  type: z.literal("expert-record"),
  v: Version,
  expertRecordId: ExpertRecordIdSchema,
  revision: Revision,
  owner: Account,
  yours: z.literal(true).optional(),
  definition: ExpertDefinitionSchema,
});

const expertDefinitionResult = { type: z.literal("expert-definition-result"), v: Version, key: ExpertNameSchema };
const expertDefinitionRefused = { ...expertDefinitionResult, outcome: z.literal("refused") };

/**
 * The answer to `expert-definition` for the expert `key` (protocol 0.17.0): `published`, as the record
 * `expertRecordId` at `revision` (a definition unchanged keeps its revision); or `refused`, for its
 * `reason`: `edited-elsewhere`, the record changed since the revision `basedOn` named, so the runner
 * writes the record's `definition`, at `revision`, into the expert file; `key-taken`, another
 * person's expert has the key; `not-owner`, the record `basedOn` named is now another person's, its
 * owner changed; `project-not-in-an-office`, no office on this server holds its project; `deleted`,
 * the record `basedOn` named was deleted on the floor.
 */
export const ExpertDefinitionResultMessageSchema = z.discriminatedUnion("outcome", [
  z.object({ ...expertDefinitionResult, outcome: z.literal("published"), expertRecordId: ExpertRecordIdSchema, revision: Revision }),
  z.discriminatedUnion("reason", [
    z.object({ ...expertDefinitionRefused, reason: z.literal("edited-elsewhere"), expertRecordId: ExpertRecordIdSchema, revision: Revision, definition: ExpertDefinitionSchema }),
    z.object({ ...expertDefinitionRefused, reason: z.enum(["key-taken", "not-owner", "project-not-in-an-office", "deleted"]) }),
  ]),
]);

/**
 * The expert record `expertRecordId` of the expert `key` was deleted on the floor, by `by` (protocol
 * 0.17.0): sent to every linked runner then, and to each runner that links within the 30 days after.
 * A runner acts on it only where its files are tied to that record, never another record of the key.
 */
export const ExpertDeletedMessageSchema = z.object({
  type: z.literal("expert-deleted"),
  v: Version,
  key: ExpertNameSchema,
  expertRecordId: ExpertRecordIdSchema,
  by: Account,
});

/**
 * Set up this computer's instance of the expert `key` from the record `expertRecordId` (protocol
 * 0.17.0): its person's one click on the floor, or Try again after a failure (`again`, which grounds
 * it again now). Sent to that person's own runner on the computer they chose; `by` is the account
 * that runner said hello as, which the runner checks is its own, starting nothing otherwise. Nothing
 * is queued: the server refuses at once when that runner isn't linked. How the set-up goes, the
 * runner says in `expert-instance-states`.
 */
export const SetUpExpertInstanceMessageSchema = z.object({
  type: z.literal("set-up-expert-instance"),
  v: Version,
  request: RequestId,
  key: ExpertNameSchema,
  expertRecordId: ExpertRecordIdSchema,
  by: Account,
  again: z.literal(true).optional(),
});

/**
 * The offer to set up the expert `key` on this computer, from the record `expertRecordId`, ended
 * (protocol 0.17.0): `dismissed` on the floor; `expired`; `set-up`, an instance of it is listed; or
 * `gone`, the record was deleted or its project left every office. Sent to that person's runner on
 * that computer when it ends, and on each link for every offer of that computer that ended in the 30
 * days after it was offered.
 */
export const ExpertSetUpOfferEndedMessageSchema = z.object({
  type: z.literal("expert-set-up-offer-ended"),
  v: Version,
  key: ExpertNameSchema,
  expertRecordId: ExpertRecordIdSchema,
  why: z.enum(["dismissed", "expired", "set-up", "gone"]),
});

/**
 * This runner's person's questions to experts on their other computers (protocol 0.17.0), from the
 * records those computers' runners sent (`expert-question`): `open`, how many are open per expert,
 * and `askedAtInTheLastDay`, when each of the last day's was asked. The runner adds its own and
 * checks the directory's `asking` caps against the total. Sent after the directory on each link, and
 * whenever those records change.
 */
export const ExpertQuestionsAskedOnYourOtherComputersMessageSchema = z.object({
  type: z.literal("expert-questions-asked-on-your-other-computers"),
  v: Version,
  open: z.array(z.object({ key: ExpertNameSchema, count: z.number().int().positive() })).max(MAX_EXPERT_RECORDS),
  askedAtInTheLastDay: z.array(z.iso.datetime({ offset: true })).max(MAX_EXPERT_QUESTION_TIMES_IN_THE_LAST_DAY),
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
  ExpertRightsMessageSchema,
  CreateExpertFromSuggestionMessageSchema,
  DraftOfficeWideExpertCreationSuggestionMessageSchema,
  ExpertCreationSuggestionDismissalsMessageSchema,
  ServerExpertCreationSuggestionEndedMessageSchema,
  ExpertDirectoryMessageSchema,
  ExpertRecordMessageSchema,
  ExpertDefinitionResultMessageSchema,
  ExpertDeletedMessageSchema,
  SetUpExpertInstanceMessageSchema,
  ExpertSetUpOfferEndedMessageSchema,
  ExpertQuestionsAskedOnYourOtherComputersMessageSchema,
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
export type ExpertRight = z.infer<typeof ExpertRightSchema>;
export type ExpertCode = z.infer<typeof ExpertCodeSchema>;
export type AskExpertMessage = z.infer<typeof AskExpertMessageSchema>;
export type ExpertRightsMessage = z.infer<typeof ExpertRightsMessageSchema>;
export type ExpertDefinition = z.infer<typeof ExpertDefinitionSchema>;
export type ExpertInstanceState = z.infer<typeof ExpertInstanceStateSchema>;
export type ExpertDirectoryEntry = z.infer<typeof ExpertDirectoryEntrySchema>;
export type ExpertDefinitionMessage = z.infer<typeof ExpertDefinitionMessageSchema>;
export type ExpertRecordWantedMessage = z.infer<typeof ExpertRecordWantedMessageSchema>;
export type ExpertInstanceStatesMessage = z.infer<typeof ExpertInstanceStatesMessageSchema>;
export type ExpertQuestionMessage = z.infer<typeof ExpertQuestionMessageSchema>;
export type ExpertSetUpOfferedMessage = z.infer<typeof ExpertSetUpOfferedMessageSchema>;
export type ExpertProofFailedMessage = z.infer<typeof ExpertProofFailedMessageSchema>;
export type ExpertDirectoryMessage = z.infer<typeof ExpertDirectoryMessageSchema>;
export type ExpertRecordMessage = z.infer<typeof ExpertRecordMessageSchema>;
export type ExpertDefinitionResultMessage = z.infer<typeof ExpertDefinitionResultMessageSchema>;
export type ExpertDeletedMessage = z.infer<typeof ExpertDeletedMessageSchema>;
export type SetUpExpertInstanceMessage = z.infer<typeof SetUpExpertInstanceMessageSchema>;
export type ExpertSetUpOfferEndedMessage = z.infer<typeof ExpertSetUpOfferEndedMessageSchema>;
export type ExpertQuestionsAskedOnYourOtherComputersMessage = z.infer<typeof ExpertQuestionsAskedOnYourOtherComputersMessageSchema>;
export type ExpertCreationSuggestionMessage = z.infer<typeof ExpertCreationSuggestionMessageSchema>;
export type ExpertCreationSuggestionRepetition = z.infer<typeof ExpertCreationSuggestionRepetitionSchema>;
export type RunnerExpertCreationSuggestionEndedMessage = z.infer<typeof RunnerExpertCreationSuggestionEndedMessageSchema>;
export type ExpertCreationProgressState = z.infer<typeof ExpertCreationProgressStateSchema>;
export type ExpertCreationProgressMessage = z.infer<typeof ExpertCreationProgressMessageSchema>;
export type CreateExpertFromSuggestionMessage = z.infer<typeof CreateExpertFromSuggestionMessageSchema>;
export type DraftOfficeWideExpertCreationSuggestionMessage = z.infer<typeof DraftOfficeWideExpertCreationSuggestionMessageSchema>;
export type ExpertCreationSuggestionDismissalsMessage = z.infer<typeof ExpertCreationSuggestionDismissalsMessageSchema>;
export type ExpertCreationSuggestionDismissal = ExpertCreationSuggestionDismissalsMessage["dismissals"][number];
export type ServerExpertCreationSuggestionEndedMessage = z.infer<typeof ServerExpertCreationSuggestionEndedMessageSchema>;
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
