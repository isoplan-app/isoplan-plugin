// Asking the room (#49), as the receiver's agent does it through the plugin's ask_earlier_session tool: the
// question goes to the office server on the session's short link, and the answer comes back from
// the fork of the room's lead on its owner's machine. It never blocks the session for long (#45):
// it polls askPolls times, askPollSeconds apart (runner.json, with the caps), and the server's own
// news of the question cuts a wait short. However runner.json is set, the whole wait, the ask and
// every check included, fits in MAX_WAIT_MS, well under the ten minutes Claude Code gives a
// command the hooks module runs. With no answer by then, the agent is told to carry on: the question stays queued on
// the server, and its end reaches the agent later as a note on one of its next tool results
// (hooks/register.ts). An end shown here is acked (asked-ack), so the server doesn't send it again.
//
// `key` is the tool call's own id: sent again, the ask is the same question, so a retry after a
// lost reply never asks twice.

import { PROTOCOL_VERSION, type AskedMessage, type OfficeServerMessage } from "@isoplan/protocol";
import type { SideLink } from "../handoff/connection.js";
import { endText, MAX_WAIT_MS, waitText } from "./text.js";

export { MAX_WAIT_MS };

/** What runner.json says about asking. */
export interface AskSettings {
  askPolls: number;
  askPollSeconds: number;
}

// How long the server has to answer the ask and each check.
const ANSWER_MS = 20000;

const isAsked = (id: string | null) => (m: OfficeServerMessage): m is AskedMessage => m.type === "asked" && (id === null || m.question === id);

/** The server refused the hello as `token-expired`: the caller renews the token and asks again, under the same key. */
export class TokenExpired extends Error {}

/** What the agent is told when the office server won't let this session in (pairing, #23). */
export const REFUSED: Record<string, string> = {
  "not-paired": "This machine isn't paired with the office yet, so the earlier session can't be asked from here. Isoplan shows a link to pair it in Claude Code's status line; once the person approves it on the floor, ask again.",
  "pairing-ended": "This machine's pairing with the office has ended (it was revoked, or the machine was away too long), so the earlier session can't be asked from here. Isoplan shows a link to pair it again in Claude Code's status line.",
  "forged-hello": "The office server refused this session: it belongs to someone else's machine in the office, so it can't ask from here.",
};

/** What the agent is told when the server didn't confirm the ask: it may have been logged. */
export const UNCONFIRMED =
  "The office server didn't confirm the question in time. It may have been logged all the same, and if so its answer reaches you later as a note on one of your next tool results. Carry on without it, and don't ask it again.";

/** What the agent is told: the answer, or why there is none and that it should carry on. */
export async function askRoom(link: SideLink, question: string, s: AskSettings, { key, deadline = Date.now() + MAX_WAIT_MS, now = Date.now, me }: { key?: string; deadline?: number; now?: () => number; me?: string } = {}): Promise<string> {
  const left = () => deadline - now();
  link.send({ type: "ask-room", v: PROTOCOL_VERSION, question, ...(key ? { key } : {}) });
  const first = left() > 0 ? await link.next(isAsked(null), Math.min(ANSWER_MS, left())).catch(() => null) : null;
  if (!first) return UNCONFIRMED;
  if (first.type === "error") {
    if (first.code === "token-expired") throw new TokenExpired(first.message);
    const refused = REFUSED[first.code];
    return refused ? `${refused} Carry on without the answer.` : `The earlier session can't be asked: ${first.message}`;
  }
  let latest: AskedMessage = first;
  const id = latest.question;
  const pollMs = s.askPollSeconds * 1000;
  try {
    for (let poll = 1; poll <= s.askPolls && !over(latest) && left() > 0; poll++) {
      // A change the server sends ends the wait early; otherwise the poll asks where it stands.
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
    if (over(latest)) link.send({ type: "asked-ack", v: PROTOCOL_VERSION, question: id });
  } catch {
    // The link went, or the last check ran out of time: what the server knows stands, and the end
    // still arrives as a note.
  }
  return over(latest) ? endText(latest, false, me) : waitText(latest);
}

const over = (m: AskedMessage) => m.state === "answered" || m.state === "dropped";

/**
 * The offices to ask in, in turn, until one's list takes the session's repo (#105): those that gave
 * the session its rights (`granted`, by address), or every one with none named, in config.json's
 * order, with the one the session took its handoff through (`taken`) first.
 */
export function askOffices<O extends { server: string }>(offices: readonly O[], granted: readonly string[], taken: string | null): O[] {
  const named = granted.length ? offices.filter((o) => granted.includes(o.server)) : [...offices];
  const first = named.find((o) => o.server === taken);
  return first ? [first, ...named.filter((o) => o !== first)] : named;
}
