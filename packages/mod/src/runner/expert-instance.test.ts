// This computer's instance of an expert, from its expert record (isoplan-app#340): set up, revised,
// published, handed over and deleted, through a record link to a stand-in office, with the fake
// `claude` and git of expert-fixture.ts and real files in a temp Claude folder.

import fs from "node:fs";
import path from "node:path";
import { PROTOCOL_VERSION, type ExpertRecordMessage, type SetUpExpertInstanceMessage } from "@isoplan/protocol";
import { expect, test, vi } from "vitest";
import { tempRoot } from "../data-layer/fixture.js";
import { BASE, until, type Rule } from "./expert-fixture.js";
import { KEY_TAKEN_WORDS } from "./expert-instance.js";
import { ADA, computer, DEFINITION, directoryOf, entryOf, installedInstance, OTHER_RECORD, OTHER_SERVER, readJsonFile, RECORD, SAM, SERVER, writeExpertFile, type Computer } from "./expert-stack-fixture.js";

// The empty folder git runs with as its hooks (handoff/take.ts noHooks) is made in the Claude folder: a temp one, never this machine's.
vi.stubEnv("CLAUDE_CONFIG_DIR", path.join(tempRoot(), "claude"));
vi.setConfig({ testTimeout: 60000 });

const record = (o: Partial<ExpertRecordMessage> = {}): ExpertRecordMessage => ({ type: "expert-record", v: PROTOCOL_VERSION, expertRecordId: RECORD, revision: 1, owner: ADA, definition: DEFINITION, ...o });
const setUpMessage = (o: { by?: { id: string; name: string }; again?: true; expertRecordId?: string } = {}): SetUpExpertInstanceMessage => ({ type: "set-up-expert-instance", v: PROTOCOL_VERSION, request: "r-1", key: "adr", expertRecordId: o.expertRecordId ?? RECORD, by: o.by ?? SAM, ...(o.again && { again: o.again }) });
const listed = (c: Computer, server = SERVER) => c.of("expert-instance-states", server).at(-1)?.instances ?? null;
const trunkStarts = (c: Computer) => c.claude().filter((l) => l.kind === "trunk" && l.argv);
const forkStarts = (c: Computer) => c.claude().filter((l) => l.kind === "fork" && l.argv);

/** Sets this computer's instance up from the record, as the floor's click does, and waits until it is ready. */
async function setUpInstance(c: Computer, o: Partial<ExpertRecordMessage> = {}) {
  c.take(directoryOf([entryOf({ ...(o.yours && { yours: true, owner: o.owner ?? SAM }) })]));
  c.take(setUpMessage());
  await until(() => c.of("expert-record-wanted").length > 0);
  c.take(record(o));
  await until(() => listed(c)?.[0]?.state === "ready", 30000);
}

/** This computer's own expert file, published to the office as RECORD at revision 1. */
async function publishOwn(c: Computer, entries = [entryOf({ owner: SAM, yours: true })]) {
  writeExpertFile(c);
  await c.experts.refresh("adr");
  c.take(directoryOf([]));
  await until(() => c.of("expert-definition").length === 1);
  c.take({ type: "expert-definition-result", v: PROTOCOL_VERSION, key: "adr", outcome: "published", expertRecordId: RECORD, revision: 1 });
  c.take(directoryOf(entries));
  await until(() => listed(c)?.[0]?.expertRecordId === RECORD);
}

test("set-up from the record with this computer's checkout: the record is asked for once the checkout is found; the instance file is written with defaults, then it grounds, proves and is ready, its listing naming only its state", async () => {
  const c = await computer();
  try {
    c.take(directoryOf([entryOf()]));
    await until(() => listed(c) !== null);
    expect(listed(c)).toEqual([]);
    c.take(setUpMessage());
    await until(() => c.of("expert-record-wanted").length === 1);
    expect(c.of("expert-record-wanted")[0]).toEqual({ type: "expert-record-wanted", v: PROTOCOL_VERSION, key: "adr", expertRecordId: RECORD });
    c.take(record());
    await until(() => fs.existsSync(c.file("expert-instances", "adr.json")));
    expect(readJsonFile(c.file("expert-instances", "adr.json"))).toEqual({ version: 1, key: "adr", server: SERVER, repo: c.checkout, forkTimeLimitMinutes: 5, groundingTimeLimitMinutes: 15, fetchSeconds: 60, maxForks: 3, caps: { perAskerPerDay: 30, openPerAsker: 3, tokenBudgetPerDay: 2000000 } });
    await until(() => listed(c)?.[0]?.state === "ready", 30000);
    const states = c.of("expert-instance-states").flatMap((m) => m.instances.map((i) => `${i.state}${i.step ? `/${i.step}` : ""}`));
    expect(states[0]).toBe("setting-up/cloning");
    expect(listed(c)).toEqual([{ key: "adr", expertRecordId: RECORD, state: "ready", groundingTokens: 50000 }]);
    expect(trunkStarts(c)).toHaveLength(1);
  } finally {
    await c.close();
  }
});

