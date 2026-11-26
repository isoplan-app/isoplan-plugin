// One office's record link (isoplan-app#340): its gate, the listing it sends, and the definitions it
// publishes or holds back, with this computer's expert stack (expert-stack-fixture.ts) against a
// stand-in office.

import path from "node:path";
import { PROTOCOL_VERSION } from "@isoplan/protocol";
import { expect, test, vi } from "vitest";
import { tempRoot } from "../data-layer/fixture.js";
import { until } from "./expert-fixture.js";
import { computer, DEFINITION, directoryOf, entryOf, OTHER_SERVER, PROJECT, SERVER, writeExpertFile } from "./expert-stack-fixture.js";

// The empty folder git runs with as its hooks (handoff/take.ts noHooks) is made in the Claude folder: a temp one, never this machine's.
vi.stubEnv("CLAUDE_CONFIG_DIR", path.join(tempRoot(), "claude"));
vi.setConfig({ testTimeout: 60000 });

const settle = () => new Promise((r) => setTimeout(r, 300));

test("nothing goes before the connection's first directory; then the listing and the definitions", async () => {
  const c = await computer();
  try {
    writeExpertFile(c);
    await c.experts.refresh("adr");
    await settle();
    expect(c.sent.get(SERVER)).toEqual([]);
    c.take(directoryOf([]));
    await until(() => c.of("expert-definition").length === 1);
    expect(c.sent.get(SERVER)!.map((m) => m.type)).toEqual(["expert-instance-states", "expert-definition"]);
    expect(c.of("expert-definition")[0]).toEqual({ type: "expert-definition", v: PROTOCOL_VERSION, definition: DEFINITION });
  } finally {
    await c.close();
  }
});

test("the listing goes first on each connection, then only when it changed", async () => {
  const c = await computer();
  try {
    c.take(directoryOf([entryOf()]));
    await until(() => c.of("expert-instance-states").length === 1);
    c.take(directoryOf([entryOf({ revision: 2 })]));
    await settle();
    expect(c.of("expert-instance-states")).toHaveLength(1);
    c.reconnect();
    c.take(directoryOf([entryOf({ revision: 2 })]));
    await until(() => c.of("expert-instance-states").length === 2);
    expect(c.of("expert-instance-states")[1]!.instances).toEqual([]);
  } finally {
    await c.close();
  }
});

test("a definition with a secret, of a repo the office doesn't take or with no remote, or one the protocol refuses, isn't sent, the health log and runner.log saying which field and why; areas the protocol refuses are dropped, not the definition", async () => {
  const root = tempRoot();
  const [untaken, nowhere] = [path.join(root, "untaken"), path.join(root, "nowhere")];
  const c = await computer({ projectOf: (folder) => (folder === untaken ? { id: "github.com/acme/untaken", name: "untaken" } : folder === nowhere ? { id: "local:box/nowhere", name: "nowhere" } : undefined) });
  try {
    writeExpertFile(c, { name: "secret", subject: "Ask with the SECRET." });
    writeExpertFile(c, { name: "untaken", repo: untaken });
    writeExpertFile(c, { name: "nowhere", repo: nowhere });
    writeExpertFile(c, { name: "spaced", model: "claude sonnet" });
    writeExpertFile(c, { name: "long", proof: { question: "What?", answer: "x".repeat(8001) } });
    writeExpertFile(c, { name: "areas", areas: ["../outside", "src/relay"] });
    for (const key of ["secret", "untaken", "nowhere", "spaced", "long", "areas"]) await c.experts.refresh(key);
    c.take(directoryOf([]));
    await until(() => c.of("expert-definition").length === 1);
    await settle();
    expect(c.of("expert-definition").map((m) => [m.definition.key, m.definition.areas])).toEqual([["areas", ["src/relay"]]]);
    expect(c.logs).toEqual(
      expect.arrayContaining([
        `expert secret isn't published to ${SERVER}: its subject matches the secret pattern "test secret"`,
        `expert untaken isn't published to ${SERVER}: the office doesn't take its repo ${untaken}`,
        `expert nowhere isn't published to ${SERVER}: its repo ${nowhere} has no remote, so its project would name a folder on this computer`,
        expect.stringMatching(new RegExp(`^expert spaced isn't published to ${SERVER.replace(/[/.]/g, "\\$&")}: its model doesn't fit the protocol: a model name`)),
        expect.stringMatching(/^expert long isn't published to .*: its proof\.answer doesn't fit the protocol: /),
      ]),
    );
    expect(c.health("secret")).toMatch(/definition server=\S+ published=no field=subject why="it matches the secret pattern \\"test secret\\""/);
    expect(c.health("spaced")).toMatch(/definition server=\S+ published=no field=model why=/);
    expect(c.health("long")).toMatch(/definition server=\S+ published=no field=proof\.answer why=/);
    expect(c.health("nowhere")).toMatch(/definition server=\S+ published=no why="its repo has no remote"/);
  } finally {
    await c.close();
  }
});

