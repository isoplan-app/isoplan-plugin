import fs from "node:fs";
import path from "node:path";
import { expect, test, vi } from "vitest";
import { modDir, tempRoot } from "../data-layer/fixture.js";
import type { GitResult, RunGit } from "../handoff/git.js";
import type { ExpertSettings } from "./expert.js";
import { createExperts, expertIgnored } from "./experts.js";

// The empty folder git runs with as its hooks (handoff/take.ts noHooks) is made in the Claude folder: a temp one, never this machine's.
vi.stubEnv("CLAUDE_CONFIG_DIR", path.join(tempRoot(), "claude"));

const T1 = "11111111-1111-4111-8111-111111111111";
const RECORD = "4f0c3a52-8a2b-4d6e-9f10-2b3c4d5e6f70";
const settings = { ...JSON.parse(fs.readFileSync(path.join(modDir, "runner.json"), "utf8")), expertJudgeModel: "haiku" } as ExpertSettings;

// The experts folder with one expert file, whose expert is resumed from its state, and a claude
// that never answers.
function setUp(o: Partial<Parameters<typeof createExperts>[0]> = {}) {
  const root = tempRoot();
  const expertsDir = path.join(root, "isoplan", "experts");
  const instancesDir = path.join(root, "isoplan", "expert-instances");
  const logsDir = path.join(root, "isoplan", "logs");
  const repo = path.resolve("/work/app");
  fs.mkdirSync(path.join(expertsDir, "adr"), { recursive: true });
  const file = { version: 1, name: "adr", repo, subject: "What may leave a machine.", model: "sonnet", promoteAtTokens: 200000, proof: { question: "Q?", answer: "A." } };
  fs.writeFileSync(path.join(expertsDir, "adr.json"), JSON.stringify(file));
  fs.writeFileSync(path.join(expertsDir, "broken.json"), JSON.stringify({ ...file, name: "broken", promoteAtTokens: 0 }));
  fs.writeFileSync(path.join(expertsDir, "adr", "state.json"), JSON.stringify({ version: 2, setUpFromExpertRecord: true, fingerprint: "an older file", repo, branch: "main", generations: [{ n: 1, trunk: T1, model: "claude-sonnet-5-5", commit: "1".repeat(40), groundedAt: 0, meter: 1, notes: 0, state: "failed" }] }));
  const bin = path.join(root, "claude.js");
  fs.writeFileSync(bin, "process.stdin.resume(); setInterval(() => {}, 1000);\n");
  const ok = (stdout = ""): GitResult => ({ code: 0, stdout, stderr: "", timedOut: false });
  const calls: { cwd: string; args: string[] }[] = [];
  const git: RunGit = async (argv, { cwd }) => {
    let args = argv;
    while (args[0] === "-c") args = args.slice(2); // the no-hooks prefix, and Windows' long paths for a clone
    calls.push({ cwd, args });
    if (args[0] === "ls-remote") return ok("ref: refs/heads/main\tHEAD\n");
    if (args[0] === "remote") return ok("https://example.com/app.git\n");
    if (args[0] === "clone") fs.mkdirSync(args.at(-1)!, { recursive: true });
    return ok("1".repeat(40));
  };
  const logs: string[] = [];
  const experts = createExperts({ expertsDir, instancesDir, logsDir, projectsDir: path.join(root, "projects"), appDir: modDir, binary: async () => bin, settings: async () => settings, scan: async () => null, git, gitTimeoutMs: async () => 5000, log: (t) => void logs.push(t), lookMs: 3600000, ...o });
  return { root, experts, expertsDir, instancesDir, logsDir, logs, calls, file, repo };
}

