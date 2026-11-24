// This user's processes, for the desktop app's window of what's running (#137) and for the runner's
// cleanup when a driven session is ended and removed (#144). Nothing here ends or signals a process.
//
// Windows: one hidden PowerShell call to Win32_Process (CIM), which needs no admin. It lists the
// processes in the app's own logon session whose command line it can read: another user's, or an
// elevated one's, can't be read without admin, so this stands in for an owner check, which
// Win32_Process's GetOwner makes too slow to run each refresh (seconds for fifty processes).
// Win32_Process doesn't say a process's working folder, so the same call reads it from each process's
// own memory (its PEB's ProcessParameters.CurrentDirectory, through NtQueryInformationProcess and
// ReadProcessMemory), which needs no admin for this user's own processes; one that can't be opened has
// none, and running.ts places it by its command line and the process tree. macOS: `ps -U <uid>` for the
// processes, and `lsof -d cwd` for each one's working folder, both this user's alone.
//
// Each process's ISOPLAN_SESSION, the marker the runner puts in a driven session's environment and
// every process under it inherits, even one whose parent has ended (session.ts): on Windows read from
// its own memory as its working folder is, on macOS from `ps -E`, which shows this user's processes'
// environments. A 32-bit (WOW64) process's, or one that can't be read, isn't: it has no `marker`.

import { execFile } from "node:child_process";
import { SESSION_MARKER } from "./claude.js";
import { parsePsInfo } from "./registry.js";

/** A process as the OS lists it. */
export interface Proc {
  pid: number;
  /** The process that started it, by pid; it may have ended, and its pid been reused. */
  ppid: number;
  name: string;
  command: string;
  /** When it started, in ms since the epoch. */
  startMs: number;
  /** Its memory in bytes: the working set on Windows, the resident size on macOS. */
  memory: number;
  /** Its working folder, where it can be read. */
  cwd?: string;
  /** Its ISOPLAN_SESSION: the driven session that started it; "" when its environment was read and has none. Absent when it couldn't be read. */
  marker?: string;
}

