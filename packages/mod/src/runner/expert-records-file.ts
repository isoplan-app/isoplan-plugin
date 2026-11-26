// What an instance of an expert keeps of its expert record (isoplan-app#340), in
// ~/.claude/isoplan/experts/<key>/expert-records.json, per office server by its data-layer address:
//
// - `record`: the record this computer published (its owner's computer) or was set up from, as it
//   last had it: its id, revision, owner, whether it is this person's own, and its definition. So an
//   instance starts with the office out of reach, an edit can be told from a newer revision, and a
//   hand-over or a deletion touches only files tied to that record, never another one of the key.
// - `newerRecord`: a newer revision of it on a computer that isn't the owner's, held until the
//   instance's next question, which its current junior still answers.
// - `lastResult`: how its last publish there went: `published`, or the refusal's reason.
// - `setUp`: a set-up from the record begun before its instance file was written, with `failed`
//   once it failed; a runner stopped meanwhile finds it on start.
// - `proofFailed`: the proof's answer sent to the owner for a revision (D20), and whether it went.
//
// Written whole, as state.json is; a file that is missing or doesn't parse reads as none.

import path from "node:path";
import type { ExpertDefinition, ExpertDefinitionResultMessage } from "@isoplan/protocol";
import { readJson, writeJson } from "./expert-state.js";

export interface HeldExpertRecord {
  expertRecordId: string;
  revision: number;
  owner: { id: string; name: string };
  yours: boolean;
  definition: ExpertDefinition;
}

export type PublishResult = "published" | Extract<ExpertDefinitionResultMessage, { outcome: "refused" }>["reason"];

export interface ExpertRecordOnOneServer {
  record?: HeldExpertRecord;
  newerRecord?: HeldExpertRecord;
  lastResult?: PublishResult;
  setUp?: { expertRecordId: string; startedAt: number; failed?: { why: "clone" | "other"; detail: string } };
  proofFailed?: { revision: number; answer?: string; answerHeld?: true; sent: boolean };
}

export interface ExpertRecordsFile {
  version: 1;
  servers: Record<string, ExpertRecordOnOneServer>;
}

export const expertRecordsPath = (expertDir: string) => path.join(expertDir, "expert-records.json");

export async function readExpertRecords(expertDir: string): Promise<ExpertRecordsFile> {
  const o = (await readJson(expertRecordsPath(expertDir))) as ExpertRecordsFile | null;
  if (!o || o.version !== 1 || !o.servers || typeof o.servers !== "object" || Array.isArray(o.servers)) return { version: 1, servers: {} };
  return o;
}

export const writeExpertRecords = (expertDir: string, file: ExpertRecordsFile) => writeJson(expertRecordsPath(expertDir), file);
