// An agent's questions to its owner, as they leave the machine, and the owner's answers from the
// floor (#50).
//
// Each open question is secret-checked here with the patterns reports use (src/runner/scan.ts): one
// that matches, and every one while the patterns can't be read, goes out only as a placeholder,
// `withheld`, and is answered in the terminal. One that passes is `answerable` only while the hooks
// module (src/hooks/register.ts) has marked that it waits for it. One it never marked, asked before the
// plugin loaded, is `asMessage` in a session whose hooks module takes messages and can end a turn: the
// hooks module ends the agent's turn, which closes the dialog, and submits the answers as the owner's
// own message. Elsewhere it stays read-only on the floor.
//
// The office server sends an owner-answer request down this session's link, and the data layer
// passes it to the hooks module, which writes back, in the file the line names, whether the answer
// ended the call (or went in as the owner's message); the server is told: a reply only when it did, a refusal saying why when it didn't.
// With no word in TAKEN_WAIT_MS, a question that has closed meanwhile gets a `closed` reply, which
// says it has an answer without saying whose; one still open, or one going in as a message (whose
// dialog the hooks module closed itself), is refused. Either way the word is
// looked for a minute longer, and a take that comes then is sent as a `late` reply.
// Only the plugin's own data layer can pass it on: the runner, reporting a session without a hooks
// module, can't, so its questions are answered in the terminal. Each answer's annotations are those
// Claude Code's own dialog gives: the owner's notes as the floor sent them, and the preview of the
// option chosen, which this fills from the question itself, whatever the floor sent.

import { PROTOCOL_VERSION, type Facts, type QuestionFact, type RefusalMessage, type ReplyMessage, type RequestMessage } from "@isoplan/protocol";
import type { AnswerTaken, DataLayerLine, OwnerAnswerLine } from "../lines.js";
import { scan, type Pattern } from "../runner/scan.js";

// How long the hooks module has to say whether it took the answer, and how often its file is looked for.
const TAKEN_WAIT_MS = 10000;
const POLL_MS = 100;
// How long a word that came too late is still looked for.
const LATE_MS = 60000;

/** What a withheld question says in place of its text. */
export const WITHHELD_QUESTION = "Held for its owner to check: the secret check found what may be a secret in this question, so it is answered in the terminal.";

/**
 * The facts with their questions as they are sent: each one the scan matches, or every one while
 * `patterns` is null, as a placeholder marked `withheld`; each other one `answerable` while its mark
 * in `marks` says the hooks module waits for it, else, with no mark at all, `asMessage` when the
 * session `answersLate`, unless the source left part of it out. A question whose mark says the wait
 * has ended has had its answer, though the transcript may not show it yet.
 */
export function prepareQuestions(facts: Facts, patterns: Pattern[] | null, marks: ReadonlyMap<string, boolean>, log: (text: string) => void, answersLate = false): Facts {
  if (!facts.questions?.length) return facts;
  const questions = facts.questions.map((q) => {
    const text = q.questions.flatMap((x) => [x.question, x.header, ...x.options.flatMap((o) => [o.label, o.description, o.preview ?? ""])]).join("\n");
    const matched = scan(text, patterns);
    if (matched) {
      log(`withheld the question ${q.id} of ${q.agent}: ${patterns ? `it matches the secret pattern "${matched}"` : "the secret patterns couldn't be read"}; it is answered in the terminal`);
      return { id: q.id, agent: q.agent, at: q.at, questions: [{ question: WITHHELD_QUESTION, header: "", options: [], multiSelect: false }], withheld: true as const };
    }
    // One the source couldn't take whole (a question or option it left out) can't be answered whole here.
    if (q.extra?.incomplete) return q;
    if (marks.get(q.id) === true) return { ...q, answerable: true as const };
    return answersLate && !marks.has(q.id) ? { ...q, asMessage: true as const } : q;
  });
  return { ...facts, questions };
}

export interface OwnerAnswerOptions {
  detached: boolean;
  /** This data layer's session id, which the hooks module checks the process still runs before it sends a late answer. */
  session: string;
  /** The facts last sent, whose questions are the ones still open. */
  facts: () => Facts | null;
  /** Where the hooks module writes whether it took the answer. */
  file: string;
  emit: (line: DataLayerLine) => void;
  /** The file's JSON text, or null while it isn't there or doesn't parse; reading it removes it. */
  take: (file: string) => Promise<string | null>;
  sleep?: (ms: number) => Promise<void>;
  waitMs?: number;
}

type OwnerAnswer = Extract<RequestMessage, { kind: "owner-answer" }>;

/**
 * What to send back for a request, and whether the hooks module's word may still come (`gaveUp`):
 * it never wrote it within `waitMs`, so `lateTake` watches for it after.
 */
export interface Relayed {
  message: ReplyMessage | RefusalMessage;
  gaveUp: boolean;
}

/**
 * A reply only once the hooks module says the answer ended the question's call; a refusal saying why
 * not otherwise. With no word from it in `waitMs`, a question that has closed since gets a `closed`
 * reply, which says only that it has an answer, the floor's or the terminal's; one going in as a
 * message is refused, since the hooks module closed it itself, by ending the turn.
 */