// A process's working folder on Windows, as a 64-bit process reads another's: PEB+0x20 is its
// ProcessParameters, and ProcessParameters+0x38 its CurrentDirectory, a UNICODE_STRING. A 32-bit
// (WOW64) process keeps its current folder in its 32-bit PEB, which ProcessWow64Information (26)
// names: PEB32+0x10 is its ProcessParameters, and ProcessParameters+0x24 its CurrentDirectory, a
// 32-bit UNICODE_STRING. Null when the process can't be opened or read.
export const CWD_HELPER = [
  "using System; using System.Runtime.InteropServices;",
  "public static class IsoplanCwd {",
  '[DllImport("kernel32.dll")] static extern IntPtr OpenProcess(int access, bool inherit, int pid);',
  '[DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);',
  '[DllImport("kernel32.dll")] static extern bool ReadProcessMemory(IntPtr h, IntPtr at, byte[] buffer, IntPtr size, out IntPtr read);',
  '[DllImport("ntdll.dll")] static extern int NtQueryInformationProcess(IntPtr h, int kind, IntPtr[] info, int size, out int length);',
  "static byte[] Read(IntPtr h, long at, int n) { var b = new byte[n]; IntPtr r; return ReadProcessMemory(h, new IntPtr(at), b, new IntPtr(n), out r) && r.ToInt64() == n ? b : null; }",
  "static string Text(IntPtr h, int n, long at) { if (n == 0) return null; var s = Read(h, at, n); return s == null ? null : System.Text.Encoding.Unicode.GetString(s); }",
  "public static string Of(int pid) {",
  "if (IntPtr.Size != 8) return null;",
  "IntPtr h = OpenProcess(0x0410, false, pid); if (h == IntPtr.Zero) return null;",
  "try {",
  "var info = new IntPtr[6]; int length;",
  "if (NtQueryInformationProcess(h, 26, info, 8, out length) == 0 && info[0] != IntPtr.Zero) {",
  "var p32 = Read(h, info[0].ToInt64() + 0x10, 4); if (p32 == null) return null;",
  "var u32 = Read(h, (long)BitConverter.ToUInt32(p32, 0) + 0x24, 8); if (u32 == null) return null;",
  "return Text(h, BitConverter.ToUInt16(u32, 0), BitConverter.ToUInt32(u32, 4)); }",
  "if (NtQueryInformationProcess(h, 0, info, 48, out length) != 0) return null;",
  "var p = Read(h, info[1].ToInt64() + 0x20, 8); if (p == null) return null;",
  "var u = Read(h, BitConverter.ToInt64(p, 0) + 0x38, 16); if (u == null) return null;",
  "return Text(h, BitConverter.ToUInt16(u, 0), BitConverter.ToInt64(u, 8));",
  "} finally { CloseHandle(h); } }",
  // Its ISOPLAN_SESSION, from its environment block: ProcessParameters+0x80 is the block, +0x3F0 its
  // size in bytes. "" when it has none; null for a 32-bit process, or one that can't be opened or read.
  // MarkerOf takes a handle opened with at least 0x0410 (query information, read memory), so strays.ts
  // can check a process and end it through one handle.
  "public static string Marker(int pid) {",
  "if (IntPtr.Size != 8) return null;",
  "IntPtr h = OpenProcess(0x0410, false, pid); if (h == IntPtr.Zero) return null;",
  "try { return MarkerOf(h); } finally { CloseHandle(h); } }",
  "public static string MarkerOf(IntPtr h) {",
  "if (IntPtr.Size != 8) return null;",
  "var info = new IntPtr[6]; int length;",
  "if (NtQueryInformationProcess(h, 26, info, 8, out length) != 0 || info[0] != IntPtr.Zero) return null;",
  "if (NtQueryInformationProcess(h, 0, info, 48, out length) != 0) return null;",
  "var p = Read(h, info[1].ToInt64() + 0x20, 8); if (p == null) return null;",
  "long pp = BitConverter.ToInt64(p, 0);",
  "var at = Read(h, pp + 0x80, 8); var n = Read(h, pp + 0x3F0, 8); if (at == null || n == null) return null;",
  "long size = BitConverter.ToInt64(n, 0); if (size <= 0 || size > 1048576) return null;",
  "var env = Text(h, (int)size, BitConverter.ToInt64(at, 0)); if (env == null) return null;",
  `foreach (var v in env.Split((char)0)) if (v.StartsWith("${SESSION_MARKER}=", StringComparison.Ordinal)) return v.Substring(${SESSION_MARKER.length + 1});`,
  'return "";',
  "} }",
].join(" ");

const WINDOWS_SCRIPT = [
  "[Console]::OutputEncoding = [Text.Encoding]::UTF8",
  `Add-Type -TypeDefinition '${CWD_HELPER}'`,
  '$s = (Get-CimInstance Win32_Process -Filter "ProcessId = $PID").SessionId',
  '$list = @(Get-CimInstance Win32_Process -Filter "SessionId = $s" | Where-Object { $_.CommandLine } | ForEach-Object { [pscustomobject]@{ pid = $_.ProcessId; ppid = $_.ParentProcessId; name = $_.Name; command = $_.CommandLine; start = $(if ($_.CreationDate) { [DateTimeOffset]::new($_.CreationDate).ToUnixTimeMilliseconds() } else { 0 }); memory = $_.WorkingSetSize; cwd = [IsoplanCwd]::Of([int]$_.ProcessId); marker = [IsoplanCwd]::Marker([int]$_.ProcessId) } })',
  "ConvertTo-Json -InputObject $list -Compress -Depth 2",
].join("; ");

