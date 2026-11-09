import { describe, expect, test } from "vitest";
import {
  MAX_BRANCH_LENGTH,
  MAX_DETAIL_LENGTH,
  MAX_DRIVE_ID_LENGTH,
  MAX_FOLDER_LENGTH,
  MAX_FOLDER_REPOS,
  MAX_HOLDING,
  MAX_INSTRUCTION_LENGTH,
  MAX_OWNER_MESSAGE_LENGTH,
  MAX_OUTPUT_LENGTH,
  MAX_PROMPT_LENGTH,
  MAX_REPLY_LENGTH,
  MAX_REPO_BRANCHES,
  MAX_REPO_FOLDERS,
  MAX_ROOM_SESSIONS,
  MAX_SUMMARY_LENGTH,
  MAX_TASK_LENGTH,
  MAX_TOOL_NAME_LENGTH,
  MAX_WORKFLOW_DESCRIPTION_LENGTH,
  MAX_WORKFLOW_LABEL_LENGTH,
  MAX_WORKFLOW_NAME_LENGTH,
  MAX_WORKFLOW_PHASE_DETAIL_LENGTH,
  MAX_WORKFLOW_PHASE_TITLE_LENGTH,
  MAX_WORKFLOW_PHASES,
  parseDataLayerMessage,
  parseOfficeServerMessage,
  PROTOCOL_VERSION,
  type AgentFact,
  type Facts,
  type FloorDriveRefusalReason,
  type Handoff,
  type ParseResult,
  type WorkflowFact,
} from "./index.js";

const at = "2026-10-20T09:00:00.000Z";

const lead: AgentFact = {
  id: "claude-code:s1",
  source: "claude-code",
  session: "claude-code:s1",
  startedBy: null,
  agentType: null,
  task: null,
  status: "working",
  statusSince: at,
  lastActive: at,
  doing: { kind: "write", file: "src/a.ts", since: at },
  usage: {
    model: "claude-opus-5-5",
    context: 42000,
    input: 10,
    cacheWrite: 200,
    cacheWrite1h: 0,
    cacheRead: 41790,
    output: 300,
    over100k: { input: 0, cacheWrite: 0, cacheWrite1h: 0, cacheRead: 0, output: 0 },
    at,
  },
};

const worker: AgentFact = {
  ...lead,
  id: "claude-code:w1",
  startedBy: lead.id,
  agentType: "general-purpose",
  task: "Fix the tests",
  status: "done",
  doing: null,
  usage: null,
  checkout: "C:/w/repo-wt",
  branch: null,
  extra: { endState: "completed" },
};

const facts: Facts = {
  session: {
    id: "claude-code:s1",
    source: "claude-code",
    lead: lead.id,
    title: "main",
    titleFrom: "branch",
    branch: "main",
    checkout: "C:/w/repo",
    lastActive: at,
    status: "active",
    lights: "on",
  },
  agents: [lead, worker],
  edits: [{ agent: lead.id, file: "src/a.ts", at }],
  reads: [{ agent: worker.id, file: "src/b.ts", at }],
  waits: [{ waiter: lead.id, on: worker.id, since: at }],
  reports: [{ agent: worker.id, at, text: "Done." }],
  questions: [
    {
      id: "toolu_01",
      agent: lead.id,
      at,
      questions: [
        {
          question: "Which branch should the fix go on?",
          header: "Branch",
          options: [
            { label: "main", description: "Straight to main." },
            { label: "A new branch", description: "" },
          ],
          multiSelect: false,
        },
      ],
    },
  ],
};

const v = PROTOCOL_VERSION;
const adam = { id: "4f9c6a2e-0000-4000-8000-000000000000", name: "Adam" };
const sam = { id: "7d21b0c4-0000-4000-8000-000000000000", name: "Sam" };
const handoff: Handoff = {
  id: "h7k2",
  brief: "The tests in src/a.ts fail on Windows paths; the fix is half done.",
  repos: [
    { path: ".", remote: "github.com/isoplan-app/isoplan", branch: "isoplan/handoff/h7k2", commit: "0123456789abcdef0123456789abcdef01234567" },
    { path: "libs/core", remote: "github.com/adamlinscott/core", branch: "isoplan/handoff/h7k2", commit: "89abcdef0123456789abcdef0123456789abcdef" },
  ],
};
const room = "room:claude-code:s1";
const driving = "claude-code:0b5c4d3e-0000-4000-8000-000000000001";
const isoplan = { id: "github.com/isoplan-app/isoplan", name: "isoplan" };