test("set-up with no checkout here: Isoplan's own clone from https, then ssh; both refused, it fails `clone` with git's reasons, asks for no record and grounds nothing", async () => {
  const c = await computer({ checkout: null });
  try {
    c.take(directoryOf([entryOf()]));
    c.take(setUpMessage());
    await until(() => listed(c)?.[0]?.state === "failed");
    expect(c.cloned).toEqual(["https://github.com/acme/app.git", "git@github.com:acme/app.git"]);
    expect(listed(c)).toEqual([
      {
        key: "adr",
        expertRecordId: RECORD,
        state: "failed",
        failure: { why: "clone", detail: "this computer has no checkout of app, and Isoplan's own copy of it couldn't be made: from https://github.com/acme/app.git, fatal: could not read from https://github.com/acme/app.git; from git@github.com:acme/app.git, fatal: could not read from git@github.com:acme/app.git" },
      },
    ]);
    expect(c.of("expert-record-wanted")).toEqual([]);
    expect(c.claude()).toEqual([]);
  } finally {
    await c.close();
  }
});

test("the owner setting up on a new computer of theirs: the expert file is written from the record (D12), and no new revision is published", async () => {
  const c = await computer();
  try {
    c.take(directoryOf([entryOf({ owner: SAM, yours: true })]));
    c.take(setUpMessage());
    await until(() => c.of("expert-record-wanted").length === 1);
    c.take(record({ owner: SAM, yours: true }));
    await until(() => fs.existsSync(c.file("experts", "adr.json")));
    expect(readJsonFile(c.file("experts", "adr.json"))).toMatchObject({ version: 1, name: "adr", repo: c.checkout, subject: DEFINITION.subject, model: DEFINITION.model, promoteAtTokens: DEFINITION.promoteAtTokens, proof: DEFINITION.proof, areas: [] });
    expect(fs.existsSync(c.file("expert-instances", "adr.json"))).toBe(false);
    await until(() => listed(c)?.[0]?.state === "ready", 30000);
    expect(listed(c)).toEqual([expect.objectContaining({ key: "adr", expertRecordId: RECORD })]);
    expect(c.of("expert-definition")).toEqual([]);
  } finally {
    await c.close();
  }
});

test("a computer that isn't the owner's, given a revision that changes the subject, grounds its new generation at its next question, which its old junior answers", async () => {
  const c = await computer();
  try {
    await setUpInstance(c);
    c.take(record({ revision: 2, definition: { ...DEFINITION, subject: "What may leave a computer, and why." } }));
    await new Promise((r) => setTimeout(r, 300));
    expect(trunkStarts(c)).toHaveLength(1);
    const junior = trunkStarts(c)[0]!.trunk;
    c.connect("s1");
    c.rights.tap("s1", c.sessionFolder, { type: "expert-rights", v: PROTOCOL_VERSION, experts: [{ name: "adr", subject: DEFINITION.subject, repo: "app", host: "Ada" }], server: SERVER });
    await until(() => c.lines("s1").some((l) => l.type === "expert-rights"));
    const told = await c.asking.ask({ type: "ask-expert", v: 1, token: "", session: "s1", cwd: c.sessionFolder, servers: [SERVER], expert: "adr", question: "Where is it held?", blocking: true, key: "toolu_x1" });
    expect(told.text).toContain("Expert adr answered question toolu_x1.");
    expect(forkStarts(c).filter((s) => s.trunk === junior).length).toBeGreaterThanOrEqual(2);
    await until(() => trunkStarts(c).length === 2);
    expect(c.claude().find((l) => l.kind === "trunk" && l.trunk === trunkStarts(c)[1]!.trunk && l.turn === 1)!.text).toContain("What may leave a computer, and why.");
  } finally {
    await c.close();
  }
});

