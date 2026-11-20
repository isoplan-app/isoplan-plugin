import fs from "node:fs";
import path from "node:path";
import { PROTOCOL_VERSION, type AreaFact, type DraftOfficeWideExpertCreationSuggestionMessage, type ExpertCreationSuggestionDismissal, type CreateExpertFromSuggestionMessage, type ExpertCreationSuggestionDismissalsMessage } from "@isoplan/protocol";
import { expect, test } from "vitest";
import { modDir, tempRoot } from "../data-layer/fixture.js";
import type { RunnerExpertCreationSuggestionMessage } from "../data-layer/link.js";
import type { SessionAreas } from "../data-layer/report-session.js";
import type { DataLayerLine } from "../lines.js";
import { parseExpertFile } from "./expert-file.js";
import type { HostedExpert } from "./expert.js";
import type { Draft, DraftInput } from "./expert-creation-suggestion-model-calls.js";
import { cloneUrls, createExpertCreationSuggestions, EXCERPT_CHARS, EXPERT_CREATION_LIMIT_MS, folderExcerpts, folderFiles, passed, passes, RETRY_MS, reviewUrl, signalsOf, type ExpertCreationSuggestionSettings, type ExpertCreationSuggestionsOptions } from "./expert-creation-suggestions.js";

const SETTINGS: ExpertCreationSuggestionSettings = JSON.parse(fs.readFileSync(path.join(modDir, "runner.json"), "utf8")).expertCreationSuggestions;
// The correction check turned on, as runner.json doesn't by default.
const CHECKING: ExpertCreationSuggestionSettings = { ...SETTINGS, correctionCheck: true };
const A = "ws://127.0.0.1:4747/data-layer";
const B = "wss://office.team.com/data-layer";
const PROJECT = { id: "github.com/team/app", name: "app" };
const OTHER = { id: "github.com/team/lib", name: "lib" };
const DRAFT: Draft = { key: "parser", subject: "How the parser reads a file. Ask before changing it.", proof: { question: "Where does parsing start?", answer: "In parse.ts." } };

const area = (folder: string, tokens: number, more: Partial<AreaFact> = {}): AreaFact => ({ folder, reads: 1, searches: 0, tokens, ms: 0, corrections: 0, ...more });
const dismissals = (list: ExpertCreationSuggestionDismissal[] = []): ExpertCreationSuggestionDismissalsMessage => ({ type: "expert-creation-suggestion-dismissals", v: PROTOCOL_VERSION, dismissals: list });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const idOf = (s: { message: RunnerExpertCreationSuggestionMessage }) => (s.message as { id: string }).id;
// expert-creation-suggestions.json as it is on disk; null while it is missing or being replaced.
const savedFile = (isoplanDir: string) => {
  try {
    return JSON.parse(fs.readFileSync(path.join(isoplanDir, "runner", "expert-creation-suggestions.json"), "utf8")) as { expertCreations: unknown[] };
  } catch {
    return null;
  }
};

// A session's file of its open suggestions, as it is on disk; null while it is missing or being replaced.
const sessionFile = (isoplanDir: string, bare: string) => {
  try {
    return JSON.parse(fs.readFileSync(path.join(isoplanDir, "expert-creation-suggestions", `${bare}.json`), "utf8")) as { expertCreationSuggestions: { server: string; officeWideReason?: unknown }[] };
  } catch {
    return null;
  }
};

async function until(check: () => boolean, ms = 5000) {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 5));
  }
}

const FILES = { "src/parser/parse.ts": "export function parse(text: string) {}\n", "src/parser/lex.ts": "export function lex(text: string) {}\n", "src/parser/.cache": "x", "src/main.ts": "import { parse } from './parser/parse.js';\n" };

type Clone = string | { problem: string; reason?: string };

/** ExpertCreationSuggestions for offices A and B with stand-ins for everything they reach; session s1's hooks module connected. */
async function harness(o: Partial<ExpertCreationSuggestionsOptions> = {}, root = tempRoot()) {
  const isoplanDir = path.join(root, "isoplan");
  const checkout = path.join(root, "app");
  fs.mkdirSync(path.join(checkout, "src", "parser", "node_modules"), { recursive: true });
  for (const [f, text] of Object.entries(FILES)) fs.writeFileSync(path.join(checkout, f), text);
  const sent: { server: string; message: RunnerExpertCreationSuggestionMessage }[] = [];
  const up = [true, true];
  const lines: { bare: string; line: DataLayerLine }[] = [];
  const hooked = new Set(["s1"]);
  const drafts: DraftInput[] = [];
  const logs: string[] = [];
  const clones: { url: string; project: string }[] = [];
  const state = { draft: DRAFT as Draft | null, experts: [] as HostedExpert[], checkout: checkout as string | null, clone: path.join(root, "clones", "app") as Clone | ((url: string) => Clone) };
  const opts: ExpertCreationSuggestionsOptions = {
    isoplanDir,
    settings: async () => ({ expertCreationSuggestions: SETTINGS }),
    offices: [A, B].map((server, i) => ({ server, label: i ? "team" : "dev", send: (message) => up[i]! && (sent.push({ server, message }), true) })),
    account: { id: "claude:ada" },
    scan: async (text) => (text.includes("AKIA") ? "AWS access key" : null),
    draft: async (input) => (drafts.push(input), state.draft),
    corrects: async () => true,
    experts: () => state.experts,
    projectOf: async () => PROJECT.id,
    checkout: async () => state.checkout,
    clone: async (url, project) => (clones.push({ url, project }), typeof state.clone === "function" ? state.clone(url) : state.clone),
    hooked: (bare) => (hooked.has(bare) ? { send: (line) => void lines.push({ bare, line }) } : null),
    log: (text) => void logs.push(text),
    pollMs: 10,
    keptMs: 20,
    ...o,
  };
  const expertCreationSuggestions = createExpertCreationSuggestions(opts);
  await expertCreationSuggestions.start();
  const seen = (areas: AreaFact[], more: Partial<SessionAreas> = {}): SessionAreas => ({ server: A, session: "claude-code:s1", bare: "s1", project: PROJECT, checkout, window: 200000, model: null, areas, said: async () => ["Asked: how does the parser work?"], ...more });
  const sentExpertCreationSuggestions = () => sent.filter((s) => s.message.type === "expert-creation-suggestion");
  return { root, isoplanDir, checkout, expertCreationSuggestions, sent, up, lines, hooked, drafts, logs, state, clones, seen, sentExpertCreationSuggestions };
}

test("reviewUrl: the office's http address with /?expert-creation-suggestion=<id>, its data-layer path taken off", () => {
  expect(reviewUrl(A, "abc_1")).toBe("http://127.0.0.1:4747/?expert-creation-suggestion=abc_1");
  expect(reviewUrl("wss://office.team.com/team/data-layer", "x")).toBe("https://office.team.com/team/?expert-creation-suggestion=x");
});

