// One office's employee link with its record link (protocol 0.19.0, isoplan-app#341): the gate, the
// job published and listed, its runs and drafts, and what the office's answers do, with this
// computer's employee (employee-fixture.ts) and expert stack (expert-stack-fixture.ts) against a
// stand-in office.

import fs from "node:fs";
import path from "node:path";
import { DataLayerMessageSchema, PROTOCOL_VERSION } from "@isoplan/protocol";
import { afterEach, expect, test, vi } from "vitest";
import { modDir, tempRoot } from "../data-layer/fixture.js";
import type { RunnerExpertRecordMessage } from "../data-layer/link.js";
import { createEmployeeLink } from "./employee-link.js";
import { createEmployeeTies } from "./employee-ties.js";
import { ADAM, draftTo, GROUNDS, setUpEmployee, until, type EmployeeRule } from "./employee-fixture.js";
import { computer, directoryOf, PROJECT, SERVER, sharingDirectoryOf } from "./expert-stack-fixture.js";
import { loadPatterns } from "./scan.js";
import { createCheckBeforeItLeaves } from "./what-was-learned-before-it-leaves.js";

vi.stubEnv("CLAUDE_CONFIG_DIR", path.join(tempRoot(), "claude"));
for (const [k, v] of Object.entries({ GIT_AUTHOR_NAME: "Adam", GIT_AUTHOR_EMAIL: "adam@example.invalid", GIT_COMMITTER_NAME: "Adam", GIT_COMMITTER_EMAIL: "adam@example.invalid" })) vi.stubEnv(k, v);
vi.setConfig({ testTimeout: 180000 });

const closing: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const c of closing.splice(0)) await c();
});

const RECORD = "5b6c7d8e-9f0a-4b1c-8d2e-3f4a5b6c7d8e";
const RUN = "Today's run";

async function stack(job: Record<string, unknown> = {}, rules: EmployeeRule[] = [...GROUNDS, { kind: "fork", text: RUN, calls: [draftTo("ana@agency.example")], reply: "done" }]) {
  const s = await setUpEmployee({ rules, job });
  closing.push(s.close);
  const check = createCheckBeforeItLeaves({ secretPatterns: async () => [{ name: "test secret", regex: /SECRET/ }], personalDataPatterns: () => loadPatterns(path.join(modDir, "personal-data-patterns.json"), path.join(s.claudeDir, "isoplan", "personal-data-patterns.json"), () => {}) });
  let links: Awaited<ReturnType<typeof computer>>["links"] | null = null;
  const ties = createEmployeeTies({ employees: s.employees, servers: [SERVER], account: ADAM, saysEmployees: (server) => links?.get(server)?.directory()?.employees === true, projectOn: async () => PROJECT, check, settings: async () => s.settings, isoplanDir: path.join(s.claudeDir, "isoplan"), log: (t) => void s.logs.push(t) });
  await ties.start();
  const c = await computer({ account: ADAM, employeeTies: ties, employees: s.employees, onEmployeesChange: (l) => s.employees.onChange(() => l()), checkMs: 500 });
  closing.push(c.close);
  links = c.links;
  const link = createEmployeeLink({ server: SERVER, recordLink: c.links.get(SERVER)!, employees: s.employees, ties, send: (m) => (c.sent.get(SERVER)!.push(m as RunnerExpertRecordMessage), true), log: (t) => void s.logs.push(t), checkMs: 500 });
  link.onOpen();
  closing.push(async () => link.stop());
  const types = () => c.sent.get(SERVER)!.map((m) => m.type);
  const jobDefinitions = () => c.of("expert-definition").filter((m) => m.definition.job);
  const health = () => (fs.existsSync(path.join(s.claudeDir, "isoplan", "logs", "employee-adams-outreach.log")) ? fs.readFileSync(path.join(s.claudeDir, "isoplan", "logs", "employee-adams-outreach.log"), "utf8") : "");
  // Its job published on a connection that takes employees and shares what instances learn.
  const published = async () => {
    t.c.take({ ...sharingDirectoryOf([]), employees: true });
    await until(() => t.jobDefinitions().length === 1, 30000, "its job published");
    t.c.take({ type: "expert-definition-result", v: PROTOCOL_VERSION, key: "adams-outreach", outcome: "published", expertRecordId: RECORD, revision: 1 });
    await until(() => t.types().includes("employee-runs"), 30000, "its runs");
  };
  const t = { s, c, ties, link, types, jobDefinitions, health, published };
  return t;
}
const adams = (rows: { sender: string; prospect: string; state: string }[]) => rows.filter((r) => r.sender === "Adam").map((r) => [r.prospect, r.state]);

