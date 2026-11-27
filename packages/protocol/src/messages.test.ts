import { describe, expect, test } from "vitest";
import {
  arrivalEntryId,
  employeeDisplayName,
  expertDisplayName,
  MAX_AREA_PATH_LENGTH,
  MAX_AREA_PATHS,
  MAX_BRANCH_LENGTH,
  MAX_CORRECTION_LENGTH,
  MAX_DETAIL_LENGTH,
  MAX_DRAFT_LENGTH,
  MAX_DRAFT_RECIPIENT_NAME_LENGTH,
  MAX_DRAFT_SUBJECT_LENGTH,
  MAX_DRAFTS_PER_RUN,
  MAX_DRIVE_ID_LENGTH,
  MAX_EXPERT_ANSWER_LENGTH,
  MAX_EXPERT_RECORDS,
  MAX_EXPERT_SUBJECT_LENGTH,
  MAX_EXPERTS,
  MAX_FILES_WHAT_WAS_LEARNED_RESTS_ON,
  MAX_FOLDER_LENGTH,
  MAX_FOLDER_REPOS,
  MAX_HOLDING,
  MAX_INSTRUCTION_LENGTH,
  MAX_EXPERT_CREATION_SUGGESTION_DISMISSALS,
  MAX_EXPERT_CREATION_SUGGESTION_SESSIONS,
  MAX_OWNER_MESSAGE_LENGTH,
  MAX_OUTPUT_LENGTH,
  MAX_PROMPT_LENGTH,
  MAX_QUESTION_LENGTH,
  MAX_REPLY_LENGTH,
  MAX_REPORT_LENGTH,
  MAX_REPO_BRANCHES,
  MAX_REPO_FOLDERS,
  MAX_ROOM_SESSIONS,
  MAX_SUMMARY_LENGTH,
  MAX_TASK_LENGTH,
  MAX_TOOL_NAME_LENGTH,
  MAX_WHAT_WAS_LEARNED_ENTRIES_PER_MESSAGE,
  MAX_WHAT_WAS_LEARNED_LENGTH,
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
  type WhatWasLearnedEntry,
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
const commit = "0123456789abcdef0123456789abcdef01234567";
const expertRecordId = "3f1c9a2e-5b7d-4e8f-9a0b-1c2d3e4f5a6b";
const pairingRecordId = "9b8e7d6c-1a2b-4c3d-8e9f-0a1b2c3d4e5f";
const expertDefinition = {
  key: "adr-0004",
  project: isoplan,
  subject: "What session text may leave a machine (ADR 0004). Ask before you send data off one.",
  model: "sonnet",
  promoteAtTokens: 150000,
  areas: ["docs/adr", "CONTEXT.md"],
  proof: { question: "May a session's title leave the machine?", answer: "Yes: the title is a fact." },
};
const expertInstance = { key: "adr-0004", expertRecordId, state: "ready", senior: true, groundingTokens: 42000 };
const expertDirectoryEntry = { key: "adr-0004", expertRecordId, project: isoplan, owner: adam, yours: true, revision: 2, groundingTokens: 42000 };
const asking = { openPerPersonPerExpert: 3, perPersonPerDay: 30, maxAgeHours: 72 };
const learnedId = "6a1f0c2e-8b3d-4f5a-9c7e-2d4b6f8a0c1e";
const removedId = "b2c4d6e8-0a1b-4c3d-9e5f-7a8b9c0d1e2f";
const chain = "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08";
const thingLearned = {
  id: learnedId,
  text: "A session's title is a fact, so it may leave the computer; its messages never do.",
  files: [{ path: "docs/adr/0004-what-leaves-a-machine.md", commit }, { path: "CONTEXT.md" }],
  learnedAt: at,
};
const learnedEntries: WhatWasLearnedEntry[] = [
  { kind: "learned", arrivalNumber: 4, ...thingLearned },
  { kind: "learned-then-removed", arrivalNumber: 5, id: removedId },
  { kind: "removed", arrivalNumber: 6, id: removedId, at },
];
const expertCreationSuggestion = {
  type: "expert-creation-suggestion",
  v,
  id: "o-4f9c2a",
  session: "claude-code:s1",
  project: isoplan,
  folder: "packages/server/src/pairing",
  scope: "session",
  key: "pairing",
  subject: "How a machine pairs with an office, and its tokens. Ask before you change pairing.",
  area: ["packages/server/src/pairing"],
  proof: { question: "Where is a pairing token checked?", answer: "In pairing.ts, on every hello." },
  why: { share: 0.18, tokens: 36000, minutes: 12.5, corrections: 1 },
  at,
};
const createExpertFromSuggestion = { type: "create-expert-from-suggestion", v, request: "make-x-0123456789", expertCreationSuggestionId: "o-4f9c2a", key: "pairing-tokens", subject: expertCreationSuggestion.subject, model: "sonnet", project: isoplan, area: ["packages/server/src/pairing", "docs/adr/0004-*.md"], proof: expertCreationSuggestion.proof, by: sam };
const area = { folder: "packages/server/src/pairing", reads: 14, searches: 9, tokens: 36000, ms: 750000, corrections: 1 };
const docs = { id: "github.com/isoplan-app/isoplan-docs", name: "isoplan-docs" };
const outreachRecordId = "5d2e8f1a-3c4b-4a6d-9e7f-1b2c3d4e5f60";
const run = "8c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f";
const stoppedRun = "d4e6f8a0-2b3c-4d5e-af60-7b8c9d0e1f2a";
const draftId = "2e4f6a8c-0b1d-4e3f-8a5b-7c9d1e3f5a7b";
const otherDraftId = "a1b3c5d7-e9f0-4a2b-8c4d-6e8f0a2b4c6d";
const offerId = "offer-7k2m9q";
const job = {
  brief: "Each run, find agencies that qualify and draft one email to one person at each.",
  rules: ["One email per agency.", "Never guess what tools they use."],
  documents: ["outreach/who-qualifies.md"],
  examples: ["outreach/approved"],
  schedule: { every: "weekday", at: "09:00" },
  missedRunWindowMinutes: 720,
  tools: ["Read", "Grep", "Glob", "Agent", "WebSearch", "WebFetch"],
  experts: ["adams-writing", "lead-generation"],
  draftsWaitHours: 48,
  limits: { runMinutes: 30, dayMinutes: 90, runTokens: 3000000, dayTokens: 8000000, draftsPerRun: 10 },
  whoWasContacted: "who-was-contacted.csv",
};
// The job a runner writes from its person's sessions leaves out the limits and the file of who was contacted, so their defaults apply.
const { limits: _limits, whoWasContacted: _whoWasContacted, ...jobWrittenFromSessions } = job;
const employeeDefinition = { key: "adams-outreach", project: docs, subject: "Drafts cold emails to agencies in Adam's voice.", model: "sonnet", promoteAtTokens: 80000, areas: [], job };
const employeeDirectoryEntry = { key: "adams-outreach", expertRecordId: outreachRecordId, project: docs, owner: adam, yours: true, revision: 1, employee: true };
const draft = {
  id: draftId,
  text: "Hi Ana, I'm Adam from Isoplan. ...",
  subject: "Handoffs at Brightside",
  to: { name: "Ana", address: "ana@brightside.example", organisation: "Brightside" },
  askedExperts: ["adams-writing"],
  expiresAt: "2026-10-22T09:00:00.000Z",
};
const endedRun = { run, scheduledFor: at, startedAt: at, endedAt: "2026-10-20T09:12:00.000Z", outcome: "ran", drafts: 8, heldBySecretCheck: 1, someoneElseHad: 1 };
const employeeRuns = { key: "adams-outreach", expertRecordId: outreachRecordId, ended: [] };
const decided = { type: "employee-draft-decided", v, key: "adams-outreach", expertRecordId: outreachRecordId, draft: draftId, by: adam, at };
const decisionApplied = { type: "employee-draft-decision-applied", v, key: "adams-outreach", expertRecordId: outreachRecordId, draft: draftId };

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
  // A Windows folder: its backslashes must survive parsing.
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
  "runner that keeps expert instances": { type: "runner", v, account: adam, machine: { name: "sevengill" }, expertInstances: true },
  "expert-rights": { type: "expert-rights", v, experts: [{ name: "adr-0004", subject: expertDefinition.subject, repo: "isoplan", host: "Adam" }] },
  "ask-expert": { type: "ask-expert", v, expert: "adr-0004", question: "May a session's title leave the machine?", blocking: true, key: "toolu_02" },
  "asked of an expert": { type: "asked", v, question: "x-0123456789", text: "May a session's title leave the machine?", state: "answered", answer: "Yes.", owner: "Adam", key: "toolu_02", expert: "adr-0004", commit, branch: "main" },
  "expert-definition": { type: "expert-definition", v, definition: expertDefinition },
  "expert-definition based on a revision": { type: "expert-definition", v, definition: expertDefinition, basedOn: { expertRecordId, revision: 2 } },
  "expert-record-wanted": { type: "expert-record-wanted", v, key: "adr-0004", expertRecordId },
  "expert-instance-states": { type: "expert-instance-states", v, instances: [expertInstance, { key: "pairing", expertRecordId: pairingRecordId, state: "setting-up", step: "grounding" }] },
  "expert-instance-states failed": { type: "expert-instance-states", v, instances: [{ key: "adr-0004", expertRecordId, state: "failed", failure: { why: "clone", detail: "fatal: could not read Username for 'https://github.com': terminal prompts disabled" } }] },
  "expert-question": { type: "expert-question", v, id: "toolu_02", key: "adr-0004", expertRecordId, session: "claude-code:s2", blocking: true, state: "asking", askedAt: at },
  "expert-question answered": { type: "expert-question", v, id: "toolu_02", key: "adr-0004", expertRecordId, session: "claude-code:s2", blocking: true, state: "answered", senior: true, askedAt: at, endedAt: "2026-10-20T09:00:12.000Z" },
  "expert-question not set up": { type: "expert-question", v, id: "toolu_03", key: "adr-0004", expertRecordId, session: "claude-code:s2", blocking: false, state: "dropped", code: "EXPERT_NOT_SET_UP", askedAt: at, endedAt: at },
  "expert-set-up-offered": { type: "expert-set-up-offered", v, key: "adr-0004", expertRecordId },
  "expert-proof-failed": { type: "expert-proof-failed", v, key: "adr-0004", expertRecordId, revision: 2, answer: "No: a title is session text." },
  "expert-proof-failed held": { type: "expert-proof-failed", v, key: "adr-0004", expertRecordId, revision: 2, answerHeld: true },
  "expert-directory": { type: "expert-directory", v, experts: [expertDirectoryEntry, { key: "pairing", expertRecordId: pairingRecordId, project: isoplan, owner: sam, revision: 1 }], asking },
  "expert-record": { type: "expert-record", v, expertRecordId, revision: 2, owner: adam, yours: true, definition: expertDefinition },
  "expert-definition-result published": { type: "expert-definition-result", v, key: "adr-0004", outcome: "published", expertRecordId, revision: 2 },
  "expert-definition-result edited-elsewhere": { type: "expert-definition-result", v, key: "adr-0004", outcome: "refused", reason: "edited-elsewhere", expertRecordId, revision: 3, definition: { ...expertDefinition, model: "opus" } },
  "expert-definition-result key-taken": { type: "expert-definition-result", v, key: "adr-0004", outcome: "refused", reason: "key-taken" },
  "expert-deleted": { type: "expert-deleted", v, key: "adr-0004", expertRecordId, by: sam },
  "set-up-expert-instance": { type: "set-up-expert-instance", v, request: "set-up-x-0123456789", key: "adr-0004", expertRecordId, by: sam },
  "set-up-expert-instance again": { type: "set-up-expert-instance", v, request: "set-up-x-0123456790", key: "adr-0004", expertRecordId, by: sam, again: true },
  "expert-set-up-offer-ended": { type: "expert-set-up-offer-ended", v, key: "adr-0004", expertRecordId, why: "dismissed" },
  "expert-questions-asked-on-your-other-computers": { type: "expert-questions-asked-on-your-other-computers", v, open: [{ key: "adr-0004", count: 2 }], askedAtInTheLastDay: [at, "2026-10-20T08:00:00.000Z"] },
  "runner that shares what expert instances learn": { type: "runner", v, account: adam, machine: { name: "sevengill" }, expertInstances: true, sharesWhatExpertInstancesLearn: true },
  "expert-directory that shares what expert instances learn": { type: "expert-directory", v, experts: [expertDirectoryEntry], asking, sharesWhatExpertInstancesLearn: true },
  "expert-definition with how much learned elsewhere a question carries": { type: "expert-definition", v, definition: { ...expertDefinition, learnedElsewhereTokensPerQuestion: 300 } },
  "expert-instance-learned": { type: "expert-instance-learned", v, key: "adr-0004", expertRecordId, ...thingLearned },
  "expert-learned-wanted-after": { type: "expert-learned-wanted-after", v, key: "adr-0004", expertRecordId, afterArrivalNumber: 3, chain },
  "expert-learned-wanted-after with none yet": { type: "expert-learned-wanted-after", v, key: "adr-0004", expertRecordId, afterArrivalNumber: 0, chain: "" },
  "expert-instance-learned-received kept": { type: "expert-instance-learned-received", v, key: "adr-0004", expertRecordId, id: learnedId, outcome: "kept", arrivalNumber: 4 },
  "expert-instance-learned-received removed": { type: "expert-instance-learned-received", v, key: "adr-0004", expertRecordId, id: removedId, outcome: "removed" },
  "expert-instance-learned-received refused": { type: "expert-instance-learned-received", v, key: "adr-0004", expertRecordId, id: learnedId, outcome: "refused", reason: "not-an-instance-here" },
  "expert-learned-since": { type: "expert-learned-since", v, key: "adr-0004", expertRecordId, afterArrivalNumber: 3, entries: learnedEntries, chain, lastArrivalNumber: 6 },
  "expert-learned-since started again": { type: "expert-learned-since", v, key: "adr-0004", expertRecordId, afterArrivalNumber: 0, entries: [{ ...thingLearned, kind: "learned", arrivalNumber: 1 }], chain, lastArrivalNumber: 2, startedAgain: true, more: true },
  "expert-learned-wanted-after-refused": { type: "expert-learned-wanted-after-refused", v, key: "adr-0004", expertRecordId, reason: "record-gone" },
  "runner that starts hidden sessions": { type: "runner", v, account: adam, machine: { name: "sevengill" }, drive: true, hiddenStarts: true },
  "drive start hidden": { type: "drive", v, kind: "start", id: "d13", by: adam, folder: "/Users/sam/code/isoplan", branch: "feat/dark-mode", project: isoplan, instruction: "Add a dark mode.", permissions: "auto", hidden: true },
  "runner that can create experts from suggestions": { type: "runner", v, account: adam, machine: { name: "sevengill" }, canCreateExpertsFromSuggestions: true, expertInstances: true },
  "expert-creation-suggestion": expertCreationSuggestion,
  "expert-creation-suggestion office-wide": { ...expertCreationSuggestion, id: "draft-x-0123456789", scope: "office" },
  "expert-creation-suggestion-ended from the runner": { type: "expert-creation-suggestion-ended", v, id: "o-4f9c2a", why: "withdrawn" },
  "expert-creation-progress": { type: "expert-creation-progress", v, request: "make-x-0123456789", expertCreationSuggestionId: "o-4f9c2a", state: "grounding" },
  "expert-creation-progress failed": { type: "expert-creation-progress", v, request: "make-x-0123456789", expertCreationSuggestionId: "o-4f9c2a", state: "failed", detail: "This computer has no checkout of isoplan." },
  "create-expert-from-suggestion": createExpertFromSuggestion,
  "draft-office-wide-expert-creation-suggestion": { type: "draft-office-wide-expert-creation-suggestion", v, request: "draft-x-0123456789", project: isoplan, folder: "packages/client/src/view", sessions: ["claude-code:s3", "claude-code:s1"], searchedBySessions: 3, searchWindowDays: 14 },
  "expert-creation-suggestion-dismissals": { type: "expert-creation-suggestion-dismissals", v, dismissals: [{ project: isoplan.id, folder: "packages/server/src/pairing", until: "2026-12-19T09:00:00.000Z" }, { project: isoplan.id, folder: "docs", forever: true }] },
  "expert-creation-suggestion-ended made": { type: "expert-creation-suggestion-ended", v, id: "o-4f9c2a", why: "made", key: "pairing-tokens" },
  "expert-creation-suggestion-ended expired": { type: "expert-creation-suggestion-ended", v, id: "o-4f9c2a", why: "expired" },
  "expert-creation-suggestion-ended refused": { type: "expert-creation-suggestion-ended", v, id: "o-4f9c2a", why: "refused" },
  "runner that runs employees": { type: "runner", v, account: adam, machine: { name: "sevengill" }, expertInstances: true, sharesWhatExpertInstancesLearn: true, employees: true },
  "expert-directory that takes employees": { type: "expert-directory", v, experts: [expertDirectoryEntry, employeeDirectoryEntry], asking, sharesWhatExpertInstancesLearn: true, employees: true },
  "expert-definition of an employee": { type: "expert-definition", v, definition: employeeDefinition },
  "expert-record of an employee": { type: "expert-record", v, expertRecordId: outreachRecordId, revision: 1, owner: adam, yours: true, definition: employeeDefinition },
  "expert-definition-result runs-elsewhere": { type: "expert-definition-result", v, key: "adams-outreach", outcome: "refused", reason: "runs-elsewhere", machineName: "sevengill" },
  "expert-question asked by an employee's run": { type: "expert-question", v, id: "toolu_05", key: "adr-0004", expertRecordId, session: "employee:adams-outreach", employee: "adams-outreach", blocking: true, state: "answered", askedAt: at, endedAt: "2026-10-20T09:00:20.000Z" },
  "expert-instance-learned by an employee": { type: "expert-instance-learned", v, key: "adams-outreach", expertRecordId: outreachRecordId, id: "c3d5e7f9-1a2b-4c3d-9e4f-5a6b7c8d9e0f", text: "Say why we write in the first line, then ask one question.", files: [], learnedAt: at },
  "employee-runs": { type: "employee-runs", v, employees: [{ ...employeeRuns, running: { run: stoppedRun, scheduledFor: "2026-10-21T09:00:00.000Z", since: "2026-10-21T09:00:30.000Z" }, ended: [endedRun], nextRunAt: "2026-10-22T09:00:00.000Z" }] },
  "employee-runs held back": { type: "employee-runs", v, employees: [{ ...employeeRuns, heldBack: { scheduledFor: "2026-10-21T09:00:00.000Z", draftsWaiting: 14 }, ended: [{ ...endedRun, run: stoppedRun, outcome: "stopped", limit: "context", drafts: 3 }, { ...endedRun, outcome: "failed", why: "Claude Code exited with code 1.", tryingAgainAt: "2026-10-20T09:22:00.000Z" }], whoWasContactedProblem: { detail: "remote: error: GH006: Protected branch update failed for refs/heads/main.", refused: true }, approvedTwice: [{ approvedAt: at, alreadyContactedBy: "Sam", at: "2026-10-18T15:00:00.000Z" }] }] },
  "employee-runs of an employee whose job file is gone": { type: "employee-runs", v, employees: [{ ...employeeRuns, ended: [{ run, scheduledFor: at, endedAt: "2026-10-20T21:00:00.000Z", outcome: "missed", drafts: 0, heldBySecretCheck: 0, someoneElseHad: 0 }], jobFileGone: true }] },
  "employee-drafts": { type: "employee-drafts", v, key: "adams-outreach", expertRecordId: outreachRecordId, run, drafts: [draft, { id: otherDraftId, text: "Hi Ben, ...", askedExperts: [], afterACorrection: true, expiresAt: draft.expiresAt }] },
  "employee-draft-decision-applied": { ...decisionApplied, whoWasContacted: "marked" },
  "employee-draft-decision-applied to someone another sender had": { ...decisionApplied, whoWasContacted: { alreadyContactedBy: "Sam", at, claimed: true } },
  "employee-draft-decision-applied for a rejection": decisionApplied,
  "employee-draft-decision-applied refused": { ...decisionApplied, refused: "unknown-draft" },
  "offer-to-make-an-employee": { type: "offer-to-make-an-employee", v, id: offerId, rhythm: { kind: "days", days: 5 }, skill: "outreach", at },
  "offer-to-make-an-employee on a weekly rhythm": { type: "offer-to-make-an-employee", v, id: offerId, rhythm: { kind: "weeks", weeks: 3 }, at },
  "offer-to-make-an-employee-job": { type: "offer-to-make-an-employee-job", v, request: "job-x-0123456789", id: offerId, job: { key: "adams-outreach", subject: employeeDefinition.subject, project: docs, model: "sonnet", job: jobWrittenFromSessions } },
  "offer-to-make-an-employee-job gone": { type: "offer-to-make-an-employee-job", v, request: "job-x-0123456789", id: offerId, gone: true },
  "making-an-employee": { type: "making-an-employee", v, request: "make-x-0123456790", key: "adams-outreach", state: "setting-up-experts" },
  "making-an-employee failed": { type: "making-an-employee", v, request: "make-x-0123456790", key: "adams-outreach", state: "failed", detail: "job.brief: it has an email address" },
  "employee-drafts-received": { type: "employee-drafts-received", v, key: "adams-outreach", expertRecordId: outreachRecordId, run, kept: [draftId], refused: [{ id: otherDraftId, reason: "not-this-computer" }] },
  "employee-draft-decided approved": { ...decided, decision: "approved" },
  "employee-draft-decided rejected": { ...decided, decision: "rejected", correction: "Don't say we help agencies scale: say what Isoplan does.", repeat: true, teach: ["adams-writing"] },
  "employee-draft-decided skipped": { ...decided, decision: "skipped" },
  "offer-to-make-an-employee-ended": { type: "offer-to-make-an-employee-ended", v, id: offerId, why: "made" },
  "offer-to-make-an-employee-job-wanted": { type: "offer-to-make-an-employee-job-wanted", v, request: "job-x-0123456789", id: offerId, by: adam },
  "make-an-employee": { type: "make-an-employee", v, request: "make-x-0123456790", by: adam, offer: offerId, definition: employeeDefinition },
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
  "runner that keeps expert instances": parseDataLayerMessage,
  "expert-rights": parseOfficeServerMessage,
  "ask-expert": parseDataLayerMessage,
  "asked of an expert": parseOfficeServerMessage,
  "expert-definition": parseDataLayerMessage,
  "expert-definition based on a revision": parseDataLayerMessage,
  "expert-record-wanted": parseDataLayerMessage,
  "expert-instance-states": parseDataLayerMessage,
  "expert-instance-states failed": parseDataLayerMessage,
  "expert-question": parseDataLayerMessage,
  "expert-question answered": parseDataLayerMessage,
  "expert-question not set up": parseDataLayerMessage,
  "expert-set-up-offered": parseDataLayerMessage,
  "expert-proof-failed": parseDataLayerMessage,
  "expert-proof-failed held": parseDataLayerMessage,
  "expert-directory": parseOfficeServerMessage,
  "expert-record": parseOfficeServerMessage,
  "expert-definition-result published": parseOfficeServerMessage,
  "expert-definition-result edited-elsewhere": parseOfficeServerMessage,
  "expert-definition-result key-taken": parseOfficeServerMessage,
  "expert-deleted": parseOfficeServerMessage,
  "set-up-expert-instance": parseOfficeServerMessage,
  "set-up-expert-instance again": parseOfficeServerMessage,
  "expert-set-up-offer-ended": parseOfficeServerMessage,
  "expert-questions-asked-on-your-other-computers": parseOfficeServerMessage,
  "runner that shares what expert instances learn": parseDataLayerMessage,
  "expert-directory that shares what expert instances learn": parseOfficeServerMessage,
  "expert-definition with how much learned elsewhere a question carries": parseDataLayerMessage,
  "expert-instance-learned": parseDataLayerMessage,
  "expert-learned-wanted-after": parseDataLayerMessage,
  "expert-learned-wanted-after with none yet": parseDataLayerMessage,
  "expert-instance-learned-received kept": parseOfficeServerMessage,
  "expert-instance-learned-received removed": parseOfficeServerMessage,
  "expert-instance-learned-received refused": parseOfficeServerMessage,
  "expert-learned-since": parseOfficeServerMessage,
  "expert-learned-since started again": parseOfficeServerMessage,
  "expert-learned-wanted-after-refused": parseOfficeServerMessage,
  "runner that starts hidden sessions": parseDataLayerMessage,
  "drive start hidden": parseOfficeServerMessage,
  "runner that can create experts from suggestions": parseDataLayerMessage,
  "expert-creation-suggestion": parseDataLayerMessage,
  "expert-creation-suggestion office-wide": parseDataLayerMessage,
  "expert-creation-suggestion-ended from the runner": parseDataLayerMessage,
  "expert-creation-progress": parseDataLayerMessage,
  "expert-creation-progress failed": parseDataLayerMessage,
  "create-expert-from-suggestion": parseOfficeServerMessage,
  "draft-office-wide-expert-creation-suggestion": parseOfficeServerMessage,
  "expert-creation-suggestion-dismissals": parseOfficeServerMessage,
  "expert-creation-suggestion-ended made": parseOfficeServerMessage,
  "expert-creation-suggestion-ended expired": parseOfficeServerMessage,
  "expert-creation-suggestion-ended refused": parseOfficeServerMessage,
  "runner that runs employees": parseDataLayerMessage,
  "expert-directory that takes employees": parseOfficeServerMessage,
  "expert-definition of an employee": parseDataLayerMessage,
  "expert-record of an employee": parseOfficeServerMessage,
  "expert-definition-result runs-elsewhere": parseOfficeServerMessage,
  "expert-question asked by an employee's run": parseDataLayerMessage,
  "expert-instance-learned by an employee": parseDataLayerMessage,
  "employee-runs": parseDataLayerMessage,
  "employee-runs held back": parseDataLayerMessage,
  "employee-runs of an employee whose job file is gone": parseDataLayerMessage,
  "employee-drafts": parseDataLayerMessage,
  "employee-draft-decision-applied": parseDataLayerMessage,
  "employee-draft-decision-applied to someone another sender had": parseDataLayerMessage,
  "employee-draft-decision-applied for a rejection": parseDataLayerMessage,
  "employee-draft-decision-applied refused": parseDataLayerMessage,
  "offer-to-make-an-employee": parseDataLayerMessage,
  "offer-to-make-an-employee on a weekly rhythm": parseDataLayerMessage,
  "offer-to-make-an-employee-job": parseDataLayerMessage,
  "offer-to-make-an-employee-job gone": parseDataLayerMessage,
  "making-an-employee": parseDataLayerMessage,
  "making-an-employee failed": parseDataLayerMessage,
  "employee-drafts-received": parseOfficeServerMessage,
  "employee-draft-decided approved": parseOfficeServerMessage,
  "employee-draft-decided rejected": parseOfficeServerMessage,
  "employee-draft-decided skipped": parseOfficeServerMessage,
  "offer-to-make-an-employee-ended": parseOfficeServerMessage,
  "offer-to-make-an-employee-job-wanted": parseOfficeServerMessage,
  "make-an-employee": parseOfficeServerMessage,
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
  "runner that keeps expert instances": [{ ...valid["runner that keeps expert instances"], expertInstances: false }, "expertInstances"],
  "expert-rights": [{ ...valid["expert-rights"], experts: [{ ...valid["expert-rights"].experts[0], repo: "" }] }, "experts[0].repo"],
  "ask-expert": [{ ...valid["ask-expert"], blocking: "yes" }, "blocking"],
  "asked of an expert": [{ ...valid["asked of an expert"], code: "EXPERT_LOST" }, "code"],
  "expert-definition": [{ ...valid["expert-definition"], definition: { ...expertDefinition, promoteAtTokens: 0 } }, "definition.promoteAtTokens"],
  "expert-definition based on a revision": [{ ...valid["expert-definition based on a revision"], basedOn: { expertRecordId, revision: 0 } }, "basedOn.revision"],
  "expert-record-wanted": [{ ...valid["expert-record-wanted"], expertRecordId: "adr-0004" }, "expertRecordId"],
  "expert-instance-states": [{ ...valid["expert-instance-states"], instances: [{ ...expertInstance, state: "starting" }] }, "instances[0].state"],
  "expert-instance-states failed": [{ ...valid["expert-instance-states failed"], instances: [{ ...valid["expert-instance-states failed"].instances[0], failure: { why: "network" } }] }, "instances[0].failure.why"],
  "expert-question": [{ ...valid["expert-question"], state: "queued" }, "state"],
  "expert-question answered": [{ ...valid["expert-question answered"], endedAt: "in a minute" }, "endedAt"],
  "expert-question not set up": [{ ...valid["expert-question not set up"], code: "EXPERT_QUESTION_HELD" }, "code"],
  "expert-set-up-offered": [{ ...valid["expert-set-up-offered"], key: "ADR 0004" }, "key"],
  "expert-proof-failed": [{ ...valid["expert-proof-failed"], revision: 1.5 }, "revision"],
  "expert-proof-failed held": [{ ...valid["expert-proof-failed held"], answerHeld: false }, "answerHeld"],
  "expert-directory": [{ ...valid["expert-directory"], asking: { ...asking, maxAgeHours: 0 } }, "asking.maxAgeHours"],
  "expert-record": [{ ...valid["expert-record"], owner: { name: "Adam" } }, "owner.id"],
  "expert-definition-result published": [{ ...valid["expert-definition-result published"], revision: 0 }, "revision"],
  "expert-definition-result edited-elsewhere": [{ ...valid["expert-definition-result edited-elsewhere"], expertRecordId: "x" }, "expertRecordId"],
  "expert-definition-result key-taken": [{ ...valid["expert-definition-result key-taken"], reason: "taken" }, "reason"],
  "expert-deleted": [{ ...valid["expert-deleted"], by: { name: "Sam" } }, "by.id"],
  "set-up-expert-instance": [{ ...valid["set-up-expert-instance"], request: "" }, "request"],
  "set-up-expert-instance again": [{ ...valid["set-up-expert-instance again"], again: false }, "again"],
  "expert-set-up-offer-ended": [{ ...valid["expert-set-up-offer-ended"], why: "ignored" }, "why"],
  "expert-questions-asked-on-your-other-computers": [{ ...valid["expert-questions-asked-on-your-other-computers"], open: [{ key: "adr-0004", count: 0 }] }, "open[0].count"],
  "runner that shares what expert instances learn": [{ ...valid["runner that shares what expert instances learn"], sharesWhatExpertInstancesLearn: false }, "sharesWhatExpertInstancesLearn"],
  "expert-directory that shares what expert instances learn": [{ ...valid["expert-directory that shares what expert instances learn"], sharesWhatExpertInstancesLearn: false }, "sharesWhatExpertInstancesLearn"],
  "expert-definition with how much learned elsewhere a question carries": [{ ...valid["expert-definition"], definition: { ...expertDefinition, learnedElsewhereTokensPerQuestion: 0 } }, "definition.learnedElsewhereTokensPerQuestion"],
  "expert-instance-learned": [{ ...valid["expert-instance-learned"], id: "learned-1" }, "id"],
  "expert-learned-wanted-after": [{ ...valid["expert-learned-wanted-after"], chain: chain.toUpperCase() }, "chain"],
  "expert-learned-wanted-after with none yet": [{ ...valid["expert-learned-wanted-after with none yet"], afterArrivalNumber: -1 }, "afterArrivalNumber"],
  "expert-instance-learned-received kept": [{ ...valid["expert-instance-learned-received kept"], arrivalNumber: 0 }, "arrivalNumber"],
  "expert-instance-learned-received removed": [{ ...valid["expert-instance-learned-received removed"], outcome: "deleted" }, "outcome"],
  "expert-instance-learned-received refused": [{ ...valid["expert-instance-learned-received refused"], reason: "gone" }, "reason"],
  "expert-learned-since": [{ ...valid["expert-learned-since"], entries: [{ ...learnedEntries[0], kind: "forgotten" }] }, "entries[0].kind"],
  "expert-learned-since started again": [{ ...valid["expert-learned-since started again"], lastArrivalNumber: 1.5 }, "lastArrivalNumber"],
  "expert-learned-wanted-after-refused": [{ ...valid["expert-learned-wanted-after-refused"], reason: "removed" }, "reason"],
  "runner that starts hidden sessions": [{ ...valid["runner that starts hidden sessions"], hiddenStarts: false }, "hiddenStarts"],
  "drive start hidden": [{ ...valid["drive start hidden"], hidden: "yes" }, "hidden"],
  "runner that can create experts from suggestions": [{ ...valid["runner that can create experts from suggestions"], canCreateExpertsFromSuggestions: false }, "canCreateExpertsFromSuggestions"],
  "expert-creation-suggestion": [{ ...expertCreationSuggestion, why: { ...expertCreationSuggestion.why, share: 1.5 } }, "why.share"],
  "expert-creation-suggestion office-wide": [{ ...valid["expert-creation-suggestion office-wide"], scope: "team" }, "scope"],
  "expert-creation-suggestion-ended from the runner": [{ ...valid["expert-creation-suggestion-ended from the runner"], why: "made" }, "why"],
  "expert-creation-progress": [{ ...valid["expert-creation-progress"], state: "cooking" }, "state"],
  "expert-creation-progress failed": [{ ...valid["expert-creation-progress failed"], detail: "x".repeat(MAX_DETAIL_LENGTH + 1) }, "detail"],
  "create-expert-from-suggestion": [{ ...createExpertFromSuggestion, by: { name: "Sam" } }, "by.id"],
  "draft-office-wide-expert-creation-suggestion": [{ ...valid["draft-office-wide-expert-creation-suggestion"], sessions: [] }, "sessions"],
  "expert-creation-suggestion-dismissals": [{ ...valid["expert-creation-suggestion-dismissals"], dismissals: [{ ...valid["expert-creation-suggestion-dismissals"].dismissals[0], forever: true }] }, "dismissals[0].until"],
  "expert-creation-suggestion-ended made": [{ ...valid["expert-creation-suggestion-ended made"], key: undefined }, "key"],
  "expert-creation-suggestion-ended expired": [{ ...valid["expert-creation-suggestion-ended expired"], why: "withdrawn" }, "why"],
  "expert-creation-suggestion-ended refused": [{ ...valid["expert-creation-suggestion-ended refused"], why: "no-draft" }, "why"],
  "runner that runs employees": [{ ...valid["runner that runs employees"], employees: false }, "employees"],
  "expert-directory that takes employees": [{ ...valid["expert-directory that takes employees"], experts: [expertDirectoryEntry, { ...employeeDirectoryEntry, employee: false }] }, "experts[1].employee"],
  "expert-definition of an employee": [{ ...valid["expert-definition of an employee"], definition: { ...employeeDefinition, job: { ...job, tools: ["Read", "Bash"] } } }, "definition.job.tools[1]"],
  "expert-record of an employee": [{ ...valid["expert-record of an employee"], definition: { ...employeeDefinition, proof: expertDefinition.proof } }, "definition.proof"],
  "expert-definition-result runs-elsewhere": [{ ...valid["expert-definition-result runs-elsewhere"], machineName: undefined }, "machineName"],
  "expert-question asked by an employee's run": [{ ...valid["expert-question asked by an employee's run"], session: "claude-code:s2" }, "session"],
  "expert-instance-learned by an employee": [{ ...valid["expert-instance-learned by an employee"], files: [{ path: "/etc/passwd" }] }, "files[0].path"],
  "employee-runs": [{ ...valid["employee-runs"], employees: [{ ...employeeRuns, ended: [{ ...endedRun, outcome: "skipped" }] }] }, "employees[0].ended[0].outcome"],
  "employee-runs held back": [{ ...valid["employee-runs held back"], employees: [{ ...employeeRuns, heldBack: { scheduledFor: at, draftsWaiting: 0 } }] }, "employees[0].heldBack.draftsWaiting"],
  "employee-runs of an employee whose job file is gone": [{ ...valid["employee-runs of an employee whose job file is gone"], employees: [{ ...employeeRuns, jobFileGone: false }] }, "employees[0].jobFileGone"],
  "employee-drafts": [{ ...valid["employee-drafts"], drafts: [] }, "drafts"],
  "employee-draft-decision-applied": [{ ...valid["employee-draft-decision-applied"], whoWasContacted: "contacted" }, "whoWasContacted"],
  "employee-draft-decision-applied to someone another sender had": [{ ...decisionApplied, whoWasContacted: { alreadyContactedBy: "", at } }, "whoWasContacted"],
  "employee-draft-decision-applied for a rejection": [{ ...decisionApplied, draft: "draft-1" }, "draft"],
  "employee-draft-decision-applied refused": [{ ...valid["employee-draft-decision-applied refused"], refused: "gone" }, "refused"],
  "offer-to-make-an-employee": [{ ...valid["offer-to-make-an-employee"], skill: "/outreach" }, "skill"],
  "offer-to-make-an-employee on a weekly rhythm": [{ ...valid["offer-to-make-an-employee on a weekly rhythm"], rhythm: { kind: "weeks", weeks: 1 } }, "rhythm.weeks"],
  "offer-to-make-an-employee-job": [{ ...valid["offer-to-make-an-employee-job"], job: { ...valid["offer-to-make-an-employee-job"].job, key: "Adams Outreach" } }, "job.key"],
  "offer-to-make-an-employee-job gone": [{ ...valid["offer-to-make-an-employee-job gone"], gone: false }, "gone"],
  "making-an-employee": [{ ...valid["making-an-employee"], state: "drafting" }, "state"],
  "making-an-employee failed": [{ ...valid["making-an-employee failed"], detail: "" }, "detail"],
  "employee-drafts-received": [{ ...valid["employee-drafts-received"], refused: [{ id: otherDraftId, reason: "late" }] }, "refused[0].reason"],
  "employee-draft-decided approved": [{ ...valid["employee-draft-decided approved"], by: { name: "Adam" } }, "by.id"],
  "employee-draft-decided rejected": [{ ...valid["employee-draft-decided rejected"], correction: "   " }, "correction"],
  "employee-draft-decided skipped": [{ ...valid["employee-draft-decided skipped"], at: "today" }, "at"],
  "offer-to-make-an-employee-ended": [{ ...valid["offer-to-make-an-employee-ended"], why: "withdrawn" }, "why"],
  "offer-to-make-an-employee-job-wanted": [{ ...valid["offer-to-make-an-employee-job-wanted"], id: "offer 7" }, "id"],
  "make-an-employee": [{ ...valid["make-an-employee"], definition: expertDefinition }, "definition.job"],
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

test("a report cut to MAX_REPORT_LENGTH parses marked cut; one longer, as an older data layer sends, still parses", () => {
  const report = { agent: worker.id, at, text: "x".repeat(MAX_REPORT_LENGTH - 1) + "…", cut: true };
  expect(parseDataLayerMessage({ ...valid.full, facts: { ...facts, reports: [report] } })).toMatchObject({ ok: true });
  expect(parseDataLayerMessage({ ...valid.full, facts: { ...facts, reports: [{ ...report, cut: false }] } })).toMatchObject({ ok: false, kind: "invalid" });
  expect(parseDataLayerMessage({ ...valid.full, facts: { ...facts, reports: [{ agent: worker.id, at, text: "x".repeat(MAX_REPORT_LENGTH * 2) }] } })).toMatchObject({ ok: true });
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

  test("a start is hidden only in a folder, and never in Orca; a hidden start opens anywhere else, with or without a branch", () => {
    const { branch: _, ...noBranch } = valid["drive start hidden"];
    for (const message of [noBranch, { ...valid["drive start hidden"], mode: "terminal" }, { ...valid["drive start in a folder"], hidden: false, mode: "orca" }]) expect(parseOfficeServerMessage(message)).toEqual({ ok: true, message });
    for (const message of [{ ...valid["drive start"], hidden: true }, { ...valid["drive start in Orca"], hidden: true }]) {
      const result = parseOfficeServerMessage(message);
      expect(result).toMatchObject({ ok: false, kind: "invalid" });
      expect(!result.ok && result.error).toContain("hidden");
    }
  });

  test("a remote with no branches parses with an empty list", () => {
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

describe("experts", () => {
  const rights = (experts: unknown[]) => parseOfficeServerMessage({ ...valid["expert-rights"], experts });
  const definition = (changed: object) => parseDataLayerMessage({ ...valid["expert-definition"], definition: { ...expertDefinition, ...changed } });

  test("an expert's key is lowercase letters, digits and dashes, starting with a letter or digit, at most 63", () => {
    for (const key of ["a", "adr-0004", "0-day", "a".repeat(63)]) expect(definition({ key })).toMatchObject({ ok: true });
    for (const key of ["", "-adr", "ADR", "adr_0004", "adr 0004", "a".repeat(64)]) expect(definition({ key })).toMatchObject({ ok: false, kind: "invalid" });
    expect(parseDataLayerMessage({ ...valid["ask-expert"], expert: "Adr" })).toMatchObject({ ok: false, kind: "invalid" });
    expect(parseOfficeServerMessage({ ...valid["expert-deleted"], key: "a".repeat(64) })).toMatchObject({ ok: false, kind: "invalid" });
  });

  test("a subject is 1 to MAX_EXPERT_SUBJECT_LENGTH characters once trimmed, in a definition and in rights", () => {
    const right = valid["expert-rights"].experts[0]!;
    expect(definition({ subject: "x".repeat(MAX_EXPERT_SUBJECT_LENGTH) })).toMatchObject({ ok: true });
    expect(rights([{ ...right, subject: "x".repeat(MAX_EXPERT_SUBJECT_LENGTH) }])).toMatchObject({ ok: true });
    for (const subject of ["   ", "x".repeat(MAX_EXPERT_SUBJECT_LENGTH + 1)]) {
      expect(definition({ subject })).toMatchObject({ ok: false, kind: "invalid" });
      expect(rights([{ ...right, subject }])).toMatchObject({ ok: false, kind: "invalid" });
    }
  });

  test("a session is told of at most MAX_EXPERTS experts", () => {
    const many = Array.from({ length: MAX_EXPERTS + 1 }, (_, i) => ({ ...valid["expert-rights"].experts[0], name: `expert-${i}` }));
    expect(rights(many.slice(0, MAX_EXPERTS))).toMatchObject({ ok: true });
    expect(rights(many)).toMatchObject({ ok: false, kind: "invalid" });
  });

  test("a session that may ask no expert, an office with no expert records and a computer with no instances say so with empty lists", () => {
    for (const [message, parse] of [
      [{ ...valid["expert-rights"], experts: [] }, parseOfficeServerMessage],
      [{ ...valid["expert-directory"], experts: [] }, parseOfficeServerMessage],
      [{ ...valid["expert-instance-states"], instances: [] }, parseDataLayerMessage],
    ] as const)
      expect(parse(message)).toEqual({ ok: true, message });
  });

  test("an expert question is 1 to MAX_QUESTION_LENGTH characters once trimmed, always with a key and whether it blocks", () => {
    const ask = valid["ask-expert"];
    expect(parseDataLayerMessage({ ...ask, question: "x".repeat(MAX_QUESTION_LENGTH) })).toMatchObject({ ok: true });
    for (const question of ["   ", "x".repeat(MAX_QUESTION_LENGTH + 1)]) {
      expect(parseDataLayerMessage({ ...ask, question })).toMatchObject({ ok: false, kind: "invalid" });
    }
    for (const wrong of [{ key: undefined }, { key: "" }, { key: "x".repeat(101) }, { blocking: undefined }]) {
      expect(parseDataLayerMessage({ ...ask, ...wrong })).toMatchObject({ ok: false, kind: "invalid" });
    }
  });

  test("an asked parses with and without the expert fields, each checked when present", () => {
    expect(parseOfficeServerMessage(valid.asked)).toEqual({ ok: true, message: valid.asked });
    const queued = { ...valid["asked of an expert"], state: "queued", answer: undefined, commit: undefined, branch: undefined, code: "EXPERT_QUEUED", note: "Queued: Adam's machine isn't connected." };
    expect(parseOfficeServerMessage(queued)).toMatchObject({ ok: true });
    for (const wrong of [{ expert: "ADR" }, { commit: "0123456" }, { branch: "" }]) {
      expect(parseOfficeServerMessage({ ...valid["asked of an expert"], ...wrong })).toMatchObject({ ok: false, kind: "invalid" });
    }
  });

  test("an asked of an expert with EXPERT_ANSWER_WITHHELD no longer parses: an expert never withholds its answer", () => {
    const result = parseOfficeServerMessage({ ...valid["asked of an expert"], state: "withheld", answer: undefined, code: "EXPERT_ANSWER_WITHHELD" });
    expect(result).toMatchObject({ ok: false, kind: "invalid" });
    expect(!result.ok && result.error).toContain("code");
  });

  test("a session that asks experts says so with true, and never with false", () => {
    expect(parseDataLayerMessage({ ...valid.full, facts: { ...facts, session: { ...facts.session, asksExperts: true } } })).toMatchObject({ ok: true });
    expect(parseDataLayerMessage({ ...valid.full, facts: { ...facts, session: { ...facts.session, asksExperts: false } } })).toMatchObject({ ok: false, kind: "invalid" });
  });
});

describe("expert records and instances", () => {
  test("a directory, and a computer's instance states, name each key once, and at most MAX_EXPERT_RECORDS", () => {
    const directory = (experts: unknown[]) => parseOfficeServerMessage({ ...valid["expert-directory"], experts });
    const states = (instances: unknown[]) => parseDataLayerMessage({ ...valid["expert-instance-states"], instances });
    for (const [result, path] of [
      [directory([expertDirectoryEntry, { ...expertDirectoryEntry, expertRecordId: pairingRecordId }]), "experts[1].key"],
      [states([expertInstance, { ...expertInstance, expertRecordId: pairingRecordId, state: "failed", failure: { why: "key-used-here" } }]), "instances[1].key"],
    ] as const) {
      expect(result).toMatchObject({ ok: false, kind: "invalid" });
      expect(!result.ok && result.error).toContain(path);
    }
    const keys = Array.from({ length: MAX_EXPERT_RECORDS + 1 }, (_, i) => `expert-${i}`);
    expect(directory(keys.slice(0, MAX_EXPERT_RECORDS).map((key) => ({ ...expertDirectoryEntry, key })))).toMatchObject({ ok: true });
    expect(directory(keys.map((key) => ({ ...expertDirectoryEntry, key })))).toMatchObject({ ok: false, kind: "invalid" });
    expect(states(keys.slice(0, MAX_EXPERT_RECORDS).map((key) => ({ ...expertInstance, key })))).toMatchObject({ ok: true });
    expect(states(keys.map((key) => ({ ...expertInstance, key })))).toMatchObject({ ok: false, kind: "invalid" });
  });

  test("a definition never names a folder on one computer: its project has a remote, whatever the case of local:", () => {
    const local = { id: "local:sevengill/C:/w/isoplan", name: "isoplan" };
    for (const project of [local, { ...local, id: "LOCAL:sevengill/C:/w/isoplan" }]) {
      for (const result of [
        parseDataLayerMessage({ ...valid["expert-definition"], definition: { ...expertDefinition, project } }),
        parseOfficeServerMessage({ ...valid["expert-record"], definition: { ...expertDefinition, project } }),
      ]) {
        expect(result).toMatchObject({ ok: false, kind: "invalid" });
        expect(!result.ok && result.error).toContain("definition.project");
      }
    }
  });

  test("the relay's messages no longer parse (0.17.0): experts, hosting, expert-senior and answer-expert; an older runner's hello still parses, its experts dropped", () => {
    const question = "May a session's title leave the machine?";
    for (const result of [
      parseDataLayerMessage({ type: "experts", v, experts: [{ name: "adr-0004", project: isoplan, subject: expertDefinition.subject, state: "ready" }] }),
      parseDataLayerMessage({ type: "expert-senior", v, id: "expert-x-0123456789-a1b2c3" }),
      parseDataLayerMessage({ type: "reply", v, id: "expert-x-0123456789-a1b2c3", kind: "answer-expert", answer: "Yes.", commit, branch: "main" }),
      parseOfficeServerMessage({ type: "hosting", v, listed: ["adr-0004"] }),
      parseOfficeServerMessage({ type: "request", v, id: "expert-x-0123456789-a1b2c3", kind: "answer-expert", expert: "adr-0004", questionId: "x-0123456789", question, blocking: false, from: sam, asker: "claude-code:s2" }),
    ]) {
      expect(result).toMatchObject({ ok: false, kind: "invalid" });
    }
    const { expertInstances: _, ...older } = valid["runner that keeps expert instances"];
    expect(parseDataLayerMessage({ ...older, experts: true })).toEqual({ ok: true, message: older });
  });

  test("an asked may end EXPERT_NOT_SET_UP, or EXPERT_QUEUED from an office before 0.17.0, and never EXPERT_QUESTION_HELD", () => {
    const { answer: _, commit: __, branch: ___, ...asked } = valid["asked of an expert"];
    const dropped = { ...asked, state: "dropped", note: "The Adr 0004 Expert isn't set up on this computer yet." };
    for (const code of ["EXPERT_NOT_SET_UP", "EXPERT_QUEUED"]) expect(parseOfficeServerMessage({ ...dropped, code })).toEqual({ ok: true, message: { ...dropped, code } });
    const result = parseOfficeServerMessage({ ...dropped, code: "EXPERT_QUESTION_HELD" });
    expect(result).toMatchObject({ ok: false, kind: "invalid" });
    expect(!result.ok && result.error).toContain("code");
  });

  test("a failed proof sends the fork's answer, 1 to MAX_EXPERT_ANSWER_LENGTH characters, or that it was held: exactly one of the two", () => {
    const failed = valid["expert-proof-failed"];
    expect(parseDataLayerMessage({ ...failed, answer: "x".repeat(MAX_EXPERT_ANSWER_LENGTH) })).toMatchObject({ ok: true });
    for (const wrong of [{ answerHeld: true }, { answer: undefined }, { answer: "" }, { answer: "x".repeat(MAX_EXPERT_ANSWER_LENGTH + 1) }]) {
      expect(parseDataLayerMessage({ ...failed, ...wrong })).toMatchObject({ ok: false, kind: "invalid" });
    }
  });

  test("a publish refused as edited-elsewhere carries the record's definition, for the runner to write; the other refusals need none", () => {
    const { definition: _, ...withoutDefinition } = valid["expert-definition-result edited-elsewhere"];
    const result = parseOfficeServerMessage(withoutDefinition);
    expect(result).toMatchObject({ ok: false, kind: "invalid" });
    expect(!result.ok && result.error).toContain("definition");
    for (const reason of ["key-taken", "not-owner", "project-not-in-an-office", "deleted"]) {
      const refused = { ...valid["expert-definition-result key-taken"], reason };
      expect(parseOfficeServerMessage(refused)).toEqual({ ok: true, message: refused });
    }
  });
});

describe("what instances learn", () => {
  const learned = (changed: object) => parseDataLayerMessage({ ...valid["expert-instance-learned"], ...changed });
  const since = (changed: object) => parseOfficeServerMessage({ ...valid["expert-learned-since"], ...changed });
  const numbered = (arrivalNumber: number): WhatWasLearnedEntry => ({ ...learnedEntries[0]!, arrivalNumber });

  test("a thing learned is 1 to MAX_WHAT_WAS_LEARNED_LENGTH characters and rests on at most MAX_FILES_WHAT_WAS_LEARNED_RESTS_ON files of its repo, or none (0.19.0), as a runner sends it and as it is sent back", () => {
    const files = (count: number) => Array.from({ length: count }, (_, i) => ({ path: `src/file-${i}.ts`, commit }));
    for (const fits of [{ text: "x".repeat(MAX_WHAT_WAS_LEARNED_LENGTH), files: files(MAX_FILES_WHAT_WAS_LEARNED_RESTS_ON) }, { files: [] }]) {
      expect(learned(fits)).toMatchObject({ ok: true });
      expect(since({ entries: [{ ...numbered(4), ...fits }] })).toMatchObject({ ok: true });
    }
    for (const [changed, path] of [
      [{ text: "" }, "text"],
      [{ text: "x".repeat(MAX_WHAT_WAS_LEARNED_LENGTH + 1) }, "text"],
      [{ files: files(MAX_FILES_WHAT_WAS_LEARNED_RESTS_ON + 1) }, "files"],
      [{ files: [{ path: "../secrets.txt" }] }, "files[0].path"],
      [{ files: [{ path: "src\\a.ts" }] }, "files[0].path"],
      [{ files: [{ path: "C:/w/isoplan/src/a.ts" }] }, "files[0].path"],
      [{ files: [{ path: "src/a.ts", commit: "0123abc" }] }, "files[0].commit"],
    ] as const) {
      for (const [result, where] of [
        [learned(changed), path],
        [since({ entries: [{ ...numbered(4), ...changed }] }), `entries[0].${path}`],
      ] as const) {
        expect(result).toMatchObject({ ok: false, kind: "invalid" });
        expect(!result.ok && result.error).toContain(where);
      }
    }
  });

  test("an expert-learned-since carries at most MAX_WHAT_WAS_LEARNED_ENTRIES_PER_MESSAGE entries, in increasing arrival numbers above afterArrivalNumber and at most lastArrivalNumber, and says startedAgain only from 0", () => {
    const many = (count: number) => Array.from({ length: count }, (_, i) => numbered(i + 1));
    expect(since({ afterArrivalNumber: 0, entries: many(MAX_WHAT_WAS_LEARNED_ENTRIES_PER_MESSAGE), lastArrivalNumber: 500, more: true })).toMatchObject({ ok: true });
    expect(since({ afterArrivalNumber: 3, entries: [], lastArrivalNumber: 3 })).toMatchObject({ ok: true });
    for (const [changed, path] of [
      [{ afterArrivalNumber: 0, entries: many(MAX_WHAT_WAS_LEARNED_ENTRIES_PER_MESSAGE + 1), lastArrivalNumber: 500 }, "entries"],
      [{ entries: [numbered(5), numbered(4)] }, "entries[1].arrivalNumber"],
      [{ entries: [numbered(4), numbered(4)] }, "entries[1].arrivalNumber"],
      [{ afterArrivalNumber: 4, entries: [numbered(4)] }, "entries[0].arrivalNumber"],
      [{ entries: [numbered(4)], lastArrivalNumber: 3 }, "entries[0].arrivalNumber"],
      [{ startedAgain: true }, "startedAgain"],
    ] as const) {
      const result = since(changed);
      expect(result).toMatchObject({ ok: false, kind: "invalid" });
      expect(!result.ok && result.error).toContain(path);
    }
  });

  test("only a thing learned the server kept carries its arrival number, and it must", () => {
    const { arrivalNumber: _, ...keptWithoutItsNumber } = valid["expert-instance-learned-received kept"];
    for (const message of [
      keptWithoutItsNumber,
      { ...valid["expert-instance-learned-received removed"], arrivalNumber: 4 },
      { ...valid["expert-instance-learned-received refused"], arrivalNumber: 4 },
    ]) {
      const result = parseOfficeServerMessage(message);
      expect(result).toMatchObject({ ok: false, kind: "invalid" });
      expect(!result.ok && result.error).toContain("arrivalNumber");
    }
  });

  test("an entry adds its thing learned's own id to the chain, removed since or not, and a removal `removal:<id>`", () => {
    expect(learnedEntries.map(arrivalEntryId)).toEqual([learnedId, removedId, `removal:${removedId}`]);
  });
});

describe("employees", () => {
  const refused = (result: ParseResult<unknown>, path: string) => {
    expect(result).toMatchObject({ ok: false, kind: "invalid" });
    expect(!result.ok && result.error).toContain(path);
  };
  const definition = (changed: object) => parseDataLayerMessage({ type: "expert-definition", v, definition: { ...employeeDefinition, ...changed } });
  const withJob = (changed: object) => definition({ job: { ...job, ...changed } });

  test("an employee's definition has a job, no proof question and no area; an expert's has its proof", () => {
    const { proof: _, ...withoutProof } = expertDefinition;
    refused(parseDataLayerMessage({ type: "expert-definition", v, definition: withoutProof }), "definition.proof");
    refused(definition({ proof: expertDefinition.proof }), "definition.proof");
    refused(definition({ areas: ["outreach"] }), "definition.areas");
  });

  test("a job lists only JOB_TOOLS, each once and Read among them, and each of its experts once", () => {
    expect(withJob({ tools: ["Read"], experts: [] })).toMatchObject({ ok: true });
    for (const [changed, path] of [
      [{ tools: ["Read", "Bash"] }, "definition.job.tools[1]"],
      [{ tools: ["Read", "mcp__gmail__send_email"] }, "definition.job.tools[1]"],
      [{ tools: ["Grep", "Glob"] }, "definition.job.tools"],
      [{ tools: ["Read", "Grep", "Read"] }, "definition.job.tools[2]"],
      [{ experts: ["adams-writing", "adams-writing"] }, "definition.job.experts[1]"],
    ] as const) {
      refused(withJob(changed), path);
    }
  });

  test("a job runs every day or every weekday at a 24-hour HH:MM, or weekly on the day it names, in an IANA zone or its computer's own", () => {
    for (const schedule of [{ every: "day", at: "00:00" }, { every: "weekday", at: "23:59", timeZone: "Europe/London" }, { every: "week", at: "09:00", on: "monday", timeZone: "America/Argentina/Buenos_Aires" }]) {
      expect(withJob({ schedule })).toMatchObject({ ok: true });
    }
    for (const schedule of [{ every: "week", at: "09:00" }, { every: "day", at: "09:00", on: "monday" }]) refused(withJob({ schedule }), "definition.job.schedule.on");
    for (const at of ["24:00", "9:00", "09:00:00", "9am"]) refused(withJob({ schedule: { every: "day", at } }), "definition.job.schedule.at");
    refused(withJob({ schedule: { every: "day", at: "09:00", timeZone: "../etc/localtime" } }), "definition.job.schedule.timeZone");
  });

  test("the file of who was contacted is one file that none of the job's documents or examples cover", () => {
    expect(withJob({ whoWasContacted: "sales/who-was-contacted.csv" })).toMatchObject({ ok: true });
    for (const changed of [
      { whoWasContacted: "." },
      { whoWasContacted: "sales/*.csv" },
      { whoWasContacted: "outreach/who-qualifies.md" },
      { whoWasContacted: "Outreach/Approved/who-was-contacted.csv" },
      { documents: ["outreach"], whoWasContacted: "outreach/who-was-contacted.csv" },
      { documents: ["."] },
    ]) {
      refused(withJob(changed), "definition.job.whoWasContacted");
    }
  });

  test("a stopped run names the limit it stopped at, the context's included, and no other run names one", () => {
    const runs = (ended: object) => parseDataLayerMessage({ type: "employee-runs", v, employees: [{ ...employeeRuns, ended: [{ ...endedRun, ...ended }] }] });
    expect(runs({ outcome: "stopped", limit: "context" })).toMatchObject({ ok: true });
    refused(runs({ outcome: "stopped" }), "employees[0].ended[0].limit");
    refused(runs({ outcome: "ran", limit: "run-tokens" }), "employees[0].ended[0].limit");
  });

  test("a draft's recipient has an address, and its text, subject and recipient keep within their limits", () => {
    const drafts = (changed: object) => parseDataLayerMessage({ ...valid["employee-drafts"], drafts: [{ ...draft, ...changed }] });
    expect(drafts({ text: "x".repeat(MAX_DRAFT_LENGTH), subject: "x".repeat(MAX_DRAFT_SUBJECT_LENGTH), to: undefined })).toMatchObject({ ok: true });
    for (const [changed, path] of [
      [{ to: { name: "Ana" } }, "drafts[0].to.address"],
      [{ to: { address: "ana at brightside" } }, "drafts[0].to.address"],
      [{ to: { ...draft.to, organisation: "x".repeat(MAX_DRAFT_RECIPIENT_NAME_LENGTH + 1) } }, "drafts[0].to.organisation"],
      [{ text: "x".repeat(MAX_DRAFT_LENGTH + 1) }, "drafts[0].text"],
      [{ subject: "x".repeat(MAX_DRAFT_SUBJECT_LENGTH + 1) }, "drafts[0].subject"],
      [{ askedExperts: ["adams-writing", "adams-writing"] }, "drafts[0].askedExperts[1]"],
    ] as const) {
      refused(drafts(changed), path);
    }
  });

  test("each employee, each of its ended runs and each draft is named once, and a run leaves at most MAX_DRAFTS_PER_RUN drafts", () => {
    refused(parseDataLayerMessage({ type: "employee-runs", v, employees: [employeeRuns, employeeRuns] }), "employees[1].key");
    refused(parseDataLayerMessage({ type: "employee-runs", v, employees: [{ ...employeeRuns, ended: [endedRun, endedRun] }] }), "employees[0].ended[1].run");
    refused(parseDataLayerMessage({ ...valid["employee-drafts"], drafts: [draft, draft] }), "drafts[1].id");
    refused(parseOfficeServerMessage({ ...valid["employee-drafts-received"], kept: [draftId, otherDraftId] }), "refused[0].id");
    const many = Array.from({ length: MAX_DRAFTS_PER_RUN + 1 }, (_, i) => ({ ...draft, id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}` }));
    expect(parseDataLayerMessage({ ...valid["employee-drafts"], drafts: many.slice(1) })).toMatchObject({ ok: true });
    refused(parseDataLayerMessage({ ...valid["employee-drafts"], drafts: many }), "drafts");
  });

  test("a rejection carries the correction its owner typed, at most MAX_CORRECTION_LENGTH characters, and names each expert to teach once", () => {
    const rejected = valid["employee-draft-decided rejected"];
    const { correction: _, ...withoutCorrection } = rejected;
    const { teach: __, ...withoutTeach } = rejected;
    for (const [message, path] of [
      [withoutCorrection, "correction"],
      [{ ...rejected, correction: "x".repeat(MAX_CORRECTION_LENGTH + 1) }, "correction"],
      [withoutTeach, "teach"],
      [{ ...rejected, teach: ["adams-writing", "adams-writing"] }, "teach[1]"],
    ] as const) {
      refused(parseOfficeServerMessage(message), path);
    }
  });

  test("a decision's answer says who was contacted, or refuses, never both; an offer's job comes, or that it is gone, never both", () => {
    refused(parseDataLayerMessage({ ...valid["employee-draft-decision-applied"], refused: "not-yours" }), "refused");
    for (const message of [{ ...valid["offer-to-make-an-employee-job"], gone: true }, { ...valid["offer-to-make-an-employee-job gone"], gone: undefined }]) {
      refused(parseDataLayerMessage(message), "job");
    }
  });

  test("an offer's job names a project with a remote, as a definition does", () => {
    const offered = valid["offer-to-make-an-employee-job"];
    refused(parseDataLayerMessage({ ...offered, job: { ...offered.job, project: { id: "local:sevengill/C:/w/docs", name: "docs" } } }), "job.project");
  });

  test("an employee's name is its key's words capitalised, with nothing after them", () => {
    expect(employeeDisplayName("adams-outreach")).toBe("Adams Outreach");
    expect(expertDisplayName("adams-outreach")).toBe("Adams Outreach Expert");
  });
});

describe("expert creation suggestions", () => {
  const long = (length: number) => "x".repeat(length);

  test("a session's areas parse in its facts and its changes, as whole counts of at least 0, and facts with none still parse", () => {
    const withAreas = { ...valid.full, facts: { ...facts, areas: [area, { ...area, folder: "src", project: { id: "github.com/team/api", name: "api" }, away: true }] } };
    expect(parseDataLayerMessage(withAreas)).toEqual({ ok: true, message: withAreas });
    const changes = { ...valid.changes, upsert: { areas: [area] } };
    expect(parseDataLayerMessage(changes)).toEqual({ ok: true, message: changes });
    for (const wrong of [{ ms: 1.5 }, { reads: -1 }, { tokens: undefined }]) {
      expect(parseDataLayerMessage({ ...valid.full, facts: { ...facts, areas: [{ ...area, ...wrong }] } })).toMatchObject({ ok: false, kind: "invalid" });
    }
    expect(parseDataLayerMessage(valid.full)).toEqual({ ok: true, message: valid.full });
  });

  test("an area path is `.` or a relative path of named parts with forward slashes, globs allowed, at most MAX_AREA_PATH_LENGTH", () => {
    const paths = (folder: string) => [
      parseDataLayerMessage({ ...valid.full, facts: { ...facts, areas: [{ ...area, folder }] } }),
      parseOfficeServerMessage({ ...createExpertFromSuggestion, area: [folder] }),
      parseOfficeServerMessage({ ...valid["draft-office-wide-expert-creation-suggestion"], folder }),
    ];
    for (const path of [".", "packages/server", "docs/adr/*.md", "packages/**/src", "CONTEXT.md", long(MAX_AREA_PATH_LENGTH)]) {
      for (const result of paths(path)) expect(result).toMatchObject({ ok: true });
    }
    for (const path of ["", "/etc", "C:/repo", "src\\pairing", "a/../b", "..", "./src", "src/", "a//b", "a:b", long(MAX_AREA_PATH_LENGTH + 1)]) {
      for (const result of paths(path)) expect(result).toMatchObject({ ok: false, kind: "invalid" });
    }
  });

  test("an area names 1 to MAX_AREA_PATHS paths, in an expert creation suggestion and in create-expert-from-suggestion; an expert's definition 0 to MAX_AREA_PATHS", () => {
    const paths = (n: number) => Array.from({ length: n }, (_, i) => `packages/p${i}`);
    for (const [parse, make] of [
      [parseDataLayerMessage, (area: string[]) => ({ ...expertCreationSuggestion, area })],
      [parseOfficeServerMessage, (area: string[]) => ({ ...createExpertFromSuggestion, area })],
    ] as const) {
      expect(parse(make(paths(MAX_AREA_PATHS)))).toMatchObject({ ok: true });
      for (const n of [0, MAX_AREA_PATHS + 1]) expect(parse(make(paths(n)))).toMatchObject({ ok: false, kind: "invalid" });
    }
    const definition = (areas: string[]) => parseDataLayerMessage({ ...valid["expert-definition"], definition: { ...expertDefinition, areas } });
    expect(definition([])).toMatchObject({ ok: true });
    expect(definition(paths(MAX_AREA_PATHS + 1))).toMatchObject({ ok: false, kind: "invalid" });
  });

  test("an expert creation suggestion's id keeps to what a link can carry, wherever it is named", () => {
    const ids = (id: string) => [
      parseDataLayerMessage({ ...expertCreationSuggestion, id }),
      parseDataLayerMessage({ ...valid["expert-creation-progress"], expertCreationSuggestionId: id }),
      parseOfficeServerMessage({ ...createExpertFromSuggestion, expertCreationSuggestionId: id }),
      parseOfficeServerMessage({ ...valid["draft-office-wide-expert-creation-suggestion"], request: id }),
      parseOfficeServerMessage({ ...valid["expert-creation-suggestion-ended expired"], id }),
    ];
    for (const id of ["o-4f9c2a", "draft_x-0123456789", long(100)]) for (const result of ids(id)) expect(result).toMatchObject({ ok: true });
    for (const id of ["", "a b", "a/b", "a?b=c", "a#b", long(101)]) for (const result of ids(id)) expect(result).toMatchObject({ ok: false, kind: "invalid" });
  });

  test("a model is a name no shell reads, starting with a letter or digit", () => {
    for (const model of ["sonnet", "claude-opus-5-5", "claude-sonnet-4-5[1m]", "us.anthropic.claude-sonnet-4-5-20250929-v1:0", "arn:aws:bedrock:us-east-1:123456789012:application-inference-profile/abc"]) {
      expect(parseOfficeServerMessage({ ...createExpertFromSuggestion, model })).toMatchObject({ ok: true });
    }
    for (const model of ["", "-p", "--model=x", "sonnet && calc", "a b", "a&b", "a|b", 'a"b', "a%PATH%", long(201)]) {
      expect(parseOfficeServerMessage({ ...createExpertFromSuggestion, model })).toMatchObject({ ok: false, kind: "invalid" });
    }
  });

  test("a proof has a question and an answer, each trimmed and within MAX_QUESTION_LENGTH and MAX_EXPERT_ANSWER_LENGTH", () => {
    expect(parseDataLayerMessage({ ...expertCreationSuggestion, proof: { question: " Where? ", answer: "Here.\n" } })).toMatchObject({ ok: true, message: { proof: { question: "Where?", answer: "Here." } } });
    for (const proof of [{ question: "   ", answer: "Here." }, { question: "Where?", answer: "" }, { question: long(MAX_QUESTION_LENGTH + 1), answer: "Here." }, { question: "Where?", answer: long(MAX_EXPERT_ANSWER_LENGTH + 1) }, { question: "Where?" }]) {
      expect(parseDataLayerMessage({ ...expertCreationSuggestion, proof })).toMatchObject({ ok: false, kind: "invalid" });
      expect(parseOfficeServerMessage({ ...createExpertFromSuggestion, proof })).toMatchObject({ ok: false, kind: "invalid" });
    }
  });

  test("an expert creation suggestion's share is from 0 to 1, its tokens and corrections whole, and none of its signals below 0", () => {
    for (const share of [0, 1]) expect(parseDataLayerMessage({ ...expertCreationSuggestion, why: { ...expertCreationSuggestion.why, share } })).toMatchObject({ ok: true });
    for (const wrong of [{ share: -0.1 }, { tokens: 1.5 }, { corrections: 0.5 }, { minutes: -1 }, { tokens: undefined }]) {
      expect(parseDataLayerMessage({ ...expertCreationSuggestion, why: { ...expertCreationSuggestion.why, ...wrong } })).toMatchObject({ ok: false, kind: "invalid" });
    }
  });

  test("an expert creation suggestion may say what was done in its area again (0.16.0): a file read again in whole counts of readings, sessions and files, or a folder's searches; one without parses, as an older runner sends it", () => {
    for (const repetition of [{ readings: 4, sessions: 3, files: 2 }, { searches: 6 }]) {
      const message = { ...expertCreationSuggestion, repetition };
      expect(parseDataLayerMessage(message)).toEqual({ ok: true, message });
    }
    for (const wrong of [{ readings: 1, sessions: 1, files: 1 }, { readings: 4, sessions: 0, files: 1 }, { readings: 4.5, sessions: 3, files: 1 }, { searches: 0 }, { readings: 4 }]) {
      expect(parseDataLayerMessage({ ...expertCreationSuggestion, repetition: wrong })).toMatchObject({ ok: false, kind: "invalid" });
    }
    expect(parseDataLayerMessage(expertCreationSuggestion)).toMatchObject({ ok: true });
  });

  test("a dismissal lasts until a time, or forever, and exactly one of the two", () => {
    const [snoozed, forever] = valid["expert-creation-suggestion-dismissals"].dismissals;
    const { until: _, ...neither } = snoozed!;
    for (const dismissal of [neither, { ...snoozed, forever: true }, { ...forever, forever: false }, { ...snoozed, until: "in a month" }]) {
      expect(parseOfficeServerMessage({ ...valid["expert-creation-suggestion-dismissals"], dismissals: [dismissal] })).toMatchObject({ ok: false, kind: "invalid" });
    }
  });

  test("a draft-office-wide-expert-creation-suggestion names 1 to MAX_EXPERT_CREATION_SUGGESTION_SESSIONS sessions; expert-creation-suggestion-dismissals lists 0 to MAX_EXPERT_CREATION_SUGGESTION_DISMISSALS", () => {
    const sessions = (n: number) => Array.from({ length: n }, (_, i) => `claude-code:s${i}`);
    expect(parseOfficeServerMessage({ ...valid["draft-office-wide-expert-creation-suggestion"], sessions: sessions(MAX_EXPERT_CREATION_SUGGESTION_SESSIONS) })).toMatchObject({ ok: true });
    expect(parseOfficeServerMessage({ ...valid["draft-office-wide-expert-creation-suggestion"], sessions: sessions(MAX_EXPERT_CREATION_SUGGESTION_SESSIONS + 1) })).toMatchObject({ ok: false, kind: "invalid" });
    const dismissals = (n: number) => Array.from({ length: n }, (_, i) => ({ project: isoplan.id, folder: `packages/p${i}`, forever: true }));
    for (const n of [0, MAX_EXPERT_CREATION_SUGGESTION_DISMISSALS]) expect(parseOfficeServerMessage({ ...valid["expert-creation-suggestion-dismissals"], dismissals: dismissals(n) })).toMatchObject({ ok: true });
    expect(parseOfficeServerMessage({ ...valid["expert-creation-suggestion-dismissals"], dismissals: dismissals(MAX_EXPERT_CREATION_SUGGESTION_DISMISSALS + 1) })).toMatchObject({ ok: false, kind: "invalid" });
  });

  test("a draft-office-wide-expert-creation-suggestion says how many sessions searched the folder, a positive whole number, within how many days, a positive number", () => {
    const draft = valid["draft-office-wide-expert-creation-suggestion"];
    expect(parseOfficeServerMessage({ ...draft, searchedBySessions: 2, searchWindowDays: 0.5 })).toMatchObject({ ok: true });
    const { searchedBySessions: _, ...noCount } = draft;
    const { searchWindowDays: __, ...noWindow } = draft;
    for (const message of [noCount, noWindow, { ...draft, searchedBySessions: 0 }, { ...draft, searchedBySessions: 2.5 }, { ...draft, searchWindowDays: 0 }, { ...draft, searchWindowDays: -1 }]) {
      expect(parseOfficeServerMessage(message)).toMatchObject({ ok: false, kind: "invalid" });
    }
  });

  test("only an expert creation suggestion whose expert was made names its expert's key, and it must", () => {
    const dismissed = { ...valid["expert-creation-suggestion-ended expired"], why: "dismissed" };
    expect(parseOfficeServerMessage({ ...dismissed, key: "pairing" })).toEqual({ ok: true, message: dismissed });
    expect(parseOfficeServerMessage({ ...valid["expert-creation-suggestion-ended made"], key: "Pairing" })).toMatchObject({ ok: false, kind: "invalid" });
  });

  test("an expert's display name is its key's words, capitalised, then Expert", () => {
    expect(expertDisplayName("pairing")).toBe("Pairing Expert");
    expect(expertDisplayName("pairing-tokens")).toBe("Pairing Tokens Expert");
    expect(expertDisplayName("adr-0004")).toBe("Adr 0004 Expert");
    expect(expertDisplayName("floor--view-")).toBe("Floor View Expert");
  });
});
