// The secret scan (E8): every answer, brief and report is checked on the owner's machine, before it
// leaves, against the patterns in the mod's secret-patterns.json and any the owner adds in
// ~/.claude/isoplan/secret-patterns.json. The owner's file only adds: a pattern of the mod's can't be
// taken out there. Each pattern is `{ "name", "regex", "flags"? }`, the regex in JavaScript's syntax
// and the flags any of i, m, s and u. The owner's file may be missing; one that can't be read or
// parsed, or has a pattern that doesn't compile, makes the patterns unreadable, so everything is
// held, with a log line saying why. A fault in the mod's file is an error.

import fs from "node:fs/promises";

export interface Pattern {
  name: string;
  regex: RegExp;
}

/** What `scan` names as the match when the patterns couldn't be read. */
export const UNREADABLE = "unreadable patterns: everything is held";

/** The patterns in `file`: [] when the owner's is missing, and null, logged, when it can't be used. */
async function readPatterns(file: string, optional: boolean, log: (text: string) => void): Promise<Pattern[] | null> {
  const unusable = (why: string) => {
    if (!optional) throw new Error(`${file}: ${why}`);
    log(`${file} can't be used, so every answer, brief and report is held: ${why}`);
    return null;
  };
  let value: unknown;
  try {
    value = JSON.parse(await fs.readFile(file, "utf8"));
  } catch (err) {
    if (optional && (err as NodeJS.ErrnoException).code === "ENOENT") return [];
    if (!optional) throw err;
    return unusable((err as Error).message);
  }
  const list = (value as { patterns?: unknown } | null)?.patterns;
  if (!Array.isArray(list)) return unusable('it has no "patterns" list');
  const out: Pattern[] = [];
  for (const p of list as { name?: unknown; regex?: unknown; flags?: unknown }[]) {
    const name = typeof p?.name === "string" && p.name ? p.name : String(p?.regex);
    try {
      if (typeof p?.regex !== "string" || !p.regex) throw new Error("no regex");
      const flags = typeof p.flags === "string" ? p.flags : "";
      if (!/^[imsu]*$/.test(flags)) throw new Error(`flags "${flags}" aren't any of i, m, s and u`);
      out.push({ name, regex: new RegExp(p.regex, flags) });
    } catch (err) {
      return unusable(`the secret pattern "${name}" doesn't compile: ${(err as Error).message}`);
    }
  }
  return out;
}

/** The mod's patterns and the owner's, or null when the owner's can't be used. */
export async function loadPatterns(modFile: string, ownerFile: string, log: (text: string) => void): Promise<Pattern[] | null> {
  const mod = (await readPatterns(modFile, false, log))!;
  const owner = await readPatterns(ownerFile, true, log);
  return owner && [...mod, ...owner];
}

/** The name of the first pattern `text` matches, or null when it matches none; UNREADABLE when `patterns` is null. */
export function scan(text: string, patterns: Pattern[] | null): string | null {
  if (!patterns) return UNREADABLE;
  return patterns.find((p) => p.regex.test(text))?.name ?? null;
}

/** An error's stack (or its text) to log; in its place, a note when it matches a secret pattern, or the patterns can't be read. */
export function errorText(err: unknown, patterns: Pattern[] | null): string {
  const text = String((err as Error)?.stack ?? err);
  const hit = scan(text, patterns);
  return hit === null ? text : hit === UNREADABLE ? "(its text is left out: the secret patterns can't be read)" : `(its text is left out: it matches the secret pattern ${hit})`;
}

/** What `cut` puts in place of a secret. */
export const CUT = "[secret cut]";

/** `text` with every match of every pattern cut out, for showing on this machine (the desktop app's window of what's running); null when `patterns` is null. */
export function cut(text: string, patterns: Pattern[] | null): string | null {
  if (!patterns) return null;
  return patterns.reduce((t, p) => t.replace(new RegExp(p.regex.source, p.regex.flags.includes("g") ? p.regex.flags : p.regex.flags + "g"), (m) => (m ? CUT : "")), text);
}
