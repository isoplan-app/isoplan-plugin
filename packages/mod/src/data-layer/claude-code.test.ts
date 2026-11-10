import fs from "node:fs";
import path from "node:path";
import { expect, test } from "vitest";
import { createClaudeCode } from "./claude-code.js";
import { normalize, pathKey } from "./git.js";
import { nodeIo } from "./io.js";
import { NOW, tempRoot, gitRepo, gitWorktree, line, session, agent, sourceIn, factsOf, byId, cc, touch, at } from "./fixture.js";

// One project (a main checkout plus a linked worktree elsewhere on disk) and an unrelated repo.
function office() {
  const root = tempRoot();
  const home = path.join(root, "home");
  const main = gitRepo(path.join(root, "projects", "repo"), "main");
  const wt = gitWorktree(main, path.join(root, "orca", "wt"), "wt", "feature/a");
  const other = gitRepo(path.join(root, "other"), "main");
  return { root, home, main, wt, other };
}

const agentsOf = async (home: string, id: string) => byId((await factsOf(home, id)).agents);
// The project the fixture's projectOf gives a repo with no remote, as a data layer on "test-machine" would.
const caseless = process.platform === "win32" || process.platform === "darwin";
const localProject = (dir: string) => {
  const id = `local:test-machine/${normalize(dir)}`;
  return { id: caseless ? id.toLowerCase() : id, name: path.basename(dir) };
};

test("reads only its own session: skips bad lines; title falls back to branch", async () => {
  const { home, main, wt } = office();
  const own = session(home, "s-main", ["not json {", line.title("Old title"), line.user(main, "hi", 60, { gitBranch: "main" }), line.title("Room label"), "{}"]);
  session(home, "s-wt", [line.user(wt, "hi")], { slug: "wt" });
  session(home, "s-other", [line.user(main, "hi")]);
  const opened: string[] = [];
  const base = nodeIo({ run: null });
  const read = sourceIn(home, { io: { read: (p, start, end) => (opened.push(pathKey(p)), base.read(p, start, end)) } });

  const r = await read("s-main");
  expect(r.status).toBe(null);
  expect(r.facts!.session).toMatchObject({ id: cc("s-main"), title: "Room label", titleFrom: "source", branch: "main", lead: cc("s-main:lead") });
  expect(new Set(opened.filter((p) => p.endsWith(".jsonl")))).toEqual(new Set([pathKey(own)]));

  // No ai-title and no gitBranch on its lines: the branch comes from git, and the title from that.
  const s = (await factsOf(home, "s-wt")).session;
  expect([s.branch, s.title, s.checkout]).toEqual(["feature/a", "feature/a", normalize(wt)]);
});

test("finds the transcript by the session's folder without listing other projects", async () => {
  const { home, main } = office();
  session(home, "s", [line.user(main, "hi")], { slug: main.replace(/[^a-zA-Z0-9]/g, "-") });
  const listed: string[] = [];
  const base = nodeIo({ run: null });
  const read = sourceIn(home, { io: { listDir: (dir) => (listed.push(normalize(dir)), base.listDir(dir)) } });
  expect((await read("s", main)).facts!.session.id).toBe(cc("s"));
  expect(listed.filter((d) => d.endsWith("/projects"))).toEqual([]);
  expect((await read("missing", main)).facts).toBe(null);
});

test("before the transcript exists, the session's own folder is tried every pass, every project folder at most every 10 s", async () => {
  const { home, main } = office();
  let clock = NOW;
  const listed: string[] = [];
  const base = nodeIo({ run: null });
  const read = sourceIn(home, { now: () => clock, io: { listDir: (dir) => (listed.push(normalize(dir)), base.listDir(dir)) } });
  const searches = () => listed.filter((d) => d.endsWith("/projects")).length;
  for (const t of [0, 1000, 9000]) {
    clock = NOW + t;
    expect((await read("s", main)).facts).toBe(null);
  }
  expect(searches()).toBe(1);
  clock = NOW + 10000;
  await read("s", main);
  expect(searches()).toBe(2);
  // Written under its own folder's name: found on the next pass, with no search.
  session(home, "s", [line.user(main, "hi")], { slug: main.replace(/[^a-zA-Z0-9]/g, "-") });
  clock = NOW + 11000;
  expect((await read("s", main)).facts).not.toBe(null);
  expect(searches()).toBe(2);
});

test("titleFrom says whose the title is; an agent's task is its meta.json description, a lead's null", async () => {
  const { home, main } = office();
  session(home, "named", [line.user(main, "hi", 30, { gitBranch: "main" }), line.title("Room label")]);
  session(home, "bare", [line.user(main, "hi", 30, { gitBranch: "fix/wizard" })]);
  agent(home, "bare", "w", { agentType: "worker", description: "Fix the wizard" }, [line.tool(main, "Read", { file_path: "x" }, 5)], { age: 5 });
  agent(home, "bare", "q", { agentType: "scout", description: "" }, [line.tool(main, "Read", { file_path: "x" }, 5)], { age: 5 });
  const named = (await factsOf(home, "named")).session;
  const bare = await factsOf(home, "bare");
  expect([named.title, named.titleFrom, bare.session.title, bare.session.titleFrom]).toEqual(["Room label", "source", "fix/wizard", "branch"]);
  const a = byId(bare.agents);
  expect([a.w!.task, a.q!.task, a["bare:lead"]!.task]).toEqual(["Fix the wizard", null, null]);
});

test("liveness: active, idle, lights off — and a busy subagent keeps a quiet session live", async () => {
  const { home, main } = office();
  session(home, "active", [line.user(main, "x")], { age: 30 });
  session(home, "idle", [line.user(main, "x")], { age: 10 * 60 });
  // A lights-off session stays only once it got a reply.
  session(home, "gone", [line.user(main, "x"), line.reply(main, "r1", { output_tokens: 1 })], { age: 40 * 60 });
  session(home, "waiting", [line.user(main, "x")], { age: 50 * 60 });
  agent(home, "waiting", "a1", { agentType: "scout" }, [line.tool(main, "Grep", { pattern: "x" })], { age: 20 });

  const s = async (id: string) => (await factsOf(home, id)).session;
  expect((await s("active")).status).toBe("active");
  expect((await s("idle")).status).toBe("idle");
  expect([(await s("active")).lights, (await s("idle")).lights, (await s("waiting")).lights]).toEqual(["on", "on", "on"]);
  const gone = await s("gone");
  expect([gone.status, gone.lights]).toEqual(["idle", "off"]);
  const waiting = await s("waiting");
  expect(waiting.status).toBe("active");
  expect(waiting.lastActive).toBe(at(20));
});

test("lights off: kept until lightsOffHours, with the subagents in view when the session went quiet", async () => {
  const { home, main } = office();
  const hours = (h: number) => h * 3600;
  session(home, "last-night", [line.user(main, "x", hours(3)), line.reply(main, "r1", { output_tokens: 1 }, hours(3))], { age: hours(3) });
  // Ten minutes before the lead's last line, inside the window back from it; an hour before, not.
  agent(home, "last-night", "late", { agentType: "reviewer" }, [line.text(main, "Looks fine.", hours(3) + 600)], { age: hours(3) + 600 });
  agent(home, "last-night", "early", { agentType: "worker" }, [line.text(main, "Done.", hours(4))], { age: hours(4) });
  session(home, "too-old", [line.user(main, "x", hours(6))], { age: hours(6) });
  const read = sourceIn(home, { config: { lightsOffHours: 5 } });
  const f = (await read("last-night")).facts!;
  expect([f.session.lights, f.session.status]).toEqual(["off", "idle"]);
  expect((await read("too-old")).facts).toBe(null);
  expect(f.agents.map((a) => a.id)).toEqual([cc("last-night:lead"), cc("late")]);
  expect(byId(f.agents).late!.status).toBe("done"); // worked out at now, by the usual rules
});

test("lights off: lightsOffHours 0 drops a session once it has been quiet for idleMinutes", async () => {
  const { home, main } = office();
  session(home, "idle", [line.user(main, "x")], { age: 10 * 60 });
  session(home, "gone", [line.user(main, "x")], { age: 40 * 60 });
  const read = sourceIn(home, { config: { lightsOffHours: 0 } });
  expect((await read("idle")).facts!.session.lights).toBe("on");
  expect((await read("gone")).facts).toBe(null);
});

