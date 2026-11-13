import fs from "node:fs";
import path from "node:path";
import { PROTOCOL_VERSION, type HandoffMessage, type HandoffRepo, type RefusalMessage, type ReplyMessage, type RequestMessage, type TakenMessage } from "@isoplan/protocol";
import { expect, test } from "vitest";
import { modDir, tempRoot } from "../data-layer/fixture.js";
import { loadSettings } from "../data-layer/config.js";
import { nodeIo } from "../data-layer/io.js";
import type { Answered, Answerer, Ask, Lead } from "./answerer.js";
import { openLedger, type Entry } from "./caps.js";
import { loadPrompts } from "./prompts.js";
import { COMPACTED_NOTE, createRunner, MAX_HELD, PushFailed, type RunnerOptions, type RunnerSettings } from "./runner.js";
import { loadPatterns, scan, UNREADABLE } from "./scan.js";

const NOW = Date.parse("2026-10-29T12:00:00Z");
// A fake AWS key id, split so no key-shaped string sits in the source.
const AWS_KEY = "AKIA" + "ABCDEFGHIJKLMNOP";
const defaults = JSON.parse(fs.readFileSync(path.join(modDir, "runner.json"), "utf8")) as RunnerSettings;

const question = (id: string, room = "room-1", session = "claude-code:lead-1"): RequestMessage => ({
  type: "request",
  v: PROTOCOL_VERSION,
  id,
  kind: "answer-question",
  session,
  room,
  from: { id: "claude:bob", name: "Bob" },
  question: `What was the coverage? (${id})`,
});
const brief = (id: string): RequestMessage => ({ type: "request", v: PROTOCOL_VERSION, id, kind: "write-brief", session: "claude-code:lead-1", room: "room-1", handoff: "h-1", to: { id: "claude:bob", name: "Bob" } });

// A stub answerer whose answers are settled by hand, one deferred per ask, in the order asked.
function stub(lead: Partial<Lead> = {}) {
  const asks: { session: string; ask: Ask; settle: (a: Answered) => void }[] = [];
  const root = tempRoot();
  const answerer: Answerer = {
    lead: async (session) => (session.startsWith("claude-code:") ? { cwd: root, working: false, compacted: false, context: 100000, lastActive: NOW, ...lead } : null),
    ask: (session, _lead, ask) => new Promise((settle) => asks.push({ session, ask, settle })),
    close: () => {},
  };
  return { answerer, asks, root };
}

const usage = { input: 5, output: 300, cacheRead: 200000, cacheWrite: 100000 };
const ok = (text: string): Answered => ({ ok: true, text, usage });

async function setup({ lead, settings, entries, ...opts }: Partial<Omit<RunnerOptions, "settings">> & { lead?: Partial<Lead>; settings?: Partial<RunnerSettings>; entries?: Entry[] } = {}) {
  const s = stub(lead);
  const dir = tempRoot();
  const ledgerFile = path.join(dir, "ledger.json");
  if (entries) fs.writeFileSync(ledgerFile, JSON.stringify(entries));
  const ledger = await openLedger(ledgerFile);
  const sent: (ReplyMessage | RefusalMessage | TakenMessage)[] = [];
  const logs: string[] = [];
  const patterns = await loadPatterns(path.join(modDir, "secret-patterns.json"), path.join(dir, "none.json"), (t) => logs.push(t));
  const runner = createRunner({
    answerer: s.answerer,
    ledger,
    settings: async () => ({ ...defaults, ...settings }),
    prompts: () => loadPrompts(path.join(modDir, "prompts")),
    scan: async (text) => scan(text, patterns),
    send: (m) => sent.push(m),
    log: (t) => logs.push(t),
    isDir: async (p) => fs.existsSync(p) && fs.statSync(p).isDirectory(),
    isReported: async () => true,
    now: () => NOW,
    ...opts,
  });
  // Waits until the fork has been asked `n` times in all, or `n` messages have been sent.
  const asked = (n: number) => until(() => s.asks.length >= n);
  const sentN = (n: number) => until(() => sent.length >= n);
  const askFor = (id: string) => s.asks.find((a) => a.ask.request.includes(`(${id})`));
  return { ...s, runner, sent, logs, ledger, ledgerFile, asked, sentN, askFor };
}

async function until(check: () => boolean, ms = 3000) {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 5));
  }
}

test("runner: answers one at a time per room; other rooms don't wait", async () => {
  const t = await setup();
  t.runner.take(question("q1", "room-1"));
  t.runner.take(question("q2", "room-1"));
  t.runner.take(question("q3", "room-2"));
  // q2 waits for q1; q3, in another room, runs beside it.
  await t.asked(2);
  await new Promise((r) => setTimeout(r, 50));
  expect(t.asks).toHaveLength(2);
  expect(t.askFor("q2")).toBe(undefined);
  t.askFor("q1")!.settle(ok("one"));
  await t.sentN(1);
  t.askFor("q3")!.settle(ok("three"));
  await t.sentN(2);
  await t.asked(3);
  t.askFor("q2")!.settle(ok("two"));
  await t.runner.settled();
  expect(t.sent.map((m) => ["id" in m && m.id, m.type === "reply" && m.kind === "answer-question" ? m.answer : m.type])).toEqual([
    ["q1", "one"],
    ["q3", "three"],
    ["q2", "two"],
  ]);
  expect(t.runner.idle()).toBe(true);
});

