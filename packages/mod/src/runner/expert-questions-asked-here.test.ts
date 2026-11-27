// Asking an expert on this computer (isoplan-app#340, D8, D15, D16): every reply ask_expert gives,
// late answers, the wordless records, caps and restarts, with this computer's expert stack
// (expert-stack-fixture.ts, the fake `claude` and git of expert-fixture.ts) against a stand-in office.

import path from "node:path";
import { PROTOCOL_VERSION, type AskedMessage, type ExpertRight } from "@isoplan/protocol";
import { expect, test, vi } from "vitest";
import { answeredText, askedText, expertText, exploreMeanwhileText, lateExpertText } from "../ask/expert-text.js";
import { tempRoot } from "../data-layer/fixture.js";
import type { FromOffice } from "../lines.js";
import { ANSWER, BASE, C1, until, type Rule } from "./expert-fixture.js";
import { ADA, ASKING, computer, DEFINITION, directoryOf, entryOf, installedInstance, OTHER_RECORD, readJsonFile, RECORD, SERVER, sharingDirectoryOf, writeExpertFile, type Computer, type ComputerOptions } from "./expert-stack-fixture.js";
import { officeSequence, receivedOf } from "./what-was-learned-fixture.js";

// The empty folder git runs with as its hooks (handoff/take.ts noHooks) is made in the Claude folder: a temp one, never this machine's.
vi.stubEnv("CLAUDE_CONFIG_DIR", path.join(tempRoot(), "claude"));
vi.setConfig({ testTimeout: 60000 });

const RIGHT: ExpertRight = { name: "adr", subject: DEFINITION.subject, repo: "app", host: "Ada" };
const ANSWERS: Rule[] = [{ kind: "fork", text: "Question toolu_", reply: ANSWER }, ...BASE];
const slow = (ms: number): Rule[] => [{ kind: "fork", text: "Question toolu_", reply: ANSWER, delayMs: ms }, ...BASE];
const settle = (ms = 300) => new Promise((r) => setTimeout(r, ms));
const about = (id: string) => ({ expert: "adr", id, name: "Adr Expert" });
const ANSWERED = "The relay holds it while it is in flight.\n\nCited, on main at 1111111:\n- src/relay.ts:1-2 (read at 1111111)";

/** The session's hooks module connects, and the office says it may ask `rights`. */
async function session(c: Computer, s = "s1", rights = [RIGHT]) {
  c.connect(s);
  c.rights.tap(s, c.sessionFolder, { type: "expert-rights", v: PROTOCOL_VERSION, experts: rights, server: SERVER });
  await until(() => c.lines(s).some((l) => l.type === "expert-rights"));
}
const ask = (c: Computer, key: string, o: { question?: string; blocking?: boolean; session?: string; expert?: string; servers?: string[] } = {}) =>
  c.asking.ask({ type: "ask-expert", v: 1, token: "", session: o.session ?? "s1", cwd: c.sessionFolder, servers: o.servers ?? [SERVER], expert: o.expert ?? "adr", question: o.question ?? "Where is it held?", blocking: o.blocking ?? true, key });
const asked = (c: Computer, s = "s1") => c.lines(s).filter((l): l is FromOffice<AskedMessage> => l.type === "asked");
const forks = (c: Computer, id: string) => c.claude().filter((l) => l.kind === "fork" && l.turn === 1 && l.text?.includes(`Question ${id}`));

/** This computer with a ready instance of RECORD from SERVER, and session s1 that may ask it. */
async function ready(o: ComputerOptions = {}, asking = ASKING) {
  const c = await computer({ rules: ANSWERS, before: installedInstance(SERVER, RECORD), ...o });
  c.take(directoryOf([entryOf()], asking));
  await until(() => c.of("expert-instance-states").at(-1)?.instances[0]?.state === "ready", 30000);
  await session(c);
  return c;
}

