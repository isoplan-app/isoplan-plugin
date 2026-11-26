// What instances learn, over one office's link (protocol 0.18.0, isoplan-app#366): its gate, and
// that everything goes after a listing, with this computer's expert stack (expert-stack-fixture.ts)
// against a stand-in office (what-was-learned-fixture.ts).

import path from "node:path";
import { PROTOCOL_VERSION } from "@isoplan/protocol";
import { expect, test, vi } from "vitest";
import { tempRoot } from "../data-layer/fixture.js";
import { C1, until } from "./expert-fixture.js";
import { ADA, computer, directoryOf, entryOf, installedInstance, OTHER_RECORD, RECORD, SAM, SERVER, sharingDirectoryOf, writeExpertFile, type Computer } from "./expert-stack-fixture.js";
import { askHere, LEARNING, officeSequence, once, receivedOf, waitingOf } from "./what-was-learned-fixture.js";

// The empty folder git runs with as its hooks (handoff/take.ts noHooks) is made in the Claude folder: a temp one, never this machine's.
vi.stubEnv("CLAUDE_CONFIG_DIR", path.join(tempRoot(), "claude"));
vi.setConfig({ testTimeout: 60000 });

const FAMILY = ["expert-instance-learned", "expert-learned-wanted-after"];
const family = (c: Computer) => c.sent.get(SERVER)!.filter((m) => FAMILY.includes(m.type));
const asks = (c: Computer) => c.of("expert-learned-wanted-after");
const settle = () => new Promise((r) => setTimeout(r, 300));
const ready = (c: Computer) => until(() => c.of("expert-instance-states").at(-1)?.instances.find((i) => i.key === "adr")?.state === "ready", 30000);
// Another expert of the office, whose set-up here is cloning: its record never comes.
const OTHER = entryOf({ key: "other", expertRecordId: OTHER_RECORD, project: { id: "github.com/acme/other", name: "other" }, owner: ADA });
const setUpOther = (c: Computer) => c.take({ type: "set-up-expert-instance", v: PROTOCOL_VERSION, request: "r-1", key: "other", expertRecordId: OTHER_RECORD, by: SAM });

test("nothing of what instances learn goes to an office whose first directory doesn't say it shares it: what was learned waits, and runner.log and the health log say so once", async () => {
  const c = await computer({ rules: LEARNING, before: installedInstance(SERVER, RECORD) });
  try {
    c.take(directoryOf([entryOf()]));
    await ready(c);
    await askHere(c, "x-1");
    await once(() => waitingOf(c).length === 1);
    c.take(directoryOf([entryOf({ revision: 2 })]));
    await settle();
    expect(family(c)).toEqual([]);
    expect(c.logs.filter((l) => l === `${SERVER} doesn't share what instances of experts learn yet: update its Isoplan server`)).toHaveLength(1);
    expect(c.health()).toContain(`learned server=${SERVER} shared=no why=`);
    expect(waitingOf(c)[0]!.parts).toEqual({ [RECORD]: { server: SERVER } });
  } finally {
    await c.close();
  }
});

test("after each connection's first listing, never before it: what waits, and one ask for each record an instance here is tied to, none for one still cloning", async () => {
  const c = await computer({ rules: LEARNING, before: installedInstance(SERVER, RECORD), clone: () => path.join(tempRoot(), "other") });
  try {
    c.take(sharingDirectoryOf([entryOf()]));
    await ready(c);
    c.up.set(SERVER, false);
    await askHere(c, "x-1");
    await once(() => waitingOf(c).length === 1);
    c.up.set(SERVER, true);
    c.reconnect();
    const mark = c.sent.get(SERVER)!.length;
    await settle();
    expect(c.sent.get(SERVER)!.slice(mark)).toEqual([]);
    c.take(sharingDirectoryOf([entryOf(), OTHER]));
    setUpOther(c);
    await once(() => c.of("expert-instance-states").at(-1)?.instances.some((i) => i.key === "other" && i.state === "setting-up") === true && family(c).length >= 2);
    await settle();
    const now = c.sent.get(SERVER)!.slice(mark);
    expect(now[0]!.type).toBe("expert-instance-states");
    expect(now.filter((m) => m.type === "expert-learned-wanted-after").map((m) => m.expertRecordId)).toEqual([RECORD]);
    expect(now.filter((m) => m.type === "expert-instance-learned").map((m) => m.id)).toEqual([waitingOf(c)[0]!.id]);
  } finally {
    await c.close();
  }
});

test("an owner publishes a new expert: once its publish and the listing after it went, its record is asked for on that connection and what another computer learned reaches it then; an ask refused as no instance here goes again after the next listing", async () => {
  const c = await computer({ rules: LEARNING, clone: () => path.join(tempRoot(), "other") });
  try {
    writeExpertFile(c);
    await c.experts.refresh("adr");
    c.take(sharingDirectoryOf([]));
    await once(() => c.of("expert-definition").length === 1);
    await settle();
    expect(asks(c)).toEqual([]);
    c.take({ type: "expert-definition-result", v: PROTOCOL_VERSION, key: "adr", outcome: "published", expertRecordId: RECORD, revision: 1 });
    await once(() => asks(c).length === 1);
    expect(asks(c)[0]).toEqual({ type: "expert-learned-wanted-after", v: PROTOCOL_VERSION, key: "adr", expertRecordId: RECORD, afterArrivalNumber: 0, chain: "" });
    const sent = c.sent.get(SERVER)!;
    expect(sent.findLastIndex((m) => m.type === "expert-instance-states" && m.instances.some((i) => i.expertRecordId === RECORD))).toBeLessThan(sent.indexOf(asks(c)[0]!));
    const seq = officeSequence();
    seq.serving(c)();
    seq.learned({ text: "Rule or fact: learned on Valentina's computer. Files: src/relay.ts", files: [{ path: "src/relay.ts", commit: C1 }] });
    c.take(seq.after(0));
    await once(() => receivedOf(c)?.entries.length === 1);

    // Ready, so its own listing is still.
    await ready(c);
    await settle();
    const before = asks(c).length;
    c.take({ type: "expert-learned-wanted-after-refused", v: PROTOCOL_VERSION, key: "adr", expertRecordId: RECORD, reason: "not-an-instance-here" });
    await settle();
    expect(asks(c)).toHaveLength(before);
    // The next listing: another expert of the office starts its set-up here.
    c.take(sharingDirectoryOf([entryOf({ owner: SAM, yours: true }), OTHER]));
    setUpOther(c);
    await once(() => asks(c).length === before + 1);
    expect(asks(c).at(-1)).toMatchObject({ expertRecordId: RECORD, afterArrivalNumber: 1 });
  } finally {
    await c.close();
  }
});
