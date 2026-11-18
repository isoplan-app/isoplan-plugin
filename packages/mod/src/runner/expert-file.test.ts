import path from "node:path";
import { expect, test } from "vitest";
import { EXPERT_DEFAULTS, parseExpertFile } from "./expert-file.js";

const REPO = path.resolve("/work/isoplan-app");

// The design's example (docs/designs/agent-expertise.md), with this machine's form of its path.
const EXAMPLE = {
  version: 1,
  name: "what-leaves-a-machine",
  repo: REPO,
  subject:
    "What session text may leave a person's machine and under what rules (ADR 0004), and how one session asks another (asks.ts). Ask before you add anything that sends data off a machine or stores session text on the office server.",
  model: "sonnet",
  promoteAtTokens: 45000,
  forkTimeLimitMinutes: 5,
  caps: { perAskerPerDay: 30, openPerAsker: 3, tokenBudgetPerDay: 2000000 },
  proof: {
    question: "If a session runs in a repo the office doesn't take, what does the plugin send to the office server about it?",
    answer: "Nothing at all, not even its hello or its repo's id.",
  },
};
const parse = (value: unknown, file = "what-leaves-a-machine.json") => parseExpertFile(JSON.stringify(value), file);

test("expert file: the design's example is valid as written", () => {
  expect(parse(EXAMPLE)).toEqual({
    ok: true,
    unknown: [],
    expert: { ...EXAMPLE, groundingTimeLimitMinutes: 15, fetchSeconds: 60, maxForks: 3, areas: [] },
  });
});

test("expert file: an older one, with no optional fields, takes the defaults", () => {
  const { forkTimeLimitMinutes: _, caps: __, ...bare } = EXAMPLE;
  const parsed = parse({ ...bare, window: 400000, areas: ["packages/server/src/asks.ts"] });
  expect(parsed).toMatchObject({ ok: true, expert: { ...EXPERT_DEFAULTS, window: 400000, areas: ["packages/server/src/asks.ts"] } });
});

test("expert file: each broken field is named with why", () => {
  const broken: [Record<string, unknown>, string, RegExp][] = [
    [{ version: 2 }, "version", /written for a newer runner/],
    [{ version: "1" }, "version", /must be 1/],
    [{ name: "What" }, "name", /lowercase letters/],
    [{ repo: "isoplan-app" }, "repo", /full path/],
    [{ repo: undefined }, "repo", /is required/],
    [{ subject: "   " }, "subject", /isn't empty/],
    [{ subject: "x".repeat(1001) }, "subject", /at most 1000/],
    [{ model: "--resume" }, "model", /not starting with -/],
    [{ promoteAtTokens: 0 }, "promoteAtTokens", /at least 1/],
    [{ promoteAtTokens: 1.5 }, "promoteAtTokens", /whole number/],
    [{ fetchSeconds: -1 }, "fetchSeconds", /at least 0/],
    [{ maxForks: 0 }, "maxForks", /at least 1/],
    [{ caps: { openPerAsker: 0 } }, "caps.openPerAsker", /at least 1/],
    [{ window: 99999 }, "window", /at least 100000/],
    [{ proof: { question: "Why?" } }, "proof.answer", /is required/],
    [{ areas: "src/**" }, "areas", /list of globs/],
  ];
  for (const [change, field, reason] of broken) {
    const parsed = parse({ ...EXAMPLE, ...change });
    expect(parsed, field).toMatchObject({ ok: false, field });
    if (!parsed.ok) expect(parsed.reason).toMatch(reason);
  }
  expect(parseExpertFile("{", "a.json")).toMatchObject({ ok: false, field: "(file)", reason: expect.stringMatching(/isn't valid JSON/) });
  // fetchSeconds 0 fetches before every question.
  expect(parse({ ...EXAMPLE, fetchSeconds: 0 })).toMatchObject({ ok: true, expert: { fetchSeconds: 0 } });
});

test("expert file: an unknown field is reported, not fatal", () => {
  expect(parse({ ...EXAMPLE, colour: "red", caps: { perAskerPerHour: 3 }, proof: { ...EXAMPLE.proof, hint: "ADR" } })).toMatchObject({ ok: true, unknown: ["colour", "caps.perAskerPerHour", "proof.hint"] });
});

test("expert file: its name must be the file's", () => {
  expect(parse(EXAMPLE, path.join("experts", "adr.json"))).toEqual({ ok: false, field: "name", reason: 'is "what-leaves-a-machine", but the file is adr.json; they must be the same' });
});
