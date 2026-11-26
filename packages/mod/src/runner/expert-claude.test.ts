import fs from "node:fs";
import path from "node:path";
import { expect, test } from "vitest";
import { tempRoot } from "../data-layer/fixture.js";
import { forkEnv, hiddenSpawn } from "./claude.js";
import { appendArgs, converse, expertForkArgs, inside, judgeArgs, trunkArgs } from "./expert-claude.js";

const READ_ONLY = ["--tools", "Read,Grep,Glob,Agent", "--disallowedTools", "Bash,PowerShell,Edit,Write,NotebookEdit,WebFetch,WebSearch", "--setting-sources", "", "--settings", '{"disableAllHooks":true}', "--strict-mcp-config", "--permission-mode", "dontAsk", "--autocompact", "1000000"];
const STREAM = ["--input-format", "stream-json", "--output-format", "stream-json", "--verbose"];

test("argv: the four kinds are pinned, flag by flag", () => {
  expect(trunkArgs("t-1", "sonnet")).toEqual(["-p", "--session-id", "t-1", "--model", "sonnet", ...READ_ONLY, ...STREAM]);
  expect(appendArgs("t-1", "claude-sonnet-5-5")).toEqual(["-p", "--resume", "t-1", "--model", "claude-sonnet-5-5", ...READ_ONLY, ...STREAM]);
  expect(expertForkArgs("t-1", "claude-sonnet-5-5")).toEqual(["-p", "--resume", "t-1", "--fork-session", "--no-session-persistence", "--model", "claude-sonnet-5-5", ...READ_ONLY, ...STREAM]);
  expect(expertForkArgs("t-1", "claude-sonnet-5-5", "u-2")).toEqual(["-p", "--resume", "t-1", "--fork-session", "--no-session-persistence", "--resume-session-at", "u-2", "--model", "claude-sonnet-5-5", ...READ_ONLY, ...STREAM]);
  expect(judgeArgs("haiku")).toEqual(["-p", "--no-session-persistence", "--tools", "", "--setting-sources", "", "--settings", '{"disableAllHooks":true}', "--strict-mcp-config", "--permission-mode", "dontAsk", "--model", "haiku", ...STREAM]);
});

test("inside: resolved, with forward slashes, lower-case on Windows; null outside", () => {
  expect(inside("c:/x/read", "C:\\x\\read\\a.ts", "win32")).toBe("a.ts");
  expect(inside("C:\\x\\read\\", "C:\\X\\Read\\src\\b.ts", "win32")).toBe("src/b.ts");
  expect(inside("c:/x/read", "c:/x/reader/a.ts", "win32")).toBe(null);
  expect(inside("c:/x/read", "c:/x/read/../notes/a.md", "win32")).toBe(null);
  expect(inside("/x/read", "/x/Read/a.ts", "linux")).toBe(null);
  expect(inside("/x/read", "src/a.ts", "linux")).toBe("src/a.ts");
  expect(inside("/x/experts", "/x/experts", "darwin")).toBe("");
});

// A stand-in for `claude`: it logs its argv and every stdin line, and answers each user turn with
// the next list of events in FAKE_SCRIPT ({ init, turns }); `exit` among them exits at once.
const FAKE = `
import fs from "node:fs";
const script = JSON.parse(fs.readFileSync(process.env.FAKE_SCRIPT, "utf8"));
const log = (x) => fs.appendFileSync(process.env.FAKE_LOG, JSON.stringify(x) + "\\n");
const out = (x) => process.stdout.write(JSON.stringify(x) + "\\n");
log({ argv: process.argv.slice(2) });
let turn = 0, buf = "";
process.stdin.setEncoding("utf8").on("data", (d) => {
  buf += d;
  let i;
  while ((i = buf.indexOf("\\n")) >= 0) {
    const line = JSON.parse(buf.slice(0, i));
    buf = buf.slice(i + 1);
    log({ turn: turn + 1, text: line.message.content[0].text });
    if (turn === 0 && script.init) out(script.init);
    for (const e of script.turns[turn] ?? []) {
      if (e === "exit") process.exit(3);
      out(e);
    }
    turn++;
  }
}).on("end", () => {
  log({ closed: true });
  process.exit(0);
});
setInterval(() => {}, 1000);
`;

const u = (input: number, read: number, write: number, output: number) => ({ input_tokens: input, cache_read_input_tokens: read, cache_creation_input_tokens: write, output_tokens: output });
const assistant = (id: string, usage: ReturnType<typeof u>, content: unknown[] = [], parent: string | null = null) => ({ type: "assistant", parent_tool_use_id: parent, message: { id, usage, content } });
const read = (file: string) => ({ type: "tool_use", id: `r-${file}`, name: "Read", input: { file_path: file } });
const result = (text: string, usage: ReturnType<typeof u>) => ({ type: "result", subtype: "success", num_turns: 1, result: text, usage });

type Script = { init?: unknown; turns: unknown[][] };

