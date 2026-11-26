// Whether a fork can read a trunk safely while the runner adds to it (isoplan-app#366, D18), with
// real Claude Code against a stand-in Messages API (ANTHROPIC_BASE_URL, a dummy key, an empty Claude
// folder). Claude Code's hidden `--resume-session-at <message id>` resumes a session only up to and
// including that entry: a fork resumed at the uuid the runner recorded after its last turn on the
// trunk (`SavedGeneration.last`) reads the trunk as it was then, whatever an addition is writing.
// This guards a flag Claude Code doesn't document. Its help calls it a truncating resume, so a fork
// with it also has to leave the trunk's transcript as it was: byte for byte while nothing else
// writes to it, and with only the addition's own lines added while one runs.

import { spawn as nodeSpawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, expect, test, vi } from "vitest";
import { tempRoot } from "../data-layer/fixture.js";
import { claudeCommand, findClaude } from "./claude-binary.js";
import { forkEnv } from "./claude.js";
import { appendArgs, converse, expertForkArgs, trunkArgs } from "./expert-claude.js";

vi.setConfig({ testTimeout: 300000 });

const closing: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const close of closing.splice(0).reverse()) await close();
});

type Body = { model: string; stream?: boolean; messages: { role: string; content: string | { type: string; text?: string }[] }[] };

const textOf = (content: Body["messages"][number]["content"]) => (typeof content === "string" ? content : content.flatMap((c) => (c.type === "text" && c.text ? [c.text] : [])).join("\n"));
// A request's messages without the cache breakpoint, which Claude Code puts on its last messages.
const plain = (messages: Body["messages"]) => JSON.parse(JSON.stringify(messages, (key, value) => (key === "cache_control" ? undefined : value))) as Body["messages"];
const lastUser = (b: Body) => textOf([...b.messages].reverse().find((m) => m.role === "user")?.content ?? "");

const GROUND_ONE = "This message is from the test: the trunk's first turn. Reply with only the word: ready";
const GROUND_TWO = "This message is from the test: the trunk's second turn. Reply with only the word: grounded";
const ADDITION = "This message is from the test: what forks learned, ADDITION-MARKER. Reply with only the word: added";
const QUESTION = "Question q-1, FORK-QUESTION: what is the answer?";

/** A stand-in Messages API: every request's body, kept; the addition's reply held until `release`. */
async function messagesApi() {
  const bodies: Body[] = [];
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => (release = resolve));
  const server = http.createServer((request, response) => {
    let raw = "";
    request.setEncoding("utf8").on("data", (piece: string) => (raw += piece));
    request.on("end", async () => {
      if (!request.url?.startsWith("/v1/messages")) return void response.writeHead(404).end();
      if (request.url.startsWith("/v1/messages/count_tokens")) return void response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ input_tokens: 1000 }));
      const b = JSON.parse(raw) as Body;
      bodies.push(b);
      const said = lastUser(b);
      const text = said.includes("ADDITION-MARKER") ? "added" : said.includes("FORK-QUESTION") ? "<answer>Forty-two.</answer>" : said.includes("second turn") ? "grounded" : said.includes("first turn") ? "ready" : "ok";
      if (said.includes("ADDITION-MARKER")) await held;
      const usage = { input_tokens: 20000, output_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
      const message = { id: `msg_${bodies.length}`, type: "message", role: "assistant", model: b.model, content: [], stop_reason: null, stop_sequence: null, usage };
      if (!b.stream) return void response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ ...message, content: [{ type: "text", text }], stop_reason: "end_turn" }));
      response.writeHead(200, { "content-type": "text/event-stream" });
      const event = (type: string, data: Record<string, unknown>) => response.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
      event("message_start", { message });
      event("content_block_start", { index: 0, content_block: { type: "text", text: "" } });
      event("content_block_delta", { index: 0, delta: { type: "text_delta", text } });
      event("content_block_stop", { index: 0 });
      event("message_delta", { delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 10 } });
      event("message_stop", {});
      response.end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  closing.push(() => new Promise((resolve) => (server.closeAllConnections(), server.close(resolve))));
  /** The requests whose last user turn says `words`, in order. */
  const asking = (words: string) => bodies.filter((b) => lastUser(b).includes(words));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, bodies, asking, release: () => release() };
}

async function until(check: () => boolean, ms = 120000, what = "") {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error(`timed out${what ? `: ${what}` : ""}`);
    await new Promise((r) => setTimeout(r, 50));
  }
}