test("signals: a folder passes on its share of the context window, its tokens, its minutes or its corrections", () => {
  const t = SETTINGS;
  expect(signalsOf(area("src", 30000, { ms: 90000, corrections: 1 }), 200000)).toEqual({ share: 0.15, tokens: 30000, minutes: 1.5, corrections: 1 });
  expect(signalsOf(area("src", 30000), null).share).toBe(0);
  expect(passes(signalsOf(area("src", 25000), 100000), t)).toBe(true); // 25% of the window
  expect(passes(signalsOf(area("src", 30000), 1000000), t)).toBe(true); // 30,000 tokens
  expect(passes(signalsOf(area("src", 10, { ms: 600000 }), 1000000), t)).toBe(true); // 10 minutes
  expect(passes(signalsOf(area("src", 10, { corrections: 2 }), 1000000), t)).toBe(true);
  expect(passes(signalsOf(area("src", 29999, { ms: 599000, corrections: 1 }), 1000000), t)).toBe(false);
  // A suggestion gives only the signals that passed.
  expect(passed(signalsOf(area("src", 35000, { ms: 90000, corrections: 1 }), 1000000), t)).toEqual({ share: 0.035, tokens: 35000, minutes: 0, corrections: 0 });
  expect(passed(signalsOf(area("src", 10, { ms: 600000, corrections: 2 }), 1000000), t)).toEqual({ share: 0, tokens: 0, minutes: 10, corrections: 2 });
});

test("folderFiles and folderExcerpts: a draft sees a folder's files, and the start of the first that read as text", async () => {
  const h = await harness();
  expect(await folderFiles(h.checkout, "src")).toEqual(["src/main.ts", "src/parser/lex.ts", "src/parser/parse.ts"]);
  expect(await folderFiles(h.checkout, "src", 2)).toEqual(["src/main.ts", "src/parser/lex.ts"]);
  const dir = tempRoot();
  fs.writeFileSync(path.join(dir, "a.ts"), "a".repeat(EXCERPT_CHARS + 10));
  fs.writeFileSync(path.join(dir, "b.bin"), Buffer.from([1, 0, 2]));
  fs.writeFileSync(path.join(dir, "c.ts"), "");
  fs.writeFileSync(path.join(dir, "d.ts"), "  d\n");
  expect(await folderExcerpts(dir, ["a.ts", "b.bin", "c.ts", "gone.ts", "d.ts"])).toEqual([{ file: "a.ts", text: "a".repeat(EXCERPT_CHARS) }, { file: "d.ts", text: "d" }]);
  expect(await folderExcerpts(dir, ["d.ts", "a.ts"], 1)).toEqual([{ file: "d.ts", text: "d" }]);
});

test("a session's deepest folder that passes is drafted once, from its files' names and starts, and suggested to each office that takes the repo, once that office's connection has had its dismissals; never again for that session, nor inside or above it, a restart included", async () => {
  const h = await harness();
  const areas = [area("src", 40000), area("src/parser", 35000), area("docs", 100)];
  // A pass before its office has said the person's dismissals isn't looked at.
  h.expertCreationSuggestions.seen(h.seen(areas));
  await sleep(30);
  expect(h.drafts).toEqual([]);
  h.expertCreationSuggestions.take(0, dismissals());
  h.expertCreationSuggestions.seen(h.seen(areas));
  h.expertCreationSuggestions.seen(h.seen(areas, { server: B }));
  await until(() => h.drafts.length === 1);
  expect(h.drafts[0]).toEqual({
    project: PROJECT,
    folder: "src/parser",
    files: ["src/parser/lex.ts", "src/parser/parse.ts"],
    excerpts: [
      { file: "src/parser/lex.ts", text: "export function lex(text: string) {}" },
      { file: "src/parser/parse.ts", text: "export function parse(text: string) {}" },
    ],
    said: ["Asked: how does the parser work?"],
  });
  await until(() => h.sentExpertCreationSuggestions().length === 1);
  const suggestion = h.sentExpertCreationSuggestions()[0]!;
  expect(suggestion.server).toBe(A);
  expect(suggestion.message).toMatchObject({ type: "expert-creation-suggestion", session: "claude-code:s1", project: PROJECT, folder: "src/parser", scope: "session", key: "parser", subject: DRAFT.subject, area: ["src/parser"], proof: DRAFT.proof, why: { share: 0.175, tokens: 35000, minutes: 0, corrections: 0 } });
  h.expertCreationSuggestions.take(1, dismissals());
  await until(() => h.sentExpertCreationSuggestions().length === 2);
  expect(h.sentExpertCreationSuggestions()[1]).toMatchObject({ server: B, message: { id: (suggestion.message as { id: string }).id } });

  for (const more of [[area("src/parser/lexer", 35000)], [area("src", 90000)]]) h.expertCreationSuggestions.seen(h.seen(more));
  await sleep(30);
  const again = await harness({}, h.root);
  again.expertCreationSuggestions.take(0, dismissals());
  again.expertCreationSuggestions.seen(again.seen(areas));
  await sleep(30);
  expect([h.drafts.length, again.drafts.length]).toEqual([1, 0]);
});

test("a suggestion goes only to the offices that may be told of its repo: one on another repo the session worked in, only to the office whose pass named that repo", async () => {
  const h = await harness();
  for (const index of [0, 1]) h.expertCreationSuggestions.take(index, dismissals());
  // A holds the other repo, so its pass names it; B's pass has only the session's own repo.
  h.expertCreationSuggestions.seen(h.seen([area("src/parser", 35000, { project: OTHER }), area("docs", 100)]));
  h.expertCreationSuggestions.seen(h.seen([area("docs", 100)], { server: B }));
  await until(() => h.lines.length === 1);
  expect(h.sentExpertCreationSuggestions().map((s) => [s.server, (s.message as { project: unknown }).project])).toEqual([[A, OTHER]]);
  // B's next pass doesn't add it either.
  h.expertCreationSuggestions.seen(h.seen([area("docs", 100)], { server: B }));
  await sleep(50);
  expect(h.sentExpertCreationSuggestions().map((s) => s.server)).toEqual([A]);
});

test("no expert is suggested on a folder the person dismissed, whatever the letter case, even after a restart, one an expert here covers, or one whose path or draft matches a secret pattern, each said why where there is one", async () => {
  const h = await harness();
  // Before the office has said the dismissals, a pass isn't looked at: a dismissal for good holds.
  h.expertCreationSuggestions.seen(h.seen([area("src/parser", 35000)]));
  await sleep(30);
  h.expertCreationSuggestions.take(0, dismissals([{ project: PROJECT.id.toUpperCase(), folder: "SRC/Parser", forever: true }]));
  h.expertCreationSuggestions.seen(h.seen([area("src/parser", 35000)]));
  h.state.experts = [{ name: "docs", repo: "/work/app", subject: "The docs.", state: "ready", senior: false, areas: ["Docs/**"] }];
  h.expertCreationSuggestions.seen(h.seen([area("docs/adr", 35000)], { session: "claude-code:s2", bare: "s2" }));
  await sleep(30);
  expect(h.drafts).toEqual([]);

  // The folder is checked before any draft is made of it, and the whole draft after.
  h.expertCreationSuggestions.seen(h.seen([area("src/AKIA" + "ABCDEFGHIJKLMNOP", 35000)], { session: "claude-code:s3", bare: "s3" }));
  await until(() => h.logs.some((l) => l.includes("secret pattern")));
  expect(h.logs.at(-1)).toBe('no expert is suggested on a folder of app: its path matches the secret pattern "AWS access key"');
  expect(h.drafts).toEqual([]);
  h.state.draft = { ...DRAFT, subject: "Uses the key AKIA" + "ABCDEFGHIJKLMNOP." };
  h.expertCreationSuggestions.seen(h.seen([area("src", 35000)], { session: "claude-code:s4", bare: "s4" }));
  await until(() => h.logs.some((l) => l.includes("its draft matches")));
  expect(h.logs.at(-1)).toBe('no expert is suggested on src of app: its draft matches the secret pattern "AWS access key"');
  expect(h.sentExpertCreationSuggestions()).toEqual([]);
});

