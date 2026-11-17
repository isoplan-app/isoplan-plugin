// Asking an expert (protocol 0.13.0), as the session's agent does it through ask_expert: the
// question goes to the office server on the session's short link, as askRoom's does (ask.ts), and
// the server sends it on to the runner that hosts the expert. A question that isn't blocking returns
// once the server has taken it. A blocking one waits for the answer until `deadline` (the runner's
// expertWaitSeconds after the question reached it), the server's news cutting each wait short and
// an ask-check every `pollMs` in between; then the agent is told to explore meanwhile. Whatever
// isn't answered by then arrives later as a note (hooks/register.ts). An end shown here is acked.
//
// No wait here is longer than the deadline when blocking: a question sent that the server didn't
// confirm in time is told as pending, never as an error, since it may have been asked all the same;
// one the deadline stopped before it was sent is told so, to be asked again later.

import { PROTOCOL_VERSION, type AskedMessage, type ExpertCode, type OfficeServerMessage } from "@isoplan/protocol";
import type { SideLink } from "../handoff/connection.js";
import type { Told } from "../pipe/pipe.js";
import { TokenExpired } from "./ask.js";
import { answeredText, askedText, expertText, exploreMeanwhileText, notSentText, pendingText, type ExpertAbout } from "./expert-text.js";

// How long the server has to answer the ask and each check.
const ANSWER_MS = 20000;

// The server's refusals of an ask-expert that end it with their own code; any other is the runner's
// way to the office failing.
const REFUSALS = new Set<string>(["EXPERT_UNKNOWN", "EXPERT_CAP", "EXPERT_PLUGIN_OLD"]);

export interface ExpertQuestion {
  expert: string;
  question: string;
  blocking: boolean;
  /** The tool call's id: asked again under it, it is the same question. */
  key: string;
}

export interface ExpertWait {
  /** When a blocking ask stops waiting, in ms. */
  deadline: number;
  now?: () => number;
  pollMs?: number;
}

/**
 * Opens the session's short link with `open`, given how long it may take (when blocking, no longer
 * than the deadline leaves), and asks on it. A blocking ask whose link opens too late isn't sent; a
 * link that won't open is the runner's way to the office failing.
 */
export async function askExpertThrough(open: (ms: number) => Promise<SideLink>, a: ExpertQuestion, o: ExpertWait & { connectMs: number }): Promise<Told> {
  const now = o.now ?? Date.now;
  const notSent = { text: notSentText({ expert: a.expert, id: a.key }) };
  const ms = a.blocking ? Math.min(o.connectMs, o.deadline - now()) : o.connectMs;
  if (ms <= 0) return notSent;
  let link: SideLink;
  try {
    link = await open(ms);
  } catch (err) {
    if (a.blocking && now() >= o.deadline) return notSent;
    return { text: expertText("EXPERT_RUNNER_UNREACHABLE", { expert: a.expert, id: a.key, words: String((err as Error)?.message ?? err) }), failed: true, code: "EXPERT_RUNNER_UNREACHABLE" };
  }
  try {
    return await askExpert(link, a, o);
  } finally {
    // A blocking ask is past its wait by now: the close handshake finishes without it.
    const close = link.close();
    if (!a.blocking) await close;
  }
}

const isAsked = (id: string | null) => (m: OfficeServerMessage): m is AskedMessage => m.type === "asked" && (id === null || m.question === id);

/** What the agent is told: the answer, where the question stands, or why it failed (`failed`, with its code). */
export async function askExpert(link: SideLink, a: ExpertQuestion, { deadline, now = Date.now, pollMs = 2000 }: ExpertWait): Promise<Told> {
  const left = () => (a.blocking ? deadline - now() : ANSWER_MS);
  const about = (id: string, more: Partial<ExpertAbout> = {}): ExpertAbout => ({ expert: a.expert, id, ...more });
  link.send({ type: "ask-expert", v: PROTOCOL_VERSION, expert: a.expert, question: a.question, blocking: a.blocking, key: a.key });
  const first = left() > 0 ? await link.next(isAsked(null), Math.min(ANSWER_MS, left())).catch(() => null) : null;
  if (!first) return { text: pendingText(about(a.key)) };
  if (first.type === "error") {
    if (first.code === "token-expired") throw new TokenExpired(first.message);
    const code = (REFUSALS.has(first.code) ? first.code : "EXPERT_RUNNER_UNREACHABLE") as ExpertCode;
    return { text: expertText(code, about(a.key, { words: first.message || undefined })), failed: true, code };
  }
  let latest: AskedMessage = first;
  const id = latest.question;
  if (a.blocking) {
    try {
      while (waits(latest) && left() > 0) {
        // A change the server sends ends the wait early; otherwise the check asks where it stands.
        const pushed = await link.next(isAsked(id), Math.min(pollMs, left())).catch(() => null);
        if (pushed?.type === "error") break;
        if (pushed) {
          latest = pushed;
          continue;
        }
        if (left() <= 0) break;
        link.send({ type: "ask-check", v: PROTOCOL_VERSION, question: id });
        const checked = await link.next(isAsked(id), Math.min(ANSWER_MS, left()));
        if (checked.type === "error") break;
        latest = checked;
      }
    } catch {
      // The link went, or the last check ran out of time: what the server said last stands.
    }
  }
  const told = tell(latest, about(id, { host: latest.owner }), a.blocking);
  if (latest.state === "answered" || latest.state === "dropped" || latest.state === "withheld") link.send({ type: "asked-ack", v: PROTOCOL_VERSION, question: id });
  return told;
}

// Still being answered, with nothing else to say: a blocking ask goes on waiting.
const waits = (m: AskedMessage) => m.state === "asking" && m.code !== "EXPERT_STARTING";

function tell(m: AskedMessage, about: ExpertAbout, blocking: boolean): Told {
  switch (m.state) {
    case "answered":
      return { text: answeredText({ ...about, answer: m.answer ?? "", commit: m.commit, branch: m.branch }) };
    case "dropped": {
      const code = m.code ?? "EXPERT_DROPPED";
      return { text: expertText(code, { ...about, words: m.note }), failed: true, code };
    }
    case "withheld":
      return { text: expertText("EXPERT_ANSWER_WITHHELD", about), failed: true, code: "EXPERT_ANSWER_WITHHELD" };
    case "queued": {
      const code = m.code === "EXPERT_STARTING" ? "EXPERT_STARTING" : "EXPERT_QUEUED";
      return { text: expertText(code, code === "EXPERT_QUEUED" ? { ...about, words: m.note } : about), code };
    }
    case "asking":
      if (m.code === "EXPERT_STARTING") return { text: expertText("EXPERT_STARTING", about), code: "EXPERT_STARTING" };
      return { text: blocking ? exploreMeanwhileText(about) : askedText(about) };
  }
}
