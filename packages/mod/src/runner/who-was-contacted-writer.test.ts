import fs from "node:fs";
import path from "node:path";
import { expect, test, vi } from "vitest";
import { tempRoot } from "../data-layer/fixture.js";
import { git, remoteAndClone, setIdentity } from "../handoff/fixture.js";
import { createRunGit, type RunGit } from "../handoff/git.js";
import { parseTable } from "./who-was-contacted.js";
import { createWhoWasContactedWriter } from "./who-was-contacted-writer.js";

// git's empty hooks folder goes in a temp Claude folder; commits have an identity whatever this computer's.
vi.stubEnv("CLAUDE_CONFIG_DIR", path.join(tempRoot(), "claude"));
for (const [k, v] of Object.entries({ GIT_AUTHOR_NAME: "Adam", GIT_AUTHOR_EMAIL: "adam@example.invalid", GIT_COMMITTER_NAME: "Adam", GIT_COMMITTER_EMAIL: "adam@example.invalid" })) vi.stubEnv(k, v);
vi.setConfig({ testTimeout: 60000 });

const at = "2026-11-26T09:00:00.000Z";

function setUp(o: { git?: RunGit } = {}) {
  const root = tempRoot();
  const { remote, clone: checkout } = remoteAndClone(root, "checkout");
  const dir = path.join(root, "employees", "adams-outreach");
  const writer = createWhoWasContactedWriter({
    git: o.git ?? createRunGit(),
    dir,
    repo: () => checkout,
    project: () => "git.example.invalid/acme/docs",
    file: () => "who-was-contacted.csv",
    me: () => ({ sender: "Adam", employee: "adams-outreach" }),
    employeeName: () => "Adams Outreach",
    timeoutMs: async () => 20000,
    log: () => {},
    tries: async () => 5,
    delayMs: () => 10,
    cloneFrom: () => true,
  });
  // What the remote's main holds now, read through a clone of its own.
  const onRemote = () => {
    const look = path.join(root, `look-${Math.random().toString(36).slice(2)}`);
    git(root, "clone", "-q", remote, look);
    const file = path.join(look, "who-was-contacted.csv");
    return { rows: parseTable(fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null).rows, message: git(look, "log", "-1", "--format=%s") };
  };
  // Another sender's computer pushing its own row.
  const valentinaPushes = (prospect: string) => {
    const other = path.join(root, `valentina-${Math.random().toString(36).slice(2)}`);
    git(root, "clone", "-q", remote, other);
    setIdentity(other);
    const file = path.join(other, "who-was-contacted.csv");
    const before = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "prospect,state,sender,employee,since,name,organisation\r\n";
    fs.writeFileSync(file, before + `${prospect},claimed,Valentina,valentinas-outreach,${at},,\r\n`);
    git(other, "add", ".");
    git(other, "commit", "-q", "-m", "Valentina's claim");
    git(other, "push", "-q", "origin", "main");
  };
  return { root, remote, dir, writer, onRemote, valentinaPushes };
}

test("a claim is committed unsigned, with a message naming counts only, and pushed; another computer's push in between is reset to and applied again, dropping a claim it now covers; changes already there count as pushed", async () => {
  let pushes = 0;
  let between: (() => void) | null = null;
  const real = createRunGit();
  const s = setUp({ git: async (args, opts) => (args.includes("push") && pushes++ === 0 && between ? between() : undefined, real(args, opts)) });
  await s.writer.load();
  // Signing turned on in the writer's clone, with a signing program that would fail: nothing signs.
  await s.writer.fetch();
  git(path.join(s.dir, "who-was-contacted"), "config", "commit.gpgSign", "true");
  git(path.join(s.dir, "who-was-contacted"), "config", "gpg.program", "no-such-gpg");

  // Valentina's push lands between this write's fetch and its push.
  between = () => s.valentinaPushes("bo@agency.example");
  await s.writer.add([
    { op: "claim", prospect: "ana@studio.example", name: "Ana", organisation: "Studio", draft: "d1", at },
    { op: "claim", prospect: "bo@agency.example", draft: "d2", at },
  ]);
  const r = await s.writer.write();
  expect(r).toMatchObject({ pushed: true, someoneElseHad: ["d2"] });
  const remote = s.onRemote();
  expect(remote.rows.map((x) => [x.prospect, x.sender, x.state])).toEqual([
    ["bo@agency.example", "Valentina", "claimed"],
    ["ana@studio.example", "Adam", "claimed"],
  ]);
  expect(remote.message).toBe("Isoplan: Adam's Adams Outreach claimed 1");
  expect(s.writer.waiting()).toEqual([]);
  expect(s.writer.lookUp("bo@agency.example").others).toHaveLength(1);

  // The same claim again, as after a crash before the waiting file was cleared: nothing to commit, pushed.
  await s.writer.add([{ op: "claim", prospect: "ana@studio.example", draft: "d1b", at }]);
  expect(await s.writer.write()).toMatchObject({ pushed: true });
  expect(s.writer.waiting()).toEqual([]);
});

test("with the remote out of reach the change waits in its file and the problem is said, then goes with the next write; a remote that refuses is told apart and not tried again until the next run's start", async () => {
  const s = setUp();
  await s.writer.load();
  expect(await s.writer.fetch()).toEqual({ ok: true });
  const moved = `${s.remote}.away`;
  fs.renameSync(s.remote, moved);
  await s.writer.add([{ op: "claim", prospect: "ana@studio.example", draft: "d1", at }]);
  const offline = await s.writer.write();
  expect(offline).toMatchObject({ pushed: false });
  expect(s.writer.problem()?.refused).toBeUndefined();
  expect(JSON.parse(fs.readFileSync(path.join(s.dir, "who-was-contacted-changes-waiting.json"), "utf8")).changes).toHaveLength(1);
  fs.renameSync(moved, s.remote);
  expect(await s.writer.write()).toMatchObject({ pushed: true });
  expect(s.writer.problem()).toBeNull();

  // A pre-receive hook that declines every push.
  const hook = path.join(s.remote, "hooks", "pre-receive");
  fs.writeFileSync(hook, "#!/bin/sh\necho 'GH006: Protected branch update failed' >&2\nexit 1\n", { mode: 0o755 });
  await s.writer.add([{ op: "contacted", prospect: "ana@studio.example", draft: "d1", at }]);
  const refused = await s.writer.write();
  expect(refused).toMatchObject({ pushed: false, refused: true });
  fs.rmSync(hook);
  // Not tried again until a run starts, even with the remote taking pushes now.
  expect(await s.writer.write()).toMatchObject({ pushed: false, refused: true });
  expect(await s.writer.write({ runStart: true })).toMatchObject({ pushed: true });
  expect(s.onRemote().rows[0]).toMatchObject({ prospect: "ana@studio.example", state: "contacted" });
});
