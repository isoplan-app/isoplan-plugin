import fs from "node:fs";
import path from "node:path";
import { PROTOCOL_VERSION, type AreaFact, type DraftOfficeWideExpertCreationSuggestionMessage, type ExpertCreationSuggestionDismissal, type CreateExpertFromSuggestionMessage, type ExpertCreationSuggestionDismissalsMessage } from "@isoplan/protocol";
import { expect, test } from "vitest";
import type { FileReading } from "../data-layer/claude-code.js";
import { at, line as transcript, gitRepo, modDir, session, sourceIn, tempRoot } from "../data-layer/fixture.js";
import type { RunnerExpertCreationSuggestionMessage } from "../data-layer/link.js";
import type { SessionAreas } from "../data-layer/report-session.js";
import { expertCreationSuggestionTranscriptText } from "../expert-creation-suggestion/text.js";
import type { DataLayerLine, ExpertCreationSuggestionLine } from "../lines.js";
import { parseExpertFile } from "./expert-file.js";
import type { HostedExpert } from "./expert.js";
import type { Draft, DraftInput } from "./expert-creation-suggestion-model-calls.js";
import { areaTokens, cloneUrls, createExpertCreationSuggestions, EXCERPT_CHARS, EXPERT_CREATION_LIMIT_MS, folderExcerpts, folderFiles, ownSearches, passed, repeated, RETRY_MS, reviewUrl, signalsOf, type ExpertCreationSuggestionSettings, type ExpertCreationSuggestionsOptions } from "./expert-creation-suggestions.js";

const SETTINGS: ExpertCreationSuggestionSettings = JSON.parse(fs.readFileSync(path.join(modDir, "runner.json"), "utf8")).expertCreationSuggestions;
// The correction check turned on, as runner.json doesn't by default.
const CHECKING: ExpertCreationSuggestionSettings = { ...SETTINGS, correctionCheck: true };
const A = "ws://127.0.0.1:4747/data-layer";
const B = "wss://office.team.com/data-layer";
const PROJECT = { id: "github.com/team/app", name: "app" };
const OTHER = { id: "github.com/team/lib", name: "lib" };
const DRAFT: Draft = { key: "parser", subject: "How the parser reads a file. Ask before changing it.", proof: { question: "Where does parsing start?", answer: "In parse.ts." } };

const area = (folder: string, tokens: number, more: Partial<AreaFact> = {}): AreaFact => ({ folder, reads: 1, searches: 0, tokens, ms: 0, corrections: 0, ...more });
// A folder searched in itself as often as makes it pass.
const searched = (folder: string, tokens: number, more: Partial<AreaFact> = {}): AreaFact => area(folder, tokens, { searches: SETTINGS.searches, ...more });
// A file the session read in `readings` turns, its turns 1 to `readings` unless `more` says, `tokensAgain` of what its reads took being past its first.
const reading = (file: string, readings: number, tokensAgain = 0, more: Partial<FileReading> = {}): FileReading => ({ file, readings, turns: Array.from({ length: readings }, (_, i) => `0:${i + 1}`), tokens: tokensAgain + 100, tokensAgain, ...more });
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
  const seen = (areas: AreaFact[], more: Partial<SessionAreas> = {}): SessionAreas => ({ server: A, session: "claude-code:s1", bare: "s1", project: PROJECT, checkout, window: 200000, model: null, areas, said: async () => ["Asked: how does the parser work?"], readings: [], ...more });
  const sentExpertCreationSuggestions = () => sent.filter((s) => s.message.type === "expert-creation-suggestion");
  return { root, isoplanDir, checkout, expertCreationSuggestions, sent, up, lines, hooked, drafts, logs, state, clones, seen, sentExpertCreationSuggestions };
}

test("reviewUrl: the office's http address with /?expert-creation-suggestion=<id>, its data-layer path taken off", () => {
  expect(reviewUrl(A, "abc_1")).toBe("http://127.0.0.1:4747/?expert-creation-suggestion=abc_1");
  expect(reviewUrl("wss://office.team.com/team/data-layer", "x")).toBe("https://office.team.com/team/?expert-creation-suggestion=x");
});