test("blocking, answered within the wait: the answer, naming its branch and commit, shown once written, and no late line after", async () => {
  const c = await ready();
  try {
    const told = await ask(c, "toolu_1");
    expect(told.text).toBe(answeredText({ ...about("toolu_1"), answer: ANSWERED, commit: C1, branch: "main" }));
    await told.shown!(true);
    c.asking.rehooked("s1");
    await settle();
    expect(asked(c)).toEqual([]);
  } finally {
    await c.close();
  }
});

test("blocking past expertWaitSeconds: explore meanwhile; the answer then comes as a late line, and its ack deletes its words", async () => {
  const c = await ready({ rules: slow(2500), expertWaitSeconds: 1 });
  try {
    expect(await ask(c, "toolu_1")).toEqual({ text: exploreMeanwhileText(about("toolu_1")) });
    await until(() => asked(c).length === 1);
    const line = asked(c)[0]!;
    expect(line).toMatchObject({ type: "asked", question: "toolu_1", key: "toolu_1", text: "Where is it held?", state: "answered", answer: ANSWERED, expert: "adr", commit: C1, branch: "main", server: SERVER });
    expect(lateExpertText({ ...line, expert: "adr" })).toContain("Isoplan: a late answer from expert adr to your question toolu_1.");
    expect(c.asking.holds("toolu_1")).toBe(true);
    await c.asking.ack("s1", "toolu_1");
    const kept = readJsonFile<{ questions: Record<string, unknown>[] }>(c.file("runner", "expert-questions-asked-here.json")).questions[0]!;
    expect(kept).toMatchObject({ id: "toolu_1", text: null, shown: true, state: "answered" });
    expect(kept).not.toHaveProperty("answer");
  } finally {
    await c.close();
  }
});

test("a late end its session hasn't shown is sent to it again every three minutes, until it is acked", async () => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  const c = await ready({ rules: slow(500) });
  try {
    await ask(c, "toolu_1", { blocking: false });
    await until(() => asked(c).length === 1);
    vi.advanceTimersByTime(3 * 60000);
    expect(asked(c).map((l) => l.question)).toEqual(["toolu_1", "toolu_1"]);
    await c.asking.ack("s1", "toolu_1");
    vi.advanceTimersByTime(3 * 60000);
    expect(asked(c)).toHaveLength(2);
  } finally {
    vi.useRealTimers();
    await c.close();
  }
});

test("a question its instance can't take yet keeps being tried again, and ends EXPERT_FORK_FAILED at the first try past the office's maxAgeHours", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"], shouldAdvanceTime: true });
  const c = await computer({ setUpWithoutAsking: true });
  try {
    c.take(directoryOf([entryOf()], { ...ASKING, maxAgeHours: 1 }));
    await session(c);
    // Its set-up waits for the record, which the office never sends.
    expect((await ask(c, "toolu_1", { blocking: false })).code).toBe("EXPERT_STARTING");
    await until(() => c.of("expert-record-wanted").length === 1);
    await vi.advanceTimersByTimeAsync(59 * 60000);
    expect(asked(c)).toEqual([]);
    await vi.advanceTimersByTimeAsync(2 * 60000);
    await until(() => asked(c).length === 1);
    expect(lateExpertText({ ...asked(c)[0]!, expert: "adr" })).toContain("Expert adr, question toolu_1: the expert couldn't answer: the expert couldn't answer within 1 hours. Ask a fresh Explore subagent instead (EXPERT_FORK_FAILED)");
  } finally {
    vi.useRealTimers();
    await c.close();
  }
});

test("not blocking: told it was asked at once, then the answer as a late line", async () => {
  const c = await ready({ rules: slow(500) });
  try {
    expect(await ask(c, "toolu_1", { blocking: false })).toEqual({ text: askedText(about("toolu_1")) });
    await until(() => asked(c).length === 1);
    expect(asked(c)[0]).toMatchObject({ state: "answered", answer: ANSWERED });
  } finally {
    await c.close();
  }
});

test("the same tool call asked again is the same question: one fork", async () => {
  const c = await ready({ rules: slow(800) });
  try {
    await ask(c, "toolu_1", { blocking: false });
    expect(await ask(c, "toolu_1", { blocking: false })).toEqual({ text: askedText(about("toolu_1")) });
    await until(() => asked(c).length === 1);
    expect(forks(c, "toolu_1")).toHaveLength(1);
  } finally {
    await c.close();
  }
});

