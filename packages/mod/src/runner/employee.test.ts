import fs from "node:fs";
import path from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import { tempRoot } from "../data-layer/fixture.js";
import type { SavedExpert } from "./expert-state.js";
import { draftTo, GROUNDS, RECORD, setUpEmployee, until, type EmployeeRule } from "./employee-fixture.js";

vi.stubEnv("CLAUDE_CONFIG_DIR", path.join(tempRoot(), "claude"));
for (const [k, v] of Object.entries({ GIT_AUTHOR_NAME: "Adam", GIT_AUTHOR_EMAIL: "adam@example.invalid", GIT_COMMITTER_NAME: "Adam", GIT_COMMITTER_EMAIL: "adam@example.invalid" })) vi.stubEnv(k, v);
vi.setConfig({ testTimeout: 180000 });

const closing: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const c of closing.splice(0)) await c();
});

const RUN = "Today's run";
const SERVER = "ws://127.0.0.1:4799/data-layer";
type S = Awaited<ReturnType<typeof setUpEmployee>>;
async function runAt(s: S, iso: string) {
  const before = s.e().runs!.listing().ended.length;
  s.clock.t = Date.parse(iso);
  await until(async () => (await s.e().runs!.tick(), s.e().runs!.listing().ended.length > before && !s.e().runs!.running()), 90000, `the run at ${iso}`);
  return s.e().runs!.listing().ended[0]!;
}
const state = (s: S) => JSON.parse(fs.readFileSync(path.join(s.dir, "state.json"), "utf8")) as SavedExpert;
const trunks = (s: S) => s.claude().filter((x) => x.kind === "trunk" && x.argv).length;
// What its record holds, as this computer last received it: one thing it learned before.
const received = (dir: string) => {
  fs.mkdirSync(dir, { recursive: true });
  const entry = { arrivalNumber: 1, id: "0d6a7c1e-2b3f-4a5d-8e9f-1a2b3c4d5e6f", text: "Open with the agency's newest project.", files: [], learnedAt: "2026-11-20T09:00:00.000Z", learnedHere: true };
  fs.writeFileSync(path.join(dir, "what-was-learned-in-the-expert-record.json"), JSON.stringify({ version: 1, records: { [RECORD]: { server: SERVER, lastArrivalNumberReceived: 1, chain: "", serverLastArrivalNumber: 1, entries: [entry], removed: [], keptNotYetReceived: [] } } }));
};

test("grounded in a folder with only what its record holds (its folder lost, say): two turns, and a third carrying what it learned before; with no proof, its newest generation runs at once; a failed grounding grounds again on its owner's Try again", async () => {
  const root = tempRoot();
  received(path.join(root, "claude", "isoplan", "employees", "adams-outreach"));
  const learned = { tied: () => [{ server: SERVER, expertRecordId: RECORD }], held: (server: string) => (server === SERVER ? RECORD : undefined), servers: [SERVER], catchUp: () => "answered" as const, waiting: () => {} };
  const s = await setUpEmployee({ root, learned, rules: [{ kind: "trunk", text: "Now read your job's documents", exit: true }] });
  closing.push(s.close);
  await until(() => s.logs.some((l) => l.includes("generation 1 failed")), 60000);
  s.rules([...GROUNDS, { kind: "fork", text: RUN, reply: "done" }]);
  s.e().trunk!.retryNow();
  await s.ready();
  const turns = s.claude().filter((x) => x.kind === "trunk" && x.turn && x.trunk === state(s).generations.at(-1)!.trunk).map((x) => x.text!);
  expect(turns).toHaveLength(3);
  expect(turns[1]).toContain("- outreach/who-qualifies.md");
  expect(turns[2]).toContain("Open with the agency's newest project.");
  expect(state(s).generations.map((g) => g.state)).toEqual(["failed", "junior"]);
  expect((await runAt(s, "2026-11-26T09:01:00Z")).outcome).toBe("ran");
});

