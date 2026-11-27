import fs from "node:fs";
import path from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import { PROTOCOL_VERSION } from "@isoplan/protocol";
import { tempRoot } from "../data-layer/fixture.js";
import { createEmployeeDraftsHere } from "./employee-drafts-here.js";
import { ADAM, draftTo, GROUNDS, RECORD, setUpEmployee, until, type EmployeeRule } from "./employee-fixture.js";

vi.stubEnv("CLAUDE_CONFIG_DIR", path.join(tempRoot(), "claude"));
for (const [k, v] of Object.entries({ GIT_AUTHOR_NAME: "Adam", GIT_AUTHOR_EMAIL: "adam@example.invalid", GIT_COMMITTER_NAME: "Adam", GIT_COMMITTER_EMAIL: "adam@example.invalid" })) vi.stubEnv(k, v);
vi.setConfig({ testTimeout: 180000 });

const closing: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const c of closing.splice(0)) await c();
});

const RUN = "Today's run";
async function started(rules: EmployeeRule[], o: Parameters<typeof setUpEmployee>[0] = {}) {
  const s = await setUpEmployee({ rules: [...GROUNDS, ...rules], ...o });
  closing.push(s.close);
  await s.ready();
  return s;
}
type S = Awaited<ReturnType<typeof started>>;
async function runAt(s: S, iso: string) {
  const before = s.e().runs!.listing().ended.length;
  s.clock.t = Date.parse(iso);
  await until(async () => (await s.e().runs!.tick(), s.e().runs!.listing().ended.length > before && !s.e().runs!.running()), 90000, `the run at ${iso}`);
  return s.e().runs!.listing().ended[0]!;
}
const idOf = (s: S, address: string) => s.e().drafts.toSend().flatMap((x) => x.drafts).find((d) => d.to?.address === address)!.id;
const adams = (s: S) => s.onRemote().filter((r) => r.sender === "Adam").map((r) => [r.prospect, r.state]);

test("approved: answered after the newest file is fetched, marked, or naming the other sender, or unchecked offline; a duplicate only the push's second try finds is approved twice; skipped marks it skipped; each once, and only for its owner", async () => {
  let between: (() => void) | null = null;
  const s = await started([{ kind: "fork", text: RUN, calls: ["ana", "bo", "cy", "di", "ed"].map((n) => draftTo(`${n}@agency.example`)), reply: "done" }], {
    git: (real) => async (args, opts) => {
      if (args.includes("push") && opts.cwd.endsWith("who-was-contacted") && between) {
        const once = between;
        between = null;
        once();
      }
      return real(args, opts);
    },
  });
  await runAt(s, "2026-11-26T09:01:00Z");

  const ana = idOf(s, "ana@agency.example");
  expect(await s.decided("approved", ana)).toEqual({ whoWasContacted: "marked" });
  // The same decision again: the same answer, applied once.
  expect(await s.decided("approved", ana)).toEqual({ whoWasContacted: "marked" });
  s.valentinaPushes("bo@agency.example");
  expect(await s.decided("approved", idOf(s, "bo@agency.example"))).toEqual({ whoWasContacted: { alreadyContactedBy: "Valentina", at: "2026-11-24T10:00:00.000Z" } });
  // Another account's decision is refused.
  expect(await s.employees.decide("adams-outreach", { type: "employee-draft-decided", v: 1, key: "adams-outreach", expertRecordId: "7a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d", draft: idOf(s, "cy@agency.example"), by: { id: "claude:acc-valentina", name: "Valentina" }, at: "2026-11-26T10:00:00.000Z", decision: "approved" })).toEqual({ refused: "not-yours" });

  // Origin out of reach: unchecked, and marked once it can be.
  fs.renameSync(s.remote, `${s.remote}.away`);
  expect(await s.decided("approved", idOf(s, "cy@agency.example"))).toEqual({ whoWasContacted: "unchecked" });
  fs.renameSync(`${s.remote}.away`, s.remote);

  await s.e().writer.write();
  // Valentina's push lands between this approval's check and its push: the push's second try finds it.
  between = () => s.valentinaPushes("di@agency.example");
  expect(await s.decided("approved", idOf(s, "di@agency.example"))).toEqual({ whoWasContacted: "marked" });
  await until(() => (s.employees.rowOf("adams-outreach")?.approvedTwice ?? []).length === 1, 30000, "approved twice");
  expect(s.employees.rowOf("adams-outreach")!.approvedTwice![0]).toMatchObject({ alreadyContactedBy: "Valentina", at: "2026-11-24T10:00:00.000Z" });

  await s.decided("skipped", idOf(s, "ed@agency.example"));
  await until(() => adams(s).some(([p, st]) => p === "ed@agency.example" && st === "skipped"), 30000, "ed skipped");
  await s.e().writer.write();
  expect(adams(s)).toEqual([
    ["ana@agency.example", "contacted"],
    ["bo@agency.example", "contacted"],
    ["cy@agency.example", "contacted"],
    ["di@agency.example", "contacted"],
    ["ed@agency.example", "skipped"],
  ]);
});