test("a folder whose reads were all in a passing folder the person dismissed is never suggested for them", async () => {
  const h = await harness();
  h.expertCreationSuggestions.take(0, dismissals([{ project: PROJECT.id, folder: "src/shipping", forever: true }]));
  h.expertCreationSuggestions.seen(h.seen([area("src", 35000), area("src/shipping", 35000)]));
  await sleep(30);
  expect(h.drafts).toEqual([]);
});

test("a folder whose reads are spread over folders inside it that don't pass on their own is suggested", async () => {
  const h = await harness();
  h.expertCreationSuggestions.take(0, dismissals());
  h.expertCreationSuggestions.seen(h.seen([area("src", 35000), area("src/parser", 20000), area("src/lexer", 15000)]));
  await until(() => h.drafts.length === 1);
  expect(h.drafts[0]!.folder).toBe("src");
});

test("a folder whose draft couldn't be made waits RETRY_MS for that session, with the folders inside and above it, a restart included, then is tried again", async () => {
  let clock = Date.now();
  const h = await harness({ now: () => clock });
  h.expertCreationSuggestions.take(0, dismissals());
  h.state.draft = null;
  h.expertCreationSuggestions.seen(h.seen([area("src/parser", 35000)]));
  await until(() => h.logs.some((l) => l.includes("no usable draft came")));
  // The hold is on disk before the runner stops.
  await until(() => (savedFile(h.isoplanDir) as { held?: unknown[] } | null)?.held?.length === 1);
  h.expertCreationSuggestions.close();
  const again = await harness({ now: () => clock }, h.root);
  again.expertCreationSuggestions.take(0, dismissals());
  again.expertCreationSuggestions.seen(again.seen([area("src/parser", 35000), area("src", 40000)]));
  await sleep(30);
  expect(again.drafts).toHaveLength(0);
  clock += RETRY_MS;
  again.expertCreationSuggestions.seen(again.seen([area("src/parser", 35000)]));
  await until(() => again.sentExpertCreationSuggestions().length === 1);
  expect(again.drafts).toHaveLength(1);
});

test("the session's hooks module is told of an open suggestion in each office, again when it connects, and when it ends; made in one office, it is withdrawn from the other, and the session told the expert is ready", async () => {
  const h = await harness();
  for (const index of [0, 1]) h.expertCreationSuggestions.take(index, dismissals());
  h.expertCreationSuggestions.seen(h.seen([area("src/parser", 35000)]));
  h.expertCreationSuggestions.seen(h.seen([area("src/parser", 35000)], { server: B }));
  await until(() => h.lines.length === 2);
  const id = (h.sentExpertCreationSuggestions()[0]!.message as { id: string }).id;
  const line = (server: string, label: string) => ({ type: "expert-creation-suggestion", server, label, id, key: "parser", name: "Parser Expert", folder: "src/parser", url: reviewUrl(server, id), why: { share: 0.175, tokens: 35000, minutes: 0, corrections: 0 } });
  expect(h.lines.map((l) => l.line)).toEqual([line(A, "dev"), line(B, "team")]);
  const file = path.join(h.isoplanDir, "expert-creation-suggestions", "s1.json");
  await until(() => fs.existsSync(file) && JSON.parse(fs.readFileSync(file, "utf8")).expertCreationSuggestions.length === 2);

  h.lines.length = 0;
  h.expertCreationSuggestions.rehooked("s1");
  expect(h.lines.map((l) => l.line)).toEqual([line(A, "dev"), line(B, "team")]);

  // Made in A while no hooks module is connected: the ready note waits for the next.
  h.lines.length = 0;
  h.hooked.delete("s1");
  h.expertCreationSuggestions.take(0, { type: "expert-creation-suggestion-ended", v: PROTOCOL_VERSION, id, why: "made", key: "parser-rules" });
  expect(h.sent.at(-1)).toEqual({ server: B, message: { type: "expert-creation-suggestion-ended", v: PROTOCOL_VERSION, id, why: "withdrawn" } });
  await until(() => !fs.existsSync(file));
  h.hooked.add("s1");
  h.expertCreationSuggestions.rehooked("s1");
  h.expertCreationSuggestions.rehooked("s1");
  expect(h.lines.map((l) => l.line)).toEqual([{ type: "expert-ready", server: A, id, key: "parser-rules", name: "Parser Rules Expert", folder: "src/parser" }]);
});

test("a suggestion dismissed or expired in an office says so to the session's hooks module", async () => {
  const h = await harness();
  h.expertCreationSuggestions.take(0, dismissals());
  h.expertCreationSuggestions.seen(h.seen([area("src/parser", 35000)]));
  await until(() => h.lines.length === 1);
  const id = (h.sentExpertCreationSuggestions()[0]!.message as { id: string }).id;
  h.expertCreationSuggestions.take(0, { type: "expert-creation-suggestion-ended", v: PROTOCOL_VERSION, id, why: "dismissed" });
  expect(h.lines.at(-1)!.line).toEqual({ type: "expert-creation-suggestion-ended", server: A, id, why: "dismissed" });
});

test("a suggestion dismissed in one office is withdrawn from the others", async () => {
  const h = await harness();
  for (const index of [0, 1]) h.expertCreationSuggestions.take(index, dismissals());
  h.expertCreationSuggestions.seen(h.seen([area("src/parser", 35000)]));
  h.expertCreationSuggestions.seen(h.seen([area("src/parser", 35000)], { server: B }));
  await until(() => h.lines.length === 2);
  const id = idOf(h.sentExpertCreationSuggestions()[0]!);
  h.expertCreationSuggestions.take(0, { type: "expert-creation-suggestion-ended", v: PROTOCOL_VERSION, id, why: "dismissed" });
  expect(h.sent.at(-1)).toEqual({ server: B, message: { type: "expert-creation-suggestion-ended", v: PROTOCOL_VERSION, id, why: "withdrawn" } });
  expect(h.lines.at(-1)!.line).toEqual({ type: "expert-creation-suggestion-ended", server: B, id, why: "withdrawn" });
});

