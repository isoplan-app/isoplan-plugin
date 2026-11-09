// Pairing this machine with an office server that signs people in (isoplan-app/isoplan#23). What
// the machine reports belongs to the person who approves the pairing; the Claude account it names
// is only a label. Pairing happens on this machine, in its own browser:
//
// 1. A link the server refuses as `not-paired` or `pairing-ended` starts pairing. One process of
//    this Claude account on this machine does it at a time, holding <claude dir>/isoplan/pairing.lock
//    and keeping it fresh: it listens on a loopback callback, http://127.0.0.1:<port>/<nonce>, and
//    asks the server (POST <server>/pair) with that callback, the SHA-256 of a PKCE verifier it keeps,
//    and the machine's own random id (made once, kept in pairing.json), which tells two machines of
//    one name apart.
// 2. It shows the link it gets, `<office>/#pair=<code>`, as a `pair` line: the hooks module puts it
//    in the status line and, once per session start, in the transcript; the runner logs it. The other processes show the same link from the file. Nothing opens a
//    browser.
// 3. The person clicks it on this computer and approves it on the floor, and the browser is sent to
//    the callback with a one-time code. The callback swaps the code and the verifier for the
//    machine's credential (POST <server>/pair/token), and always answers the browser with a page
//    saying whether it worked.
// 4. The credential is swapped for an access token (POST <server>/token) that lasts about an hour,
//    sent in each hello, and renewed before it runs out or when the server says `token-expired`.
//    The renewal's answer names the email of the person the credential is paired to (`email`), kept
//    in the entry for the desktop app's menu; it goes to no office. A process that wants it (the
//    runner, `onEmail`) renews a token kept without one once, so a token renewed by an earlier version
//    names it too; it is told each time a renewal keeps an email or the email goes.
//
// The credential is dropped only when the server says the pairing has ended (`pairing-ended`, from
// a hello or a renewal). A `not-paired` refusal of a hello that carried a token means the server
// couldn't read it (a server older than the token, say): the credential is kept, and the link
// backs off. A credential or token is never sent over plain ws:// beyond this machine, unless
// config.json says `"allowPlainWs": true`.
//
// Everything is kept in <claude dir>/isoplan/pairing.json, readable by its owner only (on Windows
// it takes the folder's permissions): the machine's id, and one entry per Claude account and office
// server (#105). The entry of the server config.json's `server` names, which a version before #105
// reports to, is under `accounts`, where that version looks; every other server's is under
// `offices`, by its address, which is read first. Each server's pairing.lock is its own, in
// <claude dir>/isoplan/offices/<id>/, so pairing with one office never waits on another; the server
// config.json's `server` names keeps <claude dir>/isoplan/pairing.lock, which a version before #105
// takes for it. Every change to the file is read, decided and written under
// <claude dir>/isoplan/pairing.write.lock, so one process never undoes what another has just
// written. A server that signs nobody in never refuses, so nothing is paired. With no browser on the
// machine (a headless box) there is no way to pair yet.
//
// The floor's Connect Claude Code pairs without the link (src/connect): its own credential is kept
// here the same way (keepCredential), under the same machine id (machineIdOf) and locks.

import { randomBytes, createHash } from "node:crypto";
import fs from "node:fs/promises";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import type { DataLayerLine } from "../lines.js";
import { officeDir } from "./approved-file.js";
import { alive, refreshLock, releaseLock, takeLock } from "../wake/lock.js";

/** Renewed this long before it runs out. */
export const RENEW_EARLY_MS = 5 * 60 * 1000;
/** pairing.lock counts as free once not refreshed for this long, whatever pid it names. */
export const PAIRING_FRESH_MS = 60 * 1000;
const PAIRING_REFRESH_MS = 20 * 1000;
/** pairing.write.lock: free once this old, and waited for at most WRITE_WAIT_MS. */
const WRITE_FRESH_MS = 10 * 1000;
const WRITE_WAIT_MS = 10 * 1000;
/** How often the callback tries to write the credential it got before saying it couldn't. */
const WRITE_TRIES = 4;