test("lead: an agent with startedBy null, working while its turn is open and idle once it answers", async () => {
  const { home, main } = office();
  const prompt = line.user(main, "fix the bug", 40);
  const thinking = line.text(main, "Let me look.", 35, { message: { role: "assistant", content: [{ type: "text", text: "Let me look." }], stop_reason: "tool_use" } });
  const read = line.tool(main, "Read", { file_path: path.join(main, "a.md") }, 30);
  const lead = async () => (await agentsOf(home, "s"))["s:lead"]!;

  session(home, "s", [prompt, thinking]);
  let l = await lead();
  expect([l.startedBy, l.agentType, l.status, l.statusSince]).toEqual([null, null, "working", at(40)]);

  session(home, "s", [prompt, thinking, read]);
  expect((await lead()).doing).toEqual({ kind: "read", file: "a.md", since: at(30) });

  session(home, "s", [prompt, thinking, read, line.result(main, "t1", null, 25), line.text(main, "Fixed.", 20)]);
  l = await lead();
  expect([l.status, l.statusSince, l.doing]).toEqual(["idle", at(20), null]);

  // A slash-command echo is no prompt; an interruption ends the turn.
  session(home, "s", [prompt, thinking, read, line.result(main, "t1", null, 25), line.text(main, "Fixed.", 20), line.user(main, "<command-name>/model</command-name>", 15)]);
  expect((await lead()).status).toBe("idle");
  session(home, "s", [prompt, read, line.user(main, [{ type: "text", text: "[Request interrupted by user for tool use]" }], 10)]);
  expect((await lead()).status).toBe("idle");
});

test("lead: a new prompt opens a turn doing nothing until its first tool call", async () => {
  const { home, main } = office();
  const lead = async () => (await agentsOf(home, "s"))["s:lead"]!;
  const lastTurn = [line.user(main, "fix the bug", 60), line.tool(main, "Edit", { file_path: path.join(main, "a.md") }, 50), line.result(main, "t1", null, 45), line.text(main, "Fixed.", 40)];
  session(home, "s", [...lastTurn, line.user(main, "now the docs", 20)]);
  const l = await lead();
  expect([l.status, l.doing]).toEqual(["working", null]);
  session(home, "s", [...lastTurn, line.user(main, "now the docs", 20), line.tool(main, "Read", { file_path: path.join(main, "b.md") }, 10)]);
  expect((await lead()).doing).toEqual({ kind: "read", file: "b.md", since: at(10) });
});

test("lead: never stalls — an open turn quiet past stalledMinutes is idle since its last message line", async () => {
  const { home, main } = office();
  // Mid-turn, then nothing for ten minutes; a bookkeeping line after the last message doesn't count.
  session(home, "s", [line.user(main, "fix the bug", 700), line.tool(main, "Read", { file_path: path.join(main, "a.md") }, 650), { ...line.title("Bug fix"), timestamp: at(600) }], { age: 600 });
  const l = (await agentsOf(home, "s"))["s:lead"]!;
  expect([l.status, l.statusSince, l.doing]).toEqual(["idle", at(650), null]);
});

test("questions: an AskUserQuestion with no result is open while the turn is, marked incomplete when part of it is left out; its result, an interruption or a new prompt closes it", async () => {
  const { home, main } = office();
  const prompt = line.user(main, "fix the bug", 60);
  const options = [{ label: "main", description: "Straight to main." }, { label: "A new branch" }];
  const ask = (id: string, questions: unknown, age = 30) => ({ ...line.tool(main, "AskUserQuestion", { questions }, age), message: { role: "assistant", content: [{ type: "tool_use", id, name: "AskUserQuestion", input: { questions } }] } });
  const asked = ask("toolu_1", [{ question: "Which branch?", header: "Branch", options, multiSelect: false }, { question: "" }]);
  const questions = async () => (await factsOf(home, "s")).questions;

  session(home, "s", [prompt, asked]);
  expect(await questions()).toEqual([
    { id: "toolu_1", agent: cc("s:lead"), at: at(30), questions: [{ question: "Which branch?", header: "Branch", options: [options[0], { label: "A new branch", description: "" }], multiSelect: false }], extra: { incomplete: true } },
  ]);
  // An input the model wrote in another shape is no question.
  session(home, "s", [prompt, ask("toolu_2", "Which branch?")]);
  expect(await questions()).toEqual([]);

  session(home, "s", [prompt, asked, line.result(main, "toolu_1", null, 20, true)]);
  expect(await questions()).toEqual([]);
  session(home, "s", [prompt, asked, line.user(main, [{ type: "text", text: "[Request interrupted by user for tool use]" }], 20)]);
  expect(await questions()).toEqual([]);
  session(home, "s", [prompt, asked, line.user(main, "never mind, do it on main", 20)]);
  expect(await questions()).toEqual([]);
});

test("questions: each option's preview is carried as the agent gave it, multi-line kept", async () => {
  const { home, main } = office();
  const options = [{ label: "Alpha", description: "First", preview: "┌──┐\n│A │\n└──┘" }, { label: "Beta", description: "Second" }];
  const questions = [{ question: "Which layout?", header: "Layout", options, multiSelect: false }];
  const asked = { ...line.tool(main, "AskUserQuestion", { questions }, 30), message: { role: "assistant", content: [{ type: "tool_use", id: "toolu_1", name: "AskUserQuestion", input: { questions } }] } };
  session(home, "s", [line.user(main, "pick a layout", 60), asked]);
  expect((await factsOf(home, "s")).questions![0]!.questions[0]!.options).toEqual(options);
});

test("questions: one with a result that isn't an error was answered; an interrupted one, or one a prompt came before, was not", async () => {
  const { home, main } = office();
  const prompt = line.user(main, "fix the bug", 60);
  const ask = (id: string, age: number) => ({ ...line.tool(main, "AskUserQuestion", {}, age), message: { role: "assistant", content: [{ type: "tool_use", id, name: "AskUserQuestion", input: { questions: [{ question: "Ship it?" }] } }] } });
  session(home, "s", [
    prompt,
    ask("toolu_1", 50),
    line.result(main, "toolu_1", { answers: { "Ship it?": "Yes" } }, 45),
    ask("toolu_2", 40),
    line.result(main, "toolu_2", null, 35, true),
    ask("toolu_3", 30),
    line.user(main, "never mind", 20),
  ]);
  const { answered } = await sourceIn(home)("s");
  expect(["toolu_1", "toolu_2", "toolu_3"].map((id) => answered!(id))).toEqual([true, false, false]);
});

test("foreground agent: working until the parent's tool_result says completed, then done with a report", async () => {
  const { home, main } = office();
  const lines = [line.spawn(main, "tu-fg1", { subagent_type: "researcher" }, 100)];
  session(home, "s", lines);
  agent(home, "s", "fg1", { agentType: "researcher", toolUseId: "tu-fg1" }, [line.tool(main, "WebFetch", { url: "u" }, 5)], { age: 5 });
  let f = await factsOf(home, "s");
  let a = byId(f.agents).fg1!;
  expect([a.status, a.statusSince, a.agentType]).toEqual(["working", at(100), "researcher"]);
  expect(a.doing).toEqual({ kind: "search", since: at(5) });
  expect(f.reports).toEqual([]);
  // The lead waits on its foreground agent inside its own turn: working, talking.
  expect(byId(f.agents)["s:lead"]!.status).toBe("working");
  expect(byId(f.agents)["s:lead"]!.doing!.kind).toBe("talk");

  session(home, "s", [...lines, line.result(main, "tu-fg1", { status: "completed", agentType: "researcher", totalDurationMs: 9 }, 2)]);
  agent(home, "s", "fg1", { agentType: "researcher", toolUseId: "tu-fg1" }, [line.tool(main, "WebFetch", { url: "u" }, 5), line.text(main, "Found it.", 3)], { age: 3 });
  f = await factsOf(home, "s");
  a = byId(f.agents).fg1!;
  expect([a.status, a.statusSince, a.doing, a.extra!.endState]).toEqual(["done", at(2), null, "completed"]);
  expect(f.reports).toEqual([{ agent: cc("fg1"), at: at(3), text: "Found it." }]);
});

