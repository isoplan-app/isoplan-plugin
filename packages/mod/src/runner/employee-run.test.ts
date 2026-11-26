import fs from "node:fs";
import path from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import { tempRoot } from "../data-layer/fixture.js";
import { employeeDisallowed, mcpToolTimeout } from "./employee-claude.js";
import { draftTo, GROUNDS, setUpEmployee, until, type EmployeeRule } from "./employee-fixture.js";

vi.stubEnv("CLAUDE_CONFIG_DIR", path.join(tempRoot(), "claude"));
for (const [k, v] of Object.entries({ GIT_AUTHOR_NAME: "Adam", GIT_AUTHOR_EMAIL: "adam@example.invalid", GIT_COMMITTER_NAME: "Adam", GIT_COMMITTER_EMAIL: "adam@example.invalid" })) vi.stubEnv(k, v);
vi.setConfig({ testTimeout: 120000 });

const closing: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const c of closing.splice(0)) await c();
});

async function started(rules: EmployeeRule[], o: Parameters<typeof setUpEmployee>[0] = {}) {
  const s = await setUpEmployee({ rules: [...GROUNDS, ...rules], ...o });
  closing.push(s.close);
  await s.ready();
  return s;
}

// The run due at 09:00, started at 09:01 and waited for: ticked until it ran, as the runner ticks every minute.
async function runAt(s: Awaited<ReturnType<typeof started>>, iso = "2026-11-26T09:01:00Z") {
  const before = s.e().runs!.listing().ended.length;
  s.clock.t = Date.parse(iso);
  await until(async () => (await s.e().runs!.tick(), s.e().runs!.listing().ended.length > before && !s.e().runs!.running()), 90000, "the run ended");
  return s.e().runs!.listing().ended[0]!;
}

test("the trunk's turns and a run have the job's tools and only those, the same flags but the session's, the process's own MCP config, and Isoplan's tools must connect", async () => {
  const s = await started([{ kind: "fork", text: "Today's run", reply: "done" }], { job: { tools: ["Read", "Grep", "WebSearch"] } });
  expect((await runAt(s)).outcome).toBe("ran");
  const starts = s.claude().filter((x) => x.argv);
  const trunk = starts.find((x) => x.kind === "trunk")!.argv!;
  const run = starts.find((x) => x.kind === "fork")!.argv!;
  const flag = (argv: string[], f: string) => argv[argv.indexOf(f) + 1]!;
  for (const argv of [trunk, run]) {
    expect(flag(argv, "--tools")).toBe("Read,Grep,WebSearch");
    expect(flag(argv, "--disallowedTools")).toBe(employeeDisallowed({ tools: ["Read", "Grep", "WebSearch"] }).join(","));
    expect(flag(argv, "--disallowedTools").split(",")).not.toContain("WebSearch");
    expect(flag(argv, "--allowedTools")).toBe("mcp__isoplan__ask_expert,mcp__isoplan__leave_draft,WebSearch");
    expect(argv).toEqual(expect.arrayContaining(["--strict-mcp-config", "--setting-sources", "", "dontAsk"]));
    expect(argv.join(" ")).toContain("disableAllHooks");
  }
  expect(run).toEqual(expect.arrayContaining(["--fork-session", "--no-session-persistence", "--resume-session-at"]));
  // Each process had a config of its own, gone once it ended; the run's wait for an answer is under Claude Code's.
  expect(flag(trunk, "--mcp-config")).not.toBe(flag(run, "--mcp-config"));
  expect(fs.existsSync(flag(run, "--mcp-config"))).toBe(false);
  expect(starts.find((x) => x.kind === "fork")!.env!.MCP_TOOL_TIMEOUT).toBe(mcpToolTimeout(s.settings.employees.expertAnswerWaitMinutes));
  const strip = (argv: string[]) => argv.filter((a, i) => !["--session-id", "--resume", "--resume-session-at", "--mcp-config", "--model"].includes(argv[i - 1] ?? "") && !["-p", "--session-id", "--resume", "--fork-session", "--no-session-persistence", "--resume-session-at"].includes(a));
  // The run takes the model id its grounding resolved to.
  expect(strip(run)).toEqual(strip(trunk));

  // A job with WebSearch whose subagent uses it isn't failed; one whose init offers Bash is; one whose init lacks Isoplan's server or a tool fails with its words.
  s.rules([...GROUNDS, { kind: "fork", text: "Today's run", subagentTools: ["WebSearch"], reply: "done" }]);
  expect((await runAt(s, "2026-11-27T09:01:00Z")).outcome).toBe("ran");
  s.rules([...GROUNDS, { kind: "fork", text: "Today's run", initTools: ["Bash"], reply: "done" }]);
  expect(await runAt(s, "2026-11-28T09:01:00Z")).toMatchObject({ outcome: "failed", why: expect.stringContaining("Bash") });
  s.rules([...GROUNDS, { kind: "fork", text: "Today's run", mcp: "failed", reply: "done" }]);
  expect(await runAt(s, "2026-11-29T09:01:00Z")).toMatchObject({ outcome: "failed", why: expect.stringContaining("Isoplan's tools didn't connect") });
  s.rules([...GROUNDS, { kind: "fork", text: "Today's run", dropTools: ["mcp__isoplan__leave_draft"], reply: "done" }]);
  expect(await runAt(s, "2026-11-30T09:01:00Z")).toMatchObject({ outcome: "failed", why: expect.stringContaining("mcp__isoplan__leave_draft isn't offered") });
});