export async function relayOwnerAnswer(request: OwnerAnswer, { detached, session, facts, file, emit, take, sleep = wait, waitMs = TAKEN_WAIT_MS }: OwnerAnswerOptions): Promise<Relayed> {
  const refuse = (detail: string, gaveUp = false): Relayed => ({ message: { type: "refusal", v: PROTOCOL_VERSION, id: request.id, reason: "unavailable", detail }, gaveUp });
  const open = () => facts()?.questions?.find((q) => q.id === request.question);
  if (detached) return refuse("Isoplan's plugin isn't running in this session: type /reload-plugins in it, or answer the question in its terminal.");
  const question = open();
  if (!question) return refuse("The question isn't waiting for an answer any more: it was answered in the terminal, or the agent moved on.");
  if (!question.answerable && !question.asMessage) return refuse("This question was asked before Isoplan's plugin loaded in its session, so answer it in its terminal.");
  const answers = request.chat ? {} : request.answers;
  const annotations = request.chat ? undefined : annotationsOf(question, answers, request.annotations);
  const line: OwnerAnswerLine = { type: "owner-answer", question: request.question, answers, ...(annotations && { annotations }), ...(request.chat && { chat: true as const }), file };
  emit(question.asMessage ? { ...line, late: { session, text: lateText(question, answers, annotations, !!request.chat) } } : line);
  for (let waited = 0; waited < waitMs; waited += POLL_MS) {
    await sleep(POLL_MS);
    const taken = await takenFrom(take, file, request.question);
    if (taken === null) continue;
    if (taken.taken) return { message: { type: "reply", v: PROTOCOL_VERSION, id: request.id, kind: "owner-answer" }, gaveUp: false };
    return refuse(NOT_TAKEN[taken.reason ?? "answered"]);
  }
  if (question.asMessage) return refuse("Claude Code hasn't taken the answer as a message yet: if the agent doesn't get it soon, answer in its terminal.", true);
  if (!open()) return { message: { type: "reply", v: PROTOCOL_VERSION, id: request.id, kind: "owner-answer", closed: true }, gaveUp: true };
  return refuse("Claude Code didn't take the answer in time: answer it in the terminal.", true);
}

/**
 * After a request gave up: whether the hooks module still says, within `ms`, that it took the answer
 * (true), that it didn't (false), or nothing at all (null).
 */
export async function lateTake(question: string, file: string, take: OwnerAnswerOptions["take"], { sleep = wait, ms = LATE_MS } = {}): Promise<boolean | null> {
  for (let waited = 0; waited < ms; waited += POLL_MS) {
    await sleep(POLL_MS);
    const taken = await takenFrom(take, file, question);
    if (taken !== null) return taken.taken;
  }
  return null;
}

/** Why the floor's answer didn't go in, as the floor is told. */
const NOT_TAKEN: Record<NonNullable<AnswerTaken["reason"]> | "answered", string> = {
  answered: "The question was answered in the terminal first.",
  ended: "This session has ended, or carried on as a new one, so the answer wasn't sent.",
  "no-turn": "Isoplan's plugin couldn't stop the agent's turn to send the answer, so answer the question in its terminal.",
  "no-submit": "This session's version of Claude Code can't take messages from Isoplan, so answer the question in its terminal.",
  dropped: "Claude Code didn't let the answer in as a message, so answer the question in its terminal.",
};

/**
 * The annotations Claude Code's dialog would give: the owner's notes on each answer, and on a
 * question with one answer, the preview of the option chosen, from the question itself. None when
 * there are neither.
 */
export function annotationsOf(question: QuestionFact, answers: Record<string, string>, given: OwnerAnswer["annotations"] = {}): OwnerAnswerLine["annotations"] {
  const out: NonNullable<OwnerAnswerLine["annotations"]> = {};
  for (const q of question.questions) {
    const notes = given[q.question]?.notes;
    const preview = q.multiSelect ? undefined : q.options.find((o) => o.label === answers[q.question])?.preview;
    if (notes || preview) out[q.question] = { ...(notes && { notes }), ...(preview && { preview }) };
  }
  return Object.keys(out).length ? out : undefined;
}

/**
 * The owner's message for a question the hooks module never saw: their answers and notes, as a
 * person would put them, saying they answered on the Isoplan floor; or, for "Chat about this", that
 * they want to talk the questions through first.
 */
export function lateText(question: QuestionFact, answers: Record<string, string>, annotations: OwnerAnswerLine["annotations"], chat: boolean): string {
  const several = question.questions.length > 1;
  const asked = several ? "questions" : "question";
  if (chat) return [`I saw your ${asked} on the Isoplan floor, and I'd like to talk ${several ? "them" : "it"} through before I answer:`, ...question.questions.map((q) => `- "${q.question}"`)].join("\n");
  const lines = [`I answered your ${asked} on the Isoplan floor:`];
  for (const q of question.questions) {
    const answer = answers[q.question];
    const notes = annotations?.[q.question]?.notes;
    lines.push(`- "${q.question}": ${answer && answer !== NOTES_ONLY ? answer : notes ? "no option, just a note" : "no answer"}`);
    if (notes) lines.push(`  My notes: ${notes}`);
  }
  return lines.join("\n");
}

// The answer Claude Code's dialog gives a question answered with a note and no option.
const NOTES_ONLY = "(notes only)";

// The hooks module's word in the file, or null while there is none for this question (another
// request's word can't be in this request's own file, but is passed over all the same).
async function takenFrom(take: OwnerAnswerOptions["take"], file: string, question: string): Promise<Pick<AnswerTaken, "taken" | "reason"> | null> {
  const text = await take(file);
  if (text === null) return null;
  let taken: Partial<AnswerTaken> = {};
  try {
    taken = JSON.parse(text);
  } catch {}
  if (taken.question !== question) return null;
  return { taken: taken.taken === true, ...(taken.reason && taken.reason in NOT_TAKEN && { reason: taken.reason }) };
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
