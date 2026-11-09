import { PROTOCOL_VERSION, type Facts, type QuestionFact, type RequestMessage } from "@isoplan/protocol";
import { expect, test, vi } from "vitest";
import type { DataLayerLine } from "../lines.js";
import { lateTake, prepareQuestions, relayOwnerAnswer, WITHHELD_QUESTION } from "./owner-answers.js";

const v = PROTOCOL_VERSION;
const at = "2026-10-20T09:00:00.000Z";
const lead = "claude-code:s:lead";
const asked = (id: string, question: string, extra: Partial<QuestionFact> = {}): QuestionFact => ({ id, agent: lead, at, questions: [{ question, header: "", options: [{ label: "main", description: "" }], multiSelect: false }], ...extra });
const facts: Facts = {
  session: { id: "claude-code:s", source: "claude-code", lead, title: "main", titleFrom: "branch", branch: "main", lastActive: at, status: "active", lights: "on" },
  agents: [],
  edits: [],
  reads: [],
  waits: [],
  reports: [],
  questions: [asked("toolu_1", "Which branch?", { answerable: true })],
};
const request = { type: "request", v, id: "r1", kind: "owner-answer", session: "claude-code:s", question: "toolu_1", answers: { "Which branch?": "main" } } as const;
type OwnerAnswer = Extract<RequestMessage, { kind: "owner-answer" }>;
const file = "C:/Users/ada/.claude/isoplan/answers/s/r1.json";
const sk = "sk_live_" + "4eC39HqLyjWDarjtT1zdp7dc";

// The hooks module's file: absent for the first `after` looks, then each of `texts` in turn.
function relay(texts: (string | null)[], { after = 2, detached = false, given = [facts as Facts | null], req = request as OwnerAnswer } = {}) {
  const lines: DataLayerLine[] = [];
  let looks = 0;
  const take = async () => (++looks > after ? (texts.shift() ?? null) : null);
  // `given`: the facts sent, the last of them from then on.
  const sent = () => (given.length > 1 ? given.shift()! : given[0]!);
  return { lines, sent: relayOwnerAnswer(req, { detached, session: "s", facts: sent, file, emit: (l) => void lines.push(l), take, sleep: async () => {}, waitMs: 1000 }) };
}
const refused = async (r: ReturnType<typeof relay>) => {
  const { message } = await r.sent;
  return message.type === "refusal" && message.reason === "unavailable" ? message.detail : null;
};

test("owner answer: passed to the hooks module, and a reply once it ended that question's call; another question's word is passed over", async () => {
  const { lines, sent } = relay([JSON.stringify({ question: "toolu_9", taken: true }), JSON.stringify({ question: "toolu_1", taken: true })]);
  expect(await sent).toEqual({ message: { type: "reply", v, id: "r1", kind: "owner-answer" }, gaveUp: false });
  expect(lines).toEqual([{ type: "owner-answer", question: "toolu_1", answers: { "Which branch?": "main" }, file }]);
});