test("three rejections together make one fork, whose <learned> blocks wait to be sent with no files before its addition turn adds them; with its day's tokens spent, it waits", async () => {
  const learnedReply = "<learned>Name the agency's newest project in the first line.</learned>\n<learned>Keep it under 120 words.</learned>";
  const rules: EmployeeRule[] = [...GROUNDS, { kind: "fork", text: RUN, calls: ["ana", "bo", "cy"].map((n) => draftTo(`${n}@agency.example`)), reply: "done" }, { kind: "fork", text: "Your owner rejected these drafts", reply: learnedReply }];
  const s = await setUpEmployee({ rules });
  closing.push(s.close);
  await s.ready();
  await runAt(s, "2026-11-26T09:01:00Z");
  for (const d of s.e().drafts.toSend()[0]!.drafts) await s.decided("rejected", d.id, { correction: `Too generic for ${d.to!.address}.` });
  await s.employees.tick();
  await until(() => s.claude().some((x) => x.kind === "append" && x.text?.includes("From your owner's corrections you learned")), 60000, "its addition");
  const forks = s.claude().filter((x) => x.kind === "fork" && x.text?.includes("Your owner rejected these drafts"));
  expect(forks).toHaveLength(1);
  expect(forks[0]!.text).toContain("Too generic for cy@agency.example.");
  await until(() => state(s).generations.at(-1)!.addedToItsTrunk.length === 2, 30000);
  const waiting = JSON.parse(fs.readFileSync(path.join(s.dir, "what-was-learned-waiting-to-be-sent.json"), "utf8")).things;
  expect(waiting.map((t: { text: string; files: unknown[] }) => [t.text, t.files])).toEqual([
    ["Name the agency's newest project in the first line.", []],
    ["Keep it under 120 words.", []],
  ]);
  // Learned: the rejected drafts are gone from this computer.
  await until(() => s.e().drafts.toLearn().length === 0, 30000);

  // Its day's tokens spent: a rejection waits, and no fork starts.
  s.rules([...rules.slice(0, -2), { kind: "fork", text: RUN, calls: [draftTo("di@agency.example")], reply: "done" }, rules.at(-1)!]);
  await runAt(s, "2026-11-27T09:01:00Z");
  await s.decided("rejected", s.e().drafts.toSend()[0]!.drafts[0]!.id);
  s.e().ledger.reserve({ at: s.clock.t, room: "employee", usage: { input: 9_000_000, output: 0, cacheRead: 0, cacheWrite: 0 } });
  await s.employees.tick();
  await new Promise((r) => setTimeout(r, 1000));
  expect(s.claude().filter((x) => x.kind === "fork" && x.text?.includes("Your owner rejected these drafts"))).toHaveLength(1);
  expect(s.e().drafts.toLearn()).toHaveLength(1);
});

test("a new generation grounds before the next run when its job's brief changes, and none for a change of schedule or limits; removed by hand, its job file stops its runs and keeps its drafts, a decision still applied, and put back it runs again", async () => {
  const root = tempRoot();
  const s = await setUpEmployee({ root, rules: [...GROUNDS, { kind: "fork", text: RUN, calls: [draftTo("ana@agency.example")], reply: "done" }] });
  closing.push(s.close);
  await s.ready();
  expect(trunks(s)).toBe(1);
  s.writeJob({ limits: { draftsPerRun: 3 }, schedule: { every: "weekday", at: "09:00", timeZone: "UTC" } });
  await until(() => s.e().file?.job.schedule.every === "weekday", 10000);
  await runAt(s, "2026-11-26T09:01:00Z");
  expect(trunks(s)).toBe(1);
  s.writeJob({ brief: "Each run, draft one email to one person at each studio that qualifies.", schedule: { every: "weekday", at: "09:00", timeZone: "UTC" } });
  await until(() => s.e().file?.job.brief.includes("studio") === true, 10000);
  await runAt(s, "2026-11-27T09:01:00Z");
  expect(trunks(s)).toBe(2);
  expect(s.claude().filter((x) => x.kind === "fork" && x.argv).at(-1)!.argv).toContain(state(s).generations.at(-1)!.trunk);

  // Its job file removed: no run, its drafts kept, a decision still applied; put back, it runs again.
  const jobFile = path.join(s.employeesDir, "adams-outreach.json");
  const text = fs.readFileSync(jobFile, "utf8");
  fs.rmSync(jobFile);
  await until(() => s.employees.rowOf("adams-outreach")?.jobFileGone === true, 10000, "its job file gone");
  expect(s.e().runs).toBeNull();
  const waiting = s.e().drafts.toSend().flatMap((x) => x.drafts);
  expect(waiting).toHaveLength(1);
  expect(await s.decided("skipped", waiting[0]!.id)).toEqual({});
  fs.writeFileSync(jobFile, text);
  await until(() => s.e().runs !== null, 10000, "its job file back");
  await s.ready();
  expect((await runAt(s, "2026-11-30T09:01:00Z")).outcome).toBe("ran");
});