test("start() settles once the files and states are read, while the grounding's claude never answers; trunks are known as the experts'", async () => {
  const t = setUp();
  await t.experts.start();
  try {
    expect(t.experts.hosted()).toEqual([{ name: "adr", repo: path.resolve("/work/app"), subject: "What may leave a machine.", state: "starting", senior: false, step: "grounding" }]);
    expect(t.experts.isExpertSession(T1)).toBe(true);
    expect(t.experts.isExpertSession("22222222-2222-4222-8222-222222222222")).toBe(false);
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

test("a file that doesn't parse is logged in both logs and starts nothing", async () => {
  const t = setUp();
  await t.experts.start();
  try {
    expect(t.experts.hosted().map((h) => h.name)).toEqual(["adr"]);
    expect(t.experts.running("broken")).toBe(null);
    expect(t.logs).toContain("expert file broken.json: promoteAtTokens: must be a whole number of at least 1");
    const health = () => (fs.existsSync(path.join(t.logsDir, "expert-broken.log")) ? fs.readFileSync(path.join(t.logsDir, "expert-broken.log"), "utf8") : "");
    for (let i = 0; i < 1000 && !health().endsWith("\n"); i++) await new Promise((r) => setTimeout(r, 10));
    expect(health()).toMatch(/ file error="broken.json: promoteAtTokens: must be a whole number of at least 1"\n$/);
  } finally {
    t.experts.close();
  }
});

test("an expert's clone stays where it was made, a folder clonesFolder named before; a new expert's goes in the folder clonesFolder names; sessions in either are kept off the floor", async () => {
  const root = tempRoot();
  const [before, now] = [path.join(root, "before"), path.join(root, "now")];
  const t = setUp({ clonesFolder: now, clonesFolders: [before, now] });
  const made = path.join(before, "experts", "adr", "read");
  fs.mkdirSync(path.join(made, ".git"), { recursive: true });
  const file = JSON.parse(fs.readFileSync(path.join(t.expertsDir, "adr.json"), "utf8"));
  fs.writeFileSync(path.join(t.expertsDir, "billing.json"), JSON.stringify({ ...file, name: "billing" }));
  await t.experts.start();
  try {
    const fresh = path.join(now, "experts", "billing", "read");
    for (let i = 0; i < 500 && !fs.existsSync(fresh); i++) await new Promise((r) => setTimeout(r, 10));
    expect(fs.existsSync(fresh)).toBe(true);
    expect(t.calls).toContainEqual({ cwd: made, args: ["remote", "set-url", "origin", "https://example.com/app.git"] });
    expect(t.calls.filter((c) => c.args[0] === "clone").map((c) => c.args.at(-1))).toEqual([`${fresh}.new`]);
    expect(fs.existsSync(path.join(t.expertsDir, "adr", "read"))).toBe(false);
    const ignored = expertIgnored(t.expertsDir, () => null, [before, now]);
    expect(ignored("any", made)).toBe(true);
    expect(ignored("any", fresh)).toBe(true);
    expect(ignored("any", path.join(now, "code", "app"))).toBe(false);
  } finally {
    t.experts.close();
  }
});

test("an instance file and an expert file of one key run the expert file; with the expert file gone, the instance file runs the same expert, with no new generation", async () => {
  const t = setUp();
  const server = "wss://office.example/data-layer";
  const definition = { key: "adr", project: { id: "github.com/acme/app", name: "app" }, subject: t.file.subject, model: t.file.model, promoteAtTokens: t.file.promoteAtTokens, areas: [], proof: t.file.proof };
  fs.writeFileSync(path.join(t.expertsDir, "adr", "expert-records.json"), JSON.stringify({ version: 1, servers: { [server]: { record: { expertRecordId: RECORD, revision: 1, owner: { id: "claude:ada", name: "Ada" }, yours: false, definition } } } }));
  fs.mkdirSync(t.instancesDir, { recursive: true });
  fs.writeFileSync(path.join(t.instancesDir, "adr.json"), JSON.stringify({ version: 1, key: "adr", server, repo: t.repo }));
  await t.experts.start();
  try {
    const running = t.experts.running("adr")!;
    expect(running.from).toBe("expert-file");
    expect(t.logs).toContain(`expert adr: both an expert file and an instance file are here, so it runs from the expert file and ${path.join(t.instancesDir, "adr.json")} is ignored`);
    const generations = () => JSON.parse(fs.readFileSync(path.join(t.expertsDir, "adr", "state.json"), "utf8")).generations.length as number;
    for (let i = 0; i < 1000 && generations() < 2; i++) await new Promise((r) => setTimeout(r, 10));
    const expert = running.expert;
    fs.rmSync(path.join(t.expertsDir, "adr.json"));
    await t.experts.refresh("adr");
    const now = t.experts.running("adr")!;
    expect(now).toMatchObject({ from: "instance-file", instance: { server } });
    expect(now.expert).toBe(expert);
    await new Promise((r) => setTimeout(r, 200));
    expect(generations()).toBe(2);
  } finally {
    t.experts.close();
  }
});
