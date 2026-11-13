// Asking the room for a session, as the runner does it when the session's ask_earlier_session script asks
// through the runner's pipe (main.ts, src/pipe/server.ts): it asks in the office the session took
// its handoff through (handoff/taken-office.ts) when that is one of those that gave the session its
// rights (`servers`, #105), else in the first of them in config.json's order whose list takes the
// session's repo; with none named, in the first office of all whose list does. It speaks to the
// office server as that session, on a short link of its own (handoff/connection.ts), and asks the
// room that session's person was handed (ask.ts). The server decides whether they may.
//
// When the office signs people in, the hello carries this machine's pairing token, as a session's
// link does (data-layer/pairing.ts). A token past its time is renewed with the machine's credential,
// and a hello refused as `token-expired` is sent once more with a fresh one. It never pairs the
// machine itself: with no credential it sends no token, and the session's status line shows the
// link to pair. Refused as not paired, ended or forged, the agent is told so plainly (ask.ts).

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { MAX_QUESTION_LENGTH, PROTOCOL_VERSION, type HelloMessage, type Project } from "@isoplan/protocol";
import { loadConfig, loadSettings, officesOf, type Office } from "../data-layer/config.js";
import { approvedPath } from "../data-layer/approved.js";
import { commandHome, machineHomeIo } from "../data-layer/home.js";
import { cachedRemoteNames } from "../data-layer/remote-names.js";
import { accountOf, claudePaths } from "../data-layer/identity.js";
import { nodeIo } from "../data-layer/io.js";
import { createPairing, pairingEntry, pairingLockPath, pairingPath, pairingWriteLockPath, postJson, readPairing } from "../data-layer/pairing.js";
import { openSideLink } from "../handoff/connection.js";
import { takenOffice } from "../handoff/taken-office.js";
import { askOffices, askRoom, MAX_WAIT_MS, TokenExpired, type AskSettings } from "./ask.js";

const CONNECT_MS = 20000;

export interface MachineAsk {
  session: string;
  cwd: string;
  /** The office servers that gave the session its rights. */
  servers: readonly string[];
  /** The tool call's id: asked again under it, it is the same question. */
  key?: string;
  /** The question, or with `ack` the question whose end the agent was shown. */
  question?: string;
  ack?: string;
  /** The folder with runner.json and config.json (the runner's copy). */
  appDir: string;
  /** The name of the secret pattern the question matches, or null: one that matches isn't sent. */
  scan(text: string): Promise<string | null>;
}

const readText = (p: string) => fs.readFile(p, "utf8").catch(() => null);

/** What the agent is told. */
export async function askFromMachine(a: MachineAsk): Promise<string> {
  const { dir: claudeDir, json: claudeJson } = claudePaths(process.env, os.homedir());
  const isoplanDir = path.join(claudeDir, "isoplan");
  const io = nodeIo();
  const { session, cwd, ack } = a;
  const key = a.key || undefined;
  const question = ack ? "" : (a.question ?? "").trim();
  if (!ack && !question) return "Give the question to ask the earlier session.";
  if (question.length > MAX_QUESTION_LENGTH) return `That question is too long to ask the earlier session: keep it under ${MAX_QUESTION_LENGTH} characters.`;
  // Nothing leaves the machine without the secret scan (runner/scan.ts).
  const hit = question ? await a.scan(question) : null;
  if (hit) return `The question wasn't sent: it looks like it holds a secret (it matches the secret pattern ${hit}). Ask it again without that, or carry on without the answer.`;
  const settings = await loadSettings<AskSettings>(io, path.join(a.appDir, "runner.json"), path.join(isoplanDir, "runner.json"));
  const config = await loadConfig(io, path.join(a.appDir, "config.json"), path.join(isoplanDir, "config.json"));
  const offices = askOffices(officesOf(config), a.servers, await takenOffice(claudeDir, session));
  if (!offices.length) return `The earlier session can't be asked: ${a.servers.join(", ")} isn't one of the office servers in config.json. Carry on without the answer.`;
  // Nothing of a repo the office doesn't take is sent, its id included (#91).
  let found: Awaited<ReturnType<typeof commandHome>> = { refused: "" };
  let office = offices[0]!;
  for (const each of offices) {
    found = each.plainRefused
      ? { refused: `config.json's server ${each.server} is plain ws:// to another machine.` }
      : await commandHome(cwd, machineHomeIo(config.workspaceRepos, cachedRemoteNames(claudeDir)), { file: approvedPath(claudeDir, each.server), server: each.server, maxAgeMs: config.approvedMaxAgeMinutes * 60000 });
    office = each;
    if ("home" in found) break;
  }
  if ("refused" in found) return `The earlier session can't be asked: ${found.refused} Carry on without the answer.`;
  const { server } = office;
  const pairing = await machinePairing(office, config.allowPlainWs, claudeDir, claudeJson, io);
  // One bound for the whole wait, a retry after an expired token included.
  const deadline = Date.now() + MAX_WAIT_MS;
  try {
    for (let tries = 0; ; tries++) {
      const token = await pairing.token();
      const said = await hello(session, cwd, token, found.home, claudeJson, io);
      const link = await openSideLink(server, said, CONNECT_MS);
      try {
        if (ack) {
          link.send({ type: "asked-ack", v: PROTOCOL_VERSION, question: ack });
          return `acked ${ack}`;
        }
        // Named so an answer from this person's own session reads as that (#109).
        return await askRoom(link, question, settings, { key, deadline, me: said.account.name || undefined });
      } catch (err) {
        if (!(err instanceof TokenExpired) || tries > 0) throw err;
        await pairing.expired(token);
      } finally {
        await link.close();
      }
    }
  } finally {
    await pairing.close();
  }
}

// The session's hello, as its own link says it, with the machine's token when it has one.
async function hello(session: string, cwd: string, token: string | undefined, project: Project, claudeJson: string, io: ReturnType<typeof nodeIo>): Promise<HelloMessage> {
  return {
    type: "hello",
    v: PROTOCOL_VERSION,
    source: "claude-code",
    account: await accountOf({ readText, run: io.run }, claudeJson, cwd),
    machine: { name: os.hostname() },
    session: `claude-code:${session}`,
    project,
    ...(token ? { token } : {}),
  };
}

// This machine's pairing with `server`, under the machine's Claude account.
async function machinePairing(office: Office, allowPlainWs: boolean, claudeDir: string, claudeJson: string, io: ReturnType<typeof nodeIo>) {
  const { server } = office;
  const account = await accountOf({ readText, run: io.run }, claudeJson, os.homedir());
  const file = pairingPath(claudeDir);
  const pairing = createPairing({
    file,
    lock: pairingLockPath(claudeDir, office),
    writeLock: pairingWriteLockPath(claudeDir),
    server,
    account,
    machine: os.hostname(),
    emit: () => {},
    allowPlainWs,
    legacy: !!office.legacy,
    // Pairing is the session's link's to start, where the person sees its link; asking never asks for one.
    post: (url, body) => (new URL(url).pathname.endsWith("/pair") ? Promise.reject(new Error("pairing is left to the session's link")) : postJson(url, body)),
  });
  return {
    // A token only from a credential this machine already holds; none otherwise.
    async token(): Promise<string | undefined> {
      if (!pairingEntry(await readPairing(file), server, account.id)?.credential) return undefined;
      return (await pairing.token().catch(() => undefined)) ?? undefined;
    },
    expired: (sent: string | undefined) => pairing.refused("token-expired", sent).catch(() => {}),
    close: () => pairing.close().catch(() => {}),
  };
}
