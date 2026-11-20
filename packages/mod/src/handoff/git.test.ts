import fs from "node:fs";
import path from "node:path";
import { expect, test, vi } from "vitest";
import { tempRoot } from "../data-layer/fixture.js";
import { remoteNames, remoteNamesPath } from "../data-layer/remote-names.js";
import { addedLines, createRunGit, gitFailed, handoffNote, HandoffGitError, noPromptEnv, prepare, pushHandoff, remotesOf, sameRemote, sameRepo, untrackedLine, withoutCredentials, type Pushed } from "./git.js";
import { git, remoteAndClone, workspace } from "./fixture.js";

// Every test here drives real git, a few dozen spawns each, which is slow on Windows under load.
vi.setConfig({ testTimeout: 30000 });

const run = createRunGit();
const MS = 30000;
// A fake AWS key id, split so no key-shaped string sits in the source.
const FAKE_KEY = "AKIA" + "IOSFODNN7EXAMPLE";
const scan = async (text: string) => (text.includes(FAKE_KEY) ? "AWS access key id" : null);
const repoOf = (p: Pushed) => {
  if ("held" in p) throw new Error(`held: ${p.held}`);
  return p.repos[0]!;
};

test("a dirty tree: tracked changes go to the handoff's branch alone; the tree, index and branch stay as they were, and no local branch is made", async () => {
  const { remote, clone } = remoteAndClone(tempRoot());
  git(clone, "switch", "-q", "-c", "feat/export");
  fs.writeFileSync(path.join(clone, "app.js"), "console.log(2);\n");
  fs.writeFileSync(path.join(clone, "staged.js"), "export {};\n");
  git(clone, "add", "staged.js");
  fs.writeFileSync(path.join(clone, ".env.local"), "API_URL=http://localhost\n");
  fs.writeFileSync(path.join(clone, ".env"), "SECRET=1\n");
  const status = git(clone, "status", "--porcelain");
  const mainBefore = git(remote, "rev-parse", "main");

  const prepared = await prepare(run, clone, MS);
  expect(prepared).toMatchObject({ from: "feat/export", files: [".env.local"] });
  const repo = repoOf(await pushHandoff(run, clone, "h1", MS, { scan }));

  expect(repo).toMatchObject({ path: ".", remote, branch: "isoplan/handoff/h1" });
  expect(git(clone, "status", "--porcelain")).toBe(status);
  expect(git(clone, "branch", "--show-current")).toBe("feat/export");
  expect(git(clone, "branch", "--list", "isoplan/*")).toBe("");
  // Only the handoff's branch reached the remote; main is where it was.
  expect(git(remote, "for-each-ref", "--format=%(refname)")).toBe("refs/heads/isoplan/handoff/h1\nrefs/heads/main");
  expect(git(remote, "rev-parse", "main")).toBe(mainBefore);
  expect(git(remote, "rev-parse", "isoplan/handoff/h1")).toBe(repo.commit);
  expect(git(remote, "show", "isoplan/handoff/h1:app.js")).toBe("console.log(2);");
  expect(git(remote, "ls-tree", "--name-only", "isoplan/handoff/h1")).toBe(".gitignore\napp.js\nstaged.js");
  expect(git(remote, "log", "-1", "--format=%s", "isoplan/handoff/h1")).toBe("WIP: Isoplan handoff h1");

  // A second hand-over of the same handoff replaces its branch.
  fs.writeFileSync(path.join(clone, "app.js"), "console.log(3);\n");
  const again = repoOf(await pushHandoff(run, clone, "h1", MS));
  expect(git(remote, "show", `${again.commit}:app.js`)).toBe("console.log(3);");
});

