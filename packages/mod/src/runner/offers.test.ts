import fs from "node:fs";
import path from "node:path";
import { PROTOCOL_VERSION, type AreaFact, type DraftOfferMessage, type OfferDismissal, type MakeExpertMessage, type OfferDismissalsMessage } from "@isoplan/protocol";
import { expect, test } from "vitest";
import { modDir, tempRoot } from "../data-layer/fixture.js";
import type { RunnerOfferMessage } from "../data-layer/link.js";
import type { SessionAreas } from "../data-layer/report-session.js";
import type { DataLayerLine } from "../lines.js";
import { parseExpertFile } from "./expert-file.js";
import type { HostedExpert } from "./expert.js";
import type { Draft, DraftInput } from "./offer-model.js";
import { covers, createOffers, dismissed, EXCERPT_CHARS, folderExcerpts, folderFiles, passed, passes, RETRY_MS, reviewUrl, signalsOf, type ExpertOfferSettings, type OffersOptions } from "./offers.js";

const SETTINGS: ExpertOfferSettings = JSON.parse(fs.readFileSync(path.join(modDir, "runner.json"), "utf8")).expertOffers;
const A = "ws://127.0.0.1:4747/data-layer";
const B = "wss://office.team.com/data-layer";
const PROJECT = { id: "github.com/team/app", name: "app" };
const OTHER = { id: "github.com/team/lib", name: "lib" };
const DRAFT: Draft = { key: "parser", subject: "How the parser reads a file. Ask before changing it.", proof: { question: "Where does parsing start?", answer: "In parse.ts." } };

