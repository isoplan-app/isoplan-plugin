// What a fork's question carries of what other instances of its expert learned (isoplan-app#366, D7,
// D17), and how a new generation's grounding is told of it. Pure: the runner works out what is new
// and asks git which files changed (expert.ts); this renders it.
//
// - Each thing: its text, then each file it rests on with the commit it was read at, and, where git
//   says one of its files changed since (or a file has no commit, or the commit is one this clone
//   doesn't know, which git can't diff), "its files changed since; re-read them before relying on it".
// - Tokens are estimated the same on every computer, on the high side, since code and paths take more
//   tokens a character than prose: (its text's length, and each file's path and 12 more) / 3.
// - Within a limit: newest first, stopping at the first that doesn't fit.

import type { FileWhatWasLearnedRestsOn } from "@isoplan/protocol";

export const FILES_CHANGED = "its files changed since; re-read them before relying on it";

export interface ThingInAQuestion {
  id: string;
  text: string;
  files: FileWhatWasLearnedRestsOn[];
}

/** A thing's tokens, estimated. */
export const tokensOf = (t: ThingInAQuestion) => Math.ceil((t.text.length + t.files.reduce((n, f) => n + f.path.length + 12, 0)) / 3);

/** The tokens of all of them. */
export const tokensOfAll = (things: readonly ThingInAQuestion[]) => things.reduce((n, t) => n + tokensOf(t), 0);

/** The newest of `things` (in arrival order, the newest last) that fit `limit`, newest first until one doesn't: returned in arrival order. */
export function newestWithin<T extends ThingInAQuestion>(things: readonly T[], limit: number): T[] {
  const out: T[] = [];
  let left = limit;
  for (let i = things.length - 1; i >= 0; i--) {
    const n = tokensOf(things[i]!);
    if (n > left) break;
    left -= n;
    out.unshift(things[i]!);
  }
  return out;
}

/** The commits each thing's files were read at, grouped as git is asked: commit → files. */
export function filesByCommit(things: readonly ThingInAQuestion[]): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const t of things) for (const f of t.files) if (f.commit) out.set(f.commit, (out.get(f.commit) ?? new Set()).add(f.path));
  return out;
}

/** Whether git said one of its files changed since its commit (`changed`, by commit), or a file has no commit. */
export const filesChangedSince = (t: ThingInAQuestion, changed: ReadonlyMap<string, ReadonlySet<string>>) => t.files.some((f) => !f.commit || changed.get(f.commit)?.has(f.path) !== false);

const short = (commit: string) => commit.slice(0, 7);

/** The things, each as a fork reads it. */
export function thingsText(things: readonly ThingInAQuestion[], changed: (t: ThingInAQuestion) => boolean): string {
  return things
    .map((t) => {
      const files = t.files.map((f) => `${f.path} (${f.commit ? `read at ${short(f.commit)}` : "commit unknown"})`).join(", ");
      return [`- ${t.text.trim().replace(/\n/g, "\n  ")}`, `  Files: ${files}`, ...(changed(t) ? [`  ${FILES_CHANGED}`] : [])].join("\n");
    })
    .join("\n\n");
}
