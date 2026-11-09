// The runner's end of the local pipe (pipe.ts): the worker serves it, and it is how each session's
// hooks module reaches the runner (ADR 0007 step 2).
//
// A client may first say hi with a nonce, answered with its proof (pipe.ts), so it knows this is the
// runner before it sends the token. A message without the worker's token is refused and its
// connection closed. A hooks module's end
// says hello for one session, and from then on that connection is that session's alone: it is sent
// only that session's lines. One connection is registered per session: of two, the one from the
// newer version of the plugin keeps it, and of one version the later window's (`since`); the other
// is told it is `superseded` and closed, as a data layer was when another took its session, and its
// hooks module tries again a minute later. An ask (the ask_room script) is answered only with the
// token, and only for a session whose hooks module is registered now, as that hooks module's
// session: in its folder, whatever folder the ask names. The token is the worker's alone, not the
// session's, so it is the user's own processes that can ask, and only for a session that is open.
// A close (the desktop app's menu) is answered only with the token too: whether the runner closed
// the headless session it names.
//
// `onChange` is called with a session's id whenever its registered connection changes or goes, so
// the runner reports it again with the hooks module it has now (src/runner/reporting.ts).

import { timingSafeEqual } from "node:crypto";
import net, { type Socket } from "node:net";
import type { DataLayerLine } from "../lines.js";
import { newToken, pipeAddress, preparePipe, proofOf, readLines, sessionEnv, writeLine, writePipeInfo, type PipeAsk, type PipeClose, type PipeHello, type PipeHi } from "./pipe.js";

/** A session's registered hooks module, as the runner reports for it. */
export interface Hooked {
  session: string;
  cwd: string;
  since: number;
  messages: boolean;
  root: string;
  version: string;
  /** The variables of the session's own environment it passed on (pipe.ts SESSION_ENV). */
  env: Record<string, string>;
  /** Sends the hooks module one of its session's lines; a `superseded` closes the connection after it. */
  send(line: DataLayerLine): void;
  /** Settles once the connection has gone. */
  closed: Promise<void>;
}

export interface PipeServerOptions {
  claudeDir: string;
  platform?: NodeJS.Platform;
  /** The address to listen on, in place of a new one (pipeAddress). */
  address?: string;
  /** Answers an ask from a session whose hooks module is registered: what the agent is told. */
  ask(request: PipeAsk): Promise<string>;
  /** Closes the runner's headless session that status.json names by `close`: whether its process has ended. */
  close?(close: string): Promise<boolean>;
  onChange(session: string): void;
  log(text: string): void;
}

export interface PipeServer {
  address: string;
  /** The session's registered hooks module, or null. */
  hooked(session: string): Hooked | null;
  /** Every registered hooks module. */
  all(): Hooked[];
  close(): Promise<void>;
}

const SESSION = /^[\w-]{1,200}$/;
const NOT_CONNECTED = "The room can't be asked from here: this session isn't connected to Isoplan's runner. Carry on without the answer.";

/** Of two hooks modules for one session, the one that keeps it: a newer version's, then the later window's. */
export function keeps(a: Pick<Hooked, "version" | "since">, b: Pick<Hooked, "version" | "since">): boolean {
  const order = compareVersions(a.version, b.version);
  return order !== 0 ? order > 0 : a.since >= b.since;
}

function compareVersions(a: string, b: string): number {
  const parts = (v: string) => (/^(\d+)\.(\d+)\.(\d+)/.exec(v) ?? []).slice(1).map(Number);
  const [x, y] = [parts(a), parts(b)];
  for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0);
  return 0;
}

const isHello = (m: Partial<PipeHello>): m is PipeHello =>
  m.type === "hello" && typeof m.session === "string" && SESSION.test(m.session) && typeof m.cwd === "string" && !!m.cwd && typeof m.since === "number" && typeof m.root === "string" && typeof m.version === "string";

const isClose = (m: Partial<PipeClose>): m is PipeClose => m.type === "close" && typeof m.close === "string" && m.close.length <= 300;