const valid = {
  hello: {
    type: "hello",
    v,
    source: "claude-code",
    account: adam,
    machine: { name: "sevengill" },
    session: "claude-code:s1",
    project: { id: "github.com/isoplan-app/isoplan", name: "isoplan" },
  },
  runner: { type: "runner", v, account: adam, machine: { name: "sevengill" } },
  "hello with a token": { type: "hello", v, source: "claude-code", account: adam, machine: { name: "sevengill" }, session: "claude-code:s1", project: { id: "github.com/isoplan-app/isoplan", name: "isoplan" }, token: "a1b2" + ".c3d4" },
  "runner with a token": { type: "runner", v, account: adam, machine: { name: "sevengill" }, token: "a1b2" + ".c3d4" },
  "runner with Orca": { type: "runner", v, account: adam, machine: { name: "sevengill" }, orca: true },
  "runner with the Claude app": { type: "runner", v, account: adam, machine: { name: "sevengill" }, desktop: true },
  full: { type: "full", v, seq: 0, facts },
  changes: { type: "changes", v, seq: 1, upsert: {}, remove: {} },
  "reply answer-question": { type: "reply", v, id: "r1", kind: "answer-question", answer: "Because of the CRLF check." },
  "reply write-brief": { type: "reply", v, id: "r2", kind: "write-brief", handoff },
  "reply write-brief fallback": { type: "reply", v, id: "r2", kind: "write-brief", handoff, fallback: true },
  "reply write-brief fallback without claude": { type: "reply", v, id: "r2", kind: "write-brief", handoff, fallback: true, noClaude: true },
  "reply owner-answer": { type: "reply", v, id: "r3", kind: "owner-answer" },
  "reply focus": { type: "reply", v, id: "f1", kind: "focus" },
  "reply owner-message": { type: "reply", v, id: "m1", kind: "owner-message", queued: true },
  "refusal over-cap": { type: "refusal", v, id: "r1", reason: "over-cap", cap: "owner-tokens" },
  "refusal withheld": { type: "refusal", v, id: "r1", reason: "withheld" },
  "refusal withheld commit": { type: "refusal", v, id: "r2", reason: "withheld", file: "config/dev.ts", unchecked: ["assets/logo.png"] },
  "refusal unavailable": { type: "refusal", v, id: "r2", reason: "unavailable", detail: "The session's folder is gone." },
  "refusal of an owner-message": { type: "refusal", v, id: "m1", reason: "unavailable", detail: "This session has ended.", code: "ended" },
  "hand-over": { type: "hand-over", v, to: "sam@example.com", handoff },
  "hand-over-check": { type: "hand-over-check", v, to: "Sam", handoff: "h7k2" },
  take: { type: "take", v, code: "K4P9-2QX" },
  taken: { type: "taken", v, handoff: "h7k2", failures: [{ step: "setup", output: "pnpm: command not found" }, { step: "checkout", repo: "libs/core", output: "" }] },
  "taken by a runner": { type: "taken", v, handoff: "h7k2", session: "claude-code:0b5c", failures: [] },
  repair: { type: "repair", v, reason: "missed seq 4" },
  welcome: { type: "welcome", v, projects: ["github.com/team/app", "github.com/team/api"] },
  conflict: { type: "conflict", v, agent: worker.id, file: "src/a.ts", text: "Another agent edited src/a.ts." },
  error: { type: "error", v, code: "not-paired", message: "Pair this machine first." },
  "request answer-question": {
    type: "request",
    v,
    id: "r1",
    kind: "answer-question",
    session: "claude-code:s1",
    room: "room:claude-code:s1",
    from: sam,
    question: "Why does the CRLF check exist?",
  },
  "request write-brief": { type: "request", v, id: "r2", kind: "write-brief", session: "claude-code:s1", room: "room:claude-code:s1", handoff: "h7k2", to: sam },
  "request focus": { type: "request", v, id: "f1", kind: "focus", handoff: "h7k2" },
  "request owner-answer": {
    type: "request",
    v,
    id: "r3",
    kind: "owner-answer",
    session: "claude-code:s1",
    question: "toolu_01",
    answers: { "Which branch should the fix go on?": "A new branch" },
  },
  "request owner-message": { type: "request", v, id: "m1", kind: "owner-message", session: "claude-code:s1", from: adam, text: "Now run the tests." },
  release: { type: "release", v, id: "r1" },
  handoff: { type: "handoff", v, handoff },
  "handed-over": { type: "handed-over", v, handoff: "h7k2", to: sam },
  "hand-over-ready": { type: "hand-over-ready", v, handoff: "h7k2", to: sam },
  drop: { type: "drop", v, id: "r2" },
  "handoff to a runner": { type: "handoff", v, handoff, mode: "headless", session: "0b5c4d3e-0000-4000-8000-000000000001" },
  "handoff into Orca": { type: "handoff", v, handoff, mode: "orca", session: "0b5c4d3e-0000-4000-8000-000000000001" },
  "handoff into the Claude app": { type: "handoff", v, handoff, mode: "desktop", session: "0b5c4d3e-0000-4000-8000-000000000001" },
  "ask-room": { type: "ask-room", v, question: "Why does the CRLF check exist?" },
  "ask-room with a key": { type: "ask-room", v, question: "Why does the CRLF check exist?", key: "toolu_01" },
  "asked-ack": { type: "asked-ack", v, question: "q-4f9c" },
  "ask-rights": { type: "ask-rights", v, room: "room:claude-code:s1", owner: adam, granted: true },
  "ask-check": { type: "ask-check", v, question: "q-4f9c" },
  asked: { type: "asked", v, question: "q-4f9c", text: "Why does the CRLF check exist?", state: "answered", answer: "Windows checkouts.", owner: "Adam", key: "toolu_01" },
  "asked queued": { type: "asked", v, question: "q-4f9c", text: "Why does the CRLF check exist?", state: "queued", note: "Adam's machine isn't reachable." },
  "runner that drives sessions": { type: "runner", v, account: adam, machine: { name: "sevengill" }, drive: true },
  "runner without Claude Code": { type: "runner", v, account: adam, machine: { name: "sevengill" }, drive: true, claude: "missing" },
  "runner with places to start in": { type: "runner", v, account: adam, machine: { name: "sevengill" }, drive: true, orca: true, starts: ["terminal", "headless", "orca"] },
  "handoff as a driven session": { type: "handoff", v, handoff, mode: "driven", session: "0b5c4d3e-0000-4000-8000-000000000001", by: sam, room, permissions: "auto" },
  "drive start": { type: "drive", v, kind: "start", id: "d1", by: adam, room, project: isoplan, roomSessions: ["claude-code:s1"], instruction: "Fix the failing test in src/a.ts.", permissions: "auto" },
  "drive start in a folder": { type: "drive", v, kind: "start", id: "d8", by: adam, folder: "C:\\Users\\adam\\isoplan", project: isoplan, instruction: "Add a dark mode.", permissions: "auto" },
  "drive start on a branch": { type: "drive", v, kind: "start", id: "d9", by: adam, folder: "/Users/sam/code/isoplan", branch: "feat/dark-mode", project: isoplan, permissions: "auto" },
  "drive start in Orca": { type: "drive", v, kind: "start", id: "d10", by: adam, folder: "/Users/sam/code/isoplan", branch: "feat/dark-mode", project: isoplan, instruction: "Write the docs page.", permissions: "auto", mode: "orca" },
  "drive instruct": { type: "drive", v, kind: "instruct", id: "i2", by: adam, session: driving, text: "Now run the whole suite." },
  "drive stop": { type: "drive", v, kind: "stop", id: "d3", by: adam, session: driving },
  "drive hand-back": { type: "drive", v, kind: "hand-back", id: "d4", by: adam, session: driving },
  "drive stop and remove": { type: "drive", v, kind: "stop", id: "d11", by: adam, session: driving, remove: true },
  "drive interrupt": { type: "drive", v, kind: "interrupt", id: "d12", by: adam, session: driving },
  "drive output": { type: "drive", v, kind: "output", id: "d5", by: adam, session: driving, turn: "i2" },
  "drive answer": { type: "drive", v, kind: "answer", id: "d6", by: adam, session: driving, prompt: "p1", answer: "allow" },
  "drive release": { type: "drive", v, kind: "release", id: "d7", by: adam, session: driving, withheld: "w1" },
  "drive install-claude": { type: "drive", v, kind: "install-claude", id: "c1", by: adam },
  "drive sign-in-claude": { type: "drive", v, kind: "sign-in-claude", id: "c2", by: adam },
  "drive-policy": { type: "drive-policy", v, bypassAllowed: ["github.com/isoplan-app/isoplan"] },
  "driven started": { type: "driven", v, kind: "started", id: "d1", session: driving, room, permissions: "auto" },
  "driven turn-started": { type: "driven", v, kind: "turn-started", session: driving, turn: "i2" },
  "driven tool": { type: "driven", v, kind: "tool", session: driving, turn: "i2", tool: "Bash", summary: "pnpm test" },
  "driven reply": { type: "driven", v, kind: "reply", session: driving, turn: "i2", text: "All 252 tests pass." },
  "driven turn-ended": { type: "driven", v, kind: "turn-ended", session: driving, turn: "i2", outcome: "done" },
  "driven error": { type: "driven", v, kind: "error", session: driving, text: "Claude Code couldn't resume this session." },
  "driven output": { type: "driven", v, kind: "output", id: "d5", session: driving, turn: "i2", text: "> pnpm test\n\nAll 252 tests pass." },
  "driven prompt": { type: "driven", v, kind: "prompt", session: driving, turn: "i2", prompt: "p1", tool: "Bash", description: "Run git push origin main", expires: "2026-11-05T09:05:00.000Z" },
  "driven prompt-ended": { type: "driven", v, kind: "prompt-ended", session: driving, prompt: "p1", outcome: "allowed", id: "d6" },
  "driven held": { type: "driven", v, kind: "held", session: driving, room, why: "restored", permissions: "bypassPermissions" },
  "driven released": { type: "driven", v, kind: "released", session: driving, why: "handed-back", id: "d4" },
  "driven released removed": { type: "driven", v, kind: "released", session: driving, why: "removed", id: "d11" },
  "driven handed-back": { type: "driven", v, kind: "handed-back", id: "d4", session: driving, command: "claude --resume 0b5c4d3e-0000-4000-8000-000000000001", folder: "C:/w/repo" },
  "driven refused": { type: "driven", v, kind: "refused", id: "d1", reason: "no-folder" },
  "driven refused at the cap": { type: "driven", v, kind: "refused", id: "d1", reason: "cap-reached", limit: 4 },
  "driven refused unavailable": { type: "driven", v, kind: "refused", id: "d1", reason: "unavailable", detail: "Claude Code isn't signed in on this machine." },
  "driven opened": { type: "driven", v, kind: "opened", id: "d10", session: driving, room: `room:${driving}`, mode: "desktop", note: "The Claude app didn't open on the session." },
  "driven folders": { type: "driven", v, kind: "folders", repos: [{ project: isoplan.id, folders: ["/Users/sam/code/isoplan", "/Users/sam/code/isoplan-wt"] }] },
  "driven folders with branches": { type: "driven", v, kind: "folders", repos: [{ project: isoplan.id, folders: ["/Users/sam/code/isoplan"], branches: ["main", "feat/dark-mode"] }] },
  "driven holding": { type: "driven", v, kind: "holding", sessions: [{ session: driving, room, held: true, permissions: "auto", turn: "i2" }] },
  "driven claude installing": { type: "driven", v, kind: "claude", claude: "missing", doing: "installing", progress: "Downloading Claude Code...", id: "c1" },
  "driven claude signing in": { type: "driven", v, kind: "claude", claude: "signed-out", doing: "signing-in", url: "https://claude.ai/oauth/authorize?code=true", id: "c2" },
  "driven claude failed": { type: "driven", v, kind: "claude", claude: "missing", failed: "The installer stopped with code 1.", id: "c1" },
};