test("runner: the fork is asked with the fixed instructions, then the question, under the answer timeout", async () => {
  const t = await setup();
  t.runner.take(question("q1"));
  await t.asked(1);
  const p = await loadPrompts(path.join(modDir, "prompts"));
  expect(t.asks[0]!.ask.instructions).toBe(p.instructions);
  expect(p.instructions.endsWith("Reply with only the word: ready")).toBe(true);
  expect(t.asks[0]!.ask.request).toContain("A question from Bob:\n\nWhat was the coverage?");
  expect(t.asks[0]!.ask.timeoutMs).toBe(defaults.answerTimeoutSeconds * 1000);
});

test("runner: a secret in the answer is withheld, and the owner's release sends it", async () => {
  const t = await setup();
  t.runner.take(question("q1"));
  await t.asked(1);
  t.asks[0]!.settle(ok(`The deploy key is ${AWS_KEY}, in the vault.`));
  await t.runner.settled();
  expect(t.sent).toEqual([{ type: "refusal", v: PROTOCOL_VERSION, id: "q1", reason: "withheld" }]);
  expect(t.logs.join("\n")).toContain('matches the secret pattern "AWS access key id"');
  // Asking again gets the same refusal, without a second fork.
  t.runner.take(question("q1"));
  t.runner.take({ type: "release", v: PROTOCOL_VERSION, id: "q1" });
  await t.sentN(3);
  expect(t.asks).toHaveLength(1);
  expect(t.sent.slice(1)).toEqual([
    { type: "refusal", v: PROTOCOL_VERSION, id: "q1", reason: "withheld" },
    { type: "reply", v: PROTOCOL_VERSION, id: "q1", kind: "answer-question", answer: `The deploy key is ${AWS_KEY}, in the vault.` },
  ]);
  // Nothing held under an id is refused with the reason.
  t.runner.take({ type: "release", v: PROTOCOL_VERSION, id: "nope" });
  await t.sentN(4);
  expect(t.sent.at(-1)).toMatchObject({ id: "nope", reason: "unavailable", detail: expect.stringContaining("nothing is withheld") });
});

test("runner: a brief is scanned too, and carries the repos the handoff pushed", async () => {
  const repos: HandoffRepo[] = [{ path: ".", remote: "origin", branch: "isoplan/handoff/h-1", commit: "a".repeat(40) }];
  const t = await setup({ push: async () => repos });
  t.runner.take(brief("b1"));
  await t.asked(1);
  expect(t.asks[0]!.ask.request).toContain("Write the handoff brief now, for Bob");
  expect(t.asks[0]!.ask.timeoutMs).toBe(defaults.briefTimeoutSeconds * 1000);
  t.asks[0]!.settle(ok('Goal: ship. Set password: "hunter2hunter2" first.'));
  await t.runner.settled();
  expect(t.sent).toEqual([{ type: "refusal", v: PROTOCOL_VERSION, id: "b1", reason: "withheld" }]);
  t.runner.take({ type: "release", v: PROTOCOL_VERSION, id: "b1" });
  await t.sentN(2);
  expect(t.sent[1]).toEqual({ type: "reply", v: PROTOCOL_VERSION, id: "b1", kind: "write-brief", handoff: { id: "h-1", brief: 'Goal: ship. Set password: "hunter2hunter2" first.', repos } });
});

test("runner: a spin-off's brief is asked for that task, and its reply doesn't repeat the task", async () => {
  const repos: HandoffRepo[] = [{ path: ".", remote: "origin", branch: "isoplan/handoff/h-1", commit: "a".repeat(40) }];
  const t = await setup({ push: async () => repos });
  t.runner.take({ ...brief("b1"), task: "Write the docs pages for session management." } as RequestMessage);
  await t.asked(1);
  expect(t.asks[0]!.ask.request).toContain("for Bob, who is starting a new task of its own");
  expect(t.asks[0]!.ask.request).toContain("The new task:\n\nWrite the docs pages for session management.");
  expect(t.asks[0]!.ask.request).not.toContain("who is taking this work over");
  t.asks[0]!.settle(ok("Docs need: the session states."));
  await t.runner.settled();
  expect(t.sent).toEqual([{ type: "reply", v: PROTOCOL_VERSION, id: "b1", kind: "write-brief", handoff: { id: "h-1", brief: "Docs need: the session states.", repos } }]);
});

test("runner: a brief is asked for with the untracked files named, ends with the note, and is pushed only once it clears the scan", async () => {
  const repos: HandoffRepo[] = [{ path: ".", remote: "origin", branch: "isoplan/handoff/h-1", commit: "a".repeat(40) }];
  const pushed: string[] = [];
  const t = await setup({ prepareBrief: async () => ({ files: [".env.local"], note: "Handed over by Isoplan on isoplan/handoff/h-1." }), push: async (_s, _l, h) => (pushed.push(h), repos) });
  t.runner.take(brief("b1"));
  await t.asked(1);
  expect(t.asks[0]!.ask.request).toContain("The untracked files are: `.env.local`. Say what each is for.");
  expect(pushed).toEqual([]);
  t.asks[0]!.settle(ok("Goal: ship. `.env.local` points the app at a local API."));
  await t.runner.settled();
  expect(t.sent).toEqual([{ type: "reply", v: PROTOCOL_VERSION, id: "b1", kind: "write-brief", handoff: { id: "h-1", brief: "Goal: ship. `.env.local` points the app at a local API.\n\nHanded over by Isoplan on isoplan/handoff/h-1.", repos } }]);
  expect(pushed).toEqual(["h-1"]);
});