/** One Claude account's pairing. */
export interface PairingEntry {
  /** The office server's data-layer address, as in config.json. */
  server: string;
  credential?: string;
  token?: string;
  /** Milliseconds since the epoch. */
  tokenExpires?: number;
  /** The email of the person the credential is paired to, as the server's last renewal said it; none from a server older than that. Never sent to any office. */
  email?: string;
  /** The link waiting to be clicked, which the process holding the lock answers. */
  waiting?: { url: string; expires: number };
}

/** What pairing.json holds: the machine's own id, and each Claude account's entry, by its id; for a further server, by its address and then the account's id. */
export interface PairingFile {
  machine?: string;
  accounts: Record<string, PairingEntry>;
  offices?: Record<string, Record<string, PairingEntry>>;
}

export const pairingPath = (claudeDir: string) => path.join(claudeDir, "isoplan", "pairing.json");
/** The office's pairing lock; for the server a version before #105 reports to, the one it uses, so the two never answer one pairing at once. */
export const pairingLockPath = (claudeDir: string, office: { server: string; legacy?: boolean }) =>
  office.legacy ? path.join(claudeDir, "isoplan", "pairing.lock") : path.join(officeDir(claudeDir, office.server), "pairing.lock");

/** The account's entry for `server`, or undefined: the one under `offices`, else the one under `accounts` when it is that server's. */
export function pairingEntry(all: PairingFile, server: string, account: string): PairingEntry | undefined {
  const first = all.accounts[account];
  return all.offices?.[server]?.[account] ?? (first?.server === server ? first : undefined);
}

/**
 * `all` with the account's entry for `server` set: under `accounts` only for the server a version
 * before #105 reports to (`legacy`, config.json's `server`), and only while `offices` holds none for
 * it, so pairingEntry reads it back; any other server's always under `offices`, so a version before
 * #105, which writes `accounts` for its own server, never wipes it.
 */
function withPairingEntry(all: PairingFile, server: string, account: string, entry: PairingEntry, legacy: boolean): PairingFile {
  if (legacy && !all.offices?.[server]?.[account]) return { ...all, accounts: { ...all.accounts, [account]: entry } };
  return { ...all, offices: { ...all.offices, [server]: { ...all.offices?.[server], [account]: entry } } };
}
export const pairingWriteLockPath = (claudeDir: string) => path.join(claudeDir, "isoplan", "pairing.write.lock");

/** A POST of JSON and its answer: what the pairing calls need of `fetch`. */
export type Post = (url: string, body: unknown) => Promise<{ status: number; body: Record<string, unknown> }>;

export interface PairingOptions {
  file: string;
  /** Held while this process answers a link. */
  lock: string;
  /** Held while pairing.json is read, changed and written. */
  writeLock: string;
  /** The data-layer address, ws:// or wss://. */
  server: string;
  /** The machine's Claude account, the same for every folder: the entry's key, and its label. */
  account: { id: string; name: string };
  machine: string;
  emit: (line: DataLayerLine) => void;
  /** The server a version before #105 reports to, config.json's `server`: its entry stays under `accounts`. */
  legacy?: boolean;
  /** config.json's `allowPlainWs`: send credentials over ws:// to another machine. */
  allowPlainWs?: boolean;
  post?: Post;
  now?: () => number;
  pid?: number;
  isAlive?: (pid: number) => boolean;
  /** How long the callback waits between tries at writing the credential. */
  retryMs?: number;
  /** Told the email of the pairing's person each time a renewal keeps one, or none when it goes; given, a token kept without one is renewed once in this process for it. */
  onEmail?: (email: string | undefined) => void;
}

export type Refusal = "not-paired" | "pairing-ended" | "token-expired";

