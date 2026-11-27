import fs from "node:fs";
import path from "node:path";
import { OfferToMakeAnEmployeeJobMessageSchema, OfferToMakeAnEmployeeMessageSchema, PROTOCOL_VERSION } from "@isoplan/protocol";
import { expect, test } from "vitest";
import { modDir, tempRoot } from "../data-layer/fixture.js";
import type { RunnerEmployeeMessage } from "../data-layer/link.js";
import type { DataLayerLine } from "../lines.js";
import type { JobFromSessions, JobFromSessionsInput } from "./job-from-sessions-model-call.js";
import { createOffersToMakeAnEmployee } from "./offers-to-make-an-employee.js";
import { loadPatterns } from "./scan.js";
import { createCheckBeforeItLeaves } from "./what-was-learned-before-it-leaves.js";

const SERVER = "ws://127.0.0.1:4799/data-layer";
const ADAM = { id: "claude:acc-adam", name: "Adam" };
const PROJECT = { id: "github.com/acme/docs", name: "docs" };
const HOUR = 3600000;
const JOB: JobFromSessions = { key: "agency-outreach", subject: "Drafts cold emails to agencies.", job: { brief: "Find agencies that qualify and draft one email to each.", rules: ["One email per agency."], documents: [], examples: [], schedule: { every: "weekday", at: "09:00" }, tools: ["Read", "WebSearch"], experts: [] } };
const start = { session: "s1", day: "2026-11-26", at: Date.parse("2026-11-26T09:00:00Z"), startedWith: "skill:outreach", skill: "outreach", server: SERVER, project: PROJECT.id, cwd: "/work/docs" };

function setUp(written: (JobFromSessions | null)[] = [JOB], root = tempRoot()) {
  const sent: RunnerEmployeeMessage[] = [];
  const lines: DataLayerLine[] = [];
  const inputs: JobFromSessionsInput[] = [];
  const clock = { t: Date.parse("2026-11-26T12:00:00Z") };
  const offers = createOffersToMakeAnEmployee({
    file: path.join(root, "offers.json"),
    projectsDir: path.join(root, "projects"),
    claudeDir: root,
    account: ADAM,
    settings: async () => ({ sessionsAJobIsWrittenFrom: 5, jobFromSessionsTriedAgainAfterHours: 24 }),
    officeFor: async () => ({ server: SERVER, project: PROJECT }),
    send: (_server, m) => (sent.push(m), true),
    write: async (input) => (inputs.push(input), written.length > 1 ? written.shift()! : written[0]!),
    check: createCheckBeforeItLeaves({ secretPatterns: async () => [{ name: "test secret", regex: /SECRET/ }], personalDataPatterns: () => loadPatterns(path.join(modDir, "personal-data-patterns.json"), path.join(root, "none.json"), () => {}) }),
    expertsAsked: async () => ["adams-writing"],
    madeHere: () => false,
    hooked: () => ({ send: (l) => void lines.push(l) }),
    log: () => {},
    now: () => clock.t,
  });
  const offered = () => sent.filter((m) => m.type === "offer-to-make-an-employee");
  return { offers, sent, lines, inputs, clock, offered, root };
}

test("an offer carries only its id, rhythm, skill and time, to one office; its job goes on its person's opening, checked again, never for another account; ended, it is never offered again; a job with personal data or a secret makes no offer", async () => {
  const s = setUp();
  await s.offers.rhythm("skill:outreach", { kind: "days", days: 4 }, [start]);
  expect(s.sent).toHaveLength(1);
  const offer = s.sent[0]!;
  expect(OfferToMakeAnEmployeeMessageSchema.safeParse(offer).success).toBe(true);
  expect(Object.keys(offer).sort()).toEqual(["at", "id", "rhythm", "skill", "type", "v"]);
  expect(JSON.stringify(offer)).not.toContain("agencies");
  expect(s.lines[0]).toMatchObject({ type: "offer-to-make-an-employee", skill: "outreach" });
  const id = (offer as { id: string }).id;

  await s.offers.jobWanted(SERVER, { type: "offer-to-make-an-employee-job-wanted", v: PROTOCOL_VERSION, request: "r1", id, by: { id: "claude:acc-valentina", name: "Valentina" } });
  expect(s.sent).toHaveLength(1);
  await s.offers.jobWanted(SERVER, { type: "offer-to-make-an-employee-job-wanted", v: PROTOCOL_VERSION, request: "r2", id, by: ADAM });
  const job = s.sent[1]!;
  expect(OfferToMakeAnEmployeeJobMessageSchema.safeParse(job).success).toBe(true);
  expect(job).toMatchObject({ request: "r2", id, job: { key: "agency-outreach", job: { brief: JOB.job.brief } } });

  s.offers.ended(SERVER, { type: "offer-to-make-an-employee-ended", v: PROTOCOL_VERSION, id, why: "dismissed" });
  expect(s.lines.at(-1)).toMatchObject({ type: "offer-to-make-an-employee-ended", id });
  await s.offers.jobWanted(SERVER, { type: "offer-to-make-an-employee-job-wanted", v: PROTOCOL_VERSION, request: "r3", id, by: ADAM });
  expect(s.sent.at(-1)).toMatchObject({ request: "r3", gone: true });
  await s.offers.rhythm("skill:outreach", { kind: "days", days: 5 }, [start]);
  expect(s.offered()).toHaveLength(1);

  const personal = setUp([{ ...JOB, job: { ...JOB.job, rules: ["Sign off as adam@studio.example."] } }]);
  await personal.offers.rhythm("skill:outreach", { kind: "days", days: 4 }, [start]);
  expect(personal.sent).toEqual([]);
  const secret = setUp([{ ...JOB, job: { ...JOB.job, brief: "Use the SECRET list of agencies." } }]);
  await secret.offers.rhythm("skill:outreach", { kind: "days", days: 4 }, [start]);
  expect(secret.sent).toEqual([]);
});

