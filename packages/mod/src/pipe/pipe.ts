// The local pipe between the machine's runner and the sessions' hooks modules (ADR 0007 step 2):
// one per user per machine, served by the runner's worker (server.ts). On Windows it is a named
// pipe, on macOS and Linux a Unix socket in a folder only this user can open, <claude dir>/isoplan/
// pipe/; either way its name is new for each worker, so a worker that stops never takes the next
// one's away. The worker writes where it is, with a token it makes as it starts, to <claude dir>/
// isoplan/runner/pipe.json, which only this user can read (the user's own profile on Windows, mode
// 0600 elsewhere), and every message to the runner carries that token, so a process of another
// user can't use the runner's pipe.
//
// On Windows any user can list pipe names, and can make a pipe under a name pipe.json still names
// once its worker has gone (Windows lets other users only read the runner's own pipe, not write to
// it). So the runner proves it knows the token before it is sent anything: a client's first line is
// a `hi` with a new nonce, the runner answers with the nonce's HMAC under the token (`proof`), and a
// client drops a pipe that doesn't (openPipe).
//
// Each side writes one JSON object per line. A hooks module's end (client.ts, `dist/pipe.js`) says
// hello for its session and is sent that session's lines (src/lines.ts); the ask_earlier_session script
// (src/ask/main.ts) asks once and is sent the answer; the desktop app (packages/app) asks the runner
// to close one of its own headless sessions (`close`, closeSession), and with `remove` to remove it
// too (#129), and is told whether it did. A runner from before `remove` ignores it and only closes.

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import fs from "node:fs/promises";
import net, { type Socket } from "node:net";
import path from "node:path";

/** What a hooks module's end says as it connects: the session it is for, and how its hooks module runs. */
export interface PipeHello {
  type: "hello";
  v: 1;
  token: string;
  session: string;
  /** The session's folder. */
  cwd: string;
  /** When the hooks module started, in ms: of one version, the later window's keeps the session. */
  since: number;
  /** The hooks module can submit a prompt, so the session takes messages from the floor. */
  messages: boolean;
  /** The hooks module can end the running turn; absent from an earlier version's. */
  endsTurns?: boolean;
  /** The plugin's folder the hooks module runs from, and its version. */
  root: string;
  version: string;
  /** The variables of the session's own environment the runner reports it by (SESSION_ENV). */
  env?: Record<string, string>;
}

/** What the ask_earlier_session script sends: a question for the room, or that the agent was shown one's end (`ack`). */
export interface PipeAsk {
  type: "ask";
  v: 1;
  token: string;
  session: string;
  cwd: string;
  /** The office servers that gave the session its rights. */
  servers: string[];
  key?: string;
  question?: string;
  ack?: string;
}

/** What the desktop app sends: close the runner's headless session that status.json names by `close`. */
export interface PipeClose {
  type: "close";
  v: 1;
  token: string;
  close: string;
  /** End and remove: the runner forgets the session, so it is never opened again. */
  remove?: true;
}

/** The runner's one answer to a close: true when it closed the session (its process ended, or it had none running), false when it didn't. */
export interface PipeClosed {
  type: "closed";
  closed: boolean;
}

/** A client's first line: a nonce for the runner to prove it knows the token with. */
export interface PipeHi {
  type: "hi";
  v: 1;
  nonce: string;
}

/** The runner's answer to a hi: the nonce's HMAC under the token. */
export interface PipeProof {
  type: "proof";
  proof: string;
}

/** The runner's one answer to an ask: what the agent is told. */
export interface PipeAnswer {
  type: "answer";
  text: string;
}

/** Where the worker's pipe is, as pipe.json holds it. */
export interface PipeInfo {
  address: string;
  token: string;
}

export const pipeInfoPath = (claudeDir: string) => path.join(claudeDir, "isoplan", "runner", "pipe.json");

/** A new address for a worker's pipe, its name random: a named pipe on Windows, else a socket in this user's own folder. */
export function pipeAddress(claudeDir: string, platform: NodeJS.Platform = process.platform, random = () => randomBytes(8).toString("hex")): string {
  if (platform === "win32") return `\\\\.\\pipe\\isoplan-runner-${random()}`;
  return path.posix.join(claudeDir.replace(/\\/g, "/"), "isoplan", "pipe", `runner-${random()}.sock`);
}

export const newToken = () => randomBytes(32).toString("hex");
export const newNonce = () => randomBytes(16).toString("hex");
export const proofOf = (token: string, nonce: string) => createHmac("sha256", token).update(nonce).digest("hex");

/** Makes the socket's folder, this user's alone (none on Windows). */
export async function preparePipe(address: string, platform: NodeJS.Platform = process.platform): Promise<void> {
  if (platform === "win32") return;
  const dir = path.dirname(address);
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  await fs.chmod(dir, 0o700);
}