const parsers = {
  hello: parseDataLayerMessage,
  runner: parseDataLayerMessage,
  "hello with a token": parseDataLayerMessage,
  "runner with a token": parseDataLayerMessage,
  "runner with Orca": parseDataLayerMessage,
  "runner with the Claude app": parseDataLayerMessage,
  full: parseDataLayerMessage,
  changes: parseDataLayerMessage,
  "reply answer-question": parseDataLayerMessage,
  "reply write-brief": parseDataLayerMessage,
  "reply write-brief fallback": parseDataLayerMessage,
  "reply write-brief fallback without claude": parseDataLayerMessage,
  "reply owner-answer": parseDataLayerMessage,
  "reply focus": parseDataLayerMessage,
  "reply owner-message": parseDataLayerMessage,
  "refusal of an owner-message": parseDataLayerMessage,
  "refusal over-cap": parseDataLayerMessage,
  "refusal withheld": parseDataLayerMessage,
  "refusal withheld commit": parseDataLayerMessage,
  "refusal unavailable": parseDataLayerMessage,
  "hand-over": parseDataLayerMessage,
  "hand-over-check": parseDataLayerMessage,
  take: parseDataLayerMessage,
  taken: parseDataLayerMessage,
  "taken by a runner": parseDataLayerMessage,
  repair: parseOfficeServerMessage,
  welcome: parseOfficeServerMessage,
  conflict: parseOfficeServerMessage,
  error: parseOfficeServerMessage,
  "request answer-question": parseOfficeServerMessage,
  "request write-brief": parseOfficeServerMessage,
  "request owner-answer": parseOfficeServerMessage,
  "request focus": parseOfficeServerMessage,
  "request owner-message": parseOfficeServerMessage,
  release: parseOfficeServerMessage,
  handoff: parseOfficeServerMessage,
  "handed-over": parseOfficeServerMessage,
  "hand-over-ready": parseOfficeServerMessage,
  drop: parseOfficeServerMessage,
  "handoff to a runner": parseOfficeServerMessage,
  "handoff into Orca": parseOfficeServerMessage,
  "handoff into the Claude app": parseOfficeServerMessage,
  "ask-room": parseDataLayerMessage,
  "ask-room with a key": parseDataLayerMessage,
  "asked-ack": parseDataLayerMessage,
  "ask-rights": parseOfficeServerMessage,
  "ask-check": parseDataLayerMessage,
  asked: parseOfficeServerMessage,
  "asked queued": parseOfficeServerMessage,
  "runner that drives sessions": parseDataLayerMessage,
  "runner without Claude Code": parseDataLayerMessage,
  "runner with places to start in": parseDataLayerMessage,
  "handoff as a driven session": parseOfficeServerMessage,
  "drive start": parseOfficeServerMessage,
  "drive start in a folder": parseOfficeServerMessage,
  "drive start on a branch": parseOfficeServerMessage,
  "drive start in Orca": parseOfficeServerMessage,
  "drive instruct": parseOfficeServerMessage,
  "drive stop": parseOfficeServerMessage,
  "drive hand-back": parseOfficeServerMessage,
  "drive stop and remove": parseOfficeServerMessage,
  "drive interrupt": parseOfficeServerMessage,
  "drive output": parseOfficeServerMessage,
  "drive answer": parseOfficeServerMessage,
  "drive release": parseOfficeServerMessage,
  "drive install-claude": parseOfficeServerMessage,
  "drive sign-in-claude": parseOfficeServerMessage,
  "drive-policy": parseOfficeServerMessage,
  "driven started": parseDataLayerMessage,
  "driven turn-started": parseDataLayerMessage,
  "driven tool": parseDataLayerMessage,
  "driven reply": parseDataLayerMessage,
  "driven turn-ended": parseDataLayerMessage,
  "driven error": parseDataLayerMessage,
  "driven output": parseDataLayerMessage,
  "driven prompt": parseDataLayerMessage,
  "driven prompt-ended": parseDataLayerMessage,
  "driven held": parseDataLayerMessage,
  "driven released": parseDataLayerMessage,
  "driven released removed": parseDataLayerMessage,
  "driven handed-back": parseDataLayerMessage,
  "driven refused": parseDataLayerMessage,
  "driven refused at the cap": parseDataLayerMessage,
  "driven refused unavailable": parseDataLayerMessage,
  "driven opened": parseDataLayerMessage,
  "driven holding": parseDataLayerMessage,
  "driven folders": parseDataLayerMessage,
  "driven folders with branches": parseDataLayerMessage,
  "driven claude installing": parseDataLayerMessage,
  "driven claude signing in": parseDataLayerMessage,
  "driven claude failed": parseDataLayerMessage,
} satisfies Record<keyof typeof valid, (value: unknown) => ParseResult<unknown>>;

