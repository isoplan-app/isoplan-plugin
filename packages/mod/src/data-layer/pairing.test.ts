import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, test } from "vitest";
import type { DataLayerLine } from "../lines.js";
import { createPairing, httpUrl, readPairing, writePairing, type Pairing, type Post } from "./pairing.js";

const SERVER = "wss://office.team.example/data-layer";
const ADA = { id: "claude:4f9c", name: "Ada" };
// Fake credentials, split so no whole secret-shaped string sits in the source.
const CREDENTIAL = "cred" + ".s3cret";
const token = (n: number) => "tok" + "en-" + n;

const dirs: string[] = [];
const pairings: Pairing[] = [];
afterEach(async () => {
  for (const p of pairings.splice(0)) await p.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

let clock = Date.parse("2026-10-20T09:00:00Z");

/**
 * A fake office server's pairing routes. `approve()` is the person approving on the floor and the
 * browser being sent to the callback, which is fetched for real; it answers what the callback page said.
 */
function office() {
  const calls: string[] = [];
  const state = { asks: [] as { callback: string; challenge: string; machine: { name: string; id: string } }[], ended: false, tokens: 0, issued: null as string | null, email: null as string | null };
  const post: Post = async (url, body) => {
    const route = new URL(url).pathname.replace("/data-layer", "");
    calls.push(route);
    const b = body as Record<string, string>;
    if (route === "/pair") {
      state.asks.push({ callback: b.callback!, challenge: b.challenge!, machine: (body as { machine: { name: string; id: string } }).machine });
      return { status: 200, body: { url: `https://office.team.example/#pair=r${state.asks.length}`, expires: new Date(clock + 10 * 60000).toISOString() } };
    }
    if (route === "/pair/token") {
      const ask = state.asks.at(-1)!;
      const ok = b.code === state.issued && createHash("sha256").update(b.verifier!).digest("base64url") === ask.challenge;
      state.issued = null;
      return ok ? { status: 200, body: { credential: CREDENTIAL } } : { status: 400, body: { error: "the verifier doesn't match" } };
    }
    expect(route).toBe("/token");
    if (state.ended || b.credential !== CREDENTIAL) return { status: 401, body: { code: "pairing-ended", error: "revoked" } };
    state.tokens++;
    return { status: 200, body: { token: token(state.tokens), expires: new Date(clock + 60 * 60000).toISOString(), ...(state.email && { email: state.email }) } };
  };
  const approve = async (code = "auth-1") => {
    state.issued = code;
    const callback = new URL(state.asks.at(-1)!.callback);
    callback.searchParams.set("code", code);
    const response = await fetch(callback);
    return { status: response.status, text: await response.text() };
  };
  return { calls, state, post, approve };
}

function setUp(server = office()) {
  const dir = mkdtempSync(path.join(tmpdir(), "isoplan-pairing-"));
  dirs.push(dir);
  const lines: DataLayerLine[] = [];
  const file = path.join(dir, "isoplan", "pairing.json");
  const lock = path.join(dir, "isoplan", "pairing.lock");
  const writeLock = path.join(dir, "isoplan", "pairing.write.lock");
  // SERVER stands for the server config.json's `server` names, whose entry is under `accounts`.
  const make = (account = ADA, url = SERVER, pid = process.pid, at = file) => {
    const p = createPairing({ file: at, lock, writeLock, server: url, account, machine: "sevengill", emit: (line) => lines.push(line), post: server.post, now: () => clock, pid, isAlive: () => true, retryMs: 1, legacy: url === SERVER });
    pairings.push(p);
    return p;
  };
  return { pairing: make(), make, file, lock, dir, lines, ...server };
}
const pairLines = (lines: DataLayerLine[]) => lines.filter((l) => l.type === "pair");

test("the data-layer address gives the pairing routes beside it", () => {
  expect(httpUrl("wss://office.team.example/data-layer", "/pair")).toBe("https://office.team.example/data-layer/pair");
  expect(httpUrl("ws://127.0.0.1:4747/data-layer", "/token")).toBe("http://127.0.0.1:4747/data-layer/token");
});

test("nothing is paired, and no token sent, until the server asks for one", async () => {
  const { pairing, calls } = setUp();
  expect(await pairing.token()).toBeUndefined();
  expect(calls).toEqual([]);
});

test("refused as not-paired: a loopback callback and a link; approving it in the browser pairs the machine", async () => {
  const { pairing, file, lines, calls, state, approve } = setUp();
  await pairing.refused("not-paired", undefined);
  expect(await pairing.token()).toBeNull();
  expect(state.asks[0]!.callback).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/[\w-]{22}$/);
  expect(pairLines(lines)).toEqual([{ type: "pair", server: SERVER, url: "https://office.team.example/#pair=r1", expires: new Date(clock + 10 * 60000).toISOString() }]);
  // Still waiting: the same link, not shown again, and nothing asked of the server.
  expect(await pairing.token()).toBeNull();
  expect(pairLines(lines)).toHaveLength(1);
  expect(calls).toEqual(["/pair"]);

  const page = await approve();
  expect(page.status).toBe(200);
  expect(page.text).toContain("This machine is paired");
  expect(await pairing.token()).toBe(token(1));
  const kept = await readPairing(file);
  expect(kept.accounts).toEqual({ [ADA.id]: { server: SERVER, credential: CREDENTIAL, token: token(1), tokenExpires: clock + 60 * 60000 } });
  // The machine's own id, made once and sent with the request.
  expect(kept.machine).toMatch(/^[\w-]{22}$/);
  expect(state.asks[0]!.machine).toEqual({ name: "sevengill", id: kept.machine });
  if (process.platform !== "win32") expect(statSync(file).mode & 0o777).toBe(0o600);
  // The callback has stopped listening.
  await expect(fetch(state.asks[0]!.callback)).rejects.toThrow();
  // Until it nears its end the token is used as it is.
  clock += 50 * 60000;
  expect(await pairing.token()).toBe(token(1));
  clock += 6 * 60000;
  expect(await pairing.token()).toBe(token(2));
});

test("a callback with the wrong code, or a server that doesn't take the verifier, pairs nothing", async () => {
  const { pairing, state, approve } = setUp();
  await pairing.refused("not-paired", undefined);
  await pairing.token();
  // Something else on this machine knocking on the port, at the wrong path, is turned away.
  const wrongPath = new URL(state.asks[0]!.callback);
  wrongPath.pathname = "/other";
  expect((await fetch(wrongPath)).status).toBe(404);
  state.issued = "auth-1";
  const forged = new URL(state.asks[0]!.callback);
  forged.searchParams.set("code", "not-the-code");
  expect((await fetch(forged)).status).toBe(400);
  // That used the request up: the next try asks for a new one.
  expect(await pairing.token()).toBeNull();
  expect(state.asks).toHaveLength(2);
  expect((await approve()).status).toBe(200);
  expect(await pairing.token()).toBe(token(1));
});

test("of two data layers starting at once, one pairs and the other shows its link; both get the credential", async () => {
  const { pairing, make, lines, state, approve } = setUp();
  const other = make(ADA, SERVER, process.pid + 1);
  await pairing.refused("not-paired", undefined);
  await other.refused("not-paired", undefined);
  expect(await pairing.token()).toBeNull();
  expect(await other.token()).toBeNull();
  expect(state.asks).toHaveLength(1);
  expect(pairLines(lines).map((l) => (l as { url: string }).url)).toEqual(["https://office.team.example/#pair=r1", "https://office.team.example/#pair=r1"]);
  await approve();
  expect(await other.token()).toBe(token(1));
  expect(await pairing.token()).toBe(token(1));
});

test("not-paired for a hello that carried a token keeps the credential: the server couldn't read it", async () => {
  const { pairing, file, lines, approve } = setUp();
  await pairing.refused("not-paired", undefined);
  await pairing.token();
  await approve();
  const sent = await pairing.token();
  await pairing.refused("not-paired", sent!);
  await pairing.refused("not-paired", sent!);
  expect((await readPairing(file)).accounts[ADA.id]?.credential).toBe(CREDENTIAL);
  expect(await pairing.token()).toBe(sent);
  expect(lines.filter((l) => l.type === "log" && l.text.includes("didn't find this machine's token"))).toHaveLength(1);
});

test("pairing-ended drops the credential, and the machine pairs again; so does a renewal the server refuses", async () => {
  const { pairing, file, state, approve } = setUp();
  await pairing.refused("not-paired", undefined);
  await pairing.token();
  await approve();
  const sent = await pairing.token();
  await pairing.refused("pairing-ended", sent!);
  expect((await readPairing(file)).accounts[ADA.id]).toEqual({ server: SERVER });
  expect(await pairing.token()).toBeNull();
  expect(state.asks).toHaveLength(2);

  await approve();
  expect(await pairing.token()).toBe(token(2));
  state.ended = true;
  clock += 2 * 60 * 60000;
  expect(await pairing.token()).toBeNull();
  expect((await readPairing(file)).accounts[ADA.id]?.credential).toBeUndefined();
  expect(state.asks).toHaveLength(3);
});

test("token-expired renews it; a refusal of an older token leaves the newer one alone", async () => {
  const { pairing, file, approve } = setUp();
  await pairing.refused("not-paired", undefined);
  await pairing.token();
  await approve();
  expect(await pairing.token()).toBe(token(1));
  await pairing.refused("token-expired", token(1));
  expect(await pairing.token()).toBe(token(2));
  await pairing.refused("token-expired", token(1));
  await pairing.refused("pairing-ended", token(1));
  expect((await readPairing(file)).accounts[ADA.id]?.token).toBe(token(2));
});

test("a renewal keeps the email the office names for the pairing's person; an office that names none leaves none, and a new pairing drops it", async () => {
  const { pairing, file, approve, state } = setUp();
  await pairing.refused("not-paired", undefined);
  await pairing.token();
  await approve();
  expect(await pairing.token()).toBe(token(1));
  expect((await readPairing(file)).accounts[ADA.id]?.email).toBeUndefined();
  state.email = "ada@example.com";
  await pairing.refused("token-expired", token(1));
  await pairing.token();
  expect((await readPairing(file)).accounts[ADA.id]?.email).toBe("ada@example.com");
  // Its pairing ended, the email goes with the credential.
  state.ended = true;
  await pairing.refused("token-expired", token(2));
  await pairing.token();
  expect((await readPairing(file)).accounts[ADA.id]).not.toHaveProperty("email");
});

test("each Claude account has its own entry; another server's counts as none and leaves the others alone", async () => {
  const { pairing, make, file, approve } = setUp();
  await pairing.refused("not-paired", undefined);
  await pairing.token();
  await approve();
  await pairing.token();
  const bo = make({ id: "claude:b0", name: "Bo" });
  expect(await bo.token()).toBeUndefined();
  expect(await make(ADA, "wss://elsewhere.example/data-layer").token()).toBeUndefined();
  await bo.refused("not-paired", undefined);
  await bo.token();
  const kept = (await readPairing(file)).accounts;
  expect(Object.keys(kept).sort()).toEqual(["claude:4f9c", "claude:b0"]);
  expect(kept[ADA.id]?.credential).toBe(CREDENTIAL);
});

test("a write that can't be renamed into place leaves no temp file behind", async () => {
  const { dir } = setUp();
  const file = path.join(dir, "blocked", "pairing.json");
  // A folder where the file should go: the rename fails.
  mkdirSync(file, { recursive: true });
  await expect(writePairing(file, { accounts: {} })).rejects.toThrow();
  expect(readdirSync(path.dirname(file))).toEqual(["pairing.json"]);
});

test("the machine keeps its id across pairings", async () => {
  const { pairing, state, approve } = setUp();
  await pairing.refused("not-paired", undefined);
  await pairing.token();
  await approve();
  const sent = await pairing.token();
  await pairing.refused("pairing-ended", sent!);
  await pairing.token();
  expect(state.asks.map((a) => a.machine.id)).toEqual([state.asks[0]!.machine.id, state.asks[0]!.machine.id]);
});

test("a credential that can't be saved: the browser is still told, nothing crashes, and the machine pairs again", async () => {
  const server = office();
  const { make, dir, lines } = setUp(server);
  const blocked = path.join(dir, "blocked", "pairing.json");
  const pairing = make(ADA, SERVER, process.pid, blocked);
  await pairing.refused("not-paired", undefined);
  await pairing.token();
  // From here on every write fails: pairing.json is a folder.
  rmSync(blocked);
  mkdirSync(blocked);
  const page = await server.approve();
  expect(page.status).toBe(400);
  expect(page.text).toContain("couldn't be saved");
  expect(lines.filter((l) => l.type === "log" && l.text.startsWith("couldn't write this machine's credential"))).toHaveLength(4);
});

test("a pairing lock not kept fresh counts as free, though its pid looks alive", async () => {
  const { pairing, lock, state } = setUp();
  mkdirSync(path.dirname(lock), { recursive: true });
  writeFileSync(lock, JSON.stringify({ pid: 999999 }));
  const old = new Date(Date.now() - 5 * 60000);
  utimesSync(lock, old, old);
  await pairing.refused("not-paired", undefined);
  expect(await pairing.token()).toBeNull();
  expect(state.asks).toHaveLength(1);
});

test("a credential or token is never sent over plain ws:// to another machine without the opt-in", async () => {
  const server = office();
  const dir = mkdtempSync(path.join(tmpdir(), "isoplan-pairing-"));
  dirs.push(dir);
  const options = { file: path.join(dir, "pairing.json"), lock: path.join(dir, "pairing.lock"), writeLock: path.join(dir, "pairing.write.lock"), server: "ws://10.0.0.5:4747/data-layer", account: ADA, machine: "sevengill", emit: () => {}, post: server.post, now: () => clock };
  const plain = createPairing(options);
  pairings.push(plain);
  await plain.refused("not-paired", undefined);
  await expect(plain.token()).rejects.toThrow("plain ws://");
  expect(server.calls).toEqual([]);
  const allowed = createPairing({ ...options, allowPlainWs: true });
  pairings.push(allowed);
  await allowed.refused("not-paired", undefined);
  expect(await allowed.token()).toBeNull();
});

test("each office server has its own pairing: config.json's server stays where an older version looks, another server's goes beside it, and one ending leaves the other (#105)", async () => {
  const { pairing, file, dir, approve } = setUp();
  const dev = office();
  const DEV = "ws://127.0.0.1:4747/data-layer";
  const other = createPairing({ file, lock: path.join(dir, "isoplan", "offices", "dev", "pairing.lock"), writeLock: path.join(dir, "isoplan", "pairing.write.lock"), server: DEV, account: ADA, machine: "sevengill", emit: () => {}, post: dev.post, now: () => clock, isAlive: () => true, retryMs: 1 });
  pairings.push(other);
  // Both wait to be paired at once: neither's lock holds the other up.
  await pairing.refused("not-paired", undefined);
  await other.refused("not-paired", undefined);
  expect(await pairing.token()).toBeNull();
  expect(await other.token()).toBeNull();
  expect(dev.state.asks).toHaveLength(1);
  await approve();
  await dev.approve();
  expect(await pairing.token()).toBe(token(1));
  expect(await other.token()).toBe(token(1));
  const kept = await readPairing(file);
  expect(kept.accounts[ADA.id]?.server).toBe(SERVER);
  expect(kept.offices?.[DEV]?.[ADA.id]?.credential).toBe(CREDENTIAL);

  await pairing.refused("pairing-ended", token(1));
  const after = await readPairing(file);
  expect(after.accounts[ADA.id]?.credential).toBeUndefined();
  expect(after.offices?.[DEV]?.[ADA.id]?.credential).toBe(CREDENTIAL);
  expect(await other.token()).toBe(token(1));
});

test("with an entry for one server in both places (an older version wrote under accounts), the one under offices is read and renewed there, and the other left alone (#105)", async () => {
  const { file, make } = setUp();
  const DEV = "ws://127.0.0.1:4747/data-layer";
  await writePairing(file, {
    accounts: { [ADA.id]: { server: DEV, credential: "old" + "-cred", token: token(8), tokenExpires: clock + 60 * 60000 } },
    offices: { [DEV]: { [ADA.id]: { server: DEV, credential: CREDENTIAL, token: token(9), tokenExpires: clock + 60 * 60000 } } },
  });
  const dev = make(ADA, DEV);
  expect(await dev.token()).toBe(token(9));
  await dev.refused("token-expired", token(9));
  const kept = await readPairing(file);
  expect(kept.offices?.[DEV]?.[ADA.id]?.tokenExpires).toBe(0);
  expect(kept.accounts[ADA.id]?.tokenExpires).toBe(clock + 60 * 60000);
});

test("with servers X and Y and config.json's server L left at its default, both go under offices, so an older version writing L under accounts wipes neither (#105)", async () => {
  const { file, dir } = setUp();
  const L = "ws://127.0.0.1:4747/data-layer";
  const make = (url: string, o: ReturnType<typeof office>) => {
    const p = createPairing({ file, lock: path.join(dir, "isoplan", "offices", url.length.toString(), "pairing.lock"), writeLock: path.join(dir, "isoplan", "pairing.write.lock"), server: url, account: ADA, machine: "sevengill", emit: () => {}, post: o.post, now: () => clock, isAlive: () => true, retryMs: 1 });
    pairings.push(p);
    return p;
  };
  const X = "wss://x.example/data-layer";
  const Y = "wss://y.example.org/data-layer";
  for (const [url, o] of [[X, office()], [Y, office()]] as const) {
    const p = make(url, o);
    await p.refused("not-paired", undefined);
    await p.token();
    await o.approve();
    expect(await p.token()).toBe(token(1));
  }
  const kept = await readPairing(file);
  expect(kept.accounts).toEqual({});
  expect(Object.keys(kept.offices ?? {}).sort()).toEqual([X, Y]);
  // The older version pairs with L, writing accounts whole: X and Y are still there.
  await writePairing(file, { ...kept, accounts: { [ADA.id]: { server: L, credential: "l" + "-cred" } } });
  const after = await readPairing(file);
  expect(after.offices?.[X]?.[ADA.id]?.credential).toBe(CREDENTIAL);
  expect(after.offices?.[Y]?.[ADA.id]?.credential).toBe(CREDENTIAL);
});