test("a lead's last reply: its newest text as its turn ends, kept while the next turn runs", async () => {
  const { home, main } = office();
  const first = [line.user(main, "Add tests", 60), line.tool(main, "Bash", { command: "npm test" }, 50), line.text(main, "Tests added and passing.", 40)];
  session(home, "s", first);
  const reply = [{ agent: cc("s:lead"), at: at(40), text: "Tests added and passing." }];
  expect((await factsOf(home, "s")).reports).toEqual(reply);
  session(home, "s", [...first, line.user(main, "Now commit", 20), line.tool(main, "Bash", { command: "git commit" }, 10)]);
  const f = await factsOf(home, "s");
  expect(byId(f.agents)["s:lead"]!.status).toBe("working");
  expect(f.reports).toEqual(reply);
});

test("background agent: the launch acknowledgement is not done; the task-notification is", async () => {
  const { home, main } = office();
  const launch = [line.spawn(main, "tu-bg", { run_in_background: true }, 100), line.result(main, "tu-bg", { isAsync: true, status: "async_launched", agentId: "bg1" }, 99)];
  const work = [line.tool(main, "Grep", { pattern: "x", path: path.join(main, "agents") + path.sep }, 20), line.text(main, "Report.", 8)];
  session(home, "s", launch);
  agent(home, "s", "bg1", { agentType: "scout", toolUseId: "tu-bg", requestShape: "background" }, work, { age: 8 });
  let a = (await agentsOf(home, "s")).bg1!;
  expect(a.status).toBe("working"); // quiet for 8s only, and no notification yet
  expect(a.doing).toEqual({ kind: "search", file: "agents", since: at(20) });

  session(home, "s", [...launch, line.notify("bg1", "completed", 5)]);
  a = (await agentsOf(home, "s")).bg1!;
  expect([a.status, a.statusSince]).toEqual(["done", at(5)]);

  // Resumed after the notification: it has written since, so it is working again.
  agent(home, "s", "bg1", { agentType: "scout", toolUseId: "tu-bg" }, [...work, line.user(main, "one more thing", 2)], { age: 2 });
  expect((await agentsOf(home, "s")).bg1!.status).toBe("working");
});

test("stopped: a killed or stopped agent is stopped, keeps its end state, and leaves no report", async () => {
  const { home, main } = office();
  const launch = (id: string) => [line.spawn(main, "tu-" + id, { run_in_background: true }, 100), line.result(main, "tu-" + id, { isAsync: true, status: "async_launched" }, 99)];
  session(home, "s", [...launch("k"), ...launch("st"), ...launch("f"), line.notify("k", "killed", 6), line.notify("st", "stopped", 5), line.notify("f", "failed", 4)]);
  for (const id of ["k", "st", "f"]) agent(home, "s", id, { agentType: "worker", toolUseId: "tu-" + id }, [line.text(main, "Partial work.", 30)], { age: 30 });
  const f = await factsOf(home, "s");
  const a = byId(f.agents);
  expect([a.k!.status, a.k!.extra!.endState, a.k!.statusSince]).toEqual(["stopped", "killed", at(6)]);
  expect([a.st!.status, a.st!.extra!.endState]).toEqual(["stopped", "stopped"]);
  expect([a.f!.status, a.f!.extra!.endState]).toEqual(["failed", "failed"]);
  expect(f.reports.map((r) => r.agent)).toEqual([cc("f")]);
  expect(f.waits).toEqual([]);
});

test("quiet rule: no signal found, quiet past the window and not waiting on a tool → done", async () => {
  const { home, main } = office();
  session(home, "s", [line.user(main, "x")]);
  agent(home, "s", "q1", { agentType: "worker", toolUseId: "unseen" }, [line.text(main, "All done.", 120)], { age: 120 });
  agent(home, "s", "q2", { agentType: "worker", toolUseId: "unseen2" }, [line.tool(main, "Bash", { command: "npm test" }, 120)], { age: 120 });
  const a = await agentsOf(home, "s");
  expect(a.q1!.status).toBe("done");
  expect(a.q2!.status).toBe("working");
  expect(a.q2!.doing).toEqual({ kind: "run", since: at(120) });
});

test("spawn in view: a long-quiet agent stays working until its tool_result or notification arrives", async () => {
  const { home, main } = office();
  session(home, "s", [
    line.spawn(main, "tu-fg", { subagent_type: "worker" }, 600),
    line.spawn(main, "tu-bg", { run_in_background: true }, 600),
    line.result(main, "tu-bg", { isAsync: true, status: "async_launched", agentId: "bg" }, 599),
  ]);
  // Both quiet for five minutes after a plain text line: the quiet rule alone would call them done.
  agent(home, "s", "fg", { agentType: "worker", toolUseId: "tu-fg" }, [line.text(main, "Thinking it over.", 300)], { age: 300 });
  agent(home, "s", "bg", { agentType: "worker", toolUseId: "tu-bg" }, [line.text(main, "Thinking it over.", 300)], { age: 300 });
  const a = await agentsOf(home, "s");
  expect([a.fg!.status, a.bg!.status]).toEqual(["working", "working"]);
  // A text line is not a tool call: working, doing nothing anyone can draw.
  expect(a.fg!.doing).toBe(null);
});

test("stalled: spawn in view, no signal, and both the agent and its session quiet past stalledMinutes", async () => {
  const { home, main } = office();
  const spawns = [line.spawn(main, "tu-orphan", { subagent_type: "worker" }, 900), line.spawn(main, "tu-busy", { subagent_type: "worker" }, 900)];
  // The session crashed ten minutes ago; one agent has been quiet as long, the other wrote just now.
  session(home, "s", spawns, { age: 600 });
  agent(home, "s", "orphan", { agentType: "worker", toolUseId: "tu-orphan" }, [line.tool(main, "Bash", { command: "npm test" }, 600)], { age: 600 });
  agent(home, "s", "busy", { agentType: "worker", toolUseId: "tu-busy" }, [line.text(main, "Still going.", 10)], { age: 10 });
  const f = await factsOf(home, "s");
  let a = byId(f.agents);
  expect([a.orphan!.status, a.orphan!.statusSince]).toEqual(["stalled", at(300)]); // quiet since 600s ago, plus 5 minutes
  expect(a.orphan!.doing).toEqual({ kind: "run", since: at(600) }); // where it stopped
  expect(a.busy!.status).toBe("working");
  expect(f.reports).toEqual([]);

  // The session writes again: the same quiet agent is working, not stalled.
  session(home, "s", spawns, { age: 10 });
  a = await agentsOf(home, "s");
  expect(a.orphan!.status).toBe("working");
});

test("stalled: a nested agent's quiet is measured against the subagent that started it, not the lead", async () => {
  const { home, main } = office();
  session(home, "s", [line.spawn(main, "tu-a", {}, 900)], { age: 10 }); // the lead wrote just now
  agent(home, "s", "A", { agentType: "worker", toolUseId: "tu-a" }, [line.spawn(main, "tu-b", {}, 600)], { age: 600 });
  agent(home, "s", "B", { agentType: "scout", toolUseId: "tu-b" }, [line.tool(main, "Bash", { command: "npm test" }, 600)], { age: 600 });
  const a = await agentsOf(home, "s");
  expect(a.A!.status).toBe("working"); // its starter, the lead, is live
  expect([a.B!.status, a.B!.statusSince]).toEqual(["stalled", at(300)]); // B and A both quiet for ten minutes
});

test("startedBy: every agent names who started it, subagents of subagents included", async () => {
  const { home, main } = office();
  session(home, "s", [line.spawn(main, "tu-a", { subagent_type: "worker" }, 100)]);
  // A spawns B in its own transcript; C's spawn is out of view but meta.json names A as its parent;
  // D's named parent is not in view, so it falls back to the lead.
  agent(home, "s", "A", { agentType: "worker", toolUseId: "tu-a" }, [line.spawn(main, "tu-b", { subagent_type: "scout" }, 80)], { age: 5 });
  agent(home, "s", "B", { agentType: "scout", toolUseId: "tu-b" }, [line.tool(main, "Grep", { pattern: "x" }, 5)], { age: 5 });
  agent(home, "s", "C", { agentType: "scout", toolUseId: "tu-c", parentAgentId: "A" }, [line.tool(main, "Grep", { pattern: "x" }, 5)], { age: 5 });
  agent(home, "s", "D", { agentType: "scout", toolUseId: "tu-d", parentAgentId: "gone" }, [line.tool(main, "Grep", { pattern: "x" }, 5)], { age: 5 });
  const a = await agentsOf(home, "s");
  expect(Object.fromEntries(Object.entries(a).map(([id, x]) => [id, x.startedBy]))).toEqual({ "s:lead": null, A: cc("s:lead"), B: cc("A"), C: cc("A"), D: cc("s:lead") });
  expect(Object.values(a).every((x) => x.session === cc("s"))).toBe(true);
});