// Each message with one field made wrong, and the path the error should name.
const broken: Record<keyof typeof valid, [unknown, string]> = {
  hello: [{ ...valid.hello, project: { id: "github.com/a/b" } }, "project.name"],
  runner: [{ ...valid.runner, machine: {} }, "machine.name"],
  "hello with a token": [{ ...valid["hello with a token"], token: "" }, "token"],
  "runner with a token": [{ ...valid["runner with a token"], token: 7 }, "token"],
  "runner with Orca": [{ ...valid["runner with Orca"], orca: "yes" }, "orca"],
  "runner with the Claude app": [{ ...valid["runner with the Claude app"], desktop: "yes" }, "desktop"],
  full: [{ ...valid.full, facts: { ...facts, agents: [{ ...lead, status: "busy" }] } }, "facts.agents[0].status"],
  changes: [{ ...valid.changes, seq: -1 }, "seq"],
  "reply answer-question": [{ ...valid["reply answer-question"], answer: "" }, "answer"],
  "reply write-brief": [{ ...valid["reply write-brief"], handoff: { ...handoff, repos: [] } }, "handoff.repos"],
  "reply write-brief fallback": [{ ...valid["reply write-brief fallback"], fallback: false }, "fallback"],
  "reply write-brief fallback without claude": [{ ...valid["reply write-brief fallback without claude"], noClaude: false }, "noClaude"],
  "reply owner-answer": [{ ...valid["reply owner-answer"], id: "" }, "id"],
  "reply focus": [{ ...valid["reply focus"], id: "" }, "id"],
  "reply owner-message": [{ ...valid["reply owner-message"], queued: "yes" }, "queued"],
  "refusal over-cap": [{ ...valid["refusal over-cap"], cap: "per-week" }, "cap"],
  "refusal withheld": [{ ...valid["refusal withheld"], reason: "secret" }, "reason"],
  "refusal withheld commit": [{ ...valid["refusal withheld commit"], file: "" }, "file"],
  "refusal unavailable": [{ ...valid["refusal unavailable"], detail: undefined }, "detail"],
  "refusal of an owner-message": [{ ...valid["refusal of an owner-message"], code: "gone" }, "code"],
  "hand-over": [{ ...valid["hand-over"], handoff: { ...handoff, id: "H 7" } }, "handoff.id"],
  "hand-over-check": [{ ...valid["hand-over-check"], handoff: "H 7" }, "handoff"],
  take: [{ ...valid.take, code: "" }, "code"],
  taken: [{ ...valid.taken, failures: [{ step: "push", output: "" }] }, "failures[0].step"],
  "taken by a runner": [{ ...valid["taken by a runner"], session: "" }, "session"],
  repair: [{ ...valid.repair, reason: 4 }, "reason"],
  welcome: [{ ...valid.welcome, projects: [""] }, "projects[0]"],
  conflict: [{ ...valid.conflict, file: undefined }, "file"],
  error: [{ ...valid.error, code: "" }, "code"],
  "request answer-question": [{ ...valid["request answer-question"], room: undefined }, "room"],
  "request write-brief": [{ ...valid["request write-brief"], to: { name: "Sam" } }, "to.id"],
  "request owner-answer": [{ ...valid["request owner-answer"], answers: { q: 1 } }, "answers.q"],
  "request focus": [{ ...valid["request focus"], handoff: "H7K2" }, "handoff"],
  "request owner-message": [{ ...valid["request owner-message"], from: { name: "Adam" } }, "from.id"],
  release: [{ ...valid.release, id: 3 }, "id"],
  handoff: [{ ...valid.handoff, handoff: { ...handoff, repos: [{ ...handoff.repos[0], commit: "0123abc" }] } }, "handoff.repos[0].commit"],
  "handed-over": [{ ...valid["handed-over"], to: { id: "", name: "Sam" } }, "to.id"],
  "hand-over-ready": [{ ...valid["hand-over-ready"], to: { name: "Sam" } }, "to.id"],
  drop: [{ ...valid.drop, id: "" }, "id"],
  "handoff to a runner": [{ ...valid["handoff to a runner"], mode: "window" }, "mode"],
  "handoff into Orca": [{ ...valid["handoff into Orca"], session: "s1" }, "session"],
  "handoff into the Claude app": [{ ...valid["handoff into the Claude app"], mode: "app" }, "mode"],
  "ask-room": [{ ...valid["ask-room"], question: "x".repeat(4001) }, "question"],
  "ask-room with a key": [{ ...valid["ask-room with a key"], key: "" }, "key"],
  "asked-ack": [{ ...valid["asked-ack"], question: "" }, "question"],
  "ask-rights": [{ ...valid["ask-rights"], granted: "yes" }, "granted"],
  "ask-check": [{ ...valid["ask-check"], question: "" }, "question"],
  asked: [{ ...valid.asked, state: "lost" }, "state"],
  "asked queued": [{ ...valid["asked queued"], note: "" }, "note"],
  "runner that drives sessions": [{ ...valid["runner that drives sessions"], drive: "yes" }, "drive"],
  "runner without Claude Code": [{ ...valid["runner without Claude Code"], claude: "none" }, "claude"],
  "runner with places to start in": [{ ...valid["runner with places to start in"], starts: ["driven"] }, "starts[0]"],
  "handoff as a driven session": [{ ...valid["handoff as a driven session"], room: undefined }, "room"],
  "drive start": [{ ...valid["drive start"], permissions: "default" }, "permissions"],
  "drive start in a folder": [{ ...valid["drive start in a folder"], folder: "" }, "folder"],
  "drive start on a branch": [{ ...valid["drive start on a branch"], branch: "" }, "branch"],
  "drive start in Orca": [{ ...valid["drive start in Orca"], instruction: undefined }, "instruction"],
  "drive instruct": [{ ...valid["drive instruct"], text: "x".repeat(MAX_INSTRUCTION_LENGTH + 1) }, "text"],
  "drive stop": [{ ...valid["drive stop"], by: undefined }, "by"],
  "drive hand-back": [{ ...valid["drive hand-back"], session: "" }, "session"],
  "drive stop and remove": [{ ...valid["drive stop and remove"], remove: false }, "remove"],
  "drive interrupt": [{ ...valid["drive interrupt"], session: undefined }, "session"],
  "drive output": [{ ...valid["drive output"], turn: "" }, "turn"],
  "drive answer": [{ ...valid["drive answer"], answer: "always" }, "answer"],
  "drive release": [{ ...valid["drive release"], withheld: "" }, "withheld"],
  "drive install-claude": [{ ...valid["drive install-claude"], by: undefined }, "by"],
  "drive sign-in-claude": [{ ...valid["drive sign-in-claude"], id: "" }, "id"],
  "drive-policy": [{ ...valid["drive-policy"], bypassAllowed: [""] }, "bypassAllowed[0]"],
  "driven started": [{ ...valid["driven started"], room: undefined }, "room"],
  "driven turn-started": [{ ...valid["driven turn-started"], turn: "x".repeat(MAX_DRIVE_ID_LENGTH + 1) }, "turn"],
  "driven tool": [{ ...valid["driven tool"], summary: "x".repeat(MAX_SUMMARY_LENGTH + 1) }, "summary"],
  "driven reply": [{ ...valid["driven reply"], text: "x".repeat(MAX_REPLY_LENGTH + 1) }, "text"],
  "driven turn-ended": [{ ...valid["driven turn-ended"], outcome: "cancelled" }, "outcome"],
  "driven error": [{ ...valid["driven error"], text: "" }, "text"],
  "driven output": [{ ...valid["driven output"], cut: false }, "cut"],
  "driven prompt": [{ ...valid["driven prompt"], expires: "in a minute" }, "expires"],
  "driven prompt-ended": [{ ...valid["driven prompt-ended"], outcome: "expired" }, "outcome"],
  "driven held": [{ ...valid["driven held"], why: "stopped" }, "why"],
  "driven released": [{ ...valid["driven released"], why: "restored" }, "why"],
  "driven released removed": [{ ...valid["driven released removed"], why: "deleted" }, "why"],
  "driven handed-back": [{ ...valid["driven handed-back"], command: undefined }, "command"],
  "driven refused": [{ ...valid["driven refused"], reason: "nope" }, "reason"],
  "driven refused at the cap": [{ ...valid["driven refused at the cap"], limit: 0 }, "limit"],
  "driven refused unavailable": [{ ...valid["driven refused unavailable"], detail: undefined }, "detail"],
  "driven opened": [{ ...valid["driven opened"], mode: "driven" }, "mode"],
  "driven holding": [{ ...valid["driven holding"], sessions: [{ ...valid["driven holding"].sessions[0], held: "yes" }] }, "sessions[0].held"],
  "driven folders": [{ ...valid["driven folders"], repos: [{ project: isoplan.id, folders: [] }] }, "repos[0].folders"],
  "driven folders with branches": [{ ...valid["driven folders with branches"], repos: [{ project: isoplan.id, folders: ["/Users/sam/code/isoplan"], branches: [""] }] }, "repos[0].branches"],
  "driven claude installing": [{ ...valid["driven claude installing"], doing: "updating" }, "doing"],
  "driven claude signing in": [{ ...valid["driven claude signing in"], url: "http://claude.ai/oauth/authorize" }, "url"],
  "driven claude failed": [{ ...valid["driven claude failed"], claude: "gone" }, "claude"],
};

describe.each(Object.keys(valid) as (keyof typeof valid)[])("%s", (type) => {
  const parse = parsers[type];

  test("parses when valid", () => {
    expect(parse(valid[type])).toEqual({ ok: true, message: valid[type] });
  });

  test("rejects an invalid message, naming the field", () => {
    const [message, path] = broken[type];
    const result = parse(message);
    expect(result).toMatchObject({ ok: false, kind: "invalid" });
    expect(!result.ok && result.error).toContain(path);
  });

  test.each([v - 1, v + 1])("rejects protocol version %i as unsupported", (other) => {
    const result = parse({ ...valid[type], v: other });
    expect(result).toEqual({
      ok: false,
      kind: "unsupported-version",
      error: `protocol version ${other} is not supported; this side speaks version ${v}`,
    });
  });
});

