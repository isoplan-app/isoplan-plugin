// What an instance's forks learned, waiting to be sent to its expert records (isoplan-app#366, A3):
// kept before it is added to the junior's trunk, sent until the office answers, checked before it
// leaves, with this computer's expert stack (expert-stack-fixture.ts) against a stand-in office.

import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { PROTOCOL_VERSION } from "@isoplan/protocol";
import { expect, test, vi } from "vitest";
import { tempRoot } from "../data-layer/fixture.js";
import { C1, until } from "./expert-fixture.js";
import { computer, DEFINITION, entryOf, installedInstance, OTHER_RECORD, OTHER_SERVER, readJsonFile, RECORD, SERVER, sharingDirectoryOf, writeExpertFile, type Computer, type ComputerOptions } from "./expert-stack-fixture.js";
import { askHere, LEARNED, learns, LEARNING, officeSequence, once, receivedOf, waitingOf } from "./what-was-learned-fixture.js";
import { MAX_UNANSWERED } from "./what-was-learned-link.js";
import type { WaitingFile } from "./what-was-learned-waiting-to-be-sent.js";

// The empty folder git runs with as its hooks (handoff/take.ts noHooks) is made in the Claude folder: a temp one, never this machine's.
vi.stubEnv("CLAUDE_CONFIG_DIR", path.join(tempRoot(), "claude"));
vi.setConfig({ testTimeout: 60000 });

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** This computer with a ready instance of RECORD from SERVER, an office that shares what instances learn. */
async function instance(o: ComputerOptions = {}) {
  const c = await computer({ rules: LEARNING, before: installedInstance(SERVER, RECORD), ...o });
  c.take(sharingDirectoryOf([entryOf()]));
  await until(() => c.of("expert-instance-states").at(-1)?.instances[0]?.state === "ready", 30000);
  return c;
}

const learnedSent = (c: Computer, server = SERVER) => c.of("expert-instance-learned", server);
const answer = (c: Computer, id: string, outcome: { outcome: "removed" } | { outcome: "refused"; reason: "record-gone" | "not-an-instance-here" } | { outcome: "kept"; arrivalNumber: number }, record = RECORD, server = SERVER) =>
  c.take({ type: "expert-instance-learned-received", v: PROTOCOL_VERSION, key: "adr", expertRecordId: record, id, ...outcome }, server);
const published = (c: Computer, record: string, server = SERVER) => c.take({ type: "expert-definition-result", v: PROTOCOL_VERSION, key: "adr", outcome: "published", expertRecordId: record, revision: 1 }, server);

test("A3: what a fork learned is in the waiting file, with its id and each file's commit, as its addition starts", async () => {
  const c = await instance();
  try {
    const seen = path.join(c.root, "waiting-as-the-addition-came.json");
    c.rules([{ kind: "append", copy: { from: c.file("experts", "adr", "what-was-learned-waiting-to-be-sent.json"), to: seen }, reply: "added", context: 60000 }, ...LEARNING]);
    expect(await askHere(c, "x-1")).toMatchObject({ kind: "answered" });
    await once(() => fs.existsSync(seen));
    expect(readJsonFile<WaitingFile>(seen).things).toEqual([{ id: expect.stringMatching(UUID), text: LEARNED, files: [{ path: "src/relay.ts", commit: C1 }], learnedAt: expect.any(String), generation: 1, firstLine: LEARNED, parts: { [RECORD]: { server: SERVER } } }]);
    expect(c.claude().find((l) => l.kind === "append" && l.turn)!.text).toContain(LEARNED);
  } finally {
    await c.close();
  }
});

