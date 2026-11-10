import fs from "node:fs";
import path from "node:path";
import { FactsSchema, MAX_WORKFLOW_AGENTS, MAX_WORKFLOW_LABEL_LENGTH } from "@isoplan/protocol";
import { expect, test } from "vitest";
import { loadPatterns } from "../runner/scan.js";
import { agent, at, byId, cc, factsOf, gitRepo, line, modDir, NOW, session, sourceIn, tempRoot, touch } from "./fixture.js";
import { openReportHold, WITHHELD_TEXT } from "./reports.js";
import { parseScriptMeta, prepareWorkflows, WORKFLOW_WITHHELD } from "./workflows.js";

// Fixtures shaped as real runs left them (6 Nov 2026): the labels, phases, agent types, ids,
// statuses and counts of a finished 7-agent run (wf_01754f61-2f3) and a stopped one with no result
// lines (wf_5d89b82a-69a). Prompts, results and scripts are made up.

const PHASES = [
  { title: "Build", detail: "/build-it per ticket in its own worktree and branch" },
  { title: "Review", detail: "blind fresh-eyes read + rules audit" },
  { title: "Reconcile", detail: "verify findings against ticket, design and code" },
  { title: "Fix", detail: "fix confirmed findings, re-audit (max 2 rounds)" },
  { title: "Merge", detail: "rebase, recheck, PR (Closes #N), squash-merge; serialized per repo" },
];
const FINISHED = [
  { id: "a3f12f4fffa730978", label: "build app-170", phase: "Build", type: "workflow-subagent", result: { summary: "Built it", head: "abc123" } },
  { id: "a876cf2ff1096c437", label: "blind app-170", phase: "Review", type: "reviewer", result: "No findings." },
  { id: "ab8c2bc3551939d49", label: "rules app-170", phase: "Review", type: "reviewer", result: "Follows the rules." },
  { id: "a2d16a18b86a8162e", label: "reconcile app-170", phase: "Reconcile", type: "workflow-subagent", result: { verdicts: [] } },
  { id: "a52347d4768ead343", label: "fix app-170 r1", phase: "Fix", type: "workflow-subagent", result: { fixed: [] } },
  { id: "a59bc24e20c107db4", label: "re-audit app-170 r1", phase: "Fix", type: "reviewer", result: { allResolved: true } },
  { id: "ae087ef5414507668", label: "merge app-170", phase: "Merge", type: "workflow-subagent", result: { merged: true } },
];

type RunAgent = { id: string; label: string; phase: string; type: string; result?: unknown; age?: number; done?: boolean };

/** A run's journal and agents under the session's subagents/workflows/<run id>/, and its end record if it has one. */
function run(home: string, sessionId: string, runId: string, agents: RunAgent[], opts: { record?: Record<string, unknown>; age?: number; recordAge?: number } = {}) {
  const sessionDir = path.join(home, ".claude", "projects", "proj", sessionId);
  const dir = path.join(sessionDir, "subagents", "workflows", runId);
  fs.mkdirSync(dir, { recursive: true });
  const journal: Record<string, unknown>[] = [{ type: "launched" }];
  for (const a of agents) {
    journal.push({ type: "started", key: `v2:${a.id}`, agentId: a.id, label: a.label, phase: a.phase });
    fs.writeFileSync(path.join(dir, `agent-${a.id}.meta.json`), JSON.stringify({ agentType: a.type, isBuiltIn: a.type === "workflow-subagent", description: a.label, workflowPhase: a.phase, spawnDepth: 1 }));
    const t = path.join(dir, `agent-${a.id}.jsonl`);
    fs.writeFileSync(t, [line.user(sessionDir, "the agent's prompt", (a.age ?? 60) + 30), line.reply(sessionDir, `r-${a.id}`, { input_tokens: 1000, output_tokens: 50 }, a.age ?? 60)].map((l) => JSON.stringify(l)).join("\n") + "\n");
    touch(t, a.age ?? 60);
    if (a.done !== false && a.result !== undefined) journal.push({ type: "result", key: `v2:${a.id}`, agentId: a.id, result: a.result, toolsUsed: [] });
  }
  const jpath = path.join(dir, "journal.jsonl");
  fs.writeFileSync(jpath, journal.map((l) => JSON.stringify(l)).join("\n") + "\n");
  touch(jpath, opts.age ?? 60);
  if (opts.record) {
    const rpath = path.join(sessionDir, "workflows", `${runId}.json`);
    fs.mkdirSync(path.dirname(rpath), { recursive: true });
    fs.writeFileSync(rpath, JSON.stringify({ runId, script: "never sent", args: { secret: "never sent" }, ...opts.record }));
    touch(rpath, opts.recordAge ?? opts.age ?? 60);
  }
  return sessionDir;
}