test("a suggestion an office refused ends there alone: the session hears it ended there, not that it was dismissed, and it stays open in the others", async () => {
  const h = await harness();
  for (const index of [0, 1]) h.expertCreationSuggestions.take(index, dismissals());
  h.expertCreationSuggestions.seen(h.seen([area("src/parser", 35000)]));
  h.expertCreationSuggestions.seen(h.seen([area("src/parser", 35000)], { server: B }));
  await until(() => h.lines.length === 2);
  const id = idOf(h.sentExpertCreationSuggestions()[0]!);
  const sent = h.sent.length;
  h.expertCreationSuggestions.take(0, { type: "expert-creation-suggestion-ended", v: PROTOCOL_VERSION, id, why: "refused" });
  expect(h.lines.at(-1)!.line).toEqual({ type: "expert-creation-suggestion-ended", server: A, id, why: "refused" });
  expect(h.sent.slice(sent)).toEqual([]);
  await until(() => JSON.stringify(sessionFile(h.isoplanDir, "s1")?.expertCreationSuggestions.map((x) => x.server)) === JSON.stringify([B]));
});

test("an expert-creation-suggestions.json that can't be read is said, and moved aside rather than overwritten; runner.json that can't be read as the expert creation suggestions start, or for a correction check, is said and tried again on the next pass", async () => {
  const root = tempRoot();
  const file = path.join(root, "isoplan", "runner", "expert-creation-suggestions.json");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, "{ not json");
  let broken = true;
  const asked: string[] = [];
  const h = await harness(
    {
      settings: async () => (broken ? Promise.reject(new Error("runner.json: bad")) : { expertCreationSuggestions: CHECKING }),
      corrects: async (text) => (asked.push(text), true),
    },
    root,
  );
  const aside = fs.readdirSync(path.dirname(file)).filter((f) => f.startsWith("expert-creation-suggestions.json.unreadable-"));
  expect(aside).toHaveLength(1);
  expect(fs.readFileSync(path.join(path.dirname(file), aside[0]!), "utf8")).toBe("{ not json");
  expect(h.logs.some((l) => l.startsWith("EXPERT CREATION SUGGESTIONS:") && l.includes("moved to"))).toBe(true);
  expect(h.logs.some((l) => l.includes("couldn't read runner.json's expertCreationSuggestions"))).toBe(true);

  h.expertCreationSuggestions.take(0, dismissals());
  h.expertCreationSuggestions.seen(h.seen([area("src", 10)]));
  expect(h.expertCreationSuggestions.corrected("s1", "k1", "no, the other file", null)).toBe(null);
  await until(() => h.logs.some((l) => l.includes("couldn't check whether a message corrected the agent")));
  broken = false;
  h.expertCreationSuggestions.seen(h.seen([area("src/parser", 35000)]));
  await until(() => h.sentExpertCreationSuggestions().length === 1);
  expect(h.expertCreationSuggestions.corrected("s1", "k1", "no, the other file", null)).toBe(null);
  await until(() => asked.length === 1);
  expect(h.expertCreationSuggestions.corrected("s1", "k1", "", null)).toBe(true);
});

test("a suggestion the office ends at once is never shown in the session: dismissed there, or made where another computer's expert covers its folder, which the session hears of as ready; one sent on a connection that closed first goes again on the next", async () => {
  const h = await harness({ keptMs: 300 });
  h.hooked.add("s2");
  h.expertCreationSuggestions.take(0, dismissals());
  h.expertCreationSuggestions.seen(h.seen([area("src/parser", 35000)]));
  await until(() => h.sentExpertCreationSuggestions().length === 1);
  h.expertCreationSuggestions.take(0, { type: "expert-creation-suggestion-ended", v: PROTOCOL_VERSION, id: idOf(h.sentExpertCreationSuggestions()[0]!), why: "dismissed" });
  h.expertCreationSuggestions.seen(h.seen([area("src", 40000)], { session: "claude-code:s2", bare: "s2" }));
  await until(() => h.sentExpertCreationSuggestions().length === 2);
  const covered = idOf(h.sentExpertCreationSuggestions()[1]!);
  h.expertCreationSuggestions.take(0, { type: "expert-creation-suggestion-ended", v: PROTOCOL_VERSION, id: covered, why: "made", key: "app-src" });
  await sleep(400);
  expect(h.lines.map((l) => l.line)).toEqual([{ type: "expert-ready", server: A, id: covered, key: "app-src", name: "App Src Expert", folder: "src" }]);
  expect(["s1", "s2"].map((bare) => fs.existsSync(path.join(h.isoplanDir, "expert-creation-suggestions", `${bare}.json`)))).toEqual([false, false]);

  h.expertCreationSuggestions.seen(h.seen([area("src/parser", 35000)], { session: "claude-code:s3", bare: "s3" }));
  await until(() => h.sentExpertCreationSuggestions().length === 3);
  h.expertCreationSuggestions.linked(0);
  h.expertCreationSuggestions.take(0, dismissals());
  await until(() => h.sentExpertCreationSuggestions().length === 4);
  expect(idOf(h.sentExpertCreationSuggestions()[3]!)).toBe(idOf(h.sentExpertCreationSuggestions()[2]!));
});

test("each suggestion open in an office goes again on each new connection there, once its dismissals came, so an end that was lost comes again; it stays open meanwhile", async () => {
  const h = await harness();
  h.expertCreationSuggestions.take(0, dismissals());
  h.expertCreationSuggestions.seen(h.seen([area("src/parser", 35000)]));
  await until(() => h.lines.length === 1);
  const id = idOf(h.sentExpertCreationSuggestions()[0]!);
  h.expertCreationSuggestions.linked(0);
  await sleep(30);
  expect(h.sentExpertCreationSuggestions()).toHaveLength(1);
  h.expertCreationSuggestions.take(0, dismissals());
  expect(h.sentExpertCreationSuggestions().map(idOf)).toEqual([id, id]);
  // Once a connection, however often its dismissals come.
  h.expertCreationSuggestions.take(0, dismissals());
  expect(h.sentExpertCreationSuggestions()).toHaveLength(2);
  await sleep(50);
  expect(h.lines).toHaveLength(1);
  expect(JSON.parse(fs.readFileSync(path.join(h.isoplanDir, "expert-creation-suggestions", "s1.json"), "utf8")).expertCreationSuggestions.map((x: { id: string }) => x.id)).toEqual([id]);
  // An office with no record of it from this runner refuses it, and the session hears it ended.
  h.expertCreationSuggestions.take(0, { type: "expert-creation-suggestion-ended", v: PROTOCOL_VERSION, id, why: "refused" });
  expect(h.lines.at(-1)!.line).toEqual({ type: "expert-creation-suggestion-ended", server: A, id, why: "refused" });
});

