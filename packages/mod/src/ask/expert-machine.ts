// Asking an expert for a session (protocol 0.13.0), as the runner does it when the session's
// ask_expert script asks through the runner's pipe (src/pipe/server.ts). It picks the office, the
// session's project there, and the machine's pairing as askFromMachine does (machine.ts), after the
// secret scan of the question, and asks on a short link of its own (expert.ts). The server decides
// whether the session may ask that expert.
//
// A blocking question has expertWaitSeconds (runner.json) from when the runner was asked, and every
// wait on the way counts against it: the pairing token, opening the link, and the ask itself. Past
// it with the question sent but not confirmed, the agent is told it is pending; past it before the
// question was sent, that it wasn't sent. Neither is told as waiting having failed.

import os from "node:os";
import path from "node:path";
import { MAX_QUESTION_LENGTH } from "@isoplan/protocol";
import { loadConfig, loadSettings } from "../data-layer/config.js";
import { claudePaths } from "../data-layer/identity.js";
import { nodeIo } from "../data-layer/io.js";
import { openSideLink } from "../handoff/connection.js";
import type { Told } from "../pipe/pipe.js";
import { TokenExpired } from "./ask.js";
import { askExpertThrough, type ExpertTold } from "./expert.js";
import { expertText, notSentText } from "./expert-text.js";
import { askIn, CONNECT_MS, hello, machinePairing, type MachineAsk } from "./machine.js";

/** What runner.json says about asking experts. */
export interface ExpertSettings {
  expertWaitSeconds: number;
}

export type MachineExpertAsk = MachineAsk & { expert: string; blocking: boolean; key: string };

/** What the agent is told, `failed` with its code when the question couldn't be asked. */
export async function askExpertFromMachine(a: MachineExpertAsk): Promise<ExpertTold> {
  const received = Date.now();
  const about = { expert: a.expert, id: a.key };
  const unreachable = (words: string): Told => ({ text: expertText("EXPERT_RUNNER_UNREACHABLE", { ...about, words }), failed: true, code: "EXPERT_RUNNER_UNREACHABLE" });
  const question = (a.question ?? "").trim();
  if (!question) return { text: "Give the question to ask as `question`.", failed: true };
  if (question.length > MAX_QUESTION_LENGTH) return { text: `Expert ${a.expert}, question ${a.key}: that question is too long to ask: keep it under ${MAX_QUESTION_LENGTH} characters.`, failed: true };
  // Nothing leaves the machine without the secret scan (runner/scan.ts).
  const hit = await a.scan(question);
  if (hit) return { text: expertText("EXPERT_QUESTION_HELD", { ...about, pattern: hit }), failed: true, code: "EXPERT_QUESTION_HELD" };

  const { dir: claudeDir, json: claudeJson } = claudePaths(process.env, os.homedir());
  const isoplanDir = path.join(claudeDir, "isoplan");
  const io = nodeIo();
  const settings = await loadSettings<ExpertSettings>(io, path.join(a.appDir, "runner.json"), path.join(isoplanDir, "runner.json"));
  const deadline = received + settings.expertWaitSeconds * 1000;
  const config = await loadConfig(io, path.join(a.appDir, "config.json"), path.join(isoplanDir, "config.json"));
  const found = await askIn(config, a.servers, a.session, a.cwd, claudeDir);
  if (!found) return unreachable(`${a.servers.join(", ")} isn't one of the office servers in config.json`);
  if ("refused" in found) return unreachable(found.refused);
  const { office, home } = found;
  const pairing = await machinePairing(office, config.allowPlainWs, claudeDir, claudeJson, io);
  const ask = { expert: a.expert, question, blocking: a.blocking, key: a.key };
  try {
    for (let tries = 0; ; tries++) {
      const token = a.blocking ? await within(pairing.token(), deadline - Date.now()) : { value: await pairing.token() };
      if (!token) return { text: notSentText(about) };
      const said = await hello(a.session, a.cwd, token.value, home, claudeJson, io);
      try {
        return await askExpertThrough((ms) => openSideLink(office.server, said, ms), ask, { deadline, connectMs: CONNECT_MS });
      } catch (err) {
        if (!(err instanceof TokenExpired) || tries > 0) throw err;
        await pairing.expired(token.value);
      }
    }
  } finally {
    await pairing.close();
  }
}

// What `p` settles to, or null once `ms` has passed first.
function within<T>(p: Promise<T>, ms: number): Promise<{ value: T } | null> {
  if (ms <= 0) {
    p.catch(() => {});
    return Promise.resolve(null);
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve(null), ms);
    p.then(
      (value) => (clearTimeout(timer), resolve({ value })),
      (err: unknown) => (clearTimeout(timer), reject(err)),
    );
  });
}
