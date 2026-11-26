import fs from "node:fs";
import path from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import { tempRoot } from "../data-layer/fixture.js";
import { EMPLOYEE_ROOM } from "./employee.js";
import { draftTo, GROUNDS, setUpEmployee, until, type EmployeeRule } from "./employee-fixture.js";

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
const ended = (s: S) => s.e().runs!.listing().ended;
// At `iso`, ticked as the runner ticks, until `done` holds.
async function at(s: S, iso: string, done: () => boolean) {
  s.clock.t = Date.parse(iso);
  await until(async () => (await s.e().runs!.tick(), done() && !s.e().runs!.running()), 90000, `at ${iso}`);
}

test("a time inside its window runs once when the runner is back; past it, it is missed; only the latest missed time runs", async () => {
  const s = await started([{ kind: "fork", text: RUN, reply: "done" }]);
  // Off from 26 Nov 08:00 to 28 Nov 10:00: 28 Nov's 09:00 is inside its 12 hours.
  await at(s, "2026-11-28T10:00:00Z", () => ended(s).length === 1);
  expect(ended(s)[0]).toMatchObject({ outcome: "ran", scheduledFor: "2026-11-28T09:00:00.000Z" });
  await s.e().runs!.tick();
  expect(ended(s)).toHaveLength(1);
  // Off again until 30 Nov 22:00: 30 Nov's 09:00 window ended at 21:00.
  await at(s, "2026-11-30T22:00:00Z", () => ended(s).length === 2);
  expect(ended(s)[0]).toMatchObject({ outcome: "missed", scheduledFor: "2026-11-30T09:00:00.000Z" });
  expect(s.claude().filter((x) => x.kind === "fork" && x.argv)).toHaveLength(1);
  // A schedule moved from 09:00 to 08:00 at noon gives no second run that day.
  s.clock.t = Date.parse("2026-12-01T12:00:00Z");
  s.writeJob({ schedule: { every: "day", at: "08:00", timeZone: "UTC" } });
  await until(() => s.e().file?.job.schedule.at === "08:00", 10000);
  await s.e().runs!.tick();
  expect(ended(s)).toHaveLength(2);
  expect(s.e().runs!.listing().nextRunAt).toBe("2026-12-02T08:00:00.000Z");
});

test("no overlapping runs: a time due during a run waits for it; a failed run is tried again once; a run stopped at a limit isn't", async () => {
  const s = await started([{ kind: "fork", text: RUN, reply: "done", delayMs: 4000 }]);
  s.clock.t = Date.parse("2026-11-26T09:01:00Z");
  await s.e().runs!.tick();
  await until(() => s.claude().some((x) => x.kind === "fork" && !!x.argv));
  // The next day's time comes while it runs: nothing more starts.
  s.clock.t = Date.parse("2026-11-27T09:01:00Z");
  await s.e().runs!.tick();
  expect(s.claude().filter((x) => x.kind === "fork" && x.argv)).toHaveLength(1);
  await until(() => !s.e().runs!.running(), 30000);
  await at(s, "2026-11-27T09:02:00Z", () => ended(s).length === 2);
  expect(ended(s).map((e) => e.scheduledFor)).toEqual(["2026-11-27T09:00:00.000Z", "2026-11-26T09:00:00.000Z"]);

  // Failed: tried again once, 10 minutes later, and not again.
  s.rules([...GROUNDS, { kind: "fork", text: RUN, exit: true }]);
  await at(s, "2026-11-28T09:01:00Z", () => ended(s).length === 3);
  expect(ended(s)[0]).toMatchObject({ outcome: "failed", tryingAgainAt: "2026-11-28T09:11:00.000Z" });
  await at(s, "2026-11-28T09:11:00Z", () => ended(s).length === 4);
  expect(ended(s)[0]).toMatchObject({ outcome: "failed", wasTheTryAgain: true });
  expect(ended(s)[0]!.tryingAgainAt).toBeUndefined();

  // Stopped at its context limit: kept its draft, not tried again.
  s.rules([...GROUNDS, { kind: "fork", text: RUN, context: 1000, contextStep: 500000, calls: [draftTo("ana@studio.example"), draftTo("bo@agency.example")], reply: "done" }]);
  await at(s, "2026-11-29T09:01:00Z", () => ended(s).length === 5);
  expect(ended(s)[0]).toMatchObject({ outcome: "stopped", limit: "context", drafts: 1 });
  expect(ended(s)[0]!.tryingAgainAt).toBeUndefined();
});

