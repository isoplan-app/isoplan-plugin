// Making an employee from the floor (isoplan-app#341, `make-an-employee`): only for this runner's
// person (`by`). A key an expert file, instance file or job file here has fails it at once. Else,
// saying each state (`making-an-employee`): `cloning` while it finds this computer's checkout of the
// project or clones it (project-checkout-for-expert.ts, D11's route); `setting-up-experts` while it
// starts setting up, here, each expert of the job this computer keeps no instance of
// (expert-instance.ts, the one click covering them); then the definition is checked against the
// secret and personal-data patterns (a match fails it naming the field, before anything is written);
// the job file is written whole (employee-file.ts `jobFileText`), which the registry picks up and its
// office's link publishes; `grounding`; `ready` once it is grounded and published, and its first run
// starts at once; or `failed` with why. A failure after the file was written removes it.

import fs from "node:fs/promises";
import path from "node:path";
import { MAX_DETAIL_LENGTH, PROTOCOL_VERSION, type ExpertDirectoryEntry, type MakeAnEmployeeMessage, type MakingAnEmployeeMessage, type Project } from "@isoplan/protocol";
import type { RunnerEmployeeMessage } from "../data-layer/link.js";
import { jobFileText } from "./employee-file.js";
import { definitionCheck, type EmployeeTies } from "./employee-ties.js";
import type { Employees } from "./employees.js";
import { renamed } from "./expert-checkout.js";
import { CLONE_WORDS_HELD } from "./expert-instance.js";
import { findOrCloneProjectCheckoutForExpert } from "./project-checkout-for-expert.js";
import type { CheckBeforeItLeaves } from "./what-was-learned-before-it-leaves.js";

export interface MakeAnEmployeeOptions {
  account: { id: string; name: string };
  employees: Pick<Employees, "refresh" | "stateOf" | "runNow" | "jobFilePath" | "get">;
  ties: Pick<EmployeeTies, "tiedAndPublished" | "blocked">;
  /** Whether an expert file or instance file here has the key. */
  expertHasKey: (key: string) => boolean;
  /** This computer's checkout of `project`, as the office `server` takes it; null when it has none. */
  checkoutOf: (server: string, project: Project) => Promise<string | null>;
  clone: (url: string, project: string) => Promise<string | { problem: string; reason?: string }>;
  /** The office's directory entry of an expert, and whether this computer keeps an instance of it, and its set-up. */
  expertEntry: (server: string, key: string) => ExpertDirectoryEntry | null;
  hasInstance: (server: string, key: string) => boolean;
  setUpExpert: (server: string, entry: ExpertDirectoryEntry) => void;
  check: (thing: { text: string; files: { path: string }[] }) => Promise<CheckBeforeItLeaves>;
  scan: (text: string) => Promise<string | null>;
  log: (text: string) => void;
  /** How long it waits for its grounding and its publish. */
  waitMs?: number;
  pollMs?: number;
}

export interface MakeAnEmployee {
  take(server: string, m: MakeAnEmployeeMessage, send: (m: RunnerEmployeeMessage) => boolean): Promise<void>;
}

export function createMakeAnEmployee(o: MakeAnEmployeeOptions): MakeAnEmployee {
  const making = new Set<string>();
  return {
    async take(server, m, send) {
      if (m.by.id !== o.account.id) return void o.log(`${server} asked to make an employee for ${m.by.name || m.by.id}, not this runner's own account, so nothing is made`);
      const d = m.definition;
      const key = d.key;
      const say = (state: MakingAnEmployeeMessage["state"], detail?: string) => void send({ type: "making-an-employee", v: PROTOCOL_VERSION, request: m.request, key, state, ...(detail && { detail: detail.slice(0, MAX_DETAIL_LENGTH) }) });
      if (making.has(key) || o.expertHasKey(key) || o.employees.get(key) || (await fs.stat(o.employees.jobFilePath(key)).then(() => true, () => false))) return say("failed", "this computer has an expert or an employee with this name already: pick another");
      making.add(key);
      let written = false;
      try {
        say("cloning");
        const found = await findOrCloneProjectCheckoutForExpert({ project: d.project, checkoutOf: (p) => o.checkoutOf(server, p), clone: o.clone });
        if ("failed" in found) {
          o.log(`employee ${key}: couldn't be made: ${found.failed}`);
          return say("failed", (await o.scan(found.failed)) ? CLONE_WORDS_HELD : found.failed);
        }
        say("setting-up-experts");
        for (const expert of d.job!.experts) {
          const entry = o.expertEntry(server, expert);
          if (entry && !o.hasInstance(server, expert)) o.setUpExpert(server, entry);
        }
        const hit = await definitionCheck(d, o.check);
        if (hit) return say("failed", hit === "unreadable" ? "the secret or personal-data patterns can't be read on this computer, so nothing was made" : hit.why);
        const file = o.employees.jobFilePath(key);
        await fs.mkdir(path.dirname(file), { recursive: true });
        await fs.writeFile(`${file}.${process.pid}.tmp`, jobFileText(d, found.folder));
        await renamed(`${file}.${process.pid}.tmp`, file);
        written = true;
        o.log(`employee ${key}: made from the floor of ${server}; its job file is ${file}`);
        await o.employees.refresh(key);
        say("grounding");
        const end = Date.now() + (o.waitMs ?? 20 * 60000);
        for (;;) {
          const state = o.employees.stateOf(key);
          if (state?.state === "failed") throw new Error(state.why === "clone" ? "its own clone of the project couldn't be made or fetched on this computer" : "its grounding failed; this computer's health log for it says why");
          if (state?.state === "ready" && o.ties.tiedAndPublished(key)) break;
          const blocked = o.ties.blocked(key);
          if (blocked && blocked !== "project") throw new Error(blocked);
          if (Date.now() > end) throw new Error("its grounding and its publish didn't finish in time; its health log says how far it got");
          await new Promise((r) => setTimeout(r, o.pollMs ?? 2000));
        }
        say("ready");
        void o.employees.runNow(key);
      } catch (err) {
        o.log(`employee ${key}: couldn't be made: ${(err as Error).message}`);
        if (written) await fs.rm(o.employees.jobFilePath(key), { force: true }).catch(() => {});
        say("failed", (err as Error).message);
      } finally {
        making.delete(key);
      }
    },
  };
}
