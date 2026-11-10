// This user's processes, for the window of what's running (#137): read-only, and only while that
// window is open and asks. Nothing here ends or signals a process.
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

import { execFile } from "node:child_process";
import { parsePsInfo } from "../../../mod/src/runner/registry.js";

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
}

// A process's working folder on Windows, as a 64-bit process reads another's: PEB+0x20 is its
// ProcessParameters, and ProcessParameters+0x38 its CurrentDirectory, a UNICODE_STRING. Null when the
// process can't be opened or read.
const CWD_HELPER = [
  "using System; using System.Runtime.InteropServices;",
  "public static class IsoplanCwd {",
  '[DllImport("kernel32.dll")] static extern IntPtr OpenProcess(int access, bool inherit, int pid);',
  '[DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);',
  '[DllImport("kernel32.dll")] static extern bool ReadProcessMemory(IntPtr h, IntPtr at, byte[] buffer, IntPtr size, out IntPtr read);',
  '[DllImport("ntdll.dll")] static extern int NtQueryInformationProcess(IntPtr h, int kind, IntPtr[] info, int size, out int length);',
  "static byte[] Read(IntPtr h, long at, int n) { var b = new byte[n]; IntPtr r; return ReadProcessMemory(h, new IntPtr(at), b, new IntPtr(n), out r) && r.ToInt64() == n ? b : null; }",
  "public static string Of(int pid) {",
  "if (IntPtr.Size != 8) return null;",
  "IntPtr h = OpenProcess(0x0410, false, pid); if (h == IntPtr.Zero) return null;",
  "try {",
  "var info = new IntPtr[6]; int length; if (NtQueryInformationProcess(h, 0, info, 48, out length) != 0) return null;",
  "var p = Read(h, info[1].ToInt64() + 0x20, 8); if (p == null) return null;",
  "var u = Read(h, BitConverter.ToInt64(p, 0) + 0x38, 16); if (u == null) return null;",
  "int n = BitConverter.ToUInt16(u, 0); if (n == 0) return null;",
  "var s = Read(h, BitConverter.ToInt64(u, 8), n); return s == null ? null : System.Text.Encoding.Unicode.GetString(s);",
  "} finally { CloseHandle(h); } } }",
].join(" ");

const WINDOWS_SCRIPT = [
  "[Console]::OutputEncoding = [Text.Encoding]::UTF8",
  `Add-Type -TypeDefinition '${CWD_HELPER}'`,
  '$s = (Get-CimInstance Win32_Process -Filter "ProcessId = $PID").SessionId',
  '$list = @(Get-CimInstance Win32_Process -Filter "SessionId = $s" | Where-Object { $_.CommandLine } | ForEach-Object { [pscustomobject]@{ pid = $_.ProcessId; ppid = $_.ParentProcessId; name = $_.Name; command = $_.CommandLine; start = $(if ($_.CreationDate) { [DateTimeOffset]::new($_.CreationDate).ToUnixTimeMilliseconds() } else { 0 }); memory = $_.WorkingSetSize; cwd = [IsoplanCwd]::Of([int]$_.ProcessId) } })',
  "ConvertTo-Json -InputObject $list -Compress -Depth 2",
].join("; ");

/** The hidden commands that list this user's processes, each `[file, ...args]`. */
export function listCommands(platform: NodeJS.Platform, uid: number): { ps: string[]; names?: string[]; cwd?: string[] } {
  if (platform === "win32") return { ps: ["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", WINDOWS_SCRIPT] };
  const user = String(uid);
  return {
    ps: ["ps", "-x", "-U", user, "-o", "pid=,ppid=,rss=,etime=,command="],
    // comm last, as it may hold spaces.
    names: ["ps", "-x", "-U", user, "-o", "pid=,comm="],
    cwd: ["lsof", "-a", "-d", "cwd", "-u", user, "-Fn", "-w"],
  };
}

/** PowerShell's answer: a JSON list of { pid, ppid, name, command, start, memory, cwd }; cwd null where it couldn't be read. */
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
      ? [{ pid: p.pid as number, ppid: Number(p.ppid) || 0, name: String(p.name ?? ""), command: p.command, startMs: Number(p.start) || 0, memory: Number(p.memory) || 0, ...(typeof p.cwd === "string" && p.cwd && { cwd: p.cwd.length > 3 ? p.cwd.replace(/[\\/]+$/, "") : p.cwd }) }]
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
  const [out, names, cwd] = await Promise.all([run(commands.ps), run(commands.names!), run(commands.cwd!, true)]);
  if (out === null) return null;
  const nameOf = parsePsNames(names ?? "");
  const cwdOf = parseLsofCwd(cwd ?? "");
  return parsePsList(out, now()).map((p) => {
    const folder = cwdOf.get(p.pid);
    return { ...p, name: nameOf.get(p.pid) ?? p.command.split(" ")[0]!.split("/").pop()!, ...(folder && { cwd: folder }) };
  });
}