test("runner: a brief the fork can't write still goes, marked fallback, with the note; a push that fails is refused with its reason", async () => {
  const repos: HandoffRepo[] = [{ path: ".", remote: "origin", branch: "isoplan/handoff/h-1", commit: "a".repeat(40) }];
  const t = await setup({ prepareBrief: async () => ({ files: [], note: "The note." }), push: async () => repos });
  t.runner.take(brief("b1"));
  await t.asked(1);
  t.asks[0]!.settle({ ok: false, kind: "timed-out", detail: "no answer within 240 s", usage: null });
  await t.runner.settled();
  expect(t.sent).toEqual([{ type: "reply", v: PROTOCOL_VERSION, id: "b1", kind: "write-brief", fallback: true, handoff: { id: "h-1", brief: "No brief was written by the session: the fork took too long to answer.\n\nThe note.", repos } }]);

  const over = await setup({ settings: { answersPerMachinePerDay: 1 }, entries: [{ at: NOW - 1000, room: "a", usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }], prepareBrief: async () => ({ files: [], note: "The note." }), push: async () => repos });
  over.runner.take(brief("b2"));
  await over.runner.settled();
  expect(over.asks).toEqual([]);
  expect(over.sent[0]).toMatchObject({ kind: "write-brief", fallback: true });

  const rejected = await setup({ push: async () => Promise.reject(new PushFailed("the remote rejected the handoff's branch")) });
  rejected.runner.take(brief("b3"));
  await rejected.asked(1);
  rejected.asks[0]!.settle(ok("Goal: ship."));
  await rejected.runner.settled();
  expect(rejected.sent).toEqual([{ type: "refusal", v: PROTOCOL_VERSION, id: "b3", reason: "unavailable", detail: "the remote rejected the handoff's branch" }]);
});

test("runner: a brief that falls back because the machine has no claude binary says so, and gives its tokens back", async () => {
  const repos: HandoffRepo[] = [{ path: ".", remote: "origin", branch: "isoplan/handoff/h-1", commit: "a".repeat(40) }];
  const t = await setup({ prepareBrief: async () => ({ files: [], note: "The note." }), push: async () => repos });
  t.runner.take(brief("b1"));
  await t.asked(1);
  t.asks[0]!.settle({ ok: false, kind: "no-claude", detail: "the claude binary wasn't found", usage: null });
  await t.runner.settled();
  expect(t.sent).toEqual([{ type: "reply", v: PROTOCOL_VERSION, id: "b1", kind: "write-brief", fallback: true, noClaude: true, handoff: { id: "h-1", brief: "No brief was written by the session: Claude Code for the terminal isn't installed on this machine, so it can't run the fork.\n\nThe note.", repos } }]);
  expect(t.ledger.entries(NOW)).toEqual([]);
});

test("runner: a brief that falls back because a cap is reached names the cap", async () => {
  const repos: HandoffRepo[] = [{ path: ".", remote: "origin", branch: "isoplan/handoff/h-1", commit: "a".repeat(40) }];
  const t = await setup({ settings: { answersPerMachinePerDay: 1 }, entries: [{ at: NOW - 1000, room: "a", usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }], prepareBrief: async () => ({ files: [], note: "The note." }), push: async () => repos });
  t.runner.take(brief("b1"));
  await t.runner.settled();
  expect(t.sent).toEqual([{ type: "reply", v: PROTOCOL_VERSION, id: "b1", kind: "write-brief", fallback: true, cap: "owner-day", handoff: { id: "h-1", brief: "No brief was written by the session: the owner-day cap is reached.\n\nThe note.", repos } }]);
});

test("runner: a commit with a possible secret holds the push, naming the file; the owner's release pushes that exact commit, and one held after it in another repo keeps it", async () => {
  const repos: HandoffRepo[] = [
    { path: ".", remote: "origin", branch: "isoplan/handoff/h-1", commit: "c".repeat(40) },
    { path: "api", remote: "api-origin", branch: "isoplan/handoff/h-1", commit: "d".repeat(40) },
  ];
  const pushes: (Record<string, string> | null)[] = [];
  const t = await setup({
    push: async (_s, _l, _h, pushAnyway) => (
      pushes.push(pushAnyway),
      !pushAnyway ? { held: ["config/dev.ts", "config/a, b.ts"], commits: { ".": "c".repeat(40) } as Record<string, string>, unchecked: ["logo.png"] } : !pushAnyway.api ? { held: ["api/.env.example"], commits: { api: "d".repeat(40) } as Record<string, string>, unchecked: [] } : repos
    ),
  });
  t.runner.take(brief("b1"));
  await t.asked(1);
  t.asks[0]!.settle(ok("Goal: ship."));
  await t.runner.settled();
  expect(t.sent).toEqual([{ type: "refusal", v: PROTOCOL_VERSION, id: "b1", reason: "withheld", file: "config/dev.ts, config/a, b.ts", held: 2, unchecked: ["logo.png"] }]);
  expect(t.logs.join("\n")).not.toContain("AWS");
  t.runner.take({ type: "release", v: PROTOCOL_VERSION, id: "b1" });
  await t.sentN(2);
  expect(t.sent[1]).toEqual({ type: "refusal", v: PROTOCOL_VERSION, id: "b1", reason: "withheld", file: "api/.env.example", held: 1 });
  t.runner.take({ type: "release", v: PROTOCOL_VERSION, id: "b1" });
  await t.sentN(3);
  expect(pushes).toEqual([null, { ".": "c".repeat(40) }, { ".": "c".repeat(40), api: "d".repeat(40) }]);
  expect(t.sent[2]).toEqual({ type: "reply", v: PROTOCOL_VERSION, id: "b1", kind: "write-brief", handoff: { id: "h-1", brief: "Goal: ship.", repos } });
});

