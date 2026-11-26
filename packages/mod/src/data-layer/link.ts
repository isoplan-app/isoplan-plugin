// The live link to the office server (#3, #6): on every connect a hello, then the session's facts
// in full, then only what changed, at most once a second, `seq` going up by one per message. A
// repair from the server gets the facts in full again. A dropped link reconnects with capped
// exponential backoff and jitter, and starts over with hello and full. Nothing is kept while the
// link is down: it is a live view, not a log.
//
// The server's conflict notes and errors, the late end of a question the session asked the room
// and whether it may ask (#49), and the link's own state, go out through `emit` as stdout lines for
// the hooks module.
//
// A server that answers `not-wanted` holds this project in no office: the link calls `onNotWanted`
// and waits, asking again once an hour rather than backing off fast. Only the plugin's data layer
// sees that hour out; a detached one exits on `onNotWanted` (main.ts).
//
// An office server that signs people in wants the machine paired (pairing.ts): each try first takes
// a token from `pairing`, and sends it in the hello. A hello refused as `not-paired`,
// `pairing-ended` or `token-expired` is told to `pairing`, which pairs or renews, and the link tries
// again: after retryBaseMs the first time, then backing off, doubling up to retryCapMs, until a
// link stays up STABLE_MS. A token that ran out on a link that stayed up (the server closes it then)
// is renewed and the link opened again at once, with no `disconnected` in between. While a link to
// pair waits to be clicked the link shows `pairing` and looks again every `pairPollMs`.
//
// `forged-hello` means the session belongs to someone else on the office: the link shows `taken`
// and stops, asking again only after `takenRetryMs`, in case an admin has released it.
//
// The runner (src/runner) uses the same link with its own hello and no facts. The server's
// requests, releases and handoffs go to `onMessage`, and the runner's replies and refusals go out
// through `send`. One sent while the link is down waits, and goes out after the next hello, within
// OUTBOX_MAX and OUTBOX_MAX_AGE_MS. Driving sessions from the floor (protocol 0.5.0), the server's
// `drive` requests and `drive-policy` go to `onDrive`, and the runner's `driven` messages go out
// through `sendLive`, only while the link is up: they never wait in the outbox. `onOpen` is told
// after every hello and `onClose` at every drop, so the runner forgets the connection's drive-policy
// and sends no driven message on the new one until its first drive-policy has come (runner/session.ts).
// A runner that keeps instances of experts (protocol 0.17.0, isoplan-app#340) is given the server's
// expert directory, records, definition results, deletions, set-ups, set-up offers' ends and the
// counts of its person's questions on their other computers (`onExpertRecordMessages`), and sends
// its definitions, records wanted, instance states, wordless question records, set-up offers and
// failed proofs live as well (runner/expert-record-link.ts); and, sharing what instances learn
// (protocol 0.18.0, isoplan-app#366), the answers to what it sent, what other instances learned and
// refused asks, as it sends what its own learned and its asks (runner/what-was-learned-link.ts).
// A session's link passes the experts it may ask (`expert-rights`) on as a line, as `ask-rights`.
// A runner that can create experts from suggestions (protocol 0.15.0) is given the server's `expert-creation-suggestion-dismissals`,
// `draft-office-wide-expert-creation-suggestion`, `create-expert-from-suggestion` and `expert-creation-suggestion-ended` (`onExpertCreationSuggestionMessages`), and sends its `expert-creation-suggestion`,
// `expert-creation-suggestion-ended` and `expert-creation-progress` live as well (runner/expert-creation-suggestions.ts).
//
// Given `onError`, a throw in any handler the link runs by itself (its socket handlers, its pacing
// and retry timers, its callbacks on `admit` and `pairing`; in `filter` or `emit`, say) goes to it,
// and that handler does nothing more; without it, the throw reaches the process as before.

