import fs from "node:fs";
import path from "node:path";
import { MakingAnEmployeeMessageSchema, PROTOCOL_VERSION, type ExpertDefinition, type MakeAnEmployeeMessage } from "@isoplan/protocol";
import { afterEach, expect, test, vi } from "vitest";
import { modDir, tempRoot } from "../data-layer/fixture.js";
import type { RunnerEmployeeMessage } from "../data-layer/link.js";
import { parseEmployeeFile } from "./employee-file.js";
import { ADAM, draftTo, GROUNDS, RECORD, setUpEmployee, until } from "./employee-fixture.js";
import { createMakeAnEmployee } from "./make-an-employee.js";
import { loadPatterns } from "./scan.js";
import { createCheckBeforeItLeaves } from "./what-was-learned-before-it-leaves.js";

vi.stubEnv("CLAUDE_CONFIG_DIR", path.join(tempRoot(), "claude"));
for (const [k, v] of Object.entries({ GIT_AUTHOR_NAME: "Adam", GIT_AUTHOR_EMAIL: "adam@example.invalid", GIT_COMMITTER_NAME: "Adam", GIT_COMMITTER_EMAIL: "adam@example.invalid" })) vi.stubEnv(k, v);
vi.setConfig({ testTimeout: 180000 });

const closing: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const c of closing.splice(0)) await c();
});

const SERVER = "ws://127.0.0.1:4799/data-layer";
const DEFINITION: ExpertDefinition = {
  key: "adams-outreach",
  project: { id: "git.example.invalid/acme/docs", name: "docs" },
  subject: "Drafts cold emails to agencies in Adam's voice.",
  model: "sonnet",
  promoteAtTokens: 80000,
  areas: [],
  job: { brief: "Each run, draft one email to one person at each agency that qualifies.", rules: [], documents: ["outreach/who-qualifies.md"], examples: [], schedule: { every: "day", at: "09:00", timeZone: "UTC" }, tools: ["Read", "Grep"], experts: ["adams-writing"] },
};

async function stack() {
  const s = await setUpEmployee({ noJob: true, rules: [...GROUNDS, { kind: "fork", text: "Today's run", calls: [draftTo("ana@agency.example")], reply: "done" }] });
  closing.push(s.close);
  const setUp: string[] = [];
  const cloned: string[] = [];
  const make = createMakeAnEmployee({
    account: ADAM,
    employees: s.employees,
    ties: { tiedAndPublished: (key) => (s.employees.get(key) ? RECORD : null), blocked: () => null },
    expertHasKey: (key) => key === "adr",
    checkoutOf: async () => null,
    // Isoplan's own clone, made from the project's address: here, the project's checkout.
    clone: async (url) => (cloned.push(url), s.checkout),
    expertEntry: (_server, key) => ({ key, expertRecordId: "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f", project: DEFINITION.project, owner: ADAM, revision: 1 }),
    hasInstance: () => false,
    setUpExpert: (_server, entry) => void setUp.push(entry.key),
    check: createCheckBeforeItLeaves({ secretPatterns: async () => [{ name: "test secret", regex: /SECRET/ }], personalDataPatterns: () => loadPatterns(path.join(modDir, "personal-data-patterns.json"), path.join(s.root, "none.json"), () => {}) }),
    scan: async (text) => (text.includes("SECRET") ? "test secret" : null),
    log: (t) => void s.logs.push(t),
    pollMs: 100,
  });
  const said: RunnerEmployeeMessage[] = [];
  const take = (o: Partial<MakeAnEmployeeMessage> = {}, definition: ExpertDefinition = DEFINITION) => make.take(SERVER, { type: "make-an-employee", v: PROTOCOL_VERSION, request: "q1", by: ADAM, definition, ...o }, (m) => (said.push(m), true));
  const states = () => said.map((m) => (m as { state: string }).state);
  return { s, take, said, states, setUp, cloned };
}

test("made from the floor: cloned where there is no checkout, its experts set up here, its job file written whole, grounded, each state said, and its first run starts at once", async () => {
  const t = await stack();
  await t.take();
  expect(t.states()).toEqual(["cloning", "setting-up-experts", "grounding", "ready"]);
  for (const m of t.said) expect(MakingAnEmployeeMessageSchema.safeParse(m).success).toBe(true);
  expect(t.cloned[0]).toBe("https://git.example.invalid/acme/docs.git");
  expect(t.setUp).toEqual(["adams-writing"]);
  const file = parseEmployeeFile(fs.readFileSync(t.s.employees.jobFilePath("adams-outreach"), "utf8"), "adams-outreach.json");
  expect(file.ok && file.employee).toMatchObject({ repo: t.s.checkout, job: DEFINITION.job });
  await until(() => (t.s.e().runs?.listing().ended.length ?? 0) === 1, 60000, "its first run");
  expect(t.s.e().runs!.listing().ended[0]).toMatchObject({ outcome: "ran", drafts: 1 });
});

test("a key used here fails at once; a brief with an email address fails before anything is written, naming the brief; another account's ask makes nothing", async () => {
  const t = await stack();
  await t.take({}, { ...DEFINITION, key: "adr" });
  expect(t.said).toEqual([expect.objectContaining({ key: "adr", state: "failed", detail: expect.stringContaining("pick another") })]);
  await t.take({}, { ...DEFINITION, job: { ...DEFINITION.job!, brief: "Draft emails Adam signs as adam@studio.example." } });
  expect(t.said.at(-1)).toMatchObject({ state: "failed", detail: expect.stringContaining("its brief has") });
  expect(fs.existsSync(t.s.employees.jobFilePath("adams-outreach"))).toBe(false);
  const before = t.said.length;
  await t.take({ by: { id: "claude:acc-valentina", name: "Valentina" } });
  expect(t.said).toHaveLength(before);
});