test("runner: several questions in one room; one dropped while it waits its turn never runs or reserves, and one dropped waiting for a fork gives its estimate back", async () => {
  const t = await setup({ settings: { maxForks: 1 } });
  t.runner.take(question("q1", "room-1"));
  await t.asked(1);
  t.runner.take(question("q2", "room-1"));
  t.runner.take(question("q3", "room-1"));
  t.runner.take(question("q4", "room-2"));
  // q4 has reserved and waits for the one fork slot; q2 and q3 wait their turn in room-1.
  await until(() => t.ledger.entries(NOW).length === 2);
  t.runner.take({ type: "drop", v: PROTOCOL_VERSION, id: "q2" });
  t.runner.take({ type: "drop", v: PROTOCOL_VERSION, id: "q4" });
  t.askFor("q1")!.settle(ok("One."));
  await t.asked(2);
  expect(t.askFor("q3")).toBeDefined();
  t.askFor("q3")!.settle(ok("Three."));
  await t.runner.settled();
  expect(t.asks.map((a) => a.ask.request.match(/\((q\d)\)/)![1])).toEqual(["q1", "q3"]);
  expect(t.sent.map((m) => "id" in m && m.id)).toEqual(["q1", "q3"]);
  expect(t.ledger.entries(NOW)).toHaveLength(2);
});

test("runner: a drop ends a request: what is held goes, and one still being written neither pushes nor sends", async () => {
  const pushes: (Record<string, string> | null)[] = [];
  const t = await setup({ push: async (_s, _l, _h, pushAnyway) => (pushes.push(pushAnyway), { held: ["a.ts"], commits: { ".": "c".repeat(40) }, unchecked: [] }) });
  t.runner.take(brief("b1"));
  await t.asked(1);
  t.asks[0]!.settle(ok("Goal: ship."));
  await t.runner.settled();
  t.runner.take({ type: "drop", v: PROTOCOL_VERSION, id: "b1" });
  t.runner.take({ type: "release", v: PROTOCOL_VERSION, id: "b1" });
  await t.sentN(2);
  expect(pushes).toEqual([null]);
  expect(t.sent[1]).toMatchObject({ id: "b1", reason: "unavailable" });

  const running = await setup({ push: async (_s, _l, _h, pushAnyway) => (pushes.push(pushAnyway), []) });
  running.runner.take(brief("b2"));
  await running.asked(1);
  running.runner.take({ type: "drop", v: PROTOCOL_VERSION, id: "b2" });
  running.asks[0]!.settle(ok("Goal: ship."));
  await running.runner.settled();
  expect(running.sent).toEqual([]);
  expect(pushes).toEqual([null]);
});

test("runner: a drop naming a running take's id tells the take; one past takeCapMinutes is given up and said so, and its late end isn't sent", async () => {
  let finish: () => void = () => {};
  let dropped: () => boolean = () => false;
  const t = await setup({
    settings: { takeCapMinutes: 0.002 },
    take: async (m, d) => {
      dropped = d;
      await new Promise<void>((r) => (finish = r));
      return { type: "taken", v: PROTOCOL_VERSION, handoff: m.handoff.id, session: "claude-code:late", failures: [] };
    },
  });
  const session = "0b5c4d3e-0000-4000-8000-000000000002";
  t.runner.take({ type: "handoff", v: PROTOCOL_VERSION, mode: "desktop", session, handoff: { id: "h-1", brief: "b", repos: [{ path: ".", remote: "origin", branch: "isoplan/handoff/h-1", commit: "a".repeat(40) }] } });
  expect(dropped()).toBe(false);
  t.runner.take({ type: "drop", v: PROTOCOL_VERSION, id: session });
  expect(dropped()).toBe(true);
  await t.sentN(1);
  expect(t.sent).toEqual([{ type: "taken", v: PROTOCOL_VERSION, handoff: "h-1", failures: [{ step: "open", output: expect.stringContaining("didn't finish within 0.002 minutes on this machine, so it was given up") }] }]);
  expect(t.runner.idle()).toBe(true);
  finish();
  await new Promise((r) => setTimeout(r, 20));
  expect(t.sent).toHaveLength(1);
});

