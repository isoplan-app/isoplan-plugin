// Expert creation suggestions (isoplan-app#328, ADR 0013): the runner notices when a session on this
// computer would have been helped by an expert on one folder of its repo, drafts one with a local
// model and suggests creating it, once per session and folder, to each office that may be told of
// the folder's repo. Whoever picks the suggestion up on the floor creates the expert on one of their
// own computers: that computer's runner writes the expert file and says how its creation goes until
// the expert is ready.
//
// - The signals are the session's areas (data-layer/claude-code.ts), each pass's as one office may
//   be told of them (report-session.ts SessionAreas). A folder passes when what its reads and
//   searches took is `contextShare` of the session's context window or more (the window its hooks
//   module said, else its model's, expert-meter.ts), or `tokens`; or its calls took `minutes`; or
//   the person corrected the agent there `corrections` times: runner.json's `expertCreationSuggestions`.
//   Of the folders that pass, the deepest is suggested. Never one already suggested to the session,
//   or one inside or above it; never one the person dismissed in any office
//   (`expert-creation-suggestion-dismissals`: until its time, or for good), nor one inside it, by the
//   protocol's isDismissed, the rule the office uses too; and never one an expert on this computer
//   covers, by its file's areas (the protocol's areaCovers, the rule the office uses too). The
//   office checks other computers' experts itself. A folder whose draft couldn't be made, and the
//   folders inside and above it, wait RETRY_MS for that session before one is tried again, a
//   restart included; so does the folder of a suggestion every office it went to refused, from the
//   last refusal. Which sessions and folders were suggested, the folders waiting, the suggestions,
//   the expert creations under way and done, and the correction check's verdicts are kept in
//   <claude dir>/isoplan/runner/expert-creation-suggestions.json, the first two, and expert
//   creations once they ended, for `rememberDays`. One that can't be read as this runner writes it
//   is logged and moved aside (expert-creation-suggestions.json.unreadable-<ms>), and suggesting
//   starts again from nothing. While runner.json can't be read, each pass logs it and the next
//   tries again.
// - The draft: a `claude -p` call with no tools and no hooks (expert-creation-suggestion-model-calls.ts,
//   prompts/expert-draft.md, `draftModel`), on the person's own Claude account: what it is given
//   goes only to that account, never to the office. It writes the expert's key, subject and proof
//   question with its answer, from the names of the folder's files (in the session's checkout, at
//   most MAX_FILES), the start of the first few that read as text (EXCERPT_FILES, EXCERPT_CHARS
//   each), which its proof is taken from, and what the session said there. Its area is the folder
//   alone. The whole draft, its folder included, passes the secret scan before any of it is sent; a
//   match, or patterns that can't be read, means no suggestion, logged. A folder that matches isn't
//   drafted at all.
// - Nothing goes on a connection before its first `expert-creation-suggestion-dismissals` (protocol
//   0.15.0): a suggestion, an answer and an expert creation's progress wait for it, and then go live
//   (link.ts sendLive). Nor is a session's pass looked at before the office it came for has said
//   them, so a runner started again never suggests a folder its person dismissed. A suggestion goes
//   to each office whose latest pass of the session may name the suggestion's repo (the session's
//   own, or another repo that office holds), never to one whose dismissals name its folder; one
//   dismissed in any office is withdrawn from the others.
// - An office that sees several sessions search one folder asks the runner of the latest to draft
//   an office-wide suggestion (`draft-office-wide-expert-creation-suggestion`): drafted the same
//   way, from the newest of those sessions this runner reported to it, it goes to that office alone
//   as scope `office`, with the request's id, or `no-draft` goes back when none could be made. The
//   same request again, while one is being drafted or once it was, changes nothing.
// - An office ends a suggestion it won't keep at once: `refused` (the repo isn't taken there, the
//   session is someone else's, and the like), or `made` with the key of an expert that covers its
//   folder already. `refused` ends it in that office alone; `dismissed`, a person's dismissal on
//   the floor, and `made` withdraw it from the others too. So a suggestion counts as open in an
//   office only once `keptMs` has passed since it went there with no end; one sent on a connection
//   that closed first goes again on the next, which the office takes as the same suggestion. An end
//   can be lost with the connection it came on, so each suggestion open in an office goes again on
//   each new connection there, once its expert-creation-suggestion-dismissals came: the office
//   takes it as the same suggestion while it is open there, answers with its end once it ended, and
//   `refused` when it has no record of it from this runner.
// - While a suggestion is open, the session that showed the need is told through its hooks module,
//   if it is on this computer (lines.ts ExpertCreationSuggestionLine), and again each time a hooks
//   module connects for it; and when the suggestion ends, refused included. Made or dismissed in one
//   office, it is withdrawn from the others; made, the session is told the expert is ready
//   (ExpertReadyLine), once, by the next hooks module to connect when none is now. The open
//   suggestions of each session are also in
//   <claude dir>/isoplan/expert-creation-suggestions/<session>.json,
//   `{ "expertCreationSuggestions": ExpertCreationSuggestionLine[] }`, for
//   /isoplan:review-expert-suggestion; the file goes when none is open.
// - Make expert (`create-expert-from-suggestion`), only for this runner's own person (`by`): it
//   finds this computer's checkout of the repo as New session finds folders (repo-folders.ts). With
//   none, it clones the repo for the expert alone into Isoplan's own hidden folder
//   (isoplan-clone.ts, as a hidden start does; never into the person's folders), from
//   https://<project id>.git, then, when that fails, from git@<host>:<path>.git, git asking nothing
//   either way, saying `cloning` while it runs; a repo with no remote, or a clone git refuses both
//   ways, fails the creation with git's reasons. An expert of that name here already fails it at
//   once, saying why. Else it writes experts/<key>.json, naming the checkout or the clone as its
//   `repo`, whole or not at all, which the experts' watcher picks up (experts.ts), and follows the
//   expert's state.json (expert-state.ts) every `pollMs`, saying each step
//   (`expert-creation-progress`): cloning (its own clone), grounding, proof, then ready or failed,
//   within EXPERT_CREATION_LIMIT_MS. Anything that goes wrong before it is followed fails it, with
//   the reason; a look at its state that fails is logged and tried again on the next, and fails it
//   only past EXPERT_CREATION_LIMIT_MS. A creation that fails after writing the file removes it, so
//   the watcher stops that expert and its listing drops it; a create-expert-from-suggestion of the
//   same key after it starts fresh, once that expert has stopped (CLEARED_MS at most). A creation
//   stays in expert-creation-suggestions.json from its create-expert-from-suggestion, whether or not
//   it wrote its file, and for `rememberDays` once it is ready or failed: its last state can be lost
//   with the connection it went on, so it goes again on each new connection to its office. A runner
//   started again fails a creation that stopped before writing its file, and goes on following the
//   creations it had under way, on their requests; a create-expert-from-suggestion for the same
//   suggestion and key as one under way, as the office sends once that runner is back, takes it
//   over, and one for a creation that is ready answers ready again.
// - The correction check runs only when runner.json's `expertCreationSuggestions.correctionCheck`
//   turns it on (off by default, since each check spends the person's own tokens). Off, no message
//   is checked, and a correction is only an interruption or a tool call turned down. On, whether the
//   person's message corrected the agent (`corrected`) is a `claude -p` call's word too
//   (prompts/correction.md, `draftModel`), on the person's own Claude account, never the office's:
//   one call at a time and at most `checksPerHour`, and only for a session whose latest pass went to
//   an office whose connection has had its expert-creation-suggestion-dismissals, so none runs where
//   no suggestion could follow (an office from before expert creation suggestions sends none). Until
//   it comes the message counts nothing, and each later pass asks again, so a check that couldn't
//   run is tried again. Its word is kept in expert-creation-suggestions.json (at most
//   MAX_VERDICTS), so a runner started again never checks a message twice.

