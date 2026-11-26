// What this computer has of each expert record's sequence of things learned (isoplan-app#366, A2):
// taken by arrival number and chain, kept across restarts, rebuilt from a restored office server,
// kept per record. This computer's expert stack (expert-stack-fixture.ts) against a stand-in office
// (what-was-learned-fixture.ts) that keeps the sequence as the office server does.

import fs from "node:fs";
import path from "node:path";
import { PROTOCOL_VERSION, type ExpertLearnedSinceMessage } from "@isoplan/protocol";
import { expect, test, vi } from "vitest";
import { tempRoot } from "../data-layer/fixture.js";
import { C1, until, type Rule } from "./expert-fixture.js";
import type { SavedExpert } from "./expert-state.js";
import { computer, entryOf, installedInstance, OTHER_RECORD, RECORD, SERVER, sharingDirectoryOf, writeExpertFile, type Computer, type ComputerOptions } from "./expert-stack-fixture.js";
import { askHere, learns, LEARNING, officeSequence, once, receivedOf, waitingOf } from "./what-was-learned-fixture.js";
import { chainOver } from "./what-was-learned-in-the-expert-record.js";

// The empty folder git runs with as its hooks (handoff/take.ts noHooks) is made in the Claude folder: a temp one, never this machine's.
vi.stubEnv("CLAUDE_CONFIG_DIR", path.join(tempRoot(), "claude"));
vi.setConfig({ testTimeout: 60000 });

async function instance(o: ComputerOptions = {}) {
  const c = await computer({ rules: LEARNING, before: installedInstance(SERVER, RECORD), ...o });
  c.take(sharingDirectoryOf([entryOf()]));
  await until(() => c.of("expert-instance-states").at(-1)?.instances[0]?.state === "ready", 30000);
  return c;
}

const elsewhere = (text: string) => ({ text: `Rule or fact: ${text}. Files: src/relay.ts`, files: [{ path: "src/relay.ts", commit: C1 }] });
const asks = (c: Computer) => c.of("expert-learned-wanted-after");
const learnedSent = (c: Computer) => c.of("expert-instance-learned");
const questionOf = (c: Computer, id: string) => c.claude().find((l) => l.kind === "fork" && l.turn === 1 && l.text?.includes(`(${id})`))?.text ?? "";
const reconnect = (c: Computer) => (c.reconnect(), c.take(sharingDirectoryOf([entryOf()])));
// The key's junior as state.json has it, once it is there.
const juniorOf = (c: Computer) => {
  try {
    return (JSON.parse(fs.readFileSync(c.file("experts", "adr", "state.json"), "utf8")) as SavedExpert).generations.find((g) => g.state === "junior");
  } catch {
    return undefined;
  }
};

test("taken only continuing from its last number; its number and chain are kept across a restart, and asked after on the next connection", async () => {
  const c = await instance();
  const seq = officeSequence();
  seq.learned(elsewhere("one"));
  seq.learned(elsewhere("two"));
  try {
    seq.serving(c)();
    await once(() => receivedOf(c)?.lastArrivalNumberReceived === 2);
    expect(receivedOf(c)!.entries.map((e) => [e.arrivalNumber, e.text])).toEqual([[1, elsewhere("one").text], [2, elsewhere("two").text]]);
    seq.learned(elsewhere("three"));
    seq.learned(elsewhere("four"));
    // A push from 3, past what this computer has: left, and asked for again after its own number.
    c.take(seq.after(3));
    await once(() => asks(c).length === 2);
    expect(asks(c)[1]).toMatchObject({ afterArrivalNumber: 2, chain: chainOver("", seq.entries.slice(0, 2)) });
    expect(receivedOf(c)!.lastArrivalNumberReceived).toBe(2);
    // A push repeating what it has, from before its last number: left, nothing taken twice, and asked for again.
    c.take(seq.after(1));
    await once(() => asks(c).length === 3);
    expect(asks(c)[2]).toMatchObject({ afterArrivalNumber: 2 });
    expect(receivedOf(c)!.entries.map((e) => e.arrivalNumber)).toEqual([1, 2]);
  } finally {
    await c.close();
  }
  const again = await computer({ root: c.root, rules: LEARNING });
  try {
    again.take(sharingDirectoryOf([entryOf()]));
    await once(() => asks(again).length === 1);
    expect(asks(again)).toEqual([{ type: "expert-learned-wanted-after", v: PROTOCOL_VERSION, key: "adr", expertRecordId: RECORD, afterArrivalNumber: 2, chain: chainOver("", seq.entries.slice(0, 2)) }]);
  } finally {
    await again.close();
  }
});