test("a version that isn't a number is invalid, not unsupported", () => {
  expect(parseDataLayerMessage({ ...valid.hello, v: String(v) })).toMatchObject({ ok: false, kind: "invalid" });
});

test("each side refuses the other side's messages", () => {
  for (const type of Object.keys(valid) as (keyof typeof valid)[]) {
    const other = parsers[type] === parseDataLayerMessage ? parseOfficeServerMessage : parseDataLayerMessage;
    expect(other(valid[type])).toMatchObject({ ok: false, kind: "invalid" });
  }
});

test("a reply or request of a kind the channel doesn't have is invalid, naming the kind", () => {
  for (const message of [
    { ...valid["reply owner-answer"], kind: "approve" },
    { ...valid["request owner-answer"], kind: "approve" },
  ]) {
    const result = message.type === "reply" ? parseDataLayerMessage(message) : parseOfficeServerMessage(message);
    expect(result).toMatchObject({ ok: false, kind: "invalid" });
    expect(!result.ok && result.error).toContain("kind");
  }
});

test("facts from a data layer that doesn't report questions still parse", () => {
  const { questions: _, ...older } = facts;
  expect(parseDataLayerMessage({ ...valid.full, facts: older })).toEqual({ ok: true, message: { ...valid.full, facts: older } });
});

test("a session's context window parses as a whole number of tokens, and not as none or a fraction", () => {
  const sized = { ...facts, session: { ...facts.session, contextWindow: 1000000 } };
  expect(parseDataLayerMessage({ ...valid.full, facts: sized })).toEqual({ ok: true, message: { ...valid.full, facts: sized } });
  for (const contextWindow of [0, 200000.5]) expect(parseDataLayerMessage({ ...valid.full, facts: { ...facts, session: { ...facts.session, contextWindow } } })).toMatchObject({ ok: false, kind: "invalid" });
});

test("a session that takes messages from the floor says so with true, and never with false", () => {
  const takes = { ...facts, session: { ...facts.session, takesMessages: true } };
  expect(parseDataLayerMessage({ ...valid.full, facts: takes })).toEqual({ ok: true, message: { ...valid.full, facts: takes } });
  expect(parseDataLayerMessage({ ...valid.full, facts: { ...facts, session: { ...facts.session, takesMessages: false } } })).toMatchObject({ ok: false, kind: "invalid" });
});

test("an owner-message has a text of 1 to MAX_OWNER_MESSAGE_LENGTH characters once trimmed; its refusal names only a known code", () => {
  const request = valid["request owner-message"];
  expect(parseOfficeServerMessage({ ...request, text: "x".repeat(MAX_OWNER_MESSAGE_LENGTH) })).toMatchObject({ ok: true });
  for (const text of ["   ", "x".repeat(MAX_OWNER_MESSAGE_LENGTH + 1)]) expect(parseOfficeServerMessage({ ...request, text })).toMatchObject({ ok: false, kind: "invalid" });
  expect(parseDataLayerMessage({ ...valid["reply owner-message"], queued: false })).toMatchObject({ ok: false, kind: "invalid" });
  expect(parseDataLayerMessage({ ...valid["refusal of an owner-message"], code: "busy" })).toMatchObject({ ok: false, kind: "invalid" });
});

test("a spin-off's task is 1 to MAX_TASK_LENGTH characters once trimmed, on its handoff, its check and the floor's write-brief", () => {
  const task = "Write the docs pages for session management.";
  const messages = [
    [parseDataLayerMessage, { ...valid["hand-over"], handoff: { ...handoff, task } }, (t: string) => ({ ...valid["hand-over"], handoff: { ...handoff, task: t } })],
    [parseDataLayerMessage, { ...valid["hand-over-check"], task }, (t: string) => ({ ...valid["hand-over-check"], task: t })],
    [parseOfficeServerMessage, { ...valid["request write-brief"], task }, (t: string) => ({ ...valid["request write-brief"], task: t })],
    [parseOfficeServerMessage, { ...valid.handoff, handoff: { ...handoff, task } }, (t: string) => ({ ...valid.handoff, handoff: { ...handoff, task: t } })],
  ] as const;
  for (const [parse, message, withTask] of messages) {
    expect(parse(message)).toEqual({ ok: true, message });
    expect(parse(withTask("x".repeat(MAX_TASK_LENGTH)))).toMatchObject({ ok: true });
    for (const t of ["   ", "x".repeat(MAX_TASK_LENGTH + 1)]) expect(parse(withTask(t))).toMatchObject({ ok: false, kind: "invalid" });
  }
});

test("a withheld report parses with its hold id, and not without one", () => {
  const report = { agent: worker.id, at, text: "Held for its owner to check.", withheld: { id: "h-1" } };
  expect(parseDataLayerMessage({ ...valid.full, facts: { ...facts, reports: [report] } })).toMatchObject({ ok: true });
  expect(parseDataLayerMessage({ ...valid.full, facts: { ...facts, reports: [{ ...report, withheld: true }] } })).toMatchObject({ ok: false, kind: "invalid" });
  expect(parseDataLayerMessage({ ...valid.full, facts: { ...facts, reports: [{ ...report, withheld: { id: "" } }] } })).toMatchObject({ ok: false, kind: "invalid" });
});

test("an owner-answer reply parses with closed or late, and not with either false", () => {
  expect(parseDataLayerMessage({ ...valid["reply owner-answer"], closed: true })).toMatchObject({ ok: true });
  expect(parseDataLayerMessage({ ...valid["reply owner-answer"], late: true })).toMatchObject({ ok: true });
  expect(parseDataLayerMessage({ ...valid["reply owner-answer"], late: false })).toMatchObject({ ok: false, kind: "invalid" });
});

test("a fallback brief parses with the cap that caused it, and not with a cap of another name", () => {
  expect(parseDataLayerMessage({ ...valid["reply write-brief fallback"], cap: "room-hour" })).toMatchObject({ ok: true });
  expect(parseDataLayerMessage({ ...valid["reply write-brief fallback"], cap: "per-week" })).toMatchObject({ ok: false, kind: "invalid" });
});

test("a taken message parses with a failed clone of a repo under the folder", () => {
  const taken = { ...valid.taken, failures: [{ step: "clone", repo: "libs/core", output: "fatal: repository not found" }] };
  expect(parseDataLayerMessage(taken)).toEqual({ ok: true, message: taken });
});

test("a withheld commit's refusal parses with how many files it held, and not with none", () => {
  const refusal = { ...valid["refusal withheld commit"], file: "config/a, b.ts, config/c.ts", held: 2 };
  expect(parseDataLayerMessage(refusal)).toEqual({ ok: true, message: refusal });
  expect(parseDataLayerMessage({ ...refusal, held: 0 })).toMatchObject({ ok: false, kind: "invalid" });
  expect(parseDataLayerMessage({ ...refusal, held: 1.5 })).toMatchObject({ ok: false, kind: "invalid" });
});

test("a question parses with answerable or withheld, and not with either false", () => {
  const [question] = facts.questions!;
  expect(parseDataLayerMessage({ ...valid.full, facts: { ...facts, questions: [{ ...question, answerable: true }] } })).toMatchObject({ ok: true });
  expect(parseDataLayerMessage({ ...valid.full, facts: { ...facts, questions: [{ ...question, withheld: true }] } })).toMatchObject({ ok: true });
  expect(parseDataLayerMessage({ ...valid.full, facts: { ...facts, questions: [{ ...question, withheld: false }] } })).toMatchObject({ ok: false, kind: "invalid" });
  expect(parseDataLayerMessage({ ...valid.full, facts: { ...facts, questions: [{ ...question, answerable: false }] } })).toMatchObject({ ok: false, kind: "invalid" });
});

