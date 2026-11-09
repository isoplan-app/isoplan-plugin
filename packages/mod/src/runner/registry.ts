// The process registry (#41, design R1 and R4): <claude dir>/isoplan/runner/processes.json, this machine's
// one record of the processes Isoplan's runner started that may still be running, and of the
// sessions driven from the floor that it may open again. Only the runner's worker writes it; a
// separate app may read it (R4), so its format is stable and has a version:
//
//   {
//     "about": "...",
//     "version": 1,
//     "runner": <pid of the worker that wrote it>,
//     "written": "<ISO time>",
//     "processes": [
//       {
//         "kind": "driven" | "fork" | "desktop-read",
//         "pid": <pid> | null,         null: a driven session with no process now
//         "spawned": "<ISO time>" | null,   when the runner started that pid
//         "session": "claude-code:<uuid>",
//         "folder": "<the folder it runs in>",
//         "started": "<ISO time>",     when Isoplan first started a process for it
//         "lastActivity": "<ISO time>",
//         "state": "working" | "idle" | "closed",
//         "driven": { "room", "project", "office", "owner", "permissions", "asked"?, "transcript", "addDir"?, "name"?, "named"? }   driven only
//       }
//     ]
//   }
//
// `driven` (a session driven from the floor, session.ts), `fork` (a fork of a room's lead answering a
// question or writing a brief, claude.ts) and `desktop-read` (a take into the Claude app reading the
// brief, handoff/take.ts). A fork or a first turn is there while it runs; a driven session stays
// after its process ends (closed when idle, stopped, crashed, or ended at a restart), for the next
// instruction to open again, until it is handed back, its saved conversation is found gone, or it is
// past the MAX_HOLDING sessions kept (the least recently active go first).
//
// A pid alone doesn't name a process: after a reboot, or long enough, another process may have it.
// So a process counts as Isoplan's only while its pid is alive, the OS says it started within
// SPAWN_MATCH_MS of the `spawned` time recorded, and its command line names the session's uuid
// (every one of these runs `claude ... --resume <uuid>` or `--session-id <uuid>`). Nothing else is
// ever ended. On Windows the OS is asked through PowerShell's Win32_Process (hidden); elsewhere
// through `ps -o etime= -o command=`.
//
// At its start the worker reads the file (`restore`), which it does only under the runner's lock,
// as the supervisor took it: each recorded process that is still Isoplan's is ended with its process
// tree (a fork or a first turn whose runner is gone has no one to answer to; a driven session's
// process is ended so this runner can hold it), driven sessions are kept with no process, to be
// opened again with --resume, and the rest is dropped. Every write goes to a file beside it, then is
// renamed over it, so a reader never sees half a file. As the worker exits it writes, at once, that
// none of its processes runs any more (`closeSync`).

