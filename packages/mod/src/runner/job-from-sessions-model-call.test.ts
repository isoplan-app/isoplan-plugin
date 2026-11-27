import { MAX_EXPERT_SUBJECT_LENGTH } from "@isoplan/protocol";
import { expect, test } from "vitest";
import { jobFrom } from "./job-from-sessions-model-call.js";

const JOB = { key: "Agency Outreach", subject: "Drafts cold emails to agencies.", brief: "Find agencies that qualify and draft one email to each.", rules: ["One email per agency."], schedule: { every: "weekday", at: "09:00" }, tools: ["Read", "WebSearch"] };

test("the model's job is its one JSON object, fenced or not, its key made a key and its lists defaulted; a field that doesn't fit gives no job, never one cut", () => {
  expect(jobFrom("Here is the job:\n```json\n" + JSON.stringify(JOB) + "\n```")).toEqual({
    key: "agency-outreach",
    subject: JOB.subject,
    job: { brief: JOB.brief, rules: JOB.rules, documents: [], examples: [], schedule: JOB.schedule, tools: JOB.tools, experts: [] },
  });
  for (const bad of [{ tools: ["Read", "Bash"] }, { subject: "x".repeat(MAX_EXPERT_SUBJECT_LENGTH + 1) }, { key: "-outreach" }, { schedule: { every: "day", at: "9am" } }, { brief: undefined }]) expect(jobFrom(JSON.stringify({ ...JOB, ...bad }))).toBeNull();
  expect(jobFrom("I couldn't write one.")).toBeNull();
});