import {
  parseOfficeServerMessage,
  PROTOCOL_VERSION,
  type DataLayerMessage,
  type DraftOfficeWideExpertCreationSuggestionMessage,
  type DriveMessage,
  type DrivenMessage,
  type DrivePolicyMessage,
  type ExpertCreationProgressMessage,
  type ExpertCreationSuggestionMessage,
  type ExpertDefinitionMessage,
  type ExpertDefinitionResultMessage,
  type ExpertDeletedMessage,
  type ExpertDirectoryMessage,
  type ExpertInstanceLearnedMessage,
  type ExpertInstanceLearnedReceivedMessage,
  type ExpertInstanceStatesMessage,
  type ExpertLearnedSinceMessage,
  type ExpertLearnedWantedAfterMessage,
  type ExpertLearnedWantedAfterRefusedMessage,
  type EmployeeRunsMessage,
  type EmployeeDraftsMessage,
  type EmployeeDraftDecisionAppliedMessage,
  type OfferToMakeAnEmployeeMessage,
  type OfferToMakeAnEmployeeJobMessage,
  type MakingAnEmployeeMessage,
  type EmployeeDraftsReceivedMessage,
  type EmployeeDraftDecidedMessage,
  type OfferToMakeAnEmployeeEndedMessage,
  type OfferToMakeAnEmployeeJobWantedMessage,
  type MakeAnEmployeeMessage,
  type ExpertProofFailedMessage,
  type ExpertQuestionMessage,
  type ExpertQuestionsAskedOnYourOtherComputersMessage,
  type ExpertRecordMessage,
  type ExpertRecordWantedMessage,
  type ExpertSetUpOfferedMessage,
  type ExpertSetUpOfferEndedMessage,
  type Facts,
  type SetUpExpertInstanceMessage,
  type CreateExpertFromSuggestionMessage,
  type ExpertCreationSuggestionDismissalsMessage,
  type RunnerExpertCreationSuggestionEndedMessage,
  type ServerExpertCreationSuggestionEndedMessage,
  type DropMessage,
  type HandoffMessage,
  type HelloMessage,
  type RefusalMessage,
  type ReleaseMessage,
  type ReplyMessage,
  type RequestMessage,
  type RunnerHelloMessage,
  type TakenMessage,
} from "@isoplan/protocol";
import type { DataLayerLine } from "../lines.js";
import { diffFacts } from "./changes.js";
import type { Pairing } from "./pairing.js";

// A link up this long without being refused counts as let in: refusals are counted from zero again.
const STABLE_MS = 30000;

// Replies kept while the link is down: at most this many, the oldest dropped first, and none older
// than this, which the server will have asked again for by then.
const OUTBOX_MAX = 100;
const OUTBOX_MAX_AGE_MS = 3600000;

export interface LinkOptions {
  url: string;
  hello: HelloMessage | RunnerHelloMessage;
  emit: (line: DataLayerLine) => void;
  /** The least time between two messages of facts; a repair's full doesn't wait. */
  minIntervalMs?: number;
  /** The first retry's delay, doubled per failed try up to `retryCapMs`. */
  retryBaseMs?: number;
  retryCapMs?: number;
  /** How long a link the server didn't want waits before asking again. */
  notWantedRetryMs?: number;
  /** How long a link refused as forged-hello waits before asking again. */
  takenRetryMs?: number;
  onNotWanted?: () => void;
  /** Asked before every connect, the first and each reconnect: false sends nothing (the office doesn't take the session's repo now). */
  admit?: () => Promise<boolean>;
  /** The server said this machine's pairing has ended, once `pairing` has dropped the credential. */
  onPairingEnded?: () => void;
  /** Takes the server's requests, releases and handoffs; without it they are logged as not handled. */
  onMessage?: (message: ServerAsk) => void;
  /** Takes the server's drive requests and drive-policy; without it they are logged as not handled. */
  onDrive?: (message: DriveMessage | DrivePolicyMessage) => void;
  /** Takes the server's expert record messages; without it, logged as not handled. */
  onExpertRecordMessages?: (message: ServerExpertRecordMessage) => void;
  /** Takes the server's expert creation suggestion messages; without it, logged as not handled. */
  onExpertCreationSuggestionMessages?: (message: ServerExpertCreationSuggestionMessage) => void;
  /** Told after every hello, once what waited in the outbox has gone. */
  onOpen?: () => void;
  /** Told each time the connection drops or is closed, before any reconnect. */
  onClose?: () => void;
  /**
   * What of the facts may go on this connection, given the projects its welcome named (null before
   * one): applied at every send, so a reconnect's full goes by the new connection's welcome (#74).
   */
  filter?: (facts: Facts, projects: ReadonlySet<string> | null) => Facts;
  /** Whether a question got an answer, so a removed one says it was answered or abandoned. */
  answered?: (question: string) => boolean;
  /** Where the hello's token comes from, for a server that signs people in. */
  pairing?: Pairing;
  /** How often a link waiting for its code to be approved asks again. */
  pairPollMs?: number;
  random?: () => number;
  /** Told of a throw in any handler the link runs by itself (socket handlers, timers, promise callbacks), in place of the process. */
  onError?: (err: unknown) => void;
}