test("a repo that moved on GitHub: the brief names its current remote, and its old and current names are one repo", async () => {
  const { clone } = remoteAndClone(tempRoot());
  git(clone, "remote", "set-url", "--push", "origin", "https://ada:token@github.com/adamlinscott/isoplan.git");
  const asked: string[] = [];
  const names = remoteNames({ file: remoteNamesPath(tempRoot()), ask: async (owner, repo) => (asked.push(`${owner}/${repo}`), owner === "adamlinscott" ? "isoplan-app/isoplan-app" : `${owner}/${repo}`) });
  // The push itself goes to the clone's own push URL; only what the brief records changes.
  const urls: string[] = [];
  const recording: typeof run = (args, opts) => (args.includes("push") && urls.push(args.at(-2)!), args.includes("push") ? Promise.resolve({ code: 0, stdout: "", stderr: "", timedOut: false }) : run(args, opts));
  fs.writeFileSync(path.join(clone, "app.js"), "console.log(3);\n");
  expect(repoOf(await pushHandoff(recording, clone, "h1", MS, { names })).remote).toBe("https://github.com/isoplan-app/isoplan-app.git");
  expect(urls).toEqual(["origin"]);
  expect(await sameRepo("git@github.com:AdamLinscott/Isoplan.git", "https://github.com/isoplan-app/isoplan-app", names)).toBe(true);
  expect(await sameRepo("git@github.com:adamlinscott/isoplan.git", "https://github.com/isoplan-app/isoplan-app")).toBe(false);
  expect(await sameRepo("https://github.com/team/app", "https://github.com/team/api", names)).toBe(false);
  expect(asked).toEqual(["adamlinscott/isoplan", "isoplan-app/isoplan-app", "team/app", "team/api"]);
});