test("sent until the office answers, across a restart and offline time: nothing while the link is down, after the new runner's first listing, again with its id after a reconnect; kept, it moves to the received file", async () => {
  const c = await instance();
  c.up.set(SERVER, false);
  expect(await askHere(c, "x-1")).toMatchObject({ kind: "answered" });
  await once(() => waitingOf(c).length === 1);
  const [thing] = waitingOf(c);
  expect(learnedSent(c)).toEqual([]);
  await c.close();
  const again = await computer({ root: c.root, rules: LEARNING });
  try {
    expect(learnedSent(again)).toEqual([]);
    again.take(sharingDirectoryOf([entryOf()]));
    await once(() => learnedSent(again).length === 1);
    expect(learnedSent(again)).toEqual([{ type: "expert-instance-learned", v: PROTOCOL_VERSION, key: "adr", expertRecordId: RECORD, id: thing!.id, text: LEARNED, files: [{ path: "src/relay.ts", commit: C1 }], learnedAt: thing!.learnedAt }]);
    const sent = again.sent.get(SERVER)!;
    expect(sent.findIndex((m) => m.type === "expert-instance-states")).toBeLessThan(sent.findIndex((m) => m.type === "expert-instance-learned"));
    again.reconnect();
    again.take(sharingDirectoryOf([entryOf()]));
    await once(() => learnedSent(again).length === 2);
    expect(learnedSent(again)[1]!.id).toBe(thing!.id);
    answer(again, thing!.id, { outcome: "kept", arrivalNumber: 1 });
    await once(() => waitingOf(again).length === 0 && receivedOf(again)?.keptNotYetReceived.length === 1);
    expect(receivedOf(again)!.keptNotYetReceived).toEqual([expect.objectContaining({ id: thing!.id, arrivalNumber: 1, text: LEARNED })]);
  } finally {
    await again.close();
  }
});

test("answered kept, it is written to the received file before it leaves the waiting file: a stop between the two writes leaves it in one", async () => {
  const c = await instance();
  try {
    await askHere(c, "x-1");
    await once(() => learnedSent(c).length === 1 && /question id=x-1 .* learned=added/.test(c.health()));
    const [thing] = learnedSent(c);
    // The received file can't be written, as if the runner stopped before it: a folder where its temporary file goes.
    const blocked = `${c.file("experts", "adr", "what-was-learned-in-the-expert-record.json")}.${process.pid}.tmp`;
    fs.mkdirSync(blocked);
    answer(c, thing!.id, { outcome: "kept", arrivalNumber: 1 });
    await once(() => c.logs.some((l) => l.includes("couldn't write what it learned")));
    await c.learned().written();
    expect(waitingOf(c).map((t) => t.id)).toEqual([thing!.id]);
    fs.rmSync(blocked, { recursive: true });
  } finally {
    await c.close();
  }
});

test("a thing matching a secret or personal-data pattern is never sent: the health log names the pattern, its trunk has it, and it leaves the waiting file once its addition ended; a secret answer still adds what it learned; while the patterns can't be read nothing goes, and it goes once they can", async () => {
  const release = path.join(tempRoot(), "release");
  const email = "Rule or fact: ask ada@example.com about the relay. Files: src/relay.ts";
  const secret = "Rule or fact: the relay's SECRET is kept there. Files: src/relay.ts";
  const c = await instance({ rules: [learns("x-1", email), learns("x-2", secret, { reply: `<answer>The SECRET is in the relay.</answer>\n<learned>${secret}</learned>` }), { kind: "append", text: "ada@example.com", until: release, reply: "added", context: 60000 }, ...LEARNING] });
  try {
    await askHere(c, "x-1");
    await once(() => waitingOf(c)[0]?.staysOnThisComputer !== undefined);
    expect(waitingOf(c)).toEqual([expect.objectContaining({ text: email, parts: {}, staysOnThisComputer: { pattern: "email address" } })]);
    await once(() => /learned id=\S+ kept="on this computer only"/.test(c.health()));
    expect(c.health()).toContain(`learned id=${waitingOf(c)[0]!.id} kept="on this computer only" why="it matches the personal-data pattern \\"email address\\""`);
    fs.writeFileSync(release, "");
    await once(() => waitingOf(c).length === 0);
    expect(c.claude().filter((l) => l.kind === "append" && l.turn).map((l) => l.text)).toEqual([expect.stringContaining("ada@example.com")]);

    expect(await askHere(c, "x-2")).toEqual({ kind: "refused", code: "EXPERT_FORK_FAILED", detail: "its answer looked like it held a secret, so it wasn't sent" });
    await once(() => c.claude().filter((l) => l.kind === "append" && l.turn).length === 2 && waitingOf(c).length === 0);
    expect(c.claude().filter((l) => l.kind === "append" && l.turn)[1]!.text).toContain("the relay's SECRET is kept there");
    expect(c.health()).toMatch(/learned id=\S+ kept="on this computer only" why="it matches the secret pattern \\"test secret\\""/);
    expect(learnedSent(c)).toEqual([]);

    fs.writeFileSync(c.file("personal-data-patterns.json"), "{");
    await askHere(c, "x-3");
    await once(() => c.logs.some((l) => l.includes("the secret or personal-data patterns can't be read, so nothing it learned goes to")));
    expect(waitingOf(c)).toEqual([expect.objectContaining({ text: LEARNED, parts: { [RECORD]: { server: SERVER } } })]);
    expect(learnedSent(c)).toEqual([]);
    fs.writeFileSync(c.file("personal-data-patterns.json"), JSON.stringify({ patterns: [] }));
    c.reconnect();
    c.take(sharingDirectoryOf([entryOf()]));
    await once(() => learnedSent(c).length === 1);
    expect(learnedSent(c)[0]!.text).toBe(LEARNED);
  } finally {
    await c.close();
  }
});