test("signals: only what was done again passes: a file read again readAgain times, reading again that took contextShare of the window, or a folder searched searches times in itself; minutes, corrections and tokens are said only alongside", () => {
  const t = SETTINGS;
  const why = (share: number) => ({ share, tokens: 0, minutes: 0, corrections: 0 });
  expect(repeated({ readings: 4, sessions: 3, files: 1 }, why(0), t)).toBe(true);
  expect(repeated({ readings: 3, sessions: 3, files: 2 }, why(0.14), t)).toBe(false);
  expect(repeated({ readings: 2, sessions: 1, files: 1 }, why(0.15), t)).toBe(true);
  expect(repeated({ searches: 5 }, why(0), t)).toBe(true);
  expect(repeated({ searches: 4 }, why(0.9), t)).toBe(false);
  expect(signalsOf(area("src", 30000, { ms: 90000, corrections: 1 }), 200000)).toEqual({ share: 0.15, tokens: 30000, minutes: 1.5, corrections: 1 });
  expect(signalsOf(area("src", 30000), null).share).toBe(0);
  // A suggestion gives only the signals that passed: 35,000 tokens that are 3.5% of the window aren't one.
  expect(passed(signalsOf(area("src", 35000, { ms: 90000, corrections: 1 }), 1000000), t)).toEqual({ share: 0, tokens: 0, minutes: 0, corrections: 0 });
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

test("a session's deepest folder searched enough is drafted once, from its files' names and starts, and suggested to each office that takes the repo, once that office's connection has had its dismissals; never again for that session, nor inside or above it, a restart included", async () => {
  const h = await harness();
  const areas = [area("src", 40000, { searches: SETTINGS.searches }), searched("src/parser", 35000), area("docs", 100)];
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
  expect(suggestion.message).toMatchObject({ type: "expert-creation-suggestion", session: "claude-code:s1", project: PROJECT, folder: "src/parser", scope: "session", key: "parser", subject: DRAFT.subject, area: ["src/parser"], proof: DRAFT.proof, why: { share: 0, tokens: 0, minutes: 0, corrections: 0 }, repetition: { searches: SETTINGS.searches } });
  await until(() => h.lines.length > 0);
  expect(h.lines[0]!.line).toMatchObject({ folder: "src/parser", repetition: { searches: SETTINGS.searches } });
  h.expertCreationSuggestions.take(1, dismissals());
  await until(() => h.sentExpertCreationSuggestions().length === 2);
  expect(h.sentExpertCreationSuggestions()[1]).toMatchObject({ server: B, message: { id: (suggestion.message as { id: string }).id } });

  // Not inside it for s1; and for s2, suggested src/parser/lexer first, not above that. Each pass is
  // looked at once the last was: one while the session's is under way isn't.
  fs.mkdirSync(path.join(h.checkout, "src", "parser", "lexer"), { recursive: true });
  fs.writeFileSync(path.join(h.checkout, "src", "parser", "lexer", "tokens.ts"), "export const tokens = [];\n");
  const s2 = { session: "claude-code:s2", bare: "s2" };
  for (const pass of [h.seen([searched("src/parser/lexer", 35000)]), h.seen([searched("src/parser/lexer", 35000)], s2), h.seen([searched("src/parser", 35000)], s2)]) {
    h.expertCreationSuggestions.seen(pass);
    await until(() => h.expertCreationSuggestions.idle());
  }
  expect(h.drafts.map((d) => d.folder)).toEqual(["src/parser", "src/parser/lexer"]);
  const again = await harness({}, h.root);
  again.expertCreationSuggestions.take(0, dismissals());
  again.expertCreationSuggestions.seen(again.seen(areas));
  await until(() => again.expertCreationSuggestions.idle());
  expect(again.drafts).toEqual([]);
});

test("a suggestion goes only to the offices that may be told of its repo: one on another repo the session worked in, only to the office whose pass named that repo", async () => {
  const h = await harness();
  for (const index of [0, 1]) h.expertCreationSuggestions.take(index, dismissals());
  // A holds the other repo, so its pass names it; B's pass has only the session's own repo.
  h.expertCreationSuggestions.seen(h.seen([searched("src/parser", 35000, { project: OTHER }), area("docs", 100)]));
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
  h.expertCreationSuggestions.seen(h.seen([searched("src/parser", 35000)]));
  await sleep(30);
  h.expertCreationSuggestions.take(0, dismissals([{ project: PROJECT.id.toUpperCase(), folder: "SRC/Parser", forever: true }]));
  h.expertCreationSuggestions.seen(h.seen([searched("src/parser", 35000)]));
  h.state.experts = [{ name: "docs", repo: "/work/app", subject: "The docs.", state: "ready", senior: false, areas: ["Docs/**"] }];
  h.expertCreationSuggestions.seen(h.seen([searched("docs/adr", 35000)], { session: "claude-code:s2", bare: "s2" }));
  await sleep(30);
  expect(h.drafts).toEqual([]);

  // The folder is checked before any draft is made of it, and the whole draft after.
  h.expertCreationSuggestions.seen(h.seen([searched("src/AKIA" + "ABCDEFGHIJKLMNOP", 35000)], { session: "claude-code:s3", bare: "s3" }));
  await until(() => h.logs.some((l) => l.includes("secret pattern")));
  expect(h.logs.at(-1)).toBe('no expert is suggested on a folder of app: its path matches the secret pattern "AWS access key"');
  expect(h.drafts).toEqual([]);
  h.state.draft = { ...DRAFT, subject: "Uses the key AKIA" + "ABCDEFGHIJKLMNOP." };
  h.expertCreationSuggestions.seen(h.seen([], { session: "claude-code:s4", bare: "s4", readings: [reading("src/main.ts", 4)] }));
  await until(() => h.logs.some((l) => l.includes("its draft matches")));
  expect(h.logs.at(-1)).toBe('no expert is suggested on src/main.ts of app: its draft matches the secret pattern "AWS access key"');
  expect(h.sentExpertCreationSuggestions()).toEqual([]);
});

test("no folder passes on its folders' searches: one whose searches were all in a folder the person dismissed, or spread over folders that don't pass on their own, is never suggested; its own searches still count", async () => {
  const h = await harness();
  h.expertCreationSuggestions.take(0, dismissals([{ project: PROJECT.id, folder: "src/parser/shipping", forever: true }]));
  h.expertCreationSuggestions.seen(h.seen([searched("src/parser", 35000), searched("src/parser/shipping", 35000)]));
  const n = SETTINGS.searches;
  const spread = [area("src/parser", 35000, { searches: 2 * n - 2 }), area("src/parser/lexer", 20000, { searches: n - 1 }), area("src/parser/rules", 15000, { searches: n - 1 })];
  expect(ownSearches(spread, spread[0]!)).toBe(0);
  h.expertCreationSuggestions.seen(h.seen(spread, { session: "claude-code:s2", bare: "s2" }));
  await sleep(30);
  expect(h.drafts).toEqual([]);
  spread[0]!.searches += n;
  h.expertCreationSuggestions.seen(h.seen(spread, { session: "claude-code:s2", bare: "s2" }));
  await until(() => h.drafts.length === 1);
  expect(h.drafts[0]!.folder).toBe("src/parser");
});

test("an area whose files total more than groundingBudgetTokens is never suggested, whatever its signals: a folder, a file read again, or office-wide, answered no-draft, saying why; of the files read again, those that fit are the area", async () => {
  const h = await harness();
  h.hooked.add("s2");
  h.expertCreationSuggestions.take(0, dismissals());
  fs.writeFileSync(path.join(h.checkout, "src", "parser", "grammar.ts"), "x".repeat(4 * SETTINGS.groundingBudgetTokens + 4));
  expect(await areaTokens(h.checkout, ["src/parser"], SETTINGS.groundingBudgetTokens)).toBeGreaterThan(SETTINGS.groundingBudgetTokens);
  const grammar = reading("src/parser/grammar.ts", 9, 90000);
  h.expertCreationSuggestions.seen(h.seen([searched("src/parser", 35000, { searches: 50 })], { readings: [grammar] }));
  await until(() => h.expertCreationSuggestions.idle());
  expect(h.drafts).toEqual([]);
  h.expertCreationSuggestions.seen(h.seen([], { session: "claude-code:s2", bare: "s2", readings: [grammar, reading("src/parser/lex.ts", 4)] }));
  await until(() => h.lines.length === 1);
  expect(h.sentExpertCreationSuggestions()[0]!.message).toMatchObject({ folder: "src/parser/lex.ts", area: ["src/parser/lex.ts"] });
  h.expertCreationSuggestions.take(0, draftOfficeWideExpertCreationSuggestion("office-7", "src/parser", ["claude-code:s1"]));
  await until(() => h.sent.some((x) => x.message.type === "expert-creation-suggestion-ended"));
  expect(h.sent.at(-1)!.message).toEqual({ type: "expert-creation-suggestion-ended", v: PROTOCOL_VERSION, id: "office-7", why: "no-draft" });
  expect(h.logs.filter((l) => l.startsWith("no office-wide expert"))).toEqual([`no office-wide expert is suggested on src/parser of app (office-7): its files total more than ${SETTINGS.groundingBudgetTokens} tokens, more than one expert's grounding reads`]);
  expect(h.drafts).toHaveLength(1);
});

test("never the repo's top folder or one of its top-level folders, nor a folder holding the area of an expert here: not for a session, nor office-wide, which is answered no-draft, saying why", async () => {
  const h = await harness();
  h.expertCreationSuggestions.take(0, dismissals());
  h.state.experts = [{ name: "lexer", repo: h.checkout, subject: "The lexer.", state: "ready", senior: false, areas: ["src/parser/lex.ts"] }];
  h.expertCreationSuggestions.seen(h.seen([searched("src", 40000, { searches: 2 * SETTINGS.searches }), searched("src/parser", 35000)]));
  await until(() => h.expertCreationSuggestions.idle());
  h.expertCreationSuggestions.take(0, draftOfficeWideExpertCreationSuggestion("office-5", "src", ["claude-code:s1"]));
  h.expertCreationSuggestions.take(0, draftOfficeWideExpertCreationSuggestion("office-6", "src/parser", ["claude-code:s1"]));
  await until(() => h.sent.filter((s) => s.message.type === "expert-creation-suggestion-ended").length === 2);
  expect(h.drafts).toEqual([]);
  expect(h.sent.map((s) => s.message).sort((a, b) => ((a as { id: string }).id < (b as { id: string }).id ? -1 : 1))).toEqual(["office-5", "office-6"].map((id) => ({ type: "expert-creation-suggestion-ended", v: PROTOCOL_VERSION, id, why: "no-draft" })));
  expect(h.logs.filter((l) => l.startsWith("no office-wide expert")).sort()).toEqual([
    "no office-wide expert is suggested on src of app (office-5): it is the repo's top folder, or a folder or file at its top, too broad for one expert",
    "no office-wide expert is suggested on src/parser of app (office-6): an expert on this computer covers it, or has its area inside it",
  ]);
});

test("one read of one large file never counts, however much of the context it took; the same file read again across sessions does, the file itself being the area, and the session's line says so; once suggested, no later session's reading suggests it again", async () => {
  const h = await harness();
  h.hooked.add("s4");
  h.expertCreationSuggestions.take(0, dismissals());
  const once = (bare: string) => h.seen([area("src/parser", 40000)], { session: `claude-code:${bare}`, bare, readings: [reading("src/parser/parse.ts", 1, 0, { tokens: 40000 })] });
  for (const bare of ["s1", "s2", "s3"]) {
    h.expertCreationSuggestions.seen(once(bare));
    await until(() => h.expertCreationSuggestions.idle());
  }
  expect(h.drafts).toEqual([]);
  h.expertCreationSuggestions.seen(once("s4"));
  await until(() => h.lines.length === 1);
  expect(h.drafts.map((d) => [d.folder, d.files])).toEqual([["src/parser/parse.ts", ["src/parser/parse.ts"]]]);
  expect(h.sentExpertCreationSuggestions()[0]!.message).toMatchObject({ session: "claude-code:s4", folder: "src/parser/parse.ts", area: ["src/parser/parse.ts"], why: { share: 0, tokens: 0, minutes: 0, corrections: 0 } });
  expect(h.sentExpertCreationSuggestions()[0]!.message).toMatchObject({ repetition: { readings: 4, sessions: 4, files: 1 } });
  expect(h.lines[0]!.line).toMatchObject({ folder: "src/parser/parse.ts", repetition: { readings: 4, sessions: 4, files: 1 } });
  for (const bare of ["s5", "s6"]) {
    h.expertCreationSuggestions.seen(once(bare));
    await until(() => h.expertCreationSuggestions.idle());
  }
  expect(h.drafts).toHaveLength(1);
});

test("a file read again is never suggested again to its session, nor while held after its draft failed for any session, nor once dismissed, covered by an expert here, at the repo's top, or with a path an area reads as a glob", async () => {
  const h = await harness();
  for (const file of ["src/util/strings.ts", "src/routes/[slug]/page.ts", "README.md"]) {
    fs.mkdirSync(path.dirname(path.join(h.checkout, file)), { recursive: true });
    fs.writeFileSync(path.join(h.checkout, file), "export const x = 1;\n");
  }
  h.expertCreationSuggestions.take(0, dismissals([{ project: PROJECT.id, folder: "src/parser/lex.ts", forever: true }]));
  h.state.experts = [{ name: "main", repo: h.checkout, subject: "The entry point.", state: "ready", senior: false, areas: ["src/main.ts"] }];
  const pass = async (bare: string, file: string, readings: number) => {
    h.expertCreationSuggestions.seen(h.seen([], { session: `claude-code:${bare}`, bare, readings: [reading(file, readings)] }));
    await until(() => h.expertCreationSuggestions.idle());
  };
  await pass("s1", "src/parser/parse.ts", 4);
  await pass("s1", "src/parser/parse.ts", 5);
  await pass("s2", "src/parser/lex.ts", 4);
  await pass("s3", "src/main.ts", 4);
  await pass("s4", "README.md", 4);
  await pass("s5", "src/routes/[slug]/page.ts", 4);
  h.state.draft = null;
  await pass("s6", "src/util/strings.ts", 4);
  h.state.draft = DRAFT;
  await pass("s7", "src/util/strings.ts", 4);
  expect(h.drafts.map((d) => d.folder)).toEqual(["src/parser/parse.ts", "src/util/strings.ts"]);
});

test("of the files read again, only those read together with the file read most again, in two turns or more, are its area", async () => {
  const h = await harness();
  fs.mkdirSync(path.join(h.checkout, "docs"), { recursive: true });
  fs.writeFileSync(path.join(h.checkout, "docs", "hosting.md"), "# Hosting\n");
  h.expertCreationSuggestions.take(0, dismissals());
  const turns = (...n: number[]) => ({ turns: n.map((t) => `0:${t}`) });
  const readings = [reading("src/parser/parse.ts", 4), reading("src/parser/lex.ts", 2, 0, turns(1, 3)), reading("docs/hosting.md", 2, 0, turns(5, 6)), reading("src/main.ts", 2, 0, turns(2, 7))];
  h.expertCreationSuggestions.seen(h.seen([], { readings }));
  await until(() => h.sentExpertCreationSuggestions().length === 1);
  expect(h.sentExpertCreationSuggestions()[0]!.message).toMatchObject({ folder: "src/parser/parse.ts", area: ["src/parser/parse.ts", "src/parser/lex.ts"], repetition: { readings: 4, sessions: 1, files: 2 } });
});

// A session of `repo`, its turns each reading the files named, as the data layer reads its transcript.
async function readThrough(home: string, repo: string, id: string, turns: string[][]) {
  let age = 1000;
  let n = 0;
  const lines = turns.flatMap((files) => [
    transcript.user(repo, "how does this work?", age--),
    ...files.flatMap((file) => {
      const call = `r${n++}`;
      return [
        { type: "assistant", cwd: repo, timestamp: at(age), message: { role: "assistant", content: [{ type: "tool_use", id: call, name: "Read", input: { file_path: path.join(repo, file) } }] } },
        { type: "user", cwd: repo, timestamp: at(age--), message: { role: "user", content: [{ type: "tool_result", tool_use_id: call, content: fs.readFileSync(path.join(repo, file), "utf8"), is_error: false }] } },
      ];
    }),
  ]);
  session(home, id, lines);
  return sourceIn(home)(id, repo);
}

test("the session of 20 Nov 2026 that read a large design once and two ADRs, which once suggested an expert on all of docs, suggests nothing", async () => {
  const root = tempRoot();
  const repo = gitRepo(path.join(root, "isoplan-app"));
  const docs = { "docs/designs/agent-expertise.md": 104000, "docs/adr/0004-what-leaves-a-machine.md": 8000, "docs/adr/0013-nuanced-features-offer-themselves.md": 8000, "docs/designs/hosting.md": 60000, "docs/contracts.md": 40000 };
  for (const [file, chars] of Object.entries(docs)) {
    fs.mkdirSync(path.dirname(path.join(repo, file)), { recursive: true });
    fs.writeFileSync(path.join(repo, file), "d".repeat(chars));
  }
  const r = await readThrough(path.join(root, "home"), repo, "s1", [["docs/designs/agent-expertise.md"], ["docs/adr/0004-what-leaves-a-machine.md", "docs/adr/0013-nuanced-features-offer-themselves.md"]]);
  // As then: docs took 30,000 tokens, which its subfolders didn't alone.
  expect(r.facts!.areas!.map((a) => [a.folder, a.tokens])).toEqual([["docs", 30000], ["docs/designs", 26000], ["docs/adr", 4000]]);
  const h = await harness({}, root);
  h.state.experts = [{ name: "decisions", repo, subject: "The ADRs.", state: "ready", senior: false, areas: ["docs/adr"] }];
  h.expertCreationSuggestions.take(0, dismissals());
  h.expertCreationSuggestions.seen(h.seen(r.facts!.areas!, { checkout: repo, window: 1000000, readings: r.readings!, said: r.said! }));
  await until(() => h.expertCreationSuggestions.idle());
  expect([h.drafts, h.sentExpertCreationSuggestions()]).toEqual([[], []]);
});

test("one ADR and the code it governs, read again across sessions, are suggested as an area of those files, its reason what was read again", async () => {
  const root = tempRoot();
  const home = path.join(root, "home");
  const repo = gitRepo(path.join(root, "isoplan-app"));
  const adr = "docs/adr/0007-one-isoplan-process-per-machine.md";
  const code = "packages/server/src/runners.ts";
  for (const [file, chars] of [[adr, 6000], [code, 12000], ["packages/server/src/live.ts", 80000], ["docs/adr/0004-what-leaves-a-machine.md", 8000]] as const) {
    fs.mkdirSync(path.dirname(path.join(repo, file)), { recursive: true });
    fs.writeFileSync(path.join(repo, file), "c".repeat(chars));
  }
  const h = await harness({}, root);
  h.hooked.add("c");
  h.expertCreationSuggestions.take(0, dismissals());
  for (const [id, turns] of [["a", [[adr, code, "packages/server/src/live.ts"], [adr]]], ["b", [[adr, code]]], ["c", [[adr, code, "docs/adr/0004-what-leaves-a-machine.md"]]]] as const) {
    const r = await readThrough(home, repo, id, turns.map((t) => [...t]));
    h.expertCreationSuggestions.seen(h.seen(r.facts!.areas!, { session: `claude-code:${id}`, bare: id, checkout: repo, window: 1000000, readings: r.readings!, said: r.said! }));
    await until(() => h.expertCreationSuggestions.idle());
    expect(h.drafts.length).toBe(id === "c" ? 1 : 0);
  }
  expect(h.drafts[0]).toMatchObject({ folder: adr, files: [adr, code] });
  await until(() => h.lines.length === 1);
  expect(h.sentExpertCreationSuggestions()[0]!.message).toMatchObject({ session: "claude-code:c", folder: adr, area: [adr, code] });
  expect(expertCreationSuggestionTranscriptText(h.lines[0]!.line as ExpertCreationSuggestionLine).split(". A")[0]).toBe(`Isoplan: ${adr} was read 4 times in 3 sessions, and 1 other file was read again with it`);
});

test("a folder whose draft couldn't be made waits RETRY_MS for that session, with the folders inside and above it, a restart included, then is tried again", async () => {
  let clock = Date.now();
  const h = await harness({ now: () => clock });
  for (const file of ["src/parser/lexer/tokens.ts", "src/parser/lexer/rules/keywords.ts"]) {
    fs.mkdirSync(path.dirname(path.join(h.checkout, file)), { recursive: true });
    fs.writeFileSync(path.join(h.checkout, file), "export const x = 1;\n");
  }
  h.expertCreationSuggestions.take(0, dismissals());
  h.state.draft = null;
  h.expertCreationSuggestions.seen(h.seen([searched("src/parser/lexer", 35000)]));
  await until(() => h.logs.some((l) => l.includes("no usable draft came")));
  // The hold is on disk before the runner stops.
  await until(() => (savedFile(h.isoplanDir) as { held?: unknown[] } | null)?.held?.length === 1);
  h.expertCreationSuggestions.close();
  const again = await harness({ now: () => clock }, h.root);
  again.expertCreationSuggestions.take(0, dismissals());
  // Above it, and inside it: each looked at once the last was.
  for (const folder of ["src/parser", "src/parser/lexer/rules"]) {
    again.expertCreationSuggestions.seen(again.seen([searched(folder, 35000)]));
    await until(() => again.expertCreationSuggestions.idle());
  }
  expect(again.drafts).toHaveLength(0);
  clock += RETRY_MS;
  again.expertCreationSuggestions.seen(again.seen([searched("src/parser", 35000)]));
  await until(() => again.sentExpertCreationSuggestions().length === 1);
  expect(again.drafts).toHaveLength(1);
});

test("the session's hooks module is told of an open suggestion in each office, again when it connects, and when it ends; made in one office, it is withdrawn from the other, and the session told the expert is ready", async () => {
  const h = await harness();
  for (const index of [0, 1]) h.expertCreationSuggestions.take(index, dismissals());
  h.expertCreationSuggestions.seen(h.seen([searched("src/parser", 35000)]));
  h.expertCreationSuggestions.seen(h.seen([searched("src/parser", 35000)], { server: B }));
  await until(() => h.lines.length === 2);
  const id = (h.sentExpertCreationSuggestions()[0]!.message as { id: string }).id;
  const line = (server: string, label: string) => ({ type: "expert-creation-suggestion", server, label, id, key: "parser", name: "Parser Expert", folder: "src/parser", url: reviewUrl(server, id), why: { share: 0, tokens: 0, minutes: 0, corrections: 0 }, repetition: { searches: SETTINGS.searches } });
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
  h.expertCreationSuggestions.seen(h.seen([searched("src/parser", 35000)]));
  await until(() => h.lines.length === 1);
  const id = (h.sentExpertCreationSuggestions()[0]!.message as { id: string }).id;
  h.expertCreationSuggestions.take(0, { type: "expert-creation-suggestion-ended", v: PROTOCOL_VERSION, id, why: "dismissed" });
  expect(h.lines.at(-1)!.line).toEqual({ type: "expert-creation-suggestion-ended", server: A, id, why: "dismissed" });
});

test("a suggestion dismissed in one office is withdrawn from the others", async () => {
  const h = await harness();
  for (const index of [0, 1]) h.expertCreationSuggestions.take(index, dismissals());
  h.expertCreationSuggestions.seen(h.seen([searched("src/parser", 35000)]));
  h.expertCreationSuggestions.seen(h.seen([searched("src/parser", 35000)], { server: B }));
  await until(() => h.lines.length === 2);
  const id = idOf(h.sentExpertCreationSuggestions()[0]!);
  h.expertCreationSuggestions.take(0, { type: "expert-creation-suggestion-ended", v: PROTOCOL_VERSION, id, why: "dismissed" });
  expect(h.sent.at(-1)).toEqual({ server: B, message: { type: "expert-creation-suggestion-ended", v: PROTOCOL_VERSION, id, why: "withdrawn" } });
  expect(h.lines.at(-1)!.line).toEqual({ type: "expert-creation-suggestion-ended", server: B, id, why: "withdrawn" });
});

test("a suggestion an office refused ends there alone: the session hears it ended there, not that it was dismissed, and it stays open in the others", async () => {
  const h = await harness();
  for (const index of [0, 1]) h.expertCreationSuggestions.take(index, dismissals());
  h.expertCreationSuggestions.seen(h.seen([searched("src/parser", 35000)]));
  h.expertCreationSuggestions.seen(h.seen([searched("src/parser", 35000)], { server: B }));
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
  h.expertCreationSuggestions.seen(h.seen([searched("src/parser", 35000)]));
  await until(() => h.sentExpertCreationSuggestions().length === 1);
  expect(h.expertCreationSuggestions.corrected("s1", "k1", "no, the other file", null)).toBe(null);
  await until(() => asked.length === 1);
  expect(h.expertCreationSuggestions.corrected("s1", "k1", "", null)).toBe(true);
});

test("a suggestion the office ends at once is never shown in the session: dismissed there, or made where another computer's expert covers its folder, which the session hears of as ready; one sent on a connection that closed first goes again on the next", async () => {
  const h = await harness({ keptMs: 300 });
  h.hooked.add("s2");
  h.expertCreationSuggestions.take(0, dismissals());
  h.expertCreationSuggestions.seen(h.seen([searched("src/parser", 35000)]));
  await until(() => h.sentExpertCreationSuggestions().length === 1);
  h.expertCreationSuggestions.take(0, { type: "expert-creation-suggestion-ended", v: PROTOCOL_VERSION, id: idOf(h.sentExpertCreationSuggestions()[0]!), why: "dismissed" });
  h.expertCreationSuggestions.seen(h.seen([searched("src/parser", 40000)], { session: "claude-code:s2", bare: "s2" }));
  await until(() => h.sentExpertCreationSuggestions().length === 2);
  const covered = idOf(h.sentExpertCreationSuggestions()[1]!);
  h.expertCreationSuggestions.take(0, { type: "expert-creation-suggestion-ended", v: PROTOCOL_VERSION, id: covered, why: "made", key: "app-src" });
  await sleep(400);
  expect(h.lines.map((l) => l.line)).toEqual([{ type: "expert-ready", server: A, id: covered, key: "app-src", name: "App Src Expert", folder: "src/parser" }]);
  expect(["s1", "s2"].map((bare) => fs.existsSync(path.join(h.isoplanDir, "expert-creation-suggestions", `${bare}.json`)))).toEqual([false, false]);

  h.expertCreationSuggestions.seen(h.seen([searched("src/parser", 35000)], { session: "claude-code:s3", bare: "s3" }));
  await until(() => h.sentExpertCreationSuggestions().length === 3);
  h.expertCreationSuggestions.linked(0);
  h.expertCreationSuggestions.take(0, dismissals());
  await until(() => h.sentExpertCreationSuggestions().length === 4);
  expect(idOf(h.sentExpertCreationSuggestions()[3]!)).toBe(idOf(h.sentExpertCreationSuggestions()[2]!));
});

test("each suggestion open in an office goes again on each new connection there, once its dismissals came, so an end that was lost comes again; it stays open meanwhile", async () => {
  const h = await harness();
  h.expertCreationSuggestions.take(0, dismissals());
  h.expertCreationSuggestions.seen(h.seen([searched("src/parser", 35000)]));
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
  h.expertCreationSuggestions.seen(h.seen([searched("src/parser", 35000)]));
  h.expertCreationSuggestions.seen(h.seen([searched("src/parser", 35000)], { server: B }));
  await until(() => h.sentExpertCreationSuggestions().length === 2);
  const id = idOf(h.sentExpertCreationSuggestions()[0]!);
  h.expertCreationSuggestions.take(0, { type: "expert-creation-suggestion-ended", v: PROTOCOL_VERSION, id, why: "refused" });
  clock += RETRY_MS;
  // Still open in B, so not suggested again.
  h.expertCreationSuggestions.seen(h.seen([searched("src/parser", 35000)]));
  await sleep(30);
  expect(h.drafts).toHaveLength(1);
  h.expertCreationSuggestions.take(1, { type: "expert-creation-suggestion-ended", v: PROTOCOL_VERSION, id, why: "refused" });
  // The last refusal's time is on disk before the runner stops.
  await until(() => typeof (savedFile(h.isoplanDir) as { expertCreationSuggestions?: { refusedAt?: number }[] } | null)?.expertCreationSuggestions?.[0]?.refusedAt === "number");
  h.expertCreationSuggestions.close();
  const again = await harness({ now: () => clock }, h.root);
  again.expertCreationSuggestions.take(0, dismissals());
  again.expertCreationSuggestions.seen(again.seen([searched("src/parser", 35000)]));
  await sleep(30);
  expect(again.drafts).toHaveLength(0);
  clock += RETRY_MS;
  again.expertCreationSuggestions.seen(again.seen([searched("src/parser", 35000)]));
  await until(() => again.sentExpertCreationSuggestions().length === 1);
  expect(idOf(again.sentExpertCreationSuggestions()[0]!)).not.toBe(id);
});

const draftOfficeWideExpertCreationSuggestion = (request: string, folder: string, sessions: string[]): DraftOfficeWideExpertCreationSuggestionMessage => ({ type: "draft-office-wide-expert-creation-suggestion", v: PROTOCOL_VERSION, request, project: PROJECT, folder, sessions, searchedBySessions: 3, searchWindowDays: 14 });

test("draft-office-wide-expert-creation-suggestion: an office-wide suggestion is drafted from the newest of its sessions this runner reported to that office, once however often it is asked, and goes to that office alone, with the request's id; one with no draft is answered no-draft", async () => {
  const h = await harness();
  // Seen before the dismissals, so it isn't suggested on its own.
  h.expertCreationSuggestions.seen(h.seen([searched("src/parser", 35000, { searches: 4 })]));
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
  h.expertCreationSuggestions.take(1, draftOfficeWideExpertCreationSuggestion("office-2", "src/parser", ["claude-code:s1"]));
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

test("create-expert-from-suggestion: a runner that stopped after writing the expert file but before saving that it had follows the creation on, since the file for its key has its subject; another subject there is someone else's, and fails it as before", async () => {
  const h = await harness();
  h.expertCreationSuggestions.take(0, dismissals());
  h.expertCreationSuggestions.take(0, createExpertFromSuggestion("m1"));
  await until(() => expertCreationProgress(h, "m1").length === 1 && (savedFile(h.isoplanDir)?.expertCreations[0] as { wrote?: boolean } | undefined)?.wrote === true);
  h.expertCreationSuggestions.close();
  // As the runner file was when it stopped: the save that says it wrote never landed. And another creation, of lexer, whose file is someone else's.
  const runnerFile = path.join(h.isoplanDir, "runner", "expert-creation-suggestions.json");
  const value = JSON.parse(fs.readFileSync(runnerFile, "utf8"));
  value.expertCreations[0].wrote = false;
  value.expertCreations.push({ ...value.expertCreations[0], request: "m9", expertCreationSuggestionId: "o9", key: "lexer" });
  fs.writeFileSync(runnerFile, JSON.stringify(value));
  fs.writeFileSync(path.join(h.isoplanDir, "experts", "lexer.json"), JSON.stringify({ version: 1, name: "lexer", repo: h.checkout, subject: "How the lexer splits text.", model: "sonnet", promoteAtTokens: 1, proof: DRAFT.proof, areas: ["src"] }));
  const again = await harness({}, h.root);
  again.expertCreationSuggestions.take(0, dismissals());
  await until(() => expertCreationProgress(again, "m1").length === 1 && expertCreationProgress(again, "m9").length === 1);
  expect(expertCreationProgress(again, "m1")).toEqual(["cloning"]);
  expect(expertCreationProgress(again, "m9")).toEqual(["the runner on that computer stopped before its expert file was written; make it again"]);
  const stateFile = path.join(again.isoplanDir, "experts", "parser", "state.json");
  fs.mkdirSync(path.dirname(stateFile), { recursive: true });
  fs.writeFileSync(stateFile, JSON.stringify({ version: 1, fingerprint: "f", repo: again.checkout, branch: "main", generations: [{ n: 1, trunk: "t1", model: "m", commit: "a".repeat(40), groundedAt: Date.now(), meter: 0, notes: 0, state: "junior" }] }));
  await until(() => expertCreationProgress(again, "m1").length === 2);
  expect(expertCreationProgress(again, "m1")).toEqual(["cloning", "ready"]);
  expect(fs.existsSync(path.join(again.isoplanDir, "experts", "lexer.json"))).toBe(true);
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