const launch = (cwd: string, runId: string, extra: Record<string, unknown> = {}, age = 1000) =>
  line.result(cwd, `toolu_${runId}`, { status: "async_launched", taskId: "w6di26yqr", taskType: "local_workflow", workflowName: "build-review-merge", runId, summary: "Build, review and merge each ticket", scriptPath: `C:\\x\\workflows\\scripts\\build-review-merge-${runId}.js`, ...extra }, age);

test("a finished run is one workflow, its agents carry their run, phase and label, and each result is its report", async () => {
  const root = tempRoot();
  const home = path.join(root, "home");
  const repo = gitRepo(path.join(root, "repo"));
  session(home, "s", [line.user(repo, "run it", 1100), launch(repo, "wf_01754f61-2f3")], { age: 10 });
  const start = NOW - 900_000;
  run(home, "s", "wf_01754f61-2f3", FINISHED, { record: { status: "completed", startTime: start, durationMs: 895011, totalTokens: 607809, workflowName: "build-review-merge", phases: PHASES, timestamp: at(5) } });

  const facts = await factsOf(home, "s");
  expect(FactsSchema.safeParse(facts).success).toBe(true);
  expect(facts.workflows).toEqual([
    {
      id: "wf_01754f61-2f3",
      session: cc("s"),
      startedBy: cc("s:lead"),
      name: "build-review-merge",
      description: "Build, review and merge each ticket",
      phases: PHASES,
      status: "done",
      startedAt: new Date(start).toISOString(),
      endedAt: new Date(start + 895011).toISOString(),
      usage: { tokens: 607809 },
    },
  ]);
  const agents = byId(facts.agents);
  expect(FINISHED.map((a) => [agents[a.id]!.workflow, agents[a.id]!.agentType, agents[a.id]!.status, agents[a.id]!.startedBy])).toEqual(
    FINISHED.map((a) => [{ id: "wf_01754f61-2f3", phase: a.phase, label: a.label }, a.type, "done", cc("s:lead")]),
  );
  const reports = Object.fromEntries(facts.reports.map((r) => [r.agent, r.text]));
  expect(reports[cc("a876cf2ff1096c437")]).toBe("No findings.");
  expect(JSON.parse(reports[cc("ae087ef5414507668")]!)).toEqual({ merged: true });
  expect(facts.reports).toHaveLength(7);
  // The Workflow tool returns as it launches them: nobody waits on its agents.
  expect(facts.waits).toEqual([]);
  expect(JSON.stringify(facts)).not.toContain("never sent");
});

test("a stopped run with no result lines: the workflow and its agents are stopped, with no reports", async () => {
  const root = tempRoot();
  const home = path.join(root, "home");
  const repo = gitRepo(path.join(root, "repo"));
  session(home, "s", [line.user(repo, "run it", 100), launch(repo, "wf_5d89b82a-69a", {}, 90)], { age: 10 });
  const agents = [
    { id: "a72f68667da3054c5", label: "build app-148", phase: "Build", type: "workflow-subagent" },
    { id: "a0d0caf87cb2b8b4f", label: "build app-149", phase: "Build", type: "workflow-subagent" },
  ];
  run(home, "s", "wf_5d89b82a-69a", agents, { record: { status: "killed", startTime: NOW - 90_000, durationMs: 8750, totalTokens: 120968, phases: PHASES } });
  const facts = await factsOf(home, "s");
  expect(facts.workflows!.map((w) => [w.status, w.endedAt])).toEqual([["stopped", new Date(NOW - 90_000 + 8750).toISOString()]]);
  expect(facts.agents.filter((a) => a.workflow).map((a) => [a.status, a.extra?.endState])).toEqual([
    ["stopped", "killed"],
    ["stopped", "killed"],
  ]);
  expect(facts.reports).toEqual([]);
});