test("its own thing, pushed back by the office with its number, isn't carried in its own junior's next question: its trunk holds it", async () => {
  const c = await instance({ rules: [learns("x-1", "Rule or fact: its own one. Files: src/relay.ts"), ...LEARNING] });
  const seq = officeSequence();
  try {
    await once(() => asks(c).length === 1);
    const serve = seq.serving(c);
    serve();
    await askHere(c, "x-1");
    await once(() => learnedSent(c).length === 1 && /question id=x-1 .* learned=added/.test(c.health()));
    serve();
    await once(() => receivedOf(c)?.entries.some((e) => e.learnedHere) === true);
    await askHere(c, "x-2");
    expect(questionOf(c, "x-2")).not.toContain("its own one");
  } finally {
    await c.close();
  }
});

test("a restored office whose last is below this computer's: answered from 0 in pages and rebuilt; its own things the office no longer names are sent again, removed ones not; its junior's pickedUpTo is mapped by id, so it carries what is new to it", async () => {
  const own = "Rule or fact: its own one. Files: src/relay.ts";
  const removed = "Rule or fact: its own, removed. Files: src/relay.ts";
  const c = await instance({ rules: [learns("x-1", own), learns("x-2", removed), ...LEARNING] });
  const seq = officeSequence();
  const e1 = seq.learned(elsewhere("one"));
  try {
    const serve = seq.serving(c);
    serve();
    await askHere(c, "x-1");
    await once(() => learnedSent(c).length === 1);
    serve();
    await askHere(c, "x-2");
    await once(() => learnedSent(c).length === 2);
    serve();
    const [ownId, removedId] = learnedSent(c).map((m) => m.id);
    seq.remove(removedId!);
    c.take(seq.after(3));
    await once(() => receivedOf(c)?.lastArrivalNumberReceived === 4 && waitingOf(c).length === 0);
    expect(c.experts.running("adr")!.expert.hosted().state).toBe("ready");

    // Restored from a copy holding only the first: two more arrive there before this computer's reconnect.
    const restored = officeSequence();
    restored.learned({ ...seq.entries[e1 - 1]!, ...elsewhere("one") , id: seq.entries[e1 - 1]!.id });
    restored.learned(elsewhere("new two"));
    restored.learned(elsewhere("new three"));
    const asked = asks(c).length;
    const serveRestored = restored.serving(c, { page: 2, fromNow: true });
    reconnect(c);
    await once(() => asks(c).length === asked + 1);
    expect(asks(c).at(-1)).toMatchObject({ afterArrivalNumber: 4 });
    serveRestored();
    await once(() => receivedOf(c)?.lastArrivalNumberReceived === 3);
    expect(receivedOf(c)!.entries.map((e) => e.text)).toEqual([elsewhere("one").text, elsewhere("new two").text, elsewhere("new three").text]);
    expect(receivedOf(c)!.removed.map((x) => x.id)).toContain(removedId);
    await once(() => learnedSent(c).length === 3);
    expect(learnedSent(c)[2]!.id).toBe(ownId);
    expect(waitingOf(c).map((t) => t.id)).toEqual([ownId]);

    // Its junior had taken the sequence into account up to 2; of the rebuilt one, only "one", at 1, was before.
    await once(() => juniorOf(c)?.pickedUpTo[RECORD] === 1);
    await askHere(c, "x-3");
    expect(questionOf(c, "x-3")).toContain("new two");
    expect(questionOf(c, "x-3")).toContain("new three");
  } finally {
    await c.close();
  }
});