test("the folder of a suggestion every office it went to refused may be suggested to its session again RETRY_MS after the last refusal, a restart included", async () => {
  let clock = Date.now();
  const h = await harness({ now: () => clock });
  for (const index of [0, 1]) h.expertCreationSuggestions.take(index, dismissals());
  h.expertCreationSuggestions.seen(h.seen([area("src/parser", 35000)]));
  h.expertCreationSuggestions.seen(h.seen([area("src/parser", 35000)], { server: B }));
  await until(() => h.sentExpertCreationSuggestions().length === 2);
  const id = idOf(h.sentExpertCreationSuggestions()[0]!);
  h.expertCreationSuggestions.take(0, { type: "expert-creation-suggestion-ended", v: PROTOCOL_VERSION, id, why: "refused" });
  clock += RETRY_MS;
  // Still open in B, so not suggested again.
  h.expertCreationSuggestions.seen(h.seen([area("src/parser", 35000)]));
  await sleep(30);
  expect(h.drafts).toHaveLength(1);
  h.expertCreationSuggestions.take(1, { type: "expert-creation-suggestion-ended", v: PROTOCOL_VERSION, id, why: "refused" });
  // The last refusal's time is on disk before the runner stops.
  await until(() => typeof (savedFile(h.isoplanDir) as { expertCreationSuggestions?: { refusedAt?: number }[] } | null)?.expertCreationSuggestions?.[0]?.refusedAt === "number");
  h.expertCreationSuggestions.close();
  const again = await harness({ now: () => clock }, h.root);
  again.expertCreationSuggestions.take(0, dismissals());
  again.expertCreationSuggestions.seen(again.seen([area("src/parser", 35000)]));
  await sleep(30);
  expect(again.drafts).toHaveLength(0);
  clock += RETRY_MS;
  again.expertCreationSuggestions.seen(again.seen([area("src/parser", 35000)]));
  await until(() => again.sentExpertCreationSuggestions().length === 1);
  expect(idOf(again.sentExpertCreationSuggestions()[0]!)).not.toBe(id);
});

const draftOfficeWideExpertCreationSuggestion = (request: string, folder: string, sessions: string[]): DraftOfficeWideExpertCreationSuggestionMessage => ({ type: "draft-office-wide-expert-creation-suggestion", v: PROTOCOL_VERSION, request, project: PROJECT, folder, sessions, searchedBySessions: 3, searchWindowDays: 14 });

test("draft-office-wide-expert-creation-suggestion: an office-wide suggestion is drafted from the newest of its sessions this runner reported to that office, once however often it is asked, and goes to that office alone, with the request's id; one with no draft is answered no-draft", async () => {
  const h = await harness();
  // Seen before the dismissals, so it isn't suggested on its own.
  h.expertCreationSuggestions.seen(h.seen([area("src/parser", 35000, { searches: 4 })]));
  h.expertCreationSuggestions.take(0, dismissals());
  h.expertCreationSuggestions.take(1, dismissals());
  h.expertCreationSuggestions.take(0, draftOfficeWideExpertCreationSuggestion("office-1", "src/parser", ["claude-code:s9", "claude-code:s1"]));
  h.expertCreationSuggestions.take(0, draftOfficeWideExpertCreationSuggestion("office-1", "src/parser", ["claude-code:s9", "claude-code:s1"]));
  expect(h.expertCreationSuggestions.idle()).toBe(false);
  await until(() => h.sentExpertCreationSuggestions().length === 1);
  expect(h.sentExpertCreationSuggestions()[0]).toMatchObject({ server: A, message: { id: "office-1", scope: "office", session: "claude-code:s9", folder: "src/parser", why: { share: 0.175, tokens: 35000, minutes: 0, corrections: 0 } } });
  expect(h.drafts[0]!.said).toEqual(["Asked: how does the parser work?"]);
  await sleep(30);
  expect([h.drafts.length, h.sentExpertCreationSuggestions().length]).toEqual([1, 1]);

  h.state.draft = null;
  h.expertCreationSuggestions.take(1, draftOfficeWideExpertCreationSuggestion("office-2", "docs", ["claude-code:s1"]));
  await until(() => h.sent.some((s) => s.message.type === "expert-creation-suggestion-ended"));
  expect(h.sent.at(-1)).toEqual({ server: B, message: { type: "expert-creation-suggestion-ended", v: PROTOCOL_VERSION, id: "office-2", why: "no-draft" } });
});

test("draft-office-wide-expert-creation-suggestion: its session's line, and its file, say how many sessions searched the folder and over how many days, a restart included", async () => {
  const h = await harness();
  h.expertCreationSuggestions.take(0, dismissals());
  h.expertCreationSuggestions.take(0, draftOfficeWideExpertCreationSuggestion("office-4", "src/parser", ["claude-code:s1"]));
  await until(() => h.lines.length === 1);
  const reason = { searchedBySessions: 3, searchWindowDays: 14 };
  expect(h.lines[0]!.line).toMatchObject({ type: "expert-creation-suggestion", id: "office-4", officeWideReason: reason });
  await until(() => sessionFile(h.isoplanDir, "s1") !== null);
  expect(sessionFile(h.isoplanDir, "s1")!.expertCreationSuggestions[0]!.officeWideReason).toEqual(reason);
  await sleep(30);
  const again = await harness({}, h.root);
  again.expertCreationSuggestions.rehooked("s1");
  await until(() => again.lines.length === 1);
  expect(again.lines[0]!.line).toMatchObject({ id: "office-4", officeWideReason: reason });
});

test("draft-office-wide-expert-creation-suggestion: a draft that throws is answered no-draft at once, saying why", async () => {
  const h = await harness({ draft: async () => Promise.reject(new Error("claude -p exited with code 1")) });
  h.expertCreationSuggestions.take(0, dismissals());
  h.expertCreationSuggestions.take(0, draftOfficeWideExpertCreationSuggestion("office-3", "src/parser", ["claude-code:s1"]));
  await until(() => h.sent.some((s) => s.message.type === "expert-creation-suggestion-ended"));
  expect(h.sent.at(-1)).toEqual({ server: A, message: { type: "expert-creation-suggestion-ended", v: PROTOCOL_VERSION, id: "office-3", why: "no-draft" } });
  expect(h.logs.some((l) => l.includes("drafting it failed: claude -p exited with code 1"))).toBe(true);
});

const createExpertFromSuggestion = (request: string, more: Partial<CreateExpertFromSuggestionMessage> = {}): CreateExpertFromSuggestionMessage => ({ type: "create-expert-from-suggestion", v: PROTOCOL_VERSION, request, expertCreationSuggestionId: "o1", key: "parser", subject: DRAFT.subject, model: "sonnet", project: PROJECT, area: ["src/parser"], proof: DRAFT.proof, by: { id: "claude:ada", name: "Ada" }, ...more });
const expertCreationProgress = (h: Awaited<ReturnType<typeof harness>>, request: string) => h.sent.filter((s) => s.message.type === "expert-creation-progress" && s.message.request === request).map((s) => (s.message as { state: string; detail?: string }).detail ?? (s.message as { state: string }).state);

test("create-expert-from-suggestion: only for this runner's person and a key not used here; each failing at once, saying why", async () => {
  const h = await harness();
  h.expertCreationSuggestions.take(0, dismissals());
  h.expertCreationSuggestions.take(0, createExpertFromSuggestion("m1", { expertCreationSuggestionId: "o1", by: { id: "claude:bob", name: "Bob" } }));
  h.state.experts = [{ name: "parser", repo: "/work/app", subject: "x", state: "ready", senior: false }];
  h.expertCreationSuggestions.take(0, createExpertFromSuggestion("m2", { expertCreationSuggestionId: "o2" }));
  await until(() => ["m1", "m2"].every((m) => expertCreationProgress(h, m).length === 1));
  expect(["m1", "m2"].map((m) => expertCreationProgress(h, m)[0])).toEqual(["this computer's runner is someone else's, so it makes experts only for them", "an expert named parser is already on this computer"]);
  expect(fs.existsSync(path.join(h.isoplanDir, "experts", "parser.json"))).toBe(false);
});