import { execFile, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import type { DrivePermissions } from "@isoplan/protocol";
import { alive } from "../wake/lock.js";
import { killPid, type Track } from "./claude.js";

export const REGISTRY_VERSION = 1;

export const registryPath = (claudeDir: string) => path.join(claudeDir, "isoplan", "runner", "processes.json");

const ABOUT = "The processes Isoplan's runner started on this machine that may still run, and the sessions driven from the floor it may open again. Written by the runner alone; the format is in the Isoplan plugin's README.";

/** How close the OS's start time of a pid must be to the recorded `spawned` time for it to count as that process. */
export const SPAWN_MATCH_MS = 15000;

// A write only for `lastActivity` waits until the last write is this old.
const TOUCH_SAVE_MS = 10000;

export type ProcessKind = "driven" | "fork" | "desktop-read";

/** What only a driven session's record has. */
export interface DrivenFields {
  room: string;
  /** The project's id, lower-cased: the per-project cap counts by it. */
  project: string;
  /** The office server it was started through, which alone may act on it. */
  office: string;
  /** The account id of the person who started it. */
  owner: string;
  /** The permission mode its process runs in, or last ran in. */
  permissions: DrivePermissions;
  /** The mode its person asked for, which it opens in again only where its office's drive-policy allows it; a record from before has none, and asked for `permissions`. */
  asked?: DrivePermissions;
  /** Whether a turn has ended in it, so Claude Code has saved its transcript: it opens again with --resume (as it does whenever the transcript is found), not --session-id. */
  transcript: boolean;
  /** A folder outside `folder` the session reads (a driven take's brief), passed as --add-dir. */
  addDir?: string;
  /** The session's name: a take's, or the one written from its first instruction (`named`). */
  name?: string;
  /** The runner wrote `name` from the session's first instruction (naming.ts), so its data layer gives it to the floor as the session's title. */
  named?: true;
}

export interface ProcessRecord {
  kind: ProcessKind;
  pid: number | null;
  spawned: string | null;
  session: string;
  folder: string;
  started: string;
  lastActivity: string;
  state: "working" | "idle" | "closed";
  driven?: DrivenFields;
}

/** What the OS says of a running process: when it started, in ms since the epoch, and its command line. */
export interface ProcessInfo {
  startMs: number;
  command: string;
}

/** The command that asks the OS about `pid`, hidden: PowerShell on Windows, ps elsewhere. */
export function infoCommand(pid: number, platform: NodeJS.Platform): string[] {
  if (platform === "win32") {
    const script = `$p = Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}"; if ($p) { [DateTimeOffset]::new($p.CreationDate).ToUnixTimeMilliseconds(); $p.CommandLine }`;
    return ["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", script];
  }
  return ["ps", "-o", "etime=", "-o", "command=", "-p", String(pid)];
}

/** PowerShell's answer: the start time in ms on the first line, the command line after it. */
export function parseWindowsInfo(stdout: string): ProcessInfo | null {
  const [first, ...rest] = stdout.trim().split(/\r?\n/);
  const startMs = Number(first?.trim());
  return first && Number.isFinite(startMs) && startMs > 0 ? { startMs, command: rest.join("\n").trim() } : null;
}

/** ps's answer: `[[dd-]hh:]mm:ss` since the process started, then its command line. */
export function parsePsInfo(stdout: string, now: number): ProcessInfo | null {
  const m = /^\s*(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)\s+(.*)$/s.exec(stdout.trim());
  if (!m) return null;
  const [, days, hours, minutes, seconds, command] = m;
  const elapsed = ((Number(days ?? 0) * 24 + Number(hours ?? 0)) * 60 + Number(minutes)) * 60 + Number(seconds);
  return { startMs: now - elapsed * 1000, command: command!.trim() };
}

/** What the OS says of `pid` now, or null when it can't say (gone, or the command failed). */
export function processInfo(pid: number, platform: NodeJS.Platform = process.platform, now = Date.now): Promise<ProcessInfo | null> {
  const [cmd, ...args] = infoCommand(pid, platform);
  return new Promise((resolve) => {
    execFile(cmd!, args, { windowsHide: true, timeout: 15000, env: platform === "win32" ? process.env : { ...process.env, LC_ALL: "C" } }, (err, stdout) => {
      if (err) return resolve(null);
      resolve(platform === "win32" ? parseWindowsInfo(stdout) : parsePsInfo(stdout, now()));
    });
  });
}

const uuidOf = (session: string) => session.slice(session.indexOf(":") + 1);

/** Whether `info`, what the OS says of the record's pid, shows the process is the one the record names. */
export function isOurs(record: Pick<ProcessRecord, "spawned" | "session">, info: ProcessInfo | null): boolean {
  if (!info || !record.spawned) return false;
  const spawned = Date.parse(record.spawned);
  const uuid = uuidOf(record.session);
  return Number.isFinite(spawned) && Math.abs(info.startMs - spawned) <= SPAWN_MATCH_MS && uuid.length >= 8 && info.command.includes(uuid);
}

export interface RegistryOptions {
  file: string;
  log: (text: string) => void;
  /** The worker's pid, written into the file. */
  pid?: number;
  isAlive?: (pid: number) => boolean;
  info?: (pid: number) => Promise<ProcessInfo | null>;
  kill?: (pid: number) => void;
  now?: () => number;
}

export interface Registry {
  /** The records now, copied. */
  list(): ProcessRecord[];
  /** Adds the driven session's record, or replaces it, and writes the file. */
  put(record: ProcessRecord): void;
  /** Moves the driven session's `lastActivity` on, writing the file only when the last write is TOUCH_SAVE_MS old. */
  touch(session: string, at: number): void;
  /** Takes the driven session's record out. */
  remove(session: string): void;
  /** Records a fork or a first turn while it runs: in now, out once it closes. */
  track: Track;
  /** Ends what an earlier run left that is verifiably Isoplan's, and keeps its driven sessions with no process. */
  restore(): Promise<void>;
  /** Writes, at once, that none of this worker's processes runs any more, as it exits. */
  closeSync(): void;
  /** Resolves once every write asked for so far is done. */
  flushed(): Promise<void>;
}

const keyOf = (r: Pick<ProcessRecord, "kind" | "session" | "pid">) => (r.kind === "driven" ? `driven ${r.session}` : `${r.kind} ${r.pid}`);

/** The records in the file's text, or null when it isn't a registry this version reads. */
export function parseRegistry(text: string): ProcessRecord[] | null {
  try {
    const value = JSON.parse(text) as { version?: unknown; processes?: unknown };
    if (value?.version !== REGISTRY_VERSION || !Array.isArray(value.processes)) return null;
    return (value.processes as ProcessRecord[]).filter(
      (r) => r && ["driven", "fork", "desktop-read"].includes(r.kind) && typeof r.session === "string" && typeof r.folder === "string" && (r.pid === null || Number.isSafeInteger(r.pid)) && (r.kind !== "driven" || (r.driven && typeof r.driven.office === "string")),
    );
  } catch {
    return null;
  }
}

/** The name the runner wrote for the driven session `session` (`claude-code:<uuid>`) from its first instruction, as the registry at `file` keeps it; null with none. */
export async function drivenName(file: string, session: string): Promise<string | null> {
  const records = parseRegistry(await fsp.readFile(file, "utf8").catch(() => ""));
  const d = records?.find((r) => r.kind === "driven" && r.session === session)?.driven;
  return d?.named === true && typeof d.name === "string" && d.name ? d.name : null;
}

export function createRegistry({ file, log, pid = process.pid, isAlive = alive, info = (p) => processInfo(p), kill = (p) => killPid(p), now = Date.now }: RegistryOptions): Registry {
  const records = new Map<string, ProcessRecord>();
  let writing: Promise<void> = Promise.resolve();
  let queued = false;
  let savedAt = -Infinity;

  const text = () => JSON.stringify({ about: ABOUT, version: REGISTRY_VERSION, runner: pid, written: new Date(now()).toISOString(), processes: [...records.values()] }, null, 2) + "\n";

  // One write at a time, each of the records as they are when it starts: writes asked for while one
  // waits its turn are that one.
  function save(): Promise<void> {
    savedAt = now();
    if (queued) return writing;
    queued = true;
    writing = writing
      .then(async () => {
        queued = false;
        await fsp.mkdir(path.dirname(file), { recursive: true });
        const temp = `${file}.${pid}.tmp`;
        await fsp.writeFile(temp, text());
        // On Windows a reader that has the file open makes the rename fail for a moment.
        for (let tries = 0; ; tries++) {
          try {
            await fsp.rename(temp, file);
            return;
          } catch (err) {
            if (tries >= 5 || !["EPERM", "EBUSY", "EACCES"].includes((err as NodeJS.ErrnoException).code ?? "")) throw err;
            await new Promise((r) => setTimeout(r, 50 * (tries + 1)));
          }
        }
      })
      .catch((err: Error) => log(`couldn't write the process registry ${file}: ${err.message}`));
    return writing;
  }

  return {
    list: () => [...records.values()].map((r) => ({ ...r, ...(r.driven ? { driven: { ...r.driven } } : {}) })),
    put(record) {
      records.set(keyOf(record), { ...record });
      void save();
    },
    touch(session, at) {
      const r = records.get(`driven ${session}`);
      if (!r) return;
      r.lastActivity = new Date(at).toISOString();
      if (now() - savedAt >= TOUCH_SAVE_MS) void save();
    },
    remove(session) {
      if (records.delete(`driven ${session}`)) void save();
    },
    track(child, { kind, session, folder }) {
      if (child.pid === undefined) return;
      const at = new Date(now()).toISOString();
      const record: ProcessRecord = { kind, pid: child.pid, spawned: at, session, folder, started: at, lastActivity: at, state: "working" };
      const key = keyOf(record);
      records.set(key, record);
      void save();
      (child as ChildProcess).once("close", () => {
        if (records.get(key) === record && records.delete(key)) void save();
      });
    },
    async restore() {
      const found = await fsp.readFile(file, "utf8").then(parseRegistry, (err: NodeJS.ErrnoException) => (err.code === "ENOENT" ? [] : null));
      if (found === null) {
        log(`the process registry ${file} couldn't be read, or is of another version, so nothing in it was ended or kept; it is written anew`);
        await save();
        return;
      }
      for (const r of found) {
        if (r.pid !== null && isAlive(r.pid)) {
          if (isOurs(r, await info(r.pid))) {
            log(`ended ${r.kind} process ${r.pid} of ${r.session}, which an earlier run of the runner left`);
            try {
              kill(r.pid);
            } catch {
              // Gone since.
            }
          } else log(`left process ${r.pid} running: the registry names it for ${r.session}, but it can't be shown to be the one Isoplan started`);
        }
        if (r.kind !== "driven") continue;
        records.set(keyOf(r), { ...r, pid: null, spawned: null, state: "closed" });
      }
      await save();
    },
    closeSync() {
      for (const [key, r] of records) {
        if (r.kind === "driven") records.set(key, { ...r, pid: null, spawned: null, state: "closed" });
        else records.delete(key);
      }
      // Never makes the folder: one an uninstall took away as the worker exited stays gone. Its own
      // file beside it, so a save still writing on another thread can't be mixed into it.
      try {
        const temp = `${file}.${pid}.exit.tmp`;
        fs.writeFileSync(temp, text());
        fs.renameSync(temp, file);
      } catch {
        // The next start finds the pids gone, or not Isoplan's, and ends nothing.
      }
    },
    flushed: () => writing,
  };
}