test("waits: a working or stalled agent owes its starter an answer, since its spawn or its first line seen", async () => {
  const { home, main } = office();
  session(home, "s", [line.spawn(main, "tu-a", {}, 100), line.spawn(main, "tu-done", {}, 100), line.result(main, "tu-done", { status: "completed" }, 50)], { age: 400 });
  agent(home, "s", "A", { agentType: "worker", toolUseId: "tu-a" }, [line.spawn(main, "tu-b", {}, 70), line.text(main, "Waiting on B.", 60)], { age: 360 });
  agent(home, "s", "B", { agentType: "scout", toolUseId: "tu-b" }, [line.tool(main, "Read", { file_path: "x" }, 5)], { age: 5 });
  agent(home, "s", "loose", { agentType: "scout", toolUseId: "unseen" }, [line.tool(main, "Read", { file_path: "x" }, 40), line.tool(main, "Read", { file_path: "y" }, 5)], { age: 5 });
  agent(home, "s", "done", { agentType: "scout", toolUseId: "tu-done" }, [line.text(main, "Done.", 55)], { age: 55 });
  const f = await factsOf(home, "s");
  expect(byId(f.agents).A!.status).toBe("stalled"); // A and the session both quiet for six minutes
  // In the order the subagents' files were listed, which the file system decides.
  const key = (w: { waiter: string; on: string }) => w.waiter + " " + w.on;
  expect([...f.waits].sort((x, y) => key(x).localeCompare(key(y)))).toEqual([
    { waiter: cc("A"), on: cc("B"), since: at(70) },
    { waiter: cc("s:lead"), on: cc("A"), since: at(100) },
    { waiter: cc("s:lead"), on: cc("loose"), since: at(40) },
  ]);
});

test("doing: the last tool call's kind, shown while working or stalled; a file in another repo names that repo", async () => {
  const { home, main, other } = office();
  session(home, "s", [line.user(main, "x")]);
  const tools: Record<string, [string, Record<string, unknown>]> = {
    w: ["Write", { file_path: path.join(main, "w.md") }],
    r: ["Read", { file_path: path.join(other, "r.md") }],
    b: ["PowerShell", { command: "ls" }],
    g: ["Glob", { pattern: "*" }],
    t: ["SendMessage", {}],
    o: ["TodoWrite", {}],
  };
  for (const [id, [name, input]] of Object.entries(tools)) agent(home, "s", id, { agentType: "worker" }, [line.tool(main, name, input, 5)], { age: 5 });
  const a = await agentsOf(home, "s");
  expect(Object.fromEntries(Object.keys(tools).map((id) => [id, a[id]!.doing && a[id]!.doing.kind]))).toEqual({ w: "write", r: "read", b: "run", g: "search", t: "talk", o: null });
  expect(a.w!.doing!.file).toBe("w.md");
  expect(a.r!.doing).toEqual({ kind: "read", file: "r.md", project: localProject(other), away: true, since: at(5) });
});

test("check-ins: a message sent to another agent, by id or by the name its spawn gave it, or its output or transcript read, in any case; newest last, after the turn ends too", async () => {
  const { home, main } = office();
  const tasks = path.join(home, "tmp", "tasks");
  const subagents = path.join(home, ".claude", "projects", "proj", "s", "subagents");
  session(home, "s", [line.spawn(main, "tu-b", { name: "builder", description: "Build the export" }, 200), line.spawn(main, "tu-c", { description: "Review it" }, 200), line.user(main, "x", 150), line.notify("A", "completed", 14)]);
  agent(home, "s", "B", { agentType: "worker", toolUseId: "tu-b" }, [line.tool(main, "Grep", { pattern: "x" }, 5)], { age: 5 });
  agent(home, "s", "C", { agentType: "reviewer", toolUseId: "tu-c" }, [line.tool(main, "Grep", { pattern: "x" }, 5)], { age: 5 });
  const lines = (name: string, input: Record<string, unknown>, age: number) => line.tool(main, name, input, age);
  agent(home, "s", "A", { agentType: "worker" }, [
    lines("SendMessage", { to: "B", message: "How far along?" }, 50),
    lines("PowerShell", { command: `Get-Content "${path.join(tasks, "B.output")}" -Tail 5; Get-Content "${path.join(tasks, "C.output")}"` }, 35),
    lines("TaskOutput", { task_id: "C" }, 30),
    lines("SendMessage", { to: "Builder", message: "And now?" }, 25),
    lines("SendMessage", { to: "review it", message: "Ready?" }, 20),
    line.text(main, "All checked.", 15),
  ], { age: 15 });
  agent(home, "s", "D", { agentType: "scout" }, [
    lines("Read", { file_path: path.join(tasks, "c.OUTPUT") }, 12),
    lines("Grep", { pattern: "error", path: path.join(subagents, "agent-B.jsonl") }, 10),
  ], { age: 10 });
  const a = await agentsOf(home, "s");
  expect(a.A!.status).not.toBe("working");
  // The newest five, two by name.
  expect(a.A!.checkIns).toEqual([
    { with: cc("B"), kind: "read", since: at(35) },
    { with: cc("C"), kind: "read", since: at(35) },
    { with: cc("C"), kind: "read", since: at(30) },
    { with: cc("B"), kind: "talk", since: at(25) },
    { with: cc("C"), kind: "talk", since: at(20) },
  ]);
  expect(a.D!.checkIns).toEqual([
    { with: cc("C"), kind: "read", since: at(12) },
    { with: cc("B"), kind: "read", since: at(10) },
  ]);
  expect(a.B!.checkIns).toBeUndefined();
});

test("check-ins: none for a write to an output file, a shell writing it, a background shell's output, an unknown name, an older one, or a file that only looks like one", async () => {
  const { home, main } = office();
  const tasks = path.join(home, "tmp", "tasks");
  session(home, "s", [line.user(main, "x", 150)]);
  agent(home, "s", "B", { agentType: "worker" }, [line.tool(main, "Grep", { pattern: "x" }, 5)], { age: 5 });
  agent(home, "s", "A", { agentType: "worker" }, [
    line.tool(main, "SendMessage", { to: "B", message: "Long ago" }, 120),
    line.tool(main, "Write", { file_path: path.join(tasks, "B.output"), content: "x" }, 30),
    line.tool(main, "Edit", { file_path: path.join(tasks, "B.output"), old_string: "x", new_string: "y" }, 29),
    line.tool(main, "Bash", { command: `echo hi > "${path.join(tasks, "B.output").replace(/\\/g, "/")}"` }, 28),
    line.tool(main, "Read", { file_path: path.join(tasks, "bshell1.output") }, 27),
    line.tool(main, "SendMessage", { to: "nobody", message: "Hello?" }, 26),
    line.tool(main, "Read", { file_path: path.join(tasks, "B.output.bak") }, 25),
    line.tool(main, "Read", { file_path: path.join(main, "B.output") }, 24),
  ], { age: 5 });
  const a = await agentsOf(home, "s");
  expect(a.A!.checkIns).toBeUndefined();
});

