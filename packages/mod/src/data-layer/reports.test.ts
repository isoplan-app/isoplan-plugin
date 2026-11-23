import fs from "node:fs";
import path from "node:path";
import { MAX_REPORT_LENGTH, type Facts } from "@isoplan/protocol";
import { expect, test } from "vitest";
import { loadPatterns, scan } from "../runner/scan.js";
import { at, modDir, tempRoot } from "./fixture.js";
import { cutReport, openReportHold, releasedPath, WITHHELD_TEXT } from "./reports.js";

const patterns = await loadPatterns(path.join(modDir, "secret-patterns.json"), path.join(modDir, "missing.json"), () => {});
const KEY = "aws_access_key_id = AKIAIOSFODNN7EXAMPLE";

const factsWith = (reports: Facts["reports"]): Facts => ({
  session: { id: "claude-code:s1", source: "claude-code", lead: "claude-code:s1:lead", title: null, titleFrom: "branch", branch: "main", lastActive: at(0), status: "active", lights: "on" },
  agents: [],
  edits: [],
  reads: [],
  waits: [],
  reports,
});

async function open(file = path.join(tempRoot(), "released", "s1.json")) {
  const logs: string[] = [];
  return { hold: await openReportHold(file, (t) => logs.push(t)), logs, file };
}

test("reports: one the scan matches goes out held, with the owner told in the log once; the rest go as they are", async () => {
  const { hold, logs } = await open();
  const facts = factsWith([
    { agent: "claude-code:a1", at: at(5), text: `Set it up: ${KEY}` },
    { agent: "claude-code:a2", at: at(5), text: "Coverage is 81%." },
  ]);
  const sent = hold.apply(facts, patterns);
  expect(sent.reports).toEqual([{ agent: "claude-code:a1", at: at(5), text: WITHHELD_TEXT, withheld: { id: expect.any(String) } }, facts.reports[1]]);
  expect(hold.apply(facts, patterns).reports[0]!.withheld).toEqual(sent.reports[0]!.withheld);
  expect(logs).toEqual(['withheld the report of claude-code:a1: it matches the secret pattern "AWS access key id"; its owner can release it from the floor']);
  expect(hold.apply(factsWith([facts.reports[1]!]), patterns)).toEqual(factsWith([facts.reports[1]!]));
});

test("reports: a released report is sent, and stays released after a restart; a new report of the same agent is scanned afresh", async () => {
  const { hold, file } = await open();
  const report = { agent: "claude-code:a1", at: at(5), text: `Set it up: ${KEY}` };
  const { id } = hold.apply(factsWith([report]), patterns).reports[0]!.withheld!;
  expect(await hold.release(id)).toBe(true);
  expect(hold.apply(factsWith([report]), patterns).reports).toEqual([report]);
  expect(hold.apply(factsWith([report]), null).reports).toEqual([report]);
  expect(fs.readFileSync(file, "utf8")).not.toContain("AKIA");

  const again = (await open(file)).hold;
  expect(again.apply(factsWith([report]), patterns).reports).toEqual([report]);
  const next = { ...report, at: at(1), text: `And another: ghp_${"a1B2c3D4e5".repeat(4)}` };
  expect(again.apply(factsWith([next]), patterns).reports[0]!.withheld).toBeDefined();
});

test("reports: a release lets out only the report it names; a newer report of the same agent stays held", async () => {
  const { hold, logs, file } = await open();
  const first = { agent: "claude-code:a1", at: at(5), text: `Set it up: ${KEY}` };
  const { id } = hold.apply(factsWith([first]), patterns).reports[0]!.withheld!;
  const newer = { ...first, at: at(1), text: `Now with ${KEY.replace("EXAMPLE", "EXAMPLF")}` };
  const sent = hold.apply(factsWith([newer]), patterns).reports[0]!;
  expect(sent.withheld!.id).not.toBe(id);
  expect(await hold.release(id)).toBe(false);
  expect(logs.at(-1)).toContain("none is held under that id here");
  expect(hold.apply(factsWith([newer]), patterns).reports[0]).toEqual(sent);
  expect(await hold.release("claude-code:a1")).toBe(false);
  expect(fs.existsSync(file)).toBe(false);
});