import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {
  areaCovers,
  expertDisplayName,
  ExpertCreationSuggestionMessageSchema,
  isDismissed,
  PROTOCOL_VERSION,
  type AreaFact,
  type DraftOfficeWideExpertCreationSuggestionMessage,
  type ExpertCreationProgressState,
  type ExpertCreationSuggestionMessage,
  type CreateExpertFromSuggestionMessage,
  type ExpertCreationSuggestionDismissal,
  type Project,
  type ServerExpertCreationSuggestionEndedMessage,
} from "@isoplan/protocol";
import type { RunnerExpertCreationSuggestionMessage, ServerExpertCreationSuggestionMessage } from "../data-layer/link.js";
import type { SessionAreas } from "../data-layer/report-session.js";
import type { DataLayerLine, ExpertCreationSuggestionLine } from "../lines.js";
import { parseExpertFile } from "./expert-file.js";
import { windowFor } from "./expert-meter.js";
import { readState } from "./expert-state.js";
import type { HostedExpert } from "./expert.js";
import type { Draft, DraftInput, ExpertCreationSuggestionModelCallSettings } from "./expert-creation-suggestion-model-calls.js";

/** runner.json's `expertCreationSuggestions`. */
export interface ExpertCreationSuggestionSettings extends ExpertCreationSuggestionModelCallSettings {
  /** The share of the session's context window a folder's reads and searches took, from 0 to 1. */
  contextShare: number;
  tokens: number;
  minutes: number;
  corrections: number;
  /** How long a session and folder already suggested, and a suggestion, are remembered. */
  rememberDays: number;
  /** The expert file's promoteAtTokens for an expert created from a suggestion. */
  promoteAtTokens: number;
  /** Whether the correction check runs: off, a correction is only an interruption or a turned-down tool call. */
  correctionCheck: boolean;
  /** The most correction checks an hour. */
  checksPerHour: number;
}

export interface ExpertCreationSuggestionsRunnerSettings {
  expertCreationSuggestions: ExpertCreationSuggestionSettings;
}

/** Why a suggestion is made: the signals of its folder. */
export type Why = ExpertCreationSuggestionMessage["why"];

/** An office this runner answers for, by its index in the offices' list. */
export interface ExpertCreationSuggestionOffice {
  /** Its data-layer address. */
  server: string;
  /** Its short name, as on the status line. */
  label?: string;
  /** Sends on its link while it is up; false when it isn't. */
  send(message: RunnerExpertCreationSuggestionMessage): boolean;
}

export interface ExpertCreationSuggestionsOptions {
  /** <claude dir>/isoplan */
  isoplanDir: string;
  settings: () => Promise<ExpertCreationSuggestionsRunnerSettings>;
  offices: readonly ExpertCreationSuggestionOffice[];
  /** This runner's person: a create-expert-from-suggestion for anyone else is refused. */
  account: { id: string };
  /** The name of the secret pattern `text` matches, UNREADABLE when they can't be read, or null. */
  scan: (text: string) => Promise<string | null>;
  draft: (input: DraftInput, settings: ExpertCreationSuggestionSettings) => Promise<Draft | null>;
  /** Whether a message corrected the agent; null when no word came. */
  corrects: (text: string, reply: string | null, settings: ExpertCreationSuggestionSettings) => Promise<boolean | null>;
  /** The experts this computer hosts. */
  experts: () => HostedExpert[];
  /** The project id of the repo a folder is in, lower-cased; null when there is none. */
  projectOf: (folder: string) => Promise<string | null>;
  /** This computer's checkout of `project`, as the office at `index` takes it (repo-folders.ts); null when there is none. */
  checkout: (index: number, project: Project) => Promise<string | null>;
  /** Isoplan's own hidden clone of `project` (an id), made from `url` or fetched (isoplan-clone.ts): its folder, or why there is none, with git's own words when git failed. */
  clone: (url: string, project: string) => Promise<string | { problem: string; reason?: string }>;
  /** The session's hooks module, while one is connected. */
  hooked: (bare: string) => { send(line: DataLayerLine): void } | null;
  log: (text: string) => void;
  now?: () => number;
  /** How often an expert being made is looked at. */
  pollMs?: number;
  /** How long a suggestion that went to an office must go unended there to count as open (KEPT_MS). */
  keptMs?: number;
}

export interface ExpertCreationSuggestions {
  /** Reads expert-creation-suggestions.json: before it settles, nothing is suggested. The expert creations under way when the runner stopped are followed again. */
  start(): Promise<void>;
  /** One pass's areas of a session for one office (report-session.ts `areas`). */
  seen(s: SessionAreas): void;
  /** report-session.ts `corrected`, for the session `bare`: null, with no check, unless its latest pass went to an office whose connection has had its expert-creation-suggestion-dismissals. */
  corrected(bare: string, key: string, text: string, reply: string | null): boolean | null;
  /** A message from the office at `index`. */
  take(index: number, message: ServerExpertCreationSuggestionMessage): void;
  /** The office's link opened, or closed: nothing goes on it until its next expert-creation-suggestion-dismissals. */
  linked(index: number): void;
  /** A session's hooks module connected, changed or went (pipe server's onChange). */
  rehooked(bare: string): void;
  /** No draft, check, expert creation or suggestion waiting to be kept under way. */
  idle(): boolean;
  close(): void;
}

/** The most files of a folder a draft is given by name; and of those, the most it is given the start of, and how much. */
export const MAX_FILES = 200;
export const EXCERPT_FILES = 6;
export const EXCERPT_CHARS = 3000;
/** How long creating an expert may take before it is said to have failed. */
export const EXPERT_CREATION_LIMIT_MS = 60 * 60000;
/** How long an office has to end a suggestion it won't keep, which it does at once, before it counts as open there. */
export const KEPT_MS = 5000;
/** How long a folder whose draft couldn't be made waits, for that session, before it is tried again. */
export const RETRY_MS = 60 * 60000;
/** How long a creation of a key whose creation failed here waits for the expert it left to stop: two of the experts' watcher's looks, and more. */
export const CLEARED_MS = 60000;
// The most messages waiting for the correction check, and verdicts remembered.
const MAX_CHECKS_WAITING = 50;
const MAX_VERDICTS = 1000;
// The most sessions whose latest pass is kept for office-wide drafts, the least recently seen going first.
const MAX_SESSIONS = 200;
// How long an expert's repo's project, and runner.json's expertCreationSuggestions, are believed.
const PROJECT_MS = 5 * 60000;
const SETTINGS_MS = 5000;
const HOUR_MS = 3600000;
const DAY_MS = 86400000;
const FILE_VERSION = 1;

/** The address of a suggestion's review on the office's floor: its http address, with `/?expert-creation-suggestion=<id>`. */
export function reviewUrl(server: string, id: string): string {
  const url = new URL(server);
  url.protocol = url.protocol === "wss:" ? "https:" : "http:";
  url.pathname = url.pathname.replace(/\/data-layer\/?$/, "") + "/";
  url.search = `expert-creation-suggestion=${id}`;
  url.hash = "";
  return url.toString();
}

