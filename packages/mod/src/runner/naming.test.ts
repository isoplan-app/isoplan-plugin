import fs from "node:fs";
import path from "node:path";
import { expect, test } from "vitest";
import { tempRoot } from "../data-layer/fixture.js";
import { createNamer, nameFrom, namingArgs } from "./naming.js";

// A stand-in for `claude -p --output-format json`: it logs its argv, folder and stdin, then answers
// as the probe in naming.ts found it, or, with FAKE_HANG, never.
const FAKE = `
import fs from "node:fs";
let input = "";
process.stdin.setEncoding("utf8").on("data", (d) => (input += d)).on("end", () => {
  fs.writeFileSync(process.env.FAKE_LOG, JSON.stringify({ argv: process.argv.slice(2), cwd: process.cwd(), input }));
  if (process.env.FAKE_HANG) return setInterval(() => {}, 1000);
  process.stdout.write(JSON.stringify({ type: "result", subtype: "success", is_error: false, num_turns: 1, result: '"Fix login 500 for plus-sign emails."\\nMore' }));
});
`;

test("name: the command line is pinned: no tools, settings, MCP servers or saved session, the model and the prompt given", () => {
  expect(namingArgs("haiku", "Name it.")).toEqual(["-p", "--no-session-persistence", "--tools", "", "--setting-sources", "", "--strict-mcp-config", "--model", "haiku", "--system-prompt", "Name it.", "--output-format", "json"]);
});

test("name: the result's first line, unquoted, with no full stop; a failure or an output that isn't the result gives none", () => {
  expect(nameFrom(JSON.stringify({ type: "result", subtype: "success", is_error: false, result: '"Fix the login page."\nMore' }))).toBe("Fix the login page");
  expect(nameFrom(JSON.stringify({ type: "result", subtype: "error_during_execution", is_error: true, result: "x" }))).toBeNull();
  expect(nameFrom(JSON.stringify({ type: "result", subtype: "success", is_error: false, result: "  " }))).toBeNull();
  expect(nameFrom("Not JSON")).toBeNull();
});

test("name: runs hidden in the folder given, with the instruction on stdin, and gives the name; one past namingTimeoutSeconds is ended and gives none", async () => {
  const root = tempRoot();
  const bin = path.join(root, "fake-claude.js");
  fs.writeFileSync(bin, FAKE);
  const log = path.join(root, "log.json");
  const logs: string[] = [];
  const namer = (env: Record<string, string>, namingTimeoutSeconds = 20) =>
    createNamer({ binary: async () => bin, settings: async () => ({ namingModel: "haiku", namingTimeoutSeconds }), system: async () => "Name it.\n", log: (t) => void logs.push(t), cwd: root, env: { ...process.env, FAKE_LOG: log, ...env } });
  const first = await namer({}).name("The login page throws a 500.");
  expect(logs).toEqual([]);
  expect(first).toBe("Fix login 500 for plus-sign emails");
  const said = JSON.parse(fs.readFileSync(log, "utf8"));
  expect(said.argv).toEqual(namingArgs("haiku", "Name it."));
  expect(fs.realpathSync(said.cwd)).toBe(fs.realpathSync(root));
  expect(said.input).toBe("Instruction:\nThe login page throws a 500.");
  expect(await namer({ FAKE_HANG: "1" }, 0.5).name("Hang")).toBeNull();
  expect(logs.at(-1)).toContain("longer than 0.5 s");
  expect(await createNamer({ binary: async () => null, settings: async () => ({ namingModel: "haiku", namingTimeoutSeconds: 1 }), system: async () => "", log: () => {} }).name("x")).toBeNull();
});
