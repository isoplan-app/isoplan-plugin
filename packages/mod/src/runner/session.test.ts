import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { PassThrough } from "node:stream";
import { MAX_DETAIL_LENGTH, MAX_TOOL_NAME_LENGTH, PROTOCOL_VERSION, type DriveMessage, type DrivenMessage, type RunnerHelloMessage } from "@isoplan/protocol";
import { afterEach, expect, test, vi } from "vitest";
import { WebSocketServer, type WebSocket as ServerSocket } from "ws";
import { modDir, tempRoot } from "../data-layer/fixture.js";
import { createLink, type Link, type ServerAsk } from "../data-layer/link.js";
import { alive } from "../wake/lock.js";
import type { Spawn } from "./claude.js";
import { createRegistry, registryPath, type ProcessRecord } from "./registry.js";
import { loadPatterns, scan } from "./scan.js";
import type { RepoFolders } from "./repo-folders.js";
import { createDriver, drivenArgs, menuCloseWaitMs, promptDescription, type DriveOffice, type DriverOptions, type DriveSettings, type StartElsewhere } from "./session.js";

// Each test starts real (fake) claude processes, which is slow on Windows under load.
vi.setConfig({ testTimeout: 30000 });

// A fake AWS key id, split so no key-shaped string sits in the source.
const AWS_KEY = "AKIA" + "ABCDEFGHIJKLMNOP";
const SERVER = "wss://office.example";
const ADA = { id: "claude:ada", name: "Ada" };
const PROJECT = { id: "github.com/ada/app", name: "app" };
const UUIDS = ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222", "33333333-3333-4333-8333-333333333333"];
const SETTINGS: DriveSettings = { drivenIdleMinutes: 30, drivenPerProject: 4, drivenCloseSeconds: 5, drivenStartSeconds: 20, drivenPromptMinutes: 10, repoFoldersCheckMinutes: 5, branchRefreshMinutes: 5 };

// A stand-in for `claude -p --input-format stream-json --output-format stream-json`, shaped as the
// probe in session.ts found it: it logs its argv and folder, then answers each user line with a
// `system` init and one `result`. The words of the instruction pick what else it does. A --resume of
// a session it has no transcript of fails as Claude Code does. Stdin's end ends it, unless
// FAKE_LINGER is set. An instruction with "ask" uses Bash through a permission prompt, as the probe
// found it with --permission-prompts host --permission-prompt-tool stdio, waits for its answer on
// stdin (logged as `answered`), and runs it or not; with "cancel" Claude Code cancels the prompt itself.
// "ask after" raises one only once its turn has ended, and "elicit" a request that isn't a prompt.
// Claude Code's interrupt is answered as the probe in session.ts found it: `success`, then, with a
// "hang" turn running, that turn's end as an error; idle, nothing more.
const FAKE = `
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
const state = process.env.FAKE_STATE;
const log = (x) => fs.appendFileSync(path.join(state, "log.jsonl"), JSON.stringify(x) + "\\n");
const out = (x) => process.stdout.write(JSON.stringify(x) + "\\n");
const args = process.argv.slice(2);
const flag = (n) => (args.includes(n) ? args[args.indexOf(n) + 1] : undefined);
const id = flag("--resume") ?? flag("--session-id");
const transcript = path.join(process.env.CLAUDE_CONFIG_DIR, "projects", "fake", id + ".jsonl");
const missing = flag("--resume") !== undefined && !fs.existsSync(transcript);
log({ argv: args, cwd: process.cwd(), pid: process.pid, grandchild: spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" }).pid });
const finish = (reply) => {
  out({ type: "assistant", parent_tool_use_id: null, message: { content: [{ type: "text", text: reply }] } });
  out({ type: "result", subtype: "success", is_error: false, num_turns: 1, result: reply, session_id: id });
};
const pending = new Map();
let asked = 0;
let hanging = false;
let buf = "";
process.stdin.setEncoding("utf8").on("data", (d) => {
  buf += d;
  let i;
  while ((i = buf.indexOf("\\n")) >= 0) {
    const line = JSON.parse(buf.slice(0, i));
    buf = buf.slice(i + 1);
    if (line.type === "control_request" && line.request.subtype === "interrupt") {
      log({ interrupt: hanging });
      out({ type: "control_response", response: { subtype: "success", request_id: line.request_id, response: { still_queued: [] } } });
      if (hanging) out({ type: "result", subtype: "error_during_execution", is_error: true, num_turns: 2, session_id: id, errors: ["[ede_diagnostic] result_type=user"] });
      hanging = false;
      continue;
    }
    if (line.type === "control_response") {
      log({ answered: line.response });
      const go = pending.get(line.response.request_id);
      pending.delete(line.response.request_id);
      go?.(line.response.response);
      continue;
    }
    const text = line.message.content[0].text;
    log({ turn: text });
    if (missing) {
      process.stderr.write("No conversation found with session ID: " + id + "\\n");
      out({ type: "result", subtype: "error_during_execution", is_error: true, num_turns: 0, session_id: id, errors: ["No conversation found with session ID: " + id] });
      setTimeout(() => process.exit(1), 20);
      continue;
    }
    fs.mkdirSync(path.dirname(transcript), { recursive: true });
    fs.writeFileSync(transcript, "");
    if (text.includes("silent")) continue;
    out({ type: "system", subtype: "init", session_id: id });
    if (text.startsWith("/")) {
      // One of Claude Code's own commands: no turn of the model's, a result with num_turns 0 and local_command.
      const said = "Total cost: $0.00 (" + text.slice(1) + ")";
      out({ type: "assistant", parent_tool_use_id: null, local_command_source: text.slice(1), message: { model: "<synthetic>", content: [{ type: "text", text: said }] } });
      out({ type: "result", subtype: "success", is_error: false, num_turns: 0, result: said, local_command: text.slice(1), session_id: id });
      continue;
    }
    if (text.includes("hang")) { hanging = true; continue; }
    if (text.includes("crash")) { setTimeout(() => process.exit(3), 20); continue; }
    const secretName = "mcp__keys-" + process.env.FAKE_KEY;
    if (text.includes("elicit")) {
      // A request that isn't a permission prompt, as the turn's first output; the turn ends once it is answered.
      const rid = "req-" + ++asked;
      out({ type: "control_request", request_id: rid, request: { subtype: "elicitation", mcp_server_name: "forms", message: "Pick one" } });
      pending.set(rid, () => finish("Went on"));
      continue;
    }
    if (text.includes("ask after")) {
      // The turn ends first; then a prompt comes outside any turn, and a line of other output while it waits.
      finish("Done: " + text);
      const rid = "req-" + ++asked;
      const input = { command: "echo hi > probe.txt", description: "Write hi into probe.txt" };
      out({ type: "control_request", request_id: rid, request: { subtype: "can_use_tool", tool_name: "Bash", display_name: "Bash", input, description: input.description, tool_use_id: "t" + rid } });
      out({ type: "system", subtype: "status", session_id: id });
      log({ waiting: rid });
      pending.set(rid, () => {});
      continue;
    }
    if (text.includes("ask")) {
      const rid = "req-" + ++asked;
      const name = text.includes("named") ? secretName : "Bash";
      const input = { command: text.includes("leak") ? "echo " + process.env.FAKE_KEY + " > key.txt" : "echo hi > probe.txt", description: "Write hi into probe.txt" };
      out({ type: "assistant", parent_tool_use_id: null, message: { content: [{ type: "tool_use", id: "t" + rid, name, input }] } });
      out({ type: "control_request", request_id: rid, request: { subtype: "can_use_tool", tool_name: name, display_name: name, input, description: input.description, tool_use_id: "t" + rid } });
      pending.set(rid, (r) => {
        out({ type: "user", parent_tool_use_id: null, message: { content: [{ type: "tool_result", tool_use_id: "t" + rid, content: r.behavior === "allow" ? "ran" : r.message, is_error: r.behavior !== "allow" }] } });
        finish(r.behavior === "allow" ? "Ran: " + r.updatedInput.command : "Not run: " + r.message);
      });
      if (text.includes("cancel")) setTimeout(() => {
        pending.delete(rid);
        out({ type: "control_cancel_request", request_id: rid });
        finish("Cancelled");
      }, 100);
      continue;
    }
    if (text.includes("tool")) {
      const name = text.includes("long") ? "mcp__" + "x".repeat(300) : text.includes("named") ? secretName : "Bash";
      out({ type: "assistant", parent_tool_use_id: null, message: { content: [{ type: "tool_use", id: "t1", name, input: { command: "echo hi", description: text.includes("leak") ? "Use " + process.env.FAKE_KEY : "Say hi" } }] } });
      out({ type: "user", parent_tool_use_id: null, message: { content: [{ type: "tool_result", tool_use_id: "t1", content: "hi" }] } });
    }
    if (text.includes("deny")) out({ type: "system", subtype: "permission_denied", tool_name: text.includes("named") ? secretName : "Write", tool_use_id: "t2", message: "not granted" });
    out({ type: "result", subtype: "success", is_error: false, num_turns: 0, result: "", session_id: id });
    const reply = text.includes("leak") ? "The key is " + process.env.FAKE_KEY : "Done: " + text;
    out({ type: "assistant", parent_tool_use_id: null, message: { content: [{ type: "text", text: reply }] } });
    out({ type: "result", subtype: "success", is_error: false, num_turns: 1, result: reply, session_id: id });
  }
}).on("end", () => {
  log({ closed: true });
  if (process.env.FAKE_LINGER) setInterval(() => {}, 1000);
  else process.exit(0);
});
`;

// An office of a driver's that lists no folders a new session can start in, and keeps its `folders` out of what `send` gets.
const listsNone = (server: string, send: (m: DrivenMessage) => boolean, folder: DriveOffice["folder"] = async () => null): DriveOffice => ({
  server,
  send: (m) => m.kind === "folders" || send(m),
  folder,
  repoFolders: async () => [],
  home: async () => null,
  branchFolder: async () => ({ error: "none" }),
});

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const c of cleanups.splice(0)) c();
});

type Kind = DrivenMessage["kind"];
type Of<K extends Kind> = Extract<DrivenMessage, { kind: K }>;

