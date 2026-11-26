// The experts each session on this computer may ask, per office (isoplan-app#340): the office's
// `expert-rights` line for the session, which main.ts taps on its way to the session's hooks module,
// rewritten for this computer. A right whose key this computer's own expert has, whose publish there
// was refused `key-taken` (expert-instance.ts), is taken out, and that expert is put in instead for
// a session whose project is that expert's, with this computer's person as its `host`: until it is
// renamed it is asked only on its owner's computer (D14). The last line of each session is given
// again, rewritten, whenever those experts change. What each session may ask is kept
// (expert-records-per-office.ts), so the asking module has it after a restart too.

import { MAX_EXPERTS, type ExpertRight, type ExpertRightsMessage, type Project } from "@isoplan/protocol";
import type { FromOffice } from "../lines.js";
import type { ExpertInstances } from "./expert-instance.js";
import type { ExpertRecordsPerOffice } from "./expert-records-per-office.js";

export interface ExpertRightsOnThisComputerOptions {
  instances: Pick<ExpertInstances, "ownKeyTakenExperts" | "onChange">;
  store: ExpertRecordsPerOffice;
  /** This computer's person, as a session's `host` names them. */
  person: () => string;
  /** The project a folder is in, when the office `server` takes it. */
  projectOf: (server: string, folder: string) => Promise<Project | null>;
  /** Sends a line to the session's hooks module, when one is connected. */
  send: (session: string, line: FromOffice<ExpertRightsMessage>) => void;
  log: (text: string) => void;
}

export interface ExpertRightsOnThisComputer {
  /** The office's line for the session in `cwd`: kept, rewritten and given to its hooks module. */
  tap(session: string, cwd: string, line: FromOffice<ExpertRightsMessage>): void;
  /** What the session may ask through `server` now, else as last kept; null for nothing. */
  rights(session: string, server: string): ExpertRight[] | null;
}

export function createExpertRightsOnThisComputer(o: ExpertRightsOnThisComputerOptions): ExpertRightsOnThisComputer {
  // By session, then server: the office's own line, and the session's folder.
  const lines = new Map<string, Map<string, { cwd: string; line: FromOffice<ExpertRightsMessage> }>>();
  const rewritten = new Map<string, ExpertRight[]>(); // `${session}\n${server}`
  const chains = new Map<string, Promise<void>>();
  let ownKeys = "";

  async function rewrite(session: string, cwd: string, line: FromOffice<ExpertRightsMessage>) {
    const server = line.server ?? "";
    const own = o.instances.ownKeyTakenExperts(server);
    const taken = new Set(own.map((r) => r.key));
    const rights = line.experts.filter((r) => !taken.has(r.name));
    if (own.length) {
      const here = await o.projectOf(server, cwd).catch(() => null);
      for (const r of own) {
        const project = here && (await o.projectOf(server, r.file.repo).catch(() => null));
        if (project && project.id.toLowerCase() === here.id.toLowerCase()) rights.push({ name: r.key, subject: r.file.subject, repo: project.name, host: o.person() });
      }
    }
    rights.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    const experts = rights.slice(0, MAX_EXPERTS);
    rewritten.set(`${session}\n${server}`, experts);
    o.store.setRights(server, session, experts);
    o.send(session, { ...line, experts });
  }

  // One session's lines one at a time, in order.
  const queue = (session: string, work: () => Promise<void>) => {
    const next = (chains.get(session) ?? Promise.resolve()).then(work).catch((err: Error) => o.log(`couldn't work out what session ${session} may ask: ${err.message}`));
    chains.set(session, next);
  };

  o.instances.onChange(() => {
    const keys = [...new Set([...lines.values()].flatMap((m) => [...m.keys()]))].flatMap((server) => o.instances.ownKeyTakenExperts(server).map((r) => `${server} ${r.key}`)).sort().join(",");
    if (keys === ownKeys) return;
    ownKeys = keys;
    for (const [session, byServer] of lines) for (const { cwd, line } of byServer.values()) queue(session, () => rewrite(session, cwd, line));
  });

  return {
    tap(session, cwd, line) {
      let byServer = lines.get(session);
      if (!byServer) lines.set(session, (byServer = new Map()));
      byServer.set(line.server ?? "", { cwd, line });
      queue(session, () => rewrite(session, cwd, line));
    },
    rights: (session, server) => rewritten.get(`${session}\n${server}`) ?? o.store.rights(server, session),
  };
}