test("an expert the session may not ask: EXPERT_UNKNOWN, naming those it may", async () => {
  const c = await ready();
  try {
    expect(await ask(c, "toolu_1", { expert: "billing" })).toEqual({ text: expertText("EXPERT_UNKNOWN", { expert: "billing", id: "toolu_1", words: "No expert named billing in this session's office; ask one of: adr." }), failed: true, code: "EXPERT_UNKNOWN" });
    expect(c.of("expert-question")).toEqual([]);
  } finally {
    await c.close();
  }
});

test("the office's caps, counted over this computer's questions and those the office says its person has on their other computers: EXPERT_CAP with the office's words", async () => {
  const c = await ready({ rules: slow(3000) }, { ...ASKING, openPerPersonPerExpert: 2, perPersonPerDay: 3 });
  try {
    c.take({ type: "expert-questions-asked-on-your-other-computers", v: PROTOCOL_VERSION, open: [{ key: "adr", count: 1 }], askedAtInTheLastDay: [new Date(Date.now() - 3600000).toISOString()] });
    await ask(c, "toolu_1", { blocking: false });
    expect(await ask(c, "toolu_2", { blocking: false })).toEqual({ text: expertText("EXPERT_CAP", { ...about("toolu_2"), words: "You have 2 questions waiting for expert adr already, which is as many as this office allows; carry on: their answers reach you as notes." }), failed: true, code: "EXPERT_CAP" });
    await until(() => asked(c).length === 1);
    expect((await ask(c, "toolu_3")).text).toContain("Expert adr answered question toolu_3.");
    const day = await ask(c, "toolu_4", { blocking: false });
    expect(day).toMatchObject({ failed: true, code: "EXPERT_CAP" });
    expect(day.text).toMatch(/^Expert adr, question toolu_4: You have asked 3 expert questions in the last day, which is as many as this office allows; it frees at \d{4}-\d\d-\d\dT[\d:.]+Z, or an admin can raise perAskerPerDay in asks\.json\. \(EXPERT_CAP\)$/);
  } finally {
    await c.close();
  }
});

test("the instance's own caps: EXPERT_CAP saying they were reached on this computer and where to raise them", async () => {
  const c = await ready({ rules: slow(3000), before: installedInstance(SERVER, RECORD, { caps: { openPerAsker: 1 } }) });
  try {
    await ask(c, "toolu_1", { blocking: false });
    await until(() => forks(c, "toolu_1").length === 1);
    expect(await ask(c, "toolu_2")).toEqual({
      text: expertText("EXPERT_CAP", { ...about("toolu_2"), words: `open questions per asking session of 1 reached on this computer; raise it in its instance file, ${c.file("expert-instances", "adr.json")}` }),
      failed: true,
      code: "EXPERT_CAP",
      shown: expect.any(Function),
    });
  } finally {
    await c.close();
  }
});

test("an expert this computer has no instance of: EXPERT_NOT_SET_UP at once, as an error, in its own words", async () => {
  const c = await computer();
  try {
    c.take(directoryOf([entryOf()]));
    await session(c);
    const told = await ask(c, "toolu_1");
    expect(told).toEqual({ text: "Expert adr, question toolu_1: the Adr Expert isn't set up on this computer yet. Explore this yourself (EXPERT_NOT_SET_UP)", failed: true, code: "EXPERT_NOT_SET_UP" });
    expect(c.of("expert-question")).toEqual([expect.objectContaining({ state: "dropped", code: "EXPERT_NOT_SET_UP", expertRecordId: RECORD })]);
  } finally {
    await c.close();
  }
});