// `policy`: the drive-policy the office's server sends first on the connection, as a server that
// drives sessions does; null for none yet. What it sends with it (holding) isn't kept in `sent`.
async function setUp({ settings = {}, linger = false, records = [] as ProcessRecord[], spawn, policy: first = [] as string[] | null, setup, elsewhere, namer }: { settings?: Partial<DriveSettings>; linger?: boolean; records?: ProcessRecord[]; spawn?: Spawn; policy?: string[] | null; setup?: DriverOptions["setup"]; elsewhere?: DriverOptions["elsewhere"]; namer?: DriverOptions["namer"] } = {}) {
  const root = tempRoot();
  const claudeDir = path.join(root, ".claude");
  const state = path.join(root, "state");
  fs.mkdirSync(state, { recursive: true });
  const bin = path.join(root, "fake-claude.js");
  fs.writeFileSync(bin, FAKE);
  const folder = path.join(root, "app");
  fs.mkdirSync(folder);
  const file = registryPath(claudeDir);
  if (records.length) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ version: 1, processes: records }));
  }
  const logs: string[] = [];
  const log = (t: string) => void logs.push(t);
  const registry = createRegistry({ file, log });
  await registry.restore();
  const patterns = await loadPatterns(path.join(modDir, "secret-patterns.json"), path.join(root, "none.json"), log);
  const sent: DrivenMessage[] = [];
  // The `folders` messages, kept out of `sent`, and every message in the order it went.
  const folders: Of<"folders">[] = [];
  const all: DrivenMessage[] = [];
  // What the office's repoFolders lists, and the folders its home says are no longer in their repo;
  // how long each listing takes, and when each began and ended.
  // The folder each branch opens in, by "<folder> <branch>", or why there is none; and each asked for.
  const listing = { repos: [] as RepoFolders[], gone: new Set<string>(), ms: 0, calls: [] as [number, number][], branchFolders: new Map<string, string | { error: string }>(), branchAsked: [] as string[] };
  // What the driver sent while the office's link was down, which the link drops.
  const dropped: DrivenMessage[] = [];
  const link = { up: true };
  const ids = [...UUIDS];
  const current = { ...SETTINGS, ...settings };
  // The sessions whose reporting was ended as they were removed.
  const removed: string[] = [];
  const driver = createDriver({
    claudeDir,
    account: { id: ADA.id },
    offices: [
      {
        server: SERVER,
        send: (m) => (link.up ? (all.push(m), m.kind === "folders" ? folders.push(m) : sent.push(m), true) : (dropped.push(m), false)),
        folder: async (sessions) => (sessions.includes("claude-code:room-1") ? folder : null),
        repoFolders: async () => {
          const began = Date.now();
          if (listing.ms) await new Promise((r) => setTimeout(r, listing.ms));
          listing.calls.push([began, Date.now()]);
          return listing.repos;
        },
        home: async (f) => (listing.gone.has(f) ? null : (listing.repos.find((r) => r.folders.includes(f))?.project ?? null)),
        branchFolder: async (f, branch) => (listing.branchAsked.push(`${f} ${branch}`), listing.branchFolders.get(`${f} ${branch}`) ?? { error: "no worktree" }),
      },
    ],
    registry,
    binary: async () => bin,
    settings: async () => current,
    scan: async (text) => scan(text, patterns),
    log,
    projectOf: async () => PROJECT.id,
    env: { ...process.env, CLAUDE_CONFIG_DIR: claudeDir, FAKE_STATE: state, FAKE_KEY: AWS_KEY, ...(linger ? { FAKE_LINGER: "1" } : {}) },
    newId: () => ids.shift()!,
    ...(spawn ? { spawn } : {}),
    ...(setup ? { setup } : {}),
    ...(elsewhere ? { elsewhere } : {}),
    ...(namer ? { namer } : {}),
    removed: async (session) => void removed.push(session),
  });
  const fakeLog = () => (fs.existsSync(path.join(state, "log.jsonl")) ? fs.readFileSync(path.join(state, "log.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l)) : []);
  // Every process the fake started ends with the test.
  cleanups.push(() => {
    driver.close();
    for (const l of fakeLog()) for (const pid of [l.pid, l.grandchild]) if (pid && alive(pid)) process.kill(pid);
  });
  const drive = (m: Record<string, unknown>) => driver.take(SERVER, { type: "drive", v: PROTOCOL_VERSION, by: ADA, ...m } as DriveMessage);
  const policy = (bypassAllowed: string[]) => driver.take(SERVER, { type: "drive-policy", v: PROTOCOL_VERSION, bypassAllowed });
  const until = async (check: () => boolean, ms = 15000) => {
    const end = Date.now() + ms;
    while (!check()) {
      if (Date.now() > end) throw new Error(`timed out; sent: ${JSON.stringify(sent.map((m) => m.kind))}`);
      await new Promise((r) => setTimeout(r, 10));
    }
    await driver.settled();
  };
  const of = <K extends Kind>(kind: K) => sent.filter((m): m is Of<K> => m.kind === kind);
  const saved = () => JSON.parse(fs.readFileSync(file, "utf8")) as { version: number; runner: number; processes: ProcessRecord[] };
  driver.linked(SERVER);
  if (first) policy(first);
  sent.splice(0);
  return { root, claudeDir, state, bin, folder, file, driver, registry, sent, folders, all, listing, dropped, link, logs, current, removed, drive, policy, until, of, fakeLog, saved };
}

const start = (id: string, extra: Record<string, unknown> = {}) => ({ id, kind: "start", room: "room-1", project: PROJECT, roomSessions: ["claude-code:gone", "claude-code:room-1"], permissions: "auto", ...extra });
const S1 = `claude-code:${UUIDS[0]}`;

test("folders: with the connection's first drive-policy they go right after holding; a check sends them again only when they changed; a new connection gets them again", async () => {
  const t = await setUp({ settings: { repoFoldersCheckMinutes: 0.002 }, policy: null });
  t.listing.repos = [{ project: PROJECT.id, folders: [t.folder] }];
  t.policy([]);
  await t.until(() => t.folders.length === 1);
  expect(t.all.map((m) => m.kind)).toEqual(["holding", "folders"]);
  expect(t.folders[0]).toEqual({ type: "driven", v: 1, kind: "folders", repos: [{ project: PROJECT.id, folders: [t.folder] }] });
  // Unchanged across several checks: nothing more goes.
  await new Promise((r) => setTimeout(r, 500));
  expect(t.folders).toHaveLength(1);
  t.listing.repos = [];
  await t.until(() => t.folders.length === 2);
  expect(t.folders[1]!.repos).toEqual([]);
  // A later drive-policy on the same connection sends nothing; a new connection's first one does.
  t.policy([PROJECT.id]);
  await t.driver.settled();
  expect(t.folders).toHaveLength(2);
  t.driver.linked(SERVER);
  t.policy([]);
  await t.until(() => t.folders.length === 3);
});

test("folders: a check every branchRefreshMinutes, when that is sooner, sends them on its own when the branches changed", async () => {
  const t = await setUp({ settings: { branchRefreshMinutes: 0.002 }, policy: null });
  t.listing.repos = [{ project: PROJECT.id, folders: [t.folder], branches: ["main"] }];
  t.policy([]);
  await t.until(() => t.folders.length === 1);
  t.listing.repos = [{ project: PROJECT.id, folders: [t.folder], branches: ["main", "feat/dark"] }];
  await t.until(() => t.folders.length === 2);
  expect(t.folders[1]!.repos).toEqual([{ project: PROJECT.id, folders: [t.folder], branches: ["main", "feat/dark"] }]);
});

test("start on a branch: a listed one opens in the folder the office gives for it; one not listed is no-folder, and one with no folder for it unavailable, with nothing started", async () => {
  const t = await setUp({ policy: null });
  const worktree = path.join(t.root, "app-branch-feat-dark");
  fs.mkdirSync(worktree);
  t.listing.repos = [{ project: PROJECT.id, folders: [t.folder], branches: ["main", "feat/dark", "feat/broken"] }];
  t.listing.branchFolders.set(`${t.folder} feat/dark`, worktree);
  t.listing.branchFolders.set(`${t.folder} feat/broken`, { error: "git worktree add failed" });
  t.policy([]);
  await t.until(() => t.folders.length === 1);
  t.drive({ id: "d1", kind: "start", folder: t.folder, branch: "feat/dark", project: PROJECT, permissions: "auto", instruction: "first" });
  await t.until(() => t.of("turn-ended").length === 1);
  expect(fs.realpathSync(t.fakeLog()[0].cwd)).toBe(fs.realpathSync(worktree));
  expect(t.registry.list()[0]!.folder).toBe(worktree);
  t.drive({ id: "d2", kind: "start", folder: t.folder, branch: "feat/gone", project: PROJECT, permissions: "auto" });
  t.drive({ id: "d3", kind: "start", folder: t.folder, branch: "feat/broken", project: PROJECT, permissions: "auto" });
  await t.until(() => t.of("refused").length === 2);
  expect(t.of("refused").map((m) => [m.id, m.reason]).sort()).toEqual([
    ["d2", "no-folder"],
    ["d3", "unavailable"],
  ]);
  expect(t.of("refused").find((m) => m.id === "d2")!.detail).toContain("isn't one this computer offers");
  expect(t.listing.branchAsked).toEqual([`${t.folder} feat/dark`, `${t.folder} feat/broken`]);
  expect(t.logs.some((l) => l.includes("git worktree add failed"))).toBe(true);
  expect(t.fakeLog().filter((l) => l.argv)).toHaveLength(1);
});

test("start elsewhere: in a listed folder, on a listed branch, it opens where asked with its instruction and is answered opened, in a room of its own, held nowhere here and whatever permissions it asked for; a branch not listed opens nothing", async () => {
  const asked: StartElsewhere[] = [];
  const t = await setUp({ policy: null, elsewhere: async (start, bin) => (asked.push(start), expect(bin).toBe(t.bin), { opened: true, problem: null }) });
  t.listing.repos = [{ project: PROJECT.id, folders: [t.folder], branches: ["main", "feat/docs"] }];
  t.policy([]);
  await t.until(() => t.folders.length === 1);
  t.drive({ id: "d1", kind: "start", folder: t.folder, branch: "feat/docs", project: PROJECT, permissions: "bypassPermissions", instruction: "Write the docs page.", mode: "orca" });
  await t.until(() => t.of("opened").length === 1);
  expect(asked).toEqual([{ id: "d1", mode: "orca", folder: t.folder, branch: "feat/docs", instruction: "Write the docs page.", session: UUIDS[0] }]);
  expect(t.of("opened")).toEqual([{ type: "driven", v: 1, kind: "opened", id: "d1", session: S1, room: `room:${S1}`, mode: "orca" }]);
  // Nothing of the runner's own runs or is held for it, so the floor's cap and the bypass check aren't its.
  expect(t.fakeLog()).toEqual([]);
  expect(t.driver.held()).toBe(0);
  expect(t.registry.list()).toEqual([]);
  expect(t.listing.branchAsked).toEqual([]);
  t.drive({ id: "d2", kind: "start", folder: t.folder, branch: "feat/gone", project: PROJECT, permissions: "auto", instruction: "x", mode: "terminal" });
  t.drive({ id: "d3", kind: "start", folder: path.join(t.root, "elsewhere"), project: PROJECT, permissions: "auto", instruction: "x", mode: "headless" });
  await t.until(() => t.of("refused").length === 2);
  expect(t.of("refused").map((m) => [m.id, m.reason]).sort()).toEqual([
    ["d2", "no-folder"],
    ["d3", "no-folder"],
  ]);
  expect(asked).toHaveLength(1);
});

test("start elsewhere: one that didn't open is refused unavailable with why, one that opened with something left to do says it, and either through the secret scan; a runner that can't is unavailable", async () => {
  const answers = [
    { opened: false, problem: "Orca wasn't found on sam-laptop, so nothing was started." },
    { opened: true, problem: `The Claude app didn't open on the session: ${"x".repeat(2000)}` },
    { opened: false, problem: `git said ${AWS_KEY}` },
  ];
  const t = await setUp({ policy: null, elsewhere: async () => answers.shift()! });
  t.listing.repos = [{ project: PROJECT.id, folders: [t.folder] }];
  t.policy([]);
  await t.until(() => t.folders.length === 1);
  const answered = () => t.sent.filter((m) => m.kind === "opened" || m.kind === "refused");
  const elsewhere = (id: string, mode: string) => t.drive({ id, kind: "start", folder: t.folder, project: PROJECT, permissions: "auto", instruction: "Write the docs page.", mode });
  elsewhere("d1", "orca");
  await t.until(() => answered().length === 1);
  elsewhere("d2", "desktop");
  await t.until(() => answered().length === 2);
  elsewhere("d3", "terminal");
  await t.until(() => answered().length === 3);
  expect(answered()).toEqual([
    { type: "driven", v: 1, kind: "refused", id: "d1", reason: "unavailable", detail: "Orca wasn't found on sam-laptop, so nothing was started." },
    { type: "driven", v: 1, kind: "opened", id: "d2", session: `claude-code:${UUIDS[1]}`, room: `room:claude-code:${UUIDS[1]}`, mode: "desktop", note: expect.stringMatching(/^The Claude app didn't open on the session: x+/) },
    { type: "driven", v: 1, kind: "refused", id: "d3", reason: "unavailable", detail: expect.stringContaining("held back on this computer") },
  ]);
  expect(JSON.stringify(t.sent)).not.toContain(AWS_KEY);
  // Cut to the protocol's limit, so the server takes it.
  expect(t.of("opened")[0]!.note!.length).toBeLessThanOrEqual(MAX_DETAIL_LENGTH);
  // Someone other than the runner's own person opens nothing.
  t.driver.take(SERVER, { type: "drive", v: PROTOCOL_VERSION, by: { id: "github:999", name: "Eve" }, id: "d4", kind: "start", folder: t.folder, project: PROJECT, permissions: "auto", instruction: "x", mode: "headless" } as DriveMessage);
  await t.until(() => answered().length === 4);
  expect(answered()[3]).toMatchObject({ id: "d4", reason: "not-owner" });
  expect(answers).toHaveLength(0);

  const old = await setUp({ policy: null });
  old.listing.repos = [{ project: PROJECT.id, folders: [old.folder] }];
  old.policy([]);
  await old.until(() => old.folders.length === 1);
  old.drive({ id: "d5", kind: "start", folder: old.folder, project: PROJECT, permissions: "auto", instruction: "x", mode: "headless" });
  await old.until(() => old.of("refused").length === 1);
  expect(old.of("refused")[0]).toMatchObject({ kind: "refused", id: "d5", reason: "unavailable" });
  expect(old.fakeLog()).toEqual([]);
});

test("folders: a listing slower than the check waits for the next check, so checks never pile up", async () => {
  const t = await setUp({ settings: { repoFoldersCheckMinutes: 0.002 }, policy: null });
  t.listing.ms = 200;
  t.policy([]);
  await t.until(() => t.listing.calls.length >= 5);
  // The first check may wait on the drive-policy's own listing; each one after begins a whole check (120 ms) after the one before ended.
  for (let i = 2; i < t.listing.calls.length; i++) expect(t.listing.calls[i]![0] - t.listing.calls[i - 1]![1]).toBeGreaterThanOrEqual(100);
});

test("start in a folder: a fresh session in a folder the office was told of, in a room of its own with no room sessions; one it wasn't told of, or no longer in the repo, is no-folder", async () => {
  const t = await setUp({ policy: null });
  const other = path.join(t.root, "other");
  fs.mkdirSync(other);
  t.listing.repos = [{ project: PROJECT.id, folders: [t.folder, other] }];
  t.policy([]);
  await t.until(() => t.folders.length === 1);
  t.drive({ id: "d1", kind: "start", folder: t.folder, project: PROJECT, permissions: "auto", instruction: "first" });
  await t.until(() => t.of("turn-ended").length === 1);
  expect([...t.of("started"), ...t.of("held")]).toEqual([
    { type: "driven", v: 1, kind: "started", id: "d1", session: S1, room: `room:${S1}`, permissions: "auto" },
    { type: "driven", v: 1, kind: "held", session: S1, room: `room:${S1}`, why: "started", permissions: "auto" },
  ]);
  const [first] = t.fakeLog();
  expect(first.argv).toEqual(drivenArgs({ uuid: UUIDS[0]!, resume: false, permissions: "auto" }));
  expect(fs.realpathSync(first.cwd)).toBe(fs.realpathSync(t.folder));
  expect(t.registry.list()[0]!.driven).toMatchObject({ room: `room:${S1}`, project: PROJECT.id });
  // Not listed; listed for another repo; listed, but no longer in the repo.
  t.listing.gone.add(other);
  t.drive({ id: "d2", kind: "start", folder: path.join(t.root, "elsewhere"), project: PROJECT, permissions: "auto" });
  t.drive({ id: "d3", kind: "start", folder: t.folder, project: { id: "github.com/ada/other", name: "other" }, permissions: "auto" });
  t.drive({ id: "d4", kind: "start", folder: other, project: PROJECT, permissions: "auto" });
  await t.until(() => t.of("refused").length === 3);
  expect(t.of("refused").map((m) => [m.id, m.reason]).sort()).toEqual([
    ["d2", "no-folder"],
    ["d3", "no-folder"],
    ["d4", "no-folder"],
  ]);
  for (const m of t.of("refused")) expect(m.detail).toContain("isn't one this computer offers for this repo");
  expect(t.fakeLog().filter((l) => l.argv)).toHaveLength(1);
  // The server's spelling of a listed folder opens it, but the session runs in and records the folder as listed.
  t.drive({ id: "d5", kind: "start", folder: `${t.folder}${path.sep}`, project: PROJECT, permissions: "auto", instruction: "second" });
  await t.until(() => t.of("turn-ended").length === 2);
  const session = `claude-code:${UUIDS[1]}`;
  expect(t.registry.list().find((r) => r.session === session)!.folder).toBe(t.folder);
});

test("start: a new session in the folder the room's session ran in, its turn's tool, reply and end going out in order, and the registry recording its process", async () => {
  const t = await setUp();
  t.drive(start("d1", { instruction: "use a tool" }));
  await t.until(() => t.of("turn-ended").length === 1);
  expect(t.sent).toEqual([
    { type: "driven", v: 1, kind: "started", id: "d1", session: S1, room: "room-1", permissions: "auto" },
    { type: "driven", v: 1, kind: "held", session: S1, room: "room-1", why: "started", permissions: "auto" },
    { type: "driven", v: 1, kind: "turn-started", session: S1, turn: "d1" },
    { type: "driven", v: 1, kind: "tool", session: S1, turn: "d1", tool: "Bash", summary: "Say hi" },
    { type: "driven", v: 1, kind: "reply", session: S1, turn: "d1", text: "Done: use a tool" },
    { type: "driven", v: 1, kind: "turn-ended", session: S1, turn: "d1", outcome: "done" },
  ]);
  const [first] = t.fakeLog();
  expect(first.argv).toEqual(drivenArgs({ uuid: UUIDS[0]!, resume: false, permissions: "auto" }));
  expect(first.argv).toEqual(["-p", "--session-id", UUIDS[0], "--input-format", "stream-json", "--output-format", "stream-json", "--verbose", "--permission-mode", "auto", "--permission-prompts", "host", "--permission-prompt-tool", "stdio"]);
  expect(fs.realpathSync(first.cwd)).toBe(fs.realpathSync(t.folder));
  await t.registry.flushed();
  const saved = t.saved();
  expect(saved).toMatchObject({ version: 1, runner: process.pid });
  expect(saved.processes).toEqual([
    {
      kind: "driven",
      pid: first.pid,
      spawned: expect.any(String),
      session: S1,
      folder: t.folder,
      started: expect.any(String),
      lastActivity: expect.any(String),
      state: "idle",
      driven: { room: "room-1", project: "github.com/ada/app", office: SERVER, owner: ADA.id, permissions: "auto", asked: "auto", transcript: true },
    },
  ]);
});

test("start: no folder of the room's sessions here is no-folder, a person other than the runner's own is not-owner, and an answer finds no prompt", async () => {
  const t = await setUp();
  t.drive(start("d1", { roomSessions: ["claude-code:elsewhere"] }));
  t.driver.take(SERVER, { type: "drive", v: 1, id: "d2", by: { id: "claude:bob", name: "Bob" }, kind: "start", room: "room-1", project: PROJECT, permissions: "auto" });
  await t.until(() => t.sent.length === 2);
  expect(t.of("refused")).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ id: "d1", reason: "no-folder", detail: expect.stringContaining("no folder for this room") }),
      { type: "driven", v: 1, kind: "refused", id: "d2", reason: "not-owner" },
    ]),
  );
  t.drive(start("d3"));
  await t.until(() => t.of("held").length === 1);
  t.drive({ id: "d4", kind: "answer", session: S1, prompt: "p1", answer: "allow" });
  t.drive({ id: "d5", kind: "instruct", session: "claude-code:unknown", text: "hi" });
  t.driver.take(SERVER, { type: "drive", v: 1, id: "d6", by: { id: "claude:bob", name: "Bob" }, kind: "stop", session: S1 });
  await t.until(() => t.of("refused").length === 5);
  expect(t.of("refused").slice(2).map((m) => [m.id, m.reason])).toEqual([
    ["d4", "no-prompt"],
    ["d5", "not-found"],
    ["d6", "not-owner"],
  ]);
  // Only d3 started a process.
  await t.until(() => t.fakeLog().some((l) => l.argv));
  expect(t.fakeLog().filter((l) => l.argv)).toHaveLength(1);
});

