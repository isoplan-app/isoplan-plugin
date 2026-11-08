import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { expect, test } from "vitest";
import { exec } from "../connect/dialog.js";
import { modDir, tempRoot } from "../data-layer/fixture.js";
import { desktopAppPath, recordedApp, runnerLockPath } from "../runner/start.js";
import { takeLock } from "../wake/lock.js";
import { appPlace, desktopAppLockPath, installApp, systemTar, type AppManifest } from "./app.js";
import { uninstall } from "./install.js";

const BASE = "https://releases.example/app-v{version}";
const TEMPLATE = `${BASE}/isoplan-app-{platform}-{arch}.json`;
const manifestAt = (version: string, key: string) => `${BASE.replace("{version}", version)}/isoplan-app-${key}.json`;
const hostTar = systemTar(process.platform, process.env);

// A release with one archive for Windows (Isoplan/bin/launcher.exe) and one for macOS (Isoplan.app with its Info.plist).
function release(version = "0.1.0") {
  const root = tempRoot();
  const build = path.join(root, "build");
  fs.mkdirSync(path.join(build, "Isoplan", "bin"), { recursive: true });
  fs.writeFileSync(path.join(build, "Isoplan", "bin", "launcher.exe"), `launcher ${version}`);
  fs.mkdirSync(path.join(build, "Isoplan.app", "Contents", "MacOS"), { recursive: true });
  fs.writeFileSync(path.join(build, "Isoplan.app", "Contents", "Info.plist"), "<plist><dict><key>CFBundleExecutable</key>\n<string>launcher</string></dict></plist>");
  fs.writeFileSync(path.join(build, "Isoplan.app", "Contents", "MacOS", "launcher"), `launcher ${version}`);
  // Each platform's job uploads its archive and its own manifest beside it.
  const files: Record<string, Buffer> = {};
  const manifests: Record<string, AppManifest> = {};
  for (const [key, top] of [["win32-x64", "Isoplan"], ["darwin-x64", "Isoplan.app"]] as const) {
    const file = `isoplan-app-${version}-${key}.tar.gz`;
    execFileSync(hostTar, ["-czf", path.join(root, file), "-C", build, top], { windowsHide: true });
    files[file] = fs.readFileSync(path.join(root, file));
    manifests[manifestAt(version, key)] = { version, file, size: files[file]!.length, sha256: createHash("sha256").update(files[file]!).digest("hex") };
  }
  return { version, manifests, files };
}

function machine({ desktopApp = true } = {}) {
  const root = tempRoot();
  const home = path.join(root, "home");
  const claudeDir = path.join(home, ".claude");
  const from = path.join(root, "plugin");
  fs.mkdirSync(path.join(claudeDir, "isoplan"), { recursive: true });
  fs.mkdirSync(from, { recursive: true });
  fs.copyFileSync(path.join(modDir, "runner.json"), path.join(from, "runner.json"));
  fs.writeFileSync(path.join(from, "app-release.json"), JSON.stringify({ version: "0.1.0", manifest: TEMPLATE }));
  if (!desktopApp) fs.writeFileSync(path.join(claudeDir, "isoplan", "runner.json"), JSON.stringify({ desktopApp: false }));
  let served = release();
  const asked: string[] = [];
  const fakeFetch = (async (url: string | URL) => {
    const href = String(url);
    asked.push(href);
    if (served.manifests[href]) return Response.json(served.manifests[href]);
    const file = href.includes(`/app-v${served.version}/`) && served.files[href.slice(href.lastIndexOf("/") + 1)];
    return file ? new Response(new Uint8Array(file)) : new Response("not found", { status: 404 });
  }) as typeof fetch;
  let clock = Date.now();
  const install = (platform: NodeJS.Platform = "win32", arch = "x64", extra = {}) =>
    installApp({
      claudeDir,
      from,
      platform,
      arch,
      home,
      env: { LOCALAPPDATA: path.join(home, "AppData", "Local") },
      fetch: fakeFetch,
      // The host's own tar, whichever platform the install is for.
      run: (_tar, args) => exec(hostTar, args),
      now: () => clock,
      ...extra,
    });
  const want = (version: string) => fs.writeFileSync(path.join(from, "app-release.json"), JSON.stringify({ version, manifest: TEMPLATE }));
  return { root, home, claudeDir, from, asked, install, want, serve: (r: ReturnType<typeof release>) => (served = r), served: () => served, later: (ms: number) => (clock += ms) };
}

