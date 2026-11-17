import fs from "node:fs";
import path from "node:path";
import { expect, test } from "vitest";
import { tempRoot } from "../data-layer/fixture.js";
import { createHealthLog, healthLine } from "./expert-health.js";

test("health log: a line per event, values with spaces, quotes or equals signs JSON-quoted, in the order said", async () => {
  const file = path.join(tempRoot(), "logs", "expert-adr.log");
  const health = createHealthLog(file, () => Date.parse("2026-11-17T10:00:00Z"));
  health.say("grounding", { generation: 1, trunk: "e8fd707b", meter: 120000, ok: true });
  health.say("proof", { generation: 1, result: "pass", expected: 'it says "no"', answer: "a=b", judge: "" });
  await health.flushed();
  expect(fs.readFileSync(file, "utf8")).toBe(
    '2026-11-17T10:00:00.000Z grounding generation=1 trunk=e8fd707b meter=120000 ok=true\n2026-11-17T10:00:00.000Z proof generation=1 result=pass expected="it says \\"no\\"" answer="a=b" judge=""\n',
  );
  // A value with a line break stays on one line.
  expect(healthLine("error", { cause: "one\ntwo" })).toBe('error cause="one\\ntwo"');
});

test("health log: starts over once it passes 1 MB", async () => {
  const file = path.join(tempRoot(), "expert-adr.log");
  fs.writeFileSync(file, "x".repeat(1024 * 1024 + 1));
  const health = createHealthLog(file);
  health.say("fetch", { error: "offline" });
  await health.flushed();
  expect(fs.readFileSync(file, "utf8")).toMatch(/^\S+ fetch error=offline\n$/);
});