test("a fork resumed at the trunk's recorded uuid reads the trunk as it was, while an addition is writing to it, and leaves the trunk's transcript as it was", async () => {
  const binary = await findClaude(process.env, process.platform, os.homedir());
  if (!binary) throw new Error("this test runs real Claude Code, and none was found on this computer");
  const root = tempRoot();
  const claudeDir = path.join(root, "claude");
  const home = path.join(root, "home");
  const read = path.join(root, "read");
  for (const dir of [claudeDir, home, read]) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(read, "CONTEXT.md"), "**Relay**: what carries questions.\n");
  const api = await messagesApi();
  // This session's own Claude Code and Anthropic variables never reach it.
  const inherited = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(CLAUDE|ANTHROPIC_)/i.test(key)));
  const env = { ...forkEnv(inherited), CLAUDE_CONFIG_DIR: claudeDir, USERPROFILE: home, HOME: home, CLAUDE_CODE_PLUGIN_CACHE_DIR: "", ANTHROPIC_BASE_URL: api.url, ANTHROPIC_API_KEY: "isoplan-test-key", CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1", CLAUDE_CODE_DISABLE_BACKGROUND_TASKS: "1", CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1" };
  const children = new Set<ChildProcessWithoutNullStreams>();
  closing.push(async () => children.forEach((c) => c.kill()));
  const run = (args: string[], first: string, rest: string[] = []) => {
    const [cmd, ...pre] = claudeCommand(binary);
    const child = nodeSpawn(cmd!, [...pre, ...args], { cwd: read, env, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    children.add(child);
    child.on("close", () => children.delete(child));
    return converse(child, first, () => rest.shift() ?? null, 120000, { root: read });
  };

  // 1. The trunk, grounded in two turns, and the uuid of its last user or assistant entry, as the runner records it.
  const trunk = randomUUID();
  const grounded = await run(trunkArgs(trunk, "sonnet"), GROUND_ONE, [GROUND_TWO]);
  expect(grounded.failure).toBeUndefined();
  const projects = path.join(claudeDir, "projects");
  const transcript = fs.readdirSync(projects).map((d) => path.join(projects, d, `${trunk}.jsonl`)).find((f) => fs.existsSync(f))!;
  const entries = () => fs.readFileSync(transcript, "utf8").split("\n").flatMap((l) => { try { return [JSON.parse(l) as { type?: string; uuid?: string; message?: { content?: unknown } }]; } catch { return []; } });
  const lastTurn = () => entries().filter((e) => (e.type === "user" || e.type === "assistant") && typeof e.uuid === "string").at(-1)!.uuid!;
  const at = lastTurn();
  const bytes = () => fs.readFileSync(transcript);

  // 2. An addition, its reply held: its user turn is in the transcript, its reply isn't.
  const adding = run(appendArgs(trunk, "sonnet"), ADDITION);
  await until(() => api.asking("ADDITION-MARKER").length === 1 && fs.readFileSync(transcript, "utf8").includes("ADDITION-MARKER"), 60000, "the addition's turn in the transcript");
  const during = bytes();

  // 3. Meanwhile a fork at the recorded uuid: it starts, it sends the trunk up to there and its question, nothing of the addition, and it answers.
  const fork = await run(expertForkArgs(trunk, "sonnet", at), QUESTION);
  expect(fork.failure).toBeUndefined();
  expect(fork.turns.at(-1)!.text).toBe("<answer>Forty-two.</answer>");
  const forked = api.asking("FORK-QUESTION").at(-1)!;
  const said = JSON.stringify(forked.messages);
  expect(said).not.toContain("ADDITION-MARKER");
  expect(said).toContain("the trunk's first turn");
  expect(said).toContain("the trunk's second turn");
  expect(plain(forked.messages.slice(0, -1))).toEqual([...plain(api.asking("second turn").at(-1)!.messages), { role: "assistant", content: [{ type: "text", text: "grounded" }] }]);
  // The fork left the trunk as it was: only the addition writes to it. The addition goes on writing
  // its own lines meanwhile (its request's, say), each the trunk session's; the fork, a session of its
  // own, wrote none, and nothing before them changed.
  const now = bytes();
  expect(now.subarray(0, during.length).equals(during)).toBe(true);
  const appended = now.subarray(during.length).toString("utf8");
  // Its last line may be half written yet.
  for (const line of appended.slice(0, appended.lastIndexOf("\n") + 1).split("\n").filter(Boolean)) {
    expect(line).not.toContain("FORK-QUESTION");
    expect((JSON.parse(line) as { sessionId?: string }).sessionId).toBe(trunk);
  }

  // 4. The addition ends: its reply is the transcript's last turn, and a fork at the new uuid sends it.
  api.release();
  const added = await adding;
  expect(added.failure).toBeUndefined();
  const last = entries().filter((e) => e.type === "user" || e.type === "assistant").at(-1)!;
  expect(JSON.stringify(last.message)).toContain("added");
  const after = lastTurn();
  expect(after).not.toBe(at);
  expect((await run(expertForkArgs(trunk, "sonnet", after), QUESTION)).failure).toBeUndefined();
  expect(JSON.stringify(api.asking("FORK-QUESTION").at(-1)!.messages)).toContain("ADDITION-MARKER");

  // 6. With no addition running, a fork with the flag and one without send the same messages, so the prompt cache's prefix is the same.
  const before = bytes();
  await run(expertForkArgs(trunk, "sonnet", after), QUESTION);
  const withFlag = api.asking("FORK-QUESTION").at(-1)!;
  await run(expertForkArgs(trunk, "sonnet"), QUESTION);
  const without = api.asking("FORK-QUESTION").at(-1)!;
  expect(withFlag.messages).toEqual(without.messages);
  expect(bytes().equals(before)).toBe(true);

  // 5. Half a JSON line at the transcript's end, as an addition writing it leaves for a moment: a fork at the first uuid still starts and sends what it sent in 3.
  fs.appendFileSync(transcript, '{"type":"user","uuid":"half');
  const half = bytes();
  const again = await run(expertForkArgs(trunk, "sonnet", at), QUESTION);
  expect(again.failure).toBeUndefined();
  expect(api.asking("FORK-QUESTION").at(-1)!.messages).toEqual(forked.messages);
  expect(bytes().equals(half)).toBe(true);
});
