import { expect, test } from "vitest";
import type { ExpertOfferLine } from "../lines.js";
import { offerStatusText, offerTranscriptText, readyNoteText } from "./text.js";

const line = (why: Partial<ExpertOfferLine["why"]>, more: Partial<ExpertOfferLine> = {}): ExpertOfferLine => ({
  type: "expert-offer",
  server: "ws://127.0.0.1:4747/data-layer",
  id: "o1",
  key: "parser",
  name: "Parser Expert",
  folder: "src/parser",
  url: "http://127.0.0.1:4747/?offer=o1",
  why: { share: 0, tokens: 0, minutes: 0, corrections: 0, ...why },
  ...more,
});
const reason = (l: ExpertOfferLine) => offerTranscriptText(l).split(". A")[0];

test("the transcript line says what the session spent on the folder, and how often its person corrected it there", () => {
  expect(reason(line({ minutes: 1, share: 0.2, tokens: 40000, corrections: 2 }))).toBe("Isoplan: this session has spent about 1 minute and 20% of its context on src/parser, and you corrected it twice there");
  // Without a share of the context, the tokens.
  expect(reason(line({ tokens: 36400 }))).toBe("Isoplan: this session has spent about 36k tokens on src/parser");
  expect(reason(line({ corrections: 3 }))).toBe("Isoplan: you corrected this session 3 times while it worked in src/parser");
  // An office-wide offer whose session this runner has no signals for.
  expect(reason(line({}, { folder: "." }))).toBe("Isoplan: this session has searched the repo's top folder");
  expect(offerTranscriptText(line({ minutes: 12 }))).toBe("Isoplan: this session has spent about 12 minutes on src/parser. A Parser Expert would answer the next question in seconds. Review it: http://127.0.0.1:4747/?offer=o1 (or type /isoplan:expert)");
});

test("a name that starts with a vowel takes an", () => {
  expect(offerStatusText(line({}, { key: "adr-0004", name: "Adr 0004 Expert" }))).toBe("An Adr 0004 Expert could help · review: http://127.0.0.1:4747/?offer=o1");
  expect(offerStatusText(line({}))).toBe("A Parser Expert could help · review: http://127.0.0.1:4747/?offer=o1");
});

test("the ready note names the expert, its key for ask_expert, and the folder", () => {
  expect(readyNoteText({ type: "expert-ready", server: "s", id: "o1", key: "docs", name: "Docs Expert", folder: "." })).toBe("Isoplan: the Docs Expert is ready. Ask it (ask_expert, key docs) before you search the repo's top folder again.");
});