test("leave_draft keeps a draft before it answers, refuses past the batch, a recipient already waiting, one another sender claimed, and one this sender skipped; the run's end holds a secret draft, claims and pushes the rest", async () => {
  const s = await started(
    [
      {
        kind: "fork",
        text: "Today's run",
        calls: [draftTo("ana@studio.example"), draftTo("ana@studio.example"), draftTo("cy@claimed.example"), draftTo("bo@agency.example", "SECRET plans for Bo"), draftTo("di@agency.example")],
        reply: "done",
      },
    ],
    { settings: { draftsPerRun: 3 } },
  );
  // Valentina's employee claimed cy@ already.
  const other = path.join(s.root, "valentina");
  const { execFileSync } = await import("node:child_process");
  const g = (...a: string[]) => execFileSync("git", a, { cwd: other, windowsHide: true });
  execFileSync("git", ["clone", "-q", s.remote, other], { windowsHide: true });
  fs.writeFileSync(path.join(other, "who-was-contacted.csv"), "prospect,state,sender,employee,since,name,organisation\r\ncy@claimed.example,claimed,Valentina,valentinas-outreach,2026-11-25T09:00:00.000Z,,\r\n");
  g("-c", "user.name=V", "-c", "user.email=v@example.invalid", "add", ".");
  g("-c", "user.name=V", "-c", "user.email=v@example.invalid", "commit", "-q", "-m", "claim");
  g("push", "-q", "origin", "main");

  const ended = await runAt(s);
  expect(s.results()).toEqual([
    "Left draft 1 of 3.",
    "A draft to ana@studio.example waits for your owner already: pick another.",
    "Valentina's employee claimed cy@claimed.example on 25 Nov: pick another.",
    "Left draft 2 of 3.",
    "Left draft 3 of 3.",
  ]);
  expect(ended).toMatchObject({ outcome: "ran", drafts: 2, heldBySecretCheck: 1, someoneElseHad: 0 });
  const sent = s.e().drafts.toSend();
  expect(sent.flatMap((x) => x.drafts.map((d) => d.to!.address))).toEqual(["ana@studio.example", "di@agency.example"]);
  expect(JSON.stringify(sent)).not.toContain("SECRET");
  expect(s.onRemote().filter((r) => r.sender === "Adam").map((r) => [r.prospect, r.state])).toEqual([
    ["ana@studio.example", "claimed"],
    ["di@agency.example", "claimed"],
  ]);

  // Skipped: never drafted again by this employee.
  await s.decided("skipped", sent[0]!.drafts[0]!.id);
  s.rules([...GROUNDS, { kind: "fork", text: "Today's run", calls: [draftTo("ana@studio.example")], reply: "done" }]);
  await runAt(s, "2026-11-27T09:01:00Z");
  expect(s.results().at(-1)).toMatch(/^You skipped ana@studio.example on \d+ Nov: pick another\.$/);
});

test("the runner killed mid-run after two drafts: at its next start, before anything else is due, the run's end is done, its drafts claimed and sent once, and its try again refuses their recipients", async () => {
  const root = tempRoot();
  const s = await started([{ kind: "fork", text: "Today's run", calls: [draftTo("ana@studio.example"), draftTo("bo@agency.example")], hang: true }], { root });
  s.clock.t = Date.parse("2026-11-26T09:01:00Z");
  await s.e().runs!.tick();
  await until(() => s.results().length === 2, 60000, "two drafts left");
  // What its writer was doing goes first: a stopped runner's git call is over by the time another starts.
  await s.e().writer.write();
  await s.close();
  closing.length = 0;

  // The runner starts again, its run's process ended with it.
  const again = await setUpEmployee({ root, rules: [...GROUNDS, { kind: "fork", text: "Today's run", calls: [draftTo("ana@studio.example")], reply: "done" }] });
  closing.push(again.close);
  const leftover = again.e().runs!.listing().ended[0]!;
  expect(leftover).toMatchObject({ outcome: "failed", drafts: 2, tryingAgainAt: expect.any(String) });
  expect(again.e().drafts.toSend()[0]!.drafts).toHaveLength(2);
  expect(again.onRemote().map((r) => r.prospect)).toEqual(["ana@studio.example", "bo@agency.example"]);
  await again.ready();
  const retry = await runAt(again, "2026-11-26T09:12:00Z");
  expect(retry).toMatchObject({ wasTheTryAgain: true });
  expect(again.results().at(-1)).toBe("A draft to ana@studio.example waits for your owner already: pick another.");
});