test("a running run: phases from its script's meta, agents at work until quiet; then it reads as stalled, then idle", async () => {
  const root = tempRoot();
  const home = path.join(root, "home");
  const repo = gitRepo(path.join(root, "repo"));
  session(home, "s", [line.user(repo, "run it", 200), line.reply(repo, "r1", { output_tokens: 1 }, 195), launch(repo, "wf_38edd312-f5e", { workflowName: "context-workflows-new-session", summary: undefined, scriptPath: "/Users/x/.claude/workflows/scripts/context-workflows-new-session-wf_38edd312-f5e.js" }, 190)], { age: 190 });
  const sessionDir = run(home, "s", "wf_38edd312-f5e", [
    { id: "a0000000000000001", label: "plugin-64", phase: "Plugin tickets", type: "workflow-subagent", result: "Built #64.", age: 100 },
    { id: "a0000000000000002", label: "plugin-65", phase: "Plugin tickets", type: "workflow-subagent", age: 20 },
  ], { age: 20 });
  // The script is never run: its meta is read as a literal, with comments and trailing commas.
  const script = path.join(sessionDir, "workflows", "scripts", "context-workflows-new-session-wf_38edd312-f5e.js");
  fs.mkdirSync(path.dirname(script), { recursive: true });
  fs.writeFileSync(script, `// header\nexport const meta = {\n  name: 'context-workflows-new-session',\n  description: "Build plugin #64 #65 #67, then the app tickets",\n  phases: [\n    { title: 'Plugin tickets', detail: \`one at a time\` }, /* then */\n    { title: 'Protocol release' },\n    { title: 'App tickets', },\n  ],\n};\nexport default async function main() { throw new Error("never run"); }\n`);

  let clock = NOW;
  const read = sourceIn(home, { now: () => clock });
  const facts = (await read("s")).facts!;
  const [w] = facts.workflows!;
  expect([w!.name, w!.description, w!.status, w!.endedAt, w!.usage]).toEqual(["context-workflows-new-session", "Build plugin #64 #65 #67, then the app tickets", "running", undefined, { tokens: 2100 }]);
  expect(w!.phases).toEqual([{ title: "Plugin tickets", detail: "one at a time" }, { title: "Protocol release" }, { title: "App tickets" }]);
  const agents = byId(facts.agents);
  expect([agents.a0000000000000001!.status, agents.a0000000000000002!.status]).toEqual(["done", "working"]);
  expect(facts.reports.filter((r) => agents[r.agent.replace(/^claude-code:/, "")]?.startedBy !== null).map((r) => [r.agent, r.text])).toEqual([[cc("a0000000000000001"), "Built #64."]]);

  clock = NOW + 6 * 60_000; // past stalledMinutes (5) of quiet
  const stalled = (await read("s")).facts!;
  expect([stalled.workflows![0]!.status, byId(stalled.agents).a0000000000000002!.status]).toEqual(["stalled", "stalled"]);
  clock = NOW + 30 * 60_000; // past idleMinutes (30), the session still in view
  expect((await read("s")).facts!.workflows![0]!.status).toBe("idle");
});

test("each run id is its own workflow, and an ended one doesn't change again", async () => {
  const root = tempRoot();
  const home = path.join(root, "home");
  const repo = gitRepo(path.join(root, "repo"));
  session(home, "s", [line.user(repo, "run it", 200), launch(repo, "wf_aaaaaaaa-111", {}, 190), launch(repo, "wf_bbbbbbbb-222", {}, 100)], { age: 10 });
  const sessionDir = run(home, "s", "wf_aaaaaaaa-111", FINISHED.slice(0, 1), { record: { status: "completed", startTime: NOW - 190_000, durationMs: 50_000, totalTokens: 10, phases: PHASES } });
  run(home, "s", "wf_bbbbbbbb-222", [{ ...FINISHED[1]!, id: "b876cf2ff1096c437", result: undefined }], { age: 20 });
  const read = sourceIn(home);
  const first = (await read("s")).facts!;
  expect(first.workflows!.map((w) => [w.id, w.status])).toEqual([
    ["wf_aaaaaaaa-111", "done"],
    ["wf_bbbbbbbb-222", "running"],
  ]);
  // A rewritten end record changes nothing of a run already seen ended.
  const rpath = path.join(sessionDir, "workflows", "wf_aaaaaaaa-111.json");
  fs.writeFileSync(rpath, JSON.stringify({ status: "failed", totalTokens: 99, workflowName: "renamed" }));
  touch(rpath, 5);
  expect((await read("s")).facts!.workflows![0]).toEqual(first.workflows![0]);
});