/** A folder's signals, given the session's context window (null when it isn't known): its minutes to a tenth, rounded down. */
export function signalsOf(area: AreaFact, window: number | null): Why {
  return { share: window ? Math.min(1, area.tokens / window) : 0, tokens: area.tokens, minutes: Math.floor(area.ms / 6000) / 10, corrections: area.corrections };
}

/** Whether a folder's signals pass any of their thresholds. */
export const passes = (why: Why, t: ExpertCreationSuggestionSettings) => why.share >= t.contextShare || why.tokens >= t.tokens || why.minutes >= t.minutes || why.corrections >= t.corrections;

/** The signals a suggestion gives (ADR 0004): those that passed their thresholds, each other one 0. Share and tokens are one signal, what reading and searching there took. */
export function passed(why: Why, t: ExpertCreationSuggestionSettings): Why {
  const spent = why.share >= t.contextShare || why.tokens >= t.tokens;
  return { share: spent ? why.share : 0, tokens: spent ? why.tokens : 0, minutes: why.minutes >= t.minutes ? why.minutes : 0, corrections: why.corrections >= t.corrections ? why.corrections : 0 };
}

// `folder` is `other`, or inside it; or either is inside the other.
const within = (folder: string, other: string) => other === "." || folder === other || folder.startsWith(other + "/");
const near = (a: string, b: string) => within(a, b) || within(b, a);

/** The addresses Isoplan's own clone of a project is made from where this computer has no checkout, in order: https from its id, then ssh; none for a repo with no remote. */
export function cloneUrls(project: string): string[] {
  if (project.startsWith("local:")) return [];
  const [host, ...rest] = project.split("/");
  return rest.length ? [`https://${project}.git`, `git@${host}:${rest.join("/")}.git`] : [`https://${project}.git`];
}

/** The files under `folder` of `checkout`, relative to it, by name, at most `max`; dot entries and node_modules left out. */
export async function folderFiles(checkout: string, folder: string, max = MAX_FILES): Promise<string[]> {
  const out: string[] = [];
  const queue = [folder === "." ? "" : folder];
  while (queue.length && out.length < max) {
    const rel = queue.shift()!;
    const entries = await fs.readdir(path.join(checkout, rel), { withFileTypes: true }).catch(() => []);
    for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (e.name.startsWith(".") || e.name === "node_modules") continue;
      const p = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) queue.push(p);
      else if (e.isFile() && out.length < max) out.push(p);
    }
  }
  return out;
}

/** The start of the first `max` of `files` (relative to `checkout`) that read as text, each at most EXCERPT_CHARS; an empty file, or one with a NUL byte, is left out. */
export async function folderExcerpts(checkout: string, files: readonly string[], max = EXCERPT_FILES): Promise<{ file: string; text: string }[]> {
  const out: { file: string; text: string }[] = [];
  for (const file of files) {
    if (out.length >= max) break;
    const handle = await fs.open(path.join(checkout, file), "r").catch(() => null);
    if (!handle) continue;
    try {
      // Enough bytes for EXCERPT_CHARS characters of any UTF-8.
      const { bytesRead, buffer } = await handle.read(Buffer.alloc(EXCERPT_CHARS * 4), 0, EXCERPT_CHARS * 4, 0);
      const bytes = buffer.subarray(0, bytesRead);
      const text = bytes.includes(0) ? "" : bytes.toString("utf8").slice(0, EXCERPT_CHARS).trim();
      if (text) out.push({ file, text });
    } catch {
      // One that can't be read is left out.
    } finally {
      await handle.close().catch(() => {});
    }
  }
  return out;
}

// What a write leaves while it is under way: never a file the experts' watcher reads (*.json).
async function writeWhole(file: string, text: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(temp, text);
  // On Windows a reader that has the file open makes the rename fail for a moment.
  for (let tries = 0; ; tries++) {
    try {
      return await fs.rename(temp, file);
    } catch (err) {
      if (tries >= 5 || !["EPERM", "EBUSY", "EACCES"].includes((err as NodeJS.ErrnoException).code ?? "")) throw err;
      await new Promise((r) => setTimeout(r, 50 * (tries + 1)));
    }
  }
}

/** Where a suggestion is in one office: waiting for its connection, sent there but not yet kept (KEPT_MS), open there, ended, or refused by that office alone. */
type ExpertCreationSuggestionStateInOffice = "pending" | "sent" | "open" | "ended" | "refused";

/** One suggestion this runner made, as expert-creation-suggestions.json keeps it. */
interface ExpertCreationSuggestionRecord {
  id: string;
  scope: "session" | "office";
  /** The session that showed the need, as its facts name it, and its bare id. */
  session: string;
  bare: string | null;
  project: Project;
  folder: string;
  key: string;
  at: number;
  message: ExpertCreationSuggestionMessage;
  /** Where it is, by office. */
  offices: Record<string, ExpertCreationSuggestionStateInOffice>;
  /** The expert made from it, in which office, and whether the session has been told. */
  made?: { key: string; server: string };
  told?: boolean;
  /** When the last office it went to refused it: from RETRY_MS after, its folder may be suggested to its session again. */
  refusedAt?: number;
}

interface Saved {
  version: number;
  /** Each session's folders already suggested, when, and as which suggestion. */
  foldersAlreadySuggested: { session: string; project: string; folder: string; at: number; expertCreationSuggestionId?: string }[];
  expertCreationSuggestions: ExpertCreationSuggestionRecord[];
  /** The experts being made here, by the office the request came from, and for `rememberDays` once made or failed, with their last state, which goes again on each new connection. */
  expertCreations: { request: string; expertCreationSuggestionId: string; key: string; since: number; server: string; state?: "ready" | "failed"; detail?: string; wrote?: boolean }[];
  /** Folders whose draft couldn't be made, by session, until they may be tried again. */
  held: { session: string; project: string; folder: string; until: number }[];
  /** The correction check's verdicts, by message, oldest first: a runner started again never checks a message twice. */
  verdicts?: [string, boolean][];
}

/** An expert being made here. */
interface ExpertCreation {
  index: number;
  request: string;
  expertCreationSuggestionId: string;
  key: string;
  since: number;
  state: ExpertCreationProgressState;
  detail?: string;
  /** The state last sent on the office's connection. */
  sent: string | null;
  /** Whether this creation wrote its expert file and it is still there: it goes if the creation fails. */
  wrote: boolean;
  /** While its create-expert-from-suggestion, or a look at its state, runs. */
  working: boolean;
  /** Why the last look at its state failed, while looks fail. */
  problem?: string;
  timer: ReturnType<typeof setTimeout> | null;
}