export interface Pairing {
  /**
   * The token for the next hello: undefined to send none (nothing is paired, and the server hasn't
   * asked for it), or null while a link waits to be clicked, when the link tries again shortly.
   * Throws when the server can't be reached, or won't be sent a credential over plain ws://.
   */
  token(): Promise<string | null | undefined>;
  /**
   * The server refused a hello sent with `sent`. Decided and written in one locked step: only what
   * that hello sent is dropped, never what another process has written since, and a credential
   * only on `pairing-ended`.
   */
  refused(code: Refusal, sent: string | undefined): Promise<void>;
  /** Stops answering a pairing callback, and lets the lock go. */
  close(): Promise<void>;
}

export const postJson: Post = async (url, body) => {
  // A redirect is refused, so a credential or a code never follows one to another address.
  const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), redirect: "error", signal: AbortSignal.timeout(15000) });
  const value = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: response.status, body: value && typeof value === "object" ? value : {} };
};

/** The server's http address for a data-layer path: ws(s)://host/data-layer → http(s)://host/data-layer/<path>. */
export function httpUrl(server: string, sub: string): string {
  const url = new URL(server);
  url.protocol = url.protocol === "wss:" ? "https:" : "http:";
  url.pathname = url.pathname.replace(/\/$/, "") + sub;
  url.search = "";
  return url.toString();
}

const LOOPBACK = new Set(["127.0.0.1", "[::1]", "localhost"]);
/** Whether `server` is plain ws:// to another machine, where a credential would cross the network unencrypted. */
export const isPlainRemote = (server: string) => {
  const url = new URL(server);
  return url.protocol === "ws:" && !LOOPBACK.has(url.hostname);
};

export async function readPairing(file: string): Promise<PairingFile> {
  try {
    const value = JSON.parse(await fs.readFile(file, "utf8")) as PairingFile;
    return value && typeof value.accounts === "object" && value.accounts ? value : { accounts: {} };
  } catch {
    return { accounts: {} };
  }
}

/** Written whole, through a temp file, so a reader never sees half of it; owner-only. */
export async function writePairing(file: string, value: PairingFile): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${randomBytes(4).toString("hex")}`;
  await fs.writeFile(temp, JSON.stringify(value, null, 2) + "\n", { mode: 0o600 });
  try {
    await fs.rename(temp, file);
  } catch (err) {
    await fs.rm(temp, { force: true }).catch(() => {});
    throw err;
  }
}

// One change at a time per file within this process; pairing.write.lock keeps other processes out.
const queues = new Map<string, Promise<unknown>>();

/** Runs `change` on pairing.json under both locks, and writes what it returns (or nothing, for null). */
async function locked<T>(file: string, writeLock: string, pid: number, isAlive: (pid: number) => boolean, change: (all: PairingFile) => { write: PairingFile | null; result: T }): Promise<T> {
  const run = async () => {
    const until = Date.now() + WRITE_WAIT_MS;
    while (!(await takeLock(writeLock, pid, isAlive, false, Date.now(), { freshMs: WRITE_FRESH_MS }))) {
      if (Date.now() > until) throw new Error(`couldn't take ${writeLock} in ${WRITE_WAIT_MS / 1000} s`);
      await new Promise((r) => setTimeout(r, 25));
    }
    try {
      const { write, result } = change(await readPairing(file));
      if (write) await writePairing(file, write);
      return result;
    } finally {
      await releaseLock(writeLock, pid).catch(() => {});
    }
  };
  const next = (queues.get(file) ?? Promise.resolve()).then(run, run);
  queues.set(file, next.catch(() => {}));
  return next;
}

/** The machine's own id, made the first time it pairs and kept in pairing.json. */
export function machineIdOf(file: string, writeLock: string, pid = process.pid, isAlive: (pid: number) => boolean = alive): Promise<string> {
  return locked(file, writeLock, pid, isAlive, (all) => {
    if (all.machine) return { write: null, result: all.machine };
    const made = randomBytes(16).toString("base64url");
    return { write: { ...all, machine: made }, result: made };
  });
}