test("while its first generation grounds: EXPERT_STARTING at once, and the answer later", async () => {
  const rules: Rule[] = [{ kind: "trunk", text: "Reply with only the word: ready", reply: "ready", context: 20000, delayMs: 2500 }, ...ANSWERS];
  const c = await computer({ rules, before: installedInstance(SERVER, RECORD) });
  try {
    c.take(directoryOf([entryOf()]));
    await session(c);
    expect(await ask(c, "toolu_1")).toEqual({ text: expertText("EXPERT_STARTING", about("toolu_1")), code: "EXPERT_STARTING" });
    await until(() => asked(c).length === 1, 30000);
    expect(asked(c)[0]).toMatchObject({ state: "answered", answer: ANSWERED });
  } finally {
    await c.close();
  }
});

test("EXPERT_FORK_FAILED from a fork that failed, with its words in the late line too, and from a set-up that failed", async () => {
  const c = await ready({ rules: [{ kind: "fork", text: "Question toolu_", exit: true }, ...BASE] });
  try {
    expect(await ask(c, "toolu_1", { blocking: false })).toEqual({ text: askedText(about("toolu_1")) });
    await until(() => asked(c).length === 1);
    const line = asked(c)[0]!;
    expect(line).toMatchObject({ state: "dropped", code: "EXPERT_FORK_FAILED", note: "the fork couldn't answer" });
    expect(lateExpertText({ ...line, expert: "adr" })).toContain("Expert adr, question toolu_1: the expert couldn't answer: the fork couldn't answer. Ask a fresh Explore subagent instead (EXPERT_FORK_FAILED)");
  } finally {
    await c.close();
  }
  const failed = await computer({ checkout: null });
  try {
    failed.take(directoryOf([entryOf()]));
    failed.take({ type: "set-up-expert-instance", v: PROTOCOL_VERSION, request: "r-1", key: "adr", expertRecordId: RECORD, by: { id: "claude:sam", name: "Sam" } });
    await until(() => failed.of("expert-instance-states").at(-1)?.instances[0]?.state === "failed");
    await session(failed);
    expect(await ask(failed, "toolu_2")).toMatchObject({ text: "Expert adr, question toolu_2: the expert couldn't answer: its set-up on this computer failed; the floor says why and offers to try again. Ask a fresh Explore subagent instead (EXPERT_FORK_FAILED)", failed: true, code: "EXPERT_FORK_FAILED" });
  } finally {
    await failed.close();
  }
});

test("its expert deleted: a question its instance is answering, and one waiting for its set-up, end EXPERT_UNKNOWN, saying it was deleted", async () => {
  const deleted = { type: "expert-deleted", v: PROTOCOL_VERSION, key: "adr", expertRecordId: RECORD, by: ADA } as const;
  const words = (id: string) => `Expert adr, question ${id}: the Adr Expert was deleted (EXPERT_UNKNOWN)`;
  const c = await ready({ rules: slow(20000) });
  try {
    await ask(c, "toolu_1", { blocking: false });
    await until(() => forks(c, "toolu_1").length === 1);
    c.take(deleted);
    await until(() => asked(c).length === 1);
    expect(asked(c)[0]).toMatchObject({ question: "toolu_1", state: "dropped", code: "EXPERT_UNKNOWN", note: "the Adr Expert was deleted" });
    expect(lateExpertText({ ...asked(c)[0]!, expert: "adr" })).toContain(words("toolu_1"));
    await until(() => c.of("expert-question").some((m) => m.state === "dropped"));
    expect(c.of("expert-question").at(-1)).toMatchObject({ id: "toolu_1", state: "dropped", code: "EXPERT_UNKNOWN" });
  } finally {
    await c.close();
  }
  const setting = await computer({ setUpWithoutAsking: true });
  try {
    setting.take(directoryOf([entryOf()]));
    await session(setting);
    expect((await ask(setting, "toolu_2", { blocking: false })).code).toBe("EXPERT_STARTING");
    await until(() => setting.of("expert-record-wanted").length === 1);
    setting.take(deleted);
    await until(() => asked(setting).length === 1);
    expect(lateExpertText({ ...asked(setting)[0]!, expert: "adr" })).toContain(words("toolu_2"));
  } finally {
    await setting.close();
  }
});

