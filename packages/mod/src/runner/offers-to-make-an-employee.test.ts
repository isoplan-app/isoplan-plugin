import path from "node:path";
import { OfferToMakeAnEmployeeJobMessageSchema, OfferToMakeAnEmployeeMessageSchema, PROTOCOL_VERSION } from "@isoplan/protocol";
import { expect, test } from "vitest";
import { modDir, tempRoot } from "../data-layer/fixture.js";
import type { RunnerEmployeeMessage } from "../data-layer/link.js";
import type { DataLayerLine } from "../lines.js";
import type { JobFromSessions } from "./job-from-sessions-model-call.js";
import { createOffersToMakeAnEmployee } from "./offers-to-make-an-employee.js";
import { loadPatterns } from "./scan.js";
import { createCheckBeforeItLeaves } from "./what-was-learned-before-it-leaves.js";

const SERVER = "ws://127.0.0.1:4799/data-layer";
const ADAM = { id: "claude:acc-adam", name: "Adam" };
const PROJECT = { id: "github.com/acme/docs", name: "docs" };
const JOB: JobFromSessions = { key: "agency-outreach", subject: "Drafts cold emails to agencies.", job: { brief: "Find agencies that qualify and draft one email to each.", rules: ["One email per agency."], documents: [], examples: [], schedule: { every: "weekday", at: "09:00" }, tools: ["Read", "WebSearch"], experts: [] } };
const start = { session: "s1", day: "2026-11-26", at: Date.parse("2026-11-26T09:00:00Z"), job: "skill:outreach", skill: "outreach", server: SERVER, project: PROJECT.id, cwd: "/work/docs" };

function setUp(written: JobFromSessions | null = JOB) {
  const root = tempRoot();
  const sent: RunnerEmployeeMessage[] = [];
  const lines: DataLayerLine[] = [];
  const offers = createOffersToMakeAnEmployee({
    file: path.join(root, "offers.json"),
    projectsDir: path.join(root, "projects"),
    claudeDir: root,
    account: ADAM,
    officeFor: async () => ({ server: SERVER, project: PROJECT }),
    send: (_server, m) => (sent.push(m), true),
    write: async () => written,
    check: createCheckBeforeItLeaves({ secretPatterns: async () => [{ name: "test secret", regex: /SECRET/ }], personalDataPatterns: () => loadPatterns(path.join(modDir, "personal-data-patterns.json"), path.join(root, "none.json"), () => {}) }),
    expertsAsked: async () => [],
    madeHere: () => false,
    hooked: () => ({ send: (l) => void lines.push(l) }),
    log: () => {},
  });
  return { offers, sent, lines };
}

test("an offer carries only its id, rhythm, skill and time, to one office; its job goes on its person's opening, checked again, never for another account; ended, it is never offered again; a job with personal data makes no offer", async () => {
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
  expect(s.sent.filter((m) => m.type === "offer-to-make-an-employee")).toHaveLength(1);

  const personal = setUp({ ...JOB, job: { ...JOB.job, rules: ["Sign off as adam@studio.example."] } });
  await personal.offers.rhythm("skill:outreach", { kind: "days", days: 4 }, [start]);
  expect(personal.sent).toEqual([]);
});
