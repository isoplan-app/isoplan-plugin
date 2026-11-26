// Two computers, one expert (isoplan-app#340, the critical path): Adam's computer publishes his
// expert; Valentina's agent asks it, is told it isn't set up there and offered its set-up, which her
// one click starts; her instance is set up from the record, grounds, proves and answers; and with
// Adam's computer gone it still answers. No question of hers, nor any grounding or fork for her, runs
// on Adam's computer. Each computer is its own expert stack (expert-stack-fixture.ts) with the fake
// `claude`; between them a stand-in office keeps the record and passes on what an office passes on.

import path from "node:path";
import { PROTOCOL_VERSION, type ExpertDefinition, type ExpertRight } from "@isoplan/protocol";
import { expect, test, vi } from "vitest";
import { tempRoot } from "../data-layer/fixture.js";
import { ANSWER, BASE, until, type Rule } from "./expert-fixture.js";
import { computer, DEFINITION, directoryOf, PROJECT, SERVER, writeExpertFile, type Computer } from "./expert-stack-fixture.js";

// The empty folder git runs with as its hooks (handoff/take.ts noHooks) is made in the Claude folder: a temp one, never this machine's.
vi.stubEnv("CLAUDE_CONFIG_DIR", path.join(tempRoot(), "claude"));
vi.setConfig({ testTimeout: 120000 });

const ADAM = { id: "claude:adam", name: "Adam" };
const VALENTINA = { id: "claude:valentina", name: "Valentina" };
const ID = "6d1c2b3a-4e5f-4a6b-9c7d-8e9f0a1b2c3d";
const ANSWERS: Rule[] = [{ kind: "fork", text: "Question toolu_", reply: ANSWER }, ...BASE];
const RIGHT: ExpertRight = { name: "adr", subject: DEFINITION.subject, repo: "app", host: "Adam" };

/** The office between them: it keeps the record Adam's runner publishes, lists it to both, and answers what each runner asks for. */
function office(adam: Computer, valentina: Computer) {
  let record: { revision: number; definition: ExpertDefinition } | null = null;
  const read = new Map<Computer, number>([
    [adam, 0],
    [valentina, 0],
  ]);
  const directory = (c: Computer) => directoryOf(record ? [{ key: "adr", expertRecordId: ID, project: PROJECT, owner: ADAM, revision: record.revision, ...(c === adam && { yours: true as const }) }] : []);
  const linked = new Set<Computer>([adam, valentina]);
  const timer = setInterval(() => {
    for (const c of linked) {
      const sent = c.sent.get(SERVER)!;
      for (; read.get(c)! < sent.length; read.set(c, read.get(c)! + 1)) {
        const m = sent[read.get(c)!]!;
        if (m.type === "expert-definition" && c === adam) {
          record = { revision: 1, definition: m.definition };
          c.take({ type: "expert-definition-result", v: PROTOCOL_VERSION, key: "adr", outcome: "published", expertRecordId: ID, revision: 1 });
          for (const each of linked) each.take(directory(each));
        }
        if (m.type === "expert-record-wanted" && record) c.take({ type: "expert-record", v: PROTOCOL_VERSION, expertRecordId: ID, revision: record.revision, owner: ADAM, ...(c === adam && { yours: true as const }), definition: record.definition });
      }
    }
  }, 20);
  return {
    link: (c: Computer) => (linked.add(c), c.take(directory(c))),
    unlink: (c: Computer) => void linked.delete(c),
    close: () => clearInterval(timer),
  };
}

const ask = (c: Computer, key: string) => c.asking.ask({ type: "ask-expert", v: 1, token: "", session: "s1", cwd: c.sessionFolder, servers: [SERVER], expert: "adr", question: "Where is it held?", blocking: true, key });

test("two computers, one expert: with one click Valentina's computer sets up its own instance from Adam's expert record, which answers her, with Adam's computer gone too; nothing of hers runs on Adam's", async () => {
  const adam = await computer({ account: ADAM, rules: ANSWERS });
  const valentina = await computer({ account: VALENTINA, rules: ANSWERS });
  const o = office(adam, valentina);
  try {
    writeExpertFile(adam);
    await adam.experts.refresh("adr");
    o.link(adam);
    o.link(valentina);
    await until(() => adam.experts.running("adr")?.expert.hosted().state === "ready", 30000);
    await until(() => (valentina.store.directory(SERVER)?.experts.length ?? 0) === 1);
    const adamsBefore = adam.claude().length;

    valentina.connect("s1");
    valentina.rights.tap("s1", valentina.sessionFolder, { type: "expert-rights", v: PROTOCOL_VERSION, experts: [RIGHT], server: SERVER });
    await until(() => valentina.lines("s1").some((l) => l.type === "expert-rights"));
    expect((await ask(valentina, "toolu_1")).code).toBe("EXPERT_NOT_SET_UP");
    expect(valentina.of("expert-set-up-offered")).toEqual([{ type: "expert-set-up-offered", v: PROTOCOL_VERSION, key: "adr", expertRecordId: ID }]);

    // Her one click on the floor, to her own runner.
    valentina.take({ type: "set-up-expert-instance", v: PROTOCOL_VERSION, request: "r-1", key: "adr", expertRecordId: ID, by: VALENTINA });
    await until(() => valentina.experts.running("adr")?.expert.hosted().state === "ready", 30000);
    expect(valentina.experts.running("adr")).toMatchObject({ from: "instance-file", instance: { server: SERVER } });
    expect((await ask(valentina, "toolu_2")).text).toContain("Expert adr answered question toolu_2.");

    o.unlink(adam);
    await adam.close();
    expect((await ask(valentina, "toolu_3")).text).toContain("Expert adr answered question toolu_3.");

    // Adam's computer ran nothing after its own grounding: no fork, no grounding, no question for her.
    expect(adam.claude()).toHaveLength(adamsBefore);
    expect(adam.health()).not.toMatch(/question id=toolu_/);
    expect(valentina.health()).toMatch(/question id=toolu_2 /);
  } finally {
    o.close();
    await adam.close();
    await valentina.close();
  }
});
