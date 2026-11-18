import fs from "node:fs";
import path from "node:path";
import { PROTOCOL_VERSION, type RefusalMessage, type ReplyMessage } from "@isoplan/protocol";
import { expect, test } from "vitest";
import { modDir, tempRoot } from "../data-layer/fixture.js";
import type { GitResult, RunGit } from "../handoff/git.js";
import type { ExpertSettings } from "./expert.js";
import { createExperts, expertIgnored, forOffice, listingFor, type HostedExpert } from "./experts.js";
import { UNREADABLE } from "./scan.js";

const T1 = "11111111-1111-4111-8111-111111111111";
const settings = { ...JSON.parse(fs.readFileSync(path.join(modDir, "runner.json"), "utf8")), expertJudgeModel: "haiku" } as ExpertSettings;

const hostedExpert = (name: string, o: Partial<HostedExpert> = {}): HostedExpert => ({ name, repo: `/work/${name}`, subject: `The ${name} rules.`, state: "ready", ...o });

test("listingFor: only experts whose repo the office takes, with a remote, a clean subject and a listing the protocol takes; at most 20, by name", async () => {
  const logs: string[] = [];
  const hosted = [
    hostedExpert("untaken"),
    hostedExpert("local"),
    hostedExpert("secret", { subject: "Ask with the key AKIA" + "ABCDEFGHIJKLMNOP." }),
    hostedExpert("Bad-Name"),
    ...Array.from({ length: 21 }, (_, i) => hostedExpert(`e${String(i).padStart(2, "0")}`)),
  ];
  const home = async (folder: string) => (folder.endsWith("untaken") ? null : { id: folder.endsWith("local") ? "local:machine:/work/local" : `github.com/acme/${path.basename(folder)}`, name: path.basename(folder) });
  const scan = async (text: string) => (text.includes("AKIA") ? "AWS access key" : null);
  const listing = (await listingFor(hosted, home, scan, (t) => void logs.push(t)))!;
  expect(listing.map((l) => l.name)).toEqual(Array.from({ length: 20 }, (_, i) => `e${String(i).padStart(2, "0")}`));
  expect(listing[0]).toEqual({ name: "e00", project: { id: "github.com/acme/e00", name: "e00" }, subject: "The e00 rules.", state: "ready" });
  expect(logs).toEqual([
    expect.stringMatching(/^expert Bad-Name isn't listed: its listing doesn't fit the protocol: name: /),
    "expert local isn't listed: its repo /work/local has no remote, so its project would name a folder on this machine",
    'expert secret isn\'t listed: its subject matches the secret pattern "AWS access key"',
    "expert untaken isn't listed: the office doesn't take its repo /work/untaken",
    "only 20 experts are listed to an office, so these aren't: e20",
  ]);
  // Unreadable patterns can't tell a clean subject: no listing, rather than one with none in it.
  expect(await listingFor(hosted, home, async () => UNREADABLE, () => {})).toBe(null);
});

test("forOffice: an office whose list doesn't take an expert's repo is refused as for an unknown name; one that takes it is answered", async () => {
  const asked: string[] = [];
  const hosted = { hosted: () => [hostedExpert("billing")], owns: () => false, answer: (r: { id: string }) => void asked.push(r.id), release: () => {}, drop: () => {} };
  const home = (takes: boolean) => async (folder: string) => (takes ? { id: `github.com/acme/${path.basename(folder)}`, name: "billing" } : null);
  const a = forOffice(hosted, home(false), () => {});
  const b = forOffice(hosted, home(true), () => {});
  const sent: (ReplyMessage | RefusalMessage)[] = [];
  const request = (id: string) => ({ type: "request", v: PROTOCOL_VERSION, id, kind: "answer-expert", expert: "billing", questionId: "x-1", question: "Q?", blocking: false, from: { id: "claude:sam", name: "Sam" }, asker: "s-1" }) as const;
  a.answer(request("expert-x-1-1"), (m) => void sent.push(m));
  b.answer(request("expert-x-1-2"), (m) => void sent.push(m));
  await new Promise((r) => setTimeout(r, 20));
  expect(sent).toEqual([{ type: "refusal", v: PROTOCOL_VERSION, id: "expert-x-1-1", reason: "unavailable", detail: "this machine hosts no expert named billing now", expert: { code: "EXPERT_UNKNOWN" } }]);
  expect(asked).toEqual(["expert-x-1-2"]);
});

