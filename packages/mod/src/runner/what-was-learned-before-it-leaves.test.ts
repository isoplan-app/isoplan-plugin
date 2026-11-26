// The personal-data patterns a thing an instance learned is checked against before it leaves this
// computer (isoplan-app#366): the mod's personal-data-patterns.json, as the runner loads it.

import fs from "node:fs";
import path from "node:path";
import { expect, test } from "vitest";
import { modDir, tempRoot } from "../data-layer/fixture.js";
import { loadPatterns } from "./scan.js";
import { createCheckBeforeItLeaves } from "./what-was-learned-before-it-leaves.js";

const check = (person = path.join(tempRoot(), "personal-data-patterns.json")) =>
  createCheckBeforeItLeaves({ secretPatterns: async () => [], personalDataPatterns: () => loadPatterns(path.join(modDir, "personal-data-patterns.json"), person, () => {}) });

test("each default personal-data pattern matches its own example, and ordinary code facts match none", async () => {
  const c = check();
  const thing = (text: string) => c({ text, files: [{ path: "src/relay.ts" }] });
  for (const [text, pattern] of [
    ["Ask ada.lovelace+work@example.co.uk about it.", "email address"],
    ["Call +44 20 7946 0958 for the key.", "phone number"],
    ["Call 020 7946 0958 for the key.", "phone number"],
    ["Call (415) 555-0132 or 415-555-0132.", "phone number"],
    ["Its card is 4242 4242 4242 4242.", "payment card number"],
    ["Its card is 3782-822463-10005.", "payment card number"],
    ["Its SSN is 078-05-1120.", "US Social Security number"],
  ]) expect(await thing(text!), text).toEqual({ matched: "personal-data", pattern });
  for (const text of [
    "zod@4.1.5 and pnpm@9.0.0 are pinned; @isoplan/protocol@0.18.0 is the wire.",
    "The remote is git@github.com:isoplan-app/isoplan-app.git; logo@2x.png is the floor's.",
    "learnedAt is 1764163754123 in ms, at expert.ts:908-910.",
    "It ran 2026-11-26 at 17:09:13 and again 2026-11-26T17:09:13.000Z.",
    "Commit 676a4b783cb77b4d3a5dde5898ff6b587e66eff9, record 4f0c3a52-8a2b-4d6e-9f10-2b3c4d5e6f70.",
    "The office listens on 127.0.0.1 and 192.168.1.100.",
  ]) expect(await thing(text), text).toEqual({ ok: true });
});

test("a pattern the person adds is used at the next check; a person's file that can't be read sends nothing", async () => {
  const person = path.join(tempRoot(), "personal-data-patterns.json");
  const c = check(person);
  const thing = { text: "Ask about project NIGHTJAR.", files: [{ path: "src/relay.ts" }] };
  expect(await c(thing)).toEqual({ ok: true });
  fs.writeFileSync(person, JSON.stringify({ patterns: [{ name: "code name", regex: "NIGHTJAR" }] }));
  expect(await c(thing)).toEqual({ matched: "personal-data", pattern: "code name" });
  fs.writeFileSync(person, "{");
  expect(await c(thing)).toEqual({ unreadable: true });
});