test("create-expert-from-suggestion: with no checkout here, the repo is cloned for the expert alone into Isoplan's own hidden folder, saying cloning, and the expert file names that clone; over ssh when https fails; no remote, or a clone git refuses both ways, fails the creation with git's reasons", async () => {
  const h = await harness();
  h.expertCreationSuggestions.take(0, dismissals());
  h.state.checkout = null;
  h.expertCreationSuggestions.take(0, createExpertFromSuggestion("m1"));
  await until(() => expertCreationProgress(h, "m1").length === 1 && fs.existsSync(path.join(h.isoplanDir, "experts", "parser.json")));
  expect(expertCreationProgress(h, "m1")).toEqual(["cloning"]);
  expect(h.clones).toEqual([{ url: "https://github.com/team/app.git", project: PROJECT.id }]);
  expect(JSON.parse(fs.readFileSync(path.join(h.isoplanDir, "experts", "parser.json"), "utf8")).repo).toBe(path.join(h.root, "clones", "app"));

  h.state.clone = { problem: "Isoplan's own copy of this repo couldn't be made on this computer, so nothing was started.", reason: "git failed: fatal: repository not found" };
  h.expertCreationSuggestions.take(0, createExpertFromSuggestion("m2", { expertCreationSuggestionId: "o2", key: "lexer" }));
  h.expertCreationSuggestions.take(0, createExpertFromSuggestion("m3", { expertCreationSuggestionId: "o3", key: "local", project: { id: "local:box/c:/work/app", name: "app" } }));
  await until(() => expertCreationProgress(h, "m2").length === 2 && expertCreationProgress(h, "m3").length === 1);
  expect([expertCreationProgress(h, "m2"), expertCreationProgress(h, "m3")]).toEqual([
    ["cloning", "this computer has no checkout of app, and Isoplan's own copy of it couldn't be made: from https://github.com/team/app.git, git failed: fatal: repository not found; from git@github.com:team/app.git, git failed: fatal: repository not found"],
    ["this computer has no checkout of app, and its repo has no remote to clone it from"],
  ]);
  expect(cloneUrls("local:box/c:/work/app")).toEqual([]);

  const ssh = path.join(h.root, "clones", "app-ssh");
  h.state.clone = (url) => (url.startsWith("git@") ? ssh : { problem: "no", reason: "git failed: could not read Username" });
  h.clones.length = 0;
  h.expertCreationSuggestions.take(0, createExpertFromSuggestion("m4", { expertCreationSuggestionId: "o4", key: "tokens" }));
  await until(() => fs.existsSync(path.join(h.isoplanDir, "experts", "tokens.json")));
  expect(h.clones.map((c) => c.url)).toEqual(["https://github.com/team/app.git", "git@github.com:team/app.git"]);
  expect(JSON.parse(fs.readFileSync(path.join(h.isoplanDir, "experts", "tokens.json"), "utf8")).repo).toBe(ssh);
});

test("create-expert-from-suggestion: the expert file is written whole, and its creation is followed from its state: cloning, grounding, proof, ready; a reconnect holds the next state until the new connection's dismissals", async () => {
  const h = await harness();
  h.expertCreationSuggestions.take(0, dismissals());
  h.expertCreationSuggestions.take(0, createExpertFromSuggestion("m1"));
  const file = path.join(h.isoplanDir, "experts", "parser.json");
  await until(() => expertCreationProgress(h, "m1").length === 1);
  const parsed = parseExpertFile(fs.readFileSync(file, "utf8"), file);
  expect(parsed).toMatchObject({ ok: true, unknown: [], expert: { name: "parser", repo: h.checkout, subject: DRAFT.subject, model: "sonnet", promoteAtTokens: SETTINGS.promoteAtTokens, proof: DRAFT.proof, areas: ["src/parser"] } });
  expect(fs.readdirSync(path.dirname(file))).toEqual(["parser.json"]);
  const stateFile = path.join(h.isoplanDir, "experts", "parser", "state.json");
  fs.mkdirSync(path.dirname(stateFile), { recursive: true });
  // A folder an earlier expert of that name left: its junior was grounded before this creation began.
  const old = { n: 1, trunk: "t1", model: "claude-sonnet-5-5", commit: "b".repeat(40), groundedAt: 1, meter: 0, notes: 0, state: "junior" };
  const generation = (more: Record<string, unknown>) => fs.writeFileSync(stateFile, JSON.stringify({ version: 1, fingerprint: "f", repo: h.checkout, branch: "main", generations: [old, { n: 2, trunk: "t2", model: "claude-sonnet-5-5", commit: "", groundedAt: Date.now(), meter: 0, notes: 0, state: "grounding", ...more }] }));
  generation({});
  await until(() => expertCreationProgress(h, "m1").length === 2);
  h.expertCreationSuggestions.linked(0);
  generation({ commit: "a".repeat(40) });
  await new Promise((r) => setTimeout(r, 50));
  expect(expertCreationProgress(h, "m1")).toEqual(["cloning", "grounding"]);
  h.expertCreationSuggestions.take(0, dismissals());
  await until(() => expertCreationProgress(h, "m1").length === 3);
  generation({ commit: "a".repeat(40), state: "junior", proof: { passed: true, at: 2 } });
  await until(() => expertCreationProgress(h, "m1").length === 4);
  expect(expertCreationProgress(h, "m1")).toEqual(["cloning", "grounding", "proof", "ready"]);
  expect(h.expertCreationSuggestions.idle()).toBe(true);
});

test("create-expert-from-suggestion: a generation that failed its proof fails the creation, saying so", async () => {
  const h = await harness();
  h.expertCreationSuggestions.take(0, dismissals());
  h.expertCreationSuggestions.take(0, createExpertFromSuggestion("m1"));
  await until(() => expertCreationProgress(h, "m1").length === 1);
  const stateFile = path.join(h.isoplanDir, "experts", "parser", "state.json");
  fs.mkdirSync(path.dirname(stateFile), { recursive: true });
  fs.writeFileSync(stateFile, JSON.stringify({ version: 1, fingerprint: "f", repo: h.checkout, branch: "main", generations: [{ n: 1, trunk: "t1", model: "m", commit: "a".repeat(40), groundedAt: Date.now(), meter: 0, notes: 0, state: "failed", proof: { passed: false, at: 2 } }] }));
  await until(() => expertCreationProgress(h, "m1").length === 2);
  expect(h.sent.at(-1)!.message).toEqual({ type: "expert-creation-progress", v: PROTOCOL_VERSION, request: "m1", expertCreationSuggestionId: "o1", state: "failed", detail: "its answer to the proof question didn't match the answer expected" });
});

