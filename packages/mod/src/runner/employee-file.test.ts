import path from "node:path";
import { ExpertDefinitionSchema } from "@isoplan/protocol";
import { expect, test } from "vitest";
import { definitionOfJob, JOB_NEEDS_READ, jobFileText, ONLY_JOB_TOOLS, parseEmployeeFile } from "./employee-file.js";

const repo = path.resolve("/work/docs");
const full = {
  version: 1,
  name: "adams-outreach",
  repo,
  subject: "Drafts cold emails to agencies in Adam's voice",
  model: "sonnet",
  promoteAtTokens: 80000,
  brief: "Each run, find agencies that qualify and draft one email to one person at each.",
  rules: ["One email per agency.", "Never guess what tools they use."],
  documents: ["outreach/who-qualifies.md"],
  examples: ["outreach/approved/adam/"],
  schedule: { every: "weekday", at: "09:00" },
  missedRunWindowMinutes: 720,
  tools: ["Read", "Grep", "Glob", "Agent", "WebSearch", "WebFetch"],
  experts: ["adams-writing", "lead-generation"],
  draftsWaitHours: 48,
  limits: { runMinutes: 30, runTokens: 3000000, dayMinutes: 90, dayTokens: 8000000, draftsPerRun: 10 },
  whoWasContacted: "who-was-contacted.csv",
};
const parse = (o: Record<string, unknown>, name = "adams-outreach.json") => parseEmployeeFile(JSON.stringify(o), name);
const failure = (o: Record<string, unknown>) => {
  const r = parse(o);
  if (r.ok) throw new Error("it parsed");
  return r;
};

test("a full job file parses into a definition with only what it sets; each bad field is named with why", () => {
  const r = parse({ ...full, colour: "blue" });
  if (!r.ok) throw new Error(r.reason);
  expect(r.unknown).toEqual(["colour"]);
  const d = definitionOfJob(r.employee, { id: "github.com/acme/docs", name: "docs" }, 80000);
  expect(ExpertDefinitionSchema.safeParse(d).success).toBe(true);
  expect(d).toMatchObject({ key: "adams-outreach", areas: [], job: { brief: full.brief, schedule: { every: "weekday", at: "09:00" } } });
  expect(d.proof).toBeUndefined();
  // Written back, it parses to the same.
  const again = parseEmployeeFile(jobFileText(d, repo), "adams-outreach.json");
  expect(again.ok && again.employee).toEqual(r.employee);

  // Each default is absent from a definition whose file leaves it out.
  const { missedRunWindowMinutes, draftsWaitHours, limits, whoWasContacted, promoteAtTokens, ...bare } = full;
  const b = parse(bare);
  if (!b.ok) throw new Error(b.reason);
  const job = definitionOfJob(b.employee, { id: "github.com/acme/docs", name: "docs" }, 80000).job!;
  for (const k of ["missedRunWindowMinutes", "draftsWaitHours", "limits", "whoWasContacted"]) expect(job).not.toHaveProperty(k);

  expect(failure({ ...full, tools: ["Read", "Bash"] })).toEqual({ ok: false, field: "tools", reason: `"Bash": ${ONLY_JOB_TOOLS}` });
  expect(failure({ ...full, tools: ["Grep"] })).toEqual({ ok: false, field: "tools", reason: JOB_NEEDS_READ });
  expect(failure({ ...full, schedule: { every: "day", at: "9am" } }).field).toBe("schedule.at");
  expect(failure({ ...full, schedule: { every: "day", at: "09:00", timeZone: "Mars/Olympus" } }).field).toBe("schedule.timeZone");
  expect(failure({ ...full, experts: ["adams-writing", "adams-writing"] }).field).toBe("experts.1");
  expect(failure({ ...full, documents: ["outreach/"], whoWasContacted: "outreach/who-was-contacted.csv" })).toMatchObject({ field: "whoWasContacted", reason: expect.stringContaining("move it out of outreach/") });
  expect(parseEmployeeFile(JSON.stringify(full), "someone-else.json")).toMatchObject({ ok: false, field: "name" });
});
