import os from "node:os";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
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
//#region src/expert-offer/text.ts
/** A folder as the copy names it: "." is the repo's top folder. */
const folderWords = (folder) => folder === "." ? "the repo's top folder" : folder;
//#endregion
//#region src/expert-offer/open.ts
/** The file of a session's open offers. */
const offersPath = (claudeDir, session) => path.join(claudeDir, "isoplan", "offers", `${session}.json`);
/** The open offers in the file, in its order; none when it isn't there; why not when it couldn't be read as the runner writes it. */
async function readOffers(file) {
	let text;
	try {
		text = await fs.readFile(file, "utf8");
	} catch (err) {
		if (err.code === "ENOENT") return [];
		return { problem: err.message };
	}
	let value;
	try {
		value = JSON.parse(text);
	} catch {
		return { problem: "it isn't JSON" };
	}
	const offers = value?.offers;
	if (!Array.isArray(offers)) return { problem: "it has no list of offers" };
	return offers.filter((o) => !!o && typeof o === "object" && [
		"id",
		"name",
		"folder",
		"url"
	].every((k) => typeof o[k] === "string"));
}
const PLAIN_URL = /^https?:\/\/[A-Za-z0-9.:[\]-]+\/[A-Za-z0-9._~/?=-]*$/;
/** The command that opens `url` in the default browser on `platform`, or null when the link isn't one to hand to it. */
function opener(platform, url, comspec = "cmd.exe") {
	if (!PLAIN_URL.test(url)) return null;
	if (platform === "win32") return {
		command: comspec,
		args: [
			"/d",
			"/s",
			"/c",
			`"start "" "${url}""`
		]
	};
	return {
		command: platform === "darwin" ? "open" : "xdg-open",
		args: [url]
	};
}
/** Opens `url` in the default browser; rejects, saying why, when it couldn't. */
function openUrl(platform, url, run = spawn) {
	const how = opener(platform, url, process.env.ComSpec || "cmd.exe");
	if (!how) return Promise.reject(/* @__PURE__ */ new Error("its address has characters the system's opener could misread"));
	return new Promise((resolve, reject) => {
		const child = run(how.command, how.args, {
			stdio: "ignore",
			detached: true,
			windowsHide: true,
			windowsVerbatimArguments: platform === "win32"
		});
		const timer = setTimeout(() => (child.unref(), resolve()), 1e4);
		child.on("error", (err) => (clearTimeout(timer), reject(err)));
		child.on("exit", (code) => (clearTimeout(timer), code === 0 ? resolve() : reject(/* @__PURE__ */ new Error(`${how.command} exited with code ${code}`))));
	});
}
const what = (o) => `the ${o.name}, offered for ${folderWords(o.folder)}`;
/** What /isoplan:expert prints: the newest open offer opened, or why not, and the other offers' links. */
async function expertOffer(o) {
	if (!o.session || !/^[\w-]{1,200}$/.test(o.session)) return "This runs inside a Claude Code session, which sets CLAUDE_CODE_SESSION_ID; it isn't set here, so this session's expert offer can't be found. Use the review link in Isoplan's status line.";
	const file = offersPath(o.claudeDir, o.session);
	const all = await readOffers(file);
	if (!Array.isArray(all)) return `This session's open expert offers couldn't be read from ${file} (${all.problem}). Use the review link in Isoplan's status line.`;
	const [newest, ...others] = all.filter((x, i) => all.findIndex((y) => y.id === x.id) === i).reverse();
	if (!newest) return "This session has no open expert offer.";
	let text;
	try {
		await o.open(newest.url);
		text = `Opened the review of ${what(newest)}, in your browser: ${newest.url}`;
	} catch (err) {
		text = `Your browser couldn't be opened (${err.message}). Open this link to review ${what(newest)}: ${newest.url}`;
	}
	if (!others.length) return text;
	return [
		text,
		`This session has ${others.length === 1 ? "another open offer" : `${others.length} more open offers`}:`,
		...others.map((x) => `- ${what(x)}: ${x.url}`)
	].join("\n");
}
//#endregion
//#region src/expert-offer/main.ts
const { dir: claudeDir } = claudePaths(process.env, os.homedir());
process.stdout.write(await expertOffer({
	claudeDir,
	session: process.env.CLAUDE_CODE_SESSION_ID,
	open: (url) => openUrl(process.platform, url)
}) + "\n");
//#endregion
export {};
