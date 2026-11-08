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

const MANIFEST = "https://releases.example/app-v0.1.0/isoplan-app-manifest.json";
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
  const files: Record<string, Buffer> = {};
  const assets: AppManifest["assets"] = {};
  for (const [key, top] of [["win32-x64", "Isoplan"], ["darwin-x64", "Isoplan.app"]] as const) {
    const file = `isoplan-app-${version}-${key}.tar.gz`;
    execFileSync(hostTar, ["-czf", path.join(root, file), "-C", build, top], { windowsHide: true });
    files[file] = fs.readFileSync(path.join(root, file));
    assets[key] = { file, size: files[file]!.length, sha256: createHash("sha256").update(files[file]!).digest("hex") };
  }
  return { manifest: { version, assets } as AppManifest, files };
}

function machine({ desktopApp = true } = {}) {
  const root = tempRoot();
  const home = path.join(root, "home");
  const claudeDir = path.join(home, ".claude");
  const from = path.join(root, "plugin");
  fs.mkdirSync(path.join(claudeDir, "isoplan"), { recursive: true });
  fs.mkdirSync(from, { recursive: true });
  fs.copyFileSync(path.join(modDir, "runner.json"), path.join(from, "runner.json"));
  fs.writeFileSync(path.join(from, "app-release.json"), JSON.stringify({ version: "0.1.0", manifest: MANIFEST.replace("0.1.0", "{version}") }));
  if (!desktopApp) fs.writeFileSync(path.join(claudeDir, "isoplan", "runner.json"), JSON.stringify({ desktopApp: false }));
  let served = release();
  const asked: string[] = [];
  const fakeFetch = (async (url: string | URL) => {
    const href = String(url);
    asked.push(href);
    if (href === MANIFEST) return Response.json(served.manifest);
    const file = served.files[href.slice(href.lastIndexOf("/") + 1)];
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
  return { root, home, claudeDir, from, asked, install, serve: (r: ReturnType<typeof release>) => (served = r), served: () => served, later: (ms: number) => (clock += ms) };
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
    const asset = r.manifest.assets["win32-x64"]!;
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
  m.serve({ manifest: { version: "0.1.0", assets: {} }, files: {} });
  expect(await m.install("darwin", "arm64")).toEqual({ changes: ["the runner stays on node: release 0.1.0 has no desktop app for darwin-arm64"], installed: false });

  const none = machine();
  const missing = (async () => new Response("not found", { status: 404 })) as unknown as typeof fetch;
  const { changes } = await none.install("win32", "x64", { fetch: missing });
  expect(changes).toEqual([`the runner stays on node: couldn't install the desktop app: the release's manifest isn't there (404 from ${MANIFEST}); trying again in 6 hours`]);

  const off = machine({ desktopApp: false });
  expect(await off.install()).toEqual({ changes: [], installed: false });
  expect(off.asked).toEqual([]);
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
  expect(fs.existsSync(desktopAppPath(m.claudeDir))).toBe(false);
});

test("desktop app: a plugin version naming a newer app replaces the running one once the new one is ready", async () => {
  const m = machine();
  await m.install();
  const killed: number[] = [];
  await takeLock(runnerLockPath(m.claudeDir), 4242, () => false, false, Date.now(), { extra: { engine: "app" } });
  fs.writeFileSync(path.join(m.from, "app-release.json"), JSON.stringify({ version: "0.2.0", manifest: MANIFEST.replace("0.1.0", "{version}") }));
  const r = release("0.2.0");
  m.serve(r);
  // The new manifest is at the new version's address.
  const at = MANIFEST.replace("0.1.0", "0.2.0");
  const get = (async (url: string | URL) => {
    const href = String(url);
    if (href === at) return Response.json(r.manifest);
    return new Response(new Uint8Array(r.files[href.slice(href.lastIndexOf("/") + 1)]!));
  }) as typeof fetch;
  const { installed } = await m.install("win32", "x64", { fetch: get, isAlive: (pid: number) => pid === 4242 && !killed.length, kill: (pid: number) => killed.push(pid) });
  expect(installed).toBe(true);
  expect(killed).toEqual([4242]);
  const dir = path.join(m.home, "AppData", "Local", "Programs", "Isoplan");
  expect(fs.readFileSync(path.join(dir, "bin", "launcher.exe"), "utf8")).toBe("launcher 0.2.0");
  expect((await recordedApp(m.claudeDir))?.version).toBe("0.2.0");
  expect(fs.readdirSync(path.dirname(dir))).toEqual(["Isoplan"]);
  expect(fs.existsSync(desktopAppLockPath(m.claudeDir))).toBe(false);
});