const area = (folder: string, tokens: number, more: Partial<AreaFact> = {}): AreaFact => ({ folder, reads: 1, searches: 0, tokens, ms: 0, corrections: 0, ...more });
const dismissals = (list: OfferDismissal[] = []): OfferDismissalsMessage => ({ type: "offer-dismissals", v: PROTOCOL_VERSION, dismissals: list });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const idOf = (s: { message: RunnerOfferMessage }) => (s.message as { id: string }).id;
// offers.json as it is on disk; null while it is missing or being replaced.
const savedFile = (isoplanDir: string) => {
  try {
    return JSON.parse(fs.readFileSync(path.join(isoplanDir, "runner", "offers.json"), "utf8")) as { makings: unknown[] };
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

/** Offers for offices A and B with stand-ins for everything they reach; session s1's hooks module connected. */
async function harness(o: Partial<OffersOptions> = {}, root = tempRoot()) {
  const isoplanDir = path.join(root, "isoplan");
  const checkout = path.join(root, "app");
  fs.mkdirSync(path.join(checkout, "src", "parser", "node_modules"), { recursive: true });
  for (const [f, text] of Object.entries(FILES)) fs.writeFileSync(path.join(checkout, f), text);
  const sent: { server: string; message: RunnerOfferMessage }[] = [];
  const up = [true, true];
  const lines: { bare: string; line: DataLayerLine }[] = [];
  const hooked = new Set(["s1"]);
  const drafts: DraftInput[] = [];
  const logs: string[] = [];
  const state = { draft: DRAFT as Draft | null, experts: [] as HostedExpert[], checkout: checkout as string | null };
  const opts: OffersOptions = {
    isoplanDir,
    settings: async () => ({ expertOffers: SETTINGS }),
    offices: [A, B].map((server, i) => ({ server, label: i ? "team" : "dev", send: (message) => up[i]! && (sent.push({ server, message }), true) })),
    account: { id: "claude:ada" },
    scan: async (text) => (text.includes("AKIA") ? "AWS access key" : null),
    draft: async (input) => (drafts.push(input), state.draft),
    corrects: async () => true,
    experts: () => state.experts,
    projectOf: async () => PROJECT.id,
    checkout: async () => state.checkout,
    hooked: (bare) => (hooked.has(bare) ? { send: (line) => void lines.push({ bare, line }) } : null),
    log: (text) => void logs.push(text),
    pollMs: 10,
    keptMs: 20,
    ...o,
  };
  const offers = createOffers(opts);
  await offers.start();
  const seen = (areas: AreaFact[], more: Partial<SessionAreas> = {}): SessionAreas => ({ server: A, session: "claude-code:s1", bare: "s1", project: PROJECT, checkout, window: 200000, model: null, areas, said: async () => ["Asked: how does the parser work?"], ...more });
  const offered = () => sent.filter((s) => s.message.type === "expert-offer");
  return { root, isoplanDir, checkout, offers, sent, up, lines, hooked, drafts, logs, state, seen, offered };
}

test("reviewUrl: the office's http address with /?offer=<id>, its data-layer path taken off", () => {
  expect(reviewUrl(A, "abc_1")).toBe("http://127.0.0.1:4747/?offer=abc_1");
  expect(reviewUrl("wss://office.team.com/team/data-layer", "x")).toBe("https://office.team.com/team/?offer=x");
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
  // An offer gives only the signals that passed.
  expect(passed(signalsOf(area("src", 35000, { ms: 90000, corrections: 1 }), 1000000), t)).toEqual({ share: 0.035, tokens: 35000, minutes: 0, corrections: 0 });
  expect(passed(signalsOf(area("src", 10, { ms: 600000, corrections: 2 }), 1000000), t)).toEqual({ share: 0, tokens: 0, minutes: 10, corrections: 2 });
});

test("covers, dismissed, folderFiles and folderExcerpts: a folder or glob covers what is inside it; a dismissal holds until its time, or for good; a draft sees a folder's files, and the start of the first that read as text", async () => {
  expect([covers(["src/**/*.ts"], "src/parser"), covers(["src/parser/*.ts"], "src"), covers(["."], "docs"), covers(["docs"], "docsite")]).toEqual([true, false, true, false]);
  const now = Date.parse("2026-11-19T12:00:00Z");
  const list = [
    { project: PROJECT.id, folder: "src", until: "2026-11-20T00:00:00Z" },
    { project: PROJECT.id, folder: "docs", until: "2026-11-01T00:00:00Z" },
    { project: PROJECT.id, folder: "lib", forever: true as const },
  ];
  expect(["src/parser", "docs", "lib", "tools"].map((f) => dismissed(list, PROJECT.id, f, now))).toEqual([true, false, true, false]);
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

test("a session's deepest folder that passes is drafted once, from its files' names and starts, and offered to each office that takes the repo, once that office's connection has had its dismissals; never again for that session, nor inside or above it, a restart included", async () => {
  const h = await harness();
  const areas = [area("src", 40000), area("src/parser", 35000), area("docs", 100)];
  // A pass before its office has said the person's dismissals isn't looked at.
  h.offers.seen(h.seen(areas));
  await sleep(30);
  expect(h.drafts).toEqual([]);
  h.offers.take(0, dismissals());
  h.offers.seen(h.seen(areas));
  h.offers.seen(h.seen(areas, { server: B }));
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
  await until(() => h.offered().length === 1);
  const offer = h.offered()[0]!;
  expect(offer.server).toBe(A);
  expect(offer.message).toMatchObject({ type: "expert-offer", session: "claude-code:s1", project: PROJECT, folder: "src/parser", scope: "session", key: "parser", subject: DRAFT.subject, area: ["src/parser"], proof: DRAFT.proof, why: { share: 0.175, tokens: 35000, minutes: 0, corrections: 0 } });
  h.offers.take(1, dismissals());
  await until(() => h.offered().length === 2);
  expect(h.offered()[1]).toMatchObject({ server: B, message: { id: (offer.message as { id: string }).id } });

  for (const more of [[area("src/parser/lexer", 35000)], [area("src", 90000)]]) h.offers.seen(h.seen(more));
  await sleep(30);
  const again = await harness({}, h.root);
  again.offers.take(0, dismissals());
  again.offers.seen(again.seen(areas));
  await sleep(30);
  expect([h.drafts.length, again.drafts.length]).toEqual([1, 0]);
});

test("an offer goes only to the offices that may be told of its repo: one on another repo the session worked in, only to the office whose pass named that repo", async () => {
  const h = await harness();
  for (const index of [0, 1]) h.offers.take(index, dismissals());
  // A holds the other repo, so its pass names it; B's pass has only the session's own repo.
  h.offers.seen(h.seen([area("src/parser", 35000, { project: OTHER }), area("docs", 100)]));
  h.offers.seen(h.seen([area("docs", 100)], { server: B }));
  await until(() => h.lines.length === 1);
  expect(h.offered().map((s) => [s.server, (s.message as { project: unknown }).project])).toEqual([[A, OTHER]]);
  // B's next pass doesn't add it either.
  h.offers.seen(h.seen([area("docs", 100)], { server: B }));
  await sleep(50);
  expect(h.offered().map((s) => s.server)).toEqual([A]);
});

test("no expert is offered on a folder the person dismissed, even after a restart, one an expert here covers, or one whose path or draft matches a secret pattern, each said why where there is one", async () => {
  const h = await harness();
  // Before the office has said the dismissals, a pass isn't looked at: a dismissal for good holds.
  h.offers.seen(h.seen([area("src/parser", 35000)]));
  await sleep(30);
  h.offers.take(0, dismissals([{ project: PROJECT.id, folder: "src/parser", forever: true }]));
  h.offers.seen(h.seen([area("src/parser", 35000)]));
  h.state.experts = [{ name: "docs", repo: "/work/app", subject: "The docs.", state: "ready", senior: false, areas: ["docs/**"] }];
  h.offers.seen(h.seen([area("docs/adr", 35000)], { session: "claude-code:s2", bare: "s2" }));
  await sleep(30);
  expect(h.drafts).toEqual([]);

  // The folder is checked before any draft is made of it, and the whole draft after.
  h.offers.seen(h.seen([area("src/AKIA" + "ABCDEFGHIJKLMNOP", 35000)], { session: "claude-code:s3", bare: "s3" }));
  await until(() => h.logs.some((l) => l.includes("secret pattern")));
  expect(h.logs.at(-1)).toBe('no expert is offered on a folder of app: its path matches the secret pattern "AWS access key"');
  expect(h.drafts).toEqual([]);
  h.state.draft = { ...DRAFT, subject: "Uses the key AKIA" + "ABCDEFGHIJKLMNOP." };
  h.offers.seen(h.seen([area("src", 35000)], { session: "claude-code:s4", bare: "s4" }));
  await until(() => h.logs.some((l) => l.includes("its draft matches")));
  expect(h.logs.at(-1)).toBe('no expert is offered on src of app: its draft matches the secret pattern "AWS access key"');
  expect(h.offered()).toEqual([]);
});

test("a folder whose draft couldn't be made waits RETRY_MS for that session, with the folders inside and above it, then is tried again", async () => {
  let clock = Date.now();
  const h = await harness({ now: () => clock });
  h.offers.take(0, dismissals());
  h.state.draft = null;
  h.offers.seen(h.seen([area("src/parser", 35000)]));
  await until(() => h.logs.some((l) => l.includes("no usable draft came")));
  await sleep(20);
  h.state.draft = DRAFT;
  h.offers.seen(h.seen([area("src/parser", 35000), area("src", 40000)]));
  await sleep(30);
  expect(h.drafts).toHaveLength(1);
  clock += RETRY_MS;
  h.offers.seen(h.seen([area("src/parser", 35000)]));
  await until(() => h.offered().length === 1);
  expect(h.drafts).toHaveLength(2);
});

test("the session's hooks module is told of an open offer in each office, again when it connects, and when it ends; made in one office, it is withdrawn from the other, and the session told the expert is ready", async () => {
  const h = await harness();
  for (const index of [0, 1]) h.offers.take(index, dismissals());
  h.offers.seen(h.seen([area("src/parser", 35000)]));
  h.offers.seen(h.seen([area("src/parser", 35000)], { server: B }));
  await until(() => h.lines.length === 2);
  const id = (h.offered()[0]!.message as { id: string }).id;
  const line = (server: string, label: string) => ({ type: "expert-offer", server, label, id, key: "parser", name: "Parser Expert", folder: "src/parser", url: reviewUrl(server, id), why: { share: 0.175, tokens: 35000, minutes: 0, corrections: 0 } });
  expect(h.lines.map((l) => l.line)).toEqual([line(A, "dev"), line(B, "team")]);
  const file = path.join(h.isoplanDir, "offers", "s1.json");
  await until(() => fs.existsSync(file) && JSON.parse(fs.readFileSync(file, "utf8")).offers.length === 2);

  h.lines.length = 0;
  h.offers.rehooked("s1");
  expect(h.lines.map((l) => l.line)).toEqual([line(A, "dev"), line(B, "team")]);

  // Made in A while no hooks module is connected: the ready note waits for the next.
  h.lines.length = 0;
  h.hooked.delete("s1");
  h.offers.take(0, { type: "expert-offer-ended", v: PROTOCOL_VERSION, id, why: "made", key: "parser-rules" });
  expect(h.sent.at(-1)).toEqual({ server: B, message: { type: "expert-offer-ended", v: PROTOCOL_VERSION, id, why: "withdrawn" } });
  await until(() => !fs.existsSync(file));
  h.hooked.add("s1");
  h.offers.rehooked("s1");
  h.offers.rehooked("s1");
  expect(h.lines.map((l) => l.line)).toEqual([{ type: "expert-ready", server: A, id, key: "parser-rules", name: "Parser Rules Expert", folder: "src/parser" }]);
});

test("an offer dismissed or expired in an office says so to the session's hooks module", async () => {
  const h = await harness();
  h.offers.take(0, dismissals());
  h.offers.seen(h.seen([area("src/parser", 35000)]));
  await until(() => h.lines.length === 1);
  const id = (h.offered()[0]!.message as { id: string }).id;
  h.offers.take(0, { type: "expert-offer-ended", v: PROTOCOL_VERSION, id, why: "dismissed" });
  expect(h.lines.at(-1)!.line).toEqual({ type: "expert-offer-ended", server: A, id, why: "dismissed" });
});

test("an offer the office ends at once is never shown in the session: dismissed there, or made where another computer's expert covers its folder, which the session hears of as ready; one sent on a connection that closed first goes again on the next", async () => {
  const h = await harness({ keptMs: 300 });
  h.hooked.add("s2");
  h.offers.take(0, dismissals());
  h.offers.seen(h.seen([area("src/parser", 35000)]));
  await until(() => h.offered().length === 1);
  h.offers.take(0, { type: "expert-offer-ended", v: PROTOCOL_VERSION, id: idOf(h.offered()[0]!), why: "dismissed" });
  h.offers.seen(h.seen([area("src", 40000)], { session: "claude-code:s2", bare: "s2" }));
  await until(() => h.offered().length === 2);
  const covered = idOf(h.offered()[1]!);
  h.offers.take(0, { type: "expert-offer-ended", v: PROTOCOL_VERSION, id: covered, why: "made", key: "app-src" });
  await sleep(400);
  expect(h.lines.map((l) => l.line)).toEqual([{ type: "expert-ready", server: A, id: covered, key: "app-src", name: "App Src Expert", folder: "src" }]);
  expect(["s1", "s2"].map((bare) => fs.existsSync(path.join(h.isoplanDir, "offers", `${bare}.json`)))).toEqual([false, false]);

  h.offers.seen(h.seen([area("src/parser", 35000)], { session: "claude-code:s3", bare: "s3" }));
  await until(() => h.offered().length === 3);
  h.offers.linked(0);
  h.offers.take(0, dismissals());
  await until(() => h.offered().length === 4);
  expect(idOf(h.offered()[3]!)).toBe(idOf(h.offered()[2]!));
});

const draftOffer = (request: string, folder: string, sessions: string[]): DraftOfferMessage => ({ type: "draft-offer", v: PROTOCOL_VERSION, request, project: PROJECT, folder, sessions });

test("draft-offer: an office-wide offer is drafted from the newest of its sessions this runner reported to that office, once however often it is asked, and goes to that office alone, with the request's id; one with no draft is answered no-draft", async () => {
  const h = await harness();
  // Seen before the dismissals, so it isn't offered on its own.
  h.offers.seen(h.seen([area("src/parser", 35000, { searches: 4 })]));
  h.offers.take(0, dismissals());
  h.offers.take(1, dismissals());
  h.offers.take(0, draftOffer("office-1", "src/parser", ["claude-code:s9", "claude-code:s1"]));
  h.offers.take(0, draftOffer("office-1", "src/parser", ["claude-code:s9", "claude-code:s1"]));
  expect(h.offers.idle()).toBe(false);
  await until(() => h.offered().length === 1);
  expect(h.offered()[0]).toMatchObject({ server: A, message: { id: "office-1", scope: "office", session: "claude-code:s9", folder: "src/parser", why: { share: 0.175, tokens: 35000, minutes: 0, corrections: 0 } } });
  expect(h.drafts[0]!.said).toEqual(["Asked: how does the parser work?"]);
  await sleep(30);
  expect([h.drafts.length, h.offered().length]).toEqual([1, 1]);

  h.state.draft = null;
  h.offers.take(1, draftOffer("office-2", "docs", ["claude-code:s1"]));
  await until(() => h.sent.some((s) => s.message.type === "expert-offer-ended"));
  expect(h.sent.at(-1)).toEqual({ server: B, message: { type: "expert-offer-ended", v: PROTOCOL_VERSION, id: "office-2", why: "no-draft" } });
});

const make = (request: string, more: Partial<MakeExpertMessage> = {}): MakeExpertMessage => ({ type: "make-expert", v: PROTOCOL_VERSION, request, offer: "o1", key: "parser", subject: DRAFT.subject, model: "sonnet", project: PROJECT, area: ["src/parser"], proof: DRAFT.proof, by: { id: "claude:ada", name: "Ada" }, ...more });
const making = (h: Awaited<ReturnType<typeof harness>>, request: string) => h.sent.filter((s) => s.message.type === "expert-making" && s.message.request === request).map((s) => (s.message as { state: string; detail?: string }).detail ?? (s.message as { state: string }).state);

test("make-expert: only for this runner's person, a key not used here and a repo checked out here; each failing at once, saying why", async () => {
  const h = await harness();
  h.offers.take(0, dismissals());
  h.offers.take(0, make("m1", { offer: "o1", by: { id: "claude:bob", name: "Bob" } }));
  h.state.experts = [{ name: "parser", repo: "/work/app", subject: "x", state: "ready", senior: false }];
  h.offers.take(0, make("m2", { offer: "o2" }));
  h.state.experts = [];
  h.state.checkout = null;
  h.offers.take(0, make("m3", { offer: "o3" }));
  await until(() => ["m1", "m2", "m3"].every((m) => making(h, m).length === 1));
  expect(["m1", "m2", "m3"].map((m) => making(h, m)[0])).toEqual(["this computer's runner is someone else's, so it makes experts only for them", "an expert named parser is already on this computer", "this computer has no checkout of app"]);
  expect(fs.existsSync(path.join(h.isoplanDir, "experts", "parser.json"))).toBe(false);
});

test("make-expert: the expert file is written whole, and making is followed from its state: cloning, grounding, proof, ready; a reconnect holds the next state until the new connection's dismissals", async () => {
  const h = await harness();
  h.offers.take(0, dismissals());
  h.offers.take(0, make("m1"));
  const file = path.join(h.isoplanDir, "experts", "parser.json");
  await until(() => making(h, "m1").length === 1);
  const parsed = parseExpertFile(fs.readFileSync(file, "utf8"), file);
  expect(parsed).toMatchObject({ ok: true, unknown: [], expert: { name: "parser", repo: h.checkout, subject: DRAFT.subject, model: "sonnet", promoteAtTokens: SETTINGS.promoteAtTokens, proof: DRAFT.proof, areas: ["src/parser"] } });
  expect(fs.readdirSync(path.dirname(file))).toEqual(["parser.json"]);
  const stateFile = path.join(h.isoplanDir, "experts", "parser", "state.json");
  fs.mkdirSync(path.dirname(stateFile), { recursive: true });
  // A folder an earlier expert of that name left: its junior was grounded before this making began.
  const old = { n: 1, trunk: "t1", model: "claude-sonnet-5-5", commit: "b".repeat(40), groundedAt: 1, meter: 0, notes: 0, state: "junior" };
  const generation = (more: Record<string, unknown>) => fs.writeFileSync(stateFile, JSON.stringify({ version: 1, fingerprint: "f", repo: h.checkout, branch: "main", generations: [old, { n: 2, trunk: "t2", model: "claude-sonnet-5-5", commit: "", groundedAt: Date.now(), meter: 0, notes: 0, state: "grounding", ...more }] }));
  generation({});
  await until(() => making(h, "m1").length === 2);
  h.offers.linked(0);
  generation({ commit: "a".repeat(40) });
  await new Promise((r) => setTimeout(r, 50));
  expect(making(h, "m1")).toEqual(["cloning", "grounding"]);
  h.offers.take(0, dismissals());
  await until(() => making(h, "m1").length === 3);
  generation({ commit: "a".repeat(40), state: "junior", proof: { passed: true, at: 2 } });
  await until(() => making(h, "m1").length === 4);
  expect(making(h, "m1")).toEqual(["cloning", "grounding", "proof", "ready"]);
  expect(h.offers.idle()).toBe(true);
});

test("make-expert: a generation that failed its proof fails making, saying so", async () => {
  const h = await harness();
  h.offers.take(0, dismissals());
  h.offers.take(0, make("m1"));
  await until(() => making(h, "m1").length === 1);
  const stateFile = path.join(h.isoplanDir, "experts", "parser", "state.json");
  fs.mkdirSync(path.dirname(stateFile), { recursive: true });
  fs.writeFileSync(stateFile, JSON.stringify({ version: 1, fingerprint: "f", repo: h.checkout, branch: "main", generations: [{ n: 1, trunk: "t1", model: "m", commit: "a".repeat(40), groundedAt: Date.now(), meter: 0, notes: 0, state: "failed", proof: { passed: false, at: 2 } }] }));
  await until(() => making(h, "m1").length === 2);
  expect(h.sent.at(-1)!.message).toEqual({ type: "expert-making", v: PROTOCOL_VERSION, request: "m1", offer: "o1", state: "failed", detail: "its answer to the proof question didn't match the answer expected" });
});

test("make-expert: a runner started again goes on following the making it had under way, on its request; the same offer and key asked again takes that making over", async () => {
  const h = await harness();
  h.offers.take(0, dismissals());
  h.offers.take(0, make("m1"));
  await until(() => making(h, "m1").length === 1 && savedFile(h.isoplanDir)?.makings.length === 1);
  h.offers.close();
  const again = await harness({}, h.root);
  again.offers.take(0, dismissals());
  await until(() => making(again, "m1").length === 1);
  const stateFile = path.join(again.isoplanDir, "experts", "parser", "state.json");
  fs.mkdirSync(path.dirname(stateFile), { recursive: true });
  const generation = (more: Record<string, unknown>) => fs.writeFileSync(stateFile, JSON.stringify({ version: 1, fingerprint: "f", repo: again.checkout, branch: "main", generations: [{ n: 1, trunk: "t1", model: "m", commit: "", groundedAt: Date.now(), meter: 0, notes: 0, state: "grounding", ...more }] }));
  generation({});
  await until(() => making(again, "m1").length === 2);
  // The office asks again, as it does once a runner that went mid-making is back.
  again.offers.take(0, make("m2"));
  await until(() => making(again, "m2").length === 1);
  generation({ commit: "a".repeat(40), state: "junior", proof: { passed: true, at: 2 } });
  await until(() => making(again, "m2").length === 2);
  expect([making(again, "m1"), making(again, "m2")]).toEqual([["cloning", "grounding"], ["grounding", "ready"]]);
  await until(() => savedFile(again.isoplanDir)?.makings.length === 0);
});

test("corrected: unknown until the local model has said, one check at a time and at most checksPerHour; its word is kept", async () => {
  const asked: string[] = [];
  let answer: (v: boolean) => void = () => {};
  const h = await harness({
    settings: async () => ({ expertOffers: { ...SETTINGS, checksPerHour: 2 } }),
    corrects: (text) => (asked.push(text), new Promise((r) => (answer = r))),
  });
  expect(h.offers.corrected("k1", "no, the other file", "Here it is.")).toBe(null);
  expect(h.offers.corrected("k2", "wrong again", null)).toBe(null);
  expect(h.offers.corrected("k3", "and again", null)).toBe(null);
  await until(() => asked.length === 1);
  expect(h.offers.idle()).toBe(false);
  answer(true);
  await until(() => asked.length === 2);
  answer(false);
  await new Promise((r) => setTimeout(r, 30));
  expect(asked).toEqual(["no, the other file", "wrong again"]);
  expect([h.offers.corrected("k1", "", null), h.offers.corrected("k2", "", null), h.offers.corrected("k3", "", null)]).toEqual([true, false, null]);
});