test("its day's tokens and minutes, rolling and kept across a restart, stop a run starting; its run's tokens stop it mid-run, keeping what it left", async () => {
  const root = tempRoot();
  const s = await started([{ kind: "fork", text: RUN, context: 100, contextStep: 100000, calls: [draftTo("ana@studio.example"), draftTo("bo@agency.example")], reply: "done" }], { root, job: { limits: { runTokens: 1000 } } });
  await at(s, "2026-11-26T09:01:00Z", () => ended(s).length === 1);
  expect(ended(s)[0]).toMatchObject({ outcome: "stopped", limit: "run-tokens", drafts: 1 });
  await s.close();
  closing.length = 0;

  // A day's tokens spent, its grounding's among them, as the ledger kept them across the restart.
  const ledger = path.join(root, "claude", "isoplan", "employees", "adams-outreach", "ledger.json");
  const spent = JSON.parse(fs.readFileSync(ledger, "utf8")) as { at: number; room: string }[];
  expect(spent.every((e) => e.room === EMPLOYEE_ROOM)).toBe(true);
  fs.writeFileSync(ledger, JSON.stringify([...spent, { at: Date.parse("2026-11-27T08:00:00Z"), room: EMPLOYEE_ROOM, usage: { input: 9_000_000, output: 0, cacheRead: 0, cacheWrite: 0 } }]));
  const again = await setUpEmployee({ root, rules: [...GROUNDS, { kind: "fork", text: RUN, reply: "done" }] });
  closing.push(again.close);
  await again.ready();
  await at(again, "2026-11-27T09:01:00Z", () => ended(again).length === 2);
  expect(ended(again)[0]).toMatchObject({ outcome: "stopped", limit: "day-tokens" });
  expect(again.claude().filter((x) => x.kind === "fork" && x.argv)).toHaveLength(1);

  // A day later the tokens have rolled off; then a day's minutes spent stop it.
  const runs = path.join(root, "claude", "isoplan", "employees", "adams-outreach", "runs.json");
  await again.e().runs!.written();
  const file = JSON.parse(fs.readFileSync(runs, "utf8"));
  file.dayMinutes.push({ at: Date.parse("2026-11-28T08:30:00Z"), minutes: 95 });
  await again.close();
  closing.length = 0;
  fs.writeFileSync(runs, JSON.stringify(file));
  const third = await setUpEmployee({ root, rules: [...GROUNDS, { kind: "fork", text: RUN, reply: "done" }] });
  closing.push(third.close);
  await third.ready();
  await at(third, "2026-11-28T09:01:00Z", () => ended(third).length === 3);
  expect(ended(third)[0]).toMatchObject({ outcome: "stopped", limit: "day-minutes" });
});

test("held back while more drafts wait than one run leaves; decisions inside its window let it run; past it, held-back", async () => {
  const s = await started([{ kind: "fork", text: RUN, calls: [draftTo("ana@studio.example"), draftTo("bo@agency.example")], reply: "done" }], { job: { limits: { draftsPerRun: 1 }, draftsWaitHours: 200 } });
  // A first run leaves one draft (its batch is one); then a bigger batch for a day, to have two waiting.
  s.writeJob({ limits: { draftsPerRun: 2 }, draftsWaitHours: 200 });
  await until(() => s.e().file?.job.limits?.draftsPerRun === 2, 10000);
  await at(s, "2026-11-26T09:01:00Z", () => ended(s).length === 1);
  s.writeJob({ limits: { draftsPerRun: 1 }, draftsWaitHours: 200 });
  await until(() => s.e().file?.job.limits?.draftsPerRun === 1, 10000);
  expect(s.e().drafts.waiting()).toBe(2);
  s.clock.t = Date.parse("2026-11-27T09:01:00Z");
  await s.e().runs!.tick();
  expect(s.e().runs!.listing().heldBack).toEqual({ scheduledFor: "2026-11-27T09:00:00.000Z", draftsWaiting: 2 });
  // One decided: one waits, which one run's batch covers, so it runs.
  await s.decided("skipped", s.e().drafts.toSend()[0]!.drafts[0]!.id);
  s.rules([...GROUNDS, { kind: "fork", text: RUN, reply: "done" }]);
  await at(s, "2026-11-27T10:00:00Z", () => ended(s).length === 2);
  expect(ended(s)[0]).toMatchObject({ outcome: "ran", scheduledFor: "2026-11-27T09:00:00.000Z" });
  // Two waiting again, and the window passes: held-back.
  s.rules([...GROUNDS, { kind: "fork", text: RUN, calls: [draftTo("cy@agency.example")], reply: "done" }]);
  await at(s, "2026-11-28T09:01:00Z", () => ended(s).length === 3);
  expect(s.e().drafts.waiting()).toBe(2);
  s.clock.t = Date.parse("2026-11-29T09:01:00Z");
  await s.e().runs!.tick();
  expect(s.e().runs!.listing().heldBack?.scheduledFor).toBe("2026-11-29T09:00:00.000Z");
  await at(s, "2026-11-29T21:30:00Z", () => ended(s).length === 4);
  expect(ended(s)[0]).toMatchObject({ outcome: "held-back", scheduledFor: "2026-11-29T09:00:00.000Z" });
});

test("no run before its job file is tied to a published record; once one is, the runner stays up for it", async () => {
  const s = await started([{ kind: "fork", text: RUN, reply: "done" }], { untied: true });
  s.clock.t = Date.parse("2026-11-26T09:01:00Z");
  await s.e().runs!.tick();
  expect(s.e().runs!.running()).toBe(false);
  expect(s.employees.anyTied()).toBe(false);
  s.setTied(true);
  expect(s.employees.anyTied()).toBe(true);
  await at(s, "2026-11-26T09:02:00Z", () => ended(s).length === 1);
  expect(ended(s)[0]!.outcome).toBe("ran");
});
