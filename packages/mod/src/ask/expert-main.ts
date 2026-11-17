// The ask_expert tool's script (protocol 0.13.0), which the hooks module runs for the session's agent:
//
//   node dist/ask-expert.js --session <id> --cwd <folder> --expert <name> --key <id> [--blocking] [--server <address>]...   the question on stdin
//
// It prints what the agent is told and exits 2 when the ask failed, so the hooks module reports it as
// an error. `--key` is the tool call's id, so asking again under it is the same question. `--server`
// names an office server whose rights list the expert, once per office. It asks through the
// machine's runner, over the runner's pipe (src/pipe), as ask.js does: the runner asks the office as
// this session (expert-machine.ts), only while this session's hooks module is connected to it, once
// the runner has proved it is the runner (openPipe). Acks go through ask.js, as ask_earlier_session's do.

import { realpathSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { claudePaths } from "../data-layer/identity.js";
import { openPipe, readPipeInfo, writeLine, type PipeAnswer, type PipeAskExpert, type Told } from "../pipe/pipe.js";
import { expertText } from "./expert-text.js";

const flag = (argv: string[], name: string) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1]! : null;
};
const flags = (argv: string[], name: string) => argv.flatMap((arg, i) => (arg === name && argv[i + 1] !== undefined ? [argv[i + 1]!] : []));

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

/** What the agent is told, and the exit code: 2 when the ask failed. */
export async function runAskExpert(argv: string[], stdin: string): Promise<{ text: string; code: 0 | 2 }> {
  const session = flag(argv, "--session");
  const cwd = flag(argv, "--cwd");
  const expert = flag(argv, "--expert");
  const key = flag(argv, "--key");
  if (!session || !cwd || !expert || !key) return { text: "usage: ask-expert.js --session <id> --cwd <folder> --expert <name> --key <id> [--blocking] [--server <address>]..., with the question on stdin", code: 2 };
  // No pipe.json, a pipe that didn't answer or prove it is the runner, or a runner that stopped mid-ask.
  const unreachable = { text: expertText("EXPERT_RUNNER_UNREACHABLE", { expert, id: key }), code: 2 as const };
  let said: Told | null = null;
  try {
    const { dir: claudeDir } = claudePaths(process.env, os.homedir());
    const info = await readPipeInfo(claudeDir);
    if (!info) return unreachable;
    const request: PipeAskExpert = { type: "ask-expert", v: 1, token: info.token, session, cwd, servers: flags(argv, "--server"), expert, question: stdin, blocking: argv.includes("--blocking"), key };
    const socket = await openPipe(info, (value) => {
      const answer = value as Partial<PipeAnswer>;
      if (answer?.type === "answer" && typeof answer.text === "string") said = answer.failed === true ? { text: answer.text, failed: true } : { text: answer.text };
    });
    if (!socket) return unreachable;
    await new Promise<void>((resolve) => {
      socket.on("close", () => resolve());
      writeLine(socket, request);
    });
  } catch (err) {
    return { text: expertText("EXPERT_RUNNER_UNREACHABLE", { expert, id: key, words: String((err as Error)?.message ?? err) }), code: 2 };
  }
  // Set in the pipe's callback, which TypeScript doesn't follow.
  const told = said as Told | null;
  return told ? { text: told.text, code: told.failed ? 2 : 0 } : unreachable;
}

// Run as dist/ask-expert.js, it asks and prints; imported (its tests), it does nothing. Node loads
// the script by its real path, so a plugin folder reached through a link still matches.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(path.resolve(process.argv[1]))).href) {
  const { text, code } = await runAskExpert(process.argv.slice(2), await readStdin());
  process.stdout.write(text + "\n");
  process.exit(code);
}
