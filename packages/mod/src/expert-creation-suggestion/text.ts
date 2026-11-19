// What Claude Code shows of an expert creation suggestion (isoplan-app#328): the status line's link and the one
// transcript line, which the hooks module writes (hooks/register.ts), the note the agent is given
// once the expert is ready, and what /isoplan:review-expert-suggestion says (expert-creation-suggestion/open.ts). Each names the
// expert by its display name, with "a" or "an" before it, and the folder as the floor does: "." is
// the repo's top folder. Why it was suggested follows the floor's review card: about how many
// minutes, and the share of the session's context or, without one, about how many tokens, that
// the session spent there, and how often its person corrected the agent there.

import type { ExpertCreationSuggestionLine, ExpertReadyLine } from "../lines.js";

const article = (name: string) => (/^[aeiou]/i.test(name) ? "An" : "A");
/** A folder as the copy names it: "." is the repo's top folder. */
export const folderWords = (folder: string) => (folder === "." ? "the repo's top folder" : folder);
const times = (n: number) => (n === 1 ? "once" : n === 2 ? "twice" : `${n} times`);
// A token count as the floor shows one: 950, 4.2k, 42k, 1.2M.
function tokens(n: number): string {
  const one = (x: number) => String(Math.round(x * 10) / 10);
  if (n < 1000) return String(n);
  if (n < 9950) return one(n / 1000) + "k";
  if (n < 999500) return Math.round(n / 1000) + "k";
  return one(n / 1e6) + "M";
}

/** The suggestion's part of the status line, after its office's part. */
export const expertCreationSuggestionStatusLineText = (line: ExpertCreationSuggestionLine) => `${article(line.name)} ${line.name} could help · review: ${line.url}`;

/** The one transcript line of a suggestion: why it was made, and where to review it. */
export function expertCreationSuggestionTranscriptText(line: ExpertCreationSuggestionLine): string {
  const where = folderWords(line.folder);
  const { minutes, share, tokens: used, corrections } = line.why;
  const m = Math.round(minutes);
  const spent = [m >= 1 ? `about ${m} minute${m === 1 ? "" : "s"}` : null, share >= 0.01 ? `${Math.round(share * 100)}% of its context` : used > 0 ? `about ${tokens(used)} tokens` : null].filter((x) => x !== null);
  const why = spent.length
    ? `this session has spent ${spent.join(" and ")} on ${where}${corrections > 0 ? `, and you corrected it ${times(corrections)} there` : ""}`
    : corrections > 0
      ? `you corrected this session ${times(corrections)} while it worked in ${where}`
      : `this session has searched ${where}`;
  return `Isoplan: ${why}. ${article(line.name)} ${line.name} could answer questions about ${where} without searching it again. Review it: ${line.url} (or type /isoplan:review-expert-suggestion)`;
}

/** The note on a later tool result once the expert created from the session's suggestion is ready. */
export const readyNoteText = (line: ExpertReadyLine) => `Isoplan: the ${line.name} is ready. Ask it with ask_expert, expert "${line.key}", before you search ${folderWords(line.folder)} again.`;