test("with no approved list, or while git can't read an expert repo's remote, nothing more is sent: what the office was last told stands", async () => {
  let gitFails = false;
  const takes: Record<string, string[] | null> = { [SERVER]: [PROJECT.id] };
  const c = await computer({
    takes,
    projectOf: () => {
      if (gitFails) throw new Error("git couldn't read the remote");
      return undefined;
    },
  });
  try {
    writeExpertFile(c);
    await c.experts.refresh("adr");
    c.take(directoryOf([]));
    await until(() => c.of("expert-definition").length === 1);
    c.take({ type: "expert-definition-result", v: PROTOCOL_VERSION, key: "adr", outcome: "published", expertRecordId: entryOf().expertRecordId, revision: 1 });
    await until(() => (c.of("expert-instance-states").at(-1)?.instances.length ?? 0) === 1);
    await settle();
    const before = c.sent.get(SERVER)!.length;
    gitFails = true;
    writeExpertFile(c, { subject: "Changed while git can't read the remote." });
    await c.experts.refresh("adr");
    await settle();
    expect(c.sent.get(SERVER)!.length).toBe(before);
    gitFails = false;
    takes[SERVER] = null;
    writeExpertFile(c, { subject: "Changed with no list." });
    await c.experts.refresh("adr");
    await settle();
    expect(c.sent.get(SERVER)!.length).toBe(before);
    takes[SERVER] = [PROJECT.id];
    writeExpertFile(c, { subject: "Changed once all is well." });
    await c.experts.refresh("adr");
    await until(() => c.of("expert-definition").length === 2);
    expect(c.of("expert-definition")[1]!.definition.subject).toBe("Changed once all is well.");
  } finally {
    await c.close();
  }
});

test("two office servers, each taking its own project: each is told only of what it takes, and never of another's", async () => {
  const c = await computer({ servers: [SERVER, OTHER_SERVER], takes: { [SERVER]: [PROJECT.id], [OTHER_SERVER]: ["github.com/acme/other"] } });
  try {
    writeExpertFile(c);
    await c.experts.refresh("adr");
    c.take(directoryOf([]), SERVER);
    c.take(directoryOf([]), OTHER_SERVER);
    await until(() => c.of("expert-definition", SERVER).length === 1 && c.of("expert-instance-states", OTHER_SERVER).length === 1);
    c.take({ type: "expert-definition-result", v: PROTOCOL_VERSION, key: "adr", outcome: "published", expertRecordId: entryOf().expertRecordId, revision: 1 }, SERVER);
    await until(() => (c.of("expert-instance-states", SERVER).at(-1)?.instances.length ?? 0) === 1);
    await settle();
    expect(c.of("expert-definition", OTHER_SERVER)).toEqual([]);
    expect(c.of("expert-instance-states", OTHER_SERVER).flatMap((m) => m.instances)).toEqual([]);
  } finally {
    await c.close();
  }
});