test("runner: onTaken hears of every take that ends, and says it opens only for one whose taken went and that wasn't dropped or given up", async () => {
  const ended: [string, string | undefined, boolean][] = [];
  const finishes: Record<string, () => void> = {};
  const take = async (m: HandoffMessage): Promise<TakenMessage> => {
    await new Promise<void>((r) => (finishes[m.handoff.id] = r));
    return { type: "taken", v: PROTOCOL_VERSION, handoff: m.handoff.id, session: `claude-code:${m.session}`, failures: [] };
  };
  const onTaken = (m: HandoffMessage, taken: TakenMessage | null, opens: boolean) => void ended.push([m.handoff.id, taken?.session, opens]);
  const handoff = (id: string, session: string): HandoffMessage => ({ type: "handoff", v: PROTOCOL_VERSION, mode: "driven", session, by: { id: "claude:sam", name: "Sam" }, room: "room-1", permissions: "auto", handoff: { id, brief: "b", repos: [{ path: ".", remote: "origin", branch: `isoplan/handoff/${id}`, commit: "a".repeat(40) }] } });
  const t = await setup({ take, onTaken });
  t.runner.take(handoff("h-1", "0b5c4d3e-0000-4000-8000-000000000011"));
  t.runner.take(handoff("h-2", "0b5c4d3e-0000-4000-8000-000000000012"));
  await until(() => !!finishes["h-1"] && !!finishes["h-2"]);
  // The server cancelled h-2 while it was being taken.
  t.runner.take({ type: "drop", v: PROTOCOL_VERSION, id: "0b5c4d3e-0000-4000-8000-000000000012" });
  finishes["h-1"]!();
  finishes["h-2"]!();
  await until(() => ended.length === 2);
  expect(ended).toEqual([
    ["h-1", "claude-code:0b5c4d3e-0000-4000-8000-000000000011", true],
    ["h-2", "claude-code:0b5c4d3e-0000-4000-8000-000000000012", false],
  ]);
  // One past takeCapMinutes is given up: its late end opens nothing.
  const late = await setup({ settings: { takeCapMinutes: 0.002 }, take, onTaken });
  late.runner.take(handoff("h-3", "0b5c4d3e-0000-4000-8000-000000000013"));
  await late.sentN(1);
  expect(late.sent[0]).toMatchObject({ type: "taken", handoff: "h-3", failures: [{ step: "open" }] });
  finishes["h-3"]!();
  await until(() => ended.length === 3);
  expect(ended[2]).toEqual(["h-3", "claude-code:0b5c4d3e-0000-4000-8000-000000000013", false]);
  // A take that failed is told too, with nothing it did.
  const failing = await setup({ take: async () => Promise.reject(new Error("broken")), onTaken });
  failing.runner.take(handoff("h-4", "0b5c4d3e-0000-4000-8000-000000000014"));
  await until(() => ended.length === 4);
  expect(ended[3]).toEqual(["h-4", undefined, false]);
});

test("runner: a handoff to take goes to take once at a time, and what it did goes back as taken", async () => {
  let finish: () => void = () => {};
  const taken: string[] = [];
  const t = await setup({
    take: async (m) => {
      taken.push(`${m.handoff.id} ${m.mode}`);
      await new Promise<void>((r) => (finish = r));
      return { type: "taken", v: PROTOCOL_VERSION, handoff: m.handoff.id, session: "claude-code:new", failures: [] };
    },
  });
  const handoff: HandoffMessage = { type: "handoff", v: PROTOCOL_VERSION, mode: "headless", handoff: { id: "h-1", brief: "b", repos: [{ path: ".", remote: "origin", branch: "isoplan/handoff/h-1", commit: "a".repeat(40) }] } };
  t.runner.take(handoff);
  t.runner.take(handoff);
  expect(taken).toEqual(["h-1 headless"]);
  expect(t.runner.idle()).toBe(false);
  finish();
  await t.sentN(1);
  expect(t.sent).toEqual([{ type: "taken", v: PROTOCOL_VERSION, handoff: "h-1", session: "claude-code:new", failures: [] }]);
});

test("runner: a focus request goes to focus, and is answered with a focus reply, or refused saying why", async () => {
  const t = await setup({ focus: async (handoff) => (handoff === "h-1" ? null : "Orca wasn't found on this machine") });
  t.runner.take({ type: "request", v: PROTOCOL_VERSION, id: "f1", kind: "focus", handoff: "h-1" });
  t.runner.take({ type: "request", v: PROTOCOL_VERSION, id: "f2", kind: "focus", handoff: "h-2" });
  await t.sentN(2);
  expect(t.sent).toEqual([
    { type: "reply", v: PROTOCOL_VERSION, id: "f1", kind: "focus" },
    { type: "refusal", v: PROTOCOL_VERSION, id: "f2", reason: "unavailable", detail: "Orca wasn't found on this machine" },
  ]);
  expect(t.asks).toEqual([]);
});

test("runner: without the handoff's push, a brief is refused before the fork runs", async () => {
  const t = await setup();
  t.runner.take(brief("b1"));
  await t.runner.settled();
  expect(t.asks).toEqual([]);
  expect(t.sent).toEqual([{ type: "refusal", v: PROTOCOL_VERSION, id: "b1", reason: "unavailable", detail: "this plugin version can't hand the work over from the floor yet" }]);
});

test("runner: a session whose worktree was deleted is refused with the reason; its path stays in the local log", async () => {
  const t = await setup({ lead: { cwd: path.join(tempRoot(), "deleted-worktree") } });
  t.runner.take(question("q1"));
  await t.runner.settled();
  expect(t.asks).toEqual([]);
  expect(t.sent).toEqual([{ type: "refusal", v: PROTOCOL_VERSION, id: "q1", reason: "unavailable", detail: "the session's folder is gone, so its lead can't be asked" }]);
  expect(t.logs.join("\n")).toContain("deleted-worktree");
});