// The experts folder with one expert file, whose expert is resumed from its state, and a claude
// that never answers.
function setUp() {
  const root = tempRoot();
  const expertsDir = path.join(root, "isoplan", "experts");
  const logsDir = path.join(root, "isoplan", "logs");
  const repo = path.resolve("/work/app");
  fs.mkdirSync(path.join(expertsDir, "adr"), { recursive: true });
  const file = { version: 1, name: "adr", repo, subject: "What may leave a machine.", model: "sonnet", promoteAtTokens: 200000, proof: { question: "Q?", answer: "A." } };
  fs.writeFileSync(path.join(expertsDir, "adr.json"), JSON.stringify(file));
  fs.writeFileSync(path.join(expertsDir, "broken.json"), JSON.stringify({ ...file, name: "broken", promoteAtTokens: 0 }));
  fs.writeFileSync(path.join(expertsDir, "adr", "state.json"), JSON.stringify({ version: 1, fingerprint: "an older file", repo, branch: "main", generations: [{ n: 1, trunk: T1, model: "claude-sonnet-5-5", commit: "1".repeat(40), groundedAt: 0, meter: 1, notes: 0, state: "failed" }] }));
  const bin = path.join(root, "claude.js");
  fs.writeFileSync(bin, "process.stdin.resume(); setInterval(() => {}, 1000);\n");
  const ok = (stdout = ""): GitResult => ({ code: 0, stdout, stderr: "", timedOut: false });
  const git: RunGit = async (argv) => {
    const args = argv.slice(2);
    if (args[0] === "ls-remote") return ok("ref: refs/heads/main\tHEAD\n");
    if (args[0] === "remote") return ok("https://example.com/app.git\n");
    if (args[0] === "clone") fs.mkdirSync(args.at(-1)!, { recursive: true });
    return ok("1".repeat(40));
  };
  const logs: string[] = [];
  const experts = createExperts({ expertsDir, logsDir, projectsDir: path.join(root, "projects"), appDir: modDir, binary: async () => bin, settings: async () => settings, scan: async () => null, git, gitTimeoutMs: async () => 5000, log: (t) => void logs.push(t), lookMs: 3600000 });
  return { experts, expertsDir, logsDir, logs };
}

test("start() settles once the files and states are read, while the grounding's claude never answers; trunks and folders are known as the experts'", async () => {
  const t = setUp();
  await t.experts.start();
  try {
    expect(t.experts.hosted()).toEqual([{ name: "adr", repo: path.resolve("/work/app"), subject: "What may leave a machine.", state: "starting" }]);
    expect(t.experts.isExpertSession(T1)).toBe(true);
    expect(t.experts.isExpertSession("22222222-2222-4222-8222-222222222222")).toBe(false);
    expect(t.experts.isExpertFolder(path.join(t.expertsDir, "adr", "read", "src"))).toBe(true);
    expect(t.experts.isExpertFolder(path.resolve("/work/app"))).toBe(false);
    // The new generation's trunk is known from before its claude starts.
    const second = (): string | null => {
      try {
        return JSON.parse(fs.readFileSync(path.join(t.expertsDir, "adr", "state.json"), "utf8")).generations[1]?.trunk ?? null;
      } catch {
        return null; // read while it was renamed into place
      }
    };
    for (let i = 0; i < 1000 && !second(); i++) await new Promise((r) => setTimeout(r, 10));
    expect(t.experts.isExpertSession(second()!)).toBe(true);
    // Kept off the floor: a session in an expert's folder, or a trunk, even before the experts are made.
    const ignored = expertIgnored(t.expertsDir, () => t.experts);
    expect(ignored("any", path.join(t.expertsDir, "adr", "read"))).toBe(true);
    expect(ignored(T1, null)).toBe(true);
    expect(ignored("any", path.resolve("/work/app"))).toBe(false);
    expect(expertIgnored(t.expertsDir, () => null)("any", path.join(t.expertsDir, "adr", "read"))).toBe(true);
  } finally {
    t.experts.close();
  }
});

test("a file that doesn't parse is logged in both logs and starts nothing; a request for an expert this machine doesn't host is refused EXPERT_UNKNOWN", async () => {
  const t = setUp();
  await t.experts.start();
  try {
    expect(t.experts.hosted().map((h) => h.name)).toEqual(["adr"]);
    expect(t.logs).toContain("expert file broken.json: promoteAtTokens: must be a whole number of at least 1");
    const health = () => (fs.existsSync(path.join(t.logsDir, "expert-broken.log")) ? fs.readFileSync(path.join(t.logsDir, "expert-broken.log"), "utf8") : "");
    for (let i = 0; i < 1000 && !health().endsWith("\n"); i++) await new Promise((r) => setTimeout(r, 10));
    expect(health()).toMatch(/ file error="broken.json: promoteAtTokens: must be a whole number of at least 1"\n$/);
    const sent: (ReplyMessage | RefusalMessage)[] = [];
    t.experts.answer({ type: "request", v: PROTOCOL_VERSION, id: "expert-x-1-1", kind: "answer-expert", expert: "broken", questionId: "x-1", question: "Q?", blocking: false, from: { id: "claude:sam", name: "Sam" }, asker: "s-1" }, (m) => void sent.push(m));
    expect(sent).toEqual([{ type: "refusal", v: PROTOCOL_VERSION, id: "expert-x-1-1", reason: "unavailable", detail: "this machine hosts no expert named broken now", expert: { code: "EXPERT_UNKNOWN" } }]);
  } finally {
    t.experts.close();
  }
});