test("a question parses with asMessage, and not with asMessage false", () => {
  const [question] = facts.questions!;
  expect(parseDataLayerMessage({ ...valid.full, facts: { ...facts, questions: [{ ...question, asMessage: true }] } })).toMatchObject({ ok: true });
  expect(parseDataLayerMessage({ ...valid.full, facts: { ...facts, questions: [{ ...question, asMessage: false }] } })).toMatchObject({ ok: false, kind: "invalid" });
});

test("a question's option keeps its preview", () => {
  const question = facts.questions![0]!;
  const first = question.questions[0]!;
  const withPreview = { ...question, questions: [{ ...first, options: first.options.map((option) => ({ ...option, preview: "```ts\nconst a = 1;\n```" })) }] };
  const message = { ...valid.full, facts: { ...facts, questions: [withPreview] } };
  expect(parseDataLayerMessage(message)).toEqual({ ok: true, message });
});

test("a session parses with hooks, and not with hooks false", () => {
  expect(parseDataLayerMessage({ ...valid.full, facts: { ...facts, session: { ...facts.session, hooks: true } } })).toMatchObject({ ok: true });
  expect(parseDataLayerMessage({ ...valid.full, facts: { ...facts, session: { ...facts.session, hooks: false } } })).toMatchObject({ ok: false, kind: "invalid" });
});

test("an owner-answer request keeps the owner's notes and the chosen option's preview", () => {
  const request = { ...valid["request owner-answer"], annotations: { "Which one?": { notes: "Keep it short.", preview: "A" }, "And this?": {} } };
  expect(parseOfficeServerMessage(request)).toEqual({ ok: true, message: request });
  expect(parseOfficeServerMessage({ ...request, annotations: { "Which one?": { notes: 1 } } })).toMatchObject({ ok: false, kind: "invalid" });
  expect(parseOfficeServerMessage({ ...valid["request owner-answer"], answers: {}, chat: true })).toMatchObject({ ok: true });
  expect(parseOfficeServerMessage({ ...valid["request owner-answer"], chat: false })).toMatchObject({ ok: false, kind: "invalid" });
});

test("an edit, a read or a command in another repo carries that repo, and whether it is away from home", () => {
  const frontend = { id: "github.com/team/frontend", name: "frontend" };
  const edit = { agent: worker.id, file: "src/api.ts", at, project: frontend, away: true };
  const doing = { kind: "run" as const, since: at, project: frontend, away: true };
  const away = { ...facts, agents: [lead, { ...worker, doing }], edits: [edit], reads: [{ ...edit, away: undefined }] };
  expect(parseDataLayerMessage({ ...valid.full, facts: away })).toEqual({ ok: true, message: { ...valid.full, facts: away } });
  expect(parseDataLayerMessage({ ...valid.full, facts: { ...facts, edits: [{ ...edit, project: { id: "", name: "x" } }] } })).toMatchObject({ ok: false, kind: "invalid" });
});

describe("workflows", () => {
  const workflow: WorkflowFact = {
    id: "wf_66acbd07-57e",
    session: "claude-code:s1",
    startedBy: lead.id,
    name: "build-review-merge",
    description: "Build, review and merge each ticket",
    phases: [{ title: "Build", detail: "one worktree per ticket" }, { title: "Review" }],
    status: "done",
    startedAt: at,
    endedAt: at,
    usage: { tokens: 1599101 },
  };
  const agent = { ...worker, id: "claude-code:a22a39ec5a8fa4a41", workflow: { id: workflow.id, phase: "Build", label: "build app-172" } };
  const withWorkflow = (w: unknown, a: unknown = agent) => ({ ...valid.full, facts: { ...facts, agents: [lead, a], workflows: [w] } });

  test("a workflow and its agents parse, and a running one needs no end or usage", () => {
    expect(parseDataLayerMessage(withWorkflow(workflow))).toEqual({ ok: true, message: withWorkflow(workflow) });
    const { endedAt: _e, usage: _u, description: _d, ...running } = workflow;
    expect(parseDataLayerMessage(withWorkflow({ ...running, status: "running", moreAgents: 3 }))).toMatchObject({ ok: true });
    expect(parseDataLayerMessage(withWorkflow({ ...workflow, status: "paused" }))).toMatchObject({ ok: false, kind: "invalid" });
    expect(parseDataLayerMessage(withWorkflow({ ...workflow, moreAgents: 0 }))).toMatchObject({ ok: false, kind: "invalid" });
  });

  test("changes carry workflows, and remove them by id", () => {
    const message = { ...valid.changes, upsert: { workflows: [workflow] }, remove: { workflows: ["wf_0"] } };
    expect(parseDataLayerMessage(message)).toEqual({ ok: true, message });
  });

  const long = (length: number) => "x".repeat(length);
  test.each([
    ["a name", (n: number) => withWorkflow({ ...workflow, name: long(n) }), MAX_WORKFLOW_NAME_LENGTH],
    ["a description", (n: number) => withWorkflow({ ...workflow, description: long(n) }), MAX_WORKFLOW_DESCRIPTION_LENGTH],
    ["the phases", (n: number) => withWorkflow({ ...workflow, phases: Array.from({ length: n }, () => ({ title: "P" })) }), MAX_WORKFLOW_PHASES],
    ["a phase title", (n: number) => withWorkflow({ ...workflow, phases: [{ title: long(n) }] }), MAX_WORKFLOW_PHASE_TITLE_LENGTH],
    ["a phase detail", (n: number) => withWorkflow({ ...workflow, phases: [{ title: "P", detail: long(n) }] }), MAX_WORKFLOW_PHASE_DETAIL_LENGTH],
    ["an agent's label", (n: number) => withWorkflow(workflow, { ...agent, workflow: { ...agent.workflow, label: long(n) } }), MAX_WORKFLOW_LABEL_LENGTH],
    ["an agent's phase", (n: number) => withWorkflow(workflow, { ...agent, workflow: { ...agent.workflow, phase: long(n) } }), MAX_WORKFLOW_PHASE_TITLE_LENGTH],
  ] as const)("%s at its limit parses, and one past it doesn't", (_, make, limit) => {
    expect(parseDataLayerMessage(make(limit))).toMatchObject({ ok: true });
    expect(parseDataLayerMessage(make(limit + 1))).toMatchObject({ ok: false, kind: "invalid" });
  });
});