test("install and sign in Claude Code: the runner's own person's go to its setup, someone else's are not-owner; what the setup says goes once the drive-policy has come", async () => {
  const asked: string[] = [];
  const t = await setUp({ setup: (m) => void asked.push(`${m.kind} ${m.id}`), policy: null });
  t.driver.say({ type: "driven", v: 1, kind: "claude", claude: "missing" });
  t.drive({ id: "c1", kind: "install-claude" });
  t.driver.take(SERVER, { type: "drive", v: 1, id: "c2", by: { id: "claude:bob", name: "Bob" }, kind: "sign-in-claude" });
  t.drive({ id: "c3", kind: "sign-in-claude" });
  expect(asked).toEqual(["install-claude c1", "sign-in-claude c3"]);
  t.policy([]);
  await t.driver.settled();
  t.sent.splice(0);
  t.driver.take(SERVER, { type: "drive", v: 1, id: "c4", by: { id: "claude:bob", name: "Bob" }, kind: "install-claude" });
  t.driver.say({ type: "driven", v: 1, kind: "claude", claude: "ready", id: "c1" });
  expect(t.sent).toEqual([
    { type: "driven", v: 1, kind: "refused", id: "c4", reason: "not-owner" },
    { type: "driven", v: 1, kind: "claude", claude: "ready", id: "c1" },
  ]);
});

test("instruct: the next instruction goes to the same process; one while a turn runs is busy; stop ends the process and its tree mid-turn", async () => {
  const t = await setUp();
  t.drive(start("d1", { instruction: "first" }));
  await t.until(() => t.of("turn-ended").length === 1);
  t.drive({ id: "d2", kind: "instruct", session: S1, text: "now hang" });
  await t.until(() => t.fakeLog().some((l) => l.turn === "now hang"));
  t.drive({ id: "d3", kind: "instruct", session: S1, text: "again" });
  await t.until(() => t.of("refused").length === 1);
  expect(t.of("refused")[0]).toMatchObject({ id: "d3", reason: "busy" });
  const [{ pid, grandchild }] = t.fakeLog();
  t.drive({ id: "d4", kind: "stop", session: S1 });
  await t.until(() => t.of("released").length === 1);
  expect(t.sent.slice(-2)).toEqual([
    { type: "driven", v: 1, kind: "turn-ended", session: S1, turn: "d2", outcome: "stopped" },
    { type: "driven", v: 1, kind: "released", session: S1, why: "stopped", id: "d4" },
  ]);
  // One process took both turns.
  expect(t.fakeLog().filter((l) => l.argv)).toHaveLength(1);
  expect(t.fakeLog().filter((l) => l.turn).map((l) => l.turn)).toEqual(["first", "now hang"]);
  for (let i = 0; i < 100 && (alive(pid) || alive(grandchild)); i++) await new Promise((r) => setTimeout(r, 50));
  expect([alive(pid), alive(grandchild)]).toEqual([false, false]);
  await t.registry.flushed();
  expect(t.saved().processes).toMatchObject([{ session: S1, pid: null, spawned: null, state: "closed" }]);
});