test("the job is written from the skill's own file and the newest sessions' first prompts and final reports, with the experts they asked", async () => {
  const s = setUp();
  fs.mkdirSync(path.join(s.root, "skills", "outreach"), { recursive: true });
  fs.writeFileSync(path.join(s.root, "skills", "outreach", "SKILL.md"), "Find agencies and draft one email each.");
  fs.mkdirSync(path.join(s.root, "projects", "work-docs"), { recursive: true });
  const transcript = [
    { type: "user", message: { content: "<command-name>/outreach</command-name>" } },
    { type: "user", message: { content: "Today: agencies in Bath." } },
    { type: "assistant", message: { content: [{ type: "text", text: "Looking." }] } },
    { type: "assistant", message: { content: [{ type: "text", text: "Drafted 3 emails." }] } },
  ];
  fs.writeFileSync(path.join(s.root, "projects", "work-docs", "s1.jsonl"), transcript.map((x) => JSON.stringify(x)).join("\n"));
  const older = Array.from({ length: 6 }, (_, n) => ({ ...start, session: `old-${n}`, at: start.at - (n + 1) * 24 * HOUR }));
  await s.offers.rhythm("skill:outreach", { kind: "days", days: 4 }, [start, ...older]);
  const input = s.inputs[0]!;
  expect(input.skill).toEqual({ name: "outreach", text: "Find agencies and draft one email each." });
  expect(input.sessions).toHaveLength(5);
  expect(input.sessions[0]).toEqual({ firstPrompt: "Today: agencies in Bath.", finalReport: "Drafted 3 emails.", startedAt: "2026-11-26T09:00:00.000Z" });
  expect(input.experts).toEqual(["adams-writing"]);
});

test("no job written, or one that didn't pass its check, makes no offer and is tried again a day later, kept across a restart; an offer that ended is never made again, even once it is gone after 30 days", async () => {
  const s = setUp([null, JOB]);
  await s.offers.rhythm("skill:outreach", { kind: "days", days: 4 }, [start]);
  expect(s.offered()).toEqual([]);
  s.clock.t += 2 * HOUR;
  await s.offers.rhythm("skill:outreach", { kind: "days", days: 5 }, [start]);
  expect(s.inputs).toHaveLength(1);
  // A day on, after a restart: written, and offered.
  await s.offers.written();
  const again = setUp([JOB], s.root);
  again.clock.t = s.clock.t + 23 * HOUR;
  await again.offers.load();
  await again.offers.rhythm("skill:outreach", { kind: "days", days: 5 }, [start]);
  expect(again.offered()).toHaveLength(1);

  const id = (again.offered()[0] as { id: string }).id;
  again.offers.ended(SERVER, { type: "offer-to-make-an-employee-ended", v: PROTOCOL_VERSION, id, why: "expired" });
  await again.offers.written();
  const later = setUp([JOB], s.root);
  later.clock.t = again.clock.t + 31 * 24 * HOUR;
  await later.offers.load();
  expect(later.offers.get(id)).toBeNull();
  await later.offers.rhythm("skill:outreach", { kind: "days", days: 4 }, [start]);
  expect(later.offered()).toEqual([]);
});