/** The variables of a session's environment its hooks module's end passes on, which the runner reports that session by (report-session.ts). */
export const SESSION_ENV = ["CLAUDE_CODE_PLUGIN_CACHE_DIR", "CLAUDE_CODE_PLUGIN_DIRS", "DISABLE_UPDATES", "DISABLE_AUTOUPDATER", "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC", "FORCE_AUTOUPDATE_PLUGINS"] as const;

/** Those of SESSION_ENV that `env` sets. */
export const sessionEnv = (env: Record<string, unknown>): Record<string, string> =>
  Object.fromEntries(SESSION_ENV.flatMap((name) => (typeof env[name] === "string" ? [[name, env[name] as string]] : [])));

/** Writes pipe.json whole (a reader never sees half of it), readable by this user alone. */
export async function writePipeInfo(claudeDir: string, info: PipeInfo): Promise<void> {
  const file = pipeInfoPath(claudeDir);
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(temp, JSON.stringify(info) + "\n", { mode: 0o600 });
  await fs.rename(temp, file);
}

export async function readPipeInfo(claudeDir: string): Promise<PipeInfo | null> {
  try {
    const { address, token } = JSON.parse(await fs.readFile(pipeInfoPath(claudeDir), "utf8")) as Partial<PipeInfo>;
    return typeof address === "string" && typeof token === "string" ? { address, token } : null;
  } catch {
    return null;
  }
}

// How long a client waits for the runner's proof; the runner answers at once.
const PROOF_WAIT_MS = 5000;

/**
 * Connects to the pipe at `info.address` and has the runner prove it knows the token (see above).
 * Resolves the socket once it has, with every later line given to `onLine`; null when the pipe
 * can't be reached or doesn't prove it, and then nothing of the client's went to it.
 */
export function openPipe(info: PipeInfo, onLine: (value: unknown) => void): Promise<Socket | null> {
  return new Promise((resolve) => {
    const nonce = newNonce();
    const want = Buffer.from(proofOf(info.token, nonce));
    let proven = false;
    const socket = net.connect(info.address);
    const fail = () => {
      clearTimeout(timer);
      socket.destroy();
      resolve(null);
    };
    const timer = setTimeout(fail, PROOF_WAIT_MS);
    socket.once("connect", () => writeLine(socket, { type: "hi", v: 1, nonce } satisfies PipeHi));
    socket.on("error", () => {}).once("close", () => proven || fail());
    readLines(socket, (value) => {
      if (proven) return onLine(value);
      const said = value as Partial<PipeProof> | null;
      const proof = said?.type === "proof" ? said.proof : undefined;
      if (typeof proof !== "string" || Buffer.byteLength(proof) !== want.length || !timingSafeEqual(Buffer.from(proof), want)) return fail();
      proven = true;
      clearTimeout(timer);
      resolve(socket);
    });
  });
}

/**
 * Asks the worker whose pipe pipe.json names to close its headless session `close` (status.ts): true
 * once it closed it, false when the worker didn't, null when the pipe can't be reached, and "no answer"
 * when the worker went, or didn't answer within `waitMs`, after it was asked.
 */
export async function closeSession(claudeDir: string, close: string, waitMs: number, remove = false, readInfo: (claudeDir: string) => Promise<PipeInfo | null> = readPipeInfo): Promise<boolean | null | "no answer"> {
  const info = await readInfo(claudeDir);
  if (!info) return null;
  let answer: boolean | "no answer" = "no answer";
  const socket = await openPipe(info, (value) => {
    const said = value as Partial<PipeClosed> | null;
    if (said?.type === "closed" && typeof said.closed === "boolean") answer = said.closed;
  });
  if (!socket) return null;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => (socket.destroy(), resolve()), waitMs);
    socket.on("close", () => (clearTimeout(timer), resolve()));
    writeLine(socket, { type: "close", v: 1, token: info.token, close, ...(remove ? { remove: true as const } : {}) } satisfies PipeClose);
  });
  return answer;
}

/** Calls `onLine` with each whole line that comes in on `socket`, parsed; a line that isn't JSON is passed over. */
export function readLines(socket: Socket, onLine: (value: unknown) => void, maxBytes = 1 << 20): void {
  let buffer = "";
  socket.setEncoding("utf8").on("data", (piece: string) => {
    buffer += piece;
    let nl;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const text = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!text) continue;
      let value: unknown;
      try {
        value = JSON.parse(text);
      } catch {
        continue;
      }
      onLine(value);
    }
    // A line this long is no line of ours.
    if (buffer.length > maxBytes) socket.destroy();
  });
}

export const writeLine = (socket: Socket, value: unknown) => {
  if (!socket.destroyed && socket.writable) socket.write(JSON.stringify(value) + "\n");
};