test("check-ins: a command that writes a repo file keeps that as what it is doing, with its read of an output file as a check-in", async () => {
  const { home, main } = office();
  const out = path.join(home, "tmp", "tasks", "B.output").replace(/\\/g, "/");
  session(home, "s", [line.user(main, "x", 150)]);
  agent(home, "s", "B", { agentType: "worker" }, [line.tool(main, "Grep", { pattern: "x" }, 5)], { age: 5 });
  agent(home, "s", "A", { agentType: "worker" }, [line.tool(main, "Bash", { command: `tail -5 "${out}" > notes.md` }, 5)], { age: 5 });
  const a = await agentsOf(home, "s");
  expect(a.A!.doing).toMatchObject({ kind: "write", file: "notes.md" });
  expect(a.A!.checkIns).toEqual([{ with: cc("B"), kind: "read", since: at(5) }]);
});
test("usage: the newest reply's model and context; token totals summed once per reply, with the 1h cache writes and the replies over 100k apart; a made-up line is no reply", async () => {
  const { home, main } = office();
  const u = (input: number, read: number, written: number, output: number, oneHour?: number) => ({
    input_tokens: input,
    cache_read_input_tokens: read,
    cache_creation_input_tokens: written,
    output_tokens: output,
    ...(oneHour == null ? {} : { cache_creation: { ephemeral_1h_input_tokens: oneHour, ephemeral_5m_input_tokens: written - oneHour } }),
  });
  const p = session(home, "s", [
    line.user(main, "go", 60),
    line.reply(main, "m1", u(2, 1000, 500, 100), 50),
    line.reply(main, "m1", u(2, 1000, 500, 300), 50), // the same reply's next block, its output grown
    line.reply(main, "m2", u(3, 150000, 200, 40, 150), 40), // a prompt over 100k
    line.reply(main, "x", u(0, 0, 0, 0), 30, "<synthetic>"),
  ]);
  agent(home, "s", "w", { agentType: "worker" }, [line.tool(main, "Read", { file_path: "x" }, 5)], { age: 5 });
  const read = sourceIn(home);
  const a = byId((await read("s")).facts!.agents);
  const over100k = { input: 3, cacheWrite: 200, cacheWrite1h: 150, cacheRead: 150000, output: 40 };
  expect(a["s:lead"]!.usage).toEqual({ model: "claude-opus-5-5", context: 150203, input: 5, cacheWrite: 700, cacheWrite1h: 150, cacheRead: 151000, output: 340, over100k, at: at(40) });
  expect(a.w!.usage).toBe(null);
  // An appended reply adds its counts; after a compaction the context drops.
  fs.appendFileSync(p, JSON.stringify(line.reply(main, "m3", u(1, 0, 20000, 60), 5, "claude-sonnet-5-5")) + "\n");
  touch(p, 5);
  expect(byId((await read("s")).facts!.agents)["s:lead"]!.usage).toEqual({
    model: "claude-sonnet-5-5",
    context: 20001,
    input: 6,
    cacheWrite: 20700,
    cacheWrite1h: 150,
    cacheRead: 151000,
    output: 400,
    over100k,
    at: at(5),
  });
});

test("errors: an unreadable subagent transcript is counted, not silently dropped; an unreadable session says so", async () => {
  const { home, main } = office();
  const bad = session(home, "bad", [line.user(main, "x")]);
  session(home, "ok", [line.user(main, "x")]);
  const badAgent = agent(home, "ok", "a1", { agentType: "worker" }, [line.text(main, "x", 5)], { age: 5 });
  const broken = new Set([pathKey(bad), pathKey(badAgent)]);
  const base = nodeIo({ run: null });
  const io = {
    read: (file: string, start?: number, end?: number) => {
      if (broken.has(pathKey(file))) throw new Error(`EBUSY: ${path.basename(file)}`);
      return base.read(file, start, end);
    },
  };

  const ok = await sourceIn(home, { io })("ok");
  expect(ok.status).toBe(null);
  expect(ok.facts!.agents.map((a) => a.id)).toEqual([cc("ok:lead")]);
  expect(ok.errors.count).toBe(1);
  expect(ok.errors.first).toMatch(/^EBUSY: /);

  const none = await sourceIn(home, { io })("bad");
  expect(none.facts).toBe(null);
  expect(none.status).toMatch(/^could not read the session transcript: EBUSY: /);
});

test("format drift: lines that parse but never name a cwd report the format, not empty facts", async () => {
  const { home, main } = office();
  session(home, "drift", [{ type: "user", workingDir: main, timestamp: at(30), message: { role: "user", content: "x" } }, line.title("A title")]);
  const r = await sourceIn(home)("drift");
  expect(r.status).toBe("transcript format not recognised");
  expect(r.facts).toBe(null);
});

test("format drift: a session that has written only bookkeeping lines is skipped quietly", async () => {
  const { home } = office();
  session(home, "fresh", [
    line.title("A title"),
    { type: "mode", mode: "default" },
    { type: "last-prompt", lastPrompt: "x" },
    { type: "queue-operation", operation: "enqueue", timestamp: at(10), content: "hello" },
  ]);
  const r = await sourceIn(home)("fresh");
  expect([r.status, r.facts]).toEqual([null, null]);
});

// Orca's branch-name helper: one prompt, one reply, nothing else.
const helperPrompt = (cwd: string, text = "Generate a short git branch name that summarizes the coding task below.") => line.user(cwd, text, 30);
const answer = (cwd: string, age = 25) => line.reply(cwd, "r1", { input_tokens: 10, output_tokens: 5 }, age);

test("left out: a helper session never reports, lights on or off", async () => {
  const { home, main } = office();
  session(home, "helper", [helperPrompt(main), answer(main)]);
  session(home, "helper-asking", [helperPrompt(main, "  GENERATE a short Git branch name for this")]);
  session(home, "helper-old", [helperPrompt(main), answer(main)], { age: 40 * 60 });
  const read = sourceIn(home);
  for (const id of ["helper", "helper-asking", "helper-old"]) expect(await read(id)).toMatchObject({ facts: null, status: null });
});

test("left out: a helper-opening session reports once it takes a second prompt or calls a tool", async () => {
  const { home, main } = office();
  session(home, "two-prompts", [helperPrompt(main), answer(main, 20), line.user(main, "and another", 15)]);
  session(home, "tool", [helperPrompt(main), line.tool(main, "Read", { file_path: path.join(main, "a.md") }, 20)]);
  const read = sourceIn(home);
  expect((await read("two-prompts")).facts).not.toBe(null);
  expect((await read("tool")).facts).not.toBe(null);
});

test("left out: a one-prompt, no-tool session not on helperPrompts reports", async () => {
  const { home, main } = office();
  session(home, "question", [line.user(main, "What does this repo do?", 30), answer(main)]);
  expect((await sourceIn(home)("question")).facts).not.toBe(null);
});

test("left out: a session that never got a real reply reports with its lights on, and stops once they go off", async () => {
  const { home, main } = office();
  session(home, "new-desk", [line.user(main, "<command-name>/model</command-name>")]);
  session(home, "closed", [line.user(main, "<command-name>/model</command-name>")], { age: 40 * 60 });
  session(home, "api-error", [line.user(main, "hi"), line.reply(main, "e1", { output_tokens: 0 }, 25, "<synthetic>")], { age: 40 * 60 });
  session(home, "answered", [line.user(main, "hi"), answer(main)], { age: 40 * 60 });
  const read = sourceIn(home);
  expect((await read("new-desk")).facts!.session.lights).toBe("on");
  expect((await read("closed")).facts).toBe(null);
  expect((await read("api-error")).facts).toBe(null);
  expect((await read("answered")).facts).not.toBe(null);
});

test("left out: a tail-read session is never taken for a helper", async () => {
  const { home, main } = office();
  const helper = [helperPrompt(main), answer(main)];
  const tail = helper.map((l) => JSON.stringify(l) + "\n").join("").length + 10;
  // The earlier part of the transcript is out of reach, so there may have been more prompts.
  session(home, "long", [line.title("x".repeat(1000)), ...helper]);
  expect((await sourceIn(home, { config: { tailBytes: tail } })("long")).facts).not.toBe(null);
});

test("git cache: a branch switch shows once gitCacheSeconds have passed", async () => {
  const { home, main, wt } = office();
  session(home, "s", [line.user(wt, "x")]);
  let clock = NOW;
  const read = sourceIn(home, { now: () => clock });
  const branch = async () => (await read("s")).facts!.session.branch;
  expect(await branch()).toBe("feature/a");
  fs.writeFileSync(path.join(main, ".git", "worktrees", "wt", "HEAD"), "ref: refs/heads/feature/b\n");
  clock = NOW + 30000;
  expect(await branch()).toBe("feature/a");
  clock = NOW + 61000;
  expect(await branch()).toBe("feature/b");
});