function run(script: Script | ((readDir: string) => Script), turns: string[], o: { timeoutMs?: number } = {}) {
  const root = tempRoot();
  const bin = path.join(root, "claude.mjs");
  const readDir = path.join(root, "read");
  fs.mkdirSync(readDir);
  fs.writeFileSync(bin, FAKE);
  fs.writeFileSync(path.join(root, "script.json"), JSON.stringify(typeof script === "function" ? script(readDir) : script));
  const logFile = path.join(root, "log.jsonl");
  const child = hiddenSpawn([process.execPath, bin, ...expertForkArgs("t-1", "sonnet")], { cwd: readDir, env: forkEnv({ ...process.env, FAKE_SCRIPT: path.join(root, "script.json"), FAKE_LOG: logFile }) });
  const [first, ...rest] = turns;
  const conversation = converse(child, first!, () => rest.shift() ?? null, o.timeoutMs ?? 10000, { root: readDir });
  const logged = () => fs.readFileSync(logFile, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  return { conversation, readDir, logged };
}

test("stream: turns in order, the model from init, reads inside the checkout (a subagent's too), explored, stdin closed after the last", async () => {
  const elsewhere = tempRoot();
  const r = run(
    (readDir) => ({
      init: { type: "system", subtype: "init", model: "claude-sonnet-5-5", tools: ["Read", "Grep", "Glob", "Agent"] },
      turns: [
        [assistant("m1", u(10, 0, 100, 5)), result("grounded", u(10, 0, 100, 5))],
        [
          assistant("m2", u(1, 100, 0, 3), [{ type: "tool_use", id: "a1", name: "Agent", input: { prompt: "explore" } }]),
          // The subagent reads by absolute path, inside the checkout and out of it.
          assistant("s1", u(50, 0, 0, 7), [read(path.join(readDir, "src", "a.ts")), read(path.join(elsewhere, "outside.ts"))], "a1"),
          assistant("m3", u(1, 110, 0, 9), [read("docs/adr/0004.md")]),
          result("<answer>yes</answer>", u(2, 210, 0, 12)),
        ],
      ],
    }),
    ["ground", "question"],
  );
  const c = await r.conversation;
  expect(c.ok).toBe(true);
  expect(c.model).toBe("claude-sonnet-5-5");
  expect(c.turns.map((t) => t.text)).toEqual(["grounded", "<answer>yes</answer>"]);
  expect([...c.reads].sort()).toEqual(["docs/adr/0004.md", "src/a.ts"]);
  expect(c.explored).toBe(true);
  expect(c.compacted).toBe(false);
  // Stdin closed with the last turn: the fake logs it as it exits.
  for (let i = 0; i < 200 && !r.logged().some((l) => l.closed); i++) await new Promise((done) => setTimeout(done, 10));
  expect(r.logged().slice(1)).toEqual([{ turn: 1, text: "ground" }, { turn: 2, text: "question" }, { closed: true }]);
});

test("stream: a three-call turn's context is its last top-level call's, not the result's sum; its cost is the result's usage plus its subagents' messages", async () => {
  const c = await run(
    {
      turns: [
        [
          assistant("m1", u(5, 1000, 0, 10)),
          assistant("m1", u(5, 1000, 0, 20)), // the same message again: its last event counts
          assistant("s1", u(400, 0, 0, 40), [], "tool-1"),
          assistant("s1", u(400, 0, 0, 50), [], "tool-1"), // a subagent's call, in the cost and never the meter
          assistant("m2", u(5, 1030, 0, 15)),
          // A top-level event's output is early and partial: the result's counts for it.
          assistant("m3", u(5, 1050, 0, 3)),
          // Sums the top-level calls only, and leaves out the subagent's.
          result("one", u(15, 3080, 0, 1050)),
        ],
        // The result weighs more than the messages here, and the subagent's call still counts.
        [assistant("m4", u(1, 1100, 0, 4)), assistant("s2", u(30, 0, 0, 6), [], "tool-2"), result("two", u(1, 1100, 900, 4))],
      ],
    },
    ["a", "b"],
  ).conversation;
  expect(c.turns[0]).toEqual({ text: "one", context: 5 + 1050 + 3, usage: { input: 415, cacheRead: 3080, cacheWrite: 0, output: 1100 } });
  expect(c.turns[1]).toEqual({ text: "two", context: 1105, usage: { input: 31, cacheRead: 1100, cacheWrite: 900, output: 10 } });
  expect(c.usage).toEqual({ input: 446, cacheRead: 4180, cacheWrite: 900, output: 1110 });
});

test("stream: a compact_boundary fails the conversation and ends the process", async () => {
  const c = await run({ turns: [[assistant("m1", u(1, 1, 1, 1)), { type: "system", subtype: "compact_boundary" }, result("late", u(1, 1, 1, 1))]] }, ["a"]).conversation;
  expect(c).toMatchObject({ ok: false, compacted: true, failure: { kind: "compacted" } });
  expect(c.usage).toEqual({ input: 1, cacheRead: 1, cacheWrite: 1, output: 1 });
});

test("stream: a disallowed tool offered in init, or used by a subagent, fails it at once", async () => {
  const offered = await run({ init: { type: "system", subtype: "init", model: "m", tools: ["Read", "Bash"] }, turns: [[result("x", u(1, 1, 1, 1))]] }, ["a"]).conversation;
  expect(offered).toMatchObject({ ok: false, turns: [], failure: { kind: "disallowed", detail: "a disallowed tool was offered: Bash" } });
  const used = await run({ turns: [[assistant("s1", u(1, 1, 1, 1), [{ type: "tool_use", id: "w", name: "Write", input: {} }], "a1"), result("x", u(1, 1, 1, 1))]] }, ["a"]).conversation;
  expect(used).toMatchObject({ ok: false, turns: [], failure: { kind: "disallowed", detail: "a disallowed tool was used: Write" } });
});

test("stream: an error result, an early exit and the time limit each fail it", async () => {
  expect((await run({ turns: [[{ type: "result", subtype: "error_max_turns", num_turns: 1, is_error: true }]] }, ["a"]).conversation).failure).toEqual({ kind: "failed", detail: "turn 1 stopped with error_max_turns" });
  expect((await run({ turns: [["exit"]] }, ["a"]).conversation).failure).toEqual({ kind: "failed", detail: "claude exited with code 3 before its last turn ended" });
  expect((await run({ turns: [[]] }, ["a"], { timeoutMs: 300 }).conversation).failure).toEqual({ kind: "timed-out", detail: "no reply within 0 s" });
});