test("owner answer: refused when the terminal answered first, when the hooks module never says and the question is still open, when it isn't open or waited on, and for a session without the plugin", async () => {
  expect(await refused(relay([JSON.stringify({ question: "toolu_1", taken: false })]))).toMatch(/answered in the terminal first/);
  expect(await refused(relay([]))).toMatch(/didn't take the answer in time/);
  const closed = relay([], { given: [{ ...facts, questions: [] }] });
  expect(await refused(closed)).toMatch(/isn't waiting for an answer/);
  expect(closed.lines).toEqual([]);
  const unmarked = relay([], { given: [{ ...facts, questions: [asked("toolu_1", "Which branch?")] }] });
  expect(await refused(unmarked)).toMatch(/asked before Isoplan.s plugin loaded in its session, so answer it in its terminal/);
  expect(unmarked.lines).toEqual([]);
  const runnerOnly = relay([], { detached: true });
  expect(await refused(runnerOnly)).toMatch(/plugin isn't running in this session: type \/reload-plugins in it, or answer the question in its terminal/);
  expect(runnerOnly.lines).toEqual([]);
});

test("owner answer: annotations as the dialog gives them: the floor's notes, and the chosen option's preview from the question, whatever the floor sent", async () => {
  const options = [{ label: "Alpha", description: "", preview: "ALPHA" }, { label: "Beta", description: "" }];
  const layout = { question: "Which layout?", header: "", options, multiSelect: false };
  const plain = { question: "Ship it?", header: "", options: [{ label: "Yes", description: "" }], multiSelect: false };
  const given = [{ ...facts, questions: [{ ...asked("toolu_1", ""), questions: [layout, plain], answerable: true as const }] }];
  const answers = { "Which layout?": "Alpha", "Ship it?": "Yes" };
  const req = { ...request, answers, annotations: { "Which layout?": { notes: "Wider, please", preview: "FROM THE FLOOR" } } };
  const { lines } = relay([JSON.stringify({ question: "toolu_1", taken: true })], { given, req });
  await vi.waitFor(() => expect(lines).toHaveLength(1));
  expect(lines[0]).toEqual({ type: "owner-answer", question: "toolu_1", answers, annotations: { "Which layout?": { notes: "Wider, please", preview: "ALPHA" } }, file });
  // "Chat about this": no answers, no annotations.
  const chat = relay([JSON.stringify({ question: "toolu_1", taken: true })], { given, req: { ...request, answers: {}, chat: true } });
  await vi.waitFor(() => expect(chat.lines).toEqual([{ type: "owner-answer", question: "toolu_1", answers: {}, chat: true, file }]));
});

test("owner answer: a question asked before the plugin loaded goes as the owner's message, saying they answered on the floor; one that didn't go in says why", async () => {
  const given = [{ ...facts, questions: [asked("toolu_1", "Which branch?", { asMessage: true })] }];
  const req = { ...request, annotations: { "Which branch?": { notes: "and push it" } } };
  const r = relay([JSON.stringify({ question: "toolu_1", taken: true })], { given, req });
  expect(await r.sent).toEqual({ message: { type: "reply", v, id: "r1", kind: "owner-answer" }, gaveUp: false });
  expect(r.lines[0]).toMatchObject({ late: { session: "s", text: 'I answered your question on the Isoplan floor:\n- "Which branch?": main\n  My notes: and push it' } });
  const chat = relay([], { given, req: { ...request, answers: {}, chat: true } });
  await vi.waitFor(() => expect(chat.lines[0]).toMatchObject({ late: { text: "I saw your question on the Isoplan floor, and I'd like to talk it through before I answer:\n- \"Which branch?\"" } }));
  expect(await refused(relay([JSON.stringify({ question: "toolu_1", taken: false, reason: "no-turn" })], { given }))).toMatch(/couldn't stop the agent's turn/);
  expect(await refused(relay([JSON.stringify({ question: "toolu_1", taken: false, reason: "ended" })], { given }))).toMatch(/has ended, or carried on as a new one/);
});

test("owner answer: with no word from the hooks module, a question that has closed since gets a closed reply, unless it went as a message, and either way its word is still looked for", async () => {
  expect(await relay([], { given: [facts, { ...facts, questions: [] }] }).sent).toEqual({ message: { type: "reply", v, id: "r1", kind: "owner-answer", closed: true }, gaveUp: true });
  expect((await relay([]).sent).gaveUp).toBe(true);
  expect((await relay([JSON.stringify({ question: "toolu_1", taken: false })]).sent).gaveUp).toBe(false);
  // One going in as a message closes when its turn is ended, before the answer is in: it is refused.
  const late = { ...facts, questions: [asked("toolu_1", "Which branch?", { asMessage: true })] };
  const r = relay([], { given: [late, { ...facts, questions: [] }] });
  expect(await refused(r)).toMatch(/hasn't taken the answer as a message yet/);
  expect((await r.sent).gaveUp).toBe(true);
});

test("a late word: the hooks module's take, or its no, once it comes; nothing when it never does", async () => {
  const later = (texts: (string | null)[]) => {
    let looks = 0;
    return lateTake("toolu_1", file, async () => (++looks > 3 ? (texts.shift() ?? null) : null), { sleep: async () => {}, ms: 1000 });
  };
  expect(await later([JSON.stringify({ question: "toolu_1", taken: true })])).toBe(true);
  expect(await later([JSON.stringify({ question: "toolu_9", taken: true }), JSON.stringify({ question: "toolu_1", taken: false })])).toBe(false);
  expect(await later([])).toBeNull();
});

test("questions as sent: answerable only while their wait is marked; one the secret check matches, or every one while the patterns can't be read, goes as a placeholder", () => {
  const logged: string[] = [];
  const open: Facts = { ...facts, questions: [asked("toolu_1", "Which branch?"), asked("toolu_2", `Use the key ${sk}?`), asked("toolu_3", "Ship it?")] };
  const patterns = [{ name: "Stripe secret key", regex: /sk_live_[0-9a-zA-Z]{24}/ }];
  const sent = prepareQuestions(open, patterns, new Map([["toolu_1", true], ["toolu_2", true]]), (t) => void logged.push(t));
  const held = { id: "toolu_2", agent: lead, at, questions: [{ question: WITHHELD_QUESTION, header: "", options: [], multiSelect: false }], withheld: true };
  expect(sent.questions).toEqual([{ ...open.questions![0], answerable: true }, held, open.questions![2]]);
  expect(JSON.stringify(sent)).not.toContain(sk);
  expect(logged).toEqual([`withheld the question toolu_2 of ${lead}: it matches the secret pattern "Stripe secret key"; it is answered in the terminal`]);
  // An option's text is checked too.
  const inOption: Facts = { ...facts, questions: [{ ...asked("toolu_4", "Which key?"), questions: [{ question: "Which key?", header: "", options: [{ label: "This one", description: sk }], multiSelect: false }] }] };
  expect(prepareQuestions(inOption, patterns, new Map([["toolu_4", true]]), () => {}).questions![0]).toMatchObject({ withheld: true });
  expect(prepareQuestions(open, null, new Map([["toolu_1", true]]), () => {}).questions!.every((q) => q.withheld && !q.answerable)).toBe(true);
  // One the source took only in part is never answerable: an answer wouldn't cover all of it.
  const partial: Facts = { ...facts, questions: [asked("toolu_5", "Which branch?", { extra: { incomplete: true } })] };
  expect(prepareQuestions(partial, patterns, new Map([["toolu_5", true]]), () => {}).questions![0]!.answerable).toBeUndefined();
});

test("questions as sent: one never marked, in a session that answers late, is answerable as a message, unless withheld or incomplete; one whose wait has ended isn't; a preview is secret-checked too", () => {
  const patterns = [{ name: "Stripe secret key", regex: /sk_live_[0-9a-zA-Z]{24}/ }];
  const inPreview = { ...asked("toolu_2", "Which key?"), questions: [{ question: "Which key?", header: "", options: [{ label: "This one", description: "", preview: `KEY=${sk}` }], multiSelect: false }] };
  const open: Facts = { ...facts, questions: [asked("toolu_1", "Which branch?"), inPreview, asked("toolu_3", "Ship it?", { extra: { incomplete: true } }), asked("toolu_4", "Now?")] };
  const sent = prepareQuestions(open, patterns, new Map([["toolu_4", true]]), () => {}, true).questions!;
  expect(sent.map((q) => [q.answerable, q.asMessage, q.withheld])).toEqual([[undefined, true, undefined], [undefined, undefined, true], [undefined, undefined, undefined], [true, undefined, undefined]]);
  expect(JSON.stringify(sent)).not.toContain(sk);
  expect(prepareQuestions(open, patterns, new Map(), () => {}).questions![0]!.asMessage).toBeUndefined();
  // The hooks module ran its call, which has ended: the transcript just doesn't show the answer yet.
  expect(prepareQuestions(open, patterns, new Map([["toolu_1", false]]), () => {}, true).questions![0]).toEqual(open.questions![0]);
});