test("worktree trap: an isolated agent's branch comes from meta.json or git, never its lines' gitBranch", async () => {
  const { root, home, main } = office();
  const iso = gitWorktree(main, path.join(root, "projects", "repo", ".claude", "worktrees", "agent-w1"), "agent-w1", "worktree-agent-w1");
  const iso2 = gitWorktree(main, path.join(root, "iso2"), "iso2", "resolved-from-git");
  session(home, "s", [line.user(main, "x", 30, { gitBranch: "main" })]);
  agent(home, "s", "w1", { agentType: "general-purpose", worktreePath: iso, worktreeBranch: "worktree-agent-w1" }, [line.tool(iso, "Read", { file_path: path.join(iso, "a.md") }, 5, { gitBranch: "main" })], { age: 5 });
  agent(home, "s", "w2", { agentType: "general-purpose" }, [line.tool(iso2, "Read", { file_path: "x" }, 5, { gitBranch: "main" })], { age: 5 });
  agent(home, "s", "w3", { agentType: "general-purpose" }, [line.tool(main, "Read", { file_path: "x" }, 5, { gitBranch: "main" })], { age: 5 });

  const f = await factsOf(home, "s");
  const a = byId(f.agents);
  expect(f.session.branch).toBe("main");
  expect(a.w1!.branch).toBe("worktree-agent-w1");
  expect(a.w1!.checkout).toBe(normalize(iso));
  expect(a.w1!.doing!.file).toBe("a.md");
  expect(a.w2!.branch).toBe("resolved-from-git");
  expect(a.w2!.checkout).toBe(normalize(iso2));
  expect("checkout" in a.w3!).toBe(false);
  expect("branch" in a.w3!).toBe(false);
});

const byAgentAndFile = <T extends { agent: string; file: string }>(list: T[]) => [...list].sort((x, y) => (x.agent + x.file).localeCompare(y.agent + y.file));

test("edits: Edit/Write/NotebookEdit in the window, per agent with the newest time, relative to each worktree", async () => {
  const { home, main, wt, other } = office();
  session(home, "s", [
    line.tool(main, "Edit", { file_path: path.join(main, "Lib", "A.mjs") }, 90),
    line.tool(main, "Edit", { file_path: path.join(main, "Lib", "A.mjs") }, 60),
    line.tool(main, "Write", { file_path: path.join(main, "b.md") }, 60),
    line.tool(main, "NotebookEdit", { notebook_path: path.join(main, "n.ipynb") }, 60),
    line.tool(main, "Read", { file_path: path.join(main, "read-only.md") }, 60),
    line.tool(main, "Edit", { file_path: path.join(other, "outside.md") }, 60),
    line.tool(main, "Edit", { file_path: path.join(main, "stale.md") }, 40 * 60),
  ]);
  agent(home, "s", "w", { agentType: "worker" }, [line.tool(wt, "Edit", { file_path: path.join(wt, "src", "c.mjs") }, 30)], { age: 30 });
  expect((await factsOf(home, "s")).edits).toEqual([
    { agent: cc("s:lead"), file: "Lib/A.mjs", at: at(60) },
    { agent: cc("s:lead"), file: "b.md", at: at(60) },
    { agent: cc("s:lead"), file: "n.ipynb", at: at(60) },
    { agent: cc("s:lead"), file: "outside.md", project: localProject(other), away: true, at: at(60) },
    { agent: cc("w"), file: "src/c.mjs", at: at(30) },
  ]);
});

test("shell writes: a Bash append counts as an edit and shows as a write, its cd followed; a read-only command does neither", async () => {
  const { home, main } = office();
  session(home, "s", [line.user(main, "x")]);
  const append = `cd "${path.join(main, "docs").replace(/\\/g, "/")}" && printf 'joke\\n' >> README.md && tail -n 3 README.md`;
  agent(home, "s", "w", { agentType: "worker" }, [line.tool(main, "Bash", { command: append }, 5)], { age: 5 });
  agent(home, "s", "r", { agentType: "worker" }, [line.tool(main, "Bash", { command: "tail -n 3 README.md" }, 5)], { age: 5 });
  agent(home, "s", "p", { agentType: "worker" }, [line.tool(main, "PowerShell", { command: "Add-Content -Path notes.md -Value 'x'" }, 5)], { age: 5 });
  const f = await factsOf(home, "s");
  const a = byId(f.agents);
  expect(byAgentAndFile(f.edits)).toEqual([
    { agent: cc("p"), file: "notes.md", at: at(5) },
    { agent: cc("w"), file: "docs/README.md", at: at(5) },
  ]);
  expect([a.w!.doing, a.r!.doing, a.p!.doing]).toEqual([
    { kind: "write", file: "docs/README.md", since: at(5) },
    { kind: "run", since: at(5) },
    { kind: "write", file: "notes.md", since: at(5) },
  ]);
});

test("shell writes: a cd in an earlier call is followed through the cwd Claude Code writes on the next lines", async () => {
  const { home, main } = office();
  const docs = path.join(main, "docs");
  fs.mkdirSync(docs);
  session(home, "s", [
    line.tool(main, "Bash", { command: "cd docs" }, 60),
    line.result(docs, "t", {}, 59),
    line.tool(docs, "Bash", { command: "touch y.md" }, 50),
    line.tool(docs, "PowerShell", { command: "Set-Content z.md 'x'" }, 40),
  ]);
  expect(byAgentAndFile((await factsOf(home, "s")).edits)).toEqual([
    { agent: cc("s:lead"), file: "docs/y.md", at: at(50) },
    { agent: cc("s:lead"), file: "docs/z.md", at: at(40) },
  ]);
});

test("reads: Read on a file and a shell command's reads, per agent with the newest time; edits are not reads", async () => {
  const { home, main } = office();
  session(home, "s", [
    line.tool(main, "Read", { file_path: path.join(main, "Lib", "A.mjs") }, 90),
    line.tool(main, "Read", { file_path: path.join(main, "Lib", "A.mjs") }, 60),
    line.tool(main, "Edit", { file_path: path.join(main, "b.md") }, 60),
    line.tool(main, "Bash", { command: "tail -n 3 README.md && echo x >> c.md" }, 50),
    line.tool(main, "PowerShell", { command: "Get-Content -Raw d.md" }, 40),
    line.tool(main, "Read", { file_path: path.join(main, "stale.md") }, 40 * 60),
  ]);
  expect((await factsOf(home, "s")).reads).toEqual([
    { agent: cc("s:lead"), file: "Lib/A.mjs", at: at(60) },
    { agent: cc("s:lead"), file: "README.md", at: at(50) },
    { agent: cc("s:lead"), file: "d.md", at: at(40) },
  ]);
});

test("degraded: unrecognised transcripts and a cwd git can't place say so", async () => {
  const { root, home } = office();
  session(home, "junk", ["<<<", "also not json", '{"no":"type"}']);
  const read = sourceIn(home);
  expect(await read("junk")).toMatchObject({ facts: null, status: "transcript format not recognised" });

  const gone = path.join(root, "deleted", "wt");
  session(home, "removed-worktree", [line.user(gone, "x")], { slug: "gone" });
  expect(await read("removed-worktree")).toMatchObject({ facts: null, status: `git could not place ${normalize(gone)}` });
});

test("incremental reads: first sight reads the tail, and before it only usage; later passes read only appended bytes", async () => {
  const { home, main } = office();
  const filler = Array.from({ length: 40 }, (_, i) => line.user(main, "padding line " + i, 100));
  const p = session(home, "s", [line.title("Too early to see"), ...filler, line.title("Recent title")]);
  const reads: [number | undefined, number | undefined][] = [];
  const base = nodeIo({ run: null });
  const io = {
    read: (file: string, start?: number, end?: number) => {
      if (pathKey(file) === pathKey(p)) reads.push([start, end]);
      return base.read(file, start, end);
    },
  };
  const read = sourceIn(home, { io, config: { tailBytes: 400 } });
  const title = async () => (await read("s")).facts!.session.title;

  const size1 = fs.statSync(p).size;
  expect(await title()).toBe("Recent title");
  // The part before the tail in 400-byte pieces, for its usage, then the tail.
  const before = size1 - 400;
  const pieces = Array.from({ length: Math.ceil(before / 400) }, (_, i) => [i * 400, Math.min(before, (i + 1) * 400)]);
  expect(reads).toEqual([...pieces, [before, size1]]);
  const first = reads.length;

  fs.appendFileSync(p, JSON.stringify(line.title("Newest title")) + "\n" + '{"type":"user","cwd":"half-writ');
  touch(p, 1);
  const size2 = fs.statSync(p).size;
  expect(await title()).toBe("Newest title");
  expect(reads[first]).toEqual([size1, size2]);

  // The half-written line is re-read once it is finished.
  fs.appendFileSync(p, 'ten"}\n');
  touch(p, 1);
  await read("s");
  expect(reads[first + 1]![0]).toBe(size2 - '{"type":"user","cwd":"half-writ'.length);
});