describe("handoff", () => {
  const [repo] = handoff.repos;
  const withRepo = (change: object) => ({ ...valid.handoff, handoff: { ...handoff, repos: [{ ...repo, ...change }] } });

  test.each([
    ["an absolute POSIX path", withRepo({ path: "/home/sam/repo" }), "handoff.repos[0].path"],
    ["a Windows drive path", withRepo({ path: "C:\\work\\repo" }), "handoff.repos[0].path"],
    ["a drive-relative path", withRepo({ path: "C:repo" }), "handoff.repos[0].path"],
    ["a UNC path", withRepo({ path: "\\\\server\\share\\repo" }), "handoff.repos[0].path"],
    ["a path with ..", withRepo({ path: "libs/../../outside" }), "handoff.repos[0].path"],
    ["a path with .. and backslashes", withRepo({ path: "libs\\..\\.." }), "handoff.repos[0].path"],
    ["a path that starts with -", withRepo({ path: "--upload-pack=touch pwned" }), "handoff.repos[0].path"],
    ["a remote that starts with -", withRepo({ remote: "--upload-pack=touch pwned" }), "handoff.repos[0].remote"],
    ["an ext:: remote", withRepo({ remote: "ext::sh -c touch% /tmp/pwned" }), "handoff.repos[0].remote"],
    ["another transport helper", withRepo({ remote: "fd::17" }), "handoff.repos[0].remote"],
    ["a branch that isn't the handoff's", withRepo({ branch: "main" }), "handoff.repos[0].branch"],
    ["another handoff's branch", withRepo({ branch: "isoplan/handoff/other" }), "handoff.repos[0].branch"],
    ["a repo's own branch with no slug", withRepo({ branch: "isoplan/handoff/h7k2--" }), "handoff.repos[0].branch"],
    ["a repo's own branch with capitals", withRepo({ branch: "isoplan/handoff/h7k2--Api" }), "handoff.repos[0].branch"],
    ["a path into .git", withRepo({ path: "libs/.git/hooks" }), "handoff.repos[0].path"],
    ["a path into .git as Windows also reads it", withRepo({ path: "libs/.GIT. /hooks" }), "handoff.repos[0].path"],
    ["a path into .git by its short name", withRepo({ path: "libs\\GIT~1\\hooks" }), "handoff.repos[0].path"],
    ["a path into .git by an NTFS stream", withRepo({ path: ".git::$INDEX_ALLOCATION/hooks" }), "handoff.repos[0].path"],
    ["a path with a colon in a folder", withRepo({ path: "libs/core:stream" }), "handoff.repos[0].path"],
    ["a path through .", withRepo({ path: "libs/./core" }), "handoff.repos[0].path"],
    ["a path that starts with ./", withRepo({ path: "./core" }), "handoff.repos[0].path"],
    ["a path that ends with /.", withRepo({ path: "libs/." }), "handoff.repos[0].path"],
    ["a path with an empty part", withRepo({ path: "libs//core" }), "handoff.repos[0].path"],
    ["an id over 64 characters", { ...valid.handoff, handoff: { ...handoff, id: "a".repeat(65) } }, "handoff.id"],
    ["a short commit hash", withRepo({ commit: "0123456" }), "handoff.repos[0].commit"],
  ])("refuses %s", (_, message, path) => {
    const result = parseOfficeServerMessage(message);
    expect(result).toMatchObject({ ok: false, kind: "invalid" });
    expect(!result.ok && result.error).toContain(path);
  });

  test.each([
    ["the folder itself", { path: "." }],
    ["a path with a dash inside it", { path: "libs/my-core" }],
    ["a remote with a dash inside it", { remote: "https://github.com/isoplan-app/isoplan-plugin.git" }],
    ["a scp-style remote", { remote: "git@github.com:isoplan-app/isoplan.git" }],
    ["an ssh remote", { remote: "ssh://git@github.com/isoplan-app/isoplan.git" }],
    ["an https remote", { remote: "https://github.com/isoplan-app/isoplan.git" }],
    ["a file remote", { remote: "file:///C:/remotes/isoplan.git" }],
    ["a local bare remote", { remote: "C:\\remotes\\isoplan.git" }],
    ["a SHA-256 commit", { commit: "0123456789abcdef".repeat(4) }],
    ["a repo's own branch, for repos sharing a remote", { branch: "isoplan/handoff/h7k2--libs-core" }],
    ["a folder whose name starts with .git", { path: "libs/.github-actions" }],
  ])("accepts %s", (_, change) => {
    const message = withRepo(change);
    expect(parseOfficeServerMessage(message)).toEqual({ ok: true, message });
  });
});

describe("changes", () => {
  test("carries upserted records and the keys of removed ones", () => {
    const message = {
      ...valid.changes,
      upsert: { session: facts.session, agents: [worker], edits: facts.edits, reports: facts.reports, questions: facts.questions },
      remove: {
        agents: ["claude-code:w0"],
        edits: [{ agent: lead.id, file: "src/old.ts" }],
        reads: [{ agent: worker.id, file: "src/b.ts" }],
        waits: [{ waiter: lead.id, on: worker.id }],
        reports: ["claude-code:w0"],
        questions: ["toolu_00"],
      },
    };
    expect(parseDataLayerMessage(message)).toEqual({ ok: true, message });
  });

  test("says how each removed question ended, answered or abandoned, and nothing else", () => {
    const message = { ...valid.changes, remove: { questions: ["toolu_00", "toolu_01"], questionOutcomes: { toolu_00: "answered", toolu_01: "abandoned" } } };
    expect(parseDataLayerMessage(message)).toEqual({ ok: true, message });
    expect(parseDataLayerMessage({ ...message, remove: { questions: ["toolu_00"], questionOutcomes: { toolu_00: "timed-out" } } })).toMatchObject({ ok: false, kind: "invalid" });
  });

  test("rejects a removal key with a part missing", () => {
    const result = parseDataLayerMessage({ ...valid.changes, remove: { waits: [{ waiter: lead.id }] } });
    expect(result).toMatchObject({ ok: false, kind: "invalid" });
    expect(!result.ok && result.error).toContain("remove.waits[0].on");
  });
});