test("its instance file removed and put back in one runner's life: a restored office's rebuild is written to its state by the expert running now, never by one stopped before", async () => {
  const c = await instance({ rules: [learns("x-1", "Rule or fact: its own one. Files: src/relay.ts"), ...LEARNING] });
  const seq = officeSequence();
  seq.learned(elsewhere("one"));
  try {
    seq.serving(c)();
    await once(() => receivedOf(c)?.lastArrivalNumberReceived === 1);
    const file = c.file("expert-instances", "adr.json");
    const text = fs.readFileSync(file, "utf8");
    for (let n = 0; n < 3; n++) {
      fs.rmSync(file);
      await c.experts.refresh("adr");
      fs.writeFileSync(file, text);
      await c.experts.refresh("adr");
    }
    await once(() => c.experts.running("adr")?.expert.hosted().state === "ready");
    // What this question adds to the junior's trunk only the expert running now holds.
    await askHere(c, "x-1");
    await once(() => juniorOf(c)?.addedToItsTrunk.length === 2);

    // Restored with another thing at 1: rebuilt, and the junior has taken none of it into account.
    const restored = officeSequence();
    restored.learned(elsewhere("another one"));
    const asked = asks(c).length;
    const serveRestored = restored.serving(c, { fromNow: true });
    reconnect(c);
    await once(() => asks(c).length === asked + 1);
    serveRestored();
    await once(() => juniorOf(c)?.pickedUpTo[RECORD] === 0);
    await new Promise((r) => setTimeout(r, 300));
    expect(juniorOf(c)!.addedToItsTrunk).toHaveLength(2);
    expect(c.logs.filter((l) => l.includes("couldn't write its state"))).toEqual([]);
  } finally {
    await c.close();
  }
});

test("an office restored from a copy taken between its kept answer and the push: what the office no longer holds at its number is sent again", async () => {
  const c = await instance({ rules: [learns("x-1", "Rule or fact: its own one. Files: src/relay.ts"), learns("x-2", "Rule or fact: its own two. Files: src/relay.ts"), ...LEARNING] });
  const seq = officeSequence();
  seq.learned(elsewhere("one"));
  try {
    seq.serving(c)();
    await once(() => receivedOf(c)?.lastArrivalNumberReceived === 1);
    const copy = officeSequence();
    copy.learned({ ...elsewhere("one"), id: seq.entries[0]!.id });

    // Kept at 2, and the office restored before it pushed it: its answer goes on from 1 but its last is 1.
    await askHere(c, "x-1");
    await once(() => learnedSent(c).length === 1);
    const first = learnedSent(c)[0]!;
    seq.learned(first);
    c.take(seq.received(first.id));
    await once(() => receivedOf(c)?.keptNotYetReceived.length === 1 && waitingOf(c).length === 0);
    const serveCopy = copy.serving(c, { fromNow: true });
    reconnect(c);
    await once(() => asks(c).length === 2);
    serveCopy();
    await once(() => learnedSent(c).length === 2);
    expect(learnedSent(c)[1]!.id).toBe(first.id);
    serveCopy();
    await once(() => receivedOf(c)?.entries.some((e) => e.id === first.id && e.learnedHere) === true);

    // Kept at 3 by the copy, and restored again to before it, with another thing at 3 since.
    await askHere(c, "x-2");
    await once(() => learnedSent(c).length === 3);
    const second = learnedSent(c)[2]!;
    const before = officeSequence();
    for (const e of copy.entries) if (e.kind === "learned") before.learned(e);
    copy.learned(second);
    c.take(copy.received(second.id));
    before.learned(elsewhere("another at three"));
    await once(() => receivedOf(c)?.keptNotYetReceived.length === 1);
    const serveBefore = before.serving(c, { fromNow: true });
    reconnect(c);
    await once(() => asks(c).length === 3);
    serveBefore();
    await once(() => learnedSent(c).length === 4);
    expect(learnedSent(c)[3]!.id).toBe(second.id);
  } finally {
    await c.close();
  }
});