test("runner: a lead mid-turn, or a session this machine doesn't have, is refused; a compacted one is answered with a note", async () => {
  const busy = await setup({ lead: { working: true } });
  busy.runner.take(question("q1"));
  busy.runner.take(question("q2", "room-1", "codex:elsewhere"));
  await busy.runner.settled();
  expect(busy.sent.map((m) => m.type === "refusal" && m.reason === "unavailable" && m.detail)).toEqual(["the session's lead is mid-turn; ask again once its turn ends", "this machine has no such session"]);

  const compacted = await setup({ lead: { compacted: true } });
  compacted.runner.take(question("q1"));
  await compacted.asked(1);
  compacted.asks[0]!.settle(ok("79.16%."));
  await compacted.runner.settled();
  expect(compacted.sent).toEqual([{ type: "reply", v: PROTOCOL_VERSION, id: "q1", kind: "answer-question", answer: `${COMPACTED_NOTE}\n\n79.16%.` }]);
});

test("runner: the token budget refuses a request whose estimate would go over, counting cache reads and writes apart", async () => {
  // The budget is 5M; 100k context estimates 100k written (×2) and 200k read (×0.1), plus 2000 out (×5): 230k.
  const spent = (n: number): Entry => ({ at: NOW - 3600000, room: "other", usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: n } });
  const under = await setup({ entries: [spent(2_385_000)] }); // 4.77M spent: 4.77M + 230k = 5M, not over
  under.runner.take(question("q1"));
  await under.asked(1);
  expect(under.asks).toHaveLength(1);

  const over = await setup({ entries: [spent(2_385_001)] });
  over.runner.take(question("q1"));
  await over.runner.settled();
  expect(over.asks).toEqual([]);
  expect(over.sent).toEqual([{ type: "refusal", v: PROTOCOL_VERSION, id: "q1", reason: "over-cap", cap: "owner-tokens" }]);

  // A day later the spend has rolled off.
  const later = await setup({ entries: [{ ...spent(2_385_001), at: NOW - 24 * 3600000 }] });
  later.runner.take(question("q1"));
  await later.asked(1);
  expect(later.asks).toHaveLength(1);
});

test("runner: what the fork used goes in the ledger, which a restarted runner reads back", async () => {
  const t = await setup();
  t.runner.take(question("q1"));
  await t.asked(1);
  t.asks[0]!.settle(ok("fine"));
  await t.runner.settled();
  expect((await openLedger(t.ledgerFile)).entries(NOW)).toEqual([{ at: NOW, room: "room-1", usage }]);
});

test("runner: answers per room per hour and per machine per day are capped", async () => {
  const at = (room: string, ago: number): Entry => ({ at: NOW - ago, room, usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } });
  const room = await setup({ settings: { answersPerRoomPerHour: 2 }, entries: [at("room-1", 1000), at("room-1", 2000), at("room-1", 3600001)] });
  room.runner.take(question("q1", "room-1"));
  room.runner.take(question("q2", "room-2"));
  await room.sentN(1);
  await room.asked(1);
  expect(room.sent).toEqual([{ type: "refusal", v: PROTOCOL_VERSION, id: "q1", reason: "over-cap", cap: "room-hour" }]);
  expect(room.asks).toHaveLength(1);

  const owner = await setup({ settings: { answersPerMachinePerDay: 2 }, entries: [at("a", 1000), at("b", 5 * 3600000)] });
  owner.runner.take(question("q1", "room-3"));
  await owner.runner.settled();
  expect(owner.sent).toEqual([{ type: "refusal", v: PROTOCOL_VERSION, id: "q1", reason: "over-cap", cap: "owner-day" }]);
});

test("runner: a failed fork is refused with its kind alone, the details logged, and still counted", async () => {
  const t = await setup();
  t.runner.take(question("q1"));
  t.runner.take(question("q2", "room-2"));
  await t.asked(2);
  t.askFor("q1")!.settle({ ok: false, kind: "timed-out", detail: "no answer within 120 s", usage: null });
  t.askFor("q2")!.settle({ ok: false, kind: "failed", detail: `turn 2 stopped with error_during_execution: ${AWS_KEY} in C:/Users/ada/secret`, usage });
  await t.runner.settled();
  expect(t.sent).toEqual([
    { type: "refusal", v: PROTOCOL_VERSION, id: "q1", reason: "unavailable", detail: "the fork took too long to answer" },
    { type: "refusal", v: PROTOCOL_VERSION, id: "q2", reason: "unavailable", detail: "the fork couldn't answer" },
  ]);
  expect([...t.logs].sort()).toEqual(["q1: no answer within 120 s", expect.stringContaining("q2: turn 2 stopped")]);
});