test("usage on a long session: the totals count every reply in the file, not just the tail, each once", async () => {
  const { home, main } = office();
  const u = (output: number) => ({ input_tokens: 1, cache_read_input_tokens: 10, cache_creation_input_tokens: 0, output_tokens: output });
  const tailLines = [line.reply(main, "m3", u(30), 20), line.user(main, "padding", 15), line.reply(main, "m4", u(40), 10)];
  const p = session(home, "s", [
    line.user(main, "go", 90),
    line.reply(main, "m1", u(10), 80),
    ...Array.from({ length: 30 }, (_, i) => line.user(main, "padding line " + i, 70)),
    line.reply(main, "m2", u(20), 60),
    line.reply(main, "m3", u(25), 20), // m3's first block, before the tail; its second, in it, replaces it
    ...tailLines,
  ]);
  // The tail starts 50 bytes into m3's second block.
  const tail = Buffer.byteLength(tailLines.map((l) => JSON.stringify(l) + "\n").join("")) - 50;
  const read = sourceIn(home, { config: { tailBytes: tail } });
  const usage = () => read("s").then((r) => byId(r.facts!.agents)["s:lead"]!.usage!);
  expect(await usage()).toMatchObject({ input: 4, cacheRead: 40, output: 100, context: 11, at: at(10) });

  fs.appendFileSync(p, JSON.stringify(line.reply(main, "m5", u(50), 5)) + "\n");
  touch(p, 5);
  expect(await usage()).toMatchObject({ input: 5, cacheRead: 50, output: 150, at: at(5) });
  expect(fs.statSync(p).size).toBeGreaterThan(tail * 3);
});

test("cache pruning: a subagent transcript a pass didn't use is forgotten, and read afresh if it comes back", async () => {
  const { home, main } = office();
  session(home, "s", [line.user(main, "x")]);
  const p = agent(home, "s", "w", { agentType: "worker" }, [line.text(main, "x", 10)], { age: 10 });
  const reads: (number | undefined)[] = [];
  const base = nodeIo({ run: null });
  const io = {
    read: (file: string, start?: number, end?: number) => {
      if (pathKey(file) === pathKey(p)) reads.push(start);
      return base.read(file, start, end);
    },
  };
  const read = sourceIn(home, { io });
  await read("s");
  touch(p, 2 * 60 * 60); // out of the window: not read
  expect((await read("s")).facts!.agents.map((a) => a.id)).toEqual([cc("s:lead")]);
  touch(p, 10);
  expect((await read("s")).facts!.agents).toHaveLength(2);
  // Kept in the cache, the unchanged file would not have been read again.
  expect(reads).toEqual([0, 0]);
});

test("lead: the runner finds a session by name and reads its folder, open turn, compaction and context", async () => {
  const { home, main } = office();
  const u = (read: number) => ({ input_tokens: 1, cache_read_input_tokens: read, cache_creation_input_tokens: 0, output_tokens: 5 });
  const p = session(home, "s", [line.user(main, "go", 60), line.reply(main, "m1", u(1000), 50)], { slug: "somewhere" });
  const source = createClaudeCode({ ...nodeIo({ run: null }), claudeDir: path.join(home, ".claude") });
  const config = { tailBytes: 1048576, stalledMinutes: 5 };
  expect(await source.lead("s", NOW, config)).toEqual({ cwd: main, working: false, compacted: false, context: 1001, lastActive: NOW - 10000 });
  expect(await source.lead("missing", NOW, config)).toBe(null);

  // A new prompt opens its turn; a compaction stays seen.
  fs.appendFileSync(p, [{ type: "system", subtype: "compact_boundary", content: "Conversation compacted", timestamp: at(8) }, line.user(main, "summary", 8, { isCompactSummary: true }), line.user(main, "next", 5)].map((l) => JSON.stringify(l)).join("\n") + "\n");
  touch(p, 5);
  expect(await source.lead("s", NOW, config)).toMatchObject({ working: true, compacted: true });
  // An open turn quiet past stalledMinutes isn't mid-turn.
  expect(await source.lead("s", NOW + 6 * 60000, config)).toMatchObject({ working: false });

  // A compaction before a tail read is still seen.
  const long = session(home, "long", [{ type: "system", subtype: "compact_boundary", timestamp: at(100) }, ...Array.from({ length: 50 }, (_, i) => line.text(main, "x".repeat(100), 90 - i))]);
  expect(fs.statSync(long).size).toBeGreaterThan(2000);
  expect(await source.lead("long", NOW, { ...config, tailBytes: 1000 })).toMatchObject({ compacted: true });
});

// #74: which repo each edit, read and command lands in. Home is the session's folder.
test("attribution, paths: an edit or read in another repo names that repo and is away; one in a folder not made yet is placed by its nearest folder", async () => {
  const { home, main, other } = office();
  session(home, "s", [
    line.tool(main, "Edit", { file_path: path.join(other, "src", "api.ts") }, 60),
    line.tool(main, "Write", { file_path: path.join(other, "src", "new", "deep", "x.ts") }, 50),
    line.tool(main, "Read", { file_path: path.join(other, "README.md") }, 40),
    line.tool(main, "Edit", { file_path: path.join(main, "a.ts") }, 30),
  ]);
  const f = (await sourceIn(home)("s", main)).facts!;
  const away = { project: localProject(other), away: true };
  expect(f.edits).toEqual([
    { agent: cc("s:lead"), file: "src/api.ts", ...away, at: at(60) },
    { agent: cc("s:lead"), file: "src/new/deep/x.ts", ...away, at: at(50) },
    { agent: cc("s:lead"), file: "a.ts", at: at(30) },
  ]);
  expect(f.reads).toEqual([{ agent: cc("s:lead"), file: "README.md", ...away, at: at(40) }]);
});

test("attribution, cd: a shell command that cds into another repo writes there, and a command run there is doing work there", async () => {
  const { home, main, other } = office();
  const o = normalize(other);
  session(home, "s", [line.user(main, "x")]);
  agent(home, "s", "w", { agentType: "worker" }, [line.tool(main, "Bash", { command: `cd "${o}" && echo x >> notes.md` }, 5)], { age: 5 });
  agent(home, "s", "t", { agentType: "worker" }, [line.tool(main, "Bash", { command: `cd "${o}" && npm test` }, 5)], { age: 5 });
  agent(home, "s", "h", { agentType: "worker" }, [line.tool(main, "Bash", { command: "npm test" }, 5)], { age: 5 });
  const f = (await sourceIn(home)("s", main)).facts!;
  const a = byId(f.agents);
  const away = { project: localProject(other), away: true };
  expect(f.edits).toEqual([{ agent: cc("w"), file: "notes.md", ...away, at: at(5) }]);
  expect([a.w!.doing, a.t!.doing, a.h!.doing]).toEqual([
    { kind: "write", file: "notes.md", ...away, since: at(5) },
    { kind: "run", ...away, since: at(5) },
    { kind: "run", since: at(5) },
  ]);
});

test("attribution, git -C: a git command pointed at another repo is doing work there", async () => {
  const { home, main, other } = office();
  session(home, "s", [line.user(main, "x")]);
  agent(home, "s", "g", { agentType: "worker" }, [line.tool(main, "PowerShell", { command: `git -C "${other}" commit -m "Use v2 tokens"` }, 5)], { age: 5 });
  agent(home, "s", "m", { agentType: "worker" }, [line.tool(main, "Bash", { command: `git -C "${normalize(main)}" status` }, 5)], { age: 5 });
  const a = byId((await sourceIn(home)("s", main)).facts!.agents);
  expect(a.g!.doing).toEqual({ kind: "run", project: localProject(other), away: true, since: at(5) });
  expect(a.m!.doing).toEqual({ kind: "run", since: at(5) });
});