test("output: a turn's full output from memory, and the whole session's from its transcript, as plain text", async () => {
  const t = await setUp();
  t.drive(start("d1", { instruction: "use a tool" }));
  await t.until(() => t.of("turn-ended").length === 1);
  t.drive({ id: "o1", kind: "output", session: S1, turn: "d1" });
  await t.until(() => t.of("output").length === 1);
  expect(t.of("output")[0]).toEqual({ type: "driven", v: 1, kind: "output", id: "o1", session: S1, turn: "d1", text: "> use a tool\n[Bash] Say hi\nhi\nDone: use a tool" });
  // The whole session comes from Claude Code's transcript, where it keeps the session for its folder.
  const dir = path.join(t.claudeDir, "projects", t.folder.replace(/[^a-zA-Z0-9]/g, "-"));
  fs.mkdirSync(dir, { recursive: true });
  const lines = [
    { type: "user", message: { role: "user", content: "Earlier, in the terminal" } },
    { type: "assistant", message: { content: [{ type: "text", text: "Sure." }] } },
    { type: "assistant", isSidechain: true, message: { content: [{ type: "text", text: "a subagent's own" }] } },
    { type: "summary", summary: "not a message" },
  ];
  fs.writeFileSync(path.join(dir, `${UUIDS[0]}.jsonl`), lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
  t.drive({ id: "o2", kind: "output", session: S1 });
  t.drive({ id: "o3", kind: "output", session: S1, turn: "never" });
  await t.until(() => t.of("output").length === 2 && t.of("refused").length === 1);
  expect(t.of("output")[1]).toEqual({ type: "driven", v: 1, kind: "output", id: "o2", session: S1, text: "> Earlier, in the terminal\nSure." });
  expect(t.of("refused")[0]).toMatchObject({ id: "o3", reason: "unavailable", detail: expect.stringContaining("no longer has that instruction's output") });
});

test("scan: a reply that may hold a secret is held back with an id, a tool whose summary or name may goes with neither, and only the owner's release sends the reply", async () => {
  const t = await setUp();
  t.drive(start("d1", { instruction: "use a tool and leak" }));
  await t.until(() => t.of("turn-ended").length === 1);
  expect(JSON.stringify(t.sent)).not.toContain(AWS_KEY);
  expect(t.of("tool")).toEqual([{ type: "driven", v: 1, kind: "tool", session: S1, turn: "d1", tool: "tool", withheld: true }]);
  const [reply] = t.of("reply");
  expect(reply).toMatchObject({ turn: "d1", text: expect.stringContaining("Held back on this computer"), withheld: { id: expect.any(String) } });
  t.driver.take(SERVER, { type: "drive", v: 1, id: "r0", by: { id: "claude:bob", name: "Bob" }, kind: "release", session: S1, withheld: reply!.withheld!.id });
  t.drive({ id: "r1", kind: "release", session: S1, withheld: reply!.withheld!.id });
  t.drive({ id: "r2", kind: "release", session: S1, withheld: reply!.withheld!.id });
  await t.until(() => t.of("refused").length === 2 && t.of("output").length === 1);
  expect(t.of("output")).toEqual([{ type: "driven", v: 1, kind: "output", id: "r1", session: S1, turn: "d1", text: `The key is ${AWS_KEY}` }]);
  expect(t.of("refused").map((m) => [m.id, m.reason])).toEqual([
    ["r0", "not-owner"],
    ["r2", "not-found"],
  ]);
  // An output that may hold one is held back the same way.
  t.drive({ id: "o1", kind: "output", session: S1, turn: "d1" });
  await t.until(() => t.of("output").length === 2);
  expect(t.of("output")[1]).toMatchObject({ id: "o1", withheld: { id: expect.any(String) } });
  expect(t.logs.filter((l) => l.startsWith("withheld"))).toHaveLength(2);
  // A tool named with one (an MCP server names its own tools), used, and then not allowed.
  const before = t.sent.length;
  t.drive({ id: "d2", kind: "instruct", session: S1, text: "use a named tool, then deny" });
  await t.until(() => t.of("turn-ended").length === 2);
  expect(JSON.stringify(t.sent.slice(before))).not.toContain(AWS_KEY);
  expect(t.of("tool")[1]).toEqual({ type: "driven", v: 1, kind: "tool", session: S1, turn: "d2", tool: "tool", withheld: true });
  expect(t.of("error")).toEqual([{ type: "driven", v: 1, kind: "error", session: S1, turn: "d2", text: expect.stringContaining("wanted to use a tool, but Claude Code on this computer didn't allow it") }]);
});

test("scan: a whole session's output held back is kept as its release sends it, within the protocol's limit and marked cut when its transcript was", async () => {
  const t = await setUp();
  t.drive(start("d1"));
  await t.until(() => t.of("held").length === 1);
  // A transcript longer than the end read for an output, whose last words hold a secret.
  const dir = path.join(t.claudeDir, "projects", t.folder.replace(/[^a-zA-Z0-9]/g, "-"));
  fs.mkdirSync(dir, { recursive: true });
  const lines = [{ type: "summary", summary: "x".repeat(4.5 * 1024 * 1024) }, { type: "user", message: { role: "user", content: `The key is ${AWS_KEY}` } }];
  fs.writeFileSync(path.join(dir, `${UUIDS[0]}.jsonl`), lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
  t.drive({ id: "o1", kind: "output", session: S1 });
  await t.until(() => t.of("output").length === 1);
  const [held] = t.of("output");
  expect(held).toMatchObject({ id: "o1", withheld: { id: expect.any(String) } });
  t.drive({ id: "r1", kind: "release", session: S1, withheld: held!.withheld!.id });
  await t.until(() => t.of("output").length === 2);
  expect(t.of("output")[1]).toEqual({ type: "driven", v: 1, kind: "output", id: "r1", session: S1, text: `> The key is ${AWS_KEY}`, cut: true });
});

test("a Claude Code command as an instruction: its result, with no turn of the model's, ends the instruction, and the next one runs", async () => {
  const t = await setUp();
  t.drive(start("d1", { instruction: "/cost" }));
  await t.until(() => t.of("turn-ended").length === 1);
  expect(t.sent.slice(2)).toEqual([
    { type: "driven", v: 1, kind: "turn-started", session: S1, turn: "d1" },
    { type: "driven", v: 1, kind: "reply", session: S1, turn: "d1", text: "Total cost: $0.00 (cost)" },
    { type: "driven", v: 1, kind: "turn-ended", session: S1, turn: "d1", outcome: "done" },
  ]);
  t.drive({ id: "d2", kind: "instruct", session: S1, text: "next" });
  await t.until(() => t.of("turn-ended").length === 2);
  expect(t.of("refused")).toEqual([]);
  expect(t.of("reply").map((m) => m.text)).toEqual(["Total cost: $0.00 (cost)", "Done: next"]);
});

test("bounds: a tool name past the protocol's limit is cut to fit, and a tool Claude Code itself turned down is said in plain words", async () => {
  const t = await setUp();
  t.drive(start("d1", { instruction: "use a long tool, then deny" }));
  await t.until(() => t.of("turn-ended").length === 1);
  expect(t.of("tool")[0]!.tool).toHaveLength(MAX_TOOL_NAME_LENGTH);
  expect(t.of("error")).toEqual([
    { type: "driven", v: 1, kind: "error", session: S1, turn: "d1", text: "The agent wanted to use Write, but Claude Code on this computer didn't allow it (its permission rules, or its own safety check), so it wasn't used." },
  ]);
});

test("hand back: stdin closes, the process ends by itself, the command and folder come back, and the session is forgotten here", async () => {
  const t = await setUp();
  t.drive(start("d1", { instruction: "first" }));
  await t.until(() => t.of("turn-ended").length === 1);
  t.drive({ id: "h1", kind: "hand-back", session: S1 });
  await t.until(() => t.of("handed-back").length === 1);
  expect(t.sent.slice(-2)).toEqual([
    { type: "driven", v: 1, kind: "released", session: S1, why: "handed-back", id: "h1" },
    { type: "driven", v: 1, kind: "handed-back", id: "h1", session: S1, command: `claude --resume ${UUIDS[0]}`, folder: t.folder },
  ]);
  expect(t.fakeLog().at(-1)).toEqual({ closed: true });
  await t.registry.flushed();
  expect(t.saved().processes).toEqual([]);
  t.drive({ id: "d2", kind: "instruct", session: S1, text: "more" });
  t.driver.linked(SERVER);
  t.policy([]);
  await t.until(() => t.of("refused").length === 1 && t.of("holding").length === 1);
  expect(t.of("refused")[0]).toMatchObject({ id: "d2", reason: "not-found" });
  expect(t.of("holding")[0]!.sessions).toEqual([]);
});

test("interrupt: mid-turn the reply stops, the turn ends stopped with no error, and the same process takes the next instruction; idle it does nothing; someone else's is not-owner", async () => {
  const t = await setUp();
  t.drive(start("d1", { instruction: "first" }));
  await t.until(() => t.of("turn-ended").length === 1);
  // Idle: nothing goes to Claude Code, and nothing comes back.
  const before = t.sent.length;
  t.drive({ id: "x1", kind: "interrupt", session: S1 });
  await t.driver.settled();
  expect(t.sent.length).toBe(before);
  expect(t.fakeLog().some((l) => "interrupt" in l)).toBe(false);
  t.drive({ id: "d2", kind: "instruct", session: S1, text: "now hang" });
  await t.until(() => t.fakeLog().some((l) => l.turn === "now hang"));
  t.driver.take(SERVER, { type: "drive", v: PROTOCOL_VERSION, by: { id: "claude:sam", name: "Sam" }, kind: "interrupt", id: "x2", session: S1 });
  await t.until(() => t.of("refused").length === 1);
  expect(t.of("refused")[0]).toMatchObject({ id: "x2", reason: "not-owner" });
  t.drive({ id: "x3", kind: "interrupt", session: S1 });
  await t.until(() => t.of("turn-ended").length === 2);
  expect(t.of("turn-ended")[1]).toEqual({ type: "driven", v: 1, kind: "turn-ended", session: S1, turn: "d2", outcome: "stopped" });
  expect(t.of("error")).toEqual([]);
  expect(t.of("released")).toEqual([]);
  t.drive({ id: "d3", kind: "instruct", session: S1, text: "again" });
  await t.until(() => t.of("turn-ended").length === 3);
  expect(t.of("turn-ended")[2]).toMatchObject({ turn: "d3", outcome: "done" });
  expect(t.fakeLog().filter((l) => l.argv)).toHaveLength(1);
  expect(t.fakeLog().filter((l) => "interrupt" in l)).toEqual([{ interrupt: true }]);
});

test("stop with remove: the process and its tree end mid-turn, it is released removed and forgotten, holding goes without it, its reporting ends, and it isn't opened again", async () => {
  const t = await setUp();
  t.drive(start("d1", { instruction: "now hang" }));
  await t.until(() => t.fakeLog().some((l) => l.turn === "now hang"));
  const [{ pid, grandchild }] = t.fakeLog();
  t.drive({ id: "d2", kind: "stop", session: S1, remove: true });
  await t.until(() => t.of("holding").length === 1);
  expect(t.sent.slice(-3)).toEqual([
    { type: "driven", v: 1, kind: "turn-ended", session: S1, turn: "d1", outcome: "stopped" },
    { type: "driven", v: 1, kind: "released", session: S1, why: "removed", id: "d2" },
    { type: "driven", v: 1, kind: "holding", sessions: [] },
  ]);
  expect(t.removed).toEqual([S1]);
  for (let i = 0; i < 100 && (alive(pid) || alive(grandchild)); i++) await new Promise((r) => setTimeout(r, 50));
  expect([alive(pid), alive(grandchild)]).toEqual([false, false]);
  await t.registry.flushed();
  expect(t.saved().processes).toEqual([]);
  t.drive({ id: "d3", kind: "instruct", session: S1, text: "more" });
  await t.until(() => t.of("refused").length === 1);
  expect(t.of("refused")[0]).toMatchObject({ id: "d3", reason: "not-found" });
});

test("closed from this computer: Close session ends the process mid-turn and is released stopped, kept for the next instruction to open again; End and remove is released removed and forgotten", async () => {
  const t = await setUp();
  t.drive(start("d1", { instruction: "now hang" }));
  await t.until(() => t.fakeLog().some((l) => l.turn === "now hang"));
  const [{ pid, grandchild }] = t.fakeLog();
  expect(await t.driver.end(S1)).toBe(true);
  await t.until(() => t.of("released").length === 1);
  expect(t.sent.slice(-2)).toEqual([
    { type: "driven", v: 1, kind: "turn-ended", session: S1, turn: "d1", outcome: "stopped" },
    { type: "driven", v: 1, kind: "released", session: S1, why: "stopped" },
  ]);
  for (let i = 0; i < 100 && (alive(pid) || alive(grandchild)); i++) await new Promise((r) => setTimeout(r, 50));
  expect([alive(pid), alive(grandchild)]).toEqual([false, false]);
  expect(t.removed).toEqual([]);
  await t.registry.flushed();
  expect(t.saved().processes).toMatchObject([{ session: S1, pid: null, state: "closed" }]);
  // Kept: the floor's next instruction opens it again.
  t.drive({ id: "d2", kind: "instruct", session: S1, text: "more" });
  await t.until(() => t.of("turn-ended").length === 2);
  expect(t.of("held").at(-1)).toMatchObject({ why: "reopened" });
  expect(t.fakeLog().filter((l) => l.argv).at(-1).argv).toContain("--resume");
  expect(await t.driver.end(S1, true)).toBe(true);
  await t.until(() => t.of("holding").length === 1);
  expect(t.sent.slice(-2)).toEqual([
    { type: "driven", v: 1, kind: "released", session: S1, why: "removed" },
    { type: "driven", v: 1, kind: "holding", sessions: [] },
  ]);
  expect(t.removed).toEqual([S1]);
  await t.registry.flushed();
  expect(t.saved().processes).toEqual([]);
  // Nothing is left to close, or to instruct.
  expect(await t.driver.end(S1)).toBe(false);
  t.drive({ id: "d3", kind: "instruct", session: S1, text: "more" });
  await t.until(() => t.of("refused").length === 1);
  expect(t.of("refused")[0]).toMatchObject({ id: "d3", reason: "not-found" });
});

test("name: a session started from the floor is named once from its first instruction, after its turn began, and the registry keeps it as named; a name that may hold a secret isn't kept", async () => {
  const asked: { text: string; began: boolean }[] = [];
  let t!: Awaited<ReturnType<typeof setUp>>;
  const names = ["Fix the login page", `Key ${AWS_KEY}`];
  t = await setUp({ namer: { name: async (text) => (asked.push({ text, began: t.registry.list().some((r) => r.state === "working") }), names.shift() ?? null) } });
  t.drive(start("d1", { instruction: "first" }));
  await t.until(() => t.of("turn-ended").length === 1);
  t.drive({ id: "d2", kind: "instruct", session: S1, text: "second" });
  await t.until(() => t.of("turn-ended").length === 2);
  await t.registry.flushed();
  expect(asked).toEqual([{ text: "first", began: true }]);
  expect(t.saved().processes[0]!.driven).toMatchObject({ name: "Fix the login page", named: true });
  // A second session, whose name matches a secret pattern, keeps none.
  t.drive({ id: "d3", kind: "start", folder: undefined, room: "room-1", project: PROJECT, roomSessions: ["claude-code:room-1"], permissions: "auto", instruction: "other" });
  await t.until(() => t.of("turn-ended").length === 3);
  await t.registry.flushed();
  const other = t.saved().processes.find((r) => r.session === `claude-code:${UUIDS[1]}`)!;
  expect(other.driven!.name).toBeUndefined();
  expect(t.logs.some((l) => l.includes("wasn't used: it matches the secret pattern"))).toBe(true);
  expect(JSON.stringify(t.sent)).not.toContain(AWS_KEY);
});

test("closed from the menu: the desktop app waits twice the longer of drivenCloseSeconds and the 10 s a driven session gets to end", () => {
  expect(menuCloseWaitMs(2)).toBe(20000);
  expect(menuCloseWaitMs(30)).toBe(60000);
});

test("hand back: a process that doesn't end within drivenCloseSeconds is ended, its running turn stopped", async () => {
  const t = await setUp({ linger: true, settings: { drivenCloseSeconds: 0.3 } });
  t.drive(start("d1", { instruction: "hang" }));
  await t.until(() => t.fakeLog().some((l) => l.turn === "hang"));
  t.drive({ id: "h1", kind: "hand-back", session: S1 });
  await t.until(() => t.of("handed-back").length === 1);
  expect(t.sent.map((m) => m.kind).slice(-3)).toEqual(["turn-ended", "released", "handed-back"]);
  expect(t.of("turn-ended")[0]).toMatchObject({ outcome: "stopped" });
  expect(t.logs.some((l) => l.includes("didn't end within 0.3 s"))).toBe(true);
  expect(alive(t.fakeLog()[0].pid)).toBe(false);
});

test("stop and hand back: a process that won't close keeps the session held and in the registry, and the request is refused unavailable to try again", async () => {
  // A process that answers nothing and never closes, however it is asked to. It has no pid, so
  // ending it is a no-op here.
  const stuck: Spawn = () => Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), pid: undefined, exitCode: null, signalCode: null, kill: () => true }) as unknown as ChildProcessWithoutNullStreams;
  const t = await setUp({ spawn: stuck });
  t.drive(start("d1"));
  await t.until(() => t.of("held").length === 1);
  // The 10 s a stopped process gets, and drivenCloseSeconds then 10 s for one handed back, pass at once.
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  try {
    t.drive({ id: "s1", kind: "stop", session: S1 });
    t.drive({ id: "h1", kind: "hand-back", session: S1 });
    await vi.advanceTimersByTimeAsync(10000 + SETTINGS.drivenCloseSeconds * 1000 + 10000 + 1000);
  } finally {
    vi.useRealTimers();
  }
  await t.driver.settled();
  expect(t.of("refused")).toEqual([
    { type: "driven", v: 1, kind: "refused", id: "s1", reason: "unavailable", detail: expect.stringContaining("couldn't be closed for this session on this computer") },
    { type: "driven", v: 1, kind: "refused", id: "h1", reason: "unavailable", detail: expect.stringContaining("couldn't be closed for this session on this computer") },
  ]);
  expect([t.of("released"), t.of("handed-back")]).toEqual([[], []]);
  expect(t.driver.held()).toBe(1);
  expect(t.logs.filter((l) => l.includes("so it is still held"))).toHaveLength(2);
  await t.registry.flushed();
  expect(t.saved().processes).toMatchObject([{ session: S1, state: "idle" }]);
  t.driver.linked(SERVER);
  t.policy([]);
  expect(t.of("holding")[0]!.sessions).toEqual([{ session: S1, room: "room-1", held: true, permissions: "auto" }]);
});

