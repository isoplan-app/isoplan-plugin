// Installs the desktop app (packages/app), which becomes the machine's runner (ADR 0007, 8 Nov
// update): an Electrobun app whose main process supervises the runner's worker and shows the
// Isoplan icon in the tray or menu bar. The plugin installs it the way it installs the runner's copy:
// for this person only, with no admin rights, no window and nothing to click.
//
// app-release.json, in the plugin's folder, names the app version this plugin version wants and
// where its release's manifest is. The manifest lists one archive per platform and CPU, each with
// its size and sha256. When the release has one for this computer, it is downloaded (public, no
// sign-in), checked against both, unpacked with the system's own tar, hidden, and moved into place:
// %LOCALAPPDATA%\Programs\Isoplan on Windows, ~/Applications/Isoplan.app on macOS. Then
// runner/desktop-app.json records it, and startRunner opens the app from then on in place of node
// (src/runner/start.ts), which also starts it at login, since the login item goes through it.
//
// On anything else (no app for this computer, `desktopApp` off in runner.json, a download or check
// that fails) the runner goes on running on node, exactly as before, and the reason is logged. A
// failure holds off trying again for `appRetryHours`. A plugin version that names a newer app
// replaces the installed one the same way: the running app is stopped once the new one is ready, and
// started again by the caller. One install runs at a time on the machine (runner/desktop-app.lock).

import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import { exec, type Exec } from "../connect/dialog.js";
import { loadSettings } from "../data-layer/config.js";
import { nodeIo } from "../data-layer/io.js";
import { desktopAppPath, isAppLock, recordedApp, runnerLockPath, stopRunner, type DesktopApp } from "../runner/start.js";
import { alive, holdOff, readLock, releaseLock, takeLock } from "../wake/lock.js";

export const desktopAppLockPath = (claudeDir: string) => path.join(claudeDir, "isoplan", "runner", "desktop-app.lock");

/** What app-release.json says. */
export interface AppRelease {
  version: string;
  /** The manifest's address; `{version}` stands for the version. */
  manifest: string;
}

/** One archive the manifest lists. */
export interface AppAsset {
  file: string;
  size: number;
  sha256: string;
}

export interface AppManifest {
  version: string;
  /** By `<platform>-<arch>`, as Node names them: win32-x64, darwin-x64, darwin-arm64. */
  assets: Record<string, AppAsset>;
}

/** Where the app goes for this person, the folder its archive holds at its top, and the program to start in it. */
export function appPlace(platform: NodeJS.Platform, home: string, env: Record<string, string | undefined>): { dir: string; top: string } | null {
  if (platform === "win32") return { dir: path.win32.join(env.LOCALAPPDATA || path.win32.join(home, "AppData", "Local"), "Programs", "Isoplan"), top: "Isoplan" };
  if (platform === "darwin") return { dir: path.posix.join(home, "Applications", "Isoplan.app"), top: "Isoplan.app" };
  return null;
}

/** The program that starts the app: Electrobun's launcher on Windows, the bundle's executable on macOS. */
async function launchOf(dir: string, platform: NodeJS.Platform): Promise<string> {
  if (platform === "win32") return path.join(dir, "bin", "launcher.exe");
  const plist = await fs.readFile(path.join(dir, "Contents", "Info.plist"), "utf8");
  const name = /<key>CFBundleExecutable<\/key>\s*<string>([^<]+)<\/string>/.exec(plist)?.[1];
  if (!name) throw new Error("its Info.plist names no executable");
  return path.join(dir, "Contents", "MacOS", name);
}

/** The system's own tar, by its full path: another tar first on PATH (Git Bash's) misreads C:\ paths. */
export const systemTar = (platform: NodeJS.Platform, env: Record<string, string | undefined>) =>
  platform === "win32" ? path.win32.join(env.SystemRoot || "C:\\Windows", "System32", "tar.exe") : "/usr/bin/tar";

export interface InstallApp {
  claudeDir: string;
  /** The plugin's folder: app-release.json and runner.json. */
  from: string;
  platform: NodeJS.Platform;
  arch: string;
  home: string;
  env: Record<string, string | undefined>;
  fetch?: typeof fetch;
  run?: Exec;
  isAlive?: (pid: number) => boolean;
  /** Ends the running app's process tree. */
  kill?: (pid: number) => void;
  now?: () => number;
  /** How long to wait for a running app to exit before it is replaced. */
  exitMs?: number;
}

interface AppSettings {
  desktopApp: boolean;
  appDownloadSeconds: number;
  appRetryHours: number;
}

/**
 * Puts the app this plugin version names in place, unless it is there already. Says what it
 * changed, and, when nothing was installed, why the runner stays on node; `installed` is true when
 * a new app is in place, for the caller to start it.
 */
