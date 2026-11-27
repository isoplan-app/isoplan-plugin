// Making an employee from the floor (isoplan-app#341, `make-an-employee`): only for this runner's
// person (`by`). A key an expert file, instance file or job file here has fails it at once. Else,
// saying each state (`making-an-employee`): `cloning` while it finds this computer's checkout of the
// project or clones it (project-checkout-for-expert.ts, D11's route); `setting-up-experts` while it
// starts setting up, here, each expert of the job this computer keeps no instance of
// (expert-instance.ts, the one click covering them), waiting for their set-ups to end, so the
// employee's grounding has their subjects and its first run can ask them; then the definition is
// checked against the secret and personal-data patterns (a match fails it naming the field, before
// anything is written); the job file is written whole (employee-file.ts `jobFileText`), which the
// registry picks up and its office's link publishes; `grounding`; `ready` once it is grounded and
// published, and its first run starts at once; or `failed` with why, the office's refusal of its job
// included. A failure after the file was written removes it. What a failure says on the floor is
// secret-checked, and an error that isn't one of its own words (a file this computer couldn't write)
// says only that runner.log has it, since its words can name this computer's folders.

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
  ties: Pick<EmployeeTies, "tiedAndPublished" | "blocked" | "refused">;
  /** Whether an expert file or instance file here has the key. */
  expertHasKey: (key: string) => boolean;
  /** This computer's checkout of `project`, as the office `server` takes it; null when it has none. */
  checkoutOf: (server: string, project: Project) => Promise<string | null>;
  clone: (url: string, project: string) => Promise<string | { problem: string; reason?: string }>;
  /** The office's directory entry of an expert, and whether this computer keeps an instance of it, and its set-up. */
  expertEntry: (server: string, key: string) => ExpertDirectoryEntry | null;
  hasInstance: (server: string, key: string) => boolean;
  setUpExpert: (server: string, entry: ExpertDirectoryEntry) => void;
  /** Whether this computer's set-up of the expert has ended, ready or failed, or none is under way. */
  expertSetUpDone: (server: string, key: string) => boolean;
  check: (thing: { text: string; files: { path: string }[] }) => Promise<CheckBeforeItLeaves>;
  scan: (text: string) => Promise<string | null>;
  log: (text: string) => void;
  /** runner.json's `employees.makingWaitMinutes`: how long it waits for its experts' set-ups, and then for its grounding and its publish. */
  waitMinutes: () => Promise<number>;
  pollMs?: number;
}

export interface MakeAnEmployee {
  take(server: string, m: MakeAnEmployeeMessage, send: (m: RunnerEmployeeMessage) => boolean): Promise<void>;
}

/** A making's failure in its own words, which can go to the floor. */
class MakingFailed extends Error {}
const FAILED_HERE = "something on this computer failed as it was made; the runner log there says what";
const WORDS_HELD = "why it failed matched a secret pattern, so only the runner log on this computer says it";

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
        const setting: string[] = [];
        for (const expert of d.job!.experts) {
          const entry = o.expertEntry(server, expert);
          if (!entry) continue;
          if (!o.hasInstance(server, expert)) o.setUpExpert(server, entry);
          setting.push(expert);
        }
        const waitMs = (await o.waitMinutes()) * 60000;
        const wait = () => new Promise((r) => setTimeout(r, o.pollMs ?? 2000));
        for (const end = Date.now() + waitMs; setting.some((k) => !o.expertSetUpDone(server, k)); await wait()) {
          if (Date.now() > end) {
            o.log(`employee ${key}: its experts' set-ups didn't end in time, so it grounds without waiting for ${setting.filter((k) => !o.expertSetUpDone(server, k)).join(", ")}`);
            break;
          }
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
        for (const end = Date.now() + waitMs; ; await wait()) {
          const state = o.employees.stateOf(key);
          if (state?.state === "failed") throw new MakingFailed(state.why === "clone" ? "its own clone of the project couldn't be made or fetched on this computer" : "its grounding failed; this computer's health log for it says why");
          if (state?.state === "ready" && o.ties.tiedAndPublished(key)) break;
          const blocked = o.ties.blocked(key);
          if (blocked && blocked !== "project") throw new MakingFailed(blocked);
          const refused = o.ties.refused(key);
          if (refused) throw new MakingFailed(refused);
          if (Date.now() > end) throw new MakingFailed("its grounding and its publish didn't finish in time; its health log says how far it got");
        }
        say("ready");
        void o.employees.runNow(key);
      } catch (err) {
        o.log(`employee ${key}: couldn't be made: ${(err as Error).message}`);
        if (written) await fs.rm(o.employees.jobFilePath(key), { force: true }).catch(() => {});
        const words = err instanceof MakingFailed ? err.message : FAILED_HERE;
        say("failed", (await o.scan(words)) ? WORDS_HELD : words);
      } finally {
        making.delete(key);
      }
    },
  };
}