test("runner: a reservation counts at once, so rooms answering together can't overshoot a machine cap", async () => {
  const t = await setup({ settings: { answersPerMachinePerDay: 2 } });
  for (const room of ["a", "b", "c"]) t.runner.take(question(`q-${room}`, room));
  await t.asked(2);
  await t.sentN(1);
  // Whichever room came third is refused; the other two run.
  expect(t.sent).toEqual([{ type: "refusal", v: PROTOCOL_VERSION, id: expect.stringMatching(/^q-/), reason: "over-cap", cap: "owner-day" }]);
  await new Promise((r) => setTimeout(r, 50));
  expect(t.asks).toHaveLength(2);
  // The token budget too: two leads whose estimates fit alone, but not together.
  const big = await setup({ lead: { context: 1_000_000 } }); // each estimates 2.21M against 5M
  for (const room of ["a", "b", "c"]) big.runner.take(question(`q-${room}`, room));
  await big.asked(2);
  await big.sentN(1);
  expect(big.sent).toEqual([{ type: "refusal", v: PROTOCOL_VERSION, id: expect.stringMatching(/^q-/), reason: "over-cap", cap: "owner-tokens" }]);
  await new Promise((r) => setTimeout(r, 50));
  expect(big.asks).toHaveLength(2);
});

test("runner: a release that arrives while its answer is being written is applied when it lands", async () => {
  const t = await setup();
  t.runner.take(question("q1"));
  await t.asked(1);
  t.runner.take({ type: "release", v: PROTOCOL_VERSION, id: "q1" });
  t.asks[0]!.settle(ok(`The key is ${AWS_KEY}.`));
  await t.runner.settled();
  expect(t.sent).toEqual([{ type: "reply", v: PROTOCOL_VERSION, id: "q1", kind: "answer-question", answer: `The key is ${AWS_KEY}.` }]);
  // A release doesn't carry over to a later answer under another id.
  t.runner.take(question("q2"));
  await t.asked(2);
  t.asks[1]!.settle(ok(`The key is ${AWS_KEY}.`));
  await t.runner.settled();
  expect(t.sent[1]).toEqual({ type: "refusal", v: PROTOCOL_VERSION, id: "q2", reason: "withheld" });
});

test("runner: at most MAX_HELD replies are held; the oldest goes first", async () => {
  const t = await setup({ settings: { answersPerRoomPerHour: 1000, answersPerMachinePerDay: 1000, tokenBudgetPerMachinePerDay: 1e12 } });
  for (let i = 0; i <= MAX_HELD; i++) {
    t.runner.take(question(`q${i}`, `room-${i}`));
    await t.asked(i + 1);
    t.asks[i]!.settle(ok(`${AWS_KEY}`));
  }
  await t.runner.settled();
  t.runner.take({ type: "release", v: PROTOCOL_VERSION, id: "q0" });
  t.runner.take({ type: "release", v: PROTOCOL_VERSION, id: `q${MAX_HELD}` });
  await t.sentN(MAX_HELD + 3);
  expect(t.sent.slice(-2)).toEqual([
    { type: "refusal", v: PROTOCOL_VERSION, id: "q0", reason: "unavailable", detail: `its withheld reply was dropped to make room: more than ${MAX_HELD} were held at once, so ask again` },
    { type: "reply", v: PROTOCOL_VERSION, id: `q${MAX_HELD}`, kind: "answer-question", answer: `${AWS_KEY}` },
  ]);
});

test("runner: the ledger entry of an unmetered failure keeps its estimate", async () => {
  const t = await setup();
  t.runner.take(question("q1"));
  await t.asked(1);
  t.asks[0]!.settle({ ok: false, kind: "timed-out", detail: "no answer within 120 s", usage: null });
  await t.runner.settled();
  // Unmetered, it counts at its estimate.
  expect(t.ledger.entries(NOW)).toEqual([{ at: NOW, room: "room-1", usage: { input: 0, output: 2000, cacheWrite: 100000, cacheRead: 200000 } }]);
});

test("runner: a fork that couldn't be started gives its answer and tokens back", async () => {
  const t = await setup({ settings: { answersPerMachinePerDay: 1 } });
  t.runner.take(question("q1"));
  await t.asked(1);
  t.asks[0]!.settle({ ok: false, kind: "not-set-up", detail: "the claude binary wasn't found", usage: null });
  await t.runner.settled();
  expect(t.sent[0]).toMatchObject({ id: "q1", reason: "unavailable", detail: expect.stringContaining("can't run the fork") });
  expect(t.ledger.entries(NOW)).toEqual([]);
  // The one answer the day allows is still there.
  t.runner.take(question("q2"));
  await t.asked(2);
});

test("runner: at most maxForks run at once across rooms; the rest wait, their timeout not yet running", async () => {
  const t = await setup({ settings: { maxForks: 2 } });
  for (const room of ["a", "b", "c"]) t.runner.take(question(`q-${room}`, room));
  await t.asked(2);
  await new Promise((r) => setTimeout(r, 50));
  expect(t.asks).toHaveLength(2);
  t.asks[0]!.settle(ok("one"));
  await t.asked(3);
  expect(t.asks[2]!.ask.timeoutMs).toBe(defaults.answerTimeoutSeconds * 1000);
  t.asks[1]!.settle(ok("two"));
  t.asks[2]!.settle(ok("three"));
  await t.runner.settled();
  expect(t.sent).toHaveLength(3);
});

test("runner: a session this machine doesn't report isn't answered for, whatever the server asks", async () => {
  const seen: string[] = [];
  const t = await setup({ isReported: async (session) => (seen.push(session), false) });
  t.runner.take(question("q1", "room-1", "claude-code:not-reported"));
  await t.runner.settled();
  expect(t.asks).toEqual([]);
  expect(seen).toEqual(["claude-code:not-reported"]);
  expect(t.sent).toEqual([{ type: "refusal", v: PROTOCOL_VERSION, id: "q1", reason: "unavailable", detail: "this machine doesn't report that session" }]);
});