test("EXPERT_PLUGIN_OLD from a link that is up and showed the office is from before each computer kept its own instance", async () => {
  const c = await computer();
  try {
    c.links.get(SERVER)!.dismissals();
    expect(await ask(c, "toolu_1")).toEqual({ text: expertText("EXPERT_PLUGIN_OLD", about("toolu_1")), failed: true, code: "EXPERT_PLUGIN_OLD" });
  } finally {
    await c.close();
  }
});

test("across a restart: a question still being asked is asked again from the file, and its answer reaches the session once its hooks module connects; an end never shown is kept, until questionsKeptHours", async () => {
  const c = await ready({ rules: slow(3000) });
  await ask(c, "toolu_1", { blocking: false });
  await until(() => forks(c, "toolu_1").length === 1);
  await c.close();
  const again = await computer({ root: c.root, rules: ANSWERS });
  try {
    await until(() => readJsonFile<{ questions: { state: string }[] }>(again.file("runner", "expert-questions-asked-here.json")).questions[0]!.state === "answered", 30000);
    expect(asked(again)).toEqual([]);
    again.connect("s1");
    expect(asked(again)).toEqual([expect.objectContaining({ question: "toolu_1", state: "answered", answer: ANSWERED })]);
  } finally {
    await again.close();
  }
  const later = await computer({ root: c.root, questionsKeptHours: 0.00001 });
  try {
    expect(readJsonFile<{ questions: unknown[] }>(later.file("runner", "expert-questions-asked-here.json")).questions).toEqual([]);
  } finally {
    await later.close();
  }
});

test("the records the office is told have no words: neither the question's nor the answer's, and the session as its hello names it", async () => {
  const c = await ready();
  try {
    const told = await ask(c, "toolu_1", { question: "Where is WORDS-123 kept?" });
    expect(told.text).toContain("Expert adr answered question toolu_1.");
    await until(() => c.of("expert-question").some((m) => m.state === "answered"));
    expect(c.of("expert-question").map((m) => m.state)).toEqual(["asking", "answered"]);
    for (const m of c.of("expert-question")) expect(m).toMatchObject({ id: "toolu_1", key: "adr", expertRecordId: RECORD, session: "claude-code:s1", blocking: true });
    const everything = JSON.stringify(c.sent.get(SERVER));
    expect(everything).not.toContain("WORDS-123");
    expect(everything).not.toContain("The relay holds it");
  } finally {
    await c.close();
  }
});

test("a question that looks like it holds a secret is asked all the same: it never leaves the computer", async () => {
  const c = await ready();
  try {
    expect((await ask(c, "toolu_1", { question: "Is the SECRET in the relay?" })).text).toContain("Expert adr answered question toolu_1.");
    expect(forks(c, "toolu_1")[0]!.text).toContain("Is the SECRET in the relay?");
  } finally {
    await c.close();
  }
});

test("EXPERT_RUNNER_UNREACHABLE: an office not in config.json, as today's words say it; and one this runner hasn't heard from yet", async () => {
  const c = await computer();
  try {
    expect(await ask(c, "toolu_1", { servers: ["wss://elsewhere.example/data-layer"] })).toEqual({ text: expertText("EXPERT_RUNNER_UNREACHABLE", { ...about("toolu_1"), words: "wss://elsewhere.example/data-layer isn't one of the office servers in config.json" }), failed: true, code: "EXPERT_RUNNER_UNREACHABLE" });
    expect(await ask(c, "toolu_2")).toEqual({ text: expertText("EXPERT_RUNNER_UNREACHABLE", { ...about("toolu_2"), words: `this computer's runner hasn't heard from the office at ${SERVER} yet; try again in a minute` }), failed: true, code: "EXPERT_RUNNER_UNREACHABLE" });
  } finally {
    await c.close();
  }
});

test("a runner started again while its office can't be reached answers from its instance, by the directory and rights it saved", async () => {
  const c = await ready();
  await c.close();
  const again = await computer({ root: c.root, rules: ANSWERS });
  try {
    again.connect("s1");
    await until(() => again.experts.running("adr")?.expert.hosted().state === "ready", 30000);
    expect((await ask(again, "toolu_1")).text).toContain("Expert adr answered question toolu_1.");
  } finally {
    await again.close();
  }
});

