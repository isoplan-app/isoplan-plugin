import path from "node:path";
import type { AgentFact, Facts } from "@isoplan/protocol";
import { expect, test } from "vitest";
import { loadPatterns } from "../runner/scan.js";
import { cleanTitle, nextTitle, prepareTitle, titleInputs, titleKey } from "./titles.js";
import { WORKFLOW_WITHHELD } from "./workflows.js";
import { tempRoot, gitRepo, line, session, agent, factsOf, modDir } from "./fixture.js";

test("the prompt holds the branch, edited files, agent types and tasks, and never a user line's text", async () => {
  const root = tempRoot();
  const home = path.join(root, "home");
  const main = gitRepo(path.join(root, "repo"), "main");
  const secret = "my bank PIN is 4921, please refactor the wizard";
  session(home, "s", [line.user(main, secret, 60, { gitBranch: "fix/wizard" }), line.tool(main, "Edit", { file_path: path.join(main, "lib", "wizard.mjs") }, 50)]);
  agent(home, "s", "w", { agentType: "worker", description: "Split the wizard steps" }, [line.user(main, secret, 20), line.tool(main, "Write", { file_path: path.join(main, "lib", "steps.mjs") }, 10)], { age: 10 });

  const ask = nextTitle(await factsOf(home, "s"), null, 0, [])!;
  expect(ask.prompt).toBe(["Branch: fix/wizard", "Files edited:", "- lib/steps.mjs", "- lib/wizard.mjs", "Agent types: worker", "Subagent tasks:", "- Split the wizard steps"].join("\n"));
  expect(ask.prompt).not.toMatch(/4921|bank/);
});

const at = "2026-10-09T12:00:00.000Z";
const worker = (task: string): AgentFact => ({
  id: "claude-code:w1",
  source: "claude-code",
  session: "claude-code:s",
  startedBy: "claude-code:s:lead",
  agentType: "worker",
  task,
  status: "working",
  statusSince: at,
  lastActive: at,
  doing: null,
  usage: null,
});
const facts = (titleFrom: "source" | "branch", task: string): Facts => ({
  session: { id: "claude-code:s", source: "claude-code", lead: "claude-code:s:lead", title: "fix/wizard", titleFrom, branch: "fix/wizard", lastActive: at, status: "active", lights: "on" },
  agents: [worker(task)],
  edits: [],
  reads: [],
  waits: [],
  reports: [],
});

test("cache: asks only for a branch stand-in, again only when the inputs change, at most once per 10 minutes", () => {
  expect(nextTitle(facts("source", "Named by Claude Code"), null, 0, [])).toBe(null);

  const f = facts("branch", "Fix the wizard");
  const first = nextTitle(f, null, 0, [])!;
  expect(first.key).toBe(titleKey(titleInputs(f)));
  const cache = { key: first.key, title: "Fixing the wizard", at: 0 };
  expect(nextTitle(f, cache, 60 * 60000, [])).toBe(null); // same inputs: no new call

  const changed = facts("branch", "Test the wizard");
  expect(nextTitle(changed, cache, 9 * 60000, [])).toBe(null); // changed, but inside 10 minutes
  expect(nextTitle(changed, cache, 10 * 60000, [])).not.toBe(null);
});

test("a reply becomes a title: its first line, unquoted; empty is none", () => {
  expect(cleanTitle('\n"Fixing the setup wizard."\nmore')).toBe("Fixing the setup wizard");
  expect(cleanTitle("  \n ")).toBe(null);
  expect(cleanTitle("x".repeat(80))!.length).toBe(60);
});

test("an input the secret scan matches is left out of the title call, and a title it matches goes out hidden; with the patterns unreadable there is no call and every title is hidden (#189)", async () => {
  const secret = "AKIAABCDEFGHIJKLMNOP";
  const patterns = await loadPatterns(path.join(modDir, "secret-patterns.json"), path.join(tempRoot(), "none.json"), () => {});
  const f: Facts = { ...facts("branch", ""), agents: [worker(`push with ${secret}`), { ...worker("Fix the wizard"), id: "claude-code:w2" }] };
  expect(nextTitle(f, null, 0, patterns)!.prompt).toBe(["Branch: fix/wizard", "Agent types: worker", "Subagent tasks:", "- Fix the wizard"].join("\n"));
  expect(nextTitle(f, null, 0, null)).toBe(null);

  const logs: string[] = [];
  const titled: Facts = { ...f, session: { ...f.session, title: `Pushing ${secret}` } };
  expect(prepareTitle(titled, patterns, (t) => logs.push(t)).session.title).toBe(WORKFLOW_WITHHELD);
  expect(logs).toEqual(['withheld the session\'s title: it matches the secret pattern "AWS access key id"']);
  expect(prepareTitle(f, patterns, () => {})).toBe(f);
  expect(prepareTitle(f, null, () => {}).session.title).toBe(WORKFLOW_WITHHELD);
});