test("create-expert-from-suggestion: a creation that fails removes the expert file it wrote, so this computer stops hosting it; the same suggestion and key asked again starts fresh once that expert has stopped", async () => {
  const h = await harness();
  h.expertCreationSuggestions.take(0, dismissals());
  h.expertCreationSuggestions.take(0, createExpertFromSuggestion("m1"));
  const file = path.join(h.isoplanDir, "experts", "parser.json");
  await until(() => expertCreationProgress(h, "m1").length === 1);
  h.state.experts = [{ name: "parser", repo: h.checkout, subject: DRAFT.subject, state: "starting", senior: false }];
  const stateFile = path.join(h.isoplanDir, "experts", "parser", "state.json");
  fs.mkdirSync(path.dirname(stateFile), { recursive: true });
  fs.writeFileSync(stateFile, JSON.stringify({ version: 1, fingerprint: "f", repo: h.checkout, branch: "main", generations: [{ n: 1, trunk: "t1", model: "m", commit: "", groundedAt: Date.now(), meter: 0, notes: 0, state: "failed" }] }));
  await until(() => expertCreationProgress(h, "m1").length === 2 && !fs.existsSync(file));
  expect(expertCreationProgress(h, "m1")[1]).toBe("its grounding failed; its health log on that computer says why");

  // Asked again while the watcher still hosts the failed expert: it waits for it to stop.
  h.expertCreationSuggestions.take(0, createExpertFromSuggestion("m2"));
  await sleep(50);
  expect(fs.existsSync(file)).toBe(false);
  h.state.experts = [];
  await until(() => expertCreationProgress(h, "m2").length === 1 && fs.existsSync(file));
  expect(expertCreationProgress(h, "m2")).toEqual(["cloning"]);
});

test("create-expert-from-suggestion: a creation's last state stays in expert-creation-suggestions.json for rememberDays, going again from a runner started again and on each new connection; the same suggestion and key asked again once it is ready answers ready", async () => {
  let clock = Date.now();
  const h = await harness({ now: () => clock });
  h.expertCreationSuggestions.take(0, dismissals());
  h.expertCreationSuggestions.take(0, createExpertFromSuggestion("m1"));
  await until(() => expertCreationProgress(h, "m1").length === 1 && savedFile(h.isoplanDir)?.expertCreations.length === 1);
  h.up[0] = false;
  const stateFile = path.join(h.isoplanDir, "experts", "parser", "state.json");
  fs.mkdirSync(path.dirname(stateFile), { recursive: true });
  fs.writeFileSync(stateFile, JSON.stringify({ version: 1, fingerprint: "f", repo: h.checkout, branch: "main", generations: [{ n: 1, trunk: "t1", model: "m", commit: "a".repeat(40), groundedAt: Date.now(), meter: 0, notes: 0, state: "junior" }] }));
  await until(() => (savedFile(h.isoplanDir)?.expertCreations[0] as { state?: string } | undefined)?.state === "ready");
  h.expertCreationSuggestions.close();
  const again = await harness({ now: () => clock }, h.root);
  again.expertCreationSuggestions.take(0, dismissals());
  await until(() => expertCreationProgress(again, "m1").length === 1);
  expect(expertCreationProgress(again, "m1")).toEqual(["ready"]);
  // That ready may be lost with its connection too: it goes again on the next.
  again.expertCreationSuggestions.linked(0);
  again.expertCreationSuggestions.take(0, dismissals());
  await until(() => expertCreationProgress(again, "m1").length === 2);
  // The maker asks again: ready, not a key already used here.
  again.expertCreationSuggestions.take(0, createExpertFromSuggestion("m2"));
  await until(() => expertCreationProgress(again, "m2").length === 1);
  expect(expertCreationProgress(again, "m2")).toEqual(["ready"]);
  expect(savedFile(again.isoplanDir)?.expertCreations).toHaveLength(1);
  clock += SETTINGS.rememberDays * 86400000;
  again.expertCreationSuggestions.seen(again.seen([area("docs", 10)]));
  await until(() => savedFile(again.isoplanDir)?.expertCreations.length === 0);
});

test("create-expert-from-suggestion: a creation that fails before writing its file, a throw included, fails with the reason and stays in expert-creation-suggestions.json; a runner started again sends it and leaves alone the file of the expert it found", async () => {
  const h = await harness({ clone: async () => Promise.reject(new Error("spawn git ENOENT")) });
  h.expertCreationSuggestions.take(0, dismissals());
  h.up[0] = false;
  h.state.checkout = null;
  h.expertCreationSuggestions.take(0, createExpertFromSuggestion("m1", { expertCreationSuggestionId: "o1", key: "lexer" }));
  const file = path.join(h.isoplanDir, "experts", "parser.json");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, "{}");
  h.expertCreationSuggestions.take(0, createExpertFromSuggestion("m2", { expertCreationSuggestionId: "o2" }));
  const states = (dir: string) => (savedFile(dir)?.expertCreations as { state?: string }[] | undefined)?.map((k) => k.state);
  await until(() => JSON.stringify(states(h.isoplanDir)) === JSON.stringify(["failed", "failed"]));
  expect(h.expertCreationSuggestions.idle()).toBe(true);
  h.expertCreationSuggestions.close();
  const again = await harness({}, h.root);
  again.expertCreationSuggestions.take(0, dismissals());
  await until(() => expertCreationProgress(again, "m1").length === 1 && expertCreationProgress(again, "m2").length === 1);
  expect([expertCreationProgress(again, "m1"), expertCreationProgress(again, "m2")]).toEqual([["creating it stopped on that computer: spawn git ENOENT"], ["an expert named parser is already on this computer"]]);
  await sleep(30);
  expect(states(again.isoplanDir)).toEqual(["failed", "failed"]);
  expect(fs.readFileSync(file, "utf8")).toBe("{}");
});

test("create-expert-from-suggestion: a look at how the creation goes that fails is said once and tried again on the next, and fails the creation only past its limit, saying why", async () => {
  let clock = Date.now();
  let broken = false;
  const h = await harness({ now: () => clock, experts: () => (broken ? (() => { throw new Error("the hosted list broke"); })() : []) });
  h.expertCreationSuggestions.take(0, dismissals());
  h.expertCreationSuggestions.take(0, createExpertFromSuggestion("m1"));
  await until(() => expertCreationProgress(h, "m1").length === 1);
  broken = true;
  await until(() => h.logs.some((l) => l.includes("the hosted list broke")));
  await sleep(50);
  expect(h.logs.filter((l) => l.includes("the hosted list broke"))).toHaveLength(1);
  expect(h.expertCreationSuggestions.idle()).toBe(false);
  broken = false;
  const stateFile = path.join(h.isoplanDir, "experts", "parser", "state.json");
  fs.mkdirSync(path.dirname(stateFile), { recursive: true });
  fs.writeFileSync(stateFile, JSON.stringify({ version: 1, fingerprint: "f", repo: h.checkout, branch: "main", generations: [{ n: 1, trunk: "t1", model: "m", commit: "a".repeat(40), groundedAt: clock, meter: 0, notes: 0, state: "junior" }] }));
  await until(() => expertCreationProgress(h, "m1").length === 2);
  expect(expertCreationProgress(h, "m1")).toEqual(["cloning", "ready"]);

  h.expertCreationSuggestions.take(0, createExpertFromSuggestion("m2", { expertCreationSuggestionId: "o2", key: "lexer" }));
  await until(() => expertCreationProgress(h, "m2").length === 1);
  broken = true;
  await until(() => h.logs.some((l) => l.includes("expert lexer") && l.includes("the hosted list broke")));
  clock += EXPERT_CREATION_LIMIT_MS + 1;
  await until(() => expertCreationProgress(h, "m2").length === 2);
  expect(expertCreationProgress(h, "m2")[1]).toBe("it wasn't ready within 60 minutes; the last look at it failed: the hosted list broke");
});