const isAsk = (m: Partial<PipeAsk>): m is PipeAsk => m.type === "ask" && typeof m.session === "string" && typeof m.cwd === "string" && Array.isArray(m.servers) && m.servers.every((s) => typeof s === "string");

export async function createPipeServer(o: PipeServerOptions): Promise<PipeServer> {
  const platform = o.platform ?? process.platform;
  const address = o.address ?? pipeAddress(o.claudeDir, platform);
  const token = newToken();
  const tokenBytes = Buffer.from(token);
  const registered = new Map<string, Hooked & { socket: Socket }>();
  const sockets = new Set<Socket>();
  // By bytes: a token of as many characters, some of them not ASCII, is longer in bytes.
  const hasToken = (m: { token?: unknown }) => typeof m.token === "string" && Buffer.byteLength(m.token) === tokenBytes.length && timingSafeEqual(Buffer.from(m.token), tokenBytes);

  const register = (socket: Socket, hello: PipeHello) => {
    let gone = () => {};
    const closed = new Promise<void>((resolve) => (gone = resolve));
    const entry: Hooked & { socket: Socket } = {
      session: hello.session,
      cwd: hello.cwd,
      since: hello.since,
      messages: hello.messages === true,
      root: hello.root,
      version: hello.version,
      env: hello.env && typeof hello.env === "object" ? sessionEnv(hello.env) : {},
      socket,
      closed,
      send: (line) => {
        writeLine(socket, line);
        if (line.type === "superseded") socket.end();
      },
    };
    socket.on("close", () => {
      gone();
      if (registered.get(entry.session) !== entry) return;
      registered.delete(entry.session);
      o.onChange(entry.session);
    });
    const current = registered.get(hello.session);
    if (current && !keeps(entry, current)) {
      entry.send({ type: "superseded", reason: compareVersions(entry.version, current.version) < 0 ? "newer" : "window" });
      return;
    }
    registered.set(hello.session, entry);
    if (current) current.send({ type: "superseded", reason: compareVersions(current.version, entry.version) < 0 ? "newer" : "window" });
    o.onChange(hello.session);
  };

  const answer = async (socket: Socket, request: PipeAsk) => {
    const hooked = registered.get(request.session);
    const text = hooked ? await o.ask({ ...request, cwd: hooked.cwd }).catch((err: unknown) => `The room couldn't be asked: ${String((err as Error)?.message ?? err)}. Carry on without the answer.`) : NOT_CONNECTED;
    writeLine(socket, { type: "answer", text });
    socket.end();
  };

  const close = async (socket: Socket, request: PipeClose) => {
    const closed = o.close ? await o.close(request.close).catch((err: unknown) => (o.log(`couldn't close ${request.close}: ${String((err as Error)?.message ?? err)}`), false)) : false;
    writeLine(socket, { type: "closed", closed });
    socket.end();
  };

  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket)).on("error", () => {});
    let said = false;
    let greeted = false;
    readLines(socket, (value) => {
      const m = (value ?? {}) as Partial<PipeHello & PipeAsk>;
      const hi = m as Partial<PipeHi>;
      if (!said && !greeted && hi.type === "hi" && typeof hi.nonce === "string" && hi.nonce.length <= 200) {
        greeted = true;
        return writeLine(socket, { type: "proof", proof: proofOf(token, hi.nonce) });
      }
      // One message per connection after the hi; any other, or one without the token, closes it.
      if (said || !hasToken(m)) return void socket.destroy();
      said = true;
      if (isHello(m)) return register(socket, m);
      if (isAsk(m)) return void answer(socket, m);
      if (isClose(m)) return void close(socket, m);
      socket.destroy();
    });
  });
  await preparePipe(address, platform);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(address, () => (server.off("error", reject), resolve()));
  });
  server.on("error", (err) => o.log(`the runner's pipe: ${err.message}`));
  await writePipeInfo(o.claudeDir, { address, token });
  return {
    address,
    hooked: (session) => registered.get(session) ?? null,
    all: () => [...registered.values()],
    async close() {
      const closing = new Promise<void>((resolve) => server.close(() => resolve()));
      for (const socket of sockets) socket.destroy();
      await closing;
    },
  };
}
