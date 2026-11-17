import fs from "node:fs";
import path from "node:path";
import { expect, test } from "vitest";
import { tempRoot } from "../data-layer/fixture.js";
import { parseExpertFile, type ExpertFile } from "./expert-file.js";
import { fingerprint, indexPath, readIndex, readState, statePath, writeIndex, writeState, type SavedExpert } from "./expert-state.js";

const STATE: SavedExpert = {
  version: 1,
  fingerprint: "f",
  repo: "/work/app",
  branch: "main",
  generations: [{ n: 1, trunk: "0b6c3e0e-8f4e-4c39-9d1b-6f2a3f3e9c11", model: "claude-sonnet-5-5", commit: "a".repeat(40), groundedAt: 1, meter: 31000, notes: 2, state: "junior", proof: { passed: true, at: 2 } }],
};

test("state: written and read back; missing or broken reads as none, and no temporary file is left", async () => {
  const dir = path.join(tempRoot(), "adr");
  expect(await readState(dir)).toBe(null);
  await writeState(dir, STATE);
  expect(await readState(dir)).toEqual(STATE);
  expect(fs.readdirSync(dir)).toEqual(["state.json"]);
  fs.writeFileSync(statePath(dir), JSON.stringify({ ...STATE, generations: [{ ...STATE.generations[0], state: "lead" }] }));
  expect(await readState(dir)).toBe(null);
  fs.writeFileSync(statePath(dir), "{");
  expect(await readState(dir)).toBe(null);
});

test("index: a generation's file → commit sidecar, versioned", async () => {
  const dir = path.join(tempRoot(), "adr");
  expect(await readIndex(dir, 1)).toEqual({});
  await writeIndex(dir, 1, { "docs/adr/0004.md": "a".repeat(40) });
  expect(JSON.parse(fs.readFileSync(indexPath(dir, 1), "utf8"))).toEqual({ version: 1, files: { "docs/adr/0004.md": "a".repeat(40) } });
  expect(await readIndex(dir, 1)).toEqual({ "docs/adr/0004.md": "a".repeat(40) });
  expect(await readIndex(dir, 2)).toEqual({});
});

test("fingerprint: repo, subject, model, proof and window change it; other fields don't", () => {
  const file = (change: Record<string, unknown> = {}) => {
    const parsed = parseExpertFile(JSON.stringify({ version: 1, name: "adr", repo: path.resolve("/work/app"), subject: "ADR 0004", model: "sonnet", promoteAtTokens: 45000, proof: { question: "q", answer: "a" }, ...change }), "adr.json");
    if (!parsed.ok) throw new Error(parsed.reason);
    return parsed.expert as ExpertFile;
  };
  const base = fingerprint(file());
  expect(fingerprint(file({ promoteAtTokens: 60000, maxForks: 1, caps: { openPerAsker: 1 } }))).toBe(base);
  for (const change of [{ repo: path.resolve("/work/other") }, { subject: "ADR 0005" }, { model: "opus" }, { proof: { question: "q", answer: "b" } }, { window: 200000 }]) expect(fingerprint(file(change))).not.toBe(base);
});