test("a workflow agent's transcript read by the lead is a check-in on it", async () => {
  const root = tempRoot();
  const home = path.join(root, "home");
  const repo = gitRepo(path.join(root, "repo"));
  const t = `${home}/.claude/projects/proj/s/subagents/workflows/wf_cccccccc-333/agent-a0000000000000003.jsonl`;
  session(home, "s", [line.user(repo, "check", 40), line.tool(repo, "Read", { file_path: t }, 30)], { age: 10 });
  run(home, "s", "wf_cccccccc-333", [{ id: "a0000000000000003", label: "scout", phase: "Read", type: "workflow-subagent", age: 20 }], { age: 20 });
  const lead = byId((await factsOf(home, "s")).agents)["s:lead"]!;
  expect(lead.checkIns).toEqual([{ with: cc("a0000000000000003"), kind: "read", since: at(30) }]);
});

test("a planted secret: labels, phases, name and description are hidden, and a result is held until released", async () => {
  const root = tempRoot();
  const home = path.join(root, "home");
  const repo = gitRepo(path.join(root, "repo"));
  const secret = "AKIAABCDEFGHIJKLMNOP";
  session(home, "s", [line.user(repo, "run it", 200), launch(repo, "wf_dddddddd-444", { workflowName: `deploy-${secret}`, summary: `uses ${secret}` }, 190)], { age: 10 });
  run(home, "s", "wf_dddddddd-444", [
    { id: "a0000000000000004", label: `push ${secret}`, phase: `Phase ${secret}`, type: "workflow-subagent", result: `the key is ${secret}` },
    { id: "a0000000000000005", label: "check", phase: "Check", type: "workflow-subagent", result: "fine" },
  ], { record: { status: "completed", startTime: NOW - 190_000, durationMs: 1000, phases: [{ title: `Phase ${secret}`, detail: secret }, { title: "Check" }] } });
  const facts = await factsOf(home, "s");
  const patterns = await loadPatterns(path.join(modDir, "secret-patterns.json"), path.join(root, "none.json"), () => {});
  const logs: string[] = [];
  const hold = await openReportHold(path.join(root, "released.json"), () => {});
  const out = prepareWorkflows(hold.apply(facts, patterns), patterns, (t) => logs.push(t));

  expect(JSON.stringify(out)).not.toContain(secret);
  const [w] = out.workflows!;
  expect([w!.name, w!.description, w!.phases]).toEqual([WORKFLOW_WITHHELD, WORKFLOW_WITHHELD, [{ title: WORKFLOW_WITHHELD, detail: WORKFLOW_WITHHELD }, { title: "Check" }]]);
  const agents = byId(out.agents);
  expect([agents.a0000000000000004!.workflow, agents.a0000000000000004!.task]).toEqual([{ id: "wf_dddddddd-444", label: WORKFLOW_WITHHELD, phase: WORKFLOW_WITHHELD }, WORKFLOW_WITHHELD]);
  expect(agents.a0000000000000005!.workflow).toEqual({ id: "wf_dddddddd-444", label: "check", phase: "Check" });
  const reports = byId(out.reports.map((r) => ({ ...r, id: r.agent })));
  expect(reports.a0000000000000004!.text).toBe(WITHHELD_TEXT);
  expect(reports.a0000000000000005!.text).toBe("fine");
  expect(logs.length).toBeGreaterThan(0);
  expect(logs.join("\n")).not.toContain(secret);

  // The owner releases the held result: it goes out as it was.
  expect(await hold.release(reports.a0000000000000004!.withheld!.id)).toBe(true);
  expect(byId(hold.apply(facts, patterns).reports.map((r) => ({ ...r, id: r.agent }))).a0000000000000004!.text).toBe(`the key is ${secret}`);
  // With the patterns unreadable, every workflow text is hidden.
  expect(prepareWorkflows(facts, null, () => {}).workflows![0]!.phases[1]!.title).toBe(WORKFLOW_WITHHELD);
});

