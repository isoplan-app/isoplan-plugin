// What the runner sends a session's hooks module, one JSON object per line: down the runner's pipe
// (src/pipe), and on to the hooks module on the stdout of the pipe's end it spawned (`dist/pipe.js`).
// The hooks module can't write to that process once it has started (its stdin closes at launch), so
// anything it sends back goes through a file the line names, which the runner reads. "The data
// layer" below is the runner reporting the session (src/data-layer/report-session.ts).

import type { AskedMessage, AskRightsMessage, ConflictMessage, ErrorMessage } from "@isoplan/protocol";

/**
 * The link to the office server. `waiting`: nothing to report yet, so not connected.
 * `not-wanted`: the server holds this project in no office, so it isn't reported. `not-approved`: the
 * office's list of repos (approved.ts) hasn't this one, so nothing is sent. `no-list`: that list can't be
 * had yet, so nothing is sent. `pairing`: the
 * machine's link to pair it (the last `pair` line) waits to be clicked. `taken`: the session belongs to
 * someone else on the office, so it isn't reported. `insecure`: the server is plain ws:// to another
 * machine, so nothing is sent to it.
 */
export interface StatusLine {
  type: "status";
  server: string;
  state: "waiting" | "connecting" | "connected" | "disconnected" | "not-wanted" | "not-approved" | "no-list" | "pairing" | "taken" | "insecure";
  /** The office's short name from config.json (#105), for the status line. */
  label?: string;
  /** With `insecure`: there is no list of this office's to tell whether it takes the session's repo. */
  unchecked?: true;
  /** With `not-approved`: the session's folder is a workspace, none of whose repos the office takes. */
  workspace?: true;
  /** With `disconnected`: when the next try is. */
  retryInMs?: number;
}

/**
 * A room title to write: the hooks module asks `model` and writes `{ key, text }` (the reply's
 * text) as JSON to `file`, which the data layer reads back.
 */
export interface TitleAskLine {
  type: "title-ask";
  model: string;
  system: string;
  prompt: string;
  maxTokens: number;
  key: string;
  file: string;
}

/**
 * The office server wants this machine paired (src/data-layer/pairing.ts): its person clicks `url`
 * on this computer, before `expires`, and approves it on the floor.
 */
export interface PairLine {
  type: "pair";
  server: string;
  /** The office's short name, as on its status line. */
  label?: string;
  url: string;
  expires: string;
}

/**
 * The owner answered a question from the floor: `question` is the AskUserQuestion call's id, and
 * `answers` maps each question's text to its answer. The hooks module ends the call with them if
 * it is still waiting for it, and writes an AnswerTaken as JSON to `file` either way.
 */
export interface OwnerAnswerLine {
  type: "owner-answer";
  question: string;
  answers: Record<string, string>;
  file: string;
}

/**
 * The owner sent this session a message from the floor (#77): the hooks module submits `text` as a
 * turn of its own, after any it was given before, if the process still runs `session` (the data
 * layer's own id; another means a /clear or a resume moved it on), and writes a MessageTaken as JSON
 * to `file`.
 */
export interface OwnerMessageLine {
  type: "owner-message";
  session: string;
  text: string;
  file: string;
}

/**
 * What an owner-message's file holds: whether the message entered the session, `queued` when it
 * waits for the running turn (or an earlier message) to end, or why it didn't: `no-submit`, this
 * Claude Code build can't take one from a plugin; `ended`, the session has moved on; `dropped`,
 * Claude Code didn't let it in.
 */
export type MessageTaken = { taken: true; queued?: true } | { taken: false; reason: "no-submit" | "ended" | "dropped" };

/**
 * Where the hooks module marks the questions it waits on: `<dir>/<call id>.json`, a WaitMark, written
 * as it starts to wait for a floor answer and again when it stops. The data layer marks a question
 * answerable only while its mark says it waits. Sent once each time the data layer starts.
 */
export interface WaitsLine {
  type: "waits";
  dir: string;
}

/**
 * Where the hooks module writes the session's context window, a ContextWindow, whenever the size
 * Claude Code gives the status line changes. Sent once each time the data layer starts.
 */
export interface WindowLine {
  type: "window";
  file: string;
}

/** What a window line's file holds: the context window in tokens. */
export interface ContextWindow {
  contextWindow: number;
}

/** A question's wait mark. */
export interface WaitMark {
  question: string;
  waiting: boolean;
}

/** What an owner-answer's file holds: whether the answer reached the call waiting for it. */
export interface AnswerTaken {
  question: string;
  taken: boolean;
}

/**
 * A newer version of the plugin is in Claude Code's plugin cache than the one this session loaded
 * (src/update): it loads at /reload-plugins, or the next session.
 */
export interface UpdatedLine {
  type: "updated";
}

/**
 * Another has this session now, and this hooks module's link to the runner ends (src/pipe/
 * server.ts): `newer`, a newer version's hooks module (a /reload-plugins); `window`, this version's in
 * a window that started later; or `earlier`, the data layer process of an earlier version of the
 * plugin, still running for the session, which the runner can't take it over from
 * (src/data-layer/report-session.ts), or doesn't start reporting it for (src/runner/reporting.ts).
 * The hooks module tries again a while later.
 */
export interface SupersededLine {
  type: "superseded";
  reason: "newer" | "window" | "earlier";
}

/**
 * Said by the pipe's end itself (src/pipe/client.ts): the runner can't be reached (`down`), so the
 * session isn't reaching the office while it starts the runner and tries again; or it is through
 * again (`up`). With `held`, the runner won't start: it is `held-off` for now (the office server
 * didn't want it, or it kept crashing), or `not-installed`.
 */
export interface RunnerLine {
  type: "runner";
  state: "down" | "up";
  held?: "held-off" | "not-installed";
}

/** A problem worth a line in the debug log. */
export interface LogLine {
  type: "log";
  text: string;
}

/** The reply a title-ask's file holds. */
export interface TitleReply {
  key: string;
  text: string;
}

/**
 * Office server messages are passed on as the server sent them (repair is the data layer's own); an
 * `asked` is the end of a question the session's agent asked the room, arriving after it stopped
 * waiting, and `ask-rights` whether the session may ask its room (#49), each with the office server
 * it came from (#105), which the room is asked through.
 */
export type DataLayerLine = StatusLine | TitleAskLine | PairLine | WaitsLine | WindowLine | OwnerAnswerLine | UpdatedLine | SupersededLine | RunnerLine | OwnerMessageLine | LogLine | ConflictMessage | ErrorMessage | FromOffice<AskedMessage> | FromOffice<AskRightsMessage>;

/** A server's message, with the data-layer address of the office server that sent it; none from a data layer before #105. */
export type FromOffice<M> = M & { server?: string };
