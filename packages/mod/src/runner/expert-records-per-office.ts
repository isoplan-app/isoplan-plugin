// What this computer last had from each office server about its experts (isoplan-app#340), in
// ~/.claude/isoplan/runner/expert-records-per-office.json, by the office's data-layer address: its
// last expert directory with asks.json's caps, the last counts of this person's questions on their
// other computers, the experts each session may ask there (its last `expert-rights`, while seen in
// the last `keptHours`), and when it was saved. So this computer's instances answer its sessions
// after a restart while that office can't be reached. Written whole after each change, a moment
// later; a file that is missing or doesn't parse reads as none.

import path from "node:path";
import type { ExpertDirectoryMessage, ExpertQuestionsAskedOnYourOtherComputersMessage, ExpertRight } from "@isoplan/protocol";
import { readJson, writeJson } from "./expert-state.js";

interface OneOffice {
  directory?: ExpertDirectoryMessage;
  otherComputers?: ExpertQuestionsAskedOnYourOtherComputersMessage;
  rights?: Record<string, { rights: ExpertRight[]; at: number }>;
  savedAt?: number;
}

export interface ExpertRecordsPerOffice {
  load(): Promise<void>;
  directory(server: string): ExpertDirectoryMessage | null;
  otherComputers(server: string): ExpertQuestionsAskedOnYourOtherComputersMessage | null;
  rights(server: string, session: string): ExpertRight[] | null;
  /** null forgets it: the office showed it is from before 0.17.0. */
  setDirectory(server: string, m: ExpertDirectoryMessage | null): void;
  setOtherComputers(server: string, m: ExpertQuestionsAskedOnYourOtherComputersMessage): void;
  setRights(server: string, session: string, rights: ExpertRight[]): void;
  written(): Promise<void>;
}

export const expertRecordsPerOfficePath = (isoplanDir: string) => path.join(isoplanDir, "runner", "expert-records-per-office.json");

export function createExpertRecordsPerOffice(o: { file: string; keptHours: () => Promise<number>; log: (text: string) => void }): ExpertRecordsPerOffice {
  let offices: Record<string, OneOffice> = {};
  let writing: Promise<void> = Promise.resolve();
  let due: ReturnType<typeof setTimeout> | null = null;

  const office = (server: string) => (offices[server] ??= {});
  const save = () => {
    if (due) return;
    due = setTimeout(() => {
      due = null;
      writing = writing
        .then(async () => {
          const keep = (await o.keptHours()) * 3600000;
          for (const each of Object.values(offices)) for (const [session, r] of Object.entries(each.rights ?? {})) if (Date.now() - r.at > keep) delete each.rights![session];
          await writeJson(o.file, { version: 1, offices });
        })
        .catch((err: Error) => o.log(`couldn't write ${o.file}: ${err.message}`));
    }, 200);
    due.unref?.();
  };

  return {
    async load() {
      const read = (await readJson(o.file)) as { version?: unknown; offices?: unknown } | null;
      if (read?.version === 1 && read.offices && typeof read.offices === "object" && !Array.isArray(read.offices)) offices = read.offices as Record<string, OneOffice>;
    },
    directory: (server) => offices[server]?.directory ?? null,
    otherComputers: (server) => offices[server]?.otherComputers ?? null,
    rights: (server, session) => offices[server]?.rights?.[session]?.rights ?? null,
    setDirectory(server, m) {
      const each = office(server);
      if (m) each.directory = m;
      else delete each.directory;
      each.savedAt = Date.now();
      save();
    },
    setOtherComputers(server, m) {
      Object.assign(office(server), { otherComputers: m, savedAt: Date.now() });
      save();
    },
    setRights(server, session, rights) {
      const each = office(server);
      (each.rights ??= {})[session] = { rights, at: Date.now() };
      each.savedAt = Date.now();
      save();
    },
    async written() {
      if (due) {
        clearTimeout(due);
        due = null;
        writing = writing.then(() => writeJson(o.file, { version: 1, offices })).catch(() => {});
      }
      await writing;
    },
  };
}