test("desktop app: downloaded from the release, checked, unpacked for this person and recorded; there already, nothing is fetched", async () => {
  const m = machine();
  const { changes, installed } = await m.install();
  const dir = path.join(m.home, "AppData", "Local", "Programs", "Isoplan");
  expect({ changes, installed }).toEqual({ changes: [`installed Isoplan's desktop app 0.1.0 in ${dir}`], installed: true });
  expect(fs.readFileSync(path.join(dir, "bin", "launcher.exe"), "utf8")).toBe("launcher 0.1.0");
  expect(await recordedApp(m.claudeDir)).toEqual({ version: "0.1.0", dir, launch: path.join(dir, "bin", "launcher.exe") });
  // Nothing is left beside it.
  expect(fs.readdirSync(path.dirname(dir))).toEqual(["Isoplan"]);
  m.asked.length = 0;
  expect(await m.install()).toEqual({ changes: [], installed: false });
  expect(m.asked).toEqual([]);
});

test("desktop app: on macOS it goes in ~/Applications, started by the executable its Info.plist names", async () => {
  const m = machine();
  expect((await m.install("darwin", "x64")).installed).toBe(true);
  const dir = path.posix.join(m.home, "Applications", "Isoplan.app");
  expect(await recordedApp(m.claudeDir)).toEqual({ version: "0.1.0", dir, launch: path.join(dir, "Contents", "MacOS", "launcher") });
  expect(appPlace("linux", m.home, {})).toBeNull();
});

test("desktop app: an archive whose size or sha256 isn't the manifest's is never unpacked; the runner stays on node and tries again later", async () => {
  for (const spoil of ["size", "sha256"] as const) {
    const m = machine();
    const r = release();
    const asset = r.manifests[manifestAt("0.1.0", "win32-x64")]!;
    if (spoil === "size") asset.size += 1;
    else asset.sha256 = "0".repeat(64);
    m.serve(r);
    const { changes, installed } = await m.install();
    expect(installed).toBe(false);
    expect(changes[0]).toMatch(spoil === "size" ? /^the runner stays on node: couldn't install the desktop app: .* bytes, not the .* the manifest says; trying again in 6 hours$/ : /sha256 isn't the one the manifest says/);
    expect(fs.existsSync(path.join(m.home, "AppData", "Local", "Programs", "Isoplan"))).toBe(false);
    expect(fs.readdirSync(path.join(m.home, "AppData", "Local", "Programs"))).toEqual([]);
    expect(await recordedApp(m.claudeDir)).toBeNull();
    // Held off: the next session doesn't download it again, until appRetryHours have passed.
    m.asked.length = 0;
    expect(await m.install()).toEqual({ changes: [], installed: false });
    expect(m.asked).toEqual([]);
    m.serve(release());
    m.later(6 * 3600000 + 1);
    expect((await m.install()).installed).toBe(true);
  }
});

test("desktop app: no release yet, none for this computer, or switched off: the runner stays on node", async () => {
  const m = machine();
  expect(await m.install("darwin", "arm64")).toEqual({ changes: ["the runner stays on node: release 0.1.0 has no desktop app for darwin-arm64 yet; trying again in 6 hours"], installed: false });
  expect(m.asked).toEqual([manifestAt("0.1.0", "darwin-arm64")]);

  const broken = machine();
  const failing = (async () => new Response("bad gateway", { status: 502 })) as unknown as typeof fetch;
  const { changes } = await broken.install("win32", "x64", { fetch: failing });
  expect(changes).toEqual([`the runner stays on node: couldn't install the desktop app: its manifest couldn't be read (502 from ${manifestAt("0.1.0", "win32-x64")}); trying again in 6 hours`]);

  const off = machine({ desktopApp: false });
  expect(await off.install()).toEqual({ changes: [], installed: false });
  expect(off.asked).toEqual([]);
});

