// The check a thing an instance of an expert learned passes on this computer before it goes to its
// expert record (isoplan-app#366, ADR 0004): its text and each file path it names, against the
// secret patterns (secret-patterns.json plus the person's, scan.ts) and the personal-data patterns
// (the mod's personal-data-patterns.json plus ~/.claude/isoplan/personal-data-patterns.json, which
// only adds). Both are read again for every check, so a pattern added later stops what hasn't gone
// yet. Patterns that can't be read send nothing.

import { scan, UNREADABLE, type Pattern } from "./scan.js";

export type CheckBeforeItLeaves = { ok: true } | { matched: "secret" | "personal-data"; pattern: string } | { unreadable: true };

export interface BeforeItLeavesOptions {
  secretPatterns: () => Promise<Pattern[] | null>;
  personalDataPatterns: () => Promise<Pattern[] | null>;
}

/** What is checked of a thing learned: its text, then each file it names. */
export const checkedText = (thing: { text: string; files: { path: string }[] }) => [thing.text, ...thing.files.map((f) => f.path)].join("\n");

export function createCheckBeforeItLeaves(o: BeforeItLeavesOptions): (thing: { text: string; files: { path: string }[] }) => Promise<CheckBeforeItLeaves> {
  return async (thing) => {
    const text = checkedText(thing);
    const secret = scan(text, await o.secretPatterns());
    if (secret === UNREADABLE) return { unreadable: true };
    if (secret) return { matched: "secret", pattern: secret };
    const personal = scan(text, await o.personalDataPatterns());
    if (personal === UNREADABLE) return { unreadable: true };
    if (personal) return { matched: "personal-data", pattern: personal };
    return { ok: true };
  };
}