/**
 * Keeps `credential` as the account's for `server`, got some other way than this file's callback
 * (src/connect): it replaces the entry's credential, and the token and any link waiting go with the
 * old one, since the server ended that pairing when it made this one.
 */
export function keepCredential(
  { file, writeLock, server, account, legacy = false, pid = process.pid, isAlive = alive }: Pick<PairingOptions, "file" | "writeLock" | "server" | "legacy" | "pid" | "isAlive"> & { account: string },
  credential: string,
): Promise<void> {
  return locked(file, writeLock, pid, isAlive, (all) => {
    const { token: _, tokenExpires: __, waiting: ___, email: ____, ...rest } = pairingEntry(all, server, account) ?? { server };
    return { write: withPairingEntry(all, server, account, { ...rest, credential }, legacy), result: undefined };
  });
}

/**
 * Keeps an access token renewed with `used` outside createPairing (/isoplan:repos, src/repos), as
 * its renewal does: only while the entry still holds that credential. The server keeps a few live
 * tokens per pairing, the newest, so one renewed and not kept would push out the one sessions use.
 */
export function keepToken(
  { file, writeLock, server, account, legacy = false, pid = process.pid, isAlive = alive }: Pick<PairingOptions, "file" | "writeLock" | "server" | "legacy" | "pid" | "isAlive"> & { account: string },
  used: string,
  token: string,
  tokenExpires: number,
): Promise<void> {
  return locked(file, writeLock, pid, isAlive, (all) => {
    const entry = pairingEntry(all, server, account);
    return { write: entry?.credential === used ? withPairingEntry(all, server, account, { ...entry, token, tokenExpires }, legacy) : null, result: undefined };
  });
}

const page = (worked: boolean, text: string) =>
  `<!doctype html><meta charset="utf-8"><title>Isoplan: ${worked ? "paired" : "not paired"}</title><p style="font:16px system-ui;margin:3em auto;max-width:30em">${text}</p>`;
// Each answer closes its connection, so once the callback stops listening nothing reaches it.
const HTML = { "content-type": "text/html; charset=utf-8", connection: "close" };