test("answered removed or record-gone, that record's part goes; refused not-an-instance-here it stays, sent again after the next listing and on the timer", async () => {
  const rules = [learns("x-1", "Rule or fact: one. Files: src/relay.ts"), learns("x-2", "Rule or fact: two. Files: src/relay.ts"), learns("x-3", "Rule or fact: three. Files: src/relay.ts"), ...LEARNING];
  const c = await instance({ rules });
  try {
    for (const id of ["x-1", "x-2", "x-3"]) await askHere(c, id);
    await once(() => learnedSent(c).length === 3);
    const [one, two, three] = learnedSent(c).map((m) => m.id);
    answer(c, one!, { outcome: "removed" });
    answer(c, two!, { outcome: "refused", reason: "record-gone" });
    answer(c, three!, { outcome: "refused", reason: "not-an-instance-here" });
    await once(() => waitingOf(c).length === 1);
    expect(waitingOf(c)[0]).toMatchObject({ id: three, parts: { [RECORD]: { server: SERVER } } });
    c.reconnect();
    c.take(sharingDirectoryOf([entryOf()]));
    await once(() => learnedSent(c).length === 4);
    expect(learnedSent(c)[3]!.id).toBe(three);
  } finally {
    await c.close();
  }
  const timed = await instance({ rules, checkMs: 300 });
  try {
    await askHere(timed, "x-3");
    await once(() => learnedSent(timed).length === 1);
    answer(timed, learnedSent(timed)[0]!.id, { outcome: "refused", reason: "not-an-instance-here" });
    await once(() => learnedSent(timed).length >= 2);
    expect(new Set(learnedSent(timed).map((m) => m.id)).size).toBe(1);
  } finally {
    await timed.close();
  }
});

test("an expert the office keeps refusing as no instance here, with more things waiting than may be unanswered, holds back neither another expert's sends nor its own sending again", async () => {
  const things = Array.from({ length: MAX_UNANSWERED }, (_, i) => {
    const text = `Rule or fact: refused ${i}. Files: src/relay.ts`;
    return { id: randomUUID(), text, files: [{ path: "src/relay.ts", commit: C1 }], learnedAt: new Date(Date.now() - 60000 + i).toISOString(), generation: 1, firstLine: text, parts: { [RECORD]: { server: SERVER } }, added: true };
  });
  const c = await computer({
    rules: LEARNING,
    checkMs: 300,
    before: (p) => {
      installedInstance(SERVER, RECORD)(p);
      installedInstance(SERVER, OTHER_RECORD, {}, { ...DEFINITION, key: "bdr" })(p);
      fs.writeFileSync(p.file("experts", "adr", "what-was-learned-waiting-to-be-sent.json"), JSON.stringify({ version: 1, things }));
    },
  });
  // The office lists no instance of adr here: it refuses each of its things.
  let refused = 0;
  const office = setInterval(() => {
    for (const m of learnedSent(c).slice(refused)) if (m.expertRecordId === RECORD) answer(c, m.id, { outcome: "refused", reason: "not-an-instance-here" });
    refused = learnedSent(c).length;
  }, 50);
  try {
    c.take(sharingDirectoryOf([entryOf(), entryOf({ key: "bdr", expertRecordId: OTHER_RECORD })]));
    await once(() => ["adr", "bdr"].every((key) => c.of("expert-instance-states").at(-1)?.instances.find((i) => i.key === key)?.state === "ready"), 30000);
    await once(() => learnedSent(c).length >= MAX_UNANSWERED);
    await askHere(c, "x-1", "bdr");
    await once(() => learnedSent(c).some((m) => m.expertRecordId === OTHER_RECORD));
    await once(() => learnedSent(c).filter((m) => m.expertRecordId === RECORD).length > MAX_UNANSWERED);
  } finally {
    clearInterval(office);
    await c.close();
  }
});