test("create-expert-from-suggestion: a runner started again goes on following the creation it had under way, on its request; the same suggestion and key asked again takes that creation over", async () => {
  const h = await harness();
  h.expertCreationSuggestions.take(0, dismissals());
  h.expertCreationSuggestions.take(0, createExpertFromSuggestion("m1"));
  // Stopped once it has saved that it wrote its expert file.
  await until(() => expertCreationProgress(h, "m1").length === 1 && (savedFile(h.isoplanDir)?.expertCreations[0] as { wrote?: boolean } | undefined)?.wrote === true);
  h.expertCreationSuggestions.close();
  const again = await harness({}, h.root);
  again.expertCreationSuggestions.take(0, dismissals());
  await until(() => expertCreationProgress(again, "m1").length === 1);
  const stateFile = path.join(again.isoplanDir, "experts", "parser", "state.json");
  fs.mkdirSync(path.dirname(stateFile), { recursive: true });
  const generation = (more: Record<string, unknown>) => fs.writeFileSync(stateFile, JSON.stringify({ version: 1, fingerprint: "f", repo: again.checkout, branch: "main", generations: [{ n: 1, trunk: "t1", model: "m", commit: "", groundedAt: Date.now(), meter: 0, notes: 0, state: "grounding", ...more }] }));
  generation({});
  await until(() => expertCreationProgress(again, "m1").length === 2);
  // The office asks again, as it does once a runner that went mid-creation is back.
  again.expertCreationSuggestions.take(0, createExpertFromSuggestion("m2"));
  await until(() => expertCreationProgress(again, "m2").length === 1);
  generation({ commit: "a".repeat(40), state: "junior", proof: { passed: true, at: 2 } });
  await until(() => expertCreationProgress(again, "m2").length === 2);
  expect([expertCreationProgress(again, "m1"), expertCreationProgress(again, "m2")]).toEqual([["cloning", "grounding"], ["grounding", "ready"]]);
  await until(() => JSON.stringify(savedFile(again.isoplanDir)?.expertCreations.map((k) => [(k as { request: string }).request, (k as { state?: string }).state])) === JSON.stringify([["m2", "ready"]]));
});

test("corrected: unknown until the local model has said, one check at a time and at most checksPerHour; its word is kept", async () => {
  const asked: string[] = [];
  let answer: (v: boolean) => void = () => {};
  const h = await harness({
    settings: async () => ({ expertCreationSuggestions: { ...CHECKING, checksPerHour: 2 } }),
    corrects: (text) => (asked.push(text), new Promise((r) => (answer = r))),
  });
  h.expertCreationSuggestions.take(0, dismissals());
  h.expertCreationSuggestions.seen(h.seen([area("src", 10)]));
  expect(h.expertCreationSuggestions.corrected("s1", "k1", "no, the other file", "Here it is.")).toBe(null);
  expect(h.expertCreationSuggestions.corrected("s1", "k2", "wrong again", null)).toBe(null);
  expect(h.expertCreationSuggestions.corrected("s1", "k3", "and again", null)).toBe(null);
  await until(() => asked.length === 1);
  expect(h.expertCreationSuggestions.idle()).toBe(false);
  answer(true);
  await until(() => asked.length === 2);
  answer(false);
  await new Promise((r) => setTimeout(r, 30));
  expect(asked).toEqual(["no, the other file", "wrong again"]);
  expect([h.expertCreationSuggestions.corrected("s1", "k1", "", null), h.expertCreationSuggestions.corrected("s1", "k2", "", null), h.expertCreationSuggestions.corrected("s1", "k3", "", null)]).toEqual([true, false, null]);
});

test("corrected: no check runs for a session whose latest pass went to no office that has said its dismissals on its connection now, as one from before expert creation suggestions never does", async () => {
  const asked: string[] = [];
  const h = await harness({ settings: async () => ({ expertCreationSuggestions: CHECKING }), corrects: async (text) => (asked.push(text), true) });
  h.expertCreationSuggestions.seen(h.seen([area("src", 10)]));
  expect(h.expertCreationSuggestions.corrected("s1", "k1", "no, the other file", null)).toBe(null);
  h.expertCreationSuggestions.take(0, dismissals());
  // Never reported to an office here.
  expect(h.expertCreationSuggestions.corrected("s9", "k2", "wrong again", null)).toBe(null);
  await sleep(30);
  expect(asked).toEqual([]);
  expect(h.expertCreationSuggestions.corrected("s1", "k1", "no, the other file", null)).toBe(null);
  await until(() => asked.length === 1);
  // A new connection, its dismissals still to come.
  h.expertCreationSuggestions.linked(0);
  expect(h.expertCreationSuggestions.corrected("s1", "k3", "and again", null)).toBe(null);
  await sleep(30);
  expect(asked).toEqual(["no, the other file"]);
});

test("corrected: the correction check is off unless runner.json turns it on: no message is checked, and none counts", async () => {
  const asked: string[] = [];
  expect(SETTINGS.correctionCheck).toBe(false);
  const h = await harness({ corrects: async (text) => (asked.push(text), true) });
  h.expertCreationSuggestions.take(0, dismissals());
  h.expertCreationSuggestions.seen(h.seen([area("src", 10)]));
  expect(h.expertCreationSuggestions.corrected("s1", "k1", "no, the other file", null)).toBe(null);
  await sleep(30);
  expect(h.expertCreationSuggestions.corrected("s1", "k1", "no, the other file", null)).toBe(null);
  await sleep(30);
  expect(asked).toEqual([]);
});

test("corrected: with the check on, its word is kept in expert-creation-suggestions.json, so a runner started again never checks that message again", async () => {
  const asked: string[] = [];
  const opts: Partial<ExpertCreationSuggestionsOptions> = { settings: async () => ({ expertCreationSuggestions: CHECKING }), corrects: async (text) => (asked.push(text), true) };
  const h = await harness(opts);
  h.expertCreationSuggestions.take(0, dismissals());
  h.expertCreationSuggestions.seen(h.seen([area("src", 10)]));
  expect(h.expertCreationSuggestions.corrected("s1", "k1", "no, the other file", null)).toBe(null);
  await until(() => asked.length === 1 && JSON.stringify((savedFile(h.isoplanDir) as { verdicts?: unknown } | null)?.verdicts) === JSON.stringify([["k1", true]]));
  h.expertCreationSuggestions.close();
  const again = await harness(opts, h.root);
  again.expertCreationSuggestions.take(0, dismissals());
  again.expertCreationSuggestions.seen(again.seen([area("src", 10)]));
  expect(again.expertCreationSuggestions.corrected("s1", "k1", "no, the other file", null)).toBe(true);
  await sleep(30);
  expect(asked).toHaveLength(1);
});
