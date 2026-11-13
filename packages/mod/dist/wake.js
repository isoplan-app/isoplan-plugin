import { execFile, spawn, spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs/promises";
import { promisify } from "node:util";
import { statSync } from "node:fs";
import { createHash } from "node:crypto";
//#region src/data-layer/config.ts
async function loadConfig(io, defaultsPath, userPath) {
	const config = await loadSettings(io, defaultsPath, userPath);
	const asked = (await readJson$1(io, userPath, true)).server;
	if (typeof asked === "string" && URL.canParse(asked) && new URL(asked).protocol === "ws:" && !LOOPBACK.has(new URL(asked).hostname)) {
		if (config.allowPlainWs) config.server = asked;
		else config.plainRefused = asked;
	}
	return config;
}
/** The same per-key override for any settings file of the mod's, such as the runner's runner.json. */
async function loadSettings(io, defaultsPath, userPath) {
	const defaults = await readJson$1(io, defaultsPath);
	const user = await readJson$1(io, userPath, true);
	const config = {};
	for (const [key, fallback] of Object.entries(defaults)) config[key] = fits(key, user[key], fallback) ? user[key] : fallback;
	return config;
}
const BYTE_KEYS = /* @__PURE__ */ new Set(["tailBytes"]);
const FLOORS = /* @__PURE__ */ new Map([["streamSeconds", .25], ["processRefreshSeconds", 1]]);
const ZERO_OFF = /* @__PURE__ */ new Set(["lightsOffHours", "updateCheckHours"]);
function fits(key, value, fallback) {
	if (key === "server") return typeof value === "string" && isWebSocketUrl(value);
	if (typeof fallback === "number") {
		if (BYTE_KEYS.has(key)) return Number.isSafeInteger(value) && value > 0;
		if (ZERO_OFF.has(key) && value === 0) return true;
		return typeof value === "number" && Number.isFinite(value) && value > 0 && value >= (FLOORS.get(key) ?? 0);
	}
	if (Array.isArray(fallback)) return Array.isArray(value);
	return value != null && typeof value === typeof fallback;
}
const LOOPBACK = /* @__PURE__ */ new Set([
	"127.0.0.1",
	"[::1]",
	"localhost"
]);
function isWebSocketUrl(value) {
	if (!URL.canParse(value)) return false;
	const url = new URL(value);
	return url.protocol === "wss:" || url.protocol === "ws:" && LOOPBACK.has(url.hostname);
}
async function readJson$1(io, p, optional = false) {
	if (optional && !await io.stat(p)) return {};
	try {
		const value = JSON.parse(await io.read(p));
		return value && typeof value === "object" && !Array.isArray(value) ? value : {};
	} catch (err) {
		if (optional) return {};
		throw err;
	}
}
//#endregion
//#region src/data-layer/io.ts
function nodeIo({ run = runCommand } = {}) {
	return {
		run,
		async listDir(dir) {
			try {
				return (await fs.readdir(dir, { withFileTypes: true })).map((e) => ({
					name: e.name,
					isDir: e.isDirectory()
				}));
			} catch {
				return [];
			}
		},
		async stat(p) {
			try {
				const s = await fs.stat(p);
				return {
					isDir: s.isDirectory(),
					mtimeMs: s.mtimeMs,
					size: s.size
				};
			} catch {
				return null;
			}
		},
		realpath: (p) => fs.realpath(p),
		isDirSync: (p) => {
			try {
				return statSync(p).isDirectory();
			} catch {
				return false;
			}
		},
		async read(p, start, end) {
			if (start === void 0 || end === void 0) return fs.readFile(p, "utf8");
			const fh = await fs.open(p, "r");
			try {
				const buf = Buffer.alloc(Math.max(0, end - start));
				const { bytesRead } = await fh.read(buf, 0, buf.length, start);
				return buf.subarray(0, bytesRead).toString("utf8");
			} finally {
				await fh.close();
			}
		}
	};
}
function runCommand([cmd, ...args], { cwd }) {
	return new Promise((resolve) => {
		execFile(cmd, args, {
			cwd,
			encoding: "utf8",
			timeout: 1e4,
			windowsHide: true
		}, (err, stdout) => {
			resolve({
				code: err ? typeof err.code === "number" ? err.code : 1 : 0,
				stdout: stdout || ""
			});
		});
	});
}
//#endregion
//#region src/runner/claude-binary.ts
const claudeBinaryPath = (claudeDir) => path.join(claudeDir, "isoplan", "claude-binary.json");
//#endregion
//#region src/wake/lock.ts
async function readText(file) {
	try {
		const [text, st] = await Promise.all([fs.readFile(file, "utf8"), fs.stat(file)]);
		return {
			text,
			mtimeMs: st.mtimeMs
		};
	} catch {
		return null;
	}
}
function parseLock(text, mtimeMs) {
	try {
		const { pid, until, ...extra } = JSON.parse(text);
		return {
			pid: Number.isSafeInteger(pid) && pid > 0 ? pid : null,
			until: typeof until === "number" ? until : null,
			mtimeMs,
			extra
		};
	} catch {
		return null;
	}
}
async function readLock(file) {
	const r = await readText(file);
	return r && parseLock(r.text, r.mtimeMs);
}
/** The pid the lock names, or null when there is none or it can't be read. */
async function lockHolder(file) {
	return (await readLock(file))?.pid ?? null;
}
const held = (lock, now, { isAlive = alive, freshMs }) => !!lock && (lock.until !== null && lock.until > now || lock.pid !== null && isAlive(lock.pid) && (freshMs === void 0 || now - lock.mtimeMs < freshMs));
/** Whether the lock is held: by a live pid (kept fresh, under `freshMs`), or by a hold-off that hasn't ended. */
async function isHeld(file, now = Date.now(), isAlive = alive, rule = {}) {
	return held(await readLock(file), now, {
		...rule,
		isAlive
	});
}
/**
* Takes the lock for `pid`; false when it is held (`isHeld`). With `force` (the plugin's data
* layer) it is taken regardless: the runner holding it sees that and steps aside. `extra` is
* written into the lock beside the pid.
*
* A new lock is created exclusively, so of two takers at once only one gets it. A stale one is
* moved aside by rename, which only one taker can do to the same file, and the taker checks that
* what it moved is the lock it judged stale, by its text and its write time, so a lock its holder
* refreshed meanwhile isn't taken: one that moved another's lock instead puts it back and loses.
* With `force` a lock that can't be moved (on Windows a scanner may have it open) is tried again
* after a short wait, then overwritten, so the plugin's data layer always gets it.
*/
async function takeLock(file, pid, isAlive = alive, force = false, now = Date.now(), { freshMs, extra = {} } = {}) {
	await fs.mkdir(path.dirname(file), { recursive: true });
	const body = JSON.stringify({
		pid,
		...extra
	});
	for (let tries = 0; tries < 5; tries++) {
		if (tries && force) await new Promise((r) => setTimeout(r, 20 * tries));
		try {
			await fs.writeFile(file, body, { flag: "wx" });
			return true;
		} catch (err) {
			if (err.code !== "EEXIST") throw err;
		}
		const seen = await readText(file);
		if (!seen) continue;
		const lock = parseLock(seen.text, seen.mtimeMs);
		if (!force && lock?.pid !== pid && held(lock, now, {
			isAlive,
			freshMs
		})) return false;
		const aside = `${file}.${pid}-${Math.random().toString(36).slice(2)}`;
		try {
			await fs.rename(file, aside);
		} catch (err) {
			if ([
				"ENOENT",
				"EPERM",
				"EBUSY",
				"EACCES"
			].includes(err.code ?? "")) continue;
			throw err;
		}
		const moved = await fs.readFile(aside, "utf8").catch(() => null);
		const movedAt = (await fs.stat(aside).catch(() => null))?.mtimeMs;
		if (moved !== seen.text || movedAt !== seen.mtimeMs) {
			await fs.link(aside, file).catch(() => {});
			await fs.rm(aside, { force: true });
			if (!force) return false;
			continue;
		}
		await fs.rm(aside, { force: true });
	}
	if (!force) return false;
	await fs.writeFile(file, body);
	return true;
}
/** Removes the lock if it still names `pid`. */
async function releaseLock(file, pid) {
	if (await lockHolder(file) === pid) await fs.rm(file, { force: true });
}
/** Turns the lock `pid` holds into a hold-off until `until`, with `extra` beside it; one another has taken is left. */
async function holdOff(file, pid, until, extra = {}) {
	if (await lockHolder(file) === pid) await fs.writeFile(file, JSON.stringify({
		pid: 0,
		until,
		...extra
	}));
}
function alive(pid) {
	try {
		process.kill(pid, 0);
		return true;
	} catch (err) {
		return err.code === "EPERM";
	}
}
//#endregion
//#region src/wake/wake.ts
const wakeRecordPath = (claudeDir) => path.join(claudeDir, "isoplan", "wake.json");
//#endregion
//#region src/runner/environment.ts
const runnerEnvPath = (claudeDir) => path.join(claudeDir, "isoplan", "runner", "environment.json");
/** The recorded environment, or null when there is none, or it doesn't parse, so the starter's is used. */
async function recordedEnv(claudeDir) {
	try {
		const { env } = JSON.parse(await fs.readFile(runnerEnvPath(claudeDir), "utf8"));
		if (!env || typeof env !== "object" || Array.isArray(env)) return null;
		return Object.fromEntries(Object.entries(env).filter((e) => typeof e[1] === "string"));
	} catch {
		return null;
	}
}
//#endregion
//#region src/runner/start.ts
/** The runner's lock: `{ pid, code }` of the supervisor that holds it. */
const runnerLockPath = (claudeDir) => path.join(claudeDir, "isoplan", "runner", "lock.json");
/** What names a runner.js's code: its size and write time. Null when it is gone. */
async function runnerCode(file) {
	const st = await fs.stat(file).catch(() => null);
	return st && st.isFile() ? `${st.size}-${Math.round(st.mtimeMs)}` : null;
}
/** The live runner's lock: a hold-off that hasn't ended, or a live pid that keeps it fresh. */
async function liveRunner(claudeDir, now, isAlive) {
	const lock = await readLock(runnerLockPath(claudeDir));
	if (!lock) return null;
	if (lock.until !== null && lock.until > now) return {
		...lock,
		isHoldOff: true
	};
	if (lock.pid !== null && isAlive(lock.pid) && now - lock.mtimeMs < 9e4) return {
		...lock,
		isHoldOff: false
	};
	return null;
}
const desktopAppPath = (claudeDir) => path.join(claudeDir, "isoplan", "runner", "desktop-app.json");
/** The desktop app install recorded, if it is in use (not switched off) and its program is still there. */
async function recordedApp(claudeDir) {
	try {
		const app = JSON.parse(await fs.readFile(desktopAppPath(claudeDir), "utf8"));
		if (typeof app.version !== "string" || typeof app.dir !== "string" || typeof app.launch !== "string" || app.off === true) return null;
		return (await fs.stat(app.launch).catch(() => null))?.isFile() ? {
			version: app.version,
			dir: app.dir,
			launch: app.launch
		} : null;
	} catch {
		return null;
	}
}
const appOpenPath = (claudeDir) => path.join(claudeDir, "isoplan", "runner", "desktop-app-open.json");
/** The desktop app's folder as install recorded it, in use or switched off: what uninstall removes. */
async function recordedAppDir(claudeDir) {
	try {
		const { dir } = JSON.parse(await fs.readFile(desktopAppPath(claudeDir), "utf8"));
		return typeof dir === "string" ? dir : null;
	} catch {
		return null;
	}
}
/** The lock's holder is the desktop app. */
const isAppLock = (extra) => extra.engine === "app";
/**
* How the desktop app is started for `claudeDir` with no window and no focus. Electrobun's launcher
* doesn't pass its arguments on to the app (seen on Windows), so a config folder other than
* ~/.claude goes in CLAUDE_CONFIG_DIR, as Claude Code reads it; ~/.claude takes it out. On macOS
* through `open -g`, so it starts as an app of its own and stays in the background; `--env` only
* when the folder isn't ~/.claude.
*/
function appCommand(app, claudeDir, platform, env, home) {
	const isDefault = path.resolve(claudeDir) === path.resolve(home, ".claude");
	const { CLAUDE_CONFIG_DIR: _, ...rest } = env;
	const appEnv = isDefault ? rest : {
		...rest,
		CLAUDE_CONFIG_DIR: claudeDir
	};
	if (platform === "darwin") return {
		file: "/usr/bin/open",
		args: [
			"-g",
			...isDefault ? [] : ["--env", `CLAUDE_CONFIG_DIR=${claudeDir}`],
			app.dir
		],
		env: appEnv
	};
	return {
		file: app.launch,
		args: [],
		env: appEnv
	};
}
/** Starts the desktop app (appCommand), and doesn't wait for it. */
function openApp(app, claudeDir) {
	const { file, args, env } = appCommand(app, claudeDir, process.platform, process.env, os.homedir());
	spawn(file, args, {
		cwd: claudeDir,
		env,
		detached: true,
		stdio: "ignore",
		windowsHide: true
	}).on("error", () => {}).unref();
}
/**
* Starts the recorded runner unless a live one runs the recorded code. One on older code is
* replaced. A hold-off keeps it from starting, except a crash loop's hold-off on older code: a new
* version may have fixed what crashed. With the desktop app recorded it opens the app instead,
* once no node runner runs, and a live app is running; an app that is failing (see above) is
* passed over for node.
*/
async function startRunner({ claudeDir, spawn, isAlive = alive, kill = (pid) => process.kill(pid), now = Date.now, open = openApp }) {
	let runner;
	try {
		runner = JSON.parse(await fs.readFile(wakeRecordPath(claudeDir), "utf8")).runner;
	} catch {
		return "not-installed";
	}
	if (typeof runner !== "string") return "not-installed";
	const code = await runnerCode(runner);
	if (!code) return "not-installed";
	const lockFile = runnerLockPath(claudeDir);
	const live = await liveRunner(claudeDir, now(), isAlive);
	if (live && !live.isHoldOff && isAppLock(live.extra)) return "running";
	const recorded = await recordedApp(claudeDir);
	const settings = recorded && await loadSettings(nodeIo(), path.join(path.dirname(path.dirname(runner)), "runner.json"), path.join(claudeDir, "isoplan", "runner.json"));
	const app = recorded && settings && !await appFailing(claudeDir, recorded, live, code, now(), settings) ? recorded : null;
	if (live?.isHoldOff) {
		if (live.extra.reason !== "gave-up" || live.extra.code === code && !(recorded && !app && isAppLock(live.extra))) return "held-off";
		if ((await readLock(lockFile))?.until === live.until) await fs.rm(lockFile, { force: true });
	} else if (live) {
		if (live.extra.code === code && !app) return "running";
		await stopRunner(claudeDir, {
			isAlive,
			kill,
			now,
			expect: {
				pid: live.pid,
				code: live.extra.code
			}
		});
	}
	if (app) {
		const opened = await readAppOpen(claudeDir);
		if (opened?.version === app.version && opened.openedAt !== void 0 && !opened.failed && now() - opened.openedAt < settings.appStartSeconds * 1e3) return "started";
		await fs.writeFile(appOpenPath(claudeDir), JSON.stringify({
			version: app.version,
			openedAt: now()
		}) + "\n");
		open(app, claudeDir);
		return "started";
	}
	const env = await recordedEnv(claudeDir);
	spawn([
		runner,
		"--claude-dir",
		claudeDir,
		...env ? [] : ["--inherited-env"]
	], claudeDir, env ?? void 0);
	return "started";
}
async function readAppOpen(claudeDir) {
	try {
		return JSON.parse(await fs.readFile(appOpenPath(claudeDir), "utf8"));
	} catch {
		return null;
	}
}
/**
* Whether the recorded app is failing: marked so earlier, and not yet for long enough; or found
* failing now, when it is marked and runner.log says why.
*/
async function appFailing(claudeDir, app, live, code, now, settings) {
	const opened = await readAppOpen(claudeDir);
	if (opened?.version === app.version && opened.failed && (opened.until ?? 0) > now) return true;
	let why = null;
	if (live?.isHoldOff && isAppLock(live.extra) && live.extra.reason === "gave-up" && live.extra.code === code) why = "its runner kept crashing on the app's Bun";
	else if (!live?.isHoldOff && opened?.version === app.version && !opened.failed && opened.openedAt !== void 0 && now - opened.openedAt >= settings.appStartSeconds * 1e3) why = `it didn't start being the runner within ${settings.appStartSeconds} seconds of being opened (was it blocked, or did it crash?)`;
	if (!why) return false;
	const until = now + settings.appRetryHours * 36e5;
	await fs.writeFile(appOpenPath(claudeDir), JSON.stringify({
		version: app.version,
		failed: why,
		until
	}) + "\n");
	await logLine(claudeDir, `the desktop app ${app.version} isn't used until ${new Date(until).toISOString()}, or until another version is installed: ${why}. The runner runs on node meanwhile.`, now);
	return true;
}
async function logLine(claudeDir, text, now) {
	const file = path.join(claudeDir, "isoplan", "logs", "runner.log");
	await fs.mkdir(path.dirname(file), { recursive: true });
	await fs.appendFile(file, `${new Date(now).toISOString()} ${text}\n`);
}
/**
* Ends the running runner, for uninstall and updates: its worker and forks follow once its
* supervisor has gone. True when one was running. A stale lock's pid is never killed. With
* `expect`, only the runner judged outdated is: if the lock names another pid or code by now
* (another starter replaced it already), it is left.
*/
async function stopRunner(claudeDir, { isAlive = alive, kill = (pid) => process.kill(pid), now = Date.now, expect } = {}) {
	const live = await liveRunner(claudeDir, now(), isAlive);
	if (!live || live.isHoldOff || live.pid === null) return false;
	if (expect && (live.pid !== expect.pid || live.extra.code !== expect.code)) return false;
	try {
		kill(live.pid);
	} catch {}
	await releaseLock(runnerLockPath(claudeDir), live.pid);
	return true;
}
//#endregion
//#region src/connect/dialog.ts
const exec = (file, args, env) => new Promise((resolve) => {
	let stdout = "";
	const child = spawn(file, args, {
		windowsHide: true,
		stdio: [
			"ignore",
			"pipe",
			"ignore"
		],
		env: env ? {
			...process.env,
			...env
		} : process.env
	});
	child.stdout.on("data", (chunk) => stdout += String(chunk));
	child.on("error", () => resolve({
		code: null,
		stdout
	}));
	child.on("close", (code) => resolve({
		code,
		stdout
	}));
});
[
	"$ErrorActionPreference = 'Stop'",
	"Add-Type -AssemblyName System.Windows.Forms, System.Drawing",
	...[`Add-Type -Namespace IsoplanWin -Name User32 -MemberDefinition '[DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);'`, "$first = New-Object System.Windows.Forms.Form; [void][IsoplanWin.User32]::ShowWindow($first.Handle, 0); $first.Dispose()"],
	"[System.Windows.Forms.Application]::EnableVisualStyles()",
	"$f = New-Object System.Windows.Forms.Form",
	"$f.Text = $env:ISOPLAN_DIALOG_TITLE",
	"$f.FormBorderStyle = 'FixedDialog'; $f.MaximizeBox = $false; $f.MinimizeBox = $false; $f.StartPosition = 'CenterScreen'; $f.TopMost = $true",
	"$f.AutoSize = $true; $f.AutoSizeMode = 'GrowAndShrink'; $f.Padding = New-Object System.Windows.Forms.Padding 16",
	"$layout = New-Object System.Windows.Forms.FlowLayoutPanel; $layout.FlowDirection = 'TopDown'; $layout.AutoSize = $true; $layout.AutoSizeMode = 'GrowAndShrink'",
	"$label = New-Object System.Windows.Forms.Label; $label.Text = $env:ISOPLAN_DIALOG_TEXT; $label.UseMnemonic = $false; $label.AutoSize = $true; $label.MaximumSize = New-Object System.Drawing.Size 480, 0",
	"$row = New-Object System.Windows.Forms.FlowLayoutPanel; $row.FlowDirection = 'RightToLeft'; $row.AutoSize = $true; $row.Anchor = 'Right'",
	"$cancel = New-Object System.Windows.Forms.Button; $cancel.Text = 'Cancel'; $cancel.UseMnemonic = $false; $cancel.AutoSize = $true; $cancel.DialogResult = 'Cancel'",
	"$connect = New-Object System.Windows.Forms.Button; $connect.Text = 'Connect'; $connect.UseMnemonic = $false; $connect.AutoSize = $true; $connect.DialogResult = 'OK'",
	"$row.Controls.AddRange(@($cancel, $connect)); $layout.Controls.AddRange(@($label, $row)); $f.Controls.Add($layout)",
	"$f.AcceptButton = $cancel; $f.CancelButton = $cancel",
	`$timer = New-Object System.Windows.Forms.Timer; $timer.Interval = 300000; $timer.Add_Tick({ $f.DialogResult = 'Cancel'; $f.Close() })`,
	"$f.Add_Shown({ $f.Activate(); $cancel.Focus(); $timer.Start() })",
	"$r = $f.ShowDialog(); $timer.Stop()",
	"if ($r -eq [System.Windows.Forms.DialogResult]::OK) { exit 0 } else { exit 2 }"
].join("\n");
//#endregion
//#region src/install/link-handler.ts
const KEY = "HKCU\\Software\\Classes\\isoplan";
const COMMAND_KEY = `${`${KEY}\\shell\\open`}\\command`;
const LSREGISTER = "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister";
const DESKTOP = "isoplan-connect.desktop";
const macAppPath = (claudeDir) => path.join(claudeDir, "isoplan", "Isoplan Connect.app");
const desktopPath = (h) => path.join(h.dataHome || path.join(h.home, ".local", "share"), "applications", DESKTOP);
/** The Windows launcher the open command runs. */
const linkLauncherPath = (claudeDir) => path.join(claudeDir, "isoplan", "open-link.js");
/** The value `reg query` prints for a key's default or a named value, whatever the language of its "(Default)" label. */
const regValue = (stdout) => /REG_SZ[ \t]+(.*?)\s*$/m.exec(stdout)?.[1] ?? null;
const norm = (p) => p.replace(/\\/g, "/").toLowerCase();
/** A desktop entry's Exec argument, quoted as the Desktop Entry spec asks, then escaped as its strings are. */
const execArg = (value) => `"${value.replace(/(["`$\\])/g, "\\$1")}"`.replace(/\\/g, "\\\\");
/** Takes the handler out when it is this config folder's; says what it changed. */
async function unregisterLinkHandler(h) {
	const run = h.run ?? exec;
	if (h.platform === "win32") {
		const value = regValue((await run("reg", [
			"query",
			COMMAND_KEY,
			"/ve"
		])).stdout);
		const launcher = linkLauncherPath(h.claudeDir);
		await fs.rm(launcher, { force: true });
		if (!value || ![h.script, launcher].some((p) => norm(value).includes(norm(p)))) return [];
		await run("reg", [
			"delete",
			KEY,
			"/f"
		]);
		return ["removed the isoplan:// link handler"];
	}
	if (h.platform === "darwin") {
		const app = macAppPath(h.claudeDir);
		if (!await fs.stat(app).catch(() => null)) return [];
		await run(LSREGISTER, ["-u", app]);
		await fs.rm(app, {
			recursive: true,
			force: true
		});
		return [`removed the isoplan:// link handler, ${app}`];
	}
	if (h.platform === "linux") {
		const file = desktopPath(h);
		if (!(await fs.readFile(file, "utf8").catch(() => "")).includes(execArg(h.script))) return [];
		await fs.rm(file, { force: true });
		await run("update-desktop-database", [path.dirname(file)]);
		return [`removed the isoplan:// link handler, ${file}`];
	}
	return [];
}
//#endregion
//#region src/install/state.ts
/** Claude Code's plugins folder: $CLAUDE_CODE_PLUGIN_CACHE_DIR when it is set, else <claude dir>/plugins. */
const pluginsDir = (claudeDir, env) => env.CLAUDE_CODE_PLUGIN_CACHE_DIR || path.join(claudeDir, "plugins");
/** The folders $CLAUDE_CODE_PLUGIN_DIRS names. */
const pluginDirsOf = (env) => (env.CLAUDE_CODE_PLUGIN_DIRS ?? "").split(path.delimiter).filter(Boolean);
/** The system folder Claude Code reads managed-settings.json from. */
function managedDir(platform) {
	if (platform === "win32") return "C:\\Program Files\\ClaudeCode";
	if (platform === "darwin") return "/Library/Application Support/ClaudeCode";
	return "/etc/claude-code";
}
/** A path as compared: resolved, with forward slashes, and on Windows and macOS without regard to case. */
function normalPath(p, platform = process.platform) {
	const resolved = path.resolve(p).replace(/\\/g, "/");
	return platform === "win32" || platform === "darwin" ? resolved.toLowerCase() : resolved;
}
function cacheParts(cache, file) {
	const relative = path.relative(cache, path.resolve(file));
	if (path.isAbsolute(relative)) return null;
	const parts = relative.split(path.sep);
	return parts.length >= 4 && parts[0] !== ".." ? parts : null;
}
async function realCacheParts(plugins, file) {
	const cache = await fs.realpath(path.join(plugins, "cache")).catch(() => path.join(plugins, "cache"));
	return {
		cache,
		parts: cacheParts(cache, await fs.realpath(file).catch(() => file))
	};
}
const appliesTo = (install, project) => !project || !(install.scope === "project" || install.scope === "local") || !install.projectPath || normalPath(install.projectPath) === normalPath(project);
const nameOf = (id) => id.slice(0, id.lastIndexOf("@"));
/** Every install installed_plugins.json records; null when it is missing, can't be read, or isn't the shape known. */
async function installs(plugins) {
	const record = await readJson(path.join(plugins, "installed_plugins.json"));
	const list = record?.plugins;
	if (record?.version !== 2 || !isObject(list) || !Object.values(list).every(Array.isArray)) return null;
	return Object.entries(list).flatMap(([id, entries]) => entries.map((entry) => {
		const e = isObject(entry) ? entry : {};
		const text = (key) => typeof e[key] === "string" ? e[key] : null;
		return {
			id,
			scope: text("scope"),
			projectPath: text("projectPath"),
			installPath: text("installPath"),
			version: text("version"),
			lastUpdated: text("lastUpdated")
		};
	}));
}
/** Whether `enabledPlugins` names the plugin `id` enabled, disabled, or not at all (null). */
async function enabledIn(file, id) {
	const value = (await readJson(file))?.enabledPlugins;
	return isObject(value) && typeof value[id] === "boolean" ? value[id] : null;
}
/**
* What Claude Code says of the plugin `dataLayer` belongs to. With `project` (a session's project
* folder) the project's settings and installs count too; without, only the machine's: the
* managed files, the user's settings, and every install.
*/
async function pluginState(place, dataLayer, project) {
	const { parts } = await realCacheParts(place.plugins, dataLayer);
	if (!parts) return "enabled";
	const id = `${parts[1]}@${parts[0]}`;
	const name = nameOf(id);
	const all = await installs(place.plugins);
	let ids = [id];
	if (all) {
		const mine = all.filter((i) => nameOf(i.id) === name);
		if (!mine.length) return await isInPluginDirs(place.pluginDirs ?? [], name) ? "enabled" : "uninstalled";
		const here = mine.filter((i) => appliesTo(i, project));
		if (!here.length) return "disabled";
		ids = [...new Set(here.map((i) => i.id))];
	}
	return (await Promise.all(ids.map((one) => enabledFor(place, one, project)))).includes(true) ? "enabled" : "disabled";
}
async function enabledFor(place, id, project) {
	const managed = await Promise.all((await managedFiles(place.managed)).map((file) => enabledIn(file, id)));
	if (managed.includes(false)) return false;
	if (managed.includes(true)) return true;
	for (const file of await ownFiles(place, project)) {
		const enabled = await enabledIn(file, id);
		if (enabled !== null) return enabled;
	}
	return true;
}
async function isInPluginDirs(dirs, name) {
	for (const dir of dirs) if ((await readJson(path.join(dir, ".claude-plugin", "plugin.json")))?.name === name) return true;
	return false;
}
async function managedFiles(managed) {
	const dropIns = await fs.readdir(path.join(managed, "managed-settings.d")).then((names) => names.filter((n) => n.endsWith(".json")).map((n) => path.join(managed, "managed-settings.d", n)), () => []);
	return [path.join(managed, "managed-settings.json"), ...dropIns];
}
async function ownFiles({ claudeDir }, project) {
	const files = [];
	if (project) {
		const root = await gitRoot(project);
		if (root && normalPath(root) !== normalPath(project)) files.push(path.join(root, ".claude", "settings.local.json"));
		files.push(path.join(project, ".claude", "settings.local.json"), path.join(project, ".claude", "settings.json"));
	}
	files.push(path.join(claudeDir, "settings.json"));
	return files;
}
async function gitRoot(dir) {
	for (let at = path.resolve(dir);; at = path.dirname(at)) {
		if (await fs.stat(path.join(at, ".git")).then(() => true, () => false)) return at;
		if (path.dirname(at) === at) return null;
	}
}
const isObject = (value) => !!value && typeof value === "object" && !Array.isArray(value);
async function readJson(file) {
	try {
		const value = JSON.parse((await fs.readFile(file, "utf8")).replace(/^\uFEFF/, ""));
		return isObject(value) ? value : null;
	} catch {
		return null;
	}
}
//#endregion
//#region src/install/login-item.ts
const RUN_KEY = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run";
/** A short id of the config folder, so each folder's item has its own name. */
const loginItemId = (claudeDir, platform) => createHash("sha256").update(normalPath(claudeDir, platform)).digest("hex").slice(0, 8);
const runValueName = (claudeDir) => `Isoplan runner ${loginItemId(claudeDir, "win32")}`;
const loginLauncherPath = (claudeDir) => path.join(claudeDir, "isoplan", "start-at-login.js");
const launchAgentLabel = (claudeDir) => `dev.isoplan.runner.${loginItemId(claudeDir, "darwin")}`;
const launchAgentPath = (home, claudeDir) => path.join(home, "Library", "LaunchAgents", `${launchAgentLabel(claudeDir)}.plist`);
const autostartPath = (h) => path.join(h.configHome || path.join(h.home, ".config"), "autostart", `isoplan-runner-${loginItemId(h.claudeDir, "linux")}.desktop`);
/** Whether runner.json (`defaultsPath`, overridden by the person's `userPath`) has the runner start at login; on unless it says false. */
async function startsAtLogin(defaultsPath, userPath) {
	return (await loadSettings(nodeIo(), defaultsPath, userPath).catch(() => null))?.startAtLogin !== false;
}
/** Takes this config folder's login item out; says what it changed. */
async function unregisterLoginItem(h) {
	const run = h.run ?? exec;
	const removed = (where) => [`took out the runner's start at login (${where})`];
	if (h.platform === "win32") {
		const name = runValueName(h.claudeDir);
		const had = (await run("reg", [
			"query",
			RUN_KEY,
			"/v",
			name
		])).code === 0;
		if (had) await run("reg", [
			"delete",
			RUN_KEY,
			"/v",
			name,
			"/f"
		]);
		const launcher = loginLauncherPath(h.claudeDir);
		const hadLauncher = !!await fs.stat(launcher).catch(() => null);
		await fs.rm(launcher, { force: true });
		return had || hadLauncher ? removed(`${RUN_KEY}\\${name}`) : [];
	}
	if (h.platform === "darwin") {
		const file = launchAgentPath(h.home, h.claudeDir);
		if (!await fs.stat(file).catch(() => null)) return [];
		await fs.rm(file, { force: true });
		await run("launchctl", ["bootout", `gui/${h.uid}/${launchAgentLabel(h.claudeDir)}`]);
		return removed(file);
	}
	if (h.platform === "linux") {
		const file = autostartPath(h);
		if (!await fs.stat(file).catch(() => null)) return [];
		await fs.rm(file, { force: true });
		return removed(file);
	}
	return [];
}
//#endregion
//#region src/install/install.ts
const wakeScriptPath = (claudeDir) => path.join(claudeDir, "isoplan", "wake.mjs");
/** Where install copies the runner and the defaults it reads, under the plugin's own layout. */
const runnerAppDir = (claudeDir) => path.join(claudeDir, "isoplan", "runner", "app");
/** The link handler's copy, which the operating system runs for an isoplan:// link. */
const connectScriptPath = (claudeDir) => path.join(runnerAppDir(claudeDir), copiedAs("dist/connect.js"));
/** A file's name in the copy: the bundle is an ES module and no package.json beside the copy says so, so it is .mjs, as wake.mjs is. */
const copiedAs = (file) => file.replace(/\.js$/, ".mjs");
/** The uninstall's lock, which also holds off a retry once one has failed. */
const uninstallLockPath = (claudeDir) => path.join(claudeDir, "isoplan", "uninstall.json");
/** Where an uninstall in the background says what stopped it. */
const uninstallLogPath = (claudeDir) => path.join(claudeDir, "isoplan", "uninstall.log");
/** The script a hook command runs with node, as `node "<script>"` or `node <script>`; null for any other command. */
function nodeScriptOf(command) {
	const m = /^\s*node(?:\.exe)?\s+(?:"([^"]+)"|'([^']+)'|(\S+))\s*$/i.exec(command);
	return m ? m[1] ?? m[2] ?? m[3] : null;
}
const isWakeFor = (claudeDir) => {
	const script = normalPath(wakeScriptPath(claudeDir));
	return (hook) => {
		const command = hook?.command;
		const runs = typeof command === "string" ? nodeScriptOf(command) : null;
		return runs !== null && normalPath(runs) === script;
	};
};
/** The data layer wake.json records; null when there is none. */
async function recordedDataLayer(claudeDir) {
	try {
		const { dataLayer } = JSON.parse(await fs.readFile(wakeRecordPath(claudeDir), "utf8"));
		return typeof dataLayer === "string" ? dataLayer : null;
	} catch {
		return null;
	}
}
/** What Claude Code says of the plugin whose data layer wake.json records (state.ts); enabled when none is recorded. */
async function recordedState(paths, cwd) {
	const dataLayer = await recordedDataLayer(paths.claudeDir);
	return dataLayer ? pluginState(paths, dataLayer, cwd) : "enabled";
}
const WRITTEN = [
	"runner",
	"pipe",
	"pairing.json",
	"pairing.lock",
	"pairing.write.lock",
	"live",
	"logs",
	"titles",
	"released",
	"waits",
	"answers",
	"handoffs",
	"windows",
	"offices",
	"approved.json",
	"update.json",
	"update.lock"
];
const SESSION_TRACES = [
	"live",
	"titles",
	"released",
	"waits",
	"answers",
	"windows",
	"offices",
	"approved.json",
	"update.json",
	"update.lock"
];
/**
* Takes out everything install and the plugin put in place, in this order: the running runner;
* under <claude dir>/isoplan the session locks; a wait of `settleMs`; the runner's copy and its records (environment, ledger, lock),
* the pairing credential, the logs, the title files and the released-report hashes, and
* claude-binary.json unless it was set by hand; then the wake
* hooks in settings.json, and wake.mjs and wake.json. What else is in the folder, the files a
* person writes, is kept, and the folder goes once it is empty. Throws when settings.json can't be
* merged, with the hooks and wake.mjs still in place and settings.json not written.
*/
async function uninstall(paths, { optOut = false, settleMs = 0, confirm, runner = {}, linkHandler, loginItem } = {}) {
	const changes = [];
	const dir = path.dirname(wakeScriptPath(paths.claudeDir));
	const remove = async (file) => {
		if (!await exists(file)) return;
		await fs.rm(file, {
			recursive: true,
			force: true,
			maxRetries: 5
		});
		if (!changes.includes(`removed ${file}`)) changes.push(`removed ${file}`);
	};
	const isStillGone = async () => !confirm || await confirm();
	const stopped = (why) => ({
		changes: [...changes, why],
		isDone: false
	});
	const reinstalled = "stopped: Claude Code lists the plugin as installed again";
	if (!await isStillGone()) return stopped(reinstalled);
	const appDir = await recordedAppDir(paths.claudeDir);
	if (await stopOurRunner(paths.claudeDir, runner)) changes.push("stopped the runner, which answered for this machine's sessions");
	if (appDir && await exists(appDir)) await fs.rm(appDir, {
		recursive: true,
		force: true,
		maxRetries: 20,
		retryDelay: 250
	}).then(() => changes.push(`removed ${appDir}`), (err) => changes.push(`couldn't remove the desktop app at ${appDir}: ${err.message}`));
	const autoUpdate = await takeOutAutoUpdate(paths);
	if (autoUpdate) changes.push(autoUpdate);
	if (linkHandler) {
		const unregistered = unregisterLinkHandler({
			...linkHandler,
			claudeDir: paths.claudeDir,
			script: connectScriptPath(paths.claudeDir)
		});
		changes.push(...await unregistered.catch((err) => [`couldn't take out the isoplan:// link handler: ${String(err?.message ?? err)}`]));
	}
	if (loginItem) {
		const unregistered = unregisterLoginItem({
			...loginItem,
			claudeDir: paths.claudeDir,
			script: wakeScriptPath(paths.claudeDir)
		});
		changes.push(...await unregistered.catch((err) => [`couldn't take out the runner's start at login: ${String(err?.message ?? err)}`]));
	}
	await remove(path.join(dir, "live"));
	if (settleMs) await new Promise((r) => setTimeout(r, settleMs));
	for (const name of WRITTEN) {
		if (!await isStillGone()) return stopped(reinstalled);
		await remove(path.join(dir, name));
	}
	const binary = claudeBinaryPath(paths.claudeDir);
	const kind = await binaryRecord(binary);
	if (kind === "auto") await remove(binary);
	if (kind === "broken") changes.push(`kept ${binary}, which doesn't parse: it may have been edited by hand`);
	if (confirm && (await Promise.all(SESSION_TRACES.map((name) => exists(path.join(dir, name))))).includes(true)) return stopped("stopped: a session still running the plugin wrote its files again; the hook stays, to try again on a later prompt");
	if (!await isStillGone()) return stopped(reinstalled);
	const record = wakeRecordPath(paths.claudeDir);
	if (optOut) {
		if (await writeIfChanged(record, JSON.stringify({ disabled: true }, null, 2) + "\n")) changes.push(`marked the wake hook as uninstalled in ${record}, so the plugin won't put it back`);
	}
	changes.push(...await uninstallHooks(paths));
	await remove(wakeScriptPath(paths.claudeDir));
	if (!optOut) await remove(record);
	await remove(uninstallLogPath(paths.claudeDir));
	await remove(uninstallLockPath(paths.claudeDir));
	if (await fs.rmdir(dir).then(() => true, () => false)) changes.push(`removed ${dir}`);
	return {
		changes,
		isDone: true
	};
}
async function takeOutAutoUpdate({ claudeDir, settings }) {
	let added;
	try {
		added = JSON.parse(await fs.readFile(path.join(claudeDir, "isoplan", "update.json"), "utf8")).autoUpdateOn;
	} catch {
		return null;
	}
	const { marketplace, entry: left } = added && typeof added === "object" ? added : {};
	if (typeof marketplace !== "string" || typeof left !== "string") return null;
	const current = await readSettings(settings);
	const known = current.extraKnownMarketplaces;
	const entry = known && typeof known === "object" ? known[marketplace] : void 0;
	if (!entry || typeof entry !== "object" || entry.autoUpdate !== true || JSON.stringify(entry) !== left) return null;
	delete entry.autoUpdate;
	await writeSettings(settings, current);
	return `took out the auto-update the plugin turned on for the ${marketplace} marketplace in ${settings}`;
}
/** How long a background uninstall waits to read Claude Code's records a second time before it starts. */
const UNINSTALL_RECHECK_MS = 5e3;
/** How long a background uninstall that failed holds off trying again. */
const UNINSTALL_RETRY_MS = 864e5;
/**
* One background uninstall, for the wake hook once Claude Code lists the plugin as uninstalled:
* `uninstall`, asking before each step whether it still does. It holds the uninstall's lock
* throughout, so two never run at once. One that fails (a settings.json that doesn't parse, say)
* says why in uninstall.log and holds off for UNINSTALL_RETRY_MS, keeping the hooks and wake.mjs;
* deleting uninstall.json lets the next prompt try at once. One that stops because a session wrote
* its files again says so there too, and the next prompt tries again; one that stops because the
* plugin was installed again just ends. It starts only once Claude Code's records still say
* uninstalled `recheckMs` after the reading that started it, so a record rewritten during an
* update never counts.
*/
async function uninstallInBackground(paths, { settleMs = 0, runner = {}, linkHandler, loginItem, now = Date.now, recheckMs = UNINSTALL_RECHECK_MS } = {}) {
	const lock = uninstallLockPath(paths.claudeDir);
	if (!await takeLock(lock, process.pid, alive, false, now())) return;
	await new Promise((r) => setTimeout(r, recheckMs));
	if (await recordedState(paths) !== "uninstalled") return releaseLock(lock, process.pid);
	const log = (text) => fs.appendFile(uninstallLogPath(paths.claudeDir), `${new Date(now()).toISOString()} ${text}\n`).catch(() => {});
	try {
		const { changes, isDone } = await uninstall(paths, {
			settleMs,
			runner,
			linkHandler,
			loginItem,
			confirm: async () => await recordedState(paths) === "uninstalled"
		});
		if (isDone) return;
		const why = changes[changes.length - 1];
		if (!why.includes("installed again")) await log(why);
		await releaseLock(lock, process.pid);
	} catch (err) {
		await log(`couldn't finish uninstalling Isoplan's plugin: ${err.message}. Trying again in a day, or delete ${lock} to try on the next prompt.`);
		await holdOff(lock, process.pid, now() + UNINSTALL_RETRY_MS);
	}
}
/** Whether a background uninstall is running, or holding off after one failed. */
const isUninstalling = (claudeDir) => isHeld(uninstallLockPath(claudeDir));
/**
* How long uninstall waits for a data layer to see its lock has gone: two of its passes
* (`streamSeconds`, with `defaultsPath` the mod's config.json and the person's config.json over
* it) and a second. Ten seconds when the config can't be read.
*/
async function settleMs(claudeDir, defaultsPath) {
	const config = await loadConfig(nodeIo(), defaultsPath, path.join(claudeDir, "isoplan", "config.json")).catch(() => null);
	return config ? (2 * config.streamSeconds + 1) * 1e3 : 1e4;
}
/**
* Ends the runner its lock names, and waits up to `waitMs` for it to exit; its worker and forks
* follow its supervisor. One whose lock is stale (not kept fresh, after a sleep, say) is ended only
* when its pid is alive and its command line runs this folder's copy of the runner, or the desktop
* app install put in place, since after a
* reboot the pid may name another process. True when one was ended.
*/
async function stopOurRunner(claudeDir, { isAlive = alive, kill = killTree, now = Date.now, commandOf, waitMs = 0 } = {}) {
	const file = runnerLockPath(claudeDir);
	const lock = await readLock(file);
	const pid = lock?.pid;
	if (!lock || !pid || !isAlive(pid)) return false;
	if (now() - lock.mtimeMs >= 9e4) {
		const command = commandOf ? await commandOf(pid) : null;
		const ours = [path.join(runnerAppDir(claudeDir), copiedAs("dist/runner.js")), (await recordedApp(claudeDir))?.dir].filter((p) => !!p).map((p) => normalPath(p).toLowerCase());
		if (!command || !ours.some((p) => command.replace(/\\/g, "/").toLowerCase().includes(p))) return false;
	}
	try {
		kill(pid);
	} catch {}
	for (const until = now() + waitMs; isAlive(pid) && now() < until;) await new Promise((r) => setTimeout(r, 100));
	await releaseLock(file, pid);
	return true;
}
/**
* Ends `pid` and what it started. On Windows a child outlives its parent, so the whole tree goes
* at once (taskkill /T, hidden), and no fork keeps the runner's files open; elsewhere the
* supervisor's worker follows it, as its stdin closes, and ends its forks.
*/
function killTree(pid) {
	if (process.platform === "win32") spawnSync("taskkill", [
		"/pid",
		String(pid),
		"/T",
		"/F"
	], {
		windowsHide: true,
		stdio: "ignore"
	});
	else process.kill(pid);
}
/** The command line of process `pid`; null when it can't be read. */
async function processCommand(pid, platform = process.platform) {
	try {
		if (platform === "linux") return (await fs.readFile(`/proc/${pid}/cmdline`, "utf8")).replace(/\0/g, " ").trim() || null;
		const [file, args] = platform === "win32" ? ["powershell.exe", [
			"-NoProfile",
			"-NonInteractive",
			"-Command",
			`(Get-CimInstance Win32_Process -Filter "ProcessId=${pid}").CommandLine`
		]] : ["ps", [
			"-o",
			"command=",
			"-p",
			String(pid)
		]];
		const { stdout } = await promisify(execFile)(file, args, {
			windowsHide: true,
			timeout: 15e3
		});
		return stdout.trim() || null;
	} catch {
		return null;
	}
}
async function uninstallHooks({ claudeDir, settings }) {
	const isWake = isWakeFor(claudeDir);
	const current = await readSettings(settings);
	const changes = [];
	const hooks = current.hooks;
	if (hooks && typeof hooks === "object" && !Array.isArray(hooks)) {
		for (const [event, groups] of Object.entries(hooks)) {
			if (!Array.isArray(groups)) continue;
			let removed = false;
			const kept = groups.filter((group) => {
				const list = group?.hooks;
				if (!Array.isArray(list) || !list.some(isWake)) return true;
				removed = true;
				group.hooks = list.filter((hook) => !isWake(hook));
				return group.hooks.length > 0;
			});
			if (!removed) continue;
			changes.push(`removed the wake hook from ${settings} on ${event}`);
			if (kept.length) hooks[event] = kept;
			else delete hooks[event];
		}
		if (changes.length && !Object.keys(hooks).length) delete current.hooks;
	}
	if (changes.length) await writeSettings(settings, current);
	return changes;
}
const exists = (file) => fs.stat(file).then(() => true, () => false);
async function binaryRecord(file) {
	let text;
	try {
		text = await fs.readFile(file, "utf8");
	} catch {
		return "none";
	}
	try {
		const record = JSON.parse(text);
		if (record?.auto === true) return "auto";
		return typeof record?.path === "string" && record.path !== "" ? "hand" : "broken";
	} catch {
		return "broken";
	}
}
/** The settings as an object; {} when there is no file yet. A leading byte order mark is skipped. Throws when it isn't a JSON object. */
async function readSettings(file) {
	let text;
	try {
		text = await fs.readFile(file, "utf8");
	} catch (err) {
		if (err.code === "ENOENT") return {};
		throw err;
	}
	let value;
	try {
		value = JSON.parse(text.replace(/^﻿/, ""));
	} catch {
		throw new Error(`${file} isn't valid JSON; left it alone`);
	}
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${file} isn't a JSON object; left it alone`);
	return value;
}
/** Writes the settings whole, as two-space JSON. */
const writeSettings = (file, settings) => writeWhole(file, JSON.stringify(settings, null, 2) + "\n");
async function writeIfChanged(file, text) {
	if (await fs.readFile(file, "utf8").catch(() => null) === text) return false;
	await writeWhole(file, text);
	return true;
}
async function writeWhole(file, text) {
	const target = await fs.realpath(file).catch(() => file);
	const mode = (await fs.stat(target).catch(() => null))?.mode;
	await fs.mkdir(path.dirname(target), { recursive: true });
	const temp = `${target}.isoplan-${process.pid}`;
	try {
		await fs.writeFile(temp, text);
		if (mode !== void 0) await fs.chmod(temp, mode & 4095);
		await fs.rename(temp, target);
	} catch (err) {
		await fs.rm(temp, { force: true }).catch(() => {});
		throw err;
	}
}
//#endregion
//#region src/wake/outside.ts
async function startFromOutside({ paths, spawn, login, isAlive }) {
	const { claudeDir } = paths;
	const state = await recordedState(paths).catch(() => "enabled");
	if (state === "uninstalled") {
		if (!await isUninstalling(claudeDir)) spawn([wakeScriptPath(claudeDir), "--uninstall"], claudeDir);
		return "uninstalling";
	}
	if (state === "disabled") return "disabled";
	if (login && !await startsAtLogin(path.join(runnerAppDir(claudeDir), "runner.json"), path.join(claudeDir, "isoplan", "runner.json"))) {
		await unregisterLoginItem({
			...login,
			claudeDir,
			script: wakeScriptPath(claudeDir)
		}).catch(() => []);
		return "off";
	}
	return startRunner({
		claudeDir,
		spawn,
		...isAlive && { isAlive }
	});
}
//#endregion
//#region src/wake/main.ts
const STDIN_MS = 500;
const RUNNER_EXIT_MS = 1e4;
process.on("uncaughtException", () => process.exit(0));
function readStdin() {
	return new Promise((resolve) => {
		let text = "";
		const timer = setTimeout(() => resolve(text), STDIN_MS);
		const done = () => {
			clearTimeout(timer);
			resolve(text);
		};
		process.stdin.setEncoding("utf8").on("data", (piece) => text += piece).on("end", done).on("error", done);
	});
}
function cwdOf(input) {
	try {
		const { cwd } = JSON.parse(input);
		return typeof cwd === "string" && cwd ? cwd : void 0;
	} catch {
		return;
	}
}
const self = fileURLToPath(import.meta.url);
const claudeDir = path.dirname(path.dirname(self));
const paths = {
	claudeDir,
	settings: path.join(claudeDir, "settings.json"),
	plugins: pluginsDir(claudeDir, process.env),
	managed: managedDir(process.platform),
	pluginDirs: pluginDirsOf(process.env)
};
const start = (args, cwd, env) => spawn(process.execPath, args, {
	cwd,
	env,
	detached: true,
	stdio: "ignore",
	windowsHide: true
}).on("error", () => {}).unref();
const loginItem = {
	platform: process.platform,
	home: os.homedir(),
	configHome: process.env.XDG_CONFIG_HOME,
	uid: process.getuid?.()
};
if (process.argv.includes("--uninstall")) {
	const settle = await settleMs(claudeDir, path.join(runnerAppDir(claudeDir), "config.json"));
	const linkHandler = {
		platform: process.platform,
		home: os.homedir(),
		dataHome: process.env.XDG_DATA_HOME
	};
	await uninstallInBackground(paths, {
		settleMs: settle,
		runner: {
			commandOf: processCommand,
			waitMs: RUNNER_EXIT_MS
		},
		linkHandler,
		loginItem
	}).catch(() => {});
	process.exit(0);
}
if (process.argv.includes("--login")) {
	await startFromOutside({
		paths,
		spawn: start,
		login: loginItem
	}).catch(() => {});
	process.exit(0);
}
const cwd = cwdOf(await readStdin());
const project = process.env.CLAUDE_PROJECT_DIR || cwd;
const session = await recordedState(paths, project).catch(() => "enabled");
if (session === "uninstalled") {
	if (!await isUninstalling(claudeDir)) start([self, "--uninstall"], claudeDir);
	process.exit(0);
}
const machine = project ? await recordedState(paths).catch(() => "enabled") : session;
if (machine === "disabled") await stopOurRunner(claudeDir).catch(() => {});
if (session === "enabled" && machine === "enabled") await startRunner({
	claudeDir,
	spawn: start
}).catch(() => {});
process.exit(0);
//#endregion
export {};
