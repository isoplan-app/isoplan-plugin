// Watching one folder of expert files: ~/.claude/isoplan/experts, whose `*.json` at its top level
// are expert files, or ~/.claude/isoplan/expert-instances, whose are instance files (experts.ts
// watches both). It is polled every `lookMs` rather than watched with fs.watch, which misses changes
// on some file systems and fires twice on others. A file counts as changed when its content does:
// its time and size say when to read it again, and a hash of what it holds says whether it changed,
// so saving it unchanged changes nothing. A file that can't be read this look (an editor writing it)
// is looked at again next time; a folder that can't be listed is logged once and changes nothing,
// while a folder that isn't there means no experts. A file (or the folder) missing counts as
// removed only once it is missing from two looks in a row: an editor or a sync tool that saves by
// deleting and writing again leaves it missing for a moment, and removing it would stop its expert.

import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

export interface ExpertFileChange {
  /** The file's base name, which an expert file names its expert by. */
  name: string;
  kind: "added" | "changed" | "removed";
  /** What it holds now; none once removed. */
  text?: string;
}

export interface ExpertFilesOptions {
  dir: string;
  lookMs?: number;
  read?: (file: string) => Promise<string>;
  log: (text: string) => void;
  onChange: (change: ExpertFileChange) => void;
}

export interface ExpertFiles {
  /** Looks once, now; settles once every change it found is told. A look already under way is that one. */
  look(): Promise<void>;
  stop(): void;
}

export function watchExpertFiles({ dir, lookMs = 5000, read = (file) => fs.readFile(file, "utf8"), log, onChange }: ExpertFilesOptions): ExpertFiles {
  const known = new Map<string, { mtimeMs: number; size: number; hash: string }>();
  const missing = new Set<string>(); // known names missing from the last look
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let said = "";

  const lookNow = async () => {
    let names: string[];
    try {
      names = (await fs.readdir(dir, { withFileTypes: true })).filter((e) => e.isFile() && e.name.endsWith(".json")).map((e) => e.name);
      said = "";
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        const text = `couldn't look in the experts folder ${dir}: ${(err as Error).message}`;
        if (text !== said) log(text);
        said = text;
        return;
      }
      names = [];
    }
    const present = new Set<string>();
    for (const file of names.sort()) {
      const name = file.slice(0, -".json".length);
      present.add(name);
      const full = path.join(dir, file);
      const st = await fs.stat(full).catch(() => null);
      const was = known.get(name);
      if (!st || (was && was.mtimeMs === st.mtimeMs && was.size === st.size)) continue;
      let text: string;
      try {
        text = await read(full);
      } catch {
        continue;
      }
      const hash = createHash("sha256").update(text).digest("hex");
      known.set(name, { mtimeMs: st.mtimeMs, size: st.size, hash });
      if (!was) onChange({ name, kind: "added", text });
      else if (was.hash !== hash) onChange({ name, kind: "changed", text });
    }
    for (const name of [...known.keys()]) {
      if (present.has(name)) {
        missing.delete(name);
        continue;
      }
      if (!missing.has(name)) {
        missing.add(name);
        continue;
      }
      missing.delete(name);
      known.delete(name);
      onChange({ name, kind: "removed" });
    }
  };

  let looking: Promise<void> | null = null;
  const look = () => (looking ??= lookNow().finally(() => (looking = null)));
  const next = async () => {
    try {
      await look();
    } catch (err) {
      log(`couldn't look in the experts folder ${dir}: ${String((err as Error)?.message ?? err)}`);
    }
    if (stopped) return;
    timer = setTimeout(() => void next(), lookMs);
    timer.unref?.();
  };
  void next();

  return {
    look,
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
}