test("nothing of the family, and no job, on a connection whose directory doesn't take employees; on one that does, its job, then its row in the listing, then its runs and drafts, each message as the protocol has it", async () => {
  const t = await stack();
  await t.s.ready();
  t.c.take(directoryOf([]));
  await until(() => t.types().includes("expert-instance-states"));
  await new Promise((r) => setTimeout(r, 1500));
  expect(t.jobDefinitions()).toEqual([]);
  expect(t.types().filter((x) => x.startsWith("employee-"))).toEqual([]);
  await until(() => t.health().includes("doesn't take employees yet"));

  t.c.reconnect();
  t.link.onOpen();
  const from = t.types().length;
  t.c.take({ ...directoryOf([]), employees: true });
  await until(() => t.jobDefinitions().length === 1, 30000, "its job published");
  expect(t.jobDefinitions()[0]!.definition).toMatchObject({ key: "adams-outreach", areas: [], job: { brief: expect.any(String) } });
  t.c.take({ type: "expert-definition-result", v: PROTOCOL_VERSION, key: "adams-outreach", outcome: "published", expertRecordId: RECORD, revision: 1 });
  await until(() => t.c.of("expert-instance-states").some((m) => m.instances.some((i) => i.key === "adams-outreach" && i.state === "ready")), 30000, "its row listed");
  await until(() => t.types().includes("employee-runs"), 30000, "its runs");
  // On this connection: the listing first, then the family.
  const sent = t.types().slice(from);
  expect(sent.indexOf("employee-runs")).toBeGreaterThan(sent.indexOf("expert-instance-states"));

  // A run: its drafts go, and the office's answer stops them going again; a decision is applied and answered.
  t.s.clock.t = Date.parse("2026-11-26T09:01:00Z");
  await until(async () => (await t.s.e().runs!.tick(), t.c.of("employee-drafts").length > 0), 60000, "its drafts sent");
  const drafts = t.c.of("employee-drafts")[0]!;
  t.c.take({ type: "employee-drafts-received", v: PROTOCOL_VERSION, key: "adams-outreach", expertRecordId: RECORD, run: drafts.run, kept: drafts.drafts.map((d) => d.id), refused: [] });
  t.c.take({ type: "employee-draft-decided", v: PROTOCOL_VERSION, key: "adams-outreach", expertRecordId: RECORD, draft: drafts.drafts[0]!.id, by: ADAM, at: "2026-11-26T10:00:00.000Z", decision: "approved" });
  await until(() => t.c.of("employee-draft-decision-applied").length === 1, 30000, "the decision answered");
  expect(t.c.of("employee-draft-decision-applied")[0]).toMatchObject({ draft: drafts.drafts[0]!.id, whoWasContacted: "marked" });
  for (const m of t.c.sent.get(SERVER)!.filter((x) => x.type.startsWith("employee-") || ("definition" in x && x.definition.job))) expect(DataLayerMessageSchema.safeParse(m).success).toBe(true);
});

test("a job whose brief has an email address is never published, its health log naming the brief; runs-elsewhere stops its runs here with its words", async () => {
  const blocked = await stack({ brief: "Draft emails like the ones Adam signs as adam@studio.example." });
  await blocked.s.ready();
  blocked.c.take({ ...directoryOf([]), employees: true });
  await until(() => blocked.health().includes("field=brief"), 30000, "the brief named");
  expect(blocked.jobDefinitions()).toEqual([]);
  await blocked.c.close();
  await blocked.s.close();
  closing.length = 0;

  const elsewhere = await stack();
  await elsewhere.s.ready();
  elsewhere.c.take({ ...directoryOf([]), employees: true });
  await until(() => elsewhere.jobDefinitions().length === 1, 30000);
  elsewhere.c.take({ type: "expert-definition-result", v: PROTOCOL_VERSION, key: "adams-outreach", outcome: "refused", reason: "runs-elsewhere", machineName: "adams-laptop" });
  await until(() => elsewhere.health().includes("adams-laptop"), 30000, "runs-elsewhere said");
  elsewhere.s.clock.t = Date.parse("2026-11-26T09:01:00Z");
  await elsewhere.s.e().runs!.tick();
  expect(elsewhere.s.e().runs!.running()).toBe(false);
  expect(elsewhere.s.employees.anyTied()).toBe(false);
});

test("a rejection's correction becomes what it learned and goes to its record on its office as what an instance learns does, with no files, as the protocol has it", async () => {
  const t = await stack({}, [...GROUNDS, { kind: "fork", text: RUN, calls: [draftTo("ana@agency.example")], reply: "done" }, { kind: "fork", text: "Your owner rejected these drafts", reply: "<learned>Name the agency's newest project in the first line.</learned>" }]);
  await t.s.ready();
  await t.published();
  t.s.clock.t = Date.parse("2026-11-26T09:01:00Z");
  await until(async () => (await t.s.e().runs!.tick(), t.c.of("employee-drafts").length > 0), 60000, "its drafts sent");
  const draft = t.c.of("employee-drafts")[0]!.drafts[0]!;
  t.c.take({ type: "employee-draft-decided", v: PROTOCOL_VERSION, key: "adams-outreach", expertRecordId: RECORD, draft: draft.id, by: ADAM, at: "2026-11-26T10:00:00.000Z", decision: "rejected", correction: "Too generic.", teach: [] });
  await until(() => t.c.of("employee-draft-decision-applied").length === 1, 30000, "the decision answered");
  await t.s.employees.tick();
  await until(() => t.c.of("expert-instance-learned").length === 1, 60000, "what it learned sent");
  const learned = t.c.of("expert-instance-learned")[0]!;
  expect(learned).toMatchObject({ key: "adams-outreach", expertRecordId: RECORD, text: "Name the agency's newest project in the first line.", files: [] });
  expect(DataLayerMessageSchema.safeParse(learned).success).toBe(true);
});