/** What a runner sends back: a reply, a refusal, or what it did with a handoff it took. */
type Outgoing = ReplyMessage | RefusalMessage | TakenMessage;

/** What the server asks of a machine, rather than of a session's facts. */
export type ServerAsk = RequestMessage | ReleaseMessage | HandoffMessage | DropMessage;

/** What the server tells a runner that can create experts from suggestions (protocol 0.15.0). */
export type ServerExpertCreationSuggestionMessage = ExpertCreationSuggestionDismissalsMessage | DraftOfficeWideExpertCreationSuggestionMessage | CreateExpertFromSuggestionMessage | ServerExpertCreationSuggestionEndedMessage;

/** What a runner that can create experts from suggestions sends, live. */
export type RunnerExpertCreationSuggestionMessage = ExpertCreationSuggestionMessage | RunnerExpertCreationSuggestionEndedMessage | ExpertCreationProgressMessage;

/** What the server tells a runner that runs employees (protocol 0.19.0, isoplan-app#341). */
export type ServerEmployeeMessage = EmployeeDraftsReceivedMessage | EmployeeDraftDecidedMessage | OfferToMakeAnEmployeeEndedMessage | OfferToMakeAnEmployeeJobWantedMessage | MakeAnEmployeeMessage;

/** What a runner that runs employees sends, live (protocol 0.19.0). */
export type RunnerEmployeeMessage = EmployeeRunsMessage | EmployeeDraftsMessage | EmployeeDraftDecisionAppliedMessage | OfferToMakeAnEmployeeMessage | OfferToMakeAnEmployeeJobMessage | MakingAnEmployeeMessage;

/** What the server tells a runner that keeps instances of experts (protocol 0.17.0), what instances learn (0.18.0), and employees (0.19.0), which come after the directory that opens them. */
export type ServerExpertRecordMessage = ExpertDirectoryMessage | ExpertRecordMessage | ExpertDefinitionResultMessage | ExpertDeletedMessage | SetUpExpertInstanceMessage | ExpertSetUpOfferEndedMessage | ExpertQuestionsAskedOnYourOtherComputersMessage | ExpertInstanceLearnedReceivedMessage | ExpertLearnedSinceMessage | ExpertLearnedWantedAfterRefusedMessage | ServerEmployeeMessage;

/** What a runner that keeps instances of experts sends, live, and one that runs employees. */
export type RunnerExpertRecordMessage = ExpertDefinitionMessage | ExpertRecordWantedMessage | ExpertInstanceStatesMessage | ExpertQuestionMessage | ExpertSetUpOfferedMessage | ExpertProofFailedMessage | ExpertInstanceLearnedMessage | ExpertLearnedWantedAfterMessage | RunnerEmployeeMessage;

