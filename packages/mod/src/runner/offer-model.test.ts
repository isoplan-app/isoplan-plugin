import fs from "node:fs";
import path from "node:path";
import { expect, test } from "vitest";
import { tempRoot } from "../data-layer/fixture.js";
import { createOfferModel, draftFrom, draftInput, offerModelArgs, verdictFrom } from "./offer-model.js";

// A stand-in for `claude -p --output-format json`: it logs its argv, folder and stdin, then answers
// FAKE_RESULT as a result, or, with FAKE_HANG, never.
const FAKE = `
import fs from "node:fs";
let input = "";
process.stdin.setEncoding("utf8").on("data", (d) => (input += d)).on("end", () => {
  fs.writeFileSync(process.env.FAKE_LOG, JSON.stringify({ argv: process.argv.slice(2), cwd: process.cwd(), input }));
  if (process.env.FAKE_HANG) return setInterval(() => {}, 1000);
  process.stdout.write(JSON.stringify({ type: "result", subtype: "success", is_error: false, num_turns: 1, result: process.env.FAKE_RESULT }));
});
`;

const settings = { draftModel: "haiku", timeoutSeconds: 20 };
const project = { id: "github.com/team/app", name: "app" };

test("offer model: the command line is pinned: no tools, settings, hooks, MCP servers or saved session, the model and the prompt given", () => {
  expect(offerModelArgs("haiku", "Check it.")).toEqual(["-p", "--no-session-persistence", "--tools", "", "--setting-sources", "", "--settings", '{"disableAllHooks":true}', "--strict-mcp-config", "--model", "haiku", "--system-prompt", "Check it.", "--output-format", "json"]);
});

test("offer model: the check's YES or NO; a draft's one JSON object, its key made an expert's name, or none when a field is missing or too long", () => {
  expect([verdictFrom("YES"), verdictFrom("no."), verdictFrom("Maybe")]).toEqual([true, false, null]);
  const draft = { key: "Parser Rules", subject: " How the parser reads a file. ", proof: { question: "Where does it start?", answer: "parse.ts" } };
  expect(draftFrom("```json\n" + JSON.stringify(draft) + "\n```")).toEqual({ key: "parser-rules", subject: "How the parser reads a file.", proof: { question: "Where does it start?", answer: "parse.ts" } });
  expect(draftFrom(JSON.stringify({ ...draft, key: "../etc" }))).toBe(null);
  expect(draftFrom(JSON.stringify({ ...draft, subject: "x".repeat(1001) }))).toBe(null);
  expect(draftFrom(JSON.stringify({ ...draft, proof: { question: "q" } }))).toBe(null);
  expect(draftFrom("no JSON here")).toBe(null);
});

test("offer model: each call runs hidden in the folder given with its input on stdin and its own prompt; one past timeoutSeconds is ended and gives no word", async () => {
  const root = tempRoot();
  const bin = path.join(root, "fake-claude.js");
  fs.writeFileSync(bin, FAKE);
  const log = path.join(root, "log.json");
  const logs: string[] = [];
  const model = (env: Record<string, string>) =>
    createOfferModel({ binary: async () => bin, prompt: async (name) => `Prompt ${name}\n`, log: (t) => void logs.push(t), cwd: root, env: { ...process.env, FAKE_LOG: log, ...env } });
  expect(await model({ FAKE_RESULT: "YES" }).corrects("No, the other file.", "Here it is.", settings)).toBe(true);
  let said = JSON.parse(fs.readFileSync(log, "utf8"));
  expect(said.argv).toEqual(offerModelArgs("haiku", "Prompt correction.md"));
  expect(fs.realpathSync(said.cwd)).toBe(fs.realpathSync(root));
  expect(said.input).toBe("The agent's reply:\nHere it is.\n\nThe person's next message:\nNo, the other file.");

  const input = { project, folder: "src/parser", files: ["src/parser/parse.ts"], excerpts: [{ file: "src/parser/parse.ts", text: "export function parse() {}" }], said: ["Asked: how does it parse?"] };
  const reply = JSON.stringify({ key: "parser", subject: "The parser.", proof: { question: "Where?", answer: "parse.ts" } });
  expect(await model({ FAKE_RESULT: reply }).draft(input, settings)).toEqual({ key: "parser", subject: "The parser.", proof: { question: "Where?", answer: "parse.ts" } });
  said = JSON.parse(fs.readFileSync(log, "utf8"));
  expect(said.argv).toEqual(offerModelArgs("haiku", "Prompt expert-draft.md"));
  expect(said.input).toBe(draftInput(input));
  expect(said.input).toContain("Folder: src/parser\n\nIts files (1):\nsrc/parser/parse.ts\n\nThe start of some of them:\n=== src/parser/parse.ts\nexport function parse() {}\n\n");

  expect(await model({ FAKE_HANG: "1" }).corrects("x", null, { ...settings, timeoutSeconds: 0.5 })).toBe(null);
  expect(logs.at(-1)).toContain("longer than 0.5 s");
  expect(await createOfferModel({ binary: async () => null, prompt: async () => "", log: () => {} }).draft(input, settings)).toBe(null);
});