test("an agent's task and description are checked on their own: a secret past the label's cut, or in a description the journal's label differs from", async () => {
  const root = tempRoot();
  const home = path.join(root, "home");
  const repo = gitRepo(path.join(root, "repo"));
  const secret = "AKIAABCDEFGHIJKLMNOP";
  session(home, "s", [line.user(repo, "run it", 200), launch(repo, "wf_ffffffff-666", {}, 190)], { age: 10 });
  const long = `${"x".repeat(MAX_WORKFLOW_LABEL_LENGTH)} ${secret}`;
  const sessionDir = run(home, "s", "wf_ffffffff-666", [
    { id: "a0000000000000006", label: long, phase: "Build", type: "workflow-subagent" },
    { id: "a0000000000000007", label: "plain label", phase: "Build", type: "workflow-subagent" },
  ], { age: 20 });
  const meta = path.join(sessionDir, "subagents", "workflows", "wf_ffffffff-666", "agent-a0000000000000007.meta.json");
  fs.writeFileSync(meta, JSON.stringify({ agentType: "workflow-subagent", description: `push ${secret}`, workflowPhase: "Build" }));
  const facts = await factsOf(home, "s");
  const patterns = await loadPatterns(path.join(modDir, "secret-patterns.json"), path.join(root, "none.json"), () => {});
  const out = prepareWorkflows(facts, patterns, () => {});

  expect(JSON.stringify(out)).not.toContain(secret);
  const agents = byId(out.agents);
  expect(agents.a0000000000000006!.workflow!.label).toBe("x".repeat(MAX_WORKFLOW_LABEL_LENGTH));
  expect(agents.a0000000000000007!.workflow!.label).toBe("plain label");
  for (const id of ["a0000000000000006", "a0000000000000007"]) {
    expect([agents[id]!.task, agents[id]!.extra?.description]).toEqual([WORKFLOW_WITHHELD, WORKFLOW_WITHHELD]);
  }
});

test("a run record with no start time starts the workflow at its launch", async () => {
  const root = tempRoot();
  const home = path.join(root, "home");
  const repo = gitRepo(path.join(root, "repo"));
  session(home, "s", [line.user(repo, "run it", 200), launch(repo, "wf_99999999-777", {}, 190)], { age: 10 });
  run(home, "s", "wf_99999999-777", FINISHED.slice(0, 1), { record: { status: "completed", timestamp: at(30), phases: PHASES }, age: 30 });
  const [w] = (await factsOf(home, "s")).workflows!;
  expect([w!.startedAt, w!.endedAt]).toEqual([at(190), at(30)]);
});

test("an ended run that leaves the view and comes back when the lights go off is the same fact", async () => {
  const root = tempRoot();
  const home = path.join(root, "home");
  const repo = gitRepo(path.join(root, "repo"));
  // The run's newest write 29 minutes before the session's: in view while the session is lit and
  // fresh, out of view later in that lit half hour, back in view once the lights go off.
  const age = 10 + 29 * 60;
  session(home, "s", [line.user(repo, "run it", age + 100), line.reply(repo, "r1", { output_tokens: 1 }, age + 95), launch(repo, "wf_12121212-888", {}, age + 90)], { age: 10 });
  const sessionDir = run(home, "s", "wf_12121212-888", [{ ...FINISHED[0]!, age }], { record: { status: "completed", startTime: NOW - (age + 90) * 1000, durationMs: 1000, phases: PHASES }, age });
  let clock = NOW;
  const read = sourceIn(home, { now: () => clock });
  const first = (await read("s")).facts!.workflows![0]!;

  clock = NOW + 29 * 60_000 + 30_000;
  expect((await read("s")).facts!.workflows).toBeUndefined();
  const rpath = path.join(sessionDir, "workflows", "wf_12121212-888.json");
  fs.writeFileSync(rpath, JSON.stringify({ status: "failed", workflowName: "renamed" }));
  touch(rpath, age);

  clock = NOW + 31 * 60_000;
  const back = (await read("s")).facts!;
  expect(back.session.lights).toBe("off");
  expect(back.workflows![0]).toEqual(first);
});

test("a run a subagent launched: its phases come from the script that launch names", async () => {
  const root = tempRoot();
  const home = path.join(root, "home");
  const repo = gitRepo(path.join(root, "repo"));
  session(home, "s", [line.user(repo, "go", 200)], { age: 10 });
  // A later run of a reused script: the file is named for the script's first run, not this one.
  const sessionDir = path.join(home, ".claude", "projects", "proj", "s");
  agent(home, "s", "a00000000000000aa", { agentType: "general-purpose", description: "runs a workflow" }, [line.user(repo, "run it", 150), launch(repo, "wf_34343434-999", { scriptPath: "/x/workflows/scripts/reused-wf_10101010-000.js" }, 140)], { age: 30 });
  run(home, "s", "wf_34343434-999", [{ id: "a0000000000000008", label: "one", phase: "Journal phase", type: "workflow-subagent", age: 20 }], { age: 20 });
  const script = path.join(sessionDir, "workflows", "scripts", "reused-wf_10101010-000.js");
  fs.mkdirSync(path.dirname(script), { recursive: true });
  fs.writeFileSync(script, `export const meta = { name: "reused", phases: [{ title: "Script phase" }] };\n`);
  const [w] = (await factsOf(home, "s")).workflows!;
  expect([w!.startedBy, w!.phases]).toEqual([cc("a00000000000000aa"), [{ title: "Script phase" }]]);
});