const SERVER_EXPERT_RECORD_TYPES = new Set<string>(["expert-directory", "expert-record", "expert-definition-result", "expert-deleted", "set-up-expert-instance", "expert-set-up-offer-ended", "expert-questions-asked-on-your-other-computers", "expert-instance-learned-received", "expert-learned-since", "expert-learned-wanted-after-refused", "employee-drafts-received", "employee-draft-decided", "offer-to-make-an-employee-ended", "offer-to-make-an-employee-job-wanted", "make-an-employee"]);

export interface Link {
  /** The session's facts now; what differs from what the server has goes out when the pace allows. */
  update(facts: Facts): void;
  /** A reply, refusal or taken, first sent at `at` (now, unless it waited elsewhere first). One sent while the link is down goes out after the next hello, unless it is older than OUTBOX_MAX_AGE_MS by then. */
  send(message: Outgoing, at?: number): void;
  /** A driven message, an expert record message or an expert creation suggestion's, sent now if the link is up; false when it is down, and the message is dropped. */
  sendLive(message: DrivenMessage | RunnerExpertRecordMessage | RunnerExpertCreationSuggestionMessage): boolean;
  /**
   * The projects the office holds, from this connection's welcome; null before one, and from a
   * server too old to send one, which would read another repo's files as the session's own (#74).
   */
  projects(): ReadonlySet<string> | null;
  close(): void;
}