export function createPairing({
  file,
  lock,
  writeLock,
  server,
  account,
  machine,
  emit,
  allowPlainWs = false,
  legacy = false,
  post = postJson,
  now = Date.now,
  pid = process.pid,
  isAlive = alive,
  retryMs = 200,
  onEmail,
}: PairingOptions): Pairing {
  let asked = false; // the server wants this machine paired
  let shown: string | null = null; // the link last shown
  let unreadable = false; // said once: the server couldn't read the token sent
  let renewedHere = false; // this process has asked for a token, so for the email too
  let callback: { server: http.Server; timers: ReturnType<typeof setTimeout>[] } | null = null; // the one this process answers

  const entryOf = (all: PairingFile): PairingEntry => pairingEntry(all, server, account.id) ?? { server };
  const withEntry = (all: PairingFile, entry: PairingEntry): PairingFile => withPairingEntry(all, server, account.id, entry, legacy);
  const mine = async () => entryOf(await readPairing(file));
  const update = <T>(decide: (entry: PairingEntry) => { entry: PairingEntry | null; result: T }) =>
    locked(file, writeLock, pid, isAlive, (all) => {
      const { entry, result } = decide(entryOf(all));
      return { write: entry ? withEntry(all, entry) : null, result };
    });
  const drop = ({ credential: _, token: __, tokenExpires: ___, email: ____, ...rest }: PairingEntry): PairingEntry => rest;
  const show = (waiting: { url: string; expires: number }) => {
    if (shown === waiting.url) return;
    shown = waiting.url;
    emit({ type: "pair", server, url: waiting.url, expires: new Date(waiting.expires).toISOString() });
  };
  const plainRefused = () => {
    if (!allowPlainWs && isPlainRemote(server)) throw new Error(`${server} is plain ws:// to another machine, so this machine's credential isn't sent; use wss://, or set "allowPlainWs": true in config.json`);
  };

  async function renew(used: string): Promise<string | undefined> {
    renewedHere = true;
    const answer = await post(httpUrl(server, "/token"), { credential: used });
    if (answer.status === 200 && typeof answer.body.token === "string") {
      const token = answer.body.token;
      const expires = Date.parse(String(answer.body.expires));
      const email = typeof answer.body.email === "string" && answer.body.email ? answer.body.email : undefined;
      // Kept only while the file still holds the credential it was renewed with.
      const kept = await update((e) => {
        if (e.credential !== used) return { entry: null, result: undefined };
        const { email: _, ...rest } = e;
        return { entry: { ...rest, token, tokenExpires: Number.isFinite(expires) ? expires : now(), ...(email && { email }) }, result: token };
      });
      if (kept) onEmail?.(email);
      return kept;
    }
    if (answer.status === 401 && answer.body.code === "pairing-ended") {
      emit({ type: "log", text: `the office server says this machine's pairing has ended: ${String(answer.body.error ?? "")}` });
      asked = true;
      if (await update((e) => ({ entry: e.credential === used ? drop(e) : null, result: e.credential === used }))) onEmail?.(undefined);
      return undefined;
    }
    throw new Error(`the office server answered ${answer.status} when renewing this machine's token`);
  }

  async function stopAnswering() {
    if (!callback) return;
    for (const timer of callback.timers) clearTimeout(timer);
    callback.server.close();
    callback = null;
    await update((e) => ({ entry: e.waiting ? (({ waiting: _, ...rest }) => rest)(e) : null, result: undefined })).catch(() => {});
    await releaseLock(lock, pid).catch(() => {});
  }

  // Writes the credential the callback got, trying again with back-off: a lock held a moment too
  // long, or a scanner holding the file, mustn't lose a pairing the person just approved.
  async function keep(credential: string): Promise<boolean> {
    for (let i = 0; i < WRITE_TRIES; i++) {
      try {
        await update((e) => ({ entry: (({ waiting: _, email: __, ...rest }) => ({ ...rest, credential }))(e), result: undefined }));
        onEmail?.(undefined);
        return true;
      } catch (err) {
        emit({ type: "log", text: `couldn't write this machine's credential (try ${i + 1}): ${String((err as Error)?.message ?? err)}` });
        await new Promise((r) => setTimeout(r, retryMs * 2 ** i));
      }
    }
    return false;
  }

  // The browser came back from the floor with the authorisation code. Whatever happens, it is
  // answered with a page saying whether pairing worked, and nothing here can throw.
  async function finish(code: string, verifier: string, response: http.ServerResponse): Promise<void> {
    let worked = false;
    let text = "This machine couldn't be paired: the office server couldn't be reached. Click the link in Claude Code again in a moment.";
    try {
      const answer = await post(httpUrl(server, "/pair/token"), { code, verifier });
      if (answer.status === 200 && typeof answer.body.credential === "string") {
        worked = await keep(answer.body.credential);
        text = worked
          ? "This machine is paired with the office. You can close this tab; Claude Code reports to it within a few seconds."
          : "The office paired this machine, but its credential couldn't be saved here. Claude Code shows a new link to try again.";
        emit({ type: "log", text: worked ? "this machine is paired with the office server" : "couldn't save this machine's credential; pairing again" });
      } else {
        text = "This machine couldn't be paired: the link was used or has expired. Claude Code shows a new one.";
        emit({ type: "log", text: `the office server didn't pair this machine (${answer.status}): ${String(answer.body.error ?? "")}` });
      }
    } catch (err) {
      emit({ type: "log", text: `couldn't finish pairing: ${String((err as Error)?.message ?? err)}` });
    }
    try {
      response.writeHead(worked ? 200 : 400, HTML).end(page(worked, text));
    } catch {
      // The browser has gone.
    }
    await stopAnswering().catch(() => {});
  }

  // Listens for the browser coming back from the floor with the authorisation code, and asks the
  // server for a pairing that it sends there.
  async function startPairing(): Promise<void> {
    const verifier = randomBytes(32).toString("base64url");
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    const nonce = randomBytes(16).toString("base64url");
    let finishing = false;
    const listener = http.createServer((request, response) => {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      const code = url.searchParams.get("code");
      if (request.method !== "GET" || url.pathname !== `/${nonce}` || !code || finishing) {
        response.writeHead(404, HTML).end(page(false, "Not found."));
        return;
      }
      finishing = true;
      void finish(code, verifier, response);
    });
    listener.on("error", () => {});
    await new Promise<void>((resolve, reject) => listener.once("error", reject).listen(0, "127.0.0.1", () => resolve()));
    listener.unref();
    const { port } = listener.address() as AddressInfo;
    const refresh = setInterval(() => void refreshLock(lock, pid).catch(() => {}), PAIRING_REFRESH_MS);
    refresh.unref();
    callback = { server: listener, timers: [refresh] };
    try {
      const machineId = await machineIdOf(file, writeLock, pid, isAlive);
      const answer = await post(httpUrl(server, "/pair"), { account, machine: { name: machine, id: machineId }, callback: `http://127.0.0.1:${port}/${nonce}`, challenge });
      if (answer.status !== 200 || typeof answer.body.url !== "string") {
        throw new Error(`the office server answered ${answer.status} when asked to pair${answer.body.error ? `: ${String(answer.body.error)}` : ""}`);
      }
      const waiting = { url: answer.body.url, expires: Date.parse(String(answer.body.expires)) || now() };
      const expiry = setTimeout(() => void stopAnswering(), Math.max(0, waiting.expires - now()));
      expiry.unref();
      callback.timers.push(expiry);
      await update((e) => ({ entry: { ...e, waiting }, result: undefined }));
      show(waiting);
    } catch (err) {
      await stopAnswering();
      throw err;
    }
  }

  return {
    async token() {
      const entry = await mine();
      const fresh = !!entry.token && (entry.tokenExpires ?? 0) - RENEW_EARLY_MS > now();
      // A token kept without the email (renewed by an earlier version, say) is renewed once here for it.
      const forEmail = fresh && !!onEmail && !entry.email && !renewedHere && !!entry.credential;
      if (fresh && !forEmail) {
        plainRefused();
        return entry.token;
      }
      if (entry.credential) {
        plainRefused();
        // Renewed only for the email, a renewal that fails leaves the token it had.
        const renewed = await renew(entry.credential).catch((err: unknown) => (forEmail ? undefined : Promise.reject(err)));
        if (renewed) return renewed;
        const again = await mine();
        if (again.token && again.token !== entry.token) return again.token;
        if (forEmail && again.token) return again.token;
      }
      if (!asked && !entry.waiting) return undefined;
      if (callback) return null;
      plainRefused();
      // Another process of this machine is answering a link: it is shown here too.
      if (!(await takeLock(lock, pid, isAlive, false, Date.now(), { freshMs: PAIRING_FRESH_MS }))) {
        if (entry.waiting && entry.waiting.expires > now()) show(entry.waiting);
        return null;
      }
      await startPairing();
      return null;
    },
    async refused(code, sent) {
      if (code !== "token-expired") asked = true;
      if (code === "not-paired" && sent) {
        if (!unreadable) emit({ type: "log", text: "the office server didn't find this machine's token in its hello; it may be older than pairing. The credential is kept." });
        unreadable = true;
        return;
      }
      if (!sent) return;
      const dropped = await update((e) => {
        if (e.token !== sent) return { entry: null, result: false };
        if (code === "token-expired") return { entry: { ...e, tokenExpires: 0 }, result: false };
        return { entry: code === "pairing-ended" ? drop(e) : null, result: code === "pairing-ended" };
      });
      if (dropped) onEmail?.(undefined);
    },
    close: stopAnswering,
  };
}