test("the owner's edit is published on the record it last had; refused `edited-elsewhere`, the expert file says the record's definition, asking for no record, and the edit is kept beside it", async () => {
  const c = await computer();
  try {
    await publishOwn(c);
    writeExpertFile(c, { subject: "Edited here." });
    await c.experts.refresh("adr");
    await until(() => c.of("expert-definition").length === 2);
    expect(c.of("expert-definition")[1]).toMatchObject({ definition: { subject: "Edited here." }, basedOn: { expertRecordId: RECORD, revision: 1 } });
    c.take({ type: "expert-definition-result", v: PROTOCOL_VERSION, key: "adr", outcome: "refused", reason: "edited-elsewhere", expertRecordId: RECORD, revision: 2, definition: { ...DEFINITION, subject: "Edited elsewhere." } });
    await until(() => readJsonFile(c.file("experts", "adr.json")).subject === "Edited elsewhere.");
    const kept = fs.readdirSync(c.file("experts", "adr")).filter((f) => f.startsWith("definition-replaced-"));
    expect(kept).toHaveLength(1);
    expect(readJsonFile(c.file("experts", "adr", kept[0]!))).toMatchObject({ subject: "Edited here." });
    expect(c.of("expert-record-wanted")).toEqual([]);
    await new Promise((r) => setTimeout(r, 300));
    expect(c.of("expert-definition")).toHaveLength(2);
  } finally {
    await c.close();
  }
});

test("a hand-over (D13) both ways: the files swap, and the same expert keeps running with no new generation", async () => {
  const c = await computer();
  try {
    await setUpInstance(c);
    const expert = c.experts.running("adr")!.expert;
    c.take(directoryOf([entryOf({ owner: SAM, yours: true })]));
    await until(() => fs.existsSync(c.file("experts", "adr.json")) && !fs.existsSync(c.file("expert-instances", "adr.json")));
    expect(c.experts.running("adr")).toMatchObject({ from: "expert-file" });
    expect(readJsonFile(c.file("experts", "adr.json"))).toMatchObject({ name: "adr", repo: c.checkout, subject: DEFINITION.subject });
    c.take(directoryOf([entryOf({ owner: ADA })]));
    await until(() => fs.existsSync(c.file("expert-instances", "adr.json")) && !fs.existsSync(c.file("experts", "adr.json")));
    expect(fs.existsSync(c.file("experts", "adr", "expert-file-before-the-owner-changed.json"))).toBe(true);
    expect(c.experts.running("adr")).toMatchObject({ from: "instance-file" });
    expect(c.experts.running("adr")!.expert).toBe(expert);
    await new Promise((r) => setTimeout(r, 300));
    expect(trunkStarts(c)).toHaveLength(1);
  } finally {
    await c.close();
  }
});

test("deleted on the floor: the owner's instance stops, its trunks and folder go, and its expert file is moved to deleted-experts/ and never published again; a record gone from the directory deletes another computer's instance", async () => {
  const c = await computer();
  try {
    await publishOwn(c);
    await until(() => listed(c)?.[0]?.state === "ready", 30000);
    c.take({ type: "expert-deleted", v: PROTOCOL_VERSION, key: "adr", expertRecordId: RECORD, by: ADA });
    await until(() => !fs.existsSync(c.file("experts", "adr")));
    expect(fs.existsSync(c.file("experts", "adr.json"))).toBe(false);
    expect(fs.readdirSync(c.file("deleted-experts"))).toEqual([expect.stringMatching(/^adr-\d+\.json$/)]);
    expect(c.experts.running("adr")).toBe(null);
    c.reconnect();
    c.take(directoryOf([]));
    await new Promise((r) => setTimeout(r, 300));
    expect(c.of("expert-definition")).toHaveLength(1);

    const other = await computer();
    try {
      await setUpInstance(other);
      other.take(directoryOf([]));
      await until(() => !fs.existsSync(other.file("expert-instances", "adr.json")) && !fs.existsSync(other.file("experts", "adr")));
      expect(other.experts.running("adr")).toBe(null);
    } finally {
      await other.close();
    }
  } finally {
    await c.close();
  }
});

test("a removed expert file stops only this computer's instance: the office is sent nothing but the listing without it", async () => {
  const c = await computer();
  try {
    await publishOwn(c);
    await until(() => listed(c)?.[0]?.state === "ready", 30000);
    const before = c.sent.get(SERVER)!.length;
    fs.rmSync(c.file("experts", "adr.json"));
    await c.experts.refresh("adr");
    await until(() => listed(c)?.length === 0);
    expect(c.sent.get(SERVER)!.slice(before).map((m) => m.type)).toEqual(["expert-instance-states"]);
    expect(fs.existsSync(c.file("experts", "adr"))).toBe(true);
  } finally {
    await c.close();
  }
});