test("reports: two agents with the same text are held apart, and a release lets out only the one it names", async () => {
  const { hold, file } = await open();
  const one = { agent: "claude-code:a1", at: at(5), text: `Set it up: ${KEY}` };
  const two = { ...one, agent: "claude-code:a2" };
  const [held1, held2] = hold.apply(factsWith([one, two]), patterns).reports;
  expect(held1!.withheld!.id).not.toBe(held2!.withheld!.id);
  expect(await hold.release(held1!.withheld!.id)).toBe(true);
  expect(hold.apply(factsWith([one, two]), patterns).reports).toEqual([one, held2]);
  expect((await open(file)).hold.apply(factsWith([one, two]), patterns).reports[1]).toMatchObject({ agent: "claude-code:a2", text: WITHHELD_TEXT });
});

test("reports: with no patterns to read, every report is held", async () => {
  const { hold, logs } = await open();
  const sent = hold.apply(factsWith([{ agent: "claude-code:a2", at: at(5), text: "Coverage is 81%." }]), null);
  expect(sent.reports[0]).toMatchObject({ text: WITHHELD_TEXT, withheld: { id: expect.any(String) } });
  expect(logs[0]).toContain("the secret patterns couldn't be read");
});

test("reports: a release on one office's floor lets the report out to that office alone, and each office keeps its own after a restart (#105)", async () => {
  const claudeDir = tempRoot();
  const internal = { server: "wss://isoplan-internal.example/data-layer" };
  const dev = { server: "ws://127.0.0.1:4747/data-layer", legacy: true };
  // The office a version before #105 reports to keeps the old place; any other has its own.
  expect(releasedPath(claudeDir, dev, "s1")).toBe(path.join(claudeDir, "isoplan", "released", "s1.json"));
  expect(releasedPath(claudeDir, internal, "s1")).toBe(path.join(claudeDir, "isoplan", "offices", path.basename(path.dirname(path.dirname(releasedPath(claudeDir, internal, "s1")))), "released", "s1.json"));
  expect(path.basename(path.dirname(path.dirname(releasedPath(claudeDir, internal, "s1"))))).toMatch(/^[0-9a-f]{12}$/);
  const facts = factsWith([{ agent: "claude-code:a1", at: at(5), text: `Set it up: ${KEY}` }]);
  const a = await open(releasedPath(claudeDir, internal, "s1"));
  const b = await open(releasedPath(claudeDir, dev, "s1"));
  const held = a.hold.apply(facts, patterns).reports[0]!.withheld!.id;
  expect(b.hold.apply(facts, patterns).reports[0]!.text).toBe(WITHHELD_TEXT);
  expect(await a.hold.release(held)).toBe(true);
  expect(a.hold.apply(facts, patterns).reports[0]!.text).toBe(facts.reports[0]!.text);
  expect(b.hold.apply(facts, patterns).reports[0]!.text).toBe(WITHHELD_TEXT);
  const again = { a: await open(releasedPath(claudeDir, internal, "s1")), b: await open(releasedPath(claudeDir, dev, "s1")) };
  expect(again.a.hold.apply(facts, patterns).reports[0]!.text).toBe(facts.reports[0]!.text);
  expect(again.b.hold.apply(facts, patterns).reports[0]!.text).toBe(WITHHELD_TEXT);
});

test("a report past MAX_REPORT_LENGTH is cut at the last whitespace that fits, so a secret across the limit is left out whole; with none, at the limit", () => {
  const report = { agent: "claude-code:a1", at: at(5), text: "x".repeat(MAX_REPORT_LENGTH) };
  expect(cutReport(report)).toBe(report);
  // Cut at the limit, this would keep "postgres://admin:hunter2hunter", which no pattern matches.
  const text = `${"x".repeat(MAX_REPORT_LENGTH - 32)} postgres://admin:hunter2hunter2@db.example.com/app and the rest`;
  expect(scan(text.slice(0, MAX_REPORT_LENGTH - 1), patterns)).toBeNull();
  expect(cutReport({ ...report, text })).toEqual({ ...report, text: "x".repeat(MAX_REPORT_LENGTH - 32) + "…", cut: true });
  expect(cutReport({ ...report, text: "x".repeat(MAX_REPORT_LENGTH + 1) }).text).toBe("x".repeat(MAX_REPORT_LENGTH - 1) + "…");
  expect(cutReport({ ...report, text: "x".repeat(MAX_REPORT_LENGTH - 2) + "\u{1F600}x" }).text).toBe("x".repeat(MAX_REPORT_LENGTH - 2) + "…");
});
