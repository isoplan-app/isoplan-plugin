import fs from "node:fs";
import path from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import { tempRoot } from "../data-layer/fixture.js";
import { ADAM, draftTo, GROUNDS, setUpEmployee, until, type EmployeeRule } from "./employee-fixture.js";

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
  expect(ADAM.name).toBe("Adam");
});
