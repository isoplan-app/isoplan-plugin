import { expect, test } from "vitest";
import { answerOffices, OUTBOX_MAX, OUTBOX_MAX_AGE_MS, type AnswerOfficesOptions } from "./offices.js";

const HOLD_OFF_MS = 3600000;

/** Two offices' links as stand-ins, a clock, and the loop over them, checked every 5 ms. */
function setUp(over: Partial<AnswerOfficesOptions<string, string, string>> = {}) {
  let clock = 0;
  const opened: { office: string; sent: string[]; closed: boolean; said: { notWanted(): void; unpaired(): void } }[] = [];
  const logs: string[] = [];
  const state = { idle: true, lit: true, paired: new Set<string>() };
  let leave = () => {};
  const loop = answerOffices<string, string, string>({
    offices: ["internal", "dev"],
    name: (o) => o,
    open: (office, said) => {
      const link = { office, sent: [] as string[], closed: false, said };
      opened.push(link);
      return { send: (m) => void link.sent.push(m), sendLive: (m) => (link.sent.push(`live ${m}`), true), close: () => void (link.closed = true) };
    },
    paired: async (o) => state.paired.has(o),
    idle: () => state.idle,
    lit: async () => state.lit,
    gone: new Promise<void>((r) => (leave = r)),
    log: (t) => void logs.push(t),
    checkMs: 5,
    holdOffMs: HOLD_OFF_MS,
    now: () => clock,
    ...over,
  });
  const latest = (office: string) => opened.filter((l) => l.office === office).at(-1)!;
  return { loop, opened, latest, logs, state, tick: (ms: number) => (clock += ms), leave: () => leave() };
}
const settle = () => new Promise((r) => setTimeout(r, 30));

test("runner offices: one office not wanting the runner closes its link alone, which opens again after the hold-off", async () => {
  const s = setUp();
  expect(s.opened.map((l) => l.office)).toEqual(["internal", "dev"]);
  s.latest("internal").said.notWanted();
  await settle();
  expect(s.latest("internal").closed).toBe(true);
  expect(s.latest("dev").closed).toBe(false);
  s.tick(HOLD_OFF_MS);
  await settle();
  expect(s.opened.filter((l) => l.office === "internal")).toHaveLength(2);
  expect(s.latest("internal").closed).toBe(false);
  s.leave();
  expect(await s.loop.ended).toBe("orphaned");
  // A supervisor ended from outside can't say so: its worker does.
  expect(s.logs).toContain("the runner's supervisor has gone without stopping its worker (it was ended from outside, or the computer is shutting down), so the worker stops too");
});

test("runner offices: an ended pairing closes that link until the machine is paired again; replies meanwhile wait for it", async () => {
  const s = setUp();
  const send = s.loop.sender(0);
  s.latest("internal").said.unpaired();
  await settle();
  expect(s.latest("internal").closed).toBe(true);
  send("reply-1");
  await settle();
  expect(s.opened.filter((l) => l.office === "internal")).toHaveLength(1);
  s.state.paired.add("internal");
  await settle();
  expect(s.latest("internal").sent).toEqual(["reply-1"]);
  // The old link got nothing after it closed.
  expect(s.opened[0]!.sent).toEqual([]);
  s.leave();
  await s.loop.ended;
});

test("runner offices: a reply that waited for its office's link longer than OUTBOX_MAX_AGE_MS is dropped, not sent", async () => {
  const s = setUp();
  s.latest("internal").said.unpaired();
  await settle();
  s.loop.sender(0)("stale");
  s.tick(OUTBOX_MAX_AGE_MS);
  s.state.paired.add("internal");
  await settle();
  expect(s.latest("internal").sent).toEqual([]);
  expect(s.logs).toContain("dropped 1 of the runner's replies for internal: they waited for its link longer than 60 minutes");
  s.leave();
  await s.loop.ended;
});

test("runner offices: a closed office keeps at most OUTBOX_MAX replies, and what is left when the runner ends is logged as dropped", async () => {
  const s = setUp();
  s.latest("dev").said.unpaired();
  await settle();
  for (let i = 0; i <= OUTBOX_MAX; i++) s.loop.sender(1)(`r${i}`);
  expect(s.logs.some((l) => l.includes("dropped the oldest"))).toBe(true);
  s.leave();
  await s.loop.ended;
  expect(s.logs.at(-1)).toBe(`dropped ${OUTBOX_MAX} of the runner's replies for dev: its link was closed when the runner ended`);
});

test("runner offices: it ends once no link is left, as not-wanted when any office didn't want it, but never while work is running", async () => {
  const s = setUp();
  s.state.idle = false;
  s.latest("internal").said.notWanted();
  s.latest("dev").said.unpaired();
  await settle();
  expect(s.opened.every((l) => l.closed)).toBe(true);
  let ended: string | null = null;
  void s.loop.ended.then((e) => (ended = e));
  await settle();
  expect(ended).toBeNull();
  s.state.idle = true;
  expect(await s.loop.ended).toBe("not-wanted");
});

test("runner offices: unpaired everywhere ends it as unpaired; with no room lit it ends as done, once idle", async () => {
  const a = setUp();
  a.latest("internal").said.unpaired();
  a.latest("dev").said.unpaired();
  expect(await a.loop.ended).toBe("unpaired");

  const b = setUp();
  b.state.idle = false;
  b.state.lit = false;
  await settle();
  let ended: string | null = null;
  void b.loop.ended.then((e) => (ended = e));
  await settle();
  expect(ended).toBeNull();
  b.state.idle = true;
  expect(await b.loop.ended).toBe("done");
  expect(b.opened.every((l) => l.closed)).toBe(true);
});

test("runner offices: a driven message goes only while its office's link is open, and is never kept for later", async () => {
  const s = setUp();
  expect(s.loop.live(0)("held")).toBe(true);
  expect(s.latest("internal").sent).toEqual(["live held"]);
  s.latest("internal").said.unpaired();
  await settle();
  expect(s.loop.live(0)("released")).toBe(false);
  s.state.paired.add("internal");
  await settle();
  expect(s.opened.filter((l) => l.office === "internal")).toHaveLength(2);
  expect(s.latest("internal").sent).toEqual([]);
  s.leave();
  await s.loop.ended;
});

test("runner offices: while keep says so (a driven session's process, or starting at login), no lit room doesn't end it; no link left still does", async () => {
  let keep = true;
  const s = setUp({ keep: async () => keep });
  s.state.lit = false;
  let ended: string | null = null;
  void s.loop.ended.then((e) => (ended = e));
  await settle();
  expect(ended).toBeNull();
  keep = false;
  expect(await s.loop.ended).toBe("done");

  const a = setUp({ keep: async () => true });
  a.latest("internal").said.unpaired();
  a.latest("dev").said.unpaired();
  expect(await a.loop.ended).toBe("unpaired");
});