/** The hidden commands that list this user's processes, each `[file, ...args]`. */
export function listCommands(platform: NodeJS.Platform, uid: number): { ps: string[]; names?: string[]; cwd?: string[]; env?: string[] } {
  if (platform === "win32") return { ps: ["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", WINDOWS_SCRIPT] };
  const user = String(uid);
  return {
    ps: ["ps", "-x", "-U", user, "-o", "pid=,ppid=,rss=,etime=,command="],
    // comm last, as it may hold spaces.
    names: ["ps", "-x", "-U", user, "-o", "pid=,comm="],
    cwd: ["lsof", "-a", "-d", "cwd", "-u", user, "-Fn", "-w"],
    // Each command line followed by its environment.
    env: ["ps", "-x", "-E", "-ww", "-U", user, "-o", "pid=,command="],
  };
}

/** PowerShell's answer: a JSON list of { pid, ppid, name, command, start, memory, cwd, marker }; cwd and marker null where they couldn't be read. */
export function parseWindowsList(stdout: string): Proc[] | null {
  let value: unknown;
  try {
    value = JSON.parse(stdout.trim() || "[]");
  } catch {
    return null;
  }
  if (!Array.isArray(value)) return null;
  return value.flatMap((p: Record<string, unknown>) =>
    Number.isSafeInteger(p?.pid) && typeof p.command === "string"
      ? [{ pid: p.pid as number, ppid: Number(p.ppid) || 0, name: String(p.name ?? ""), command: p.command, startMs: Number(p.start) || 0, memory: Number(p.memory) || 0, ...(typeof p.cwd === "string" && p.cwd && { cwd: p.cwd.length > 3 ? p.cwd.replace(/[\\/]+$/, "") : p.cwd }), ...(typeof p.marker === "string" && { marker: p.marker }) }]
      : [],
  );
}

/** ps's answer: pid, ppid, resident size in KB, `[[dd-]hh:]mm:ss` since it started, then its command line. */
export function parsePsList(stdout: string, now: number): Proc[] {
  return stdout.split(/\r?\n/).flatMap((line) => {
    const m = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+\s+.*)$/.exec(line);
    const info = m && parsePsInfo(m[4]!, now);
    if (!m || !info) return [];
    return [{ pid: Number(m[1]), ppid: Number(m[2]), name: "", command: info.command, startMs: info.startMs, memory: Number(m[3]) * 1024 }];
  });
}

/** `ps -o pid=,comm=`'s answer: each pid's executable, as its last path segment. */
export function parsePsNames(stdout: string): Map<number, string> {
  const names = new Map<number, string>();
  for (const line of stdout.split(/\r?\n/)) {
    const m = /^\s*(\d+)\s+(.+?)\s*$/.exec(line);
    if (m) names.set(Number(m[1]), m[2]!.slice(m[2]!.lastIndexOf("/") + 1));
  }
  return names;
}

/** `lsof -d cwd -Fn`'s answer: `p<pid>` then `n<folder>` (with `f` lines between), per process. */
export function parseLsofCwd(stdout: string): Map<number, string> {
  const cwd = new Map<number, string>();
  let pid: number | null = null;
  for (const line of stdout.split(/\r?\n/)) {
    if (line.startsWith("p")) pid = Number(line.slice(1)) || null;
    else if (line.startsWith("n") && pid !== null) cwd.set(pid, line.slice(1));
  }
  return cwd;
}

/**
 * Each process's ISOPLAN_SESSION from `ps -E -o pid=,command=`, whose command column is the command
 * line, a space, then the environment: read only after the command line `commands` gives it, so a
 * command line can't pass for an environment. "" when it has none; a process whose line doesn't start
 * with its command line has none listed.
 */
export function parsePsMarkers(stdout: string, commands: Map<number, string>): Map<number, string> {
  const markers = new Map<number, string>();
  const marked = new RegExp(`(?:^|\\s)${SESSION_MARKER}=(\\S*)`);
  for (const line of stdout.split(/\r?\n/)) {
    const m = /^\s*(\d+)\s+(.*)$/.exec(line);
    const command = m ? commands.get(Number(m[1])) : undefined;
    if (!m || command === undefined || !m[2]!.startsWith(command)) continue;
    markers.set(Number(m[1]), marked.exec(m[2]!.slice(command.length))?.[1] ?? "");
  }
  return markers;
}

