import { expect, test } from "vitest";
import type { ExpertCreationSuggestionLine } from "../lines.js";
import { expertCreationSuggestionStatusLineText, expertCreationSuggestionTranscriptText, readyNoteText } from "./text.js";

const line = (why: Partial<ExpertCreationSuggestionLine["why"]>, more: Partial<ExpertCreationSuggestionLine> = {}): ExpertCreationSuggestionLine => ({
  type: "expert-creation-suggestion",
  server: "ws://127.0.0.1:4747/data-layer",
  id: "o1",
  key: "parser",
  name: "Parser Expert",
  folder: "src/parser",
  url: "http://127.0.0.1:4747/?expert-creation-suggestion=o1",
  why: { share: 0, tokens: 0, minutes: 0, corrections: 0, ...why },
  ...more,
});
const reason = (l: ExpertCreationSuggestionLine) => expertCreationSuggestionTranscriptText(l).split(". A")[0];

test("the transcript line says what the session spent on the folder, and how often its person corrected it there", () => {
  expect(reason(line({ minutes: 1, share: 0.2, tokens: 40000, corrections: 2 }))).toBe("Isoplan: this session has spent about 1 minute and 20% of its context on src/parser, and you corrected it twice there");
  // Without a share of the context, the tokens.
  expect(reason(line({ tokens: 36400 }))).toBe("Isoplan: this session has spent about 36k tokens on src/parser");
  expect(reason(line({ corrections: 3 }))).toBe("Isoplan: you corrected this session 3 times while it worked in src/parser");
  // An office-wide suggestion whose session this runner has no signals for.
  expect(reason(line({}, { folder: "." }))).toBe("Isoplan: this session has searched the repo's top folder");
  expect(expertCreationSuggestionTranscriptText(line({ minutes: 12 }))).toBe("Isoplan: this session has spent about 12 minutes on src/parser. A Parser Expert could answer questions about src/parser without searching it again. Review it: http://127.0.0.1:4747/?expert-creation-suggestion=o1 (or type /isoplan:review-expert-suggestion)");
});

test("a session's suggestion says what was done there again: the file read most, how often and in how many sessions, with the files read again with it, or how often the folder was searched; then the share of the context and the corrections that passed", () => {
  const file = "docs/adr/0004-what-leaves-a-machine.md";
  const read = (more: object) => ({ folder: file, repetition: { readings: 4, sessions: 3, file, files: 1, ...more } });
  expect(expertCreationSuggestionTranscriptText(line({}, read({})))).toBe(`Isoplan: ${file} was read 4 times in 3 sessions. A Parser Expert could answer questions about ${file} without reading it again. Review it: http://127.0.0.1:4747/?expert-creation-suggestion=o1 (or type /isoplan:review-expert-suggestion)`);
  expect(expertCreationSuggestionTranscriptText(line({ share: 0.2 }, read({ sessions: 1, files: 3 })))).toBe(`Isoplan: this session read ${file} 4 times, 20% of its context, and 2 other files were read again with it. A Parser Expert could answer questions about ${file} and the 2 other files without reading them again. Review it: http://127.0.0.1:4747/?expert-creation-suggestion=o1 (or type /isoplan:review-expert-suggestion)`);
  expect(reason(line({ share: 0.2 }, read({ files: 2 })))).toBe(`Isoplan: ${file} was read 4 times in 3 sessions, 20% of this session's context, and 1 other file was read again with it`);
  expect(reason(line({ minutes: 12, corrections: 2 }, { repetition: { searches: 6 } }))).toBe("Isoplan: this session searched src/parser 6 times, about 12 minutes, and you corrected it twice there");
});

test("an office-wide suggestion's transcript line says how many sessions searched the folder, this week or in the last so many days", () => {
  expect(expertCreationSuggestionTranscriptText(line({ minutes: 12 }, { officeWideReason: { searchedBySessions: 3, searchWindowDays: 7 } }))).toBe("Isoplan: 3 sessions this week searched src/parser. A Parser Expert could answer questions about src/parser without searching it again. Review it: http://127.0.0.1:4747/?expert-creation-suggestion=o1 (or type /isoplan:review-expert-suggestion)");
  expect(reason(line({}, { folder: ".", officeWideReason: { searchedBySessions: 2, searchWindowDays: 14 } }))).toBe("Isoplan: 2 sessions in the last 14 days searched the repo's top folder");
});

test("a name that starts with a vowel takes an", () => {
  expect(expertCreationSuggestionStatusLineText(line({}, { key: "adr-0004", name: "Adr 0004 Expert" }))).toBe("An Adr 0004 Expert could help · review: http://127.0.0.1:4747/?expert-creation-suggestion=o1");
  expect(expertCreationSuggestionStatusLineText(line({}))).toBe("A Parser Expert could help · review: http://127.0.0.1:4747/?expert-creation-suggestion=o1");
});

test("the ready note names the expert, its name for ask_expert's expert, and the folder", () => {
  expect(readyNoteText({ type: "expert-ready", server: "s", id: "o1", key: "docs", name: "Docs Expert", folder: "." })).toBe("Isoplan: the Docs Expert is ready. Ask it with ask_expert, expert \"docs\", before you search the repo's top folder again.");
});
