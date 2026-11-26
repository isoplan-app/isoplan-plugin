import fs from "node:fs";
import path from "node:path";
import { expect, test } from "vitest";
import { tempRoot } from "../data-layer/fixture.js";
import { createJobsStartedByHand, type Rhythm } from "./jobs-started-by-hand.js";

const DAY = 24 * 3600000;
const NOW = new Date(2026, 10, 26, 12, 0).getTime();

function setUp() {
  const root = tempRoot();
  const claudeDir = path.join(root, "claude");
  fs.mkdirSync(path.join(claudeDir, "skills", "outreach"), { recursive: true });
  const offered: { job: string; rhythm: Rhythm }[] = [];
  const j = createJobsStartedByHand({
    file: path.join(claudeDir, "isoplan", "runner", "jobs-started-by-hand.json"),
    claudeDir,
    settings: async () => ({ offerAfter: { daysOfTheLastSeven: 4, weeksRunning: 3 }, rememberStartsDays: 30 }),
    helperPrompts: async () => ["Summarise this diff"],
    now: () => NOW,
    onRhythm: (job, rhythm) => void offered.push({ job, rhythm }),
    log: () => {},
  });
  let n = 0;
  const started = (daysAgo: number, messages: ({ command: string } | { prompt: string })[]) => j.seen({ server: "ws://office", bare: `s${++n}`, cwd: root, project: { id: "github.com/acme/docs" }, at: NOW - daysAgo * DAY, messages });
  return { j, offered, started };
}

test("a skill started on 4 of the last 7 days crosses its rhythm, a built-in before it skipped; 3 of 7 doesn't; weekly for 3 weeks does; prompts differing in a word don't match, and a helper prompt never counts", async () => {
  const s = setUp();
  for (const d of [0, 1, 3]) await s.started(d, [{ command: "model" }, { command: "outreach" }]);
  expect(s.offered).toEqual([]);
  await s.started(5, [{ command: "outreach" }]);
  expect(s.offered).toEqual([{ job: "skill:outreach", rhythm: { kind: "days", days: 4 } }]);

  const w = setUp();
  for (const d of [1, 9, 16]) await w.started(d, [{ prompt: "Draft the   weekly UPDATE for the team." }]);
  expect(w.offered.map((x) => x.rhythm)).toEqual([{ kind: "weeks", weeks: 3 }]);

  const p = setUp();
  for (const [d, words] of [[0, "Find ten agencies in Bristol."], [1, "Find ten agencies in Leeds."], [2, "Find ten agencies in Bath."], [3, "Find ten agencies in York."]] as const) await p.started(d, [{ prompt: words }]);
  for (const d of [0, 1, 2, 3]) await p.started(d, [{ prompt: "Summarise this diff for me." }]);
  // A command that isn't the person's skill is a built-in: skipped, so the prompt after it decides.
  for (const d of [0, 1, 2]) await p.started(d, [{ command: "effort" }, { prompt: "Check the inbox." }]);
  expect(p.offered).toEqual([]);
});