test("this computer's own expert whose key another expert has: the rights of sessions in its project name it, and it answers them; the other record of the key is neither offered nor set up, and the office is told nothing of the question", async () => {
  const c = await computer({ rules: ANSWERS });
  try {
    writeExpertFile(c);
    await c.experts.refresh("adr");
    c.take(directoryOf([entryOf({ expertRecordId: OTHER_RECORD, owner: ADA })]));
    await until(() => c.of("expert-definition").length === 1);
    c.take({ type: "expert-definition-result", v: PROTOCOL_VERSION, key: "adr", outcome: "refused", reason: "key-taken" });
    await until(() => c.experts.running("adr")?.expert.hosted().state === "ready", 30000);
    await session(c, "s1", [{ ...RIGHT, subject: "Ada's expert of the same key." }]);
    await until(() => c.lines("s1").filter((l) => l.type === "expert-rights").some((l) => l.experts[0]?.host === "Sam"));
    expect(c.lines("s1").filter((l) => l.type === "expert-rights").at(-1)).toMatchObject({ experts: [{ name: "adr", subject: DEFINITION.subject, repo: "app", host: "Sam" }], server: SERVER });
    expect((await ask(c, "toolu_1")).text).toContain("Expert adr answered question toolu_1.");
    expect(c.of("expert-set-up-offered")).toEqual([]);
    expect(c.of("expert-record-wanted")).toEqual([]);
    expect(c.of("expert-question")).toEqual([]);
  } finally {
    await c.close();
  }
});

const third: Rule = { kind: "trunk", text: "Before you, this expert's instances learned", reply: "ready", context: 52000 };
// A thing learned of about 120 estimated tokens.
const sized = (i: number, commit = C1, file = "src/relay.ts") => ({ text: `Rule or fact: thing ${i} ${"x".repeat(320)}. Files: ${file}`, files: [{ path: file, commit }] });

test("past what one question carries of what other instances learned (the definition's own limit): EXPERT_STARTING at once, its listing stays ready, the old junior takes no fork, and a new generation grounded with the newest things whose files haven't changed answers it", async () => {
  const c = await computer({ rules: [third, ...ANSWERS], before: installedInstance(SERVER, RECORD, {}, { ...DEFINITION, learnedElsewhereTokensPerQuestion: 300 }) });
  try {
    c.take(sharingDirectoryOf([entryOf()]));
    await until(() => c.of("expert-instance-states").at(-1)?.instances[0]?.state === "ready", 30000);
    await session(c);
    const seq = officeSequence();
    seq.serving(c)();
    c.git.repo.changed = ["src/other.ts"];
    for (const i of [1, 2, 3, 4]) seq.learned(sized(i));
    seq.learned(sized(5, "0".repeat(40), "src/other.ts"));
    c.take(seq.after(0));
    await until(() => receivedOf(c)?.lastArrivalNumberReceived === 5);
    const old = c.experts.running("adr")!;
    expect(old.expert.hosted().state).toBe("ready");

    const mark = c.of("expert-instance-states").length;
    expect(await ask(c, "toolu_1")).toEqual({ text: expertText("EXPERT_STARTING", about("toolu_1")), code: "EXPERT_STARTING" });
    expect(c.experts.running("adr")!.expert.hosted().state).toBe("ready");
    await until(() => asked(c).some((l) => l.question === "toolu_1"), 30000);
    expect(asked(c).find((l) => l.question === "toolu_1")).toMatchObject({ state: "answered", answer: ANSWERED });
    const third3 = c.claude().find((l) => l.kind === "trunk" && l.text?.includes("Before you, this expert's instances learned"))!;
    for (const [i, carried] of [[5, false], [4, true], [3, true], [2, false]] as const) expect(third3.text!.includes(`thing ${i} `)).toBe(carried);
    const forks = c.claude().filter((l) => l.kind === "fork" && l.turn === 1 && l.text?.includes("Question toolu_1"));
    expect(forks.map((l) => l.trunk)).toEqual([third3.trunk]);
    expect(c.of("expert-instance-states").slice(mark).map((m) => m.instances[0]!.state)).toEqual(c.of("expert-instance-states").slice(mark).map(() => "ready"));
  } finally {
    await c.close();
  }
});