test("its owner's Try again from the floor grounds a failed employee again; with its job file gone, nothing grounds and the runner log says why", async () => {
  const t = await stack({}, [{ kind: "trunk", text: "Now read your job's documents", exit: true }]);
  await t.published();
  await until(() => t.s.logs.some((l) => l.includes("generation 1 failed")), 60000, "its grounding failed");
  t.s.rules([...GROUNDS, { kind: "fork", text: RUN, reply: "done" }]);
  t.c.take({ type: "set-up-expert-instance", v: PROTOCOL_VERSION, request: "r-1", key: "adams-outreach", expertRecordId: RECORD, by: ADAM, again: true });
  await t.s.ready();

  fs.rmSync(path.join(t.s.employeesDir, "adams-outreach.json"));
  await until(() => t.s.employees.rowOf("adams-outreach")?.jobFileGone === true, 10000, "its job file gone");
  t.c.take({ type: "set-up-expert-instance", v: PROTOCOL_VERSION, request: "r-2", key: "adams-outreach", expertRecordId: RECORD, by: ADAM, again: true });
  await until(() => t.s.logs.some((l) => l.includes("asked to try again, but its job file is gone from this computer")), 10000, "why said");
  expect(t.s.e().trunk).toBeNull();
});

test("deleted on the floor during a run: the run ends first, every claim it held is released, a rejected recipient's kept one too, its job file is moved aside, and its trunks' transcripts and its folder are gone", async () => {
  const t = await stack({}, [...GROUNDS, { kind: "fork", text: RUN, calls: [draftTo("ana@agency.example"), draftTo("bo@agency.example")], reply: "done" }]);
  await t.s.ready();
  await t.published();
  t.s.clock.t = Date.parse("2026-11-26T09:01:00Z");
  await until(async () => (await t.s.e().runs!.tick(), t.c.of("employee-drafts").length > 0), 60000, "its drafts sent");
  const ana = t.c.of("employee-drafts")[0]!.drafts.find((d) => d.to?.address === "ana@agency.example")!;
  t.c.take({ type: "employee-draft-decided", v: PROTOCOL_VERSION, key: "adams-outreach", expertRecordId: RECORD, draft: ana.id, by: ADAM, at: "2026-11-26T10:00:00.000Z", decision: "rejected", correction: "Too generic.", teach: [] });
  await until(() => t.c.of("employee-draft-decision-applied").length === 1, 30000, "the rejection applied");
  // Its next run leaves a draft to cy@ and is still going when it is deleted.
  t.s.rules([...GROUNDS, { kind: "fork", text: RUN, calls: [draftTo("cy@agency.example")], hang: true }]);
  t.s.clock.t = Date.parse("2026-11-27T09:01:00Z");
  await t.s.e().runs!.tick();
  await until(() => t.s.results().filter((r) => r === "Left draft 1 of 10.").length === 2, 60000, "the run's draft left");
  await t.s.e().writer.write();
  expect(adams(t.s.onRemote())).toEqual([
    ["ana@agency.example", "claimed"],
    ["bo@agency.example", "claimed"],
  ]);
  const transcripts = () => fs.readdirSync(path.join(t.s.claudeDir, "projects", "fake")).filter((x) => x.endsWith(".jsonl"));
  expect(transcripts().length).toBeGreaterThan(0);

  t.c.take({ type: "expert-deleted", v: PROTOCOL_VERSION, key: "adams-outreach", expertRecordId: RECORD, by: ADAM });
  await until(() => t.s.logs.some((l) => l.startsWith("employee adams-outreach: deleted, with its trunks")), 60000, "deleted");
  expect(t.s.employees.get("adams-outreach")).toBeNull();
  expect(adams(t.s.onRemote())).toEqual([]);
  expect(fs.readdirSync(path.join(t.s.claudeDir, "isoplan", "deleted-employees"))).toEqual([expect.stringMatching(/^adams-outreach-\d+\.json$/)]);
  expect(fs.existsSync(path.join(t.s.employeesDir, "adams-outreach.json"))).toBe(false);
  expect(transcripts()).toEqual([]);
  expect(fs.existsSync(t.s.dir)).toBe(false);
});
