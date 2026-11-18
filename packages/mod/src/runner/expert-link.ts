// Listing this machine's experts to one office server, over the runner's link to it.
//
// A connection lists nothing before the server's first `hosting` on it: a server from before
// experts never sends one, and would close the link on an `experts` it can't parse. After it, the
// listing is worked out again on every `hosting`, whenever the experts change, and every `checkMs`,
// and sent only when it differs from what was last sent on that connection; the first on a
// connection always goes, even an empty one. With no approved list from the server, nothing is
// sent, so the server keeps what it has; nor while the secret patterns can't be read, which would
// leave every expert out. Each working-out runs after the one before, so listings
// go out in order, each built from the experts as they are when it runs.
//
// When a junior first asks its senior for one of this server's requests, the server is told
// (`expert-senior`, with the request's id alone), live too: only while the link is up and only when
// the connection's last `hosting` said it reads them (`expertSenior`). One that can't go is dropped.

import { ExpertsMessageSchema, PROTOCOL_VERSION, type ExpertSeniorMessage, type ExpertsMessage, type HostingMessage, type Project } from "@isoplan/protocol";
import type { Approved } from "../data-layer/approved.js";
import { listingFor, type Experts } from "./experts.js";

export interface HostExpertsOptions {
  experts: Pick<Experts, "hosted" | "onChange" | "listed">;
  approved: Pick<Approved, "refresh" | "repos">;
  /** The project a folder is in, when the approved list takes it. */
  home: (folder: string, repos: ReadonlySet<string>) => Promise<Project | null>;
  scan: (text: string) => Promise<string | null>;
  log: (text: string) => void;
  /** Sends on the link while it is up; false when it isn't. */
  send: (m: ExpertsMessage) => boolean;
  /** The same live send, for `expert-senior`; without it none goes. */
  sendSenior?: (m: ExpertSeniorMessage) => boolean;
  server: string;
  checkMs: number;
}

export interface HostExperts {
  onHosting(m: HostingMessage): void;
  /** A junior first asked its senior for the request `id`, which this server sent. */
  senior(id: string): void;
  onOpen(): void;
  onClose(): void;
  stop(): void;
}

export function hostExperts(o: HostExpertsOptions): HostExperts {
  let connection = 0; // moves on with each open and close, so work for an old connection sends nothing
  let hosting = false; // this connection has had a `hosting`
  let expertSenior = false; // its last `hosting` said it reads `expert-senior`
  let last: string | null = null; // the listing last sent on this connection
  let stopped = false;
  let chain: Promise<void> = Promise.resolve();
  let saidNoList = false;
  let said = new Set<string>();

  // Each line once while it holds: the timer works the listing out every few minutes.
  const quiet = () => {
    const now = new Set<string>();
    return {
      log: (text: string) => {
        now.add(text);
        if (!said.has(text)) o.log(text);
      },
      done: () => (said = now),
    };
  };

  async function sync(force: boolean, mine: number) {
    if (stopped || mine !== connection || !hosting) return;
    await o.approved.refresh(force);
    const repos = o.approved.repos();
    if (!repos) {
      if (!saidNoList) o.log(`no approved list from ${o.server}, so the experts aren't listed there yet`);
      saidNoList = true;
      return;
    }
    saidNoList = false;
    const q = quiet();
    const experts = await listingFor(o.experts.hosted(), (folder) => o.home(folder, repos), o.scan, q.log);
    if (!experts) q.log(`the secret patterns can't be read, so the experts listing for ${o.server} isn't changed`);
    q.done();
    if (!experts || stopped || mine !== connection) return;
    const message: ExpertsMessage = { type: "experts", v: PROTOCOL_VERSION, experts };
    const text = JSON.stringify(experts);
    if (text === last) return;
    if (!ExpertsMessageSchema.safeParse(message).success) return o.log(`the experts listing for ${o.server} doesn't fit the protocol, so it isn't sent`);
    if (o.send(message)) last = text;
  }

  const queue = (force: boolean) => {
    const mine = connection;
    chain = chain.then(() => sync(force, mine)).catch((err: Error) => o.log(`couldn't list the experts to ${o.server}: ${err.message}`));
  };
  const fresh = () => {
    connection++;
    hosting = false;
    expertSenior = false;
    last = null;
  };

  o.experts.onChange(() => hosting && queue(false));
  const timer = setInterval(() => hosting && queue(false), o.checkMs);
  timer.unref?.();

  return {
    onHosting(m) {
      o.experts.listed(o.server, m.listed);
      hosting = true;
      expertSenior = m.expertSenior === true;
      queue(true);
    },
    senior(id) {
      if (stopped || !hosting || !expertSenior) return;
      o.sendSenior?.({ type: "expert-senior", v: PROTOCOL_VERSION, id });
    },
    onOpen: fresh,
    onClose: fresh,
    stop() {
      stopped = true;
      clearInterval(timer);
    },
  };
}