export async function installApp(o: InstallApp): Promise<{ changes: string[]; installed: boolean }> {
  const { claudeDir, platform } = o;
  const now = o.now ?? Date.now;
  const isAlive = o.isAlive ?? alive;
  const settings = await loadSettings<AppSettings>(nodeIo(), path.join(o.from, "runner.json"), path.join(claudeDir, "isoplan", "runner.json"));
  const recorded = await recordedApp(claudeDir);
  const place = appPlace(platform, o.home, o.env);
  const stay = (why: string) => ({ changes: [`the runner stays on node: ${why}`], installed: false });
  if (!settings.desktopApp) {
    if (!recorded) return { changes: [], installed: false };
    await stopApp(o, isAlive, now);
    await fs.rm(desktopAppPath(claudeDir), { force: true });
    return { changes: ['took the desktop app out of use, as "desktopApp" is off in runner.json; the runner runs on node'], installed: false };
  }
  if (!place) return { changes: [], installed: false };
  const release = JSON.parse(await fs.readFile(path.join(o.from, "app-release.json"), "utf8")) as AppRelease;
  if (recorded?.version === release.version && recorded.dir === place.dir) return { changes: [], installed: false };

  const lock = desktopAppLockPath(claudeDir);
  const downloadMs = settings.appDownloadSeconds * 1000;
  // Another install is under way, or one failed and holds off.
  if (!(await takeLock(lock, process.pid, isAlive, false, now(), { freshMs: 2 * downloadMs + 60000 }))) return { changes: [], installed: false };
  const staging = `${place.dir}.isoplan-${process.pid}`;
  try {
    const manifestUrl = release.manifest.replace(/\{version\}/g, release.version);
    const got = await (o.fetch ?? fetch)(manifestUrl, { signal: AbortSignal.timeout(downloadMs) });
    if (!got.ok) throw new Error(`the release's manifest isn't there (${got.status} from ${manifestUrl})`);
    const manifest = (await got.json()) as AppManifest;
    const key = `${platform}-${o.arch}`;
    const asset = manifest.assets?.[key];
    if (!asset) {
      await holdOff(lock, process.pid, now() + settings.appRetryHours * 3600000);
      return stay(`release ${release.version} has no desktop app for ${key}`);
    }
    await fs.rm(staging, { recursive: true, force: true });
    await fs.mkdir(staging, { recursive: true });
    const archive = path.join(staging, asset.file);
    await download(o.fetch ?? fetch, new URL(asset.file, manifestUrl).href, archive, asset, downloadMs);
    const unpacked = await (o.run ?? exec)(systemTar(platform, o.env), ["-xzf", archive, "-C", staging]);
    if (unpacked.code !== 0) throw new Error(`tar couldn't unpack ${asset.file} (${unpacked.code})`);
    const fresh = path.join(staging, place.top);
    const launch = await launchOf(fresh, platform);
    if (!(await fs.stat(launch).catch(() => null))?.isFile()) throw new Error(`${asset.file} holds no ${path.basename(launch)}`);
    await stopApp(o, isAlive, now);
    await swapIn(fresh, place.dir);
    const app: DesktopApp = { version: release.version, dir: place.dir, launch: await launchOf(place.dir, platform) };
    await fs.writeFile(desktopAppPath(claudeDir), JSON.stringify(app, null, 2) + "\n");
    await releaseLock(lock, process.pid);
    return { changes: [`installed Isoplan's desktop app ${release.version} in ${place.dir}`], installed: true };
  } catch (err) {
    await holdOff(lock, process.pid, now() + settings.appRetryHours * 3600000).catch(() => {});
    return stay(`couldn't install the desktop app: ${(err as Error).message}; trying again in ${settings.appRetryHours} hours`);
  } finally {
    await fs.rm(staging, { recursive: true, force: true, maxRetries: 5 }).catch(() => {});
  }
}

// Streams the archive to `file`, checking its size as it comes and its sha256 at the end.
async function download(get: typeof fetch, url: string, file: string, asset: AppAsset, timeoutMs: number): Promise<void> {
  const res = await get(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok || !res.body) throw new Error(`the download of ${asset.file} failed (${res.status})`);
  const hash = createHash("sha256");
  let size = 0;
  const body = Readable.fromWeb(res.body as WebReadableStream<Uint8Array>);
  body.on("data", (chunk: Buffer) => {
    size += chunk.length;
    hash.update(chunk);
    if (size > asset.size) body.destroy(new Error(`${asset.file} is bigger than the manifest says (${asset.size} bytes)`));
  });
  await pipeline(body, createWriteStream(file));
  if (size !== asset.size) throw new Error(`${asset.file} is ${size} bytes, not the ${asset.size} the manifest says`);
  if (hash.digest("hex") !== asset.sha256.toLowerCase()) throw new Error(`${asset.file}'s sha256 isn't the one the manifest says`);
}

// The new copy goes in place of the old, which goes aside first and is put back if the move fails.
async function swapIn(fresh: string, dir: string): Promise<void> {
  const old = `${dir}.old-${process.pid}`;
  // Its launcher lets its files go a moment after the app exits.
  let had = false;
  for (let tries = 0; ; tries++) {
    const moved = await fs.rename(dir, old).then(() => null, (err: NodeJS.ErrnoException) => err);
    if (!moved) had = true;
    else if (moved.code !== "ENOENT" && tries < 40) {
      await new Promise((r) => setTimeout(r, 250));
      continue;
    } else if (moved.code !== "ENOENT") throw new Error(`the installed app couldn't be moved aside (${moved.code}): is it still running?`);
    break;
  }
  try {
    await fs.mkdir(path.dirname(dir), { recursive: true });
    await fs.rename(fresh, dir);
  } catch (err) {
    if (had) await fs.rename(old, dir).catch(() => {});
    throw err;
  }
  if (had) await fs.rm(old, { recursive: true, force: true, maxRetries: 5 }).catch(() => {});
}

// Stops the app if it holds the runner's lock, and waits for it to exit.
async function stopApp(o: InstallApp, isAlive: (pid: number) => boolean, now: () => number): Promise<void> {
  const lock = await readLock(runnerLockPath(o.claudeDir));
  if (!lock?.pid || !isAppLock(lock.extra)) return;
  const pid = lock.pid;
  await stopRunner(o.claudeDir, { isAlive, now, ...(o.kill && { kill: o.kill }) });
  for (const until = now() + (o.exitMs ?? 10000); isAlive(pid) && now() < until; ) await new Promise((r) => setTimeout(r, 100));
}
