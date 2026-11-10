import { execFile, spawn, spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createWriteStream, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
//#region src/data-layer/git.ts
function isAbsolute(p) {
	return /^[A-Za-z]:[\\/]/.test(p) || p.startsWith("/") || p.startsWith("\\");
}
/**
* Forward slashes, "." and ".." folded away, no trailing slash, drive letter upper-cased.
* The root keeps its slash ("C:/", "/").
*/
function normalize(p) {
	let s = p.replace(/\\/g, "/");
	let prefix = "";
	const drive = /^([A-Za-z]):(\/|$)/.exec(s);
	if (drive) {
		prefix = drive[1].toUpperCase() + ":/";
		s = s.slice(drive[0].length);
	} else if (s.startsWith("//")) {
		prefix = "//";
		s = s.slice(2);
	} else if (s.startsWith("/")) {
		prefix = "/";
		s = s.slice(1);
	}
	const out = [];
	for (const part of s.split("/")) {
		if (part === "" || part === ".") continue;
		if (part === ".." && out.length && out[out.length - 1] !== "..") out.pop();
		else if (part !== ".." || !prefix) out.push(part);
	}
	return prefix + out.join("/") || ".";
}
function join(base, rel) {
	return isAbsolute(rel) ? normalize(rel) : normalize(base + "/" + rel);
}
//#endregion
//#region src/data-layer/claude-paths.ts
/**
* Claude Code's config folder and its .claude.json: both in $CLAUDE_CONFIG_DIR when it is set,
* else ~/.claude and ~/.claude.json, where Claude Code itself looks.
*/
function claudePaths(env, home) {
	const custom = env.CLAUDE_CONFIG_DIR;
	return custom ? {
		dir: normalize(custom),
		json: join(custom, ".claude.json")
	} : {
		dir: join(home, ".claude"),
		json: join(home, ".claude.json")
	};
}
//#endregion
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
/**
* The offices to report to: each entry of `servers` with a ws:// or wss:// address (ws:// goes only
* to this machine unless allowPlainWs; to another it is kept, to say why it isn't used), once per
* address; with none, `server` alone. An entry without a label is labelled by its host, and a label
* already taken gets -2, -3 and so on, so each names one office.
*/
function officesOf(config) {
	const offices = [];
	const add = (server, label, refused) => {
		let unique = label;
		for (let n = 2; offices.some((o) => o.label.toLowerCase() === unique.toLowerCase()); n++) unique = `${label}-${n}`;
		offices.push({
			label: unique,
			server,
			...refused && { plainRefused: true },
			...server === config.server && { legacy: true }
		});
	};
	for (const entry of config.servers) {
		const { label, server } = entry ?? {};
		if (typeof server !== "string" || !URL.canParse(server) || !["ws:", "wss:"].includes(new URL(server).protocol) || offices.some((o) => o.server === server)) continue;
		add(server, typeof label === "string" && label.trim() || new URL(server).host, !config.allowPlainWs && !isWebSocketUrl(server));
	}
	if (!offices.length) add(config.plainRefused ?? config.server, new URL(config.plainRefused ?? config.server).host, !!config.plainRefused);
	return offices;
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
const isFile = (p) => fs.stat(p).then((s) => s.isFile(), () => false);
/**
* The `claude` binary's path: PATH first, then where Claude Code's installers put it. On Windows
* an npm install leaves only a claude.cmd shim, which can't be run without a shell, so its cli.js
* is used instead (run with node). Null when none is found.
*/
async function findClaude(env, platform, home, exists = isFile) {
	const windows = platform === "win32";
	const join = windows ? path.win32.join : path.posix.join;
	const dirs = (Object.entries(env).find(([key]) => key.toUpperCase() === "PATH")?.[1] ?? "").split(windows ? ";" : ":").filter(Boolean);
	const candidates = windows ? [...dirs.map((d) => join(d, "claude.exe")), join(home, ".local", "bin", "claude.exe")] : [
		...dirs.map((d) => join(d, "claude")),
		join(home, ".local", "bin", "claude"),
		join(home, ".claude", "local", "claude"),
		"/opt/homebrew/bin/claude",
		"/usr/local/bin/claude"
	];
	for (const candidate of candidates) if (await exists(candidate)) return candidate;
	if (windows) for (const d of dirs) {
		const cli = join(d, "node_modules", "@anthropic-ai", "claude-code", "cli.js");
		if (await exists(join(d, "claude.cmd")) && await exists(cli)) return cli;
	}
	return null;
}
//#endregion
//#region src/runner/environment.ts
const runnerEnvPath = (claudeDir) => path.join(claudeDir, "isoplan", "runner", "environment.json");
const KEYS = /* @__PURE__ */ new Set([
	"PATH",
	"PATHEXT",
	"HOME",
	"USERPROFILE",
	"HOMEDRIVE",
	"HOMEPATH",
	"USER",
	"USERNAME",
	"LOGNAME",
	"SHELL",
	"LANG",
	"LC_ALL",
	"LC_CTYPE",
	"TZ",
	"TMPDIR",
	"TEMP",
	"TMP",
	"SYSTEMROOT",
	"SYSTEMDRIVE",
	"WINDIR",
	"COMSPEC",
	"APPDATA",
	"LOCALAPPDATA",
	"PROGRAMDATA",
	"PROGRAMFILES",
	"PROGRAMFILES(X86)",
	"COMMONPROGRAMFILES",
	"OS",
	"NUMBER_OF_PROCESSORS",
	"PROCESSOR_ARCHITECTURE",
	"XDG_CONFIG_HOME",
	"XDG_DATA_HOME",
	"XDG_CACHE_HOME",
	"XDG_RUNTIME_DIR",
	"HTTP_PROXY",
	"HTTPS_PROXY",
	"NO_PROXY",
	"ALL_PROXY",
	"NODE_EXTRA_CA_CERTS",
	"SSL_CERT_FILE",
	"SSL_CERT_DIR",
	"CLAUDE_CONFIG_DIR",
	"CLAUDE_CODE_USE_BEDROCK",
	"CLAUDE_CODE_USE_VERTEX",
	"CLAUDE_CODE_OAUTH_TOKEN",
	"CLAUDE_CODE_SKIP_BEDROCK_AUTH",
	"CLAUDE_CODE_SKIP_VERTEX_AUTH",
	"CLOUD_ML_REGION"
]);
const PREFIXES = [
	"ANTHROPIC_",
	"AWS_",
	"GOOGLE_",
	"GCLOUD_",
	"CLOUDSDK_",
	"VERTEX_REGION_"
];
/** The part of `env` the runner keeps: names are matched without regard to case, as Windows does. */
function captureEnv(env) {
	const out = {};
	for (const [key, value] of Object.entries(env)) {
		const name = key.toUpperCase();
		if (value !== void 0 && (KEYS.has(name) || PREFIXES.some((p) => name.startsWith(p)))) out[key] = value;
	}
	return out;
}
const NOTE = "Isoplan's runner starts with exactly this environment, recorded from the shell that ran the plugin's install script, so a session's settings can't change what the runner and its forks see. Edit it if you need to; each run of the install script writes it again.";
/** Writes the captured environment; true when it changed. Readable by its owner alone where that can be set. */
async function recordEnv(claudeDir, env) {
	const file = runnerEnvPath(claudeDir);
	const text = JSON.stringify({
		about: NOTE,
		env: captureEnv(env)
	}, null, 2) + "\n";
	if (await fs.readFile(file, "utf8").catch(() => null) === text) return false;
	await fs.mkdir(path.dirname(file), { recursive: true });
	const temp = `${file}.${process.pid}`;
	await fs.writeFile(temp, text, { mode: 384 });
	await fs.rename(temp, file);
	return true;
}
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
//#region src/install/app.ts
const desktopAppLockPath = (claudeDir) => path.join(claudeDir, "isoplan", "runner", "desktop-app.lock");
/** Where the app goes for this person, the folder its archive holds at its top, and the program to start in it. */
function appPlace(platform, home, env) {
	if (platform === "win32") return {
		dir: path.win32.join(env.LOCALAPPDATA || path.win32.join(home, "AppData", "Local"), "Programs", "Isoplan"),
		top: "Isoplan"
	};
	if (platform === "darwin") return {
		dir: path.posix.join(home, "Applications", "Isoplan.app"),
		top: "Isoplan.app"
	};
	return null;
}
/** The program that starts the app: Electrobun's launcher on Windows, the bundle's executable on macOS. */
async function launchOf(dir, platform) {
	if (platform === "win32") return path.join(dir, "bin", "launcher.exe");
	const plist = await fs.readFile(path.join(dir, "Contents", "Info.plist"), "utf8");
	const name = /<key>CFBundleExecutable<\/key>\s*<string>([^<]+)<\/string>/.exec(plist)?.[1];
	if (!name) throw new Error("its Info.plist names no executable");
	return path.join(dir, "Contents", "MacOS", name);
}
/** The system's own tar, by its full path: another tar first on PATH (Git Bash's) misreads C:\ paths. */
const systemTar = (platform, env) => platform === "win32" ? path.win32.join(env.SystemRoot || "C:\\Windows", "System32", "tar.exe") : "/usr/bin/tar";
/**
* Puts the app this plugin version names in place, unless it is there already. Says what it
* changed, and why the runner stays on node when it tried and couldn't; nothing when there was
* nothing to do (in place already, held off, another install under way, no app for this OS, or
* switched off with none in use). `installed` is true when a new app is in place, for the caller
* to start it.
*/
async function installApp(o) {
	const { claudeDir, platform } = o;
	const now = o.now ?? Date.now;
	const isAlive = o.isAlive ?? alive;
	const settings = await loadSettings(nodeIo(), path.join(o.from, "runner.json"), path.join(claudeDir, "isoplan", "runner.json"));
	const recorded = await recordedApp(claudeDir);
	const place = appPlace(platform, o.home, o.env);
	const stay = (why) => ({
		changes: [`the runner stays on node: ${why}`],
		installed: false
	});
	if (!settings.desktopApp) {
		if (!recorded) return {
			changes: [],
			installed: false
		};
		await stopApp(o, isAlive, now);
		await fs.writeFile(desktopAppPath(claudeDir), JSON.stringify({
			...recorded,
			off: true
		}, null, 2) + "\n");
		return {
			changes: ["took the desktop app out of use, as \"desktopApp\" is off in runner.json; the runner runs on node"],
			installed: false
		};
	}
	if (!place) return {
		changes: [],
		installed: false
	};
	const release = JSON.parse(await fs.readFile(path.join(o.from, "app-release.json"), "utf8"));
	if (recorded?.version === release.version && recorded.dir === place.dir) return {
		changes: [],
		installed: false
	};
	const lock = desktopAppLockPath(claudeDir);
	const downloadMs = settings.appDownloadSeconds * 1e3;
	const retryAt = () => now() + settings.appRetryHours * 36e5;
	const held = await readLock(lock);
	if (held?.until && held.until > now() && held.extra.version !== release.version) await fs.rm(lock, { force: true });
	if (!await takeLock(lock, process.pid, isAlive, false, now(), { freshMs: 2 * downloadMs + 6e4 })) return {
		changes: [],
		installed: false
	};
	await removeLeftovers(place.dir, isAlive);
	const staging = `${place.dir}.isoplan-${process.pid}`;
	try {
		const manifestUrl = release.manifest.replace(/\{version\}/g, release.version).replace(/\{platform\}/g, platform).replace(/\{arch\}/g, o.arch);
		const got = await (o.fetch ?? fetch)(manifestUrl, { signal: AbortSignal.timeout(downloadMs) });
		if (got.status === 404) {
			await holdOff(lock, process.pid, retryAt(), { version: release.version });
			return stay(`release ${release.version} has no desktop app for ${platform}-${o.arch} yet; trying again in ${settings.appRetryHours} hours`);
		}
		if (!got.ok) throw new Error(`its manifest couldn't be read (${got.status} from ${manifestUrl})`);
		const asset = await got.json();
		await fs.rm(staging, {
			recursive: true,
			force: true
		});
		await fs.mkdir(staging, { recursive: true });
		const archive = path.join(staging, asset.file);
		await download(o.fetch ?? fetch, new URL(asset.file, manifestUrl).href, archive, asset, downloadMs);
		const unpacked = await (o.run ?? exec)(systemTar(platform, o.env), [
			"-xzf",
			archive,
			"-C",
			staging
		]);
		if (unpacked.code !== 0) throw new Error(`tar couldn't unpack ${asset.file} (${unpacked.code})`);
		const fresh = path.join(staging, place.top);
		const launch = await launchOf(fresh, platform);
		if (!(await fs.stat(launch).catch(() => null))?.isFile()) throw new Error(`${asset.file} holds no ${path.basename(launch)}`);
		await stopApp(o, isAlive, now);
		await swapIn(fresh, place.dir);
		const app = {
			version: release.version,
			dir: place.dir,
			launch: await launchOf(place.dir, platform)
		};
		await fs.writeFile(desktopAppPath(claudeDir), JSON.stringify(app, null, 2) + "\n");
		await releaseLock(lock, process.pid);
		return {
			changes: [`installed Isoplan's desktop app ${release.version} in ${place.dir}`],
			installed: true
		};
	} catch (err) {
		await holdOff(lock, process.pid, retryAt(), { version: release.version }).catch(() => {});
		return stay(`couldn't install the desktop app: ${err.message}; trying again in ${settings.appRetryHours} hours`);
	} finally {
		await fs.rm(staging, {
			recursive: true,
			force: true,
			maxRetries: 5
		}).catch(() => {});
	}
}
async function removeLeftovers(dir, isAlive) {
	const prefix = `${path.basename(dir)}.`;
	for (const name of await fs.readdir(path.dirname(dir)).catch(() => [])) {
		const pid = name.startsWith(prefix) ? /^(?:isoplan|old)-(\d+)$/.exec(name.slice(prefix.length))?.[1] : void 0;
		if (pid && !isAlive(Number(pid))) await fs.rm(path.join(path.dirname(dir), name), {
			recursive: true,
			force: true,
			maxRetries: 5
		}).catch(() => {});
	}
}
async function download(get, url, file, asset, timeoutMs) {
	const res = await get(url, { signal: AbortSignal.timeout(timeoutMs) });
	if (!res.ok || !res.body) throw new Error(`the download of ${asset.file} failed (${res.status})`);
	const hash = createHash("sha256");
	let size = 0;
	const body = Readable.fromWeb(res.body);
	body.on("data", (chunk) => {
		size += chunk.length;
		hash.update(chunk);
		if (size > asset.size) body.destroy(/* @__PURE__ */ new Error(`${asset.file} is bigger than the manifest says (${asset.size} bytes)`));
	});
	await pipeline(body, createWriteStream(file));
	if (size !== asset.size) throw new Error(`${asset.file} is ${size} bytes, not the ${asset.size} the manifest says`);
	if (hash.digest("hex") !== asset.sha256.toLowerCase()) throw new Error(`${asset.file}'s sha256 isn't the one the manifest says`);
}
async function swapIn(fresh, dir) {
	const old = `${dir}.old-${process.pid}`;
	let had = false;
	for (let tries = 0;; tries++) {
		const moved = await fs.rename(dir, old).then(() => null, (err) => err);
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
	if (had) await fs.rm(old, {
		recursive: true,
		force: true,
		maxRetries: 5
	}).catch(() => {});
}
async function stopApp(o, isAlive, now) {
	const lock = await readLock(runnerLockPath(o.claudeDir));
	if (!lock?.pid || !isAppLock(lock.extra)) return;
	const pid = lock.pid;
	await stopRunner(o.claudeDir, {
		isAlive,
		now,
		...o.kill && { kill: o.kill }
	});
	for (const until = now() + (o.exitMs ?? 1e4); isAlive(pid) && now() < until;) await new Promise((r) => setTimeout(r, 100));
}
//#endregion
//#region src/install/hidden-launch.ts
/** wscript.exe, by its full path, so no other program of that name is found first. */
const wscriptPath = (env = process.env) => path.win32.join(env.SystemRoot || "C:\\Windows", "System32", "wscript.exe");
/** The command Windows runs: wscript in batch mode (no prompts, no logo), with the JScript engine, on `launcher`, then `args`. */
const launchCommand = (launcher, args = "") => `"${wscriptPath()}" //B //NoLogo //E:JScript "${launcher}"${args ? ` ${args}` : ""}`;
/** The launcher `launchCommand` names in a command; null for any other command. */
const launcherOf = (command) => command ? /^"[^"]+\\wscript\.exe" \/\/B \/\/NoLogo \/\/E:JScript "([^"]+)"/i.exec(command)?.[1] ?? null : null;
/** A literal JScript and JSON both read: JSON, with every character outside printable ASCII as \uXXXX. */
const asciiLiteral = (value) => JSON.stringify(value).replace(/[^\x20-\x7e]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
/**
* The launcher: runs `"<node>" "<script>" <args>` hidden. With `link`, the link Windows gives it goes
* to node in ISOPLAN_CONNECT_URL, never on a command line, as the Mac handler passes it.
*/
function hiddenLauncher(node, script, { args = "", link = false } = {}) {
	const command = `"${node}" "${script}"${args ? ` ${args}` : ""}`;
	return [
		"// Isoplan: starts node with no window. The plugin's install wrote this file; uninstall removes it.",
		`var isoplan = ${asciiLiteral({
			node,
			script
		})};`,
		"var shell = new ActiveXObject(\"WScript.Shell\");",
		...link ? ["shell.Environment(\"PROCESS\")(\"ISOPLAN_CONNECT_URL\") = WScript.Arguments(0);"] : [],
		`shell.Run(${asciiLiteral(command)}, 0, false);`,
		""
	].join("\r\n");
}
/** The node and script a launcher names, as hiddenLauncher writes them; null when it isn't one. */
function launcherPaths(text) {
	const line = text ? /^var isoplan = (.*);\r?$/m.exec(text)?.[1] : void 0;
	try {
		return line ? JSON.parse(line) : null;
	} catch {
		return null;
	}
}
const SCRIPT_HOST_KEYS = ["HKCU\\Software\\Microsoft\\Windows Script Host\\Settings", "HKLM\\Software\\Microsoft\\Windows Script Host\\Settings"];
/** Whether Windows Script Host is turned off for this person or this computer (`Enabled` set to 0). */
async function scriptHostOff(run) {
	for (const key of SCRIPT_HOST_KEYS) {
		const value = /\bEnabled[ \t]+REG_\w+[ \t]+(\S+)/i.exec((await run("reg", [
			"query",
			key,
			"/v",
			"Enabled"
		])).stdout)?.[1];
		if (value !== void 0 && /^(0|0x0+)$/i.test(value)) return true;
	}
	return false;
}
//#endregion
//#region src/install/link-handler.ts
const KEY = "HKCU\\Software\\Classes\\isoplan";
const OPEN_KEY = `${KEY}\\shell\\open`;
const COMMAND_KEY = `${OPEN_KEY}\\command`;
const LSREGISTER = "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister";
const DESKTOP = "isoplan-connect.desktop";
const macAppPath = (claudeDir) => path.join(claudeDir, "isoplan", "Isoplan Connect.app");
const macMarker = (app) => path.join(app, "Contents", "Resources", "isoplan-handler.json");
const desktopPath = (h) => path.join(h.dataHome || path.join(h.home, ".local", "share"), "applications", DESKTOP);
/** The Windows launcher the open command runs. */
const linkLauncherPath = (claudeDir) => path.join(claudeDir, "isoplan", "open-link.js");
/** The Windows open command: wscript on the launcher, and the link. */
const windowsCommand = (launcher) => launchCommand(launcher, "\"%1\"");
/** The open command where Windows Script Host is off: node and the handler, quoted, and the link. */
const directCommand = (node, script) => `"${node}" "${script}" "%1"`;
/** The value `reg query` prints for a key's default or a named value, whatever the language of its "(Default)" label. */
const regValue = (stdout) => /REG_SZ[ \t]+(.*?)\s*$/m.exec(stdout)?.[1] ?? null;
const norm = (p) => p.replace(/\\/g, "/").toLowerCase();
const appleString = (text) => `"${text.replace(/\\/g, "\\\\").replace(/"/g, "\\\"")}"`;
/** The macOS app's script: the link to node in the background, quoted by the shell's own rules. */
const macScript = (node, script) => [
	"on open location theURL",
	`\tdo shell script "ISOPLAN_CONNECT_URL=" & quoted form of theURL & " " & quoted form of ${appleString(node)} & " " & quoted form of ${appleString(script)} & " >/dev/null 2>&1 &"`,
	"end open location",
	""
].join("\n");
const exists$1 = (file) => fs.stat(file).then(() => true, () => false);
/** Whether a registration naming this node and this handler still works: both are there. */
const works = async (paths) => !!paths && typeof paths.node === "string" && typeof paths.script === "string" && await exists$1(paths.node) && await exists$1(paths.script);
/** The node and handler a direct Windows open command names, as directCommand writes it. */
const directPaths = (command) => {
	const m = command ? /^"([^"]+)" "([^"]+)" "%1"$/.exec(command) : null;
	return m ? {
		node: m[1],
		script: m[2]
	} : null;
};
/** A desktop entry's Exec argument, quoted as the Desktop Entry spec asks, then escaped as its strings are. */
const execArg = (value) => `"${value.replace(/(["`$\\])/g, "\\$1")}"`.replace(/\\/g, "\\\\");
/** The Linux desktop entry. */
const desktopEntry = (node, script) => [
	"[Desktop Entry]",
	"Type=Application",
	"Name=Isoplan Connect",
	`Exec=${execArg(node)} ${execArg(script)} %u`,
	"NoDisplay=true",
	"Terminal=false",
	"MimeType=x-scheme-handler/isoplan;",
	`X-Isoplan-Handler=${JSON.stringify({
		node,
		script
	})}`,
	""
].join("\n");
const desktopPaths = (entry) => {
	const line = entry ? /^X-Isoplan-Handler=(.*)$/m.exec(entry)?.[1] : void 0;
	try {
		return line ? JSON.parse(line) : null;
	} catch {
		return null;
	}
};
const linkHandlerLockPath = (claudeDir) => path.join(claudeDir, "isoplan", "link-handler.lock");
/** Registers the handler when none works; says what it changed. Another install registering at the same moment leaves it to that one. */
async function registerLinkHandler(given) {
	const lock = linkHandlerLockPath(given.claudeDir);
	if (!await takeLock(lock, process.pid, alive, false, Date.now(), { freshMs: 12e4 })) return [];
	try {
		return await register$1(given);
	} finally {
		await releaseLock(lock, process.pid).catch(() => {});
	}
}
async function register$1(given) {
	const h = {
		...given,
		node: await fs.realpath(given.node).catch(() => given.node)
	};
	const run = h.run ?? exec;
	const must = async (file, args) => {
		const r = await run(file, args);
		if (r.code !== 0) throw new Error(`${path.basename(file)} ${args[0] ?? ""} failed${r.code === null ? " to start" : ` (${r.code})`}`);
	};
	if (h.platform === "win32") {
		const current = regValue((await run("reg", [
			"query",
			COMMAND_KEY,
			"/ve"
		])).stdout);
		const off = await scriptHostOff(run);
		if (off && await works(directPaths(current))) return [];
		const launcher = launcherOf(current);
		if (!off && launcher && await works(launcherPaths(await fs.readFile(launcher, "utf8").catch(() => null)))) return [];
		const file = linkLauncherPath(h.claudeDir);
		if (!off) {
			await fs.mkdir(path.dirname(file), { recursive: true });
			await fs.writeFile(file, hiddenLauncher(h.node, h.script, { link: true }));
		}
		await must("reg", [
			"add",
			KEY,
			"/ve",
			"/d",
			"URL:Isoplan",
			"/f"
		]);
		await must("reg", [
			"add",
			KEY,
			"/v",
			"URL Protocol",
			"/d",
			"",
			"/f"
		]);
		await must("reg", [
			"add",
			OPEN_KEY,
			"/v",
			"FriendlyAppName",
			"/d",
			"Isoplan",
			"/f"
		]);
		await must("reg", [
			"add",
			COMMAND_KEY,
			"/ve",
			"/d",
			off ? directCommand(h.node, h.script) : windowsCommand(file),
			"/f"
		]);
		return [off ? `registered isoplan:// links to open ${h.script}; Windows Script Host is turned off, so a link shows a console window for a moment` : `registered isoplan:// links to open ${h.script}, through ${file}`];
	}
	if (h.platform === "darwin") {
		const app = macAppPath(h.claudeDir);
		const marker = JSON.stringify({
			node: h.node,
			script: h.script
		});
		const registered = await fs.readFile(macMarker(app), "utf8").then((t) => JSON.parse(t), () => null);
		if (await works(registered)) return [];
		const source = path.join(h.claudeDir, "isoplan", "connect.applescript");
		await fs.rm(app, {
			recursive: true,
			force: true
		});
		await fs.mkdir(path.dirname(source), { recursive: true });
		await fs.writeFile(source, macScript(h.node, h.script));
		try {
			await must("osacompile", [
				"-o",
				app,
				source
			]);
		} finally {
			await fs.rm(source, { force: true });
		}
		const plist = path.join(app, "Contents", "Info.plist");
		await must("plutil", [
			"-replace",
			"CFBundleIdentifier",
			"-string",
			"dev.isoplan.connect",
			plist
		]);
		await must("plutil", [
			"-replace",
			"CFBundleURLTypes",
			"-json",
			JSON.stringify([{
				CFBundleURLName: "Isoplan link",
				CFBundleURLSchemes: ["isoplan"]
			}]),
			plist
		]);
		await must("plutil", [
			"-replace",
			"LSUIElement",
			"-bool",
			"true",
			plist
		]);
		await must("codesign", [
			"--force",
			"--deep",
			"--sign",
			"-",
			app
		]);
		await fs.writeFile(macMarker(app), marker);
		await must(LSREGISTER, ["-f", app]);
		return [`registered isoplan:// links to open ${h.script}, through ${app}`];
	}
	if (h.platform === "linux") {
		const file = desktopPath(h);
		const want = desktopEntry(h.node, h.script);
		if ((await run("xdg-mime", [
			"query",
			"default",
			"x-scheme-handler/isoplan"
		])).stdout.trim() === DESKTOP && await works(desktopPaths(await fs.readFile(file, "utf8").catch(() => null)))) return [];
		await fs.mkdir(path.dirname(file), { recursive: true });
		await fs.writeFile(file, want);
		await must("xdg-mime", [
			"default",
			DESKTOP,
			"x-scheme-handler/isoplan"
		]);
		await run("update-desktop-database", [path.dirname(file)]);
		return [`registered isoplan:// links to open ${h.script}, through ${file}`];
	}
	return [];
}
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
/** What the item passes the wake hook. */
const LOGIN_ARG = "--login";
const RUN_KEY = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run";
/** A short id of the config folder, so each folder's item has its own name. */
const loginItemId = (claudeDir, platform) => createHash("sha256").update(normalPath(claudeDir, platform)).digest("hex").slice(0, 8);
const runValueName = (claudeDir) => `Isoplan runner ${loginItemId(claudeDir, "win32")}`;
const loginLauncherPath = (claudeDir) => path.join(claudeDir, "isoplan", "start-at-login.js");
const launchAgentLabel = (claudeDir) => `dev.isoplan.runner.${loginItemId(claudeDir, "darwin")}`;
const launchAgentPath = (home, claudeDir) => path.join(home, "Library", "LaunchAgents", `${launchAgentLabel(claudeDir)}.plist`);
const autostartPath = (h) => path.join(h.configHome || path.join(h.home, ".config"), "autostart", `isoplan-runner-${loginItemId(h.claudeDir, "linux")}.desktop`);
/** The Run value: wscript on the launcher. */
const windowsLoginCommand = (claudeDir) => launchCommand(loginLauncherPath(claudeDir));
const xml = (text) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const unxml = (text) => text.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
/**
* The LaunchAgent. AbandonProcessGroup, since launchd otherwise ends what is left in the job's
* process group once the job exits, and the job exits as soon as it has started the runner.
*/
const launchAgentPlist = (label, node, script) => [
	"<?xml version=\"1.0\" encoding=\"UTF-8\"?>",
	"<!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \"http://www.apple.com/DTDs/PropertyList-1.0.dtd\">",
	"<plist version=\"1.0\">",
	"<dict>",
	"	<key>Label</key>",
	`\t<string>${xml(label)}</string>`,
	"	<key>ProgramArguments</key>",
	"	<array>",
	...[
		node,
		script,
		LOGIN_ARG
	].map((arg) => `\t\t<string>${xml(arg)}</string>`),
	"	</array>",
	"	<key>RunAtLoad</key>",
	"	<true/>",
	"	<key>AbandonProcessGroup</key>",
	"	<true/>",
	"</dict>",
	"</plist>",
	""
].join("\n");
const plistPaths = (text) => {
	const args = text ? /<key>ProgramArguments<\/key>\s*<array>([\s\S]*?)<\/array>/.exec(text)?.[1] : void 0;
	const [node, script] = args ? [...args.matchAll(/<string>([^<]*)<\/string>/g)].map((m) => unxml(m[1])) : [];
	return node && script ? {
		node,
		script
	} : null;
};
/** The XDG autostart entry. */
const autostartEntry = (node, script) => [
	"[Desktop Entry]",
	"Type=Application",
	"Name=Isoplan",
	"Comment=Starts Isoplan's runner when you log in",
	`Exec=${execArg(node)} ${execArg(script)} ${LOGIN_ARG}`,
	"Terminal=false",
	"NoDisplay=true",
	`X-Isoplan-Login=${JSON.stringify({
		node,
		script
	})}`,
	""
].join("\n");
const autostartPaths = (entry) => {
	const line = entry ? /^X-Isoplan-Login=(.*)$/m.exec(entry)?.[1] : void 0;
	try {
		return line ? JSON.parse(line) : null;
	} catch {
		return null;
	}
};
const read = (file) => fs.readFile(file, "utf8").catch(() => null);
/** Whether runner.json (`defaultsPath`, overridden by the person's `userPath`) has the runner start at login; on unless it says false. */
async function startsAtLogin(defaultsPath, userPath) {
	return (await loadSettings(nodeIo(), defaultsPath, userPath).catch(() => null))?.startAtLogin !== false;
}
const loginItemLockPath = (claudeDir) => path.join(claudeDir, "isoplan", "login-item.lock");
/** Registers the login item unless a working one is there; says what it changed. Another install registering at the same moment leaves it to that one. */
async function registerLoginItem(given) {
	const lock = loginItemLockPath(given.claudeDir);
	if (!await takeLock(lock, process.pid, alive, false, Date.now(), { freshMs: 12e4 })) return [];
	try {
		return await register(given);
	} finally {
		await releaseLock(lock, process.pid).catch(() => {});
	}
}
async function register(given) {
	const h = {
		...given,
		node: await fs.realpath(given.node).catch(() => given.node)
	};
	const run = h.run ?? exec;
	const must = async (file, args) => {
		const r = await run(file, args);
		if (r.code !== 0) throw new Error(`${path.basename(file)} ${args[0] ?? ""} failed${r.code === null ? " to start" : ` (${r.code})`}`);
	};
	if (h.platform === "win32") {
		if (await scriptHostOff(run)) {
			const why = "Windows Script Host is turned off on this computer, and without it the runner can't start with no window";
			const removed = await unregisterLoginItem(h);
			if (!removed.length) throw new Error(why);
			return removed.map((change) => `${change}: ${why}`);
		}
		const launcher = loginLauncherPath(h.claudeDir);
		const want = windowsLoginCommand(h.claudeDir);
		if (regValue((await run("reg", [
			"query",
			RUN_KEY,
			"/v",
			runValueName(h.claudeDir)
		])).stdout)?.toLowerCase() === want.toLowerCase() && await works(launcherPaths(await read(launcher)))) return [];
		await fs.mkdir(path.dirname(launcher), { recursive: true });
		await fs.writeFile(launcher, hiddenLauncher(h.node, h.script, { args: LOGIN_ARG }));
		await must("reg", [
			"add",
			RUN_KEY,
			"/v",
			runValueName(h.claudeDir),
			"/d",
			want,
			"/f"
		]);
		return [`set the runner to start at login, through ${launcher}`];
	}
	if (h.platform === "darwin") {
		const file = launchAgentPath(h.home, h.claudeDir);
		const label = launchAgentLabel(h.claudeDir);
		if (await works(plistPaths(await read(file)))) return [];
		await run("launchctl", ["bootout", `gui/${h.uid}/${label}`]);
		await fs.mkdir(path.dirname(file), { recursive: true });
		await fs.writeFile(file, launchAgentPlist(label, h.node, h.script));
		await must("launchctl", [
			"bootstrap",
			`gui/${h.uid}`,
			file
		]);
		return [`set the runner to start at login, through ${file}`];
	}
	if (h.platform === "linux") {
		const file = autostartPath(h);
		if (await works(autostartPaths(await read(file)))) return [];
		await fs.mkdir(path.dirname(file), { recursive: true });
		await fs.writeFile(file, autostartEntry(h.node, h.script));
		return [`set the runner to start at login, through ${file}`];
	}
	return [];
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
const WAKE_EVENTS = ["UserPromptSubmit", "Stop"];
const TIMEOUT_SECONDS = 10;
const wakeScriptPath = (claudeDir) => path.join(claudeDir, "isoplan", "wake.mjs");
/** Where install copies the runner and the defaults it reads, under the plugin's own layout. */
const runnerAppDir = (claudeDir) => path.join(claudeDir, "isoplan", "runner", "app");
const RUNNER_FILES = [
	"config.json",
	"runner.json",
	"secret-patterns.json",
	"prompts/instructions.md",
	"prompts/question.md",
	"prompts/brief.md",
	"prompts/spin-off.md",
	"prompts/naming.md",
	"dist/connect.js",
	"dist/runner.js"
];
/** The link handler's copy, which the operating system runs for an isoplan:// link. */
const connectScriptPath = (claudeDir) => path.join(runnerAppDir(claudeDir), copiedAs("dist/connect.js"));
/** A file's name in the copy: the bundle is an ES module and no package.json beside the copy says so, so it is .mjs, as wake.mjs is. */
const copiedAs = (file) => file.replace(/\.js$/, ".mjs");
/** The uninstall's lock, which also holds off a retry once one has failed. */
const uninstallLockPath = (claudeDir) => path.join(claudeDir, "isoplan", "uninstall.json");
/** Where an uninstall in the background says what stopped it. */
const uninstallLogPath = (claudeDir) => path.join(claudeDir, "isoplan", "uninstall.log");
/**
* The hook's command. Shell form, quoted, with forward slashes, so Git Bash, PowerShell and sh all
* read the path the same way.
*/
const wakeCommand = (script) => `node "${script.replace(/\\/g, "/")}"`;
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
/**
* Copies `wakeSource` (dist/wake.js) into place, records `dataLayer`, and adds or updates the hooks.
* With `runnerFrom` (the plugin's folder) it copies the runner too, and records the copy.
* Returns what it changed, [] when it was all there. Throws when settings.json can't be merged.
* With `auto` (the plugin's data layer) it does nothing once the hook has been uninstalled, but
* finish what that uninstall left (a wake.mjs no hook names), or once Claude Code lists the plugin
* `dataLayer` belongs to as uninstalled: a session that loaded it before then still runs it.
*
* A background uninstall that is running is waited for, up to `waitMs`; one still running then
* leaves the plugin's data layer doing nothing (its next start tries again), and the install
* script failing. An uninstall that failed, or whose process has gone, leaves its lock and log,
* which go now, since the plugin is wanted after all.
*/
async function installWake(paths, dataLayer, wakeSource, { auto = false, runnerFrom, findClaude, waitMs = INSTALL_WAIT_MS, linkHandler, loginItem } = {}) {
	const { claudeDir, settings } = paths;
	if (auto && await isOptedOut(claudeDir)) return finishOptOut(paths);
	if (auto && await pluginState(paths, dataLayer) === "uninstalled") return [];
	if (!await waitForUninstall(claudeDir, waitMs)) {
		if (auto) return [];
		throw new Error(`an uninstall is running (${uninstallLockPath(claudeDir)}); try again once it is done`);
	}
	const isWake = isWakeFor(claudeDir);
	const current = await readSettings(settings);
	const script = wakeScriptPath(claudeDir);
	const hooks = current.hooks ??= {};
	if (typeof hooks !== "object" || Array.isArray(hooks)) throw new Error(`${settings}: "hooks" isn't an object; left it alone`);
	const want = {
		type: "command",
		command: wakeCommand(script),
		timeout: TIMEOUT_SECONDS
	};
	const done = [];
	for (const event of WAKE_EVENTS) {
		const groups = hooks[event] ??= [];
		if (!Array.isArray(groups)) throw new Error(`${settings}: hooks.${event} isn't a list; left it alone`);
		let found = false;
		let changed = false;
		const kept = groups.filter((group) => {
			const list = group?.hooks;
			if (!Array.isArray(list) || !list.some(isWake)) return true;
			group.hooks = list.flatMap((hook) => {
				if (!isWake(hook)) return [hook];
				if (found) {
					changed = true;
					return [];
				}
				found = true;
				if (JSON.stringify(hook) !== JSON.stringify(want)) changed = true;
				return [want];
			});
			return group.hooks.length > 0;
		});
		if (!found) kept.push({ hooks: [want] });
		hooks[event] = kept;
		if (!found) done.push(`added the wake hook to ${settings} on ${event}`);
		else if (changed) done.push(`updated the wake hook in ${settings} on ${event}`);
	}
	const changes = [];
	let runner;
	if (runnerFrom) {
		const app = runnerAppDir(claudeDir);
		let copied = false;
		for (const file of RUNNER_FILES) if (await writeIfChanged(path.join(app, copiedAs(file)), await fs.readFile(path.join(runnerFrom, file), "utf8"))) copied = true;
		runner = path.join(app, copiedAs("dist/runner.js"));
		if (copied) changes.push(`copied the runner to ${app}`);
	}
	const record = runner ? {
		dataLayer,
		runner
	} : { dataLayer };
	await fs.mkdir(path.dirname(script), { recursive: true });
	if (await writeIfChanged(script, await fs.readFile(wakeSource, "utf8"))) changes.push(`copied the wake hook to ${script}`);
	if (await writeIfChanged(wakeRecordPath(claudeDir), JSON.stringify(record, null, 2) + "\n")) changes.push(`recorded the data layer at ${dataLayer}${runner ? ` and the runner at ${runner}` : ""}`);
	const binary = claudeBinaryPath(claudeDir);
	const kind = await binaryRecord(binary);
	if (kind === "broken") changes.push(`kept ${binary}, which doesn't parse: it may have been edited by hand`);
	const claude = findClaude && (kind === "none" || kind === "auto") ? await findClaude() : null;
	if (claude && await writeIfChanged(binary, JSON.stringify({
		path: claude,
		auto: true
	}, null, 2) + "\n")) changes.push(`recorded the claude binary at ${claude}`);
	for (const file of [uninstallLogPath(claudeDir), uninstallLockPath(claudeDir)]) if (await fs.rm(file).then(() => true, () => false)) changes.push(`removed ${file}, left by an uninstall that didn't finish`);
	if (runnerFrom && linkHandler) changes.push(...await registerLinkHandler({
		...linkHandler,
		claudeDir,
		script: connectScriptPath(claudeDir)
	}).catch((err) => [`couldn't register isoplan:// links: ${String(err?.message ?? err)}`]));
	if (runnerFrom && loginItem) {
		const item = {
			...loginItem,
			claudeDir,
			script
		};
		const on = await startsAtLogin(path.join(runnerFrom, "runner.json"), path.join(claudeDir, "isoplan", "runner.json"));
		changes.push(...await (on ? registerLoginItem(item) : unregisterLoginItem(item)).catch((err) => [`couldn't ${on ? "set the runner to start" : "take out the runner's start"} at login: ${String(err?.message ?? err)}`]));
	}
	if (done.length) await writeSettings(settings, current);
	return [...changes, ...done];
}
/** How long an install waits for a running background uninstall. */
const INSTALL_WAIT_MS = 15e3;
async function waitForUninstall(claudeDir, waitMs) {
	const file = uninstallLockPath(claudeDir);
	for (const until = Date.now() + waitMs;; await new Promise((r) => setTimeout(r, 250))) {
		const pid = (await readLock(file))?.pid;
		if (!pid || !alive(pid)) return true;
		if (Date.now() >= until) return false;
	}
}
async function finishOptOut({ claudeDir, settings }) {
	const isWake = isWakeFor(claudeDir);
	const hooks = await readSettings(settings).then((current) => current.hooks, () => void 0);
	const named = !!hooks && typeof hooks === "object" && Object.values(hooks).some((groups) => Array.isArray(groups) && groups.some((g) => Array.isArray(g?.hooks) && g.hooks.some(isWake)));
	const changes = [];
	if (named || !await waitForUninstall(claudeDir, 0)) return changes;
	for (const file of [
		wakeScriptPath(claudeDir),
		uninstallLogPath(claudeDir),
		uninstallLockPath(claudeDir)
	]) if (await fs.rm(file).then(() => true, () => false)) changes.push(`removed ${file}, left by an uninstall`);
	return changes;
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
async function uninstall$1(paths, { optOut = false, settleMs = 0, confirm, runner = {}, linkHandler, loginItem } = {}) {
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
	if (await stopOurRunner(paths.claudeDir, runner)) changes.push("stopped the runner, which answered for this machine's rooms");
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
async function isOptedOut(claudeDir) {
	try {
		return JSON.parse(await fs.readFile(wakeRecordPath(claudeDir), "utf8")).disabled === true;
	} catch {
		return false;
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
//#region src/install/main.ts
const here = path.dirname(fileURLToPath(import.meta.url));
const claudeDir = claudePaths(process.env, os.homedir()).dir;
const paths = {
	claudeDir,
	settings: path.join(claudeDir, "settings.json"),
	plugins: pluginsDir(claudeDir, process.env),
	managed: managedDir(process.platform),
	pluginDirs: pluginDirsOf(process.env)
};
const RUNNER_EXIT_MS = 1e4;
const uninstall = process.argv.includes("--uninstall");
const linkHandler = {
	platform: process.platform,
	home: os.homedir(),
	dataHome: process.env.XDG_DATA_HOME,
	node: process.execPath
};
const loginItem = {
	platform: process.platform,
	home: os.homedir(),
	configHome: process.env.XDG_CONFIG_HOME,
	uid: process.getuid?.(),
	node: process.execPath
};
const start = (args, cwd, env) => spawn(process.execPath, args, {
	cwd,
	env,
	detached: true,
	stdio: "ignore",
	windowsHide: true
}).on("error", () => {}).unref();
try {
	const settle = () => settleMs(claudeDir, path.join(here, "..", "config.json"));
	const changes = uninstall ? (await uninstall$1(paths, {
		optOut: true,
		settleMs: await settle(),
		runner: {
			commandOf: processCommand,
			waitMs: RUNNER_EXIT_MS
		},
		linkHandler,
		loginItem
	})).changes : await installWake(paths, path.join(here, "data-layer.js"), path.join(here, "wake.js"), {
		runnerFrom: path.join(here, ".."),
		findClaude: () => findClaude(process.env, process.platform, os.homedir()),
		linkHandler,
		loginItem
	});
	for (const change of changes) console.log(change);
	if (!changes.length) console.log(uninstall ? "Nothing of Isoplan's was installed; nothing to remove." : "The wake hook is already installed; nothing changed.");
	if (!uninstall) {
		if (!await fs.stat(claudeBinaryPath(claudeDir)).catch(() => null)) console.log("Couldn't find the claude binary, so the runner can't answer for this machine's rooms; set its path in " + claudeBinaryPath(claudeDir) + " as { \"path\": \"...\" }.");
		if (await recordEnv(claudeDir, process.env)) console.log(`recorded the runner's environment in ${runnerEnvPath(claudeDir)}`);
		for (const change of (await installApp({
			claudeDir,
			from: path.join(here, ".."),
			platform: process.platform,
			arch: process.arch,
			home: os.homedir(),
			env: process.env
		})).changes) console.log(change);
		const runner = await startRunner({
			claudeDir,
			spawn: start
		});
		console.log({
			started: "Started the runner, which answers for this machine's rooms.",
			running: "The runner is already running.",
			"held-off": `The runner is holding off for now (the office server didn't want it, or it kept crashing); see ${path.join(claudeDir, "isoplan", "logs", "runner.log")}.`,
			"not-installed": "The runner wasn't started: its copy isn't in place."
		}[runner]);
		const config = await loadConfig(nodeIo(), path.join(here, "..", "config.json"), path.join(claudeDir, "isoplan", "config.json"));
		if (runner === "started") console.log(`The runner reports this machine's sessions from the last ${config.lightsOffHours} hours to ${officesOf(config).map((o) => o.server).join(", ")} as it starts.`);
	}
} catch (err) {
	process.stderr.write(`isoplan install: ${err.message}\n`);
	process.exitCode = 1;
}
//#endregion
export {};