test("idle: a process with nothing happening for drivenIdleMinutes is closed; the next instruction opens the session again with --resume", async () => {
  const t = await setUp({ settings: { drivenIdleMinutes: 0.005 } });
  t.drive(start("d1", { instruction: "first" }));
  await t.until(() => t.of("released").length === 1);
  expect(t.of("released")[0]).toEqual({ type: "driven", v: 1, kind: "released", session: S1, why: "idle-closed" });
  expect(t.fakeLog().some((l) => l.closed)).toBe(true);
  t.current.drivenIdleMinutes = 30;
  t.drive({ id: "d2", kind: "instruct", session: S1, text: "second" });
  await t.until(() => t.of("turn-ended").length === 2);
  expect(t.of("held").map((m) => m.why)).toEqual(["started", "reopened"]);
  const opened = t.fakeLog().filter((l) => l.argv);
  expect(opened[1].argv.slice(0, 3)).toEqual(["-p", "--resume", UUIDS[0]]);
  expect(t.of("reply").map((m) => m.text)).toEqual(["Done: first", "Done: second"]);
});

test("cap: a start or a reopen past drivenPerProject held sessions in the project is refused cap-reached, with the limit", async () => {
  const t = await setUp({ settings: { drivenPerProject: 1 } });
  t.drive(start("d1"));
  await t.until(() => t.of("held").length === 1);
  t.drive(start("d2"));
  await t.until(() => t.of("refused").length === 1);
  expect(t.of("refused")[0]).toMatchObject({ id: "d2", reason: "cap-reached", limit: 1, detail: expect.stringContaining("already has 1 sessions") });
  t.drive({ id: "s1", kind: "stop", session: S1 });
  await t.until(() => t.of("released").length === 1);
  t.drive(start("d3"));
  await t.until(() => t.of("held").length === 2);
  t.drive({ id: "d4", kind: "instruct", session: S1, text: "reopen me" });
  await t.until(() => t.of("refused").length === 2);
  expect(t.of("refused")[1]).toMatchObject({ id: "d4", reason: "cap-reached", limit: 1 });
  expect(t.driver.held()).toBe(1);
});

test("cap: a drivenPerProject that isn't a whole number counts as the whole number below it, at least one, so the refusal fits the protocol", async () => {
  const t = await setUp({ settings: { drivenPerProject: 1.5 } });
  t.drive(start("d1"));
  await t.until(() => t.of("held").length === 1);
  t.drive(start("d2"));
  await t.until(() => t.of("refused").length === 1);
  expect(t.of("refused")[0]).toMatchObject({ id: "d2", reason: "cap-reached", limit: 1, detail: expect.stringContaining("already has 1 sessions") });
  expect(t.driver.held()).toBe(1);
});

test("crash: a process that ends by itself mid-turn fails the turn and is released crashed; the next instruction opens it again", async () => {
  const t = await setUp();
  t.drive(start("d1", { instruction: "crash now" }));
  await t.until(() => t.of("released").length === 1);
  expect(t.sent.slice(-3)).toEqual([
    { type: "driven", v: 1, kind: "error", session: S1, turn: "d1", text: expect.stringContaining("stopped running for this session unexpectedly") },
    { type: "driven", v: 1, kind: "turn-ended", session: S1, turn: "d1", outcome: "failed" },
    { type: "driven", v: 1, kind: "released", session: S1, why: "crashed" },
  ]);
  await t.registry.flushed();
  expect(t.saved().processes).toMatchObject([{ session: S1, pid: null, state: "closed" }]);
  t.drive({ id: "d2", kind: "instruct", session: S1, text: "again" });
  await t.until(() => t.of("turn-ended").length === 2);
  expect(t.of("held").map((m) => m.why)).toEqual(["started", "reopened"]);
  // No turn ended before the crash, but Claude Code had saved the conversation: it is resumed.
  expect(t.fakeLog().filter((l) => l.argv)[1].argv.slice(0, 3)).toEqual(["-p", "--resume", UUIDS[0]]);
});

test("timeout: a process that writes nothing within drivenStartSeconds of an instruction is ended as stuck", async () => {
  const t = await setUp({ settings: { drivenStartSeconds: 0.3 } });
  t.drive(start("d1", { instruction: "stay silent" }));
  await t.until(() => t.of("released").length === 1);
  expect(t.of("error")[0]).toMatchObject({ turn: "d1", text: expect.stringContaining("didn't start on the instruction within 0.3 seconds") });
  expect(t.of("turn-ended")[0]).toMatchObject({ outcome: "failed" });
  expect(t.of("released")[0]).toMatchObject({ why: "crashed" });
});

test("restart: a recorded process still Isoplan's is ended and its session opened again with --resume as restored; one that can't be shown to be Isoplan's is left running", async () => {
  // Stand-ins for what an earlier run left: processes whose command lines name their session.
  const left = (uuid: string) => {
    const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)", "--", "--resume", uuid], { stdio: "ignore", windowsHide: true, detached: process.platform !== "win32" });
    cleanups.push(() => child.pid && alive(child.pid) && process.kill(child.pid));
    return child.pid!;
  };
  const at = new Date().toISOString();
  const long = new Date(Date.now() - 3600000).toISOString();
  const driven = (uuid: string, pid: number | null, spawned: string | null, extra: Partial<ProcessRecord["driven"]> = {}): ProcessRecord => ({
    kind: "driven",
    pid,
    spawned,
    session: `claude-code:${uuid}`,
    folder: "",
    started: long,
    lastActivity: at,
    state: "working",
    driven: { room: "room-1", project: PROJECT.id, office: SERVER, owner: ADA.id, permissions: "auto", transcript: true, ...extra },
  });
  const ours = left(UUIDS[1]!);
  const reused = left(UUIDS[2]!);
  const fork = left("44444444-4444-4444-8444-444444444444");
  await new Promise((r) => setTimeout(r, 300));
  const t = await setUp({
    records: [
      driven(UUIDS[1]!, ours, at),
      // Live, but started an hour before the record says: another process has that pid now.
      driven(UUIDS[2]!, reused, long, { owner: "claude:someone-else" }),
      { kind: "fork", pid: fork, spawned: at, session: "claude-code:44444444-4444-4444-8444-444444444444", folder: "", started: at, lastActivity: at, state: "working" },
    ],
  });
  for (let i = 0; i < 100 && (alive(ours) || alive(fork)); i++) await new Promise((r) => setTimeout(r, 50));
  expect([alive(ours), alive(reused), alive(fork)]).toEqual([false, true, false]);
  expect(t.logs.some((l) => l.includes(`left process ${reused} running`))).toBe(true);
  expect(t.saved().processes.map((r) => [r.kind, r.session, r.pid])).toEqual([
    ["driven", `claude-code:${UUIDS[1]}`, null],
    ["driven", `claude-code:${UUIDS[2]}`, null],
  ]);
  t.driver.linked(SERVER);
  t.policy([]);
  expect(t.of("holding")[0]!.sessions).toEqual([
    { session: `claude-code:${UUIDS[1]}`, room: "room-1", held: false, permissions: "auto" },
    { session: `claude-code:${UUIDS[2]}`, room: "room-1", held: false, permissions: "auto" },
  ]);
  // Its transcript is there, so it opens with --resume, in its folder.
  fs.mkdirSync(path.join(t.claudeDir, "projects", "fake"), { recursive: true });
  fs.writeFileSync(path.join(t.claudeDir, "projects", "fake", `${UUIDS[1]}.jsonl`), "");
  t.registry.put({ ...t.registry.list()[0]!, folder: t.folder });
  t.driver.close();
  const again = createDriver({
    claudeDir: t.claudeDir,
    account: { id: ADA.id },
    offices: [listsNone(SERVER, (m) => (t.sent.push(m), true))],
    registry: t.registry,
    binary: async () => t.bin,
    settings: async () => SETTINGS,
    scan: async () => null,
    log: () => {},
    projectOf: async () => PROJECT.id,
    env: { ...process.env, CLAUDE_CONFIG_DIR: t.claudeDir, FAKE_STATE: t.state },
  });
  cleanups.push(() => again.close());
  again.take(SERVER, { type: "drive-policy", v: 1, bypassAllowed: [] });
  again.take(SERVER, { type: "drive", v: 1, id: "d1", by: ADA, kind: "instruct", session: `claude-code:${UUIDS[1]}`, text: "carry on" });
  // Started by someone the runner no longer links as: not its person's to act on.
  again.take(SERVER, { type: "drive", v: 1, id: "d2", by: ADA, kind: "instruct", session: `claude-code:${UUIDS[2]}`, text: "carry on" });
  await t.until(() => t.of("turn-ended").length === 1 && t.of("refused").length === 1);
  await again.settled();
  expect(t.of("held")).toEqual([{ type: "driven", v: 1, kind: "held", session: `claude-code:${UUIDS[1]}`, room: "room-1", why: "restored", permissions: "auto" }]);
  expect(t.of("refused")[0]).toMatchObject({ id: "d2", reason: "not-owner" });
  expect(t.fakeLog().find((l) => l.argv).argv.slice(0, 3)).toEqual(["-p", "--resume", UUIDS[1]]);
});

