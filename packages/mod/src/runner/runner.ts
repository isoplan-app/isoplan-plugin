// What the runner does with the office server's requests. A question (answer-question) or a brief
// (write-brief) is answered from a fork of the room's lead, through the answerer (answerer.ts):
//
// 1. One at a time per room: a request waits for the one before it in the same room to finish.
// 2. The lead: a session this machine doesn't have or doesn't report (`isReported`), a folder that
//    is gone or a lead mid-turn is refused `unavailable`. A compacted lead is answered, with a
//    note saying so. The server names the session, so this is what keeps it to this machine's rooms.
// 3. Caps (caps.ts): over one, it is refused `over-cap` with the cap's name. One that passes
//    reserves its estimate at once, so a request in another room counts it.
// 4. The fork answers, at most `maxForks` at once across rooms, and across every office's runner on
//    the machine when they share their ForkSlots (#105); the rest wait their turn, and a
//    request's timeout runs from when its fork starts. The reservation is settled to what the fork
//    used, or taken back when no fork could be started.
// 5. The secret scan (scan.ts): a match is refused `withheld` and the reply is held; the owner's
//    `release` sends it. A release that arrives while its request is still running is applied
//    when the reply lands. Held replies are kept in memory, at most MAX_HELD, so a release after a
//    restart, or after its reply was dropped to make room, is refused with the reason.
//
// Nothing from the fork's output, or from the machine's folders, leaves without the scan: an
// `unavailable` refusal says only what kind of problem it was, and the details go to the local log.
//
// A request id seen before isn't run again: one still running is left to finish, and one that
// finished gets the same answer again, so a server that asks twice doesn't pay twice.
//
// A brief (#48) is asked for with the session's untracked files named (`prepareBrief`), written for
// the request's `task` when it has one (a spin-off, spin-off.md), and ends
// with the runner's note of what was pushed. When the fork can't write it (it failed, or a cap is
// reached), the reply still goes, marked `fallback` (and with the `cap`, when one is why, or
// `noClaude`, when the machine has no claude binary), with the
// note alone, and the server writes the rest from the room's feed. Its branch is pushed (`push`)
// only once the brief has cleared the scan or been released. The push scans what it would send: on
// a match nothing is pushed, the refusal is `withheld` naming the files, in every repo (never the pattern), and the files it couldn't read, and the owner's
// release pushes that exact commit anyway. A push that fails is refused `unavailable` with the
// reason. Without `push` a write-brief is refused before the fork runs. A `drop` of a request still
// waiting in its room's line, or for a fork, takes it out: it never runs, and its estimate is never
// reserved, or is given back. Otherwise a `drop` ends a request: what
// is held for it goes, and one still running neither pushes nor sends. A handoff to take goes to
// `take`, with how to open its session; each take (the session id the server chose) runs once, however
// often it is sent, and what it did goes back as `taken`. A `drop` naming a take's id (the server
// cancelled it, or it timed out there) tells the take, which then doesn't open the Claude app; and a
// take still running after takeCapMinutes is given up: `taken` says so, and the take is told it was dropped. Every take
// that ends is told to `onTaken`, with `opens` only when its own `taken` was handed to `send` (which
// sends it now, or after the next hello) and the server hadn't dropped it, nor the runner given it
// up: a take as a driven session opens only then, and frees its place otherwise (session.ts). owner-answer requests go to the live session, not
// the runner (#50). A focus request (Focus this session, for a handoff this machine took into Orca)
// goes to `focus`, and is answered with a focus reply, or refused `unavailable` saying why.

import { PROTOCOL_VERSION, type HandoffMessage, type HandoffRepo, type RefusalMessage, type ReplyMessage, type RequestMessage, type TakenMessage } from "@isoplan/protocol";
import type { ServerAsk } from "../data-layer/link.js";
import type { Answerer, FailureKind, Lead } from "./answerer.js";
import { estimate, overCap, type Cap, type CapSettings, type Ledger } from "./caps.js";
import { untrackedLine } from "../handoff/git.js";
import { fill, type Prompts } from "./prompts.js";

/** What runner.json says, as the runner uses it. */
export interface RunnerSettings extends CapSettings {
  answerTimeoutSeconds: number;
  briefTimeoutSeconds: number;
  maxForks: number;
  /** The longest a take may keep its handoff in hand on this machine: past it, the take is given up and said so. */
  takeCapMinutes: number;
}