describe("driven sessions", () => {
  const long = (length: number) => "x".repeat(length);
  const sessions = (count: number) => Array.from({ length: count }, (_, i) => `claude-code:s${i}`);
  test.each([
    ["a cut reply", parseDataLayerMessage, (n: number) => ({ ...valid["driven reply"], text: long(n), cut: true }), MAX_REPLY_LENGTH, "text"],
    ["a cut output", parseDataLayerMessage, (n: number) => ({ ...valid["driven output"], text: long(n), cut: true }), MAX_OUTPUT_LENGTH, "text"],
    ["a prompt's description", parseDataLayerMessage, (n: number) => ({ ...valid["driven prompt"], description: long(n) }), MAX_PROMPT_LENGTH, "description"],
    ["a refusal's detail", parseDataLayerMessage, (n: number) => ({ ...valid["driven refused"], detail: long(n) }), MAX_DETAIL_LENGTH, "detail"],
    ["a tool's name", parseDataLayerMessage, (n: number) => ({ ...valid["driven tool"], tool: `mcp__${long(n - 5)}` }), MAX_TOOL_NAME_LENGTH, "tool"],
    ["a start's room sessions", parseOfficeServerMessage, (n: number) => ({ ...valid["drive start"], roomSessions: sessions(n) }), MAX_ROOM_SESSIONS, "roomSessions"],
    ["a start's folder", parseOfficeServerMessage, (n: number) => ({ ...valid["drive start in a folder"], folder: long(n) }), MAX_FOLDER_LENGTH, "folder"],
    ["the folders listed for a repo", parseDataLayerMessage, (n: number) => ({ ...valid["driven folders"], repos: [{ project: isoplan.id, folders: Array.from({ length: n }, (_, i) => `/Users/sam/code/isoplan-${i}`) }] }), MAX_REPO_FOLDERS, "folders"],
    ["a folder listed", parseDataLayerMessage, (n: number) => ({ ...valid["driven folders"], repos: [{ project: isoplan.id, folders: [long(n)] }] }), MAX_FOLDER_LENGTH, "folders"],
    ["the repos folders are listed for", parseDataLayerMessage, (n: number) => ({ ...valid["driven folders"], repos: Array.from({ length: n }, (_, i) => ({ project: `github.com/sam/repo-${i}`, folders: ["/Users/sam/code/x"] })) }), MAX_FOLDER_REPOS, "repos"],
    ["the branches listed for a repo", parseDataLayerMessage, (n: number) => ({ ...valid["driven folders with branches"], repos: [{ project: isoplan.id, folders: ["/Users/sam/code/isoplan"], branches: Array.from({ length: n }, (_, i) => `feat/${i}`) }] }), MAX_REPO_BRANCHES, "branches"],
    ["a branch listed", parseDataLayerMessage, (n: number) => ({ ...valid["driven folders with branches"], repos: [{ project: isoplan.id, folders: ["/Users/sam/code/isoplan"], branches: [long(n)] }] }), MAX_BRANCH_LENGTH, "branches"],
    ["a start's branch", parseOfficeServerMessage, (n: number) => ({ ...valid["drive start on a branch"], branch: long(n) }), MAX_BRANCH_LENGTH, "branch"],
    ["the sessions a runner holds", parseDataLayerMessage, (n: number) => ({ ...valid["driven holding"], sessions: sessions(n).map((session) => ({ ...valid["driven holding"].sessions[0], session })) }), MAX_HOLDING, "sessions"],
  ] as const)("%s at its limit parses, and one past it doesn't", (_, parse, make, limit, path) => {
    expect(parse(make(limit))).toEqual({ ok: true, message: make(limit) });
    const result = parse(make(limit + 1));
    expect(result).toMatchObject({ ok: false, kind: "invalid" });
    expect(!result.ok && result.error).toContain(path);
  });

  test("a withheld reply carries the id to release it by, and not an empty one", () => {
    const withheld = { ...valid["driven reply"], text: "Withheld here: it matches a secret pattern.", withheld: { id: "w1" } };
    expect(parseDataLayerMessage(withheld)).toEqual({ ok: true, message: withheld });
    expect(parseDataLayerMessage({ ...withheld, withheld: { id: "" } })).toMatchObject({ ok: false, kind: "invalid" });
  });

  test("an output with nothing in it parses, and an empty reply doesn't", () => {
    const output = { ...valid["driven output"], text: "" };
    expect(parseDataLayerMessage(output)).toEqual({ ok: true, message: output });
    expect(parseDataLayerMessage({ ...valid["driven reply"], text: "" })).toMatchObject({ ok: false, kind: "invalid" });
  });

  test("a tool summary or prompt the scan matched is marked withheld, and not with false", () => {
    const { summary: _, ...tool } = { ...valid["driven tool"], withheld: true as const };
    const prompt = { ...valid["driven prompt"], description: "Withheld here: it matches a secret pattern.", withheld: true };
    for (const message of [tool, prompt]) expect(parseDataLayerMessage(message)).toEqual({ ok: true, message });
    expect(parseDataLayerMessage({ ...prompt, withheld: false })).toMatchObject({ ok: false, kind: "invalid" });
  });

  test("a tool use the scan matched carries no summary", () => {
    const result = parseDataLayerMessage({ ...valid["driven tool"], withheld: true });
    expect(result).toMatchObject({ ok: false, kind: "invalid" });
    expect(!result.ok && result.error).toContain("summary");
  });

  test("an instruction is trimmed, and one of only spaces is invalid", () => {
    expect(parseOfficeServerMessage({ ...valid["drive start"], instruction: "  Fix it.\n" })).toMatchObject({ ok: true, message: { instruction: "Fix it." } });
    const { instruction: _, ...start } = valid["drive start"];
    expect(parseOfficeServerMessage(start)).toEqual({ ok: true, message: start });
    expect(parseOfficeServerMessage({ ...valid["drive instruct"], text: " \n " })).toMatchObject({ ok: false, kind: "invalid" });
  });

  test.each(["session", "by", "room", "permissions"])("a take as a driven session needs its %s", (key) => {
    const result = parseOfficeServerMessage({ ...valid["handoff as a driven session"], [key]: undefined });
    expect(result).toMatchObject({ ok: false, kind: "invalid" });
    expect(!result.ok && result.error).toContain(key);
  });

  test.each(["not-owner", "not-found", "bypass-off", "no-folder", "no-claude", "busy", "no-prompt"])("a drive request can be refused %s", (reason) => {
    const message = { ...valid["driven refused"], reason, detail: "In plain words." };
    expect(parseDataLayerMessage(message)).toEqual({ ok: true, message });
  });

  test("a runner can't refuse offline, which only the server says", () => {
    const offline: FloorDriveRefusalReason = "offline";
    const result = parseDataLayerMessage({ ...valid["driven refused"], reason: offline });
    expect(result).toMatchObject({ ok: false, kind: "invalid" });
    expect(!result.ok && result.error).toContain("reason");
  });

  test("only a refusal at the cap names its limit, and it must", () => {
    expect(parseDataLayerMessage({ ...valid["driven refused at the cap"], limit: undefined })).toMatchObject({ ok: false, kind: "invalid" });
    expect(parseDataLayerMessage({ ...valid["driven refused"], limit: 4 })).toEqual({ ok: true, message: valid["driven refused"] });
  });

  test("a start names a room or a folder, a start in a folder names no room or room sessions, and only a start in a folder names a branch", () => {
    const { room: _, ...noRoom } = valid["drive start"];
    for (const [message, path] of [
      [noRoom, "room"],
      [{ ...valid["drive start in a folder"], room }, "room"],
      [{ ...valid["drive start in a folder"], roomSessions: ["claude-code:s1"] }, "roomSessions"],
      [{ ...valid["drive start"], branch: "main" }, "branch"],
    ] as const) {
      const result = parseOfficeServerMessage(message);
      expect(result).toMatchObject({ ok: false, kind: "invalid" });
      expect(!result.ok && result.error).toContain(path);
    }
  });

  test("a start that opens outside the floor names a folder and its first instruction; a driven one needn't", () => {
    for (const [message, path] of [
      [{ ...valid["drive start"], mode: "terminal" }, "folder"],
      [{ ...valid["drive start on a branch"], mode: "headless" }, "instruction"],
    ] as const) {
      const result = parseOfficeServerMessage(message);
      expect(result).toMatchObject({ ok: false, kind: "invalid" });
      expect(!result.ok && result.error).toContain(path);
    }
    for (const message of [{ ...valid["drive start"], mode: "driven" }, { ...valid["drive start on a branch"], mode: "driven" }]) expect(parseOfficeServerMessage(message)).toEqual({ ok: true, message });
  });

  test("a start in a Windows folder keeps its backslashes", () => {
    const result = parseOfficeServerMessage(valid["drive start in a folder"]);
    expect(result.ok && result.message.type === "drive" && result.message.kind === "start" && result.message.folder).toBe(String.raw`C:\Users\adam\isoplan`);
  });

  test("an older runner's folders, with no branches, and a remote with no branches, parse", () => {
    expect(parseDataLayerMessage(valid["driven folders"])).toEqual({ ok: true, message: valid["driven folders"] });
    const none = { ...valid["driven folders"], repos: [{ project: isoplan.id, folders: ["/Users/sam/code/isoplan"], branches: [] }] };
    expect(parseDataLayerMessage(none)).toEqual({ ok: true, message: none });
  });

  test("a runner with no folder for any repo says so with an empty list", () => {
    const message = { ...valid["driven folders"], repos: [] };
    expect(parseDataLayerMessage(message)).toEqual({ ok: true, message });
  });

  test("a policy that allows skipping nowhere, and a runner holding no sessions, parse", () => {
    for (const [message, parse] of [
      [{ ...valid["drive-policy"], bypassAllowed: [] }, parseOfficeServerMessage],
      [{ ...valid["driven holding"], sessions: [] }, parseDataLayerMessage],
    ] as const)
      expect(parse(message)).toEqual({ ok: true, message });
  });

  test("a policy lists a project whatever the length of its id", () => {
    const message = { ...valid["drive-policy"], bypassAllowed: [`local:sevengill/c:/users/sam/${long(5000)}`] };
    expect(parseOfficeServerMessage(message)).toEqual({ ok: true, message });
  });

  test("a drive or driven message of a kind the channel doesn't have is invalid, naming the kind", () => {
    for (const result of [parseOfficeServerMessage({ ...valid["drive stop"], kind: "pause" }), parseDataLayerMessage({ ...valid["driven turn-started"], kind: "paused" })]) {
      expect(result).toMatchObject({ ok: false, kind: "invalid" });
      expect(!result.ok && result.error).toContain("kind");
    }
  });
});