test("restart: a session whose saved conversation is gone fails to reopen and is forgotten", async () => {
  const at = new Date().toISOString();
  const t = await setUp({ records: [] });
  t.registry.put({ kind: "driven", pid: null, spawned: null, session: `claude-code:${UUIDS[1]}`, folder: t.folder, started: at, lastActivity: at, state: "closed", driven: { room: "room-1", project: PROJECT.id, office: SERVER, owner: ADA.id, permissions: "auto", transcript: true } });
  t.driver.close();
  const sent: DrivenMessage[] = [];
  const again = createDriver({
    claudeDir: t.claudeDir,
    account: { id: ADA.id },
    offices: [listsNone(SERVER, (m) => (sent.push(m), true))],
    registry: t.registry,
    binary: async () => t.bin,
    settings: async () => SETTINGS,
    scan: async () => null,
    log: () => {},
    projectOf: async () => PROJECT.id,
    env: { ...process.env, CLAUDE_CONFIG_DIR: t.claudeDir, FAKE_STATE: t.state },
  });
  cleanups.push(() => again.close());
  again.take(SERVER, { type: "drive-policy", v: 1, bypassAllowed: [] });
  again.take(SERVER, { type: "drive", v: 1, id: "d1", by: ADA, kind: "instruct", session: `claude-code:${UUIDS[1]}`, text: "carry on" });
  await t.until(() => sent.some((m) => m.kind === "released"));
  await again.settled();
  expect(sent.map((m) => m.kind)).toEqual(["holding", "held", "turn-started", "turn-ended", "error", "released"]);
  expect(sent[4]).toMatchObject({ text: expect.stringContaining("can't find this session's saved conversation") });
  expect(t.registry.list()).toEqual([]);
});

test("live: what is sent while the office's link is down is dropped, and on the new connection holding says where each session stands, held first", async () => {
  const t = await setUp();
  t.drive(start("d1"));
  await t.until(() => t.of("held").length === 1);
  t.drive({ id: "s1", kind: "stop", session: S1 });
  await t.until(() => t.of("released").length === 1);
  t.drive(start("d2", { instruction: "hang" }));
  await t.until(() => t.fakeLog().some((l) => l.turn === "hang"));
  t.link.up = false;
  t.drive({ id: "d3", kind: "instruct", session: `claude-code:${UUIDS[1]}`, text: "more" });
  await t.driver.settled();
  t.link.up = true;
  const before = t.sent.length;
  t.driver.linked(SERVER);
  t.policy([]);
  expect(t.sent.length).toBe(before + 1);
  expect(t.sent.at(-1)).toEqual({
    type: "driven",
    v: 1,
    kind: "holding",
    sessions: [
      { session: `claude-code:${UUIDS[1]}`, room: "room-1", held: true, permissions: "auto", turn: "d2" },
      { session: S1, room: "room-1", held: false, permissions: "auto" },
    ],
  });
});

test("live: on a new connection nothing driven goes before its first drive-policy, a session's own news dropped meanwhile; with it holding goes, then the prompts still waiting, once; a later one sends neither again", async () => {
  const t = await setUp({ settings: { drivenIdleMinutes: 0.02 } });
  t.drive(start("d1", { instruction: "ask first" }));
  await t.until(() => t.of("prompt").length === 1);
  t.drive(start("d2", { instruction: "first" }));
  await t.until(() => t.of("turn-ended").length === 1);
  const [p] = t.of("prompt");
  const before = t.sent.length;
  t.driver.unlinked(SERVER);
  t.driver.linked(SERVER);
  // The second session's process closes with nothing to do, and its `released` goes nowhere.
  await t.until(() => t.driver.held() === 1);
  expect(t.sent.length).toBe(before);
  t.policy([]);
  expect(t.sent.slice(before)).toEqual([
    {
      type: "driven",
      v: 1,
      kind: "holding",
      sessions: [
        { session: S1, room: "room-1", held: true, permissions: "auto", turn: "d1" },
        { session: S2, room: "room-1", held: false, permissions: "auto" },
      ],
    },
    p,
  ]);
  t.policy([PROJECT.id]);
  t.policy([]);
  await t.driver.settled();
  expect(t.sent.length).toBe(before + 2);
  t.drive({ id: "a1", kind: "answer", session: S1, prompt: p!.prompt, answer: "allow" });
  await t.until(() => t.of("turn-ended").length === 2);
  expect(t.of("prompt-ended")).toEqual([{ type: "driven", v: 1, kind: "prompt-ended", session: S1, prompt: p!.prompt, outcome: "allowed", id: "a1" }]);
});

// A fake office server on 127.0.0.1, with every message it got and its sockets. One that drives
// sessions sends a drive-policy as it lets in a runner that says `drive`, as isoplan-app's does
// (sessions.ts, runnerLinked). One from before driven sessions (isoplan-app edef22d, data-layer.ts,
// `refuse`) sends none, and answers a message of a type it doesn't know with an error and closes
// the link with 1008.
async function office(drives: boolean) {
  const wss = new WebSocketServer({ port: 0, host: "127.0.0.1" });
  await new Promise((resolve) => wss.once("listening", resolve));
  cleanups.push(() => wss.close());
  const got: { type: string }[] = [];
  const sockets: ServerSocket[] = [];
  const known = ["runner", "reply", "refusal", "taken", ...(drives ? ["driven"] : [])];
  wss.on("connection", (ws) => {
    sockets.push(ws);
    ws.on("message", (data) => {
      const m = JSON.parse(String(data)) as { type: string; drive?: boolean };
      got.push(m);
      if (!known.includes(m.type)) {
        ws.send(JSON.stringify({ type: "error", v: PROTOCOL_VERSION, code: "invalid", message: "Invalid discriminator value." }));
        ws.close(1008, "invalid");
      } else if (drives && m.type === "runner" && m.drive) ws.send(JSON.stringify({ type: "drive-policy", v: PROTOCOL_VERSION, bypassAllowed: [] }));
    });
  });
  return { url: `ws://127.0.0.1:${(wss.address() as AddressInfo).port}/data-layer`, got, sockets };
}

test("live: an office on a server from before driven sessions is sent no driven message, so its link stays up and the runner's replies and taken go; one that drives sessions gets holding on each connection, after its drive-policy", async () => {
  const t = await setUp({ policy: null });
  t.driver.close();
  // The runner's link to the office, wired to a driver as runner/main.ts wires them.
  const runnerLink = (url: string) => {
    let link: Link | null = null;
    const driver = createDriver({ claudeDir: t.claudeDir, account: { id: ADA.id }, offices: [{ ...listsNone(url, () => false), send: (m) => link!.sendLive(m) }], registry: t.registry, binary: async () => t.bin, settings: async () => SETTINGS, scan: async () => null, log: () => {}, projectOf: async () => PROJECT.id });
    const asks: ServerAsk[] = [];
    const hello: RunnerHelloMessage = { type: "runner", v: PROTOCOL_VERSION, account: ADA, machine: { name: "sevengill" }, drive: true };
    link = createLink({ url, hello, emit: () => {}, onMessage: (m) => asks.push(m), onDrive: (m) => driver.take(url, m), onOpen: () => driver.linked(url), onClose: () => driver.unlinked(url), retryBaseMs: 20, retryCapMs: 100 });
    cleanups.push(() => (link!.close(), driver.close()));
    return { link, asks };
  };
  const old = await office(false);
  const { link, asks } = runnerLink(old.url);
  await t.until(() => old.got.length === 1);
  old.sockets[0]!.send(JSON.stringify({ type: "request", v: PROTOCOL_VERSION, id: "q1", kind: "answer-question", session: "claude-code:s", room: "r", from: { id: "claude:bob", name: "Bob" }, question: "Why?" }));
  await t.until(() => asks.length === 1);
  link.send({ type: "reply", v: PROTOCOL_VERSION, id: "q1", kind: "answer-question", answer: "Because." });
  link.send({ type: "taken", v: PROTOCOL_VERSION, handoff: "h1", session: "claude-code:0b5c", failures: [] });
  await t.until(() => old.got.length === 3);
  // Long enough for a closed link to have opened again several times (retryBaseMs).
  await new Promise((r) => setTimeout(r, 300));
  expect(old.got.map((m) => m.type)).toEqual(["runner", "reply", "taken"]);
  expect(old.sockets).toHaveLength(1);

  const current = await office(true);
  runnerLink(current.url);
  await t.until(() => current.got.length === 3);
  expect(current.got.slice(1)).toEqual([
    { type: "driven", v: PROTOCOL_VERSION, kind: "holding", sessions: [] },
    { type: "driven", v: PROTOCOL_VERSION, kind: "folders", repos: [] },
  ]);
  current.sockets[0]!.terminate();
  await t.until(() => current.got.length === 6);
  expect(current.got.map((m) => m.type)).toEqual(["runner", "driven", "driven", "runner", "driven", "driven"]);
});

test("a driven take: only for the runner's own person; past the cap it isn't readied; readied, it opens once its taken went, its first turn named by its uuid; one that won't open frees its place", async () => {
  const t = await setUp({ settings: { drivenPerProject: 1 } });
  expect(t.driver.takeProblem({ id: "claude:bob" })).toContain("someone other than this computer's own person");
  expect(t.driver.takeProblem(ADA)).toBe(null);
  const take = { session: UUIDS[2]!, folder: t.folder, prompt: "Isoplan handoff h1: read the brief", name: "Isoplan handoff h1", addDir: path.join(t.root, "brief"), room: "room-2", by: ADA, permissions: "auto" as const };
  expect(await t.driver.prepareTake(SERVER, take)).toBe(null);
  // The take about to open counts against the cap.
  t.drive(start("d1"));
  await t.until(() => t.of("refused").length === 1);
  expect(t.of("refused")[0]).toMatchObject({ reason: "cap-reached" });
  t.driver.taken(UUIDS[2]!, true);
  await t.until(() => t.of("turn-ended").length === 1);
  const session = `claude-code:${UUIDS[2]}`;
  expect(t.sent.slice(1).map((m) => m.kind)).toEqual(["held", "turn-started", "reply", "turn-ended"]);
  expect(t.sent[1]).toEqual({ type: "driven", v: 1, kind: "held", session, room: "room-2", why: "started", permissions: "auto" });
  expect(t.sent[2]).toEqual({ type: "driven", v: 1, kind: "turn-started", session, turn: UUIDS[2] });
  expect(t.fakeLog()[0].argv).toEqual(drivenArgs({ uuid: UUIDS[2]!, resume: false, permissions: "auto", name: "Isoplan handoff h1", addDir: take.addDir }));
  expect(t.fakeLog()[0].argv.slice(-4)).toEqual(["--name", "Isoplan handoff h1", "--add-dir", take.addDir]);
  expect(await t.driver.prepareTake(SERVER, { ...take, session: UUIDS[1]! })).toContain("already has 1 sessions");
  // A take the server dropped, or the runner gave up, opens nothing and frees its place.
  t.drive({ id: "s1", kind: "stop", session });
  await t.until(() => t.of("released").length === 1);
  expect(await t.driver.prepareTake(SERVER, { ...take, session: UUIDS[1]! })).toBe(null);
  t.driver.taken(UUIDS[1]!, false);
  expect(await t.driver.prepareTake(SERVER, { ...take, session: UUIDS[0]! })).toBe(null);
  t.driver.taken(UUIDS[0]!, false);
  await t.driver.settled();
  expect(t.driver.held()).toBe(0);
  expect(t.fakeLog().filter((l) => l.argv)).toHaveLength(1);
});

const BOB = { id: "claude:bob", name: "Bob" };
const S2 = `claude-code:${UUIDS[1]}`;
const ASKED = "Run this command: echo hi > probe.txt\nWhat for: Write hi into probe.txt";
const modeOf = (argv: string[]) => argv[argv.indexOf("--permission-mode") + 1];

