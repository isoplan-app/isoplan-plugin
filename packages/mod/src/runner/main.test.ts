// The runner's worker (dist/runner.js --worker, rebuilt with every change), started as its
// supervisor starts it, in a throwaway config folder, with two stand-in offices in config.json and
// a stand-in claude recorded as the machine's binary: the fork cap, maxForks, is one for the
// machine, so a fork one office asks for waits while another office's runs.

import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { PROTOCOL_VERSION } from "@isoplan/protocol";
import { afterEach, expect, test, vi } from "vitest";
import { WebSocketServer, type WebSocket } from "ws";
import { modDir, tempRoot } from "../data-layer/fixture.js";

vi.setConfig({ testTimeout: 60000 });

const closing: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const close of closing.splice(0).reverse()) await close();
});

async function until(check: () => boolean, ms = 30000) {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 20));
  }
}

const ACCOUNT = "claude:acc-1";

// A stand-in claude: a fork answers turn 1 at once, then names its question's word (alpha or beta)
// in FAKE_LOG as it starts turn 2, and answers only once <FAKE_DIR>/release-<word> is there.
const FAKE_CLAUDE = `
import fs from "node:fs";
import path from "node:path";
const argv = process.argv.slice(2);
if (argv.includes("--version")) { console.log("2.1.400 (Claude Code)"); process.exit(0); }
if (!argv.includes("--fork-session")) process.exit(0);
const log = (line) => fs.appendFileSync(process.env.FAKE_LOG, line + "\\n");
const out = (x) => process.stdout.write(JSON.stringify(x) + "\\n");
const usage = { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
let turn = 0, buf = "";
process.stdin.setEncoding("utf8").on("data", (piece) => {
  buf += piece;
  let nl;
  while ((nl = buf.indexOf("\\n")) >= 0) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (!line) continue;
    turn++;
    if (turn === 1) { out({ type: "result", subtype: "success", num_turns: 1, result: "ok", usage }); continue; }
    const word = /alpha|beta/.exec(JSON.stringify(JSON.parse(line)))[0];
    log("start " + word);
    const release = path.join(process.env.FAKE_DIR, "release-" + word);
    const wait = setInterval(() => {
      if (!fs.existsSync(release)) return;
      clearInterval(wait);
      log("end " + word);
      out({ type: "result", subtype: "success", num_turns: 1, result: "Answer " + word + ".", usage });
      setTimeout(() => process.exit(0), 50);
    }, 20);
  }
});
`;