test("a possible secret in what the push sends holds it, naming the file and what couldn't be checked; pushing anyway pushes that exact commit", async () => {
  const { remote, clone } = remoteAndClone(tempRoot());
  fs.mkdirSync(path.join(clone, "config"));
  fs.writeFileSync(path.join(clone, "config", "dev.ts"), `export const key = "${FAKE_KEY}";\n`);
  fs.writeFileSync(path.join(clone, "logo.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 1, 2, 3]));
  git(clone, "add", "config/dev.ts", "logo.png");
  const held = await pushHandoff(run, clone, "h1", MS, { scan });
  expect(held).toEqual({ held: ["config/dev.ts"], commits: { ".": expect.stringMatching(/^[0-9a-f]{40}$/) }, unchecked: ["logo.png"] });
  const commit = (held as { commits: Record<string, string> }).commits["."]!;
  expect(git(remote, "for-each-ref", "--format=%(refname)")).toBe("refs/heads/main");
  // The tree changes after the hold; pushing anyway still sends the commit that was held.
  fs.writeFileSync(path.join(clone, "config", "dev.ts"), "export const key = 'fixed';\n");
  const pushed = repoOf(await pushHandoff(run, clone, "h1", MS, { scan, pushAnyway: { ".": commit } }));
  expect(pushed.commit).toBe(commit);
  expect(git(remote, "show", `isoplan/handoff/h1:config/dev.ts`)).toContain(FAKE_KEY);
});

test("a clean tree still scans the commits the remote doesn't have", async () => {
  const { remote, clone } = remoteAndClone(tempRoot());
  fs.writeFileSync(path.join(clone, "local.ts"), `export const key = "${FAKE_KEY}";\n`);
  git(clone, "add", "local.ts");
  git(clone, "commit", "-q", "-m", "a local commit");
  expect(await pushHandoff(run, clone, "h1", MS, { scan })).toMatchObject({ held: ["local.ts"] });
  expect(git(remote, "for-each-ref", "--format=%(refname)")).toBe("refs/heads/main");
});

test("addedLines: a +++ line is a header only after its --- line, so content starting with ++ is scanned", () => {
  const patch = ["diff --git a/a.ts b/a.ts", "--- a/a.ts", "+++ b/a.ts", "@@ -1 +1,2 @@", "-old", "++++ b/notes.ts", "+new", "diff --git a/x.png b/x.png", "Binary files /dev/null and b/x.png differ", ""].join("\n");
  expect(addedLines(patch)).toEqual({ lines: new Map([["a.ts", "+++ b/notes.ts\nnew\n"]]), binary: ["x.png"] });
});

test("a repo that uses Git LFS is refused, with nothing pushed", async () => {
  const { remote, clone } = remoteAndClone(tempRoot());
  fs.writeFileSync(path.join(clone, ".gitattributes"), "*.psd filter=lfs diff=lfs merge=lfs -text\n");
  git(clone, "add", ".gitattributes");
  await expect(pushHandoff(run, clone, "h1", MS)).rejects.toMatchObject({ kind: "lfs" });
  expect(git(remote, "for-each-ref", "--format=%(refname)")).toBe("refs/heads/main");
});

test("the push goes where the branch pushes: branch.<x>.pushRemote, then remote.pushDefault", async () => {
  const root = tempRoot();
  const { clone } = remoteAndClone(root);
  const fork = path.join(root, "fork.git");
  const other = path.join(root, "other.git");
  for (const bare of [fork, other]) git(root, "init", "-q", "--bare", bare);
  git(clone, "remote", "add", "fork", fork);
  git(clone, "remote", "add", "other", other);
  git(clone, "config", "remote.pushDefault", "other");
  expect(repoOf(await pushHandoff(run, clone, "h1", MS)).remote).toBe(other);
  git(clone, "config", "branch.main.pushRemote", "fork");
  expect(repoOf(await pushHandoff(run, clone, "h2", MS)).remote).toBe(fork);
});

test("the push goes to the push URL, which the handoff records; the sender's pre-push hook doesn't run, and nothing is signed", async () => {
  const root = tempRoot();
  const { remote, clone } = remoteAndClone(root);
  const mirror = path.join(root, "mirror.git");
  git(root, "init", "-q", "--bare", mirror);
  git(clone, "config", "remote.origin.pushurl", mirror);
  fs.writeFileSync(path.join(clone, ".git", "hooks", "pre-push"), "#!/bin/sh\nexit 1\n", { mode: 0o755 });
  git(clone, "config", "commit.gpgSign", "true");
  git(clone, "config", "gpg.program", "no-such-gpg");
  fs.writeFileSync(path.join(clone, "app.js"), "console.log(2);\n");
  const repo = repoOf(await pushHandoff(run, clone, "h1", MS));
  expect(repo.remote).toBe(mirror);
  expect(git(mirror, "rev-parse", "isoplan/handoff/h1")).toBe(repo.commit);
  expect(git(remote, "for-each-ref", "--format=%(refname)")).toBe("refs/heads/main");
});

test("a clean tree hands over HEAD itself; a folder outside git, or a repo with no remote, is refused with the kind", async () => {
  const root = tempRoot();
  const { clone } = remoteAndClone(root);
  const repo = repoOf(await pushHandoff(run, clone, "h2", MS));
  expect(repo.commit).toBe(git(clone, "rev-parse", "HEAD"));

  const outside = path.join(root, "plain");
  fs.mkdirSync(outside);
  await expect(pushHandoff(run, outside, "h3", MS)).rejects.toMatchObject({ kind: "not-a-repo" });
  git(clone, "remote", "remove", "origin");
  const failed = await pushHandoff(run, clone, "h4", MS).catch((err: unknown) => err);
  expect(failed).toBeInstanceOf(HandoffGitError);
  expect(failed).toMatchObject({ kind: "no-remote" });
});

test("git's environment: no prompts, the person's own ssh kept, and nothing pointing at another repo", async () => {
  const env = noPromptEnv({ PATH: "p", GIT_DIR: "/elsewhere/.git", GIT_WORK_TREE: "/elsewhere", GIT_INDEX_FILE: "/i", Git_Dir: "/x" });
  expect(env).toEqual({ PATH: "p", GIT_TERMINAL_PROMPT: "0", GCM_INTERACTIVE: "never", GIT_SSH_COMMAND: "ssh -o BatchMode=yes" });
  expect(noPromptEnv({ GIT_SSH_COMMAND: "my-ssh" }).GIT_SSH_COMMAND).toBe("my-ssh");
  expect(noPromptEnv({}, true).GIT_SSH_COMMAND).toBe(undefined);
  // A repo whose config sets core.sshCommand keeps it.
  const { clone } = remoteAndClone(tempRoot());
  git(clone, "config", "core.sshCommand", "my-ssh -i key");
  // Run apart from this machine's own ssh variables and global or system git config, so only the repo's config counts.
  const noConfig = path.join(tempRoot(), "gitconfig");
  fs.writeFileSync(noConfig, "");
  const isolated = createRunGit({ ...process.env, GIT_SSH_COMMAND: undefined, GIT_SSH: undefined, GIT_CONFIG_GLOBAL: noConfig, GIT_CONFIG_NOSYSTEM: "1" });
  const shown = (cwd: string) => isolated(["-c", "alias.ssh-env=!echo \"[$GIT_SSH_COMMAND]\"", "ssh-env"], { cwd, timeoutMs: MS }).then((r) => r.stdout.trim());
  expect(await shown(clone)).toBe("[]");
  expect(await shown(path.dirname(clone))).toBe("[ssh -o BatchMode=yes]");
});

test("the note and the request name untracked files, capped, and say when they are unknown; remotes compare without credentials", async () => {
  const at = new Date("2026-10-29T16:05:00Z");
  expect(handoffNote({ branch: "isoplan/handoff/h1", from: "feat/x", files: [".env.local"], at })).toBe(
    "Handed over by Isoplan on the branch isoplan/handoff/h1, made from feat/x, with the tracked changes in a work-in-progress commit. This describes the work tree as of 2026-10-29 16:05 UTC.\nUntracked files, not handed over: `.env.local`.",
  );
  expect(handoffNote({ branch: "b", from: null, files: null, at })).toContain("Untracked files: unknown, since git couldn't list them.");
  expect(untrackedLine([])).toBe("There are no untracked files.");
  expect(untrackedLine(null)).toBe("The untracked files couldn't be listed, so don't name any.");
  expect(untrackedLine([".env.local"])).toBe("The untracked files are: `.env.local`. Say what each is for.");
  expect(untrackedLine(Array.from({ length: 60 }, (_, i) => `f${i}`))).toMatch(/`f49`, and 10 more\. Say what each is for\.$/);
  expect(withoutCredentials("https://adam:token@github.com/team/app.git")).toBe("https://github.com/team/app.git");
  expect(sameRemote("git@github.com:Team/App.git", "https://token@github.com/team/app")).toBe(true);
  expect(sameRemote("https://github.com/team/app", "https://github.com/team/api")).toBe(false);
  const local = path.join(tempRoot(), "remote.git");
  expect(sameRemote(local, `${local}${path.sep}`)).toBe(true);
  expect(sameRemote(local, path.join(tempRoot(), "remote.git"))).toBe(false);
  if (process.platform === "win32") expect(sameRemote("C:\\work\\remote.git", "c:/work/remote.git")).toBe(true);
  // A remote whose path has spaces is read whole.
  const spaced = path.join(tempRoot(), "with spaces");
  fs.mkdirSync(spaced);
  const { remote, clone } = remoteAndClone(spaced);
  git(clone, "config", "remote.origin.pushurl", "git@github.com:team/app.git");
  expect(await remotesOf(run, clone, MS)).toEqual([{ name: "origin", urls: [remote, "git@github.com:team/app.git"] }]);
});

// Several repos (#56). Each test drives a dozen git commands per repo, so they get longer.
const SLOW = 60000;
const refs = (remote: string) => git(remote, "for-each-ref", "--format=%(refname)");

test("several repos: the parent always goes, and of the repos under it only those with work, each with its own .gitignore, to its own remote; no default branch is pushed", async () => {
  const w = workspace(tempRoot(), "sender");
  const api = path.join(w.dir, "api");
  const web = path.join(w.dir, "web");
  git(api, "switch", "-q", "-c", "feat/auth");
  fs.writeFileSync(path.join(api, "server.js"), "listen(2);\n");
  fs.writeFileSync(path.join(api, "notes.md"), "todo\n");
  fs.writeFileSync(path.join(api, ".env"), "SECRET=1\n");
  const mains = Object.values(w.remotes).map((r) => git(r, "rev-parse", "main"));

  const prepared = await prepare(run, w.dir, MS);
  expect(prepared.repos.map((r) => [r.path, r.from])).toEqual([[".", "main"], ["api", "feat/auth"]]);
  expect(prepared.files).toEqual(["api/notes.md"]);
  expect(prepared.left).toEqual([{ path: "web", why: expect.stringContaining("no work") }]);
  const note = handoffNote({ branch: "isoplan/handoff/m1", from: prepared.from, files: prepared.files, at: new Date("2026-10-29T16:05:00Z"), repos: prepared.repos, left: prepared.left });
  expect(note).toContain("in each of these repos, by their paths in the session's folder, with each one's tracked changes in a work-in-progress commit: `.` (made from main), `api` (made from feat/auth).");
  expect(note).toContain("Not handed over, since they have no work that isn't on their remote's default branch: `web`.");
  expect(note).not.toContain(".env");

  const pushed = await pushHandoff(run, w.dir, "m1", MS, { scan });
  if ("held" in pushed) throw new Error("held");
  expect(pushed.repos).toEqual([
    { path: ".", remote: w.remotes.parent, branch: "isoplan/handoff/m1", commit: git(w.dir, "rev-parse", "HEAD") },
    { path: "api", remote: w.remotes.api, branch: "isoplan/handoff/m1", commit: expect.stringMatching(/^[0-9a-f]{40}$/) },
  ]);
  expect(git(w.remotes.api, "show", "isoplan/handoff/m1:server.js")).toBe("listen(2);");
  expect(git(w.remotes.api, "ls-tree", "--name-only", "isoplan/handoff/m1")).toBe(".gitignore\nserver.js");
  expect(refs(w.remotes.web)).toBe("refs/heads/main");
  expect(git(api, "branch", "--show-current")).toBe("feat/auth");
  expect(Object.values(w.remotes).map((r) => git(r, "rev-parse", "main"))).toEqual(mains);

  // A commit that isn't on the default branch is work too, with a clean tree.
  fs.writeFileSync(path.join(web, "index.html"), "<p>2</p>\n");
  git(web, "commit", "-q", "-am", "local");
  expect((await prepare(run, w.dir, MS)).repos.map((r) => r.path)).toEqual([".", "api", "web"]);
}, SLOW);

test("several repos: only those the office takes are handed over; the rest, and what is in them, are named only to the sender (#91)", async () => {
  const w = workspace(tempRoot(), "sender");
  const api = path.join(w.dir, "api");
  const web = path.join(w.dir, "web");
  fs.writeFileSync(path.join(api, "server.js"), "listen(2);\n");
  fs.writeFileSync(path.join(api, "notes.md"), "todo\n");
  fs.writeFileSync(path.join(web, "index.html"), "<p>2</p>\n");
  fs.writeFileSync(path.join(web, "secret-plan.md"), "side project\n");
  const takes = async (dir: string) => path.resolve(dir) !== path.resolve(web);

  const prepared = await prepare(run, w.dir, MS, undefined, undefined, takes);
  expect(prepared.repos.map((r) => r.path)).toEqual([".", "api"]);
  expect(prepared.notInOffice).toEqual(["web"]);
  expect(prepared.files).toEqual(["api/notes.md"]);
  const note = handoffNote({ branch: "isoplan/handoff/m2", from: prepared.from, files: prepared.files, at: new Date(), repos: prepared.repos, left: prepared.left });
  expect(note).not.toContain("web");
  expect(note).not.toContain("secret-plan");
  const pushed = await pushHandoff(run, w.dir, "m2", MS, { scan, prepared });
  expect("repos" in pushed && pushed.repos.map((r) => r.path)).toEqual([".", "api"]);
  expect(refs(w.remotes.web)).toBe("refs/heads/main");

  // With the folder's own repo not taken, nothing goes.
  await expect(prepare(run, w.dir, MS, undefined, undefined, async () => false)).rejects.toMatchObject({ kind: "not-in-office" });
}, SLOW);

test("several repos: every possible secret in every repo holds every push, each named by its path in the folder; pushing anyway takes each repo's held commit", async () => {
  const w = workspace(tempRoot(), "sender");
  fs.writeFileSync(path.join(w.dir, "api", "server.js"), `const key = "${FAKE_KEY}";\n`);
  fs.writeFileSync(path.join(w.dir, "api", "other.js"), `const also = "${FAKE_KEY}";\n`);
  git(path.join(w.dir, "api"), "add", "other.js");
  fs.writeFileSync(path.join(w.dir, "web", "index.html"), `<p>${FAKE_KEY}</p>\n`);
  const held = await pushHandoff(run, w.dir, "m2", MS, { scan });
  expect(held).toEqual({ held: ["api/other.js", "api/server.js", "web/index.html"], commits: { api: expect.stringMatching(/^[0-9a-f]{40}$/), web: expect.stringMatching(/^[0-9a-f]{40}$/) }, unchecked: [] });
  for (const remote of Object.values(w.remotes)) expect(refs(remote)).toBe("refs/heads/main");
  const { commits } = held as { commits: Record<string, string> };
  const pushed = await pushHandoff(run, w.dir, "m2", MS, { scan, pushAnyway: commits });
  if ("held" in pushed) throw new Error("held");
  expect(pushed.repos.map((r) => r.path)).toEqual([".", "api", "web"]);
  expect(git(w.remotes.api, "rev-parse", "isoplan/handoff/m2")).toBe(commits.api);
}, SLOW);

test("a plain folder above the repos: only those with work go; none with work, or none at all, is refused; submodules, and repos too deep, aren't handed over", async () => {
  const root = tempRoot();
  const w = workspace(root, "lorveil", { parent: false });
  const web = path.join(w.dir, "web");
  await expect(pushHandoff(run, w.dir, "m3", MS)).rejects.toMatchObject({ kind: "no-work" });
  // web gets a submodule, committed and pushed, so web itself has no work.
  git(web, "-c", "protocol.file.allow=always", "submodule", "add", "-q", w.remotes.api, "vendor/api");
  git(web, "commit", "-q", "-m", "vendor");
  git(web, "push", "-q", "origin", "main");
  fs.writeFileSync(path.join(w.dir, "api", "server.js"), "listen(3);\n");
  // One repo four folders down, past the default depth.
  const deep = path.join(w.dir, "a", "b", "c", "deep");
  git(root, "clone", "-q", w.remotes.web, deep);
  const prepared = await prepare(run, w.dir, MS);
  expect(prepared).toMatchObject({ toplevel: path.resolve(w.dir), from: null });
  expect(prepared.repos.map((r) => r.path)).toEqual(["api"]);
  expect(prepared.left).toEqual([
    { path: "a/b/c/deep", why: "since they are deeper than repoSearchDepth" },
    { path: "web", why: expect.stringContaining("no work") },
    { path: "web/vendor/api", why: "since they are git submodules, which a handoff doesn't carry" },
  ]);
  expect((await prepare(run, w.dir, MS, 5)).left).toContainEqual({ path: "a/b/c/deep", why: expect.stringContaining("no work") });
  const pushed = await pushHandoff(run, w.dir, "m3", MS);
  expect(pushed).toEqual({ repos: [{ path: "api", remote: w.remotes.api, branch: "isoplan/handoff/m3", commit: expect.any(String) }] });
  expect(refs(w.remotes.web)).toBe("refs/heads/main");

  const empty = path.join(root, "empty");
  fs.mkdirSync(empty);
  await expect(pushHandoff(run, empty, "m4", MS)).rejects.toMatchObject({ kind: "not-a-repo" });
}, SLOW);

test("a repo under the folder with work but no remote is left out and named; one that uses Git LFS refuses the handoff, naming the repo", async () => {
  const w = workspace(tempRoot(), "sender");
  const api = path.join(w.dir, "api");
  const web = path.join(w.dir, "web");
  git(web, "remote", "remove", "origin");
  fs.writeFileSync(path.join(web, "index.html"), "<p>2</p>\n");
  expect((await prepare(run, w.dir, MS)).left).toContainEqual({ path: "web", why: "since they have no remote to push to" });
  fs.writeFileSync(path.join(api, ".gitattributes"), "*.psd filter=lfs diff=lfs merge=lfs -text\n");
  git(api, "add", ".gitattributes");
  const failed = await pushHandoff(run, w.dir, "m5", MS).catch((err: unknown) => err);
  expect(failed).toMatchObject({ kind: "lfs", repo: "api" });
  expect(gitFailed(failed as HandoffGitError)).toBe("a repo in the session's folder uses Git LFS, whose files a handoff can't push yet (in api)");
  for (const remote of [w.remotes.parent, w.remotes.api]) expect(refs(remote)).toBe("refs/heads/main");
}, SLOW);

test("repos that push to one remote get a branch each there, and nothing overwrites another", async () => {
  const w = workspace(tempRoot(), "sender");
  git(path.join(w.dir, "web"), "remote", "set-url", "origin", w.remotes.api);
  git(path.join(w.dir, "web"), "fetch", "-q", "origin");
  fs.writeFileSync(path.join(w.dir, "api", "server.js"), "listen(2);\n");
  fs.writeFileSync(path.join(w.dir, "web", "index.html"), "<p>2</p>\n");
  const prepared = await prepare(run, w.dir, MS);
  expect(prepared.repos.map((r) => [r.path, r.suffix])).toEqual([[".", null], ["api", null], ["web", "web"]]);
  expect(handoffNote({ branch: "isoplan/handoff/s1", from: null, files: [], at: new Date(), repos: prepared.repos })).toContain("`web` (made from main, on isoplan/handoff/s1--web, since it pushes to the same remote as a repo before it)");
  const pushed = await pushHandoff(run, w.dir, "s1", MS, { prepared });
  if ("held" in pushed) throw new Error("held");
  expect(pushed.repos.map((r) => [r.path, r.branch])).toEqual([[".", "isoplan/handoff/s1"], ["api", "isoplan/handoff/s1"], ["web", "isoplan/handoff/s1--web"]]);
  expect(git(w.remotes.api, "show", "isoplan/handoff/s1:server.js")).toBe("listen(2);");
  expect(git(w.remotes.api, "show", "isoplan/handoff/s1--web:index.html")).toBe("<p>2</p>");
}, SLOW);

test("a push that fails after others went says which went, and handing over again with the same id pushes the rest", async () => {
  const root = tempRoot();
  const w = workspace(root, "sender");
  const web = path.join(w.dir, "web");
  fs.writeFileSync(path.join(w.dir, "api", "server.js"), "listen(2);\n");
  fs.writeFileSync(path.join(web, "index.html"), "<p>2</p>\n");
  git(web, "config", "remote.origin.pushurl", path.join(root, "gone.git"));
  const failed = await pushHandoff(run, w.dir, "p1", MS).catch((err: unknown) => err);
  expect(failed).toMatchObject({ kind: "failed", repo: "web", pushed: [".", "api"] });
  expect(gitFailed(failed as HandoffGitError)).toBe("git couldn't push the handoff's branch (in web); the branch was pushed already in ., api, and handing it over again with the same id pushes the rest");
  git(web, "config", "--unset", "remote.origin.pushurl");
  const again = await pushHandoff(run, w.dir, "p1", MS);
  if ("held" in again) throw new Error("held");
  expect(git(w.remotes.web, "show", "isoplan/handoff/p1:index.html")).toBe("<p>2</p>");
}, SLOW);

test("a repo under the folder git can't read is left out with why, and the rest still go; a clean repo with no default branch known goes only with commits no remote branch has", async () => {
  const w = workspace(tempRoot(), "sender");
  const web = path.join(w.dir, "web");
  fs.writeFileSync(path.join(w.dir, "api", "server.js"), "listen(2);\n");
  fs.writeFileSync(path.join(web, ".git", "HEAD"), "not a ref\n");
  fs.mkdirSync(path.join(w.dir, "ghost", ".git"), { recursive: true });
  const prepared = await prepare(run, w.dir, MS);
  expect(prepared.repos.map((r) => r.path)).toEqual([".", "api"]);
  expect(prepared.left).toEqual([
    { path: "ghost", why: "since git couldn't read them" },
    { path: "web", why: "since git couldn't read them" },
  ]);

  const v = workspace(tempRoot(), "sender");
  const api = path.join(v.dir, "api");
  git(api, "remote", "set-head", "origin", "-d");
  expect((await prepare(run, v.dir, MS)).left).toContainEqual({ path: "api", why: expect.stringContaining("no work") });
  git(api, "commit", "-q", "--allow-empty", "-m", "local");
  expect((await prepare(run, v.dir, MS)).repos.map((r) => r.path)).toEqual([".", "api"]);
}, SLOW);

test("the home folder, or a drive's root, is too wide to hand over from; repos in dot folders, node_modules and links are named, not looked in", async () => {
  const root = tempRoot();
  const w = workspace(root, "lorveil", { parent: false });
  await expect(prepare(run, w.dir, MS, 3, w.dir)).rejects.toMatchObject({ kind: "too-wide" });
  await expect(prepare(run, path.parse(w.dir).root, MS, 1, w.dir)).rejects.toMatchObject({ kind: "too-wide" });
  for (const hidden of [".cache/tool", "node_modules"]) git(root, "clone", "-q", w.remotes.api, path.join(w.dir, hidden));
  fs.symlinkSync(path.join(w.dir, "api"), path.join(w.dir, "linked"), "junction");
  fs.writeFileSync(path.join(w.dir, "api", "server.js"), "listen(2);\n");
  const { left } = await prepare(run, w.dir, MS);
  expect(left).toContainEqual({ path: "linked", why: "since they are reached through a link, which isn't followed" });
  expect(left).toContainEqual({ path: "node_modules", why: "since they are node_modules folders, which aren't looked in" });
  // A dot folder is named when it is a repo itself; what is inside one isn't looked for.
  expect(left.map((l) => l.path)).not.toContain(".cache/tool");
}, SLOW);

test("only the handoff branch's history is pushed: no tags, even with push.followTags on", async () => {
  const { remote, clone } = remoteAndClone(tempRoot());
  git(clone, "config", "push.followTags", "true");
  git(clone, "commit", "-q", "--allow-empty", "-m", "local");
  git(clone, "tag", "-a", "v9", "-m", "a release");
  repoOf(await pushHandoff(run, clone, "t1", MS));
  expect(refs(remote)).toBe("refs/heads/isoplan/handoff/t1\nrefs/heads/main");
}, SLOW);

test("a retry, or a later handoff, still hands over a commits-only repo with no <remote>/HEAD: its handoff branches aren't the remote's own work", async () => {
  const w = workspace(tempRoot(), "sender");
  const api = path.join(w.dir, "api");
  git(api, "remote", "set-head", "origin", "-d");
  git(api, "commit", "-q", "--allow-empty", "-m", "local");
  expect((await prepare(run, w.dir, MS)).repos.map((r) => r.path)).toEqual([".", "api"]);
  const first = await pushHandoff(run, w.dir, "r1", MS, { scan });
  if ("held" in first) throw new Error("held");
  // The push left origin/isoplan/handoff/r1 in the clone, holding that commit.
  expect(git(api, "rev-parse", "origin/isoplan/handoff/r1")).toBe(git(api, "rev-parse", "HEAD"));
  expect((await prepare(run, w.dir, MS)).repos.map((r) => r.path)).toEqual([".", "api"]);
  // And the scan reads that commit again: what the remote holds on a handoff branch isn't vetted.
  fs.writeFileSync(path.join(api, "key.js"), `const k = "${FAKE_KEY}";\n`);
  git(api, "add", "key.js");
  git(api, "commit", "-q", "-m", "with a key");
  expect(await pushHandoff(run, w.dir, "r2", MS, { scan })).toMatchObject({ held: ["api/key.js"] });
  git(api, "push", "-q", "origin", "HEAD:refs/heads/isoplan/handoff/r2");
  expect(await pushHandoff(run, w.dir, "r2", MS, { scan })).toMatchObject({ held: ["api/key.js"] });
}, SLOW);

test("a clean repo with no remote isn't mentioned; in a plain folder, files outside every repo are named as not handed over", async () => {
  const w = workspace(tempRoot(), "lorveil", { parent: false });
  git(path.join(w.dir, "web"), "remote", "remove", "origin");
  fs.writeFileSync(path.join(w.dir, "api", "server.js"), "listen(2);\n");
  fs.writeFileSync(path.join(w.dir, "notes.md"), "plans\n");
  fs.mkdirSync(path.join(w.dir, "docs"));
  fs.writeFileSync(path.join(w.dir, "docs", "plan.md"), "more\n");
  const prepared = await prepare(run, w.dir, MS);
  expect(prepared.left).toEqual([]);
  expect(prepared.files).toEqual(["docs/plan.md", "notes.md"]);
  expect(handoffNote({ branch: "b", from: null, files: prepared.files, at: new Date(), repos: prepared.repos })).toContain("Untracked files, not handed over: `docs/plan.md`, `notes.md`.");
}, SLOW);
