// The offer to set up an expert this computer has no instance of (isoplan-app#340, ADR 0013), as an
// agent's ask makes it, with this computer's expert stack (expert-stack-fixture.ts) against a
// stand-in office.

import path from "node:path";
import { PROTOCOL_VERSION, type ExpertRight } from "@isoplan/protocol";
import { expect, test, vi } from "vitest";
import { expertText } from "../ask/expert-text.js";
import { tempRoot } from "../data-layer/fixture.js";
import { until } from "./expert-fixture.js";
import { computer, DEFINITION, directoryOf, entryOf, RECORD, SERVER, type Computer } from "./expert-stack-fixture.js";

// The empty folder git runs with as its hooks (handoff/take.ts noHooks) is made in the Claude folder: a temp one, never this machine's.
vi.stubEnv("CLAUDE_CONFIG_DIR", path.join(tempRoot(), "claude"));
vi.setConfig({ testTimeout: 60000 });

const RIGHT: ExpertRight = { name: "adr", subject: DEFINITION.subject, repo: "app", host: "Ada" };

/** The session's hooks module connects, and the office says it may ask the expert. */
async function session(c: Computer, s = "s1") {
  c.connect(s);
  c.rights.tap(s, c.sessionFolder, { type: "expert-rights", v: PROTOCOL_VERSION, experts: [RIGHT], server: SERVER });
  await until(() => c.lines(s).some((l) => l.type === "expert-rights"));
}
const ask = (c: Computer, key: string, s = "s1") => c.asking.ask({ type: "ask-expert", v: 1, token: "", session: s, cwd: c.sessionFolder, servers: [SERVER], expert: "adr", question: "Where is it held?", blocking: false, key });
const offerLines = (c: Computer, s = "s1") => c.lines(s).filter((l) => l.type === "expert-set-up-offer");

test("the first ask of an expert this computer has no instance of offers its set-up once, with a line for that session's status line; a later ask from any session, or after a restart, offers nothing more", async () => {
  const c = await computer();
  try {
    c.take(directoryOf([entryOf()]));
    await session(c, "s1");
    await session(c, "s2");
    expect(await ask(c, "toolu_1")).toEqual({ text: expertText("EXPERT_NOT_SET_UP", { expert: "adr", id: "toolu_1", name: "Adr Expert" }), failed: true, code: "EXPERT_NOT_SET_UP" });
    expect(c.of("expert-set-up-offered")).toEqual([{ type: "expert-set-up-offered", v: PROTOCOL_VERSION, key: "adr", expertRecordId: RECORD }]);
    expect(offerLines(c)).toEqual([{ type: "expert-set-up-offer", server: SERVER, key: "adr", name: "Adr Expert", url: "http://127.0.0.1:4799/?expert-set-up=adr" }]);
    await ask(c, "toolu_2", "s2");
    expect(c.of("expert-set-up-offered")).toHaveLength(1);
    expect(offerLines(c, "s2")).toEqual([]);
  } finally {
    await c.close();
  }
  const again = await computer({ root: c.root });
  try {
    again.take(directoryOf([entryOf()]));
    await session(again, "s3");
    expect((await ask(again, "toolu_3", "s3")).code).toBe("EXPERT_NOT_SET_UP");
    expect(again.of("expert-set-up-offered")).toEqual([]);
  } finally {
    await again.close();
  }
});

test("with setUpWithoutAsking on, the set-up starts at once and nothing is offered", async () => {
  const c = await computer({ setUpWithoutAsking: true });
  try {
    c.take(directoryOf([entryOf()]));
    await session(c);
    expect(await ask(c, "toolu_1")).toEqual({ text: expertText("EXPERT_STARTING", { expert: "adr", id: "toolu_1", name: "Adr Expert" }), code: "EXPERT_STARTING" });
    await until(() => c.of("expert-record-wanted").length === 1);
    expect(c.of("expert-set-up-offered")).toEqual([]);
    expect(offerLines(c)).toEqual([]);
  } finally {
    await c.close();
  }
});

test("an offer the link couldn't send goes after the next connection's directory; while open, the session's pipe connecting afresh is given its line again; dismissed on the floor, its line ends, and is never given again", async () => {
  const c = await computer();
  try {
    c.take(directoryOf([entryOf()]));
    await session(c);
    c.links.get(SERVER)!.onClose();
    c.up.set(SERVER, false);
    expect((await ask(c, "toolu_1")).code).toBe("EXPERT_NOT_SET_UP");
    expect(c.of("expert-set-up-offered")).toEqual([]);
    c.up.set(SERVER, true);
    c.links.get(SERVER)!.onOpen();
    c.take(directoryOf([entryOf()]));
    await until(() => c.of("expert-set-up-offered").length === 1);
    c.disconnect("s1");
    c.lines("s1").length = 0;
    c.connect("s1");
    expect(offerLines(c)).toEqual([{ type: "expert-set-up-offer", server: SERVER, key: "adr", name: "Adr Expert", url: "http://127.0.0.1:4799/?expert-set-up=adr" }]);
    c.take({ type: "expert-set-up-offer-ended", v: PROTOCOL_VERSION, key: "adr", expertRecordId: RECORD, why: "dismissed" });
    expect(c.lines("s1").filter((l) => l.type === "expert-set-up-offer-ended")).toEqual([{ type: "expert-set-up-offer-ended", server: SERVER, key: "adr" }]);
    c.disconnect("s1");
    c.lines("s1").length = 0;
    c.connect("s1");
    expect(offerLines(c)).toEqual([]);
  } finally {
    await c.close();
  }
});
