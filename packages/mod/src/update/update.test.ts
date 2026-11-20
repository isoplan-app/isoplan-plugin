import fs from "node:fs";
import path from "node:path";
import { expect, test, vi } from "vitest";
import { tempRoot } from "../data-layer/fixture.js";
import { takeLock } from "../wake/lock.js";
import { alive } from "../wake/lock.js";
import { checkForUpdate, commandEnv, runHidden, START_GAP_MS, turnOnAutoUpdate, updateLockPath, updateRecordPath, updateRuns, updatesOffBy, type Ran } from "./update.js";

const OTHER = 4242; // a pid that isn't this process
const SOURCE = { source: "github", repo: "isoplan-app/isoplan-plugin" };

function setup(settings: unknown = { extraKnownMarketplaces: { isoplan: { source: SOURCE } } }) {
  const root = tempRoot();
  const claudeDir = path.join(root, ".claude");
  const settingsFile = path.join(claudeDir, "settings.json");
  const work = path.join(root, "work");
  const plugins = path.join(claudeDir, "plugins");
  fs.mkdirSync(work, { recursive: true });
  fs.mkdirSync(claudeDir, { recursive: true });
  if (settings !== null) fs.writeFileSync(settingsFile, typeof settings === "string" ? settings : JSON.stringify(settings));
  const ran: { argv: string[]; cwd: string }[] = [];
  let answers: Ran[] = [];
  let clock = 1_000_000;
  const check = (gapMs = START_GAP_MS) =>
    checkForUpdate({
      claudeDir,
      settings: settingsFile,
      plugins,
      id: "isoplan@isoplan",
      cwd: work,
      claude: ["/bin/node", "/lib/claude/cli.js"],
      gapMs,
      run: async (argv, cwd) => (ran.push({ argv, cwd }), answers.shift() ?? { code: 0, output: "" }),
      now: () => clock,
      isAlive: (pid) => pid === OTHER || pid === process.pid,
    });
  return {
    claudeDir,
    plugins,
    work,
    settingsFile,
    ran,
    check,
    answer: (...list: Ran[]) => void (answers = list),
    tick: (ms: number) => void (clock += ms),
    read: () => JSON.parse(fs.readFileSync(settingsFile, "utf8")),
  };
}