export function createLink({
  url,
  hello,
  emit,
  minIntervalMs = 1000,
  retryBaseMs = 1000,
  retryCapMs = 30000,
  notWantedRetryMs = 3600000,
  takenRetryMs = 3600000,
  onNotWanted,
  onPairingEnded,
  onMessage,
  onDrive,
  onExpertRecordMessages,
  onExpertCreationSuggestionMessages,
  onOpen,
  onClose,
  filter = (facts) => facts,
  answered,
  pairing,
  pairPollMs = 5000,
  admit,
  random = Math.random,
  onError,
}: LinkOptions): Link {
  const outbox: { message: Outgoing; at: number }[] = [];
  let latest: Facts | null = null;
  let socket: WebSocket | null = null;
  let isOpen = false;
  let sent: Facts | null = null; // what the server has, on this connection
  let seq = 0;
  let sentAt = -Infinity;
  let failures = 0; // tries in a row that didn't open
  let pacing: ReturnType<typeof setTimeout> | null = null;
  let retry: ReturnType<typeof setTimeout> | null = null;
  let isClosed = false;
  let isUnwanted = false; // the server said not-wanted on this connection
  let sentToken: string | undefined; // the token this connection's hello carried
  let refusing: Promise<void> = Promise.resolve(); // telling `pairing` of a refused hello
  let isRefused = false; // the server refused this connection's hello for its token
  let refusedFor: string | null = null; // why
  let isTaken = false; // the server said the session belongs to someone else
  let refusals = 0; // hellos refused for their token, in a row
  let projects: ReadonlySet<string> | null = null; // the office's, from this connection's welcome
  let stable: ReturnType<typeof setTimeout> | null = null; // counts refusals from zero once the link has stayed up

  // A socket handler, timer or promise callback of the link's own, whose throw goes to `onError` when there is one.
  const contained =
    <A extends unknown[]>(fn: (...args: A) => void) =>
    (...args: A) => {
      if (!onError) return fn(...args);
      try {
        fn(...args);
      } catch (err) {
        onError(err);
      }
    };
  const reconnect = contained(() => connect());

  // Before every try, the first and each reconnect, `admit` may say no: then nothing is sent, and it
  // asks again after retryCapMs (the data layer closes a link whose repo has left the office).
  function connect() {
    retry = null;
    if (!admit) return proceed();
    admit().then(
      contained((ok: boolean) => {
        if (isClosed) return;
        if (ok) return proceed();
        emit({ type: "status", server: url, state: "not-approved" });
        retry = setTimeout(reconnect, retryCapMs);
      }),
      contained(() => {
        if (!isClosed) retry = setTimeout(reconnect, retryCapMs);
      }),
    );
  }

  function proceed() {
    if (!pairing) return open(undefined);
    void refusing
      .then(() => pairing.token())
      .then(
        contained((token: string | null | undefined) => {
          if (isClosed) return;
          if (token !== null) return open(token);
          emit({ type: "status", server: url, state: "pairing" });
          retry = setTimeout(reconnect, pairPollMs);
        }),
        contained((err: unknown) => {
          if (isClosed) return;
          emit({ type: "log", text: `couldn't pair with the office server: ${String((err as Error)?.message ?? err)}` });
          dropped();
        }),
      );
  }

  function open(token: string | undefined) {
    emit({ type: "status", server: url, state: "connecting" });
    const ws = new WebSocket(url);
    socket = ws;
    sentToken = token;
    ws.onopen = contained(() => {
      if (socket !== ws) return;
      failures = 0;
      isOpen = true;
      seq = 0;
      projects = null;
      stable = setTimeout(() => (refusals = 0), STABLE_MS);
      send(token ? { ...hello, token } : hello);
      for (const { message, at } of outbox.splice(0)) if (Date.now() - at < OUTBOX_MAX_AGE_MS) send(message);
      sendFull();
      emit({ type: "status", server: url, state: "connected" });
      onOpen?.();
    });
    ws.onmessage = contained((event: MessageEvent) => {
      if (socket === ws) receive(event.data);
    });
    // Either event is the drop, handled once per socket: Node 22's WebSocket fires only `error`
    // for a connection that never opened (refused, failed handshake), with no `close` after it.
    ws.onerror = contained(() => {
      if (socket !== ws) return;
      dropped();
      try {
        ws.close();
      } catch {
        // Not open yet: nothing to close.
      }
    });
    ws.onclose = contained(() => {
      if (socket === ws) dropped();
    });
  }

  function dropped() {
    socket = null;
    isOpen = false;
    onClose?.();
    projects = null;
    sent = null;
    if (pacing) clearTimeout(pacing);
    pacing = null;
    if (stable) clearTimeout(stable);
    stable = null;
    if (isClosed) return;
    if (isTaken) {
      isTaken = false;
      emit({ type: "status", server: url, state: "taken" });
      retry = setTimeout(reconnect, takenRetryMs);
      return;
    }
    // Refusals back off on their own count: the socket opened each time, which resets `failures`.
    if (isRefused) {
      isRefused = false;
      // A token that ran out on a link that had stayed up is renewed at once, unseen.
      if (refusedFor === "token-expired" && refusals === 0) {
        refusals++;
        retry = setTimeout(reconnect, 0);
        return;
      }
      const delay = Math.min(retryCapMs, retryBaseMs * 2 ** refusals++);
      emit({ type: "status", server: url, state: "disconnected", retryInMs: delay });
      retry = setTimeout(reconnect, delay);
      return;
    }
    if (isUnwanted) {
      isUnwanted = false;
      failures = 0;
      emit({ type: "status", server: url, state: "not-wanted" });
      retry = setTimeout(reconnect, notWantedRetryMs);
      return;
    }
    const delay = Math.min(retryCapMs, retryBaseMs * 2 ** failures++);
    // Equal jitter: half the delay fixed, half random, so a server restart isn't met by every
    // data layer at once.
    const retryInMs = Math.round(delay / 2 + (random() * delay) / 2);
    emit({ type: "status", server: url, state: "disconnected", retryInMs });
    retry = setTimeout(reconnect, retryInMs);
  }

  function send(message: DataLayerMessage) {
    socket!.send(JSON.stringify(message));
  }

  function sendFull() {
    if (!latest) return;
    const facts = filter(latest, projects);
    send({ type: "full", v: PROTOCOL_VERSION, seq: seq++, facts });
    sent = facts;
    sentAt = Date.now();
  }

  function flush() {
    pacing = null;
    if (!isOpen || !latest || !sent) return;
    const facts = filter(latest, projects);
    const changed = diffFacts(sent, facts, answered);
    if (!changed) return;
    const wait = sentAt + minIntervalMs - Date.now();
    if (wait > 0) {
      pacing = setTimeout(contained(flush), wait);
      return;
    }
    send({ type: "changes", v: PROTOCOL_VERSION, seq: seq++, ...changed });
    sent = facts;
    sentAt = Date.now();
  }

  function receive(data: unknown) {
    let value: unknown;
    try {
      value = JSON.parse(String(data));
    } catch {
      emit({ type: "log", text: "the office server sent a message that isn't JSON" });
      return;
    }
    const parsed = parseOfficeServerMessage(value);
    if (!parsed.ok) {
      emit({ type: "log", text: `the office server sent a message this data layer can't read (${parsed.kind}): ${parsed.error}` });
      return;
    }
    const message = parsed.message;
    if (message.type === "welcome") {
      // What it allows goes now, not on the next update.
      projects = new Set(message.projects.map((p) => p.toLowerCase()));
      if (!pacing) flush();
    } else if (message.type === "repair") {
      if (pacing) clearTimeout(pacing);
      pacing = null;
      sendFull();
    } else if (message.type === "conflict" && !latest?.agents.some((a) => a.id === message.agent)) {
      // A note reaches a model's context, so only one for an agent of this session is taken.
      emit({ type: "log", text: `the office server sent a note for ${message.agent}, not an agent of this session` });
    } else if (pairing && message.type === "error" && (message.code === "not-paired" || message.code === "pairing-ended" || message.code === "token-expired")) {
      isRefused = true;
      refusedFor = message.code;
      refusing = pairing.refused(message.code, sentToken).catch(() => {});
      if (message.code === "pairing-ended" && onPairingEnded) void refusing.then(contained(onPairingEnded));
      // The server's own words on how to pair are passed on; a renewal is the link's own business.
      emit(message.code === "token-expired" ? { type: "log", text: "the office server says this machine's token has expired; renewing it" } : message);
    } else if (message.type === "error" && message.code === "forged-hello") {
      isTaken = true;
      emit(message);
    } else if (message.type === "conflict" || message.type === "error" || message.type === "asked" || message.type === "ask-rights" || message.type === "expert-rights") {
      emit(message);
      if (message.type === "error" && message.code === "not-wanted") {
        isUnwanted = true;
        onNotWanted?.();
      }
    } else if (onMessage && (message.type === "request" || message.type === "release" || message.type === "handoff" || message.type === "drop")) {
      onMessage(message);
    } else if (onDrive && (message.type === "drive" || message.type === "drive-policy")) {
      onDrive(message);
    } else if (onExpertRecordMessages && SERVER_EXPERT_RECORD_TYPES.has(message.type)) {
      onExpertRecordMessages(message as ServerExpertRecordMessage);
    } else if (onExpertCreationSuggestionMessages && (message.type === "expert-creation-suggestion-dismissals" || message.type === "draft-office-wide-expert-creation-suggestion" || message.type === "create-expert-from-suggestion" || message.type === "expert-creation-suggestion-ended")) {
      onExpertCreationSuggestionMessages(message);
    } else {
      emit({ type: "log", text: `the office server sent a ${message.type} message, which this data layer doesn't handle yet` });
    }
  }

  connect();

  return {
    update(facts) {
      latest = facts;
      if (isOpen && !sent) sendFull();
      else if (!pacing) flush();
    },
    send(message, at = Date.now()) {
      if (isOpen && socket!.readyState === WebSocket.OPEN) send(message);
      else {
        outbox.push({ message, at });
        if (outbox.length > OUTBOX_MAX) outbox.shift();
      }
    },
    sendLive(message) {
      if (!isOpen || socket!.readyState !== WebSocket.OPEN) return false;
      send(message);
      return true;
    },
    projects: () => projects,
    close() {
      isClosed = true;
      if (pacing) clearTimeout(pacing);
      if (retry) clearTimeout(retry);
      if (stable) clearTimeout(stable);
      void pairing?.close();
      socket?.close();
    },
  };
}