test("an ended run whose starter has left the view names the lead, as its agents do", async () => {
  const root = tempRoot();
  const home = path.join(root, "home");
  const repo = gitRepo(path.join(root, "repo"));
  session(home, "s", [line.user(repo, "go", 2000)], { age: 10 });
  agent(home, "s", "a00000000000000bb", { agentType: "general-purpose", description: "runs a workflow" }, [line.user(repo, "run it", 1600), launch(repo, "wf_56565656-aaa", {}, 1550)], { age: 25 * 60 });
  run(home, "s", "wf_56565656-aaa", [{ ...FINISHED[0]!, age: 5 * 60 }], { record: { status: "completed", startTime: NOW - 1550_000, durationMs: 1000, phases: PHASES }, age: 5 * 60 });
  let clock = NOW;
  const read = sourceIn(home, { now: () => clock });
  expect((await read("s")).facts!.workflows![0]!.startedBy).toBe(cc("a00000000000000bb"));
  clock = NOW + 10 * 60_000; // the subagent 35 minutes quiet, out of view; the run 15, in view
  const later = (await read("s")).facts!;
  expect(byId(later.agents).a00000000000000bb).toBeUndefined();
  expect([later.workflows![0]!.startedBy, byId(later.agents)[FINISHED[0]!.id]!.startedBy]).toEqual([cc("s:lead"), cc("s:lead")]);
});

test("a run with more agents than are sent: the first MAX_WORKFLOW_AGENTS go, and moreAgents counts the rest", async () => {
  const root = tempRoot();
  const home = path.join(root, "home");
  const repo = gitRepo(path.join(root, "repo"));
  session(home, "s", [line.user(repo, "run it", 200), launch(repo, "wf_78787878-bbb", {}, 190)], { age: 10 });
  const many = Array.from({ length: MAX_WORKFLOW_AGENTS + 2 }, (_, i) => ({ id: `c${String(i).padStart(16, "0")}`, label: `agent ${i}`, phase: "Build", type: "workflow-subagent" }));
  run(home, "s", "wf_78787878-bbb", many, { age: 20 });
  const facts = await factsOf(home, "s");
  expect(facts.agents.filter((a) => a.workflow).length).toBe(MAX_WORKFLOW_AGENTS);
  expect(facts.workflows![0]!.moreAgents).toBe(2);
  expect(FactsSchema.safeParse(facts).success).toBe(true);
});

test("a script's meta decodes escapes as JavaScript does, and reads numbers with exponents", () => {
  const bs = String.fromCharCode(92); // a backslash, so the escapes reach the parser as written
  const src = `export const meta = { name: "caf${bs}u00e9 ${bs}x41${bs}u{1F600}${bs}r!", description: 'a${bs}\nb', version: 1e3, size: -2.5E-1, phases: [{ title: "P${bs}t${bs}"Q${bs}"" }] }`;
  expect(parseScriptMeta(src)).toEqual({ name: `caf${String.fromCharCode(0xe9)} A${String.fromCodePoint(0x1f600)}\r!`, description: "ab", phases: [{ title: 'P\t"Q"' }] });
  expect(parseScriptMeta(`export const meta = { name: "${bs}u00g1" }`)).toBe(null);
});

test("a script's meta is read only as a literal: anything that would have to run makes it unreadable", () => {
  expect(parseScriptMeta(`export const meta = { name: "a", phases: [{ title: "P" }] }`)).toEqual({ name: "a", description: null, phases: [{ title: "P" }] });
  expect(parseScriptMeta(`export const meta = { name: build(), phases: [] }`)).toBe(null);
  expect(parseScriptMeta("export const meta = { name: `a${x}` }")).toBe(null);
  expect(parseScriptMeta(`export const meta = { __proto__: { polluted: true }, name: "a" }`)!.name).toBe("a");
  expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  expect(parseScriptMeta(`const other = 1;`)).toBe(null);
});