type Outgoing = ReplyMessage | RefusalMessage;

/** A push that failed, with what the server is told; anything else thrown is told only that it failed. */
export class PushFailed extends Error {}
type Ask = Extract<RequestMessage, { kind: "answer-question" | "write-brief" }>;

export interface RunnerOptions {
  answerer: Answerer;
  ledger: Ledger;
  /** Read for every request, so an edit to a file takes effect without a restart. */
  settings: () => Promise<RunnerSettings>;
  prompts: () => Promise<Prompts>;
  /** The name of the secret pattern `text` matches, or null. */
  scan: (text: string) => Promise<string | null>;
  send: (message: Outgoing | TakenMessage) => void;
  log: (text: string) => void;
  isDir: (path: string) => Promise<boolean>;
  /** Whether the data layer would report this session, so the server may ask about it. */
  isReported: (session: string, lead: Lead) => Promise<boolean>;
  /**
   * Pushes the handoff's work and returns its repos (#48), or every file whose added lines matched a
   * secret pattern, by path in the session's folder, and the commit held in each repo with one
   * (#56), with nothing pushed, unless `pushAnyway` names those commits. Without it, briefs are refused.
   */
  push?: (session: string, lead: Lead, handoff: string, pushAnyway: Record<string, string> | null) => Promise<HandoffRepo[] | { held: string[]; commits: Record<string, string>; unchecked: string[] }>;
  /** The untracked files the brief names (null when unknown), and the note it ends with (#48). Throws PushFailed when there is no repo to push. */
  prepareBrief?: (lead: Lead, handoff: string) => Promise<{ files: string[] | null; note: string }>;
  /** Takes a handoff on this machine (#48); without it, handoffs are logged as not handled. `dropped` says whether the server has dropped the take since, or it was given up. */
  take?: (message: HandoffMessage, dropped: () => boolean) => Promise<TakenMessage>;
  /**
   * Told once for every take that ends, with what it did (null when it failed): `opens` when its own
   * `taken` was handed to `send` and it wasn't dropped or given up, so a driven take's session opens
   * only then, and its place is freed otherwise.
   */
  onTaken?: (message: HandoffMessage, taken: TakenMessage | null, opens: boolean) => void;
  /** Brings a handoff's session to the front in Orca: null when it is, else why not. Without it, focus requests are refused. */
  focus?: (handoff: string) => Promise<string | null>;
  /** The fork slots, shared by every office's runner on the machine; without it, this runner's own. */
  forks?: ForkSlots;
  now?: () => number;
}

/** The machine's fork slots: `take(max)` waits for one of `max`, and the function it returns gives it back. */
export interface ForkSlots {
  take(max: number): Promise<() => void>;
  /** Forks running now. */
  running(): number;
}

export function createForkSlots(): ForkSlots {
  let forking = 0; // forks running now
  const waiting: (() => void)[] = []; // requests waiting for a fork, in order
  return {
    async take(max) {
      while (forking >= max) await new Promise<void>((resolve) => waiting.push(resolve));
      forking++;
      return () => {
        forking--;
        waiting.shift()?.();
      };
    },
    running: () => forking,
  };
}

export interface Runner {
  take(message: ServerAsk): void;
  /** True when nothing is queued or running. */
  idle(): boolean;
  /** Resolves once everything queued now has finished. */
  settled(): Promise<void>;
}

// Finished requests remembered, newest last, so a repeat gets the same answer.
const REMEMBER = 200;
// Withheld replies kept for release; past this the oldest is dropped.
export const MAX_HELD = 50;

export const COMPACTED_NOTE = "Note from Isoplan: this session was compacted, so its earlier work survives only as a summary and the details may be thin.";

/** What the server is told for each kind of fork failure. */
const FAILED: Record<FailureKind, string> = {
  "timed-out": "the fork took too long to answer",
  failed: "the fork couldn't answer",
  "not-set-up": "this machine can't run the fork; its owner can see why in the runner's log",
  "no-claude": "Claude Code for the terminal isn't installed on this machine, so it can't run the fork",
};

// Ids of replies dropped from the held set, remembered so a release for one says so.
const REMEMBER_DROPPED = 200;