test("rejected: the claim is kept and the recipient and correction go to the next run's prompt; a failed run keeps them for its try again, a run that drafts them marks the draft after a correction, a run that doesn't lets them go", async () => {
  const s = await started([{ kind: "fork", text: RUN, calls: [draftTo("ana@agency.example"), draftTo("bo@agency.example")], reply: "done" }]);
  await runAt(s, "2026-11-26T09:01:00Z");
  await s.decided("rejected", idOf(s, "ana@agency.example"), { correction: "Name their newest project." });
  await s.decided("rejected", idOf(s, "bo@agency.example"), { correction: "Too long." });
  const rejected = () => JSON.parse(fs.readFileSync(path.join(s.dir, "rejected-for-the-next-run.json"), "utf8")).recipients.map((r: { prospect: string }) => r.prospect);
  expect(rejected()).toEqual(["ana@agency.example", "bo@agency.example"]);
  await until(() => adams(s).length === 2);
  expect(adams(s)).toEqual([
    ["ana@agency.example", "claimed"],
    ["bo@agency.example", "claimed"],
  ]);

  // A run that fails keeps them for its try again; its prompt carried them.
  s.rules([...GROUNDS, { kind: "fork", text: RUN, exit: true }]);
  expect((await runAt(s, "2026-11-27T09:01:00Z")).outcome).toBe("failed");
  const prompt = s.claude().filter((x) => x.kind === "fork" && x.text?.includes(RUN)).at(-1)!.text!;
  expect(prompt).toContain("ana@agency.example>: Name their newest project.");
  expect(rejected()).toEqual(["ana@agency.example", "bo@agency.example"]);

  // Its try again drafts ana again (after a correction) but not bo, whose kept claim is let go.
  s.rules([...GROUNDS, { kind: "fork", text: RUN, calls: [draftTo("ana@agency.example")], reply: "done" }]);
  const retry = await runAt(s, "2026-11-27T09:11:00Z");
  expect(retry).toMatchObject({ wasTheTryAgain: true, drafts: 1 });
  expect(s.e().drafts.toSend().flatMap((x) => x.drafts).find((d) => d.to?.address === "ana@agency.example")!.afterACorrection).toBe(true);
  expect(rejected()).toEqual([]);
  await until(() => !adams(s).some(([p]) => p === "bo@agency.example"), 30000, "bo released");
});

test("expired: the claim is released, and a late decision is still applied, even 29 days past its expiry", async () => {
  const s = await started([{ kind: "fork", text: RUN, calls: [draftTo("ana@agency.example"), draftTo("bo@agency.example")], reply: "done" }]);
  await runAt(s, "2026-11-26T09:01:00Z");
  const ana = idOf(s, "ana@agency.example");
  const bo = idOf(s, "bo@agency.example");
  s.clock.t = Date.parse("2026-11-28T10:00:00Z");
  await s.e().drafts.tidy();
  await until(() => adams(s).length === 0, 30000, "claims released");
  expect(s.e().drafts.waiting()).toBe(0);
  expect(await s.decided("approved", ana)).toEqual({ whoWasContacted: "marked" });
  s.clock.t = Date.parse("2026-12-27T09:00:00Z");
  await s.e().drafts.tidy();
  expect(await s.decided("skipped", bo)).toEqual({});
  await until(() => adams(s).length === 2, 30000, "late decisions applied");
  expect(adams(s)).toEqual([
    ["ana@agency.example", "contacted"],
    ["bo@agency.example", "skipped"],
  ]);
});