/** What a command wrote to stdout; `allowFail` keeps what it wrote when it exits with an error (lsof does, for a process it can't look into). */
export type Run = (argv: string[], allowFail?: boolean) => Promise<string | null>;

// Shorter than the window's wait for an answer (REQUEST_MS in running/App.vue), so a slow listing is
// given up before the window gives up on the answer.
const LIST_TIMEOUT_MS = 10000;

export const runHidden: Run = (argv, allowFail = false) => {
  const [file, ...args] = argv;
  return new Promise((resolve) => {
    execFile(file!, args, { windowsHide: true, timeout: LIST_TIMEOUT_MS, maxBuffer: 32 * 1024 * 1024, env: { ...process.env, LC_ALL: "C" } }, (err, stdout) => resolve(err && !(allowFail && stdout) ? null : stdout));
  });
};

/** This user's processes now, or null when the OS couldn't be asked. */
export async function listProcesses({ platform = process.platform, uid = process.getuid?.() ?? -1, run = runHidden, now = Date.now }: { platform?: NodeJS.Platform; uid?: number; run?: Run; now?: () => number } = {}): Promise<Proc[] | null> {
  const commands = listCommands(platform, uid);
  if (platform === "win32") {
    const out = await run(commands.ps);
    return out === null ? null : parseWindowsList(out);
  }
  const [out, names, cwd, env] = await Promise.all([run(commands.ps), run(commands.names!), run(commands.cwd!, true), run(commands.env!)]);
  if (out === null) return null;
  const nameOf = parsePsNames(names ?? "");
  const cwdOf = parseLsofCwd(cwd ?? "");
  const list = parsePsList(out, now());
  const markerOf = parsePsMarkers(env ?? "", new Map(list.map((p) => [p.pid, p.command])));
  return list.map((p) => {
    const folder = cwdOf.get(p.pid);
    const marker = markerOf.get(p.pid);
    return { ...p, name: nameOf.get(p.pid) ?? p.command.split(" ")[0]!.split("/").pop()!, ...(folder && { cwd: folder }), ...(marker !== undefined && { marker }) };
  });
}

/**
 * The absolute paths in a command line: quoted or not, and after a flag's `=`. On Windows only a
 * drive's paths, with Git Bash's `/c/...` read as `C:/...`, so cmd's `/c` and `/d` aren't taken for paths.
 */
export function commandPaths(command: string, platform: NodeJS.Platform = process.platform): string[] {
  const asPath = (t: string): string | null => {
    const clean = t.replace(/[;,]+$/, "");
    if (platform !== "win32") return clean.startsWith("/") ? clean : null;
    const bash = /^\/([A-Za-z])(\/.*)$/.exec(clean);
    return bash ? `${bash[1]!.toUpperCase()}:${bash[2]}` : /^[A-Za-z]:[\\/]/.test(clean) ? clean : null;
  };
  const out: string[] = [];
  for (const m of command.matchAll(/(?:"[^"]*"|'[^']*'|[^\s"'])+/g)) {
    const token = m[0].replace(/["']/g, "");
    // A quoted path keeps its spaces; a quoted command (cmd /c "...") is read word by word, and so are
    // the words after the first of one that starts with a path ("C:\tools\bash.exe -c C:\w\x").
    const whole = asPath(token) !== null || asPath(token.slice(token.indexOf("=") + 1)) !== null;
    const words = whole ? [token, ...token.split(/\s+/).slice(1)] : token.split(/\s+/);
    for (const word of words) {
      for (const t of [word, word.slice(word.indexOf("=") + 1)]) {
        const p = asPath(t);
        if (p !== null && !out.includes(p)) out.push(p);
      }
    }
  }
  return out;
}