test("bypass: a start asking to skip prompts is refused bypass-off until a drive-policy lists its project, then runs in bypassPermissions; one asking for auto runs auto", async () => {
  const t = await setUp();
  t.drive(start("d1", { permissions: "bypassPermissions" }));
  t.policy(["github.com/ada/other"]);
  t.drive(start("d2", { permissions: "bypassPermissions" }));
  await t.until(() => t.of("refused").length === 2);
  const off = { type: "driven", v: 1, kind: "refused", reason: "bypass-off", detail: expect.stringContaining("doesn't let sessions in this project skip permission prompts") };
  expect(t.of("refused")).toEqual([{ ...off, id: "d1" }, { ...off, id: "d2" }]);
  // Project ids are matched lower-cased.
  t.policy(["GitHub.com/Ada/App"]);
  t.drive(start("d3", { permissions: "bypassPermissions" }));
  await t.until(() => t.of("held").length === 1);
  t.drive(start("d4"));
  await t.until(() => t.of("held").length === 2);
  expect(t.of("started").map((m) => [m.id, m.permissions])).toEqual([
    ["d3", "bypassPermissions"],
    ["d4", "auto"],
  ]);
  expect(t.of("held").map((m) => m.permissions)).toEqual(["bypassPermissions", "auto"]);
  await t.until(() => t.fakeLog().filter((l) => l.argv).length === 2);
  const argvOf = (uuid: string) => t.fakeLog().find((l) => l.argv?.includes(uuid)).argv;
  expect(argvOf(UUIDS[0]!)).toEqual(drivenArgs({ uuid: UUIDS[0]!, resume: false, permissions: "bypassPermissions" }));
  expect(modeOf(argvOf(UUIDS[1]!))).toBe("auto");
  await t.registry.flushed();
  expect(t.saved().processes.map((r) => [r.session, r.driven!.permissions, r.driven!.asked])).toEqual([
    [S1, "bypassPermissions", "bypassPermissions"],
    [S2, "auto", "auto"],
  ]);
  expect(t.of("error")).toEqual([]);
});

test("bypass: a reopen and a take skip prompts only while the current connection's drive-policy lists the project; otherwise they open in auto, held says so and an error says why, and the asked mode is kept for later", async () => {
  const t = await setUp();
  t.policy([PROJECT.id]);
  t.drive(start("d1", { permissions: "bypassPermissions" }));
  await t.until(() => t.of("held").length === 1);
  t.drive({ id: "s1", kind: "stop", session: S1 });
  await t.until(() => t.of("released").length === 1);
  // A new connection, whose drive-policy doesn't list the project.
  t.driver.linked(SERVER);
  t.policy([]);
  expect(t.of("holding")[0]!.sessions).toEqual([{ session: S1, room: "room-1", held: false, permissions: "auto" }]);
  t.drive({ id: "d2", kind: "instruct", session: S1, text: "first" });
  await t.until(() => t.of("turn-ended").length === 1);
  const reopened = t.sent.findIndex((m) => m.kind === "held" && m.why === "reopened");
  expect(t.sent.slice(reopened, reopened + 2)).toEqual([
    { type: "driven", v: 1, kind: "held", session: S1, room: "room-1", why: "reopened", permissions: "auto" },
    { type: "driven", v: 1, kind: "error", session: S1, text: expect.stringContaining("so this one runs with them on: whenever the agent needs your permission, it asks you here first") },
  ]);
  expect(t.registry.list()[0]!.driven).toMatchObject({ permissions: "auto", asked: "bypassPermissions" });
  // Allowed again, the next reopen skips prompts once more.
  t.policy([PROJECT.id]);
  t.drive({ id: "s2", kind: "stop", session: S1 });
  await t.until(() => t.of("released").length === 2);
  t.drive({ id: "d3", kind: "instruct", session: S1, text: "second" });
  await t.until(() => t.of("turn-ended").length === 2);
  expect(t.of("held").at(-1)).toMatchObject({ why: "reopened", permissions: "bypassPermissions" });
  // A take readied and opened after the link dropped: no drive-policy holds, and what it says goes nowhere.
  t.driver.unlinked(SERVER);
  const take = { session: UUIDS[1]!, folder: t.folder, prompt: "Isoplan handoff h1: read the brief", name: "Isoplan handoff h1", addDir: path.join(t.root, "brief"), room: "room-2", by: ADA, permissions: "bypassPermissions" as const };
  expect(await t.driver.prepareTake(SERVER, take)).toBe(null);
  const before = t.sent.length;
  t.driver.taken(UUIDS[1]!, true);
  await t.until(() => t.fakeLog().some((l) => l.turn === take.prompt) && t.registry.list().find((r) => r.session === S2)?.state === "idle");
  expect(t.sent.length).toBe(before);
  // On a new connection with a drive-policy that lists the project, holding says that take runs in auto, and the next take skips prompts.
  t.driver.linked(SERVER);
  t.policy([PROJECT.id]);
  expect(t.of("holding").at(-1)!.sessions.find((x) => x.session === S2)).toEqual({ session: S2, room: "room-2", held: true, permissions: "auto" });
  expect(await t.driver.prepareTake(SERVER, { ...take, session: UUIDS[2]! })).toBe(null);
  t.driver.taken(UUIDS[2]!, true);
  await t.until(() => t.of("turn-ended").length === 3);
  expect(t.of("held").at(-1)).toMatchObject({ session: `claude-code:${UUIDS[2]}`, why: "started", permissions: "bypassPermissions" });
  expect(t.of("error")).toHaveLength(1);
  expect(t.fakeLog().filter((l) => l.argv).map((l) => modeOf(l.argv))).toEqual(["bypassPermissions", "auto", "bypassPermissions", "auto", "bypassPermissions"]);
});

test("bypass: a session restored after the runner's restart skips prompts again only where the drive-policy lists its project", async () => {
  const at = new Date().toISOString();
  const t = await setUp();
  for (const uuid of [UUIDS[1]!, UUIDS[2]!])
    t.registry.put({ kind: "driven", pid: null, spawned: null, session: `claude-code:${uuid}`, folder: t.folder, started: at, lastActivity: at, state: "closed", driven: { room: "room-1", project: PROJECT.id, office: SERVER, owner: ADA.id, permissions: "bypassPermissions", asked: "bypassPermissions", transcript: false } });
  t.driver.close();
  const sent: DrivenMessage[] = [];
  const again = createDriver({
    claudeDir: t.claudeDir,
    account: { id: ADA.id },
    offices: [listsNone(SERVER, (m) => (sent.push(m), true))],
    registry: t.registry,
    binary: async () => t.bin,
    settings: async () => SETTINGS,
    scan: async () => null,
    log: () => {},
    projectOf: async () => PROJECT.id,
    env: { ...process.env, CLAUDE_CONFIG_DIR: t.claudeDir, FAKE_STATE: t.state },
  });
  cleanups.push(() => again.close());
  const instruct = (id: string, uuid: string) => again.take(SERVER, { type: "drive", v: 1, id, by: ADA, kind: "instruct", session: `claude-code:${uuid}`, text: "carry on" });
  again.take(SERVER, { type: "drive-policy", v: 1, bypassAllowed: [] });
  instruct("d1", UUIDS[1]!);
  await t.until(() => sent.some((m) => m.kind === "turn-ended"));
  await again.settled();
  again.take(SERVER, { type: "drive-policy", v: 1, bypassAllowed: [PROJECT.id] });
  instruct("d2", UUIDS[2]!);
  await t.until(() => sent.filter((m) => m.kind === "turn-ended").length === 2);
  await again.settled();
  expect(sent.filter((m) => m.kind === "held" || m.kind === "error").map((m) => (m.kind === "held" ? [m.session, m.why, m.permissions] : [m.session, m.kind === "error" ? m.text : ""]))).toEqual([
    [S2, "restored", "auto"],
    [S2, expect.stringContaining("so this one runs with them on")],
    [`claude-code:${UUIDS[2]}`, "restored", "bypassPermissions"],
  ]);
  expect(t.fakeLog().filter((l) => l.argv).map((l) => modeOf(l.argv))).toEqual(["auto", "bypassPermissions"]);
});

test("bypass: a drive-policy that no longer lists the project ends its sessions running in bypassPermissions at once, mid-turn with a prompt waiting; a link drop alone ends nothing; the next instruction reopens it in auto", async () => {
  const t = await setUp();
  t.policy([PROJECT.id]);
  t.drive(start("d0"));
  await t.until(() => t.of("held").length === 1);
  t.drive(start("d1", { permissions: "bypassPermissions", instruction: "ask first" }));
  await t.until(() => t.of("prompt").length === 1);
  const [p] = t.of("prompt");
  t.driver.unlinked(SERVER);
  t.driver.linked(SERVER);
  t.policy([PROJECT.id]);
  await t.driver.settled();
  expect(t.of("released")).toEqual([]);
  expect(t.of("holding")[0]!.sessions.find((x) => x.session === S2)).toEqual({ session: S2, room: "room-1", held: true, permissions: "bypassPermissions", turn: "d1" });
  expect(t.sent.at(-1)).toEqual(p);
  const before = t.sent.length;
  t.policy([]);
  await t.until(() => t.of("released").length === 1);
  expect(t.sent.slice(before)).toEqual([
    { type: "driven", v: 1, kind: "prompt-ended", session: S2, prompt: p!.prompt, outcome: "cancelled" },
    { type: "driven", v: 1, kind: "turn-ended", session: S2, turn: "d1", outcome: "stopped" },
    { type: "driven", v: 1, kind: "error", session: S2, text: "Skipping permission prompts was turned off for this project, so this session was closed. Your next instruction reopens it with prompts on." },
    { type: "driven", v: 1, kind: "released", session: S2, why: "stopped" },
  ]);
  const { pid } = t.fakeLog().find((l) => l.argv && modeOf(l.argv) === "bypassPermissions");
  for (let i = 0; i < 100 && alive(pid); i++) await new Promise((r) => setTimeout(r, 50));
  expect(alive(pid)).toBe(false);
  // The session in auto runs on.
  expect(t.driver.held()).toBe(1);
  t.drive({ id: "d2", kind: "instruct", session: S2, text: "again" });
  await t.until(() => t.of("turn-ended").length === 2);
  expect(t.of("held").at(-1)).toEqual({ type: "driven", v: 1, kind: "held", session: S2, room: "room-1", why: "reopened", permissions: "auto" });
  expect(modeOf(t.fakeLog().filter((l) => l.argv).at(-1).argv)).toBe("auto");
  expect(t.of("reply").at(-1)).toMatchObject({ session: S2, text: "Done: again" });
});

test("bypass: a session whose bypassPermissions was withdrawn but whose process won't end stays held and takes no instruction, refused unavailable, and ending it is tried again", async () => {
  const stuck: Spawn = () => Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), pid: undefined, exitCode: null, signalCode: null, kill: () => true }) as unknown as ChildProcessWithoutNullStreams;
  const t = await setUp({ spawn: stuck });
  t.policy([PROJECT.id]);
  t.drive(start("d1", { permissions: "bypassPermissions" }));
  await t.until(() => t.of("held").length === 1);
  // The 10 s an ended process gets passes at once, each time.
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  try {
    t.policy([]);
    await vi.advanceTimersByTimeAsync(11000);
    t.drive({ id: "d2", kind: "instruct", session: S1, text: "more" });
    await vi.advanceTimersByTimeAsync(11000);
  } finally {
    vi.useRealTimers();
  }
  await t.driver.settled();
  expect(t.of("refused")).toEqual([{ type: "driven", v: 1, kind: "refused", id: "d2", reason: "unavailable", detail: expect.stringContaining("Claude Code couldn't be closed for this session") }]);
  expect([t.of("released"), t.of("turn-started")]).toEqual([[], []]);
  expect(t.logs.filter((l) => l.includes("didn't end when skipping permission prompts was turned off"))).toHaveLength(2);
  expect(t.driver.held()).toBe(1);
});