test("decisions are applied one at a time, so the same rejection twice at once is applied once; a late rejection of an expired draft releases no claim a newer draft to the same person holds", async () => {
  const s = await started([{ kind: "fork", text: RUN, calls: [draftTo("ana@agency.example")], reply: "done" }]);
  const rejected = () => JSON.parse(fs.readFileSync(path.join(s.dir, "rejected-for-the-next-run.json"), "utf8")).recipients.map((r: { prospect: string }) => r.prospect);
  await runAt(s, "2026-11-26T09:01:00Z");
  const first = idOf(s, "ana@agency.example");
  // Expired, its claim released; the next run drafts ana again, and claims her.
  s.clock.t = Date.parse("2026-11-28T10:00:00Z");
  await s.e().drafts.tidy();
  await until(() => adams(s).length === 0, 30000, "released");
  await runAt(s, "2026-11-29T09:01:00Z");
  expect(adams(s)).toEqual([["ana@agency.example", "claimed"]]);

  // The first draft's rejection comes late, twice at once.
  const [a, b] = await Promise.all([s.decided("rejected", first), s.decided("rejected", first)]);
  expect(b).toEqual(a);
  expect(rejected()).toEqual(["ana@agency.example"]);
  // The next run carries her, can't draft her while the newer draft waits, and ends: the newer draft's claim stays.
  await runAt(s, "2026-11-30T09:01:00Z");
  expect(s.results().at(-1)).toBe("A draft to ana@agency.example waits for your owner already: pick another.");
  expect(rejected()).toEqual([]);
  await s.e().writer.write();
  expect(adams(s)).toEqual([["ana@agency.example", "claimed"]]);
});

test("learning from a rejection: the employee's fork and each expert taught count their own failed tries, so one giving up leaves the rest waiting; 30 days past its expiry the draft goes, learned from or not", async () => {
  const dir = path.join(tempRoot(), "employee");
  const clock = { t: Date.parse("2026-11-26T09:00:00Z") };
  const writer = { fetch: async () => ({ ok: true as const }), lookUp: () => ({ mine: null, others: [] }), add: async () => {}, write: async () => ({ pushed: true as const, someoneElseHad: [], contactedTwice: [] }) };
  const d = createEmployeeDraftsHere({ dir, writer, account: () => ADAM, now: () => clock.t, log: () => {} });
  await d.load();
  const answers = { "adams-writing": [{ question: "How does Adam open?", answer: "With their newest project.", files: [{ path: "voice.md" }] }] };
  expect(await d.leave("r1", { text: "Hello Ana.", to: { name: "Ana", address: "ana@agency.example" } }, 10, answers)).toBe("Left draft 1 of 10.");
  await d.endRun("r1", { held: new Set(), dropped: new Set(), expiresAt: "2026-11-28T09:00:00.000Z", outcome: "ran" });
  const id = d.toSend()[0]!.drafts[0]!.id;
  await d.decide({ type: "employee-draft-decided", v: PROTOCOL_VERSION, key: "adams-outreach", expertRecordId: RECORD, draft: id, by: ADAM, at: "2026-11-26T10:00:00.000Z", decision: "rejected", correction: "Shorter.", teach: ["adams-writing"] });
  // The employee's fork fails twice and gives up; the expert, whose instance wasn't ready each time, still waits.
  await d.learned([id], "employee", false);
  expect(d.toLearn()[0]!.learning).toEqual({ employee: false, experts: [], tries: { employee: 1 } });
  await d.learned([id], "employee", false);
  expect(d.toLearn()[0]!.learning).toEqual({ employee: true, experts: [], tries: { employee: 2 } });
  clock.t = Date.parse("2026-12-28T09:01:00Z");
  await d.tidy();
  expect(d.toLearn()).toEqual([]);
  expect(JSON.parse(fs.readFileSync(path.join(dir, "drafts-waiting.json"), "utf8")).drafts).toEqual([]);
});
