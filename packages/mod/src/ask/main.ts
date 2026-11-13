// The ask_earlier_session tool's script, which the hooks module runs for the session's agent (#49):
//
//   node dist/ask.js --session <id> --cwd <folder> [--server <address>]... [--key <id>]   the question on stdin; prints what the agent is told
//   node dist/ask.js --session <id> --cwd <folder> [--server <address>] --ack <question>  the agent was shown that question's end
//
// `--key` is the tool call's id, so asking again under it is the same question (ask.ts). `--server`
// names an office server that gave the session its rights (#105), once per office that did. It asks
// through the machine's runner, over the runner's pipe (src/pipe), which asks the office as this
// session (machine.ts) only while this session's hooks module is connected to it, after its secret
// scan of the question, once the runner has proved it is the runner (openPipe). With the runner out
// of reach, the agent is told to carry on.

import os from "node:os";
import { claudePaths } from "../data-layer/identity.js";
import { openPipe, readPipeInfo, writeLine, type PipeAnswer, type PipeAsk } from "../pipe/pipe.js";

const flag = (argv: string[], name: string) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1]! : null;
};
const flags = (argv: string[], name: string) => argv.flatMap((arg, i) => (arg === name && argv[i + 1] !== undefined ? [argv[i + 1]!] : []));

// No pipe.json, a pipe that didn't answer or prove it is the runner, or a runner that stopped mid-ask.
const UNREACHABLE = "The earlier session can't be asked right now: this session can't reach Isoplan's runner on this machine. Carry on without the answer.";

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

async function main(argv: string[]): Promise<string> {
  const session = flag(argv, "--session");
  const cwd = flag(argv, "--cwd");
  const ack = flag(argv, "--ack") ?? undefined;
  if (!session || !cwd) return "usage: ask.js --session <id> --cwd <folder> [--key <id>], with the question on stdin; or --ack <question>";
  const question = ack ? undefined : await readStdin();
  const { dir: claudeDir } = claudePaths(process.env, os.homedir());
  const info = await readPipeInfo(claudeDir);
  if (!info) return UNREACHABLE;
  const request: PipeAsk = { type: "ask", v: 1, token: info.token, session, cwd, servers: flags(argv, "--server"), ...(flag(argv, "--key") ? { key: flag(argv, "--key")! } : {}), ...(ack ? { ack } : { question }) };
  let said: string | null = null;
  const socket = await openPipe(info, (value) => {
    const answer = value as Partial<PipeAnswer>;
    if (answer?.type === "answer" && typeof answer.text === "string") said = answer.text;
  });
  if (!socket) return UNREACHABLE;
  return new Promise((resolve) => {
    socket.on("close", () => resolve(said ?? UNREACHABLE));
    writeLine(socket, request);
  });
}

try {
  process.stdout.write((await main(process.argv.slice(2))) + "\n");
} catch (err) {
  process.stdout.write(`The earlier session couldn't be asked: ${(err as Error)?.message ?? String(err)}. Carry on without the answer.\n`);
}
process.exit();