test("runner: an owner's answer or message isn't the runner's; a handoff to take is logged", async () => {
  const t = await setup();
  t.runner.take({ type: "request", v: PROTOCOL_VERSION, id: "o1", kind: "owner-answer", session: "claude-code:s", question: "q", answers: {} });
  t.runner.take({ type: "request", v: PROTOCOL_VERSION, id: "o2", kind: "owner-message", session: "claude-code:s", from: { id: "claude:a", name: "Ada" }, text: "hi" });
  t.runner.take({ type: "handoff", v: PROTOCOL_VERSION, handoff: { id: "h-1", brief: "b", repos: [{ path: ".", remote: "origin", branch: "isoplan/handoff/h-1", commit: "a".repeat(40) }] } });
  expect(t.sent).toEqual([
    { type: "refusal", v: PROTOCOL_VERSION, id: "o1", reason: "unavailable", detail: "an owner's answer goes to the live session, not the runner" },
    { type: "refusal", v: PROTOCOL_VERSION, id: "o2", reason: "unavailable", detail: "an owner's message goes to the live session, not the runner" },
  ]);
  expect(t.logs).toEqual([expect.stringContaining("handoff h-1")]);
});

test("runner.json: the labelled defaults load, and the owner's file overrides them per key", async () => {
  const user = path.join(tempRoot(), "runner.json");
  fs.writeFileSync(user, JSON.stringify({ claudeModel: "sonnet", answersPerRoomPerHour: 3, tokenBudgetPerMachinePerDay: -1 }));
  const s = await loadSettings<RunnerSettings & { claudeModel: string }>(nodeIo(), path.join(modDir, "runner.json"), user);
  expect(defaults).toMatchObject({ claudeModel: "opus" });
  expect(s).toEqual({ ...defaults, claudeModel: "sonnet", answersPerRoomPerHour: 3 });
  // The app's process listing is asked at most once a second.
  fs.writeFileSync(user, JSON.stringify({ processRefreshSeconds: 0.01 }));
  expect((await loadSettings<{ processRefreshSeconds: number }>(nodeIo(), path.join(modDir, "runner.json"), user)).processRefreshSeconds).toBe(5);
  fs.writeFileSync(user, JSON.stringify({ processRefreshSeconds: 1 }));
  expect((await loadSettings<{ processRefreshSeconds: number }>(nodeIo(), path.join(modDir, "runner.json"), user)).processRefreshSeconds).toBe(1);
});

test("secret patterns: the owner's file adds patterns", async () => {
  const owner = path.join(tempRoot(), "secret-patterns.json");
  fs.writeFileSync(owner, JSON.stringify({ patterns: [{ name: "internal host", regex: "corp\.internal" }] }));
  const logs: string[] = [];
  const patterns = await loadPatterns(path.join(modDir, "secret-patterns.json"), owner, (t) => logs.push(t));
  expect(scan("db at build.corp.internal", patterns)).toBe("internal host");
  expect(scan("-----BEGIN OPENSSH PRIVATE KEY-----", patterns)).toBe("private key");
  expect(scan("Coverage was 79.16% against an 80% floor, on handover-polish.", patterns)).toBe(null);
  expect(logs).toEqual([]);
});

test("secret patterns: an owner's file that can't be used makes them unreadable, so everything is held, with the reason logged", async () => {
  const dir = tempRoot();
  const cases: [string, string | null, string][] = [
    ["broken.json", JSON.stringify({ patterns: [{ name: "internal host", regex: "corp" }, { name: "broken", regex: "(" }] }), `"broken" doesn't compile`],
    ["global.json", JSON.stringify({ patterns: [{ name: "global", regex: "x", flags: "g" }] }), 'flags "g"'],
    ["not-json.json", "{ patterns: ", "JSON"],
    ["no-list.json", JSON.stringify({ pattern: [] }), 'no "patterns" list'],
    // A folder where the file should be: a read error other than a missing file, as a locked or unreadable file is.
    ["folder.json", null, "EISDIR"],
  ];
  for (const [name, text, reason] of cases) {
    const file = path.join(dir, name);
    if (text === null) fs.mkdirSync(file);
    else fs.writeFileSync(file, text);
    const logs: string[] = [];
    const patterns = await loadPatterns(path.join(modDir, "secret-patterns.json"), file, (t) => logs.push(t));
    expect(patterns, name).toBe(null);
    expect(scan("Coverage was 79.16%.", patterns), name).toBe(UNREADABLE);
    expect(logs, name).toHaveLength(1);
    expect(logs[0], name).toContain("can't be used, so every answer, brief and report is held: ");
    expect(logs[0], name).toContain(reason);
  }
});

test("runner: with the secret patterns unreadable, an answer is refused withheld", async () => {
  const t = await setup({ scan: async (text) => scan(text, null) });
  t.runner.take(question("q1"));
  await t.asked(1);
  t.asks[0]!.settle(ok("Coverage is 81%."));
  await t.runner.settled();
  expect(t.sent).toEqual([{ type: "refusal", v: PROTOCOL_VERSION, id: "q1", reason: "withheld" }]);
});