test("a catch-up still coming in pages as a question comes is waited for before what it brings is judged against the limit: past it, the new generation that carries it answers, not the old junior", async () => {
  const c = await computer({ rules: [third, ...ANSWERS], before: installedInstance(SERVER, RECORD, {}, { ...DEFINITION, learnedElsewhereTokensPerQuestion: 300 }) });
  try {
    c.take(sharingDirectoryOf([entryOf()]));
    await until(() => c.of("expert-instance-states").at(-1)?.instances[0]?.state === "ready" && c.of("expert-learned-wanted-after").length === 1, 30000);
    await session(c);
    const seq = officeSequence();
    for (const i of [1, 2, 3, 4]) seq.learned(sized(i));
    // The connection's ask is answered in two pages; the first is within the limit.
    const [first, second] = seq.answer(c.of("expert-learned-wanted-after")[0]!, 2);
    c.take(first!);
    await until(() => receivedOf(c)?.lastArrivalNumberReceived === 2);
    await ask(c, "toolu_1", { blocking: false });
    await settle(500);
    expect(forks(c, "toolu_1")).toEqual([]);
    c.take(second!);
    await until(() => asked(c).some((l) => l.question === "toolu_1"), 30000);
    expect(asked(c).find((l) => l.question === "toolu_1")).toMatchObject({ state: "answered", answer: ANSWERED });
    const grounded = c.claude().find((l) => l.kind === "trunk" && l.text?.includes("Before you, this expert's instances learned"))!;
    expect(forks(c, "toolu_1").map((l) => l.trunk)).toEqual([grounded.trunk]);
  } finally {
    await c.close();
  }
});

test("a run's question: answered from this computer's instance with no session, its asker the employee in the instance's own ledger, not counted in the office's caps, its record naming the employee; past its wait, explore meanwhile; an employee's own entry is never an expert a session asks", async () => {
  const RUN_ANSWERS: Rule[] = [{ kind: "fork", text: "Question ", reply: ANSWER }, ...BASE];
  const tight = { ...ASKING, perPersonPerDay: 1 };
  const c = await ready({ rules: RUN_ANSWERS }, tight);
  try {
    c.take({ ...directoryOf([entryOf(), entryOf({ key: "adams-outreach", expertRecordId: OTHER_RECORD, employee: true, yours: true })], tight), employees: true });
    await settle();
    const run = (n: number, waitMs = 20000) => c.asking.askForAnEmployeeRun({ employee: "adams-outreach", server: SERVER, run: `${n}1111111-1111-4111-8111-111111111111`, expert: "adr", question: "Where is it held?", waitMs });
    const first = await run(1);
    expect(first.text).toContain("Expert adr answered question");
    expect(first.answer).toEqual({ question: "Where is it held?", answer: ANSWERED, files: [{ path: "src/relay.ts", commit: C1 }] });
    await run(2);
    // Two runs' questions, and the office's one a day still lets the session ask.
    expect((await ask(c, "toolu_1")).text).toBe(answeredText({ ...about("toolu_1"), answer: ANSWERED, commit: C1, branch: "main" }));
    const ledger = readJsonFile<{ room: string }[]>(c.file("experts", "adr", "ledger.json"));
    expect(ledger.filter((e) => e.room === "employee:adams-outreach")).toHaveLength(2);
    expect(c.of("expert-question").filter((q) => q.employee).at(-1)).toMatchObject({ key: "adr", session: "employee:adams-outreach", employee: "adams-outreach", state: "answered" });
    // An employee's directory entry is never offered, set up or asked from a session.
    expect((await ask(c, "toolu_2", { expert: "adams-outreach" })).code).toBe("EXPERT_UNKNOWN");
    c.rules([{ kind: "fork", text: "Question ", reply: ANSWER, delayMs: 3000 }, ...BASE]);
    expect((await run(3, 500)).text).toMatch(/the expert is still answering\. Explore this yourself meanwhile/);
  } finally {
    await c.close();
  }
});