test("prompt: relayed under the runner's own id, in plain words, with when it expires; the owner's allow runs the tool and deny doesn't, each ending it once; a forged or answered id is no-prompt, and someone else's answer not-owner", async () => {
  const t = await setUp();
  t.drive(start("d1", { instruction: "ask first" }));
  await t.until(() => t.of("prompt").length === 1);
  const [p] = t.of("prompt");
  expect(p).toEqual({ type: "driven", v: 1, kind: "prompt", session: S1, turn: "d1", prompt: expect.stringMatching(/^p-/), tool: "Bash", description: ASKED, expires: expect.any(String) });
  const left = Date.parse(p!.expires) - Date.now();
  expect(left > 9 * 60000 && left <= 10 * 60000).toBe(true);
  t.driver.take(SERVER, { type: "drive", v: 1, id: "a0", by: BOB, kind: "answer", session: S1, prompt: p!.prompt, answer: "allow" });
  // Claude Code's own id for it isn't one the runner raised.
  t.drive({ id: "a1", kind: "answer", session: S1, prompt: "req-1", answer: "allow" });
  await t.until(() => t.of("refused").length === 2);
  expect(t.of("refused").map((m) => [m.id, m.reason])).toEqual([
    ["a0", "not-owner"],
    ["a1", "no-prompt"],
  ]);
  expect(t.fakeLog().filter((l) => l.answered)).toEqual([]);
  t.drive({ id: "a2", kind: "answer", session: S1, prompt: p!.prompt, answer: "allow" });
  t.drive({ id: "a3", kind: "answer", session: S1, prompt: p!.prompt, answer: "deny" });
  await t.until(() => t.of("turn-ended").length === 1 && t.of("refused").length === 3);
  expect(t.of("refused")[2]).toEqual({ type: "driven", v: 1, kind: "refused", id: "a3", reason: "no-prompt", detail: expect.stringContaining("isn't waiting for an answer any more") });
  expect(t.of("prompt-ended")).toEqual([{ type: "driven", v: 1, kind: "prompt-ended", session: S1, prompt: p!.prompt, outcome: "allowed", id: "a2" }]);
  expect(t.of("reply")[0]).toMatchObject({ text: "Ran: echo hi > probe.txt" });
  expect(t.of("turn-ended")[0]).toMatchObject({ outcome: "done" });
  t.drive({ id: "d2", kind: "instruct", session: S1, text: "ask again" });
  await t.until(() => t.of("prompt").length === 2);
  const q = t.of("prompt")[1]!;
  expect(q.prompt).not.toBe(p!.prompt);
  t.drive({ id: "a4", kind: "answer", session: S1, prompt: q.prompt, answer: "deny" });
  await t.until(() => t.of("turn-ended").length === 2);
  expect(t.of("prompt-ended")[1]).toEqual({ type: "driven", v: 1, kind: "prompt-ended", session: S1, prompt: q.prompt, outcome: "denied", id: "a4" });
  expect(t.of("reply")[1]).toMatchObject({ text: "Not run: The user denied this permission request from the Isoplan floor." });
  expect(t.fakeLog().filter((l) => l.answered).map((l) => l.answered)).toEqual([
    { subtype: "success", request_id: "req-1", response: { behavior: "allow", updatedInput: { command: "echo hi > probe.txt", description: "Write hi into probe.txt" } } },
    { subtype: "success", request_id: "req-2", response: { behavior: "deny", message: "The user denied this permission request from the Isoplan floor." } },
  ]);
});

test("prompt: with no answer by expires it is denied to Claude Code and ends timed-out, and an answer after is no-prompt; neither the idle close nor the stuck timeout ends the session while it waits", async () => {
  const t = await setUp({ settings: { drivenPromptMinutes: 0.05, drivenIdleMinutes: 0.005, drivenStartSeconds: 2 } });
  t.drive(start("d1", { instruction: "ask first" }));
  await t.until(() => t.of("prompt").length === 1);
  const [p] = t.of("prompt");
  expect(Date.parse(p!.expires) - Date.now()).toBeLessThanOrEqual(3000);
  await t.until(() => t.of("turn-ended").length === 1);
  // Nothing came between the prompt and its end, though it waited past drivenStartSeconds and drivenIdleMinutes.
  expect(t.sent.slice(t.sent.indexOf(p!) + 1).map((m) => m.kind)).toEqual(["prompt-ended", "reply", "turn-ended"]);
  expect(Date.now()).toBeGreaterThanOrEqual(Date.parse(p!.expires));
  expect(t.of("prompt-ended")).toEqual([{ type: "driven", v: 1, kind: "prompt-ended", session: S1, prompt: p!.prompt, outcome: "timed-out" }]);
  expect(t.fakeLog().filter((l) => l.answered).map((l) => l.answered.response)).toEqual([{ behavior: "deny", message: "No answer to this permission request came from the Isoplan floor in time, so it was denied." }]);
  t.drive({ id: "a1", kind: "answer", session: S1, prompt: p!.prompt, answer: "allow" });
  await t.until(() => t.of("refused").length === 1);
  expect(t.of("refused")[0]).toMatchObject({ id: "a1", reason: "no-prompt" });
  // Once the turn is over, the idle close runs again.
  await t.until(() => t.of("released").length === 1);
  expect(t.of("released")[0]).toMatchObject({ why: "idle-closed" });
});

test("prompt: one raised after its turn has ended keeps the idle close off while it waits, through other output too; once answered, the session is idle-closed", async () => {
  const t = await setUp({ settings: { drivenIdleMinutes: 0.01 } });
  t.drive(start("d1", { instruction: "ask after" }));
  await t.until(() => t.of("prompt").length === 1 && t.fakeLog().some((l) => l.waiting));
  const [p] = t.of("prompt");
  expect(p).toEqual({ type: "driven", v: 1, kind: "prompt", session: S1, prompt: expect.stringMatching(/^p-/), tool: "Bash", description: ASKED, expires: expect.any(String) });
  // Several times drivenIdleMinutes (0.6 s) go by while it waits.
  await new Promise((r) => setTimeout(r, 2500));
  await t.driver.settled();
  expect(t.of("released")).toEqual([]);
  expect(t.driver.held()).toBe(1);
  t.drive({ id: "a1", kind: "answer", session: S1, prompt: p!.prompt, answer: "allow" });
  await t.until(() => t.of("released").length === 1);
  expect(t.sent.slice(-2)).toEqual([
    { type: "driven", v: 1, kind: "prompt-ended", session: S1, prompt: p!.prompt, outcome: "allowed", id: "a1" },
    { type: "driven", v: 1, kind: "released", session: S1, why: "idle-closed" },
  ]);
});

test("prompt: a request from Claude Code that isn't a permission prompt is answered with an error at once, and the turn goes on to its end", async () => {
  const t = await setUp();
  t.drive(start("d1", { instruction: "elicit first" }));
  await t.until(() => t.of("turn-ended").length === 1);
  expect(t.of("turn-ended")[0]).toMatchObject({ turn: "d1", outcome: "done" });
  expect(t.of("prompt")).toEqual([]);
  expect(t.fakeLog().filter((l) => l.answered).map((l) => l.answered)).toEqual([
    { subtype: "error", request_id: "req-1", error: "Not supported: the Isoplan runner driving this session answers only permission requests." },
  ]);
  expect(t.logs.filter((l) => l.includes("request of subtype elicitation"))).toHaveLength(1);
});

test("prompt: a stop while one waits ends it cancelled before the turn, as a hand-back does; one Claude Code cancels itself ends cancelled; Claude Code gets no answer for any, and each is then no-prompt", async () => {
  const t = await setUp();
  t.drive(start("d1", { instruction: "ask first" }));
  await t.until(() => t.of("prompt").length === 1);
  const p1 = t.of("prompt")[0]!.prompt;
  t.drive({ id: "s1", kind: "stop", session: S1 });
  await t.until(() => t.of("released").length === 1);
  expect(t.sent.slice(-3)).toEqual([
    { type: "driven", v: 1, kind: "prompt-ended", session: S1, prompt: p1, outcome: "cancelled" },
    { type: "driven", v: 1, kind: "turn-ended", session: S1, turn: "d1", outcome: "stopped" },
    { type: "driven", v: 1, kind: "released", session: S1, why: "stopped", id: "s1" },
  ]);
  t.drive({ id: "d2", kind: "instruct", session: S1, text: "ask, then cancel" });
  await t.until(() => t.of("turn-ended").length === 2);
  const p2 = t.of("prompt")[1]!.prompt;
  expect(t.sent.slice(-3)).toEqual([
    { type: "driven", v: 1, kind: "prompt-ended", session: S1, prompt: p2, outcome: "cancelled" },
    { type: "driven", v: 1, kind: "reply", session: S1, turn: "d2", text: "Cancelled" },
    { type: "driven", v: 1, kind: "turn-ended", session: S1, turn: "d2", outcome: "done" },
  ]);
  t.drive({ id: "a1", kind: "answer", session: S1, prompt: p1, answer: "allow" });
  t.drive({ id: "a2", kind: "answer", session: S1, prompt: p2, answer: "allow" });
  await t.until(() => t.of("refused").length === 2);
  expect(t.of("refused").map((m) => [m.id, m.reason])).toEqual([
    ["a1", "no-prompt"],
    ["a2", "no-prompt"],
  ]);
  t.drive({ id: "d3", kind: "instruct", session: S1, text: "ask third" });
  await t.until(() => t.of("prompt").length === 3);
  t.drive({ id: "h1", kind: "hand-back", session: S1 });
  await t.until(() => t.of("handed-back").length === 1);
  expect(t.sent.slice(-4).map((m) => m.kind)).toEqual(["prompt-ended", "turn-ended", "released", "handed-back"]);
  expect(t.sent.at(-4)).toEqual({ type: "driven", v: 1, kind: "prompt-ended", session: S1, prompt: t.of("prompt")[2]!.prompt, outcome: "cancelled" });
  expect(t.fakeLog().filter((l) => l.answered)).toEqual([]);
});

test("prompt: one raised while the link is down isn't kept anywhere; on every new connection, right after holding, each still waiting goes again with the same id and expires", async () => {
  const t = await setUp();
  t.drive(start("d1"));
  await t.until(() => t.of("held").length === 1);
  t.link.up = false;
  t.drive({ id: "d2", kind: "instruct", session: S1, text: "ask first" });
  await t.until(() => t.dropped.some((m) => m.kind === "prompt"));
  const made = t.dropped.find((m): m is Of<"prompt"> => m.kind === "prompt")!;
  t.link.up = true;
  await new Promise((r) => setTimeout(r, 100));
  await t.driver.settled();
  expect(t.of("prompt")).toEqual([]);
  const before = t.sent.length;
  t.driver.linked(SERVER);
  t.policy([]);
  expect(t.sent.slice(before).map((m) => m.kind)).toEqual(["holding", "prompt"]);
  expect(t.sent.at(-1)).toEqual(made);
  t.driver.unlinked(SERVER);
  t.driver.linked(SERVER);
  t.policy([]);
  expect(t.sent.slice(-2)).toEqual([expect.objectContaining({ kind: "holding" }), made]);
  t.drive({ id: "a1", kind: "answer", session: S1, prompt: made.prompt, answer: "allow" });
  await t.until(() => t.of("turn-ended").length === 1);
  expect(t.of("prompt-ended")).toEqual([{ type: "driven", v: 1, kind: "prompt-ended", session: S1, prompt: made.prompt, outcome: "allowed", id: "a1" }]);
  t.driver.linked(SERVER);
  t.policy([]);
  expect(t.sent.at(-1)!.kind).toBe("holding");
});

test("scan: a prompt whose tool name may hold a secret goes as `tool`, and one whose description may with a description that only says so, both withheld, and either can still be answered", async () => {
  const t = await setUp();
  t.drive(start("d1", { instruction: "ask, with a leak" }));
  await t.until(() => t.of("prompt").length === 1);
  t.drive({ id: "a1", kind: "answer", session: S1, prompt: t.of("prompt")[0]!.prompt, answer: "deny" });
  await t.until(() => t.of("turn-ended").length === 1);
  t.drive({ id: "d2", kind: "instruct", session: S1, text: "ask, through a named tool" });
  await t.until(() => t.of("prompt").length === 2);
  t.drive({ id: "a2", kind: "answer", session: S1, prompt: t.of("prompt")[1]!.prompt, answer: "deny" });
  await t.until(() => t.of("turn-ended").length === 2);
  expect(JSON.stringify(t.sent)).not.toContain(AWS_KEY);
  expect(t.of("prompt").map(({ tool, description, withheld }) => ({ tool, description, withheld }))).toEqual([
    { tool: "Bash", description: "Held back on this computer: what the agent wants to do may contain a secret, so it isn't shown here.", withheld: true },
    { tool: "tool", description: ASKED, withheld: true },
  ]);
  expect(t.of("prompt-ended").map((m) => m.outcome)).toEqual(["denied", "denied"]);
  expect(t.logs.filter((l) => l.startsWith("withheld what permission prompt"))).toHaveLength(2);
});

test("promptDescription: what a prompt asks, in plain words, for a command, a file, an address, a search, and any other tool", () => {
  expect(promptDescription("Bash", { command: "npm test", description: "Run the tests" })).toBe("Run this command: npm test\nWhat for: Run the tests");
  expect(promptDescription("PowerShell", { command: "Remove-Item build -Recurse" })).toBe("Run this command: Remove-Item build -Recurse");
  expect(promptDescription("Write", { file_path: "C:\\app\\notes.md", content: "..." })).toBe("Write the file C:\\app\\notes.md");
  expect(promptDescription("Edit", { file_path: "/app/src/a.ts", old_string: "a", new_string: "b" })).toBe("Change the file /app/src/a.ts");
  expect(promptDescription("WebFetch", { url: "https://example.com/docs", prompt: "Summarise it" })).toBe("Open the web address https://example.com/docs");
  expect(promptDescription("WebSearch", { query: "zod 4 discriminated unions" })).toBe("Search the web for: zod 4 discriminated unions");
  expect(promptDescription("mcp__github__create_issue", { title: "Fix", body: "Broken" })).toBe('Use mcp__github__create_issue with: {"title":"Fix","body":"Broken"}');
  expect(promptDescription("ExitPlanMode", {})).toBe("Use ExitPlanMode");
});
