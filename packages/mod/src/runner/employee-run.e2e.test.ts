// An employee end to end with real Claude Code (isoplan-app#341), against a stand-in Messages API
// (ANTHROPIC_BASE_URL, a dummy key, an empty Claude folder, nonessential traffic off, this session's
// own Claude Code and Anthropic variables stripped), as expert-fork-during-addition.e2e.test.ts runs
// it. The registry (employees.ts) grounds the employee, and a run's stand-in replies call Isoplan's
// tools through the runner's own HTTP endpoint (employee-tools.ts): `ask_expert`, whose answer is
// held a few seconds, then `leave_draft` twice. Real Claude Code lists the `isoplan` server connected
// with both tools at init, the grounding's and the run's requests offer byte-identical tools, none
// outside the job's and Isoplan's two, a job listing WebSearch offers it and isn't failed, a
// rejection's correction becomes what the employee learned (with no files), and the next run's request
// carries the rejected recipient. No process is started for the tools, so none could open a window.

import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { afterEach, expect, test, vi } from "vitest";
import { tempRoot } from "../data-layer/fixture.js";
import { findClaude } from "./claude-binary.js";
import { ASK_EXPERT_TOOL, LEAVE_DRAFT_TOOL } from "./employee-claude.js";
import { setUpEmployee, until } from "./employee-fixture.js";

vi.stubEnv("CLAUDE_CONFIG_DIR", path.join(tempRoot(), "claude"));
for (const [k, v] of Object.entries({ GIT_AUTHOR_NAME: "Adam", GIT_AUTHOR_EMAIL: "adam@example.invalid", GIT_COMMITTER_NAME: "Adam", GIT_COMMITTER_EMAIL: "adam@example.invalid" })) vi.stubEnv(k, v);
vi.setConfig({ testTimeout: 480000 });

const closing: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const close of closing.splice(0).reverse()) await close();
});

type Block = { type: string; text?: string; name?: string; content?: unknown };
type Body = { model: string; stream?: boolean; tools?: { name: string }[]; messages: { role: string; content: string | Block[] }[] };
const textOf = (content: Body["messages"][number]["content"]) => (typeof content === "string" ? content : content.flatMap((c) => (c.type === "text" && c.text ? [c.text] : [])).join("\n"));
const all = (b: Body) => b.messages.map((m) => textOf(m.content)).join("\n");
const toolResults = (b: Body) => b.messages.flatMap((m) => (typeof m.content === "string" ? [] : m.content.filter((c) => c.type === "tool_result")));

/** A stand-in Messages API: every request kept; each answered by what its conversation says. */
async function messagesApi() {
  const bodies: Body[] = [];
  const server = http.createServer((request, response) => {
    let raw = "";
    request.setEncoding("utf8").on("data", (piece: string) => (raw += piece));
    request.on("end", () => {
      if (!request.url?.startsWith("/v1/messages")) return void response.writeHead(404).end();
      if (request.url.startsWith("/v1/messages/count_tokens")) return void response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ input_tokens: 1000 }));
      const b = JSON.parse(raw) as Body;
      bodies.push(b);
      const said = all(b);
      let reply: { text: string } | { tool: string; input: Record<string, unknown> } = { text: "ok" };
      if (said.includes("Today's run")) {
        const done = toolResults(b).length;
        reply = [{ tool: ASK_EXPERT_TOOL, input: { expert: "adams-writing", question: "How does Adam open a cold email?" } }, { tool: LEAVE_DRAFT_TOOL, input: { text: "Hello Ana, a question about your studio.", subject: "A question", to: { name: "Ana", address: "ana@studio.example", organisation: "Studio" } } }, { tool: LEAVE_DRAFT_TOOL, input: { text: "Hello Bo, a question about your agency.", to: { address: "bo@agency.example" } } }, { text: "done" }][Math.min(done, 3)]!;
      } else if (said.includes("Your owner rejected these drafts")) reply = { text: "<learned>Open with the agency's newest project, in the first line.</learned>" };
      else if (said.includes("From your owner's corrections you learned")) reply = { text: "added" };
      else if (said.includes("Now read your job's documents")) reply = { text: "grounded" };
      else if (said.includes("Reply with only the word: ready")) reply = { text: "ready" };
      const usage = { input_tokens: 20000, output_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
      const message = { id: `msg_${bodies.length}`, type: "message", role: "assistant", model: b.model, content: [], stop_reason: null, stop_sequence: null, usage };
      const block = "tool" in reply ? { type: "tool_use", id: `toolu_${bodies.length}`, name: reply.tool, input: reply.input } : { type: "text", text: reply.text };
      const stop = "tool" in reply ? "tool_use" : "end_turn";
      if (!b.stream) return void response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ ...message, content: [block], stop_reason: stop }));
      response.writeHead(200, { "content-type": "text/event-stream" });
      const event = (type: string, data: Record<string, unknown>) => response.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
      event("message_start", { message });
      if ("tool" in reply) {
        event("content_block_start", { index: 0, content_block: { type: "tool_use", id: block.id, name: reply.tool, input: {} } });
        event("content_block_delta", { index: 0, delta: { type: "input_json_delta", partial_json: JSON.stringify(reply.input) } });
      } else {
        event("content_block_start", { index: 0, content_block: { type: "text", text: "" } });
        event("content_block_delta", { index: 0, delta: { type: "text_delta", text: reply.text } });
      }
      event("content_block_stop", { index: 0 });
      event("message_delta", { delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: 10 } });
      event("message_stop", {});
      response.end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  closing.push(() => new Promise((resolve) => (server.closeAllConnections(), server.close(resolve))));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, bodies, asking: (words: string) => bodies.filter((b) => all(b).includes(words)) };
}