test("a proof that fails until its tries run out, on a computer that isn't the owner's, tells the owner once (D20), with its answer, or only that it was held when it looks like a secret; Try again grounds again", async () => {
  for (const [answer, sent] of [
    ["Forty-three.", { answer: "Forty-three." }],
    ["SECRET forty-three.", { answerHeld: true }],
  ] as const) {
    const rules: Rule[] = [{ kind: "fork", text: "Question proof-", reply: `<answer>${answer}</answer>` }, { kind: "judge", reply: "FAIL: not forty-two." }, ...BASE];
    const c = await computer({ rules, minuteMs: 20, before: installedInstance(SERVER, RECORD, { forkTimeLimitMinutes: 200, groundingTimeLimitMinutes: 200 }) });
    try {
      c.take(directoryOf([entryOf()]));
      await until(() => c.of("expert-proof-failed").length === 1, 40000);
      expect(c.of("expert-proof-failed")[0]).toEqual({ type: "expert-proof-failed", v: PROTOCOL_VERSION, key: "adr", expertRecordId: RECORD, revision: 1, ...sent });
      expect(trunkStarts(c)).toHaveLength(4);
      c.take(setUpMessage({ again: true }));
      await until(() => trunkStarts(c).length === 5);
      await new Promise((r) => setTimeout(r, 300));
      expect(c.of("expert-proof-failed")).toHaveLength(1);
    } finally {
      await c.close();
    }
  }
});

test("a key another person's expert has: the health log says so; the expert file survives a directory naming that record and its deletion, and the listing names that record `key-used-here` and nothing else of the key", async () => {
  const c = await computer();
  try {
    writeExpertFile(c);
    await c.experts.refresh("adr");
    c.take(directoryOf([entryOf({ expertRecordId: OTHER_RECORD })]));
    await until(() => c.of("expert-definition").length === 1);
    c.take({ type: "expert-definition-result", v: PROTOCOL_VERSION, key: "adr", outcome: "refused", reason: "key-taken" });
    await until(() => c.health().includes(KEY_TAKEN_WORDS));
    await until(() => listed(c)?.length === 1);
    expect(listed(c)).toEqual([{ key: "adr", expertRecordId: OTHER_RECORD, state: "failed", failure: { why: "key-used-here" } }]);
    c.take({ type: "expert-deleted", v: PROTOCOL_VERSION, key: "adr", expertRecordId: OTHER_RECORD, by: ADA });
    c.take(directoryOf([entryOf({ expertRecordId: OTHER_RECORD, revision: 2 })]));
    await new Promise((r) => setTimeout(r, 300));
    expect(fs.existsSync(c.file("experts", "adr.json"))).toBe(true);
    expect(c.experts.running("adr")).toMatchObject({ from: "expert-file" });
  } finally {
    await c.close();
  }
});

test("ownership is the office's word alone: a directory entry marked `yours` whose owner id isn't this computer's Claude account (sign-in on) leaves the expert file where it is", async () => {
  const c = await computer();
  try {
    await publishOwn(c, [entryOf({ owner: { id: "person:7", name: "Sam" }, yours: true })]);
    await new Promise((r) => setTimeout(r, 300));
    expect(fs.existsSync(c.file("experts", "adr.json"))).toBe(true);
    expect(fs.existsSync(c.file("expert-instances", "adr.json"))).toBe(false);
  } finally {
    await c.close();
  }
});

test("the X1 guard: a set-up asked for by anyone but this runner's own account starts no clone, grounding or fork", async () => {
  const c = await computer({ checkout: null });
  try {
    c.take(directoryOf([entryOf()]));
    c.take(setUpMessage({ by: ADA }));
    await new Promise((r) => setTimeout(r, 300));
    expect(c.cloned).toEqual([]);
    expect(c.claude()).toEqual([]);
    expect(c.of("expert-record-wanted")).toEqual([]);
    expect(c.logs).toContain(`${SERVER} asked to set up expert adr for Ada, not this runner's own account, so nothing starts`);
  } finally {
    await c.close();
  }
});

test("a new revision reaches only the instance of its record: an instance set up from another office's record of the key is untouched", async () => {
  const c = await computer({ servers: [SERVER, OTHER_SERVER], before: installedInstance(OTHER_SERVER, OTHER_RECORD) });
  try {
    const before = fs.readFileSync(c.file("experts", "adr", "expert-records.json"), "utf8");
    c.take(directoryOf([entryOf()]));
    c.take(record({ revision: 2, definition: { ...DEFINITION, subject: "Another office's." } }));
    await new Promise((r) => setTimeout(r, 300));
    expect(fs.readFileSync(c.file("experts", "adr", "expert-records.json"), "utf8")).toBe(before);
    expect(c.experts.running("adr")).toMatchObject({ from: "instance-file", file: { subject: DEFINITION.subject } });
    expect(listed(c)).toEqual([]);
  } finally {
    await c.close();
  }
});