export function createRunner({ answerer, ledger, settings, prompts, scan, send, log, isDir, isReported, push, prepareBrief, take, onTaken, focus, forks = createForkSlots(), now = Date.now }: RunnerOptions): Runner {
  const rooms = new Map<string, Promise<void>>(); // each room's last queued request
  const running = new Set<string>(); // ids queued or running
  const finished = new Map<string, Outgoing>(); // id → what was last sent for it
  const held = new Map<string, () => Promise<Outgoing>>(); // withheld replies, by id, oldest first
  const released = new Set<string>(); // released while still running
  const dropped = new Set<string>(); // dropped from `held` to make room, oldest first
  const taking = new Set<string>(); // handoffs being taken now
  const takes = new Set<string>(); // the takes run so far, by take id, oldest first
  const runningTakes = new Set<string>(); // take ids still running, given up ones too
  const droppedTakes = new Set<string>(); // of those, the ones dropped by the server or given up
  const dropping = new Set<string>(); // requests dropped while they ran

  const unavailable = (id: string, detail: string): RefusalMessage => ({ type: "refusal", v: PROTOCOL_VERSION, id, reason: "unavailable", detail });
  const overCapRefusal = (id: string, cap: Cap): RefusalMessage => ({ type: "refusal", v: PROTOCOL_VERSION, id, reason: "over-cap", cap });

  function deliver(id: string, message: Outgoing) {
    if (dropping.delete(id)) {
      log(`${id} was dropped by the office server, so what it came to isn't sent`);
      return;
    }
    finished.delete(id);
    finished.set(id, message);
    if (finished.size > REMEMBER) finished.delete(finished.keys().next().value!);
    send(message);
  }

  async function answer(request: Ask): Promise<Outgoing> {
    const { id, room, session } = request;
    // Dropped while it waited its turn: what is returned isn't sent (deliver).
    if (dropping.has(id)) return unavailable(id, "dropped before it ran");
    const lead = await answerer.lead(session);
    if (!lead) return unavailable(id, "this machine has no such session");
    if (!(await isReported(session, lead))) {
      log(`${id}: ${session} isn't a session this machine reports, so it isn't answered for`);
      return unavailable(id, "this machine doesn't report that session");
    }
    if (!(await isDir(lead.cwd))) {
      log(`${id}: the folder of ${session}, ${lead.cwd}, is gone`);
      return unavailable(id, "the session's folder is gone, so its lead can't be asked");
    }
    if (lead.working) return unavailable(id, "the session's lead is mid-turn; ask again once its turn ends");
    if (request.kind === "write-brief" && !push) return unavailable(id, "this plugin version can't hand the work over from the floor yet");

    const s = await settings();
    const p = await prompts();
    const isBrief = request.kind === "write-brief";
    let brief: { files: string[] | null; note: string } = { files: [], note: "" };
    if (isBrief && prepareBrief) {
      try {
        brief = await prepareBrief(lead, request.handoff);
      } catch (err) {
        log(`${id}: ${(err as Error).message}`);
        return unavailable(id, err instanceof PushFailed ? err.message : "the handoff's branch couldn't be pushed");
      }
    }
    // A brief the fork can't write still goes, as the runner's note alone, for the server to fill in.
    const fallback = (why: string) => {
      log(`${id}: the fork didn't write the brief (${why}), so the server writes it from the session's feed`);
      return `No brief was written by the session: ${why}.${brief.note ? `\n\n${brief.note}` : ""}`;
    };
    const expected = estimate(lead.context, s);
    // Checked and reserved with no await between, so two rooms can't both take the last of a cap.
    const cap = overCap(ledger.entries(now()), room, expected, now(), s);
    let body: string;
    let isFallback = false;
    let noClaude = false;
    if (cap) {
      if (!isBrief) return overCapRefusal(id, cap);
      body = fallback(`the ${cap} cap is reached`);
      isFallback = true;
    } else {
      const reservation = ledger.reserve({ at: now(), room, usage: expected });
      const text = isBrief
        ? request.task
          ? fill(p.spinOff, { to: request.to.name || request.to.id, task: request.task, untracked: untrackedLine(brief.files) })
          : fill(p.brief, { to: request.to.name || request.to.id, untracked: untrackedLine(brief.files) })
        : fill(p.question, { from: request.from.name || request.from.id, question: request.question });
      const free = await forks.take(s.maxForks);
      if (dropping.has(id)) {
        free();
        await reservation.cancel().catch((err: unknown) => log(`couldn't record ${id} in the ledger: ${(err as Error).message}`));
        return unavailable(id, "dropped before its fork ran");
      }
      const answered = await answerer.ask(session, lead, { instructions: p.instructions, request: text, timeoutMs: (isBrief ? s.briefTimeoutSeconds : s.answerTimeoutSeconds) * 1000 }).finally(free);
      // No fork ran when it couldn't be set up: the answer and its tokens are given back. One that ran
      // but failed before it was metered keeps its estimate.
      const recorded = !answered.ok && (answered.kind === "not-set-up" || answered.kind === "no-claude") ? reservation.cancel() : reservation.settle(answered.usage ?? expected);
      await recorded.catch((err: unknown) => log(`couldn't record ${id} in the ledger: ${(err as Error).message}`));
      if (!answered.ok) {
        log(`${id}: ${answered.detail}`);
        if (!isBrief) return unavailable(id, FAILED[answered.kind]);
        body = fallback(FAILED[answered.kind]);
        isFallback = true;
        noClaude = answered.kind === "no-claude";
      } else {
        body = lead.compacted ? `${COMPACTED_NOTE}\n\n${answered.text}` : answered.text;
        if (brief.note) body = `${body}\n\n${brief.note}`;
      }
    }

    // The brief's push, held in turn when its commit adds a possible secret; released, it pushes anyway.
    const pushAndReply = async (pushAnyway: Record<string, string> | null): Promise<Outgoing> => {
      if (dropping.has(id)) return unavailable(id, "the handoff was cancelled, so nothing was pushed");
      let pushed: HandoffRepo[] | { held: string[]; commits: Record<string, string>; unchecked: string[] };
      try {
        pushed = await push!(session, lead, (request as Extract<Ask, { kind: "write-brief" }>).handoff, pushAnyway);
      } catch (err) {
        log(`${id}: the push failed: ${(err as Error).message}`);
        return unavailable(id, err instanceof PushFailed ? err.message : "the handoff's branch couldn't be pushed");
      }
      if (!Array.isArray(pushed)) {
        const { held: files, commits, unchecked } = pushed;
        const file = files.join(", ");
        log(`withheld the handoff's commits ${Object.values(commits).join(", ")} for ${id} in ${room}: the lines they add to ${file} match a secret pattern`);
        // Released, every held commit goes as it was, with any released before (#56).
        hold(id, () => pushAndReply({ ...pushAnyway, ...commits }));
        return { type: "refusal", v: PROTOCOL_VERSION, id, reason: "withheld", file, held: files.length, ...(unchecked.length ? { unchecked } : {}) };
      }
      return { type: "reply", v: PROTOCOL_VERSION, id, kind: "write-brief", handoff: { id: (request as Extract<Ask, { kind: "write-brief" }>).handoff, brief: body, repos: pushed }, ...(isFallback ? { fallback: true as const } : {}), ...(cap ? { cap } : {}), ...(noClaude ? { noClaude: true as const } : {}) };
    };
    const reply: () => Promise<Outgoing> = isBrief ? () => pushAndReply(null) : async () => ({ type: "reply", v: PROTOCOL_VERSION, id, kind: "answer-question", answer: body });
    const matched = await scan(body);
    if (!matched) return reply();
    log(`withheld the ${isBrief ? "brief" : "answer"} for ${id} in ${room}: it matches the secret pattern "${matched}"`);
    if (released.delete(id)) {
      log(`${id} was released while it was being written, so it is sent`);
      return reply();
    }
    hold(id, reply);
    return { type: "refusal", v: PROTOCOL_VERSION, id, reason: "withheld" };
  }

  // Keeps a withheld reply for its release, dropping the oldest past MAX_HELD.
  function hold(id: string, reply: () => Promise<Outgoing>) {
    held.set(id, reply);
    if (held.size > MAX_HELD) {
      const oldest = held.keys().next().value!;
      held.delete(oldest);
      dropped.add(oldest);
      if (dropped.size > REMEMBER_DROPPED) dropped.delete(dropped.values().next().value!);
      log(`dropped the withheld reply for ${oldest}: more than ${MAX_HELD} are held`);
    }
  }

  async function release(id: string) {
    const reply = held.get(id);
    if (!reply) {
      if (running.has(id)) {
        released.add(id);
        return;
      }
      const sent = finished.get(id);
      if (sent?.type === "reply") send(sent);
      else if (dropped.has(id)) send(unavailable(id, `its withheld reply was dropped to make room: more than ${MAX_HELD} were held at once, so ask again`));
      else send(unavailable(id, "nothing is withheld under this id here; the runner may have restarted since, so ask again"));
      return;
    }
    held.delete(id);
    try {
      deliver(id, await reply());
    } catch (err) {
      log(`${id}: couldn't send the released reply: ${(err as Error).message}`);
      deliver(id, unavailable(id, "the released reply couldn't be sent"));
    }
  }

  return {
    take(message) {
      if (message.type === "release") {
        void release(message.id);
        return;
      }
      if (message.type === "drop") {
        if (held.delete(message.id)) log(`dropped the withheld reply for ${message.id}: its handoff is over`);
        else if (running.has(message.id)) dropping.add(message.id);
        else if (runningTakes.has(message.id)) droppedTakes.add(message.id);
        return;
      }
      if (message.type === "handoff") {
        const handoff = message.handoff;
        const takeId = message.session ?? handoff.id;
        if (!take) log(`the office server sent handoff ${handoff.id} to take, which this runner doesn't handle yet`);
        else if (taking.has(handoff.id)) log(`handoff ${handoff.id} is being taken already`);
        else if (takes.has(takeId)) log(`take ${takeId} of handoff ${handoff.id} was run already, so it isn't run again`);
        else {
          takes.add(takeId);
          if (takes.size > REMEMBER) takes.delete(takes.values().next().value!);
          taking.add(handoff.id);
          runningTakes.add(takeId);
          // Whichever comes first, the take's own end or takeCapMinutes, ends it here: a take that
          // never finishes can't keep its handoff in hand, and one given up opens nothing more.
          let over = false;
          let timer: ReturnType<typeof setTimeout> | undefined;
          const finish = (m: TakenMessage | null) => {
            if (over) return;
            over = true;
            clearTimeout(timer);
            taking.delete(handoff.id);
            if (m) send(m);
          };
          void settings().then((s) => {
            if (over) return;
            timer = setTimeout(() => {
              droppedTakes.add(takeId);
              log(`handoff ${handoff.id}: taking it didn't finish within ${s.takeCapMinutes} minutes, so it was given up`);
              finish({ type: "taken", v: PROTOCOL_VERSION, handoff: handoff.id, failures: [{ step: "open", output: `Taking it didn't finish within ${s.takeCapMinutes} minutes on this machine, so it was given up: take it again from the floor.` }] });
            }, s.takeCapMinutes * 60000);
          });
          void take(message, () => droppedTakes.has(takeId))
            .then(
              (m) => {
                const opens = !over && !droppedTakes.has(takeId);
                finish(m);
                onTaken?.(message, m, opens);
              },
              (err: unknown) => {
                log(`handoff ${handoff.id}: taking it failed: ${(err as Error)?.stack ?? String(err)}`);
                finish(null);
                onTaken?.(message, null, false);
              },
            )
            .finally(() => (runningTakes.delete(takeId), droppedTakes.delete(takeId)));
        }
        return;
      }
      if (message.kind === "owner-answer" || message.kind === "owner-message") {
        send(unavailable(message.id, `an owner's ${message.kind === "owner-answer" ? "answer" : "message"} goes to the live session, not the runner`));
        return;
      }
      if (message.kind === "focus") {
        const { id, handoff } = message;
        if (!focus) send(unavailable(id, "this plugin version can't bring a session to the front"));
        else
          void focus(handoff).then(
            (problem) => send(problem ? unavailable(id, problem) : { type: "reply", v: PROTOCOL_VERSION, id, kind: "focus" }),
            (err: unknown) => (log(`handoff ${handoff}: focusing it failed: ${(err as Error)?.stack ?? String(err)}`), send(unavailable(id, "the runner failed"))),
          );
        return;
      }
      const request = message;
      const { id, room } = request;
      if (running.has(id)) return;
      const sent = finished.get(id);
      if (sent) {
        send(sent);
        return;
      }
      running.add(id);
      const turn = (rooms.get(room) ?? Promise.resolve())
        .then(() => answer(request))
        .catch((err: unknown) => {
          log(`${id}: the runner failed: ${(err as Error)?.stack ?? String(err)}`);
          return unavailable(id, "the runner failed");
        })
        .then((message) => deliver(id, message))
        .finally(() => {
          running.delete(id);
          released.delete(id);
          if (rooms.get(room) === turn) rooms.delete(room);
        });
      rooms.set(room, turn);
    },
    idle: () => running.size === 0 && taking.size === 0,
    async settled() {
      while (rooms.size) await Promise.all(rooms.values());
    },
  };
}