test("a message whose chain isn't this computer's: one ask after its own number and chain, then a rebuild from the office's startedAgain, not a loop; a mismatch that goes on stops the asks once it has asked again three times on that connection, logged once", async () => {
  const c = await instance();
  const seq = officeSequence();
  seq.learned(elsewhere("one"));
  try {
    seq.serving(c)();
    await once(() => receivedOf(c)?.lastArrivalNumberReceived === 1);
    // The office's history differs from here: another thing at 1.
    const other = officeSequence();
    other.learned(elsewhere("another one"));
    other.learned(elsewhere("two"));
    const serveOther = other.serving(c, { fromNow: true });
    c.take({ ...other.after(1), chain: "f".repeat(64) });
    await once(() => asks(c).length === 2);
    expect(asks(c)[1]).toMatchObject({ afterArrivalNumber: 1, chain: receivedOf(c)!.chain });
    serveOther();
    await once(() => receivedOf(c)?.entries.map((e) => e.text).join() === [elsewhere("another one").text, elsewhere("two").text].join());
    await new Promise((r) => setTimeout(r, 300));
    expect(asks(c)).toHaveLength(2);

    // An office whose answers never follow on.
    const bad = (n: number): ExpertLearnedSinceMessage => ({ ...other.after(2), entries: [{ kind: "learned", arrivalNumber: 3, id: crypto.randomUUID(), text: `Rule or fact: bad ${n}.`, files: [{ path: "src/relay.ts" }], learnedAt: new Date().toISOString() }], chain: "e".repeat(64), lastArrivalNumber: 3 });
    for (let n = 1; n <= 5; n++) {
      c.take(bad(n));
      await new Promise((r) => setTimeout(r, 100));
    }
    await once(() => c.logs.some((l) => l.includes("isn't asked for again until the next connection")));
    expect(asks(c)).toHaveLength(4);
    expect(c.logs.filter((l) => l.includes("isn't asked for again until the next connection"))).toHaveLength(1);
  } finally {
    await c.close();
  }
});

test("kept per record: the same key's file tied to a new record on the same office starts it from 0 with nothing of the old one, whose parts go from both files", async () => {
  const c = await computer({ rules: LEARNING });
  try {
    writeExpertFile(c);
    await c.experts.refresh("adr");
    c.take(sharingDirectoryOf([]));
    await once(() => c.of("expert-definition").length === 1);
    c.take({ type: "expert-definition-result", v: PROTOCOL_VERSION, key: "adr", outcome: "published", expertRecordId: RECORD, revision: 1 });
    await once(() => asks(c).length === 1);
    const seq = officeSequence();
    seq.learned(elsewhere("one"));
    seq.serving(c)();
    await once(() => receivedOf(c)?.lastArrivalNumberReceived === 1);
    c.up.set(SERVER, false);
    await askHere(c, "x-1");
    await once(() => waitingOf(c)[0]?.parts[RECORD] !== undefined);

    // Its record goes from the directory: on the next connection it is published again, and the office makes it a new record.
    c.up.set(SERVER, true);
    c.reconnect();
    c.take(sharingDirectoryOf([entryOf({ expertRecordId: OTHER_RECORD, yours: true })]));
    await once(() => c.of("expert-definition").length === 2);
    c.take({ type: "expert-definition-result", v: PROTOCOL_VERSION, key: "adr", outcome: "published", expertRecordId: OTHER_RECORD, revision: 1 });
    await once(() => receivedOf(c) === undefined && waitingOf(c).every((t) => !t.parts[RECORD]));
    await once(() => asks(c).some((m) => m.expertRecordId === OTHER_RECORD));
    expect(asks(c).find((m) => m.expertRecordId === OTHER_RECORD)).toMatchObject({ afterArrivalNumber: 0, chain: "" });
  } finally {
    await c.close();
  }
});

test("a first instance's grounding waits for its record's catch-up, still coming in pages, before its third turn carries what it brought", async () => {
  const third: Rule = { kind: "trunk", text: "Before you, this expert's instances learned", reply: "ready", context: 52000 };
  const c = await computer({ rules: [third, ...LEARNING], before: installedInstance(SERVER, RECORD) });
  const seq = officeSequence();
  seq.learned(elsewhere("one"));
  seq.learned(elsewhere("two"));
  try {
    await once(() => c.claude().some((l) => l.kind === "trunk" && l.turn === 2));
    c.take(sharingDirectoryOf([entryOf()]));
    await once(() => asks(c).length === 1);
    const [first, second] = seq.answer(asks(c)[0]!, 1);
    c.take(first!);
    await new Promise((r) => setTimeout(r, 300));
    c.take(second!);
    await once(() => c.experts.running("adr")?.expert.hosted().state === "ready", 30000);
    const turn = c.claude().find((l) => l.kind === "trunk" && l.text?.includes("Before you, this expert's instances learned"))?.text ?? "";
    expect(turn).toContain(elsewhere("one").text);
    expect(turn).toContain(elsewhere("two").text);
  } finally {
    await c.close();
  }
});
