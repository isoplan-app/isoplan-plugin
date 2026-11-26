// An expert fork's reply, in the blocks its grounding tells it to use:
//
//   <answer>…</answer>                 what the asker gets
//   <cited>one path per line</cited>   repo-relative, a line range allowed (asks.ts:166-173)
//   <learned>…</learned>               only after asking the senior or exploring: added to the junior's trunk
//
// or, to ask the senior, the whole reply is `<ask-senior>the question</ask-senior>`.
//
// The runner gives each citation the commit it was read at, not the expert: read in this fork, it is
// the fork's commit; else the commit the senior gave it, else the junior's index, else the commit a
// thing the fork was told of (learned elsewhere) gives its file, else unknown. It then puts the citation block under the answer, saying which files changed since they
// were read. An answer and its block fit MAX_EXPERT_ANSWER_LENGTH, which the asker's hooks quote
// whole: the answer is cut, never the block.

import { MAX_EXPERT_ANSWER_LENGTH, MAX_WHAT_WAS_LEARNED_LENGTH } from "@isoplan/protocol";

export interface ExpertReply {
  /** The `<answer>` block, or null when the reply has none (the whole text is then the answer). */
  answer: string | null;
  /** Each cited path as written, in order, once each; those that aren't repo-relative are in `dropped`. */
  cited: string[];
  /** Cited paths that were absolute or had `..` in them. */
  dropped: string[];
  learned: string | null;
  /** The question for the senior, when that is the whole reply. */
  askSenior: string | null;
}

export interface CitedWithCommit {
  /** The citation as written, its line range kept. */
  cited: string;
  /** Its file. */
  file: string;
  /** The commit it was read at, or null when unknown. */
  commit: string | null;
  from: "read" | "senior" | "index" | "told" | "unknown";
}

const block = (text: string, tag: string) => new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(text)?.[1]?.trim() ?? null;

/** A citation's file: its line range taken off. */
export const fileOf = (cited: string) => cited.replace(/:\d+(-\d+)?$/, "");

/** The files a <learned> block names after its last "Files:", as repo-relative paths with their line ranges taken off. */
export function filesNamedIn(learned: string): string[] {
  const at = [...learned.matchAll(/files:/gi)].at(-1);
  if (!at) return [];
  return learned
    .slice(at.index + at[0].length)
    .split(/[\s,;`]+/)
    .map((f) => fileOf(f.replace(/\\/g, "/").replace(/^[-*(]+|[).]+$/g, "").replace(/^\.\//, "")))
    .filter(Boolean);
}

/** Whether a cited path names a file in the repo: relative, with no `..`. */
const repoRelative = (file: string) => file !== "" && !/^([a-zA-Z]:|[\\/~])/.test(file) && !file.split(/[\\/]/).includes("..");

export function parseReply(text: string): ExpertReply {
  const asked = /^\s*<ask-senior>([\s\S]*)<\/ask-senior>\s*$/.exec(text);
  const cited: string[] = [];
  const dropped: string[] = [];
  for (const raw of (block(text, "cited") ?? "").split(/\r?\n/)) {
    const line = raw.trim().replace(/^[-*]\s+/, "").replace(/\\/g, "/");
    if (!line || cited.includes(line) || dropped.includes(line)) continue;
    (repoRelative(fileOf(line)) ? cited : dropped).push(line);
  }
  const learned = block(text, "learned");
  return {
    answer: block(text, "answer"),
    cited,
    dropped,
    learned: learned ? learned.slice(0, MAX_WHAT_WAS_LEARNED_LENGTH) : null,
    askSenior: asked ? asked[1]!.trim() || null : null,
  };
}

/** Each citation's commit: read in this fork, else the senior's, else the index, else what a thing the fork was told of gives it (`told`), else unknown. */
export function withCommitsRead(cited: string[], reads: ReadonlySet<string>, senior: Readonly<Record<string, string>>, index: Readonly<Record<string, string>>, commit: string, told: Readonly<Record<string, string>> = {}): CitedWithCommit[] {
  return cited.map((c) => {
    const file = fileOf(c);
    if (reads.has(file)) return { cited: c, file, commit, from: "read" };
    if (Object.hasOwn(senior, file)) return { cited: c, file, commit: senior[file]!, from: "senior" };
    if (Object.hasOwn(index, file)) return { cited: c, file, commit: index[file]!, from: "index" };
    if (Object.hasOwn(told, file)) return { cited: c, file, commit: told[file]!, from: "told" };
    return { cited: c, file, commit: null, from: "unknown" };
  });
}

const short = (commit: string) => commit.slice(0, 7);

/**
 * The block under the answer: "Cited, on <branch> at <commit>:" and a line per citation, those read
 * at an older commit whose file `changed` since marked so. Empty with no citations. A block too long
 * to fit an answer drops its last citations, saying how many.
 */
export function citationBlock(cited: CitedWithCommit[], branch: string, commit: string, changed: ReadonlySet<string>): string {
  if (!cited.length) return "";
  const head = `Cited, on ${branch} at ${short(commit)}:`;
  const lines = cited.map((s) => `- ${s.cited} (${s.commit === null ? "commit unknown" : `read at ${short(s.commit)}${s.commit !== commit && changed.has(s.file) ? ", changed since" : ""}`})`);
  // Room for the two line breaks and at least the cut answer's "…".
  const room = MAX_EXPERT_ANSWER_LENGTH - 3;
  const all = [head, ...lines].join("\n");
  if (all.length <= room) return all;
  for (let kept = lines.length - 1; kept >= 0; kept--) {
    const text = [head, ...lines.slice(0, kept), `- … and ${lines.length - kept} more`].join("\n");
    if (text.length <= room) return text;
  }
  return head;
}

/** The answer the asker gets: `body`, cut to fit, then the block. */
export function answerText(body: string, block: string): string {
  const room = block ? MAX_EXPERT_ANSWER_LENGTH - block.length - 2 : MAX_EXPERT_ANSWER_LENGTH;
  const cut = body.length <= room ? body : body.slice(0, room - 1) + "…";
  return block ? `${cut}\n\n${block}` : cut;
}