test("updates off: by any of Claude Code's variables, unless FORCE_AUTOUPDATE_PLUGINS turns plugin updates back on", () => {
  expect(updatesOffBy({})).toBeNull();
  expect(updatesOffBy({ DISABLE_AUTOUPDATER: "1" })).toBe("DISABLE_AUTOUPDATER");
  expect(updatesOffBy({ DISABLE_UPDATES: "true" })).toBe("DISABLE_UPDATES");
  expect(updatesOffBy({ CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1" })).toBe("CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC");
  expect(updatesOffBy({ DISABLE_AUTOUPDATER: "0", DISABLE_UPDATES: "" })).toBeNull();
  expect(updatesOffBy({ DISABLE_UPDATES: "1", FORCE_AUTOUPDATE_PLUGINS: "1" })).toBeNull();
});

test("auto-update: turned on only on the marketplace's own entry, never over a choice made, and no entry made up", async () => {
  const s = setup({ model: "opus", extraKnownMarketplaces: { isoplan: { source: SOURCE }, other: { source: SOURCE } } });
  expect(await turnOnAutoUpdate(s.settingsFile, "isoplan")).toMatch(/turned on Claude Code's auto-update for the isoplan marketplace/);
  expect(s.read()).toEqual({ model: "opus", extraKnownMarketplaces: { isoplan: { source: SOURCE, autoUpdate: true }, other: { source: SOURCE } } });
  expect(await turnOnAutoUpdate(s.settingsFile, "isoplan")).toBeNull();

  const off = setup({ extraKnownMarketplaces: { isoplan: { source: SOURCE, autoUpdate: false } } });
  expect(await turnOnAutoUpdate(off.settingsFile, "isoplan")).toBeNull();
  expect(off.read().extraKnownMarketplaces.isoplan.autoUpdate).toBe(false);

  const none = setup({ model: "opus" });
  expect(await turnOnAutoUpdate(none.settingsFile, "isoplan")).toBeNull();
  expect(fs.readFileSync(none.settingsFile, "utf8")).toBe(JSON.stringify({ model: "opus" }));
  const missing = setup(null);
  expect(await turnOnAutoUpdate(missing.settingsFile, "isoplan")).toBeNull();
  expect(fs.existsSync(missing.settingsFile)).toBe(false);
  const broken = setup("{ broken");
  await expect(turnOnAutoUpdate(broken.settingsFile, "isoplan")).rejects.toThrow(/isn't valid JSON/);
});

test("check: refreshes the marketplace, then updates the plugin, hidden, in the session's project, and says what each said", async () => {
  const s = setup();
  s.answer({ code: 0, output: "Updating marketplace…\n\u001b[32m✔ Successfully updated marketplace: isoplan\u001b[39m\n" }, { code: 0, output: "✔ Plugin \"isoplan\" updated from 6658f568c1e1 to a1b2c3d4e5f6 for scope user. Restart to apply changes.\n" });
  const checked = await s.check();
  expect(s.ran).toEqual([
    { argv: ["/bin/node", "/lib/claude/cli.js", "plugin", "marketplace", "update", "isoplan"], cwd: s.work },
    { argv: ["/bin/node", "/lib/claude/cli.js", "plugin", "update", "isoplan@isoplan"], cwd: s.work },
  ]);
  expect(checked).toEqual({
    ran: true,
    said: [
      `turned on Claude Code's auto-update for the isoplan marketplace in ${s.settingsFile}`,
      "claude plugin marketplace update isoplan: ✔ Successfully updated marketplace: isoplan",
      'claude plugin update isoplan@isoplan: ✔ Plugin "isoplan" updated from 6658f568c1e1 to a1b2c3d4e5f6 for scope user. Restart to apply changes.',
    ],
  });
  expect(JSON.parse(fs.readFileSync(updateRecordPath(s.claudeDir), "utf8"))).toEqual({ checkedAt: 1_000_000, autoUpdateOn: { marketplace: "isoplan", entry: JSON.stringify({ source: SOURCE, autoUpdate: true }), at: 1_000_000 } });
  expect(fs.existsSync(updateLockPath(s.claudeDir))).toBe(false);
});

test("check: a marketplace that can't be refreshed stops it there", async () => {
  const s = setup();
  s.answer({ code: 1, output: "✘ Failed to refresh marketplace 'isoplan': network\n" });
  expect((await s.check()).said.at(-1)).toBe("claude plugin marketplace update isoplan: failed with exit code 1: ✘ Failed to refresh marketplace 'isoplan': network");
  expect(s.ran).toHaveLength(1);
  s.ran.length = 0;
  s.tick(START_GAP_MS);
  s.answer({ code: null, output: "" });
  expect((await s.check()).said.at(-1)).toBe("claude plugin marketplace update isoplan: didn't finish");
});

test("check: once per gap on the machine, and never two at once", async () => {
  const s = setup();
  expect((await s.check()).ran).toBe(true);
  s.tick(START_GAP_MS - 1);
  expect(await s.check()).toEqual({ ran: false, said: [] }); // another session checked just now
  s.tick(1);
  expect((await s.check()).ran).toBe(true);
  s.tick(6 * 3600000);
  await takeLock(updateLockPath(s.claudeDir), OTHER);
  expect((await s.check()).ran).toBe(false); // one is running
  expect(s.ran).toHaveLength(4);
});

test("check: updates every install recorded, each with its scope, a project's in its folder; one whose folder has gone is skipped", async () => {
  const s = setup();
  const project = path.join(s.work, "..", "app");
  fs.mkdirSync(project);
  const install = (scope: string, projectPath?: string) => ({ scope, installPath: "/x", version: "0.3.0", ...(projectPath && { projectPath }) });
  fs.mkdirSync(s.plugins, { recursive: true });
  fs.writeFileSync(
    path.join(s.plugins, "installed_plugins.json"),
    JSON.stringify({ version: 2, plugins: { "isoplan@isoplan": [install("user"), install("project", project), install("local", path.join(s.work, "..", "gone"))], "other@isoplan": [install("user")] } }),
  );
  const checked = await s.check();
  expect(s.ran.map((r) => [r.argv.slice(2).join(" "), r.cwd])).toEqual([
    ["plugin marketplace update isoplan", s.work],
    ["plugin update isoplan@isoplan --scope user", s.work],
    ["plugin update isoplan@isoplan --scope project", project],
  ]);
  expect(checked.said.at(-1)).toMatch(/^claude plugin update isoplan@isoplan --scope local: skipped, its project folder .*gone isn't there$/);
  // An unknown record: one update with no scope, in the session's project.
  expect(updateRuns(null, "isoplan@isoplan", "/w")).toEqual([{ args: ["plugin", "update", "isoplan@isoplan"], cwd: "/w" }]);
});

test("check: a command that can't start or ran out of time says so", async () => {
  const s = setup();
  s.answer({ code: 0, output: "" }, { code: null, output: "Checking for updates…", error: "didn't finish within 300 s, so it was stopped" });
  expect((await s.check()).said.at(-1)).toBe("claude plugin update isoplan@isoplan: didn't finish within 300 s, so it was stopped: Checking for updates…");
  s.tick(START_GAP_MS);
  s.answer({ code: null, output: "", error: "couldn't start /bin/node: spawn /bin/node ENOENT" });
  expect((await s.check()).said.at(-1)).toBe("claude plugin marketplace update isoplan: couldn't start /bin/node: spawn /bin/node ENOENT");
});

test("command env: no prompts from git or ssh, and none of the session's own variables", () => {
  const none = { sshCommand: false, askPass: false };
  const env = commandEnv({ PATH: "/bin", CLAUDE_CONFIG_DIR: "/c", CLAUDECODE: "1", CLAUDE_CODE_SESSION_ID: "s", CLAUDE_CODE_MESSAGING_TOKEN: "t", GIT_DIR: "/elsewhere" }, none, "/bin/node");
  expect(env).toEqual({
    PATH: "/bin",
    CLAUDE_CONFIG_DIR: "/c",
    GIT_TERMINAL_PROMPT: "0",
    GCM_INTERACTIVE: "never",
    GIT_SSH_COMMAND: "ssh -o BatchMode=yes",
    GIT_ASKPASS: "/bin/node",
    SSH_ASKPASS: "/bin/node",
    SSH_ASKPASS_REQUIRE: "never",
  });
  // A person's own ssh and askpass are kept, from the environment or git's config; the prompts stay off.
  expect(commandEnv({ GIT_SSH_COMMAND: "ssh -i key" }).GIT_SSH_COMMAND).toBe("ssh -i key");
  expect(commandEnv({}, { sshCommand: true, askPass: false }).GIT_SSH_COMMAND).toBeUndefined();
  const askPass = commandEnv({ GIT_ASKPASS: "/usr/bin/my-askpass" }, none, "/bin/node");
  expect(askPass).toMatchObject({ GIT_ASKPASS: "/usr/bin/my-askpass", GIT_TERMINAL_PROMPT: "0", GCM_INTERACTIVE: "never" });
  expect(askPass.SSH_ASKPASS).toBeUndefined();
  expect(commandEnv({ SSH_ASKPASS: "/x" }, none).GIT_ASKPASS).toBeUndefined();
  const configured = commandEnv({}, { sshCommand: false, askPass: true });
  expect(configured.GIT_ASKPASS).toBeUndefined();
  expect(configured).toMatchObject({ GIT_TERMINAL_PROMPT: "0", GCM_INTERACTIVE: "never" });
});

test("run hidden: a command past its time is stopped with what it started; one that can't start says why", async () => {
  const root = tempRoot();
  const pidFile = path.join(root, "child.pid");
  // A stand-in claude that starts a child of its own, and both hang.
  const script = `const c = require("child_process").spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" }); require("fs").writeFileSync(${JSON.stringify(pidFile)}, String(c.pid)); console.log("checking"); setInterval(() => {}, 1000);`;
  const started = Date.now();
  const r = await runHidden([process.execPath, "-e", script], root, { env: commandEnv(process.env), timeoutMs: 4000 });
  expect(r).toMatchObject({ code: null, error: "didn't finish within 4 s, so it was stopped" });
  expect(r.output).toContain("checking");
  expect(Date.now() - started).toBeLessThan(15000);
  const child = Number(fs.readFileSync(pidFile, "utf8"));
  await vi.waitFor(() => expect(alive(child)).toBe(false), { timeout: 5000 });

  const missing = await runHidden([path.join(root, "no-such-claude")], root, { timeoutMs: 5000 });
  expect(missing.code).toBeNull();
  expect(missing.error).toMatch(/^couldn't start .*no-such-claude: .*ENOENT/);
  expect((await runHidden([process.execPath, "-e", "process.exit(3)"], root)).code).toBe(3);
}, 30000);

test("run hidden: done once the command exits, though a process it left behind (an ssh ControlMaster, say) holds its output open", async () => {
  const root = tempRoot();
  const pidFile = path.join(root, "left.pid");
  const script = `const c = require("child_process").spawn(process.execPath, ["-e", "setTimeout(() => {}, 30000)"], { stdio: "inherit", windowsHide: true }); require("fs").writeFileSync(${JSON.stringify(pidFile)}, String(c.pid)); console.log("updated"); c.unref(); process.exit(0);`;
  const started = Date.now();
  try {
    const r = await runHidden([process.execPath, "-e", script], root, { env: commandEnv(process.env), timeoutMs: 20000 });
    expect(r).toEqual({ code: 0, output: expect.stringContaining("updated") });
    expect(Date.now() - started).toBeLessThan(10000);
  } finally {
    try {
      process.kill(Number(fs.readFileSync(pidFile, "utf8")));
    } catch {
      // Gone already.
    }
  }
});