test("an employee with real Claude Code: grounded, its run calls Isoplan's tools through the runner's own endpoint and leaves two drafts, its requests' tools the same as its grounding's and only the job's and Isoplan's, and a correction becomes what it learned and reaches its next run", async () => {
  const binary = await findClaude(process.env, process.platform, os.homedir());
  if (!binary) throw new Error("this test runs real Claude Code, and none was found on this computer");
  const api = await messagesApi();
  const root = tempRoot();
  const home = path.join(root, "home");
  fs.mkdirSync(home, { recursive: true });
  const inherited = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(CLAUDE|ANTHROPIC_)/i.test(key)));
  const answered: string[] = [];
  const s = await setUpEmployee({
    root,
    job: { tools: ["Read", "Grep", "Glob", "WebSearch"] },
    claude: { binary, env: (claudeDir) => ({ ...inherited, CLAUDE_CONFIG_DIR: claudeDir, USERPROFILE: home, HOME: home, CLAUDE_CODE_PLUGIN_CACHE_DIR: "", ANTHROPIC_BASE_URL: api.url, ANTHROPIC_API_KEY: "isoplan-test-key", CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1" }) },
    // The expert's answer is held a moment: the run waits for it, as a blocking ask_expert does.
    ask: async (expert, question) => (await new Promise((r) => setTimeout(r, 3000)), answered.push(question), { text: `Expert ${expert} answered: open with their newest project.` }),
  });
  closing.push(s.close);
  await until(async () => s.e().trunk?.state().state === "ready", 240000, "grounded");

  // A run: its requests call Isoplan's tools, answered by the runner itself.
  s.clock.t = Date.parse("2026-11-26T09:01:00Z");
  await until(async () => (await s.e().runs!.tick(), s.e().runs!.listing().ended.length === 1 && !s.e().runs!.running()), 240000, "the run ended");
  expect(s.e().runs!.listing().ended[0]).toMatchObject({ outcome: "ran", drafts: 2, heldBySecretCheck: 0 });
  expect(answered).toEqual(["How does Adam open a cold email?"]);
  const drafts = s.e().drafts.toSend().flatMap((x) => x.drafts);
  expect(drafts.map((d) => d.to?.address)).toEqual(["ana@studio.example", "bo@agency.example"]);
  const results = api.asking("Today's run").flatMap((b) => toolResults(b).map((r) => JSON.stringify(r.content)));
  expect(results.some((r) => r.includes("Left draft 2 of 10."))).toBe(true);

  // The same tools for the grounding and the run, byte for byte; none but the job's and Isoplan's two; WebSearch offered.
  const toolsOf = (b: Body) => JSON.stringify(b.tools ?? []);
  const grounding = api.asking("Reply with only the word: ready")[0]!;
  const run = api.asking("Today's run")[0]!;
  expect(toolsOf(run)).toBe(toolsOf(grounding));
  const names = (run.tools ?? []).map((t) => t.name).sort();
  expect(names).toEqual(expect.arrayContaining([ASK_EXPERT_TOOL, LEAVE_DRAFT_TOOL, "WebSearch", "Read"]));
  // DeferredToolPlaceholder is Claude Code's own stand-in for tools it lists later, not a tool of its own.
  for (const n of names) expect(["Read", "Grep", "Glob", "WebSearch", ASK_EXPERT_TOOL, LEAVE_DRAFT_TOOL, "DeferredToolPlaceholder"]).toContain(n);

  // A rejection with a correction: learned in one fork, kept to be sent with no files, added to its trunk; its next run carries the recipient.
  const ana = drafts[0]!;
  await s.decided("rejected", ana.id, { correction: "Name their newest project first." });
  await s.employees.tick();
  await until(() => api.asking("From your owner's corrections you learned").length > 0, 240000, "its addition");
  const waiting = JSON.parse(fs.readFileSync(path.join(s.dir, "what-was-learned-waiting-to-be-sent.json"), "utf8")).things as { text: string; files: unknown[] }[];
  expect(waiting.map((t) => [t.text, t.files])).toEqual([["Open with the agency's newest project, in the first line.", []]]);
  s.clock.t = Date.parse("2026-11-27T09:01:00Z");
  await until(async () => (await s.e().runs!.tick(), s.e().runs!.listing().ended.length === 2 && !s.e().runs!.running()), 240000, "the next run ended");
  const next = api.asking("Today's run, Friday")[0] ?? api.asking("Today's run").at(-1)!;
  expect(all(next)).toContain("ana@studio.example>: Name their newest project first.");
});