test("attribution, worktrees: an edit in a worktree of another repo is that repo's; one in a worktree of the session's own repo is home", async () => {
  const { root, home, main, wt, other } = office();
  const otherWt = gitWorktree(other, path.join(root, "orca", "other-wt"), "other-wt", "feat/tokens");
  session(home, "s", [
    line.tool(main, "Edit", { file_path: path.join(otherWt, "src", "tokens.ts") }, 60),
    line.tool(main, "Edit", { file_path: path.join(wt, "src", "own.ts") }, 50),
  ]);
  expect((await sourceIn(home)("s", main)).facts!.edits).toEqual([
    { agent: cc("s:lead"), file: "src/tokens.ts", project: localProject(other), away: true, at: at(60) },
    { agent: cc("s:lead"), file: "src/own.ts", at: at(50) },
  ]);
});

test("attribution, workspace: a session in a folder holding repos reports, each file named by its repo and none away; a repo outside it is away", async () => {
  const { root, home, other } = office();
  const ws = path.join(root, "lorveil");
  const api = gitRepo(path.join(ws, "api"));
  const web = gitRepo(path.join(ws, "web"));
  session(home, "s", [
    line.tool(ws, "Edit", { file_path: path.join(api, "src", "invoices.ts") }, 60),
    line.tool(ws, "Edit", { file_path: path.join(web, "src", "Invoices.vue") }, 50),
    line.tool(ws, "Write", { file_path: path.join(ws, "notes.md") }, 40),
    line.tool(ws, "Edit", { file_path: path.join(other, "x.ts") }, 30),
  ]);
  agent(home, "s", "w", { agentType: "worker" }, [line.tool(api, "Bash", { command: "npm test" }, 5)], { age: 5 });
  const f = (await sourceIn(home)("s", ws)).facts!;
  expect(f.session.checkout).toBe(normalize(ws));
  expect(f.edits).toEqual([
    { agent: cc("s:lead"), file: "src/invoices.ts", project: localProject(api), at: at(60) },
    { agent: cc("s:lead"), file: "src/Invoices.vue", project: localProject(web), at: at(50) },
    { agent: cc("s:lead"), file: "notes.md", at: at(40) },
    { agent: cc("s:lead"), file: "x.ts", project: localProject(other), away: true, at: at(30) },
  ]);
  // Working in one of its repos, an agent is not in a worktree, and is home.
  const w = byId(f.agents).w!;
  expect([w.checkout, w.doing]).toEqual([undefined, { kind: "run", project: localProject(api), since: at(5) }]);
  // A plain folder with no repos in it is still not placed.
  const plain = path.join(root, "plain");
  fs.mkdirSync(plain);
  session(home, "p", [line.user(plain, "x")]);
  expect((await sourceIn(home)("p", plain)).facts).toBe(null);
});

test("attribution, nested repos: a file is credited to the innermost repo it is in, whatever folder the call came from", async () => {
  const { home, main, other } = office();
  const inner = gitRepo(path.join(main, "vendor", "inner"));
  session(home, "s", [
    line.tool(main, "Edit", { file_path: path.join(inner, "lib.ts") }, 60),
    line.tool(other, "Edit", { file_path: path.join(inner, "lib2.ts") }, 50),
    line.tool(inner, "Edit", { file_path: path.join(main, "top.ts") }, 40),
  ]);
  expect((await sourceIn(home)("s", main)).facts!.edits).toEqual([
    { agent: cc("s:lead"), file: "lib.ts", project: localProject(inner), at: at(60) },
    { agent: cc("s:lead"), file: "lib2.ts", project: localProject(inner), at: at(50) },
    { agent: cc("s:lead"), file: "top.ts", at: at(40) },
  ]);
});

test("attribution, symlinks: a path through a link is compared with the repo's real folder", async () => {
  const { root, home, main, other } = office();
  const link = path.join(root, "linked-other");
  fs.symlinkSync(other, link, "junction");
  session(home, "s", [line.tool(main, "Edit", { file_path: path.join(link, "src", "x.ts") }, 30)]);
  expect((await sourceIn(home)("s", main)).facts!.edits).toEqual([{ agent: cc("s:lead"), file: "src/x.ts", project: localProject(other), away: true, at: at(30) }]);
});

test("attribution, a second clone with the session's remote is the session's own project, not another repo", async () => {
  const { root, home, main, other } = office();
  const clone = gitRepo(path.join(root, "clone-of-repo"));
  const remotes: Record<string, string> = { [normalize(main)]: "github.com/team/app", [normalize(clone)]: "github.com/team/app", [normalize(other)]: "github.com/team/api" };
  const byRemote = (where: { toplevel: string }) => ({ id: remotes[normalize(where.toplevel)]!, name: path.basename(where.toplevel) });
  session(home, "s", [line.tool(main, "Edit", { file_path: path.join(clone, "a.ts") }, 40), line.tool(main, "Edit", { file_path: path.join(other, "a.ts") }, 30)]);
  expect((await sourceIn(home, { projectOf: byRemote })("s", main)).facts!.edits).toEqual([
    { agent: cc("s:lead"), file: "a.ts", at: at(40) },
    { agent: cc("s:lead"), file: "a.ts", project: { id: "github.com/team/api", name: "other" }, away: true, at: at(30) },
  ]);
});

test("attribution, workspace: never the home folder or one above it, nor a folder with more repos than workspaceRepos; its listing is kept a while", async () => {
  const { root, home } = office();
  const ws = path.join(root, "work", "lorveil");
  for (const r of ["api", "web"]) gitRepo(path.join(ws, r));
  session(home, "s", [line.user(ws, "x")]);
  // The folder is the person's home, or above it.
  expect((await sourceIn(home, { home: ws })("s", ws)).facts).toBe(null);
  expect((await sourceIn(home, { home: path.join(ws, "api") })("s", ws)).facts).toBe(null);
  // Too many repos to be one piece of work.
  expect((await sourceIn(home, { config: { workspaceRepos: 1 } })("s", ws)).facts).toBe(null);
  const listed: string[] = [];
  const base = nodeIo({ run: null });
  const read = sourceIn(home, { io: { listDir: (dir) => (listed.push(normalize(dir)), base.listDir(dir)) } });
  expect((await read("s", ws)).workspace).toBe(true);
  await read("s", ws);
  expect(listed.filter((d) => d === normalize(ws))).toHaveLength(1);
});

test.skipIf(!caseless)("attribution, letter case: a local repo reached in another spelling is the same project, where the file system ignores case", async () => {
  const { home, main, other } = office();
  session(home, "s", [line.tool(main, "Edit", { file_path: path.join(other, "a.ts") }, 40), line.tool(main, "Edit", { file_path: path.join(other.toUpperCase(), "b.ts") }, 30)]);
  const edits = (await sourceIn(home)("s", main)).facts!.edits;
  expect(edits.map((e) => e.project!.id)).toEqual([localProject(other).id, localProject(other).id]);
});

test("attribution, checkouts: a subagent working in a worktree of another repo is named, so its checkout goes only where that repo may", async () => {
  const { root, home, main, other } = office();
  const otherWt = gitWorktree(other, path.join(root, "orca", "other-wt2"), "other-wt2", "feat/x");
  session(home, "s", [line.user(main, "x")]);
  agent(home, "s", "w", { agentType: "worker", worktreePath: otherWt, worktreeBranch: "feat/x" }, [line.tool(otherWt, "Read", { file_path: path.join(otherWt, "a.ts") }, 5)], { age: 5 });
  agent(home, "s", "h", { agentType: "worker" }, [line.tool(main, "Read", { file_path: path.join(main, "a.ts") }, 5)], { age: 5 });
  const read = await sourceIn(home)("s", main);
  expect(read.checkouts).toEqual({ [cc("w")]: localProject(other).id });
  expect(byId(read.facts!.agents).w).toMatchObject({ checkout: normalize(otherWt), branch: "feat/x" });
});