export function createExpertCreationSuggestions(o: ExpertCreationSuggestionsOptions): ExpertCreationSuggestions {
  const now = o.now ?? Date.now;
  const pollMs = o.pollMs ?? 2000;
  const keptMs = o.keptMs ?? KEPT_MS;
  const file = path.join(o.isoplanDir, "runner", "expert-creation-suggestions.json");
  const sessionFile = (bare: string) => path.join(o.isoplanDir, "expert-creation-suggestions", `${bare}.json`);
  const expertFile = (key: string) => path.join(o.isoplanDir, "experts", `${key}.json`);
  // `fresh`: its connection is new, so the suggestions open there go again once it is ready.
  const offices = o.offices.map(() => ({ ready: false, fresh: true, dismissals: [] as ExpertCreationSuggestionDismissal[], queue: [] as RunnerExpertCreationSuggestionMessage[] }));
  let saved: Saved = { version: FILE_VERSION, foldersAlreadySuggested: [], expertCreationSuggestions: [], expertCreations: [], held: [] };
  let started = false;
  let closed = false;
  // The latest pass of each session for each office that took it, by the session's id: which
  // offices may be told of which of its repos, and what office-wide drafts are made from.
  const latest = new Map<string, Map<string, SessionAreas>>();
  const busy = new Set<string>(); // the sessions whose areas are being looked at, or drafted from
  const officeWideSuggestionRequestsBeingDrafted = new Set<string>(); // the draft-office-wide-expert-creation-suggestion requests being drafted
  // The keys whose expert file a failed creation removed, until the experts' watcher has stopped that expert.
  const cleared = new Set<string>();
  // The suggestions sent to an office and not yet kept there, by `<id>\n<server>`: each one's wait.
  const keeping = new Map<string, ReturnType<typeof setTimeout>>();
  const expertCreations = new Map<string, ExpertCreation>();
  // The correction check: verdicts by key, the messages waiting, and when each check of the last hour ran.
  const verdicts = new Map<string, boolean>();
  const waiting: { bare: string; key: string; text: string; reply: string | null }[] = [];
  const checked: number[] = [];
  let checking = false;
  // runner.json's correctionCheck, as last read.
  let checkOn = false;
  let checkTimer: ReturnType<typeof setTimeout> | null = null;
  let saving: Promise<void> = Promise.resolve();

  // Read again at most every SETTINGS_MS: every session's pass looks at them.
  let read: { at: number; settings: Promise<ExpertCreationSuggestionSettings> } | null = null;
  const settings = () => {
    if (!read || now() - read.at > SETTINGS_MS) read = { at: now(), settings: o.settings().then((s) => ((checkOn = s.expertCreationSuggestions.correctionCheck === true), s.expertCreationSuggestions)) };
    const mine = read;
    return mine.settings.catch((err: unknown) => (read === mine && (read = null), Promise.reject(err)));
  };
  const indexOf = (server: string) => o.offices.findIndex((f) => f.server === server);
  const say = (text: string) => o.log(text);
  const done = (m: ExpertCreation) => m.state === "ready" || m.state === "failed";

  const save = () => {
    const copy = JSON.stringify(saved, null, 2) + "\n";
    saving = saving.then(() => writeWhole(file, copy)).catch((err: Error) => say(`couldn't save the expert creation suggestions: ${err.message}`));
    return saving;
  };

  // What the session's hooks module is told of a suggestion open in one office.
  const lineOf = (r: ExpertCreationSuggestionRecord, server: string): ExpertCreationSuggestionLine => {
    const label = o.offices[indexOf(server)]?.label;
    return { type: "expert-creation-suggestion", server, ...(label && { label }), id: r.id, key: r.key, name: expertDisplayName(r.key), folder: r.folder, url: reviewUrl(server, r.id), why: r.message.why };
  };
  const tell = (r: ExpertCreationSuggestionRecord, line: DataLayerLine) => (r.bare ? o.hooked(r.bare)?.send(line) : undefined);

  // The session's file of its open suggestions, for /isoplan:review-expert-suggestion; gone when none is open. One write at
  // a time for each session, each with the suggestions open as it runs.
  const sessionWrites = new Map<string, Promise<void>>();
  function writeSessionFile(bare: string | null) {
    if (!bare || !/^[\w-]{1,200}$/.test(bare)) return;
    const write = async () => {
      const open = saved.expertCreationSuggestions.filter((r) => r.bare === bare).flatMap((r) => Object.entries(r.offices).filter(([, s]) => s === "open").map(([server]) => lineOf(r, server)));
      if (open.length) await writeWhole(sessionFile(bare), JSON.stringify({ expertCreationSuggestions: open }, null, 2) + "\n");
      else await fs.rm(sessionFile(bare), { force: true });
    };
    const next = (sessionWrites.get(bare) ?? Promise.resolve())
      .then(write)
      .catch((err: Error) => say(`couldn't write the open expert creation suggestions of session ${bare}: ${err.message}`))
      .finally(() => sessionWrites.get(bare) === next && sessionWrites.delete(bare));
    sessionWrites.set(bare, next);
  }

  // Sends what waits for the office at `index`, once its connection has had expert-creation-suggestion-dismissals. An
  // suggestion whose folder its dismissals name isn't sent, and is withdrawn wherever else it went.
  function flush(index: number) {
    const office = o.offices[index]!;
    const st = offices[index]!;
    if (!st.ready || closed) return;
    while (st.queue.length && office.send(st.queue[0]!)) st.queue.shift();
    // An end the office sent on an earlier connection may never have come: each suggestion open there
    // goes again, the same suggestion to the office, which answers with its end if it has one.
    if (st.fresh) {
      st.fresh = false;
      for (const r of saved.expertCreationSuggestions) if (r.offices[office.server] === "open") office.send(r.message);
    }
    let changed = false;
    for (const r of saved.expertCreationSuggestions) {
      if (r.offices[office.server] !== "pending") continue;
      if (isDismissed(st.dismissals, r.project.id, r.folder, now())) {
        r.offices[office.server] = "ended";
        changed = true;
        say(`the expert creation suggestion ${r.id} on ${r.folder} of ${r.project.name} isn't sent to ${office.server}, where its person dismissed that folder, and is withdrawn wherever else it went`);
        withdraw(r);
        writeSessionFile(r.bare);
        continue;
      }
      if (!office.send(r.message)) continue;
      r.offices[office.server] = "sent";
      changed = true;
      say(`suggested an expert on ${r.folder} of ${r.project.name} (${r.key}) to ${office.server}, as ${r.id}`);
      keep(r, office.server);
    }
    if (changed) void save();
    for (const m of expertCreations.values()) if (m.index === index) sendExpertCreationProgress(m);
  }

  // A suggestion the office hasn't ended within keptMs of its going is open there, and its session is told.
  function keep(r: ExpertCreationSuggestionRecord, server: string) {
    const k = `${r.id}\n${server}`;
    clearTimeout(keeping.get(k));
    const timer = setTimeout(() => {
      keeping.delete(k);
      if (closed || r.offices[server] !== "sent") return;
      r.offices[server] = "open";
      tell(r, lineOf(r, server));
      writeSessionFile(r.bare);
      void save();
    }, keptMs);
    timer.unref?.();
    keeping.set(k, timer);
  }

  // Ends the suggestion in every office it hasn't ended in: one it went to is told it is withdrawn, and
  // the session of one open there that it went.
  function withdraw(r: ExpertCreationSuggestionRecord) {
    for (const [other, state] of Object.entries(r.offices)) {
      if (state === "ended" || state === "refused") continue;
      r.offices[other] = "ended";
      const i = indexOf(other);
      if (state === "pending" || i < 0) continue;
      sendOrQueue(i, { type: "expert-creation-suggestion-ended", v: PROTOCOL_VERSION, id: r.id, why: "withdrawn" });
      if (state === "open") tell(r, { type: "expert-creation-suggestion-ended", server: other, id: r.id, why: "withdrawn" });
    }
  }

  // Sends now when the office's connection is ready and up; else it waits there for flush.
  function sendOrQueue(index: number, message: RunnerExpertCreationSuggestionMessage) {
    const st = offices[index]!;
    if (!(st.ready && o.offices[index]!.send(message))) st.queue.push(message);
  }

  // Whether an expert on this computer covers `folder` of `project`. Its repo's project is looked up
  // again only every PROJECT_MS, since a covered folder that passes is looked at every pass.
  const expertProjects = new Map<string, { at: number; project: Promise<string | null> }>();
  async function coveredHere(project: string, folder: string) {
    for (const e of o.experts()) {
      if (!e.areas?.length || !areaCovers(e.areas, folder)) continue;
      let hit = expertProjects.get(e.repo);
      if (!hit || now() - hit.at > PROJECT_MS) expertProjects.set(e.repo, (hit = { at: now(), project: o.projectOf(e.repo).catch(() => null) }));
      if ((await hit.project) === project) return true;
    }
    return false;
  }

  // A suggestion every office it went to refused, RETRY_MS ago or more: its folder may be suggested to its session again.
  const retryable = (r: ExpertCreationSuggestionRecord | undefined, at: number) => !!r?.refusedAt && at - r.refusedAt >= RETRY_MS && Object.values(r.offices).every((s) => s === "refused");
  const alreadySuggestedNear = (session: string, project: string, folder: string, at: number) =>
    saved.foldersAlreadySuggested.some((x) => x.session === session && x.project === project && near(folder, x.folder) && !(x.expertCreationSuggestionId && retryable(saved.expertCreationSuggestions.find((r) => r.id === x.expertCreationSuggestionId), at)));
  const heldNear = (session: string, project: string, folder: string, at: number) =>
    (saved.held = saved.held.filter((x) => x.until > at)).some((x) => x.session === session && x.project === project && near(folder, x.folder));

  // The repos an office's pass of a session may name, lower-cased: the session's own as it says
  // hello there, and the others its areas were let through for (report-session.ts).
  const names = (s: SessionAreas) => new Set([s.project, ...s.areas.map((a) => a.project ?? s.project)].map((p) => p.id.toLowerCase()));
  // The offices whose latest pass of the session may name `project`.
  const mayTell = (session: string, project: string) => [...(latest.get(session)?.values() ?? [])].filter((p) => names(p).has(project)).map((p) => p.server);
  // Whether the session `bare` has its latest pass in an office whose connection has had its
  // expert-creation-suggestion-dismissals: only then may a suggestion follow, and so a correction check run.
  const couldBeSuggested = (bare: string) => [...latest.values()].some((byOffice) => [...byOffice.values()].some((p) => p.bare === bare && !!offices[indexOf(p.server)]?.ready));

  // What is older than rememberDays goes: folders already suggested and suggestions, ended or not, and expert creations made or failed.
  function forget(t: ExpertCreationSuggestionSettings, at: number) {
    const keep = t.rememberDays * DAY_MS;
    saved.foldersAlreadySuggested = saved.foldersAlreadySuggested.filter((x) => at - x.at < keep);
    saved.expertCreationSuggestions = saved.expertCreationSuggestions.filter((r) => at - r.at < keep);
    const old = saved.expertCreations.filter((k) => k.state && at - k.since >= keep);
    if (!old.length) return;
    for (const k of old) expertCreations.delete(k.request);
    saved.expertCreations = saved.expertCreations.filter((k) => !old.includes(k));
    void save();
  }

  const windowOf = (s: SessionAreas) => {
    if (s.window) return s.window;
    const w = s.model ? windowFor(s.model) : null;
    return w && w.ok ? w.window : null;
  };

  // The draft of an expert on `folder`, secret-checked, as an expert-creation-suggestion; null when there is none to send.
  async function drafted(a: { id: string; scope: "session" | "office"; session: string; project: Project; folder: string; checkout: string | null; said: string[]; why: Why }, t: ExpertCreationSuggestionSettings): Promise<ExpertCreationSuggestionMessage | null> {
    const where = `${a.folder} of ${a.project.name}`;
    if (!a.checkout) {
      say(`no expert is suggested on ${where}: this computer has no checkout of the repo to draft it from`);
      return null;
    }
    // Its folder leaves with it, so one that matches isn't drafted (nor written in the log).
    const named = await o.scan(a.folder);
    if (named) {
      say(`no expert is suggested on a folder of ${a.project.name}: its path matches the secret pattern "${named}"`);
      return null;
    }
    const files = await folderFiles(a.checkout, a.folder);
    const excerpts = await folderExcerpts(a.checkout, files);
    if (!excerpts.length) {
      say(`no expert is suggested on ${where}: none of its files could be read to draft it from`);
      return null;
    }
    const draft = await o.draft({ project: a.project, folder: a.folder, files, excerpts, said: a.said }, t);
    if (!draft) {
      say(`no expert is suggested on ${where}: no usable draft came`);
      return null;
    }
    // The whole draft, its folder (its one area) included.
    const matched = await o.scan([a.folder, draft.key, draft.subject, draft.proof.question, draft.proof.answer].join("\n"));
    if (matched) {
      say(`no expert is suggested on ${where}: its draft matches the secret pattern "${matched}"`);
      return null;
    }
    const message = { type: "expert-creation-suggestion" as const, v: PROTOCOL_VERSION, id: a.id, session: a.session, project: { id: a.project.id, name: a.project.name }, folder: a.folder, scope: a.scope, key: draft.key, subject: draft.subject, area: [a.folder], proof: draft.proof, why: passed(a.why, t), at: new Date(now()).toISOString() };
    const parsed = ExpertCreationSuggestionMessageSchema.safeParse(message);
    if (!parsed.success) {
      say(`no expert is suggested on ${where}: its suggestion doesn't fit the protocol: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
      return null;
    }
    return parsed.data;
  }

  const record = (message: ExpertCreationSuggestionMessage, bare: string | null, servers: Iterable<string>): ExpertCreationSuggestionRecord => ({
    id: message.id,
    scope: message.scope,
    session: message.session,
    bare,
    project: message.project,
    folder: message.folder,
    key: message.key,
    at: now(),
    message,
    offices: Object.fromEntries([...servers].map((s) => [s, "pending" as const])),
  });

  // A session's pass, once the office it came for has said its person's dismissals: the deepest
  // folder that passes, not already suggested, held, dismissed or covered, is drafted and suggested.
  async function consider(s: SessionAreas) {
    const index = indexOf(s.server);
    if (!offices[index]!.ready) return;
    const t = await settings();
    const window = windowOf(s);
    const at = now();
    forget(t, at);
    const candidates: { area: AreaFact; project: Project; why: Why }[] = [];
    for (const area of s.areas) {
      const project = area.project ?? s.project;
      const id = project.id.toLowerCase();
      const why = signalsOf(area, window);
      if (!passes(why, t) || alreadySuggestedNear(s.session, id, area.folder, at) || heldNear(s.session, id, area.folder, at)) continue;
      if (offices.some((f) => isDismissed(f.dismissals, id, area.folder, at))) continue;
      if (await coveredHere(id, area.folder)) continue;
      candidates.push({ area, project, why });
    }
    const depth = (folder: string) => folder.split("/").length;
    const best = candidates.sort((a, b) => depth(b.area.folder) - depth(a.area.folder) || b.area.tokens - a.area.tokens)[0];
    if (!best) return;
    const { area, project, why } = best;
    const id = project.id.toLowerCase();
    const checkout = area.project ? await o.checkout(index, project).catch(() => null) : s.checkout;
    const said = await s.said(area.project ? area.project.id : null, area.folder).catch(() => []);
    const message = await drafted({ id: randomBytes(12).toString("base64url"), scope: "session", session: s.session, project, folder: area.folder, checkout, said, why }, t);
    if (closed) return;
    if (!message) {
      saved.held.push({ session: s.session, project: id, folder: area.folder, until: now() + RETRY_MS });
      return void save();
    }
    saved.foldersAlreadySuggested.push({ session: s.session, project: id, folder: area.folder, at, expertCreationSuggestionId: message.id });
    saved.expertCreationSuggestions.push(record(message, s.bare, new Set([s.server, ...mayTell(s.session, id)])));
    await save();
    o.offices.forEach((_, i) => flush(i));
  }

  // An office-wide draft, from the newest of the sessions it names that this runner reported to that office.
  async function draftOfficeWideExpertCreationSuggestion(index: number, m: DraftOfficeWideExpertCreationSuggestionMessage) {
    const server = o.offices[index]!.server;
    if (officeWideSuggestionRequestsBeingDrafted.has(m.request) || saved.expertCreationSuggestions.some((r) => r.id === m.request)) return;
    officeWideSuggestionRequestsBeingDrafted.add(m.request);
    try {
      const project = m.project.id.toLowerCase();
      // Whatever stops the draft, the office is answered at once rather than left waiting for it.
      let message: ExpertCreationSuggestionMessage | null = null;
      try {
        const s = m.sessions.map((id) => latest.get(id)?.get(server)).find((x) => !!x);
        const area = s?.areas.find((a) => a.folder === m.folder && (a.project ?? s.project).id.toLowerCase() === project);
        const own = !!s && s.project.id.toLowerCase() === project && !area?.project;
        const checkout = own ? s!.checkout : await o.checkout(index, m.project).catch(() => null);
        const said = s ? await s.said(own ? null : m.project.id, m.folder).catch(() => []) : [];
        const why = area && s ? signalsOf(area, windowOf(s)) : { share: 0, tokens: 0, minutes: 0, corrections: 0 };
        const t = await settings();
        message = await drafted({ id: m.request, scope: "office", session: m.sessions[0]!, project: m.project, folder: m.folder, checkout, said, why }, t);
      } catch (err) {
        say(`no office-wide expert is suggested on ${m.folder} of ${m.project.name} (${m.request}): drafting it failed: ${(err as Error).message}`);
      }
      if (closed) return;
      if (!message) return sendOrQueue(index, { type: "expert-creation-suggestion-ended", v: PROTOCOL_VERSION, id: m.request, why: "no-draft" });
      const first = m.sessions[0]!;
      // Its session isn't suggested the same folder again on its own.
      saved.foldersAlreadySuggested.push({ session: first, project, folder: m.folder, at: now(), expertCreationSuggestionId: m.request });
      saved.expertCreationSuggestions.push(record(message, first.startsWith("claude-code:") ? first.slice("claude-code:".length) : null, [server]));
      await save();
      flush(index);
    } finally {
      officeWideSuggestionRequestsBeingDrafted.delete(m.request);
    }
  }

  // How a suggestion ended in one office; made or dismissed there, it is withdrawn from the others, and
  // refused there, it ends there alone. One that ended before it was kept was never shown, so its
  // session isn't told it ended.
  function ended(index: number, m: ServerExpertCreationSuggestionEndedMessage) {
    const server = o.offices[index]!.server;
    const r = saved.expertCreationSuggestions.find((x) => x.id === m.id);
    if (!r || r.offices[server] === undefined) return say(`${server} says the expert creation suggestion ${m.id} ended, but this runner didn't suggest it there`);
    const was = r.offices[server];
    r.offices[server] = m.why === "refused" ? "refused" : "ended";
    if (Object.values(r.offices).every((s) => s === "refused")) r.refusedAt = now();
    if (was === "open") tell(r, { type: "expert-creation-suggestion-ended", server, id: r.id, why: m.why });
    say(`the expert creation suggestion ${r.id} on ${r.folder} of ${r.project.name} ended in ${server}: ${m.why}`);
    if (m.why === "made") {
      r.made = { key: m.key, server };
      withdraw(r);
      tellReady(r);
    } else if (m.why === "dismissed") withdraw(r);
    void save();
    writeSessionFile(r.bare);
  }

  function tellReady(r: ExpertCreationSuggestionRecord) {
    const hooks = r.made && !r.told && r.bare ? o.hooked(r.bare) : null;
    if (!hooks || !r.made) return;
    hooks.send({ type: "expert-ready", server: r.made.server, id: r.id, key: r.made.key, name: expertDisplayName(r.made.key), folder: r.folder });
    r.told = true;
    void save();
  }

  // Sends the creation's progress on its office's connection once it is ready, unless it went already on
  // that connection. A last state can be lost with the connection it went on, so it goes again on
  // each new one, for as long as expert-creation-suggestions.json keeps the creation (rememberDays).
  function sendExpertCreationProgress(m: ExpertCreation) {
    const text = `${m.state}\n${m.detail ?? ""}`;
    if (m.sent !== text && offices[m.index]!.ready && o.offices[m.index]!.send({ type: "expert-creation-progress", v: PROTOCOL_VERSION, request: m.request, expertCreationSuggestionId: m.expertCreationSuggestionId, state: m.state, ...(m.detail && { detail: m.detail }) })) m.sent = text;
  }

  function setExpertCreationProgress(m: ExpertCreation, state: ExpertCreationProgressState, detail?: string) {
    const changed = m.state !== state || m.detail !== detail;
    m.state = state;
    m.detail = detail;
    if (changed && done(m)) {
      say(`expert ${m.key}, created from suggestion ${m.expertCreationSuggestionId}: ${state}${detail ? `: ${detail}` : ""}`);
      if (m.timer) clearTimeout(m.timer);
      m.timer = null;
      // Kept with its last state, so a runner started again sends it as it was.
      const kept = saved.expertCreations.find((k) => k.request === m.request);
      if (kept) {
        Object.assign(kept, { state, ...(detail && { detail }) });
        void save();
      }
      if (state === "failed" && m.wrote) void clear(m);
    }
    sendExpertCreationProgress(m);
  }

  // A failed creation's expert file goes, so the experts' watcher stops that expert and its listing
  // drops it; a make of the same key may then start fresh.
  async function clear(m: ExpertCreation) {
    const key = m.key;
    cleared.add(key);
    try {
      await fs.rm(expertFile(key), { force: true });
      say(`removed the expert file of ${key}, whose creation failed, so this computer stops hosting it`);
      // Gone, so a runner started again never removes a later expert's file of that key.
      m.wrote = false;
      const kept = saved.expertCreations.find((k) => k.request === m.request);
      if (kept) kept.wrote = false;
      void save();
    } catch (err) {
      say(`couldn't remove the expert file ${expertFile(key)}, whose creation failed: ${(err as Error).message}`);
    }
  }

  // Whether the expert a failed creation cleared has stopped here, waiting CLEARED_MS at most.
  async function stopped(key: string) {
    for (let waited = 0; o.experts().some((e) => e.name === key); waited += pollMs) {
      if (closed || waited >= CLEARED_MS) return false;
      await new Promise((r) => setTimeout(r, pollMs));
    }
    cleared.delete(key);
    return true;
  }

  // Where the expert being made stands, from its newest generation grounded since its creation began (a
  // folder an earlier expert of that name left has older ones), and the runner's view of it.
  // A look that fails is said, once while it keeps failing the same way, and tried again on the next tick.
  async function follow(m: ExpertCreation) {
    m.timer = null;
    if (closed || done(m)) return;
    m.working = true;
    let step: ExpertCreationProgressState | null = null;
    try {
      const st = await readState(path.join(o.isoplanDir, "experts", m.key));
      const hosted = o.experts().find((e) => e.name === m.key);
      const g = st?.generations.filter((x) => x.groundedAt >= m.since).reduce<(typeof st.generations)[number] | null>((a, b) => (!a || b.n > a.n ? b : a), null) ?? null;
      delete m.problem;
      if (g?.state === "junior" || g?.state === "senior") return setExpertCreationProgress(m, "ready");
      if (g?.state === "failed") return setExpertCreationProgress(m, "failed", g.proof?.passed === false ? "its answer to the proof question didn't match the answer expected" : "its grounding failed; its health log on that computer says why");
      if (!g && hosted?.state === "failed") return setExpertCreationProgress(m, "failed", "its own copy of the repo couldn't be made");
      step = !g ? "cloning" : g.commit ? "proof" : "grounding";
    } catch (err) {
      const problem = (err as Error).message;
      if (m.problem !== problem) say(`couldn't look at how expert ${m.key}, created from suggestion ${m.expertCreationSuggestionId}, is coming along (${problem}); it is looked at again`);
      m.problem = problem;
    } finally {
      m.working = false;
    }
    if (closed || done(m)) return;
    if (now() - m.since > EXPERT_CREATION_LIMIT_MS) return setExpertCreationProgress(m, "failed", `it wasn't ready within ${EXPERT_CREATION_LIMIT_MS / 60000} minutes${m.problem ? `; the last look at it failed: ${m.problem}` : ""}`);
    if (step) setExpertCreationProgress(m, step);
    m.timer = setTimeout(() => void follow(m).catch(orLog(`follow expert ${m.key}`)), pollMs);
    m.timer.unref?.();
  }

  async function createExpertFromSuggestion(index: number, m: CreateExpertFromSuggestionMessage) {
    if (expertCreations.has(m.request)) return;
    const server = o.offices[index]!.server;
    // The same suggestion and key asked again, as the office asks once a runner that went mid-creation is
    // back, or a maker whose ready was lost asks: the creation under way, or made, answers it, from where it is.
    const same = m.by.id === o.account.id ? [...expertCreations.values()].find((x) => x.expertCreationSuggestionId === m.expertCreationSuggestionId && x.key === m.key && x.state !== "failed") : undefined;
    if (same) {
      expertCreations.delete(same.request);
      const kept = saved.expertCreations.find((k) => k.request === same.request);
      if (kept) Object.assign(kept, { request: m.request, server });
      Object.assign(same, { request: m.request, index, sent: null });
      expertCreations.set(m.request, same);
      say(`expert ${m.key}, created from suggestion ${m.expertCreationSuggestionId}, is asked for again as ${m.request}: its creation goes on`);
      void save();
      return sendExpertCreationProgress(same);
    }
    const expertCreation: ExpertCreation = { index, request: m.request, expertCreationSuggestionId: m.expertCreationSuggestionId, key: m.key, since: now(), state: "cloning", sent: null, wrote: false, working: true, timer: null };
    expertCreations.set(m.request, expertCreation);
    // Kept from now until its last state went, whether or not it gets as far as writing its file.
    const kept: Saved["expertCreations"][number] = { request: m.request, expertCreationSuggestionId: m.expertCreationSuggestionId, key: m.key, since: expertCreation.since, server, wrote: false };
    saved.expertCreations.push(kept);
    void save();
    const fail = (detail: string) => setExpertCreationProgress(expertCreation, "failed", detail);
    try {
      if (m.by.id !== o.account.id) return fail("this computer's runner is someone else's, so it makes experts only for them");
      // A key whose creation failed here is free once the expert it left has stopped.
      if (cleared.has(m.key) && !(await stopped(m.key))) return fail(`the expert named ${m.key}, whose creation failed, is still stopping on this computer; try again in a minute`);
      const taken = o.experts().some((e) => e.name === m.key) || (await fs.stat(expertFile(m.key)).then(() => true, () => false));
      if (taken) return fail(`an expert named ${m.key} is already on this computer`);
      let checkout = await o.checkout(index, m.project).catch(() => null);
      if (!checkout) {
        // For the expert alone: Isoplan's own hidden clone, never one in the person's folders; over ssh when https fails.
        const urls = cloneUrls(m.project.id);
        if (!urls.length) return fail(`this computer has no checkout of ${m.project.name}, and its repo has no remote to clone it from`);
        sendExpertCreationProgress(expertCreation);
        const reasons: string[] = [];
        for (const url of urls) {
          const clone = await o.clone(url, m.project.id);
          if (closed) return;
          if (typeof clone === "string") {
            checkout = clone;
            break;
          }
          reasons.push(`from ${url}, ${clone.reason ?? clone.problem}`);
        }
        if (!checkout) return fail(`this computer has no checkout of ${m.project.name}, and Isoplan's own copy of it couldn't be made: ${reasons.join("; ")}`);
      }
      const t = await settings();
      const body = { version: 1, name: m.key, repo: checkout, subject: m.subject, model: m.model, promoteAtTokens: t.promoteAtTokens, proof: m.proof, areas: m.area };
      const text = JSON.stringify(body, null, 2) + "\n";
      const parsed = parseExpertFile(text, `${m.key}.json`);
      if (!parsed.ok) return fail(`its expert file wouldn't be read: ${parsed.field} ${parsed.reason}`);
      try {
        await writeWhole(expertFile(m.key), text);
      } catch (err) {
        say(`couldn't write the expert file ${expertFile(m.key)}: ${(err as Error).message}`);
        return fail("its expert file couldn't be written on that computer");
      }
      expertCreation.wrote = kept.wrote = true;
      say(`wrote the expert file for ${m.key}, created from suggestion ${m.expertCreationSuggestionId} by ${m.by.name || m.by.id}, for ${checkout}`);
      void save();
    } catch (err) {
      if (!closed) fail(`creating it stopped on that computer: ${(err as Error).message}`);
      return;
    } finally {
      expertCreation.working = false;
    }
    await follow(expertCreation);
  }

  // The correction check, on the person's own Claude account (what it is given goes only there,
  // never to the office), one at a time, at most checksPerHour: past that, the next waits for the
  // hour's oldest check to be an hour old.
  async function check() {
    if (checking || closed) return;
    // One whose session no office that takes suggestions has now waits for a later pass to ask again.
    while (waiting.length && !couldBeSuggested(waiting[0]!.bare)) waiting.shift();
    if (!waiting.length) return;
    checking = true;
    let again = false;
    try {
      const t = await settings();
      // Off, nothing is checked, and the messages waiting count nothing.
      if (!t.correctionCheck) return void (waiting.length = 0);
      const at = now();
      while (checked.length && at - checked[0]! >= HOUR_MS) checked.shift();
      if (checked.length >= t.checksPerHour) {
        if (!checkTimer) {
          checkTimer = setTimeout(() => ((checkTimer = null), void check()), checked[0]! + HOUR_MS - at);
          checkTimer.unref?.();
        }
        return;
      }
      const next = waiting.shift()!;
      checked.push(at);
      again = true;
      const verdict = await o.corrects(next.text, next.reply, t);
      if (verdict !== null) {
        verdicts.set(next.key, verdict);
        if (verdicts.size > MAX_VERDICTS) verdicts.delete(verdicts.keys().next().value!);
        saved.verdicts = [...verdicts];
        void save();
      }
    } catch (err) {
      say(`couldn't check whether a message corrected the agent: ${(err as Error).message}`);
    } finally {
      checking = false;
    }
    if (again) void check();
  }

  const orLog = (what: string) => (err: Error) => say(`couldn't ${what}: ${err.message}`);

  return {
    async start() {
      const text = await fs.readFile(file, "utf8").catch((err: NodeJS.ErrnoException) => {
        if (err.code !== "ENOENT") say(`EXPERT CREATION SUGGESTIONS: couldn't read ${file} (${err.message}), so what was suggested before isn't known and may be suggested again`);
        return null;
      });
      if (text !== null) {
        let value: Saved | null = null;
        try {
          value = JSON.parse(text) as Saved;
        } catch {
          // Said below, with the file moved aside.
        }
        if (value?.version === FILE_VERSION && Array.isArray(value.foldersAlreadySuggested) && Array.isArray(value.expertCreationSuggestions)) {
          saved = { ...value, expertCreations: Array.isArray(value.expertCreations) ? value.expertCreations : [], held: Array.isArray(value.held) ? value.held : [] };
          if (Array.isArray(value.verdicts)) for (const [key, verdict] of value.verdicts) verdicts.set(key, verdict);
        } else {
          // Never overwritten in silence: it is kept beside, for whoever looks into why.
          const aside = `${file}.unreadable-${now()}`;
          const moved = await fs.rename(file, aside).then(
            () => `moved to ${aside}`,
            (err: Error) => `left where it is (${err.message})`,
          );
          say(`EXPERT CREATION SUGGESTIONS: ${file} isn't expert-creation-suggestions.json as this runner writes it, so it was ${moved}, and expert creation suggestions start again from nothing: folders suggested before may be suggested again`);
        }
      }
      // A suggestion sent before the runner stopped, and not yet kept, may not have reached its office: it goes again.
      for (const r of saved.expertCreationSuggestions) for (const [server, state] of Object.entries(r.offices)) if (state === "sent") r.offices[server] = "pending";
      // runner.json is read again on the next pass, which forgets what is old then.
      await settings().then(
        (t) => forget(t, now()),
        (err: Error) => say(`couldn't read runner.json's expertCreationSuggestions as the expert creation suggestions started (${err.message}); it is read again on the next session's pass`),
      );
      started = true;
      // The expertCreations under way when it stopped are followed again, on their requests, and one whose
      // last state hadn't gone is sent as it was; one for an office no longer listed goes.
      saved.expertCreations = saved.expertCreations.filter((k) => indexOf(k.server) >= 0);
      for (const k of saved.expertCreations) {
        const index = indexOf(k.server);
        if (expertCreations.has(k.request)) continue;
        // One kept before expertCreations said whether they wrote their file was kept only once it had.
        const m: ExpertCreation = { index, request: k.request, expertCreationSuggestionId: k.expertCreationSuggestionId, key: k.key, since: k.since, state: k.state ?? "cloning", ...(k.detail && { detail: k.detail }), sent: null, wrote: k.wrote !== false, working: false, timer: null };
        expertCreations.set(m.request, m);
        // A failed one's expert file goes, if it wrote it and it was still there, unless a later creation of its key came since.
        if (k.state === "failed" && m.wrote && !saved.expertCreations.some((x) => x.key === k.key && x.since > k.since)) void clear(m);
        if (k.state) continue;
        if (m.wrote) void follow(m).catch(orLog(`follow expert ${m.key}`));
        // Its create-expert-from-suggestion was cut short before the file was written, and nothing here can go on with it.
        else setExpertCreationProgress(m, "failed", "the runner on that computer stopped before its expert file was written; make it again");
      }
    },

    seen(s) {
      if (!started || closed || indexOf(s.server) < 0) return;
      const byOffice = latest.get(s.session) ?? new Map<string, SessionAreas>();
      latest.delete(s.session);
      latest.set(s.session, byOffice.set(s.server, s));
      if (latest.size > MAX_SESSIONS) latest.delete(latest.keys().next().value!);
      // A suggestion of this session made before this office took it goes to it too, if this office may
      // be told of its repo, unless it has ended anywhere (made, dismissed or expired); one only
      // refused somewhere still goes.
      const may = names(s);
      let added = false;
      for (const r of saved.expertCreationSuggestions) {
        if (r.session !== s.session || r.scope !== "session" || r.offices[s.server] !== undefined || !may.has(r.project.id.toLowerCase()) || Object.values(r.offices).includes("ended") || retryable(r, now())) continue;
        r.offices[s.server] = "pending";
        added = true;
      }
      if (added) {
        void save();
        flush(indexOf(s.server));
      }
      if (busy.has(s.session)) return;
      busy.add(s.session);
      void consider(s)
        .catch(orLog(`look at session ${s.bare}'s areas for an expert creation suggestion`))
        .finally(() => busy.delete(s.session));
    },

    corrected(bare, key, text, reply) {
      // Off, a message never counts (check() drops what waits), whatever an earlier check said.
      const verdict = checkOn ? verdicts.get(key) : undefined;
      if (verdict !== undefined) return verdict;
      if (closed || !couldBeSuggested(bare)) return null;
      if (!waiting.some((w) => w.key === key) && waiting.length < MAX_CHECKS_WAITING) waiting.push({ bare, key, text, reply });
      // Each pass looks again, so a check that couldn't run (runner.json unreadable, say) is tried again.
      if (waiting.length) void check().catch(orLog("check whether a message corrected the agent"));
      return null;
    },

    take(index, message) {
      if (closed) return;
      if (message.type === "expert-creation-suggestion-dismissals") {
        offices[index]!.dismissals = message.dismissals;
        offices[index]!.ready = true;
        return flush(index);
      }
      if (message.type === "draft-office-wide-expert-creation-suggestion") return void draftOfficeWideExpertCreationSuggestion(index, message).catch(orLog(`draft the office-wide expert creation suggestion ${message.request}`));
      if (message.type === "create-expert-from-suggestion") return void createExpertFromSuggestion(index, message).catch(orLog(`make the expert ${message.key}`));
      ended(index, message);
    },

    linked(index) {
      offices[index]!.ready = false;
      offices[index]!.fresh = true;
      for (const m of expertCreations.values()) if (m.index === index) m.sent = null;
      // A suggestion sent on the connection that ended, and not yet kept, may not have reached the
      // office: it goes again on the next, which the office takes as the same suggestion.
      const server = o.offices[index]!.server;
      for (const r of saved.expertCreationSuggestions) if (r.offices[server] === "sent") r.offices[server] = "pending";
    },

    rehooked(bare) {
      const hooks = o.hooked(bare);
      if (!hooks) return;
      for (const r of saved.expertCreationSuggestions) {
        if (r.bare !== bare) continue;
        for (const [server, state] of Object.entries(r.offices)) if (state === "open") hooks.send(lineOf(r, server));
        tellReady(r);
      }
    },

    // A creation that is done and waits only for its office's link holds nothing up, nor one that can no longer move.
    idle: () => officeWideSuggestionRequestsBeingDrafted.size === 0 && !checking && busy.size === 0 && keeping.size === 0 && [...expertCreations.values()].every((m) => done(m) || (!m.working && !m.timer)),

    close() {
      closed = true;
      if (checkTimer) clearTimeout(checkTimer);
      for (const m of expertCreations.values()) if (m.timer) clearTimeout(m.timer);
      for (const timer of keeping.values()) clearTimeout(timer);
    },
  };
}