test("desktop app: a hold-off holds off only the version that failed; a plugin naming another tries at once", async () => {
  const m = machine();
  // The plugin shipped before its release was built: held off.
  m.serve({ version: "0.1.0", manifests: {}, files: {} });
  expect((await m.install()).changes).toEqual(["the runner stays on node: release 0.1.0 has no desktop app for win32-x64 yet; trying again in 6 hours"]);
  m.asked.length = 0;
  expect(await m.install()).toEqual({ changes: [], installed: false });
  expect(m.asked).toEqual([]);
  // A plugin version naming a fixed 0.1.1 tries it now.
  m.want("0.1.1");
  m.serve(release("0.1.1"));
  expect((await m.install()).installed).toBe(true);
  expect((await recordedApp(m.claudeDir))?.version).toBe("0.1.1");
});

test("desktop app: what an install killed mid-download left beside the app is cleared by the next", async () => {
  const m = machine();
  const programs = path.join(m.home, "AppData", "Local", "Programs");
  for (const left of ["Isoplan.isoplan-999999", "Isoplan.old-999998"]) fs.mkdirSync(path.join(programs, left, "part"), { recursive: true });
  // Another config folder's install under way, by a live pid, is left alone.
  fs.mkdirSync(path.join(programs, "Isoplan.isoplan-4242"));
  const isAlive = (pid: number) => pid === process.pid || pid === 4242;
  expect((await m.install("win32", "x64", { isAlive })).installed).toBe(true);
  expect(fs.readdirSync(programs).sort()).toEqual(["Isoplan", "Isoplan.isoplan-4242"]);
});

test("desktop app: turned off in runner.json, the app it runs on is stopped and taken out of use", async () => {
  const m = machine();
  await m.install();
  const killed: number[] = [];
  await takeLock(runnerLockPath(m.claudeDir), 4242, () => false, false, Date.now(), { extra: { engine: "app" } });
  fs.writeFileSync(path.join(m.claudeDir, "isoplan", "runner.json"), JSON.stringify({ desktopApp: false }));
  const { changes } = await m.install("win32", "x64", { isAlive: (pid: number) => pid === 4242 && !killed.length, kill: (pid: number) => killed.push(pid) });
  expect(changes).toEqual(['took the desktop app out of use, as "desktopApp" is off in runner.json; the runner runs on node']);
  expect(killed).toEqual([4242]);
  expect(await recordedApp(m.claudeDir)).toBeNull();
  expect(await m.install()).toEqual({ changes: [], installed: false });
  // Its folder stays recorded, so uninstall still removes it (with no runner left for it to stop).
  expect(fs.existsSync(runnerLockPath(m.claudeDir))).toBe(false);
  const dir = path.join(m.home, "AppData", "Local", "Programs", "Isoplan");
  const paths = { claudeDir: m.claudeDir, settings: path.join(m.claudeDir, "settings.json"), plugins: path.join(m.claudeDir, "plugins"), managed: path.join(m.root, "managed") };
  expect((await uninstall(paths)).changes).toContain(`removed ${dir}`);
  expect(fs.existsSync(dir)).toBe(false);
});

test("desktop app: a plugin version naming a newer app replaces the running one once the new one is ready", async () => {
  const m = machine();
  await m.install();
  const killed: number[] = [];
  await takeLock(runnerLockPath(m.claudeDir), 4242, () => false, false, Date.now(), { extra: { engine: "app" } });
  m.want("0.2.0");
  m.serve(release("0.2.0"));
  const { installed } = await m.install("win32", "x64", { isAlive: (pid: number) => (pid === 4242 && !killed.length) || pid === process.pid, kill: (pid: number) => killed.push(pid) });
  expect(installed).toBe(true);
  expect(killed).toEqual([4242]);
  const dir = path.join(m.home, "AppData", "Local", "Programs", "Isoplan");
  expect(fs.readFileSync(path.join(dir, "bin", "launcher.exe"), "utf8")).toBe("launcher 0.2.0");
  expect((await recordedApp(m.claudeDir))?.version).toBe("0.2.0");
  expect(fs.readdirSync(path.dirname(dir))).toEqual(["Isoplan"]);
  expect(fs.existsSync(desktopAppLockPath(m.claudeDir))).toBe(false);
});