test("one writer: two forks finishing together, and two offices answering together (one kept, one record-gone), leave every thing and part where it should be", async () => {
  const c = await computer({ servers: [SERVER, OTHER_SERVER], rules: [learns("x-1", "Rule or fact: one. Files: src/relay.ts"), learns("x-2", "Rule or fact: two. Files: src/relay.ts"), ...LEARNING] });
  try {
    writeExpertFile(c);
    await c.experts.refresh("adr");
    for (const [server, record] of [[SERVER, RECORD], [OTHER_SERVER, OTHER_RECORD]] as const) {
      c.take(sharingDirectoryOf([]), server);
      await once(() => c.of("expert-definition", server).length === 1);
      published(c, record, server);
    }
    await once(() => [SERVER, OTHER_SERVER].every((s) => c.of("expert-instance-states", s).at(-1)?.instances[0]?.state === "ready"), 30000);
    await Promise.all([askHere(c, "x-1"), askHere(c, "x-2")]);
    await once(() => learnedSent(c, SERVER).length === 2 && learnedSent(c, OTHER_SERVER).length === 2);
    expect(waitingOf(c).map((t) => Object.keys(t.parts).sort())).toEqual([[RECORD, OTHER_RECORD].sort(), [RECORD, OTHER_RECORD].sort()]);
    const ids = learnedSent(c, SERVER).map((m) => m.id);
    ids.forEach((id, i) => {
      answer(c, id, { outcome: "kept", arrivalNumber: i + 1 });
      answer(c, id, { outcome: "refused", reason: "record-gone" }, OTHER_RECORD, OTHER_SERVER);
    });
    await once(() => waitingOf(c).length === 0 && receivedOf(c)?.keptNotYetReceived.length === 2);
    expect(receivedOf(c)!.keptNotYetReceived.map((k) => [k.id, k.arrivalNumber])).toEqual(ids.map((id, i) => [id, i + 1]));
    expect(receivedOf(c, OTHER_RECORD)).toBeUndefined();
  } finally {
    await c.close();
  }
});

test("learned before its expert file was first published: kept with no part, and sent to the record once the publish and the listing after it went", async () => {
  const c = await computer({ rules: LEARNING });
  try {
    writeExpertFile(c);
    await c.experts.refresh("adr");
    await until(() => c.experts.running("adr")?.expert.hosted().state === "ready", 30000);
    await askHere(c, "x-1");
    await once(() => waitingOf(c)[0]?.waitingForARecord === true);
    expect(waitingOf(c)[0]!.parts).toEqual({});
    c.take(sharingDirectoryOf([]));
    await once(() => c.of("expert-definition").length === 1);
    expect(learnedSent(c)).toEqual([]);
    published(c, RECORD);
    await once(() => learnedSent(c).length === 1);
    expect(learnedSent(c)[0]).toMatchObject({ expertRecordId: RECORD, text: LEARNED });
    const sent = c.sent.get(SERVER)!;
    expect(sent.findLastIndex((m) => m.type === "expert-instance-states")).toBeLessThan(sent.findIndex((m) => m.type === "expert-instance-learned"));
    // The office keeps it; nothing is left waiting.
    const seq = officeSequence();
    seq.serving(c)();
    await once(() => waitingOf(c).length === 0);
  } finally {
    await c.close();
  }
});