/** A stand-in office that takes github.com/team/app; `send` reaches the runner's link once it has said hello. With `notWanted`, it wants no session's project. */
async function office({ notWanted = false } = {}) {
  const received: { type: string; id?: string; kind?: string; answer?: string; reason?: string; detail?: string }[] = [];
  // The sessions whose data-layer links said hello.
  const hellos: string[] = [];
  let runnerLink: WebSocket | null = null;
  const server = http.createServer((request, response) => {
    if (!request.url?.startsWith("/data-layer/repos")) return void response.writeHead(404).end();
    response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ version: "v1", repos: ["github.com/team/app"] }));
  });
  const wss = new WebSocketServer({ server });
  wss.on("connection", (ws) => {
    ws.on("message", (data) => {
      const message = JSON.parse(String(data)) as (typeof received)[number];
      // The runner's link says hello as a runner; the sessions' links say theirs as data layers.
      if (message.type === "runner") runnerLink ??= ws;
      if (ws === runnerLink) received.push(message);
      else if (message.type === "hello") {
        hellos.push((message as { session?: string }).session ?? "");
        if (notWanted) ws.send(JSON.stringify({ type: "error", v: PROTOCOL_VERSION, code: "not-wanted", message: "this project isn't in any office on this server" }));
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  closing.push(() => new Promise((resolve) => (wss.close(), server.closeAllConnections(), server.close(resolve))));
  return {
    url: `ws://127.0.0.1:${(server.address() as AddressInfo).port}/data-layer`,
    linked: () => runnerLink !== null,
    send: (message: unknown) => runnerLink!.send(JSON.stringify(message)),
    received,
    hellos,
  };
}

/** A machine paired with both offices, with session lead-1 in a repo they take, its turn over, and maxForks 1. */
function machine(servers: string[], config: Record<string, unknown> = {}) {
  const root = tempRoot();
  const home = path.join(root, "home");
  const claudeDir = path.join(root, "claude");
  const isoplanDir = path.join(claudeDir, "isoplan");
  const repo = path.join(root, "app");
  fs.mkdirSync(home);
  fs.mkdirSync(repo);
  fs.mkdirSync(isoplanDir, { recursive: true });
  spawnSync("git", ["init", "-q"], { cwd: repo, windowsHide: true });
  spawnSync("git", ["remote", "add", "origin", "https://github.com/team/app.git"], { cwd: repo, windowsHide: true });
  const now = new Date().toISOString();
  const transcript = path.join(claudeDir, "projects", "-app", "lead-1.jsonl");
  fs.mkdirSync(path.dirname(transcript), { recursive: true });
  fs.writeFileSync(
    transcript,
    [
      { type: "user", cwd: repo, sessionId: "lead-1", timestamp: now, message: { role: "user", content: "run the tests" } },
      { type: "assistant", cwd: repo, sessionId: "lead-1", timestamp: now, message: { role: "assistant", content: [{ type: "text", text: "Coverage is 91%." }], stop_reason: "end_turn" } },
    ]
      .map((l) => JSON.stringify(l))
      .join("\n") + "\n",
  );
  fs.writeFileSync(path.join(claudeDir, ".claude.json"), JSON.stringify({ oauthAccount: { accountUuid: "acc-1", displayName: "Adam" } }));
  fs.writeFileSync(path.join(isoplanDir, "config.json"), JSON.stringify({ servers: servers.map((server, i) => ({ label: `office-${i}`, server })), ...config }));
  fs.writeFileSync(path.join(isoplanDir, "runner.json"), JSON.stringify({ maxForks: 1 }));
  const expires = Date.now() + 86400000;
  fs.writeFileSync(path.join(isoplanDir, "pairing.json"), JSON.stringify({ accounts: {}, offices: Object.fromEntries(servers.map((server) => [server, { [ACCOUNT]: { server, credential: "cred", token: "token", tokenExpires: expires } }])) }));
  const fakeDir = path.join(root, "fake");
  fs.mkdirSync(fakeDir);
  const fake = path.join(fakeDir, "claude.js");
  fs.writeFileSync(fake, FAKE_CLAUDE);
  fs.writeFileSync(path.join(isoplanDir, "claude-binary.json"), JSON.stringify({ path: fake }));
  const fakeLog = path.join(fakeDir, "log.txt");
  fs.writeFileSync(fakeLog, "");
  return { claudeDir, home, repo, transcript, fakeDir, fakeLog, ledger: path.join(isoplanDir, "runner", "ledger.json"), log: path.join(isoplanDir, "logs", "runner.log") };
}

function startWorker(m: ReturnType<typeof machine>): ChildProcess {
  const child = spawn(process.execPath, [path.join(modDir, "dist", "runner.js"), "--claude-dir", m.claudeDir, "--worker"], {
    cwd: m.claudeDir,
    env: { ...process.env, CLAUDE_CONFIG_DIR: m.claudeDir, USERPROFILE: m.home, HOME: m.home, CLAUDE_CODE_PLUGIN_CACHE_DIR: "", FAKE_LOG: m.fakeLog, FAKE_DIR: m.fakeDir },
    stdio: ["pipe", "ignore", "pipe"],
    windowsHide: true,
  });
  closing.push(async () => {
    if (child.exitCode !== null) return;
    const exited = new Promise((resolve) => child.on("exit", resolve));
    child.stdin!.end();
    const stopped = await Promise.race([exited.then(() => true), new Promise((r) => setTimeout(() => r(false), 10000))]);
    if (!stopped && child.pid) spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
  });
  return child;
}

const question = (id: string, room: string, word: string) => ({ type: "request", v: PROTOCOL_VERSION, id, kind: "answer-question", session: "claude-code:lead-1", room, from: { id: "claude:bob", name: "Bob" }, question: `What was the coverage, ${word}?` });
const lines = (file: string) => fs.readFileSync(file, "utf8").split("\n").filter(Boolean);
const reserved = (file: string, room: string) => fs.existsSync(file) && fs.readFileSync(file, "utf8").includes(`"${room}"`);

test("runner worker: two offices share one fork cap; with maxForks 1, one office's fork waits while the other's runs, and runs when it ends", async () => {
  const a = await office();
  const b = await office();
  const m = machine([a.url, b.url]);
  startWorker(m);
  await until(() => a.linked() && b.linked()).catch((err) => Promise.reject(new Error(`${err.message}; runner.log:\n${fs.existsSync(m.log) ? fs.readFileSync(m.log, "utf8") : ""}`)));

  a.send(question("q-alpha", "room-a", "alpha"));
  await until(() => lines(m.fakeLog).includes("start alpha"));
  b.send(question("q-beta", "room-b", "beta"));
  // Office B's request has passed its caps and reserved its estimate, so it is at the fork cap.
  await until(() => reserved(m.ledger, "room-b"));
  await new Promise((r) => setTimeout(r, 1000));
  expect(lines(m.fakeLog)).toEqual(["start alpha"]);

  fs.writeFileSync(path.join(m.fakeDir, "release-alpha"), "");
  await until(() => a.received.some((x) => x.type === "reply" && x.id === "q-alpha"));
  await until(() => lines(m.fakeLog).includes("start beta"));
  fs.writeFileSync(path.join(m.fakeDir, "release-beta"), "");
  await until(() => b.received.some((x) => x.type === "reply" && x.id === "q-beta"));
  expect(lines(m.fakeLog)).toEqual(["start alpha", "end alpha", "start beta", "end beta"]);
  expect(a.received.find((x) => x.id === "q-alpha")).toMatchObject({ kind: "answer-question", answer: "Answer alpha." });
  expect(b.received.find((x) => x.id === "q-beta")).toMatchObject({ kind: "answer-question", answer: "Answer beta." });
});

test("runner worker: a session in a folder the plugin is disabled for isn't reported, and is once it is enabled and the session moves", async () => {
  const a = await office();
  const m = machine([a.url], { runnerRetrySeconds: 0 });
  // The data layer install recorded, a marketplace install's, and the plugin off for the session's folder.
  fs.writeFileSync(path.join(m.claudeDir, "isoplan", "wake.json"), JSON.stringify({ dataLayer: path.join(m.claudeDir, "plugins", "cache", "isoplan", "isoplan", "a1b2c3d4e5f6", "dist", "data-layer.js") }));
  const local = path.join(m.repo, ".claude", "settings.local.json");
  fs.mkdirSync(path.dirname(local), { recursive: true });
  fs.writeFileSync(local, JSON.stringify({ enabledPlugins: { "isoplan@isoplan": false } }));
  startWorker(m);
  await until(() => a.linked());
  await new Promise((r) => setTimeout(r, 2500));
  expect(a.hellos).toEqual([]);
  fs.writeFileSync(local, JSON.stringify({ enabledPlugins: { "isoplan@isoplan": true } }));
  fs.appendFileSync(m.transcript, JSON.stringify({ type: "user", cwd: m.repo, sessionId: "lead-1", timestamp: new Date().toISOString(), message: { role: "user", content: "and again" } }) + "\n");
  await until(() => a.hellos.includes("claude-code:lead-1"));
});

test("runner worker: a session held off because no office wants its project is refused as one the machine doesn't report", async () => {
  const a = await office({ notWanted: true });
  const m = machine([a.url], { runnerRetrySeconds: 0 });
  startWorker(m);
  await until(() => a.linked() && a.hellos.includes("claude-code:lead-1"));
  const sessionLog = path.join(m.claudeDir, "isoplan", "logs", "lead-1.log");
  await until(() => fs.existsSync(sessionLog) && fs.readFileSync(sessionLog, "utf8").includes("so it holds off"));
  await new Promise((r) => setTimeout(r, 500));
  a.send(question("q-held", "room-a", "alpha"));
  await until(() => a.received.some((x) => x.id === "q-held"));
  expect(a.received.find((x) => x.id === "q-held")).toMatchObject({ type: "refusal", reason: "unavailable", detail: "this machine doesn't report that session" });
  expect(lines(m.fakeLog)).toEqual([]);
});
