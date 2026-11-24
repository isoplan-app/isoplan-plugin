// Running node with no window on Windows, for what Windows itself starts: an isoplan:// link
// (link-handler.ts) and the login item (login-item.ts). node.exe is a console program, so Windows
// gives it a console window of its own when it starts it straight from a registry command. Instead
// Windows starts wscript.exe, which has no console, on a small JScript file that starts node with
// window style 0 (hidden) and doesn't wait for it. Probed on Windows 11 (26200): node started that
// way ran with no window, saw the link it was given in its environment unchanged (`%41` stayed as
// it was), and wscript exited 0.
//
// The launcher is pure ASCII: wscript reads a .js file with no byte-order mark in the computer's
// ANSI code page, so a path such as C:\Users\José written as UTF-8 reaches node garbled. Probed on
// Windows 11 (26200), in a folder named "José 张": a launcher with the paths as raw UTF-8 started
// nothing, and wscript still exited 0; the same launcher with them as \uXXXX escapes ran.
//
// //E:JScript names the engine, which wscript otherwise picks by the file's extension, through the
// .js file association, which another program may have changed. Probed: a launcher with an
// extension that has no engine made wscript exit 1 and run nothing; the same file with //E:JScript ran.
//
// Windows Script Host can be turned off by policy, and wscript then shows a message instead of
// running anything, so `scriptHostOff` is checked each time, before a registration through it is
// kept or made. Where it is off, Windows starts conhost.exe instead, which is a windowed program and
// not a console one, so Windows gives it no console window, and with --headless it gives node a
// console of its own that has no window either (`headlessCommand`). That is how Windows's own
// pseudoconsoles (ConPTY) start it, since Windows 10 1809. Probed on Windows 11 (26300), started
// from a registered URL protocol: node ran with no window, where node started directly from the
// same protocol opened a Windows Terminal window. Through conhost the link reaches node on its
// command line, since there is no launcher to put it in node's environment.

import path from "node:path";
import type { Exec } from "../connect/dialog.js";

/** wscript.exe, by its full path, so no other program of that name is found first. */
export const wscriptPath = (env: Record<string, string | undefined> = process.env) => path.win32.join(env.SystemRoot || "C:\\Windows", "System32", "wscript.exe");

/** The command Windows runs: wscript in batch mode (no prompts, no logo), with the JScript engine, on `launcher`, then `args`. */
export const launchCommand = (launcher: string, args = "") => `"${wscriptPath()}" //B //NoLogo //E:JScript "${launcher}"${args ? ` ${args}` : ""}`;

/** The launcher `launchCommand` names in a command; null for any other command. */
export const launcherOf = (command: string | null) => (command ? (/^"[^"]+\\wscript\.exe" \/\/B \/\/NoLogo \/\/E:JScript "([^"]+)"/i.exec(command)?.[1] ?? null) : null);

/** A literal JScript and JSON both read: JSON, with every character outside printable ASCII as \uXXXX. */
const asciiLiteral = (value: unknown) => JSON.stringify(value).replace(/[^\x20-\x7e]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);

/**
 * The launcher: runs `"<node>" "<script>" <args>` hidden. With `link`, the link Windows gives it goes
 * to node in ISOPLAN_CONNECT_URL, never on a command line, as the Mac handler passes it.
 */
export function hiddenLauncher(node: string, script: string, { args = "", link = false }: { args?: string; link?: boolean } = {}): string {
  const command = `"${node}" "${script}"${args ? ` ${args}` : ""}`;
  return [
    "// Isoplan: starts node with no window. The plugin's install wrote this file; uninstall removes it.",
    `var isoplan = ${asciiLiteral({ node, script })};`,
    'var shell = new ActiveXObject("WScript.Shell");',
    ...(link ? ['shell.Environment("PROCESS")("ISOPLAN_CONNECT_URL") = WScript.Arguments(0);'] : []),
    `shell.Run(${asciiLiteral(command)}, 0, false);`,
    "",
  ].join("\r\n");
}

/** The node and script a launcher names, as hiddenLauncher writes them; null when it isn't one. */
export function launcherPaths(text: string | null): { node?: unknown; script?: unknown } | null {
  const line = text ? /^var isoplan = (.*);\r?$/m.exec(text)?.[1] : undefined;
  try {
    return line ? (JSON.parse(line) as { node?: unknown; script?: unknown }) : null;
  } catch {
    return null;
  }
}

/** conhost.exe, by its full path, so no other program of that name is found first. */
export const conhostPath = (env: Record<string, string | undefined> = process.env) => path.win32.join(env.SystemRoot || "C:\\Windows", "System32", "conhost.exe");

/** The command Windows runs where Script Host is off: conhost with no window, on `"<node>" "<script>" <args>`. */
export const headlessCommand = (node: string, script: string, args = "") => `"${conhostPath()}" --headless "${node}" "${script}"${args ? ` ${args}` : ""}`;

/** The node and script `headlessCommand` names in a command; null for any other command. */
export function headlessPaths(command: string | null): { node: string; script: string } | null {
  const m = command ? /^"[^"]+\\conhost\.exe" --headless "([^"]+)" "([^"]+)"/i.exec(command) : null;
  return m ? { node: m[1]!, script: m[2]! } : null;
}

const SCRIPT_HOST_KEYS = ["HKCU\\Software\\Microsoft\\Windows Script Host\\Settings", "HKLM\\Software\\Microsoft\\Windows Script Host\\Settings"];

/** Whether Windows Script Host is turned off for this person or this computer (`Enabled` set to 0). */
export async function scriptHostOff(run: Exec): Promise<boolean> {
  for (const key of SCRIPT_HOST_KEYS) {
    const value = /\bEnabled[ \t]+REG_\w+[ \t]+(\S+)/i.exec((await run("reg", ["query", key, "/v", "Enabled"])).stdout)?.[1];
    if (value !== undefined && /^(0|0x0+)$/i.test(value)) return true;
  }
  return false;
}
