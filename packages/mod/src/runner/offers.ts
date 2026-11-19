// Expert offers (isoplan-app#328, ADR 0013): the runner notices when a session on this computer
// would have been helped by an expert on one folder of its repo, drafts one with a local model and
// offers it, once per session and folder, to each office that may be told of the folder's repo.
// Whoever picks it up on the floor makes it on one of their own computers: that computer's runner
// writes the expert file and says how making it goes until the expert is ready.
//
// - The signals are the session's areas (data-layer/claude-code.ts), each pass's as one office may
//   be told of them (report-session.ts SessionAreas). A folder passes when what its reads and
//   searches took is `contextShare` of the session's context window or more (the window its hooks
//   module said, else its model's, expert-meter.ts), or `tokens`; or its calls took `minutes`; or
//   the person corrected the agent there `corrections` times: runner.json's `expertOffers`. Of the
//   folders that pass, the deepest is offered. Never one the session was offered, or one inside or
//   above it; never one the person dismissed in any office (`offer-dismissals`: until its time, or
//   for good), nor one inside it; and never one an expert on this computer covers, by its file's
//   areas (the protocol's areaCovers, the rule the office uses too). The office checks other
//   computers' experts itself. A folder whose draft couldn't be made, and the folders inside and
//   above it, wait RETRY_MS for that session before one is tried again, a restart included. Which
//   sessions and folders were offered, the folders waiting, the offers and the experts being made
//   are kept in <claude dir>/isoplan/runner/offers.json, the first two for `rememberDays`. One that
//   can't be read as this runner writes it is logged and moved aside (offers.json.unreadable-<ms>),
//   and offering starts again from nothing. While runner.json can't be read, each pass logs it and
//   the next tries again.
// - The draft: a `claude -p` call with no tools and no hooks (offer-model.ts, prompts/expert-draft.md,
//   `draftModel`), on the person's own Claude account: what it is given goes only to that account,
//   never to the office. It writes the expert's key, subject and proof question with its answer, from the
//   names of the folder's files (in the session's checkout, at most MAX_FILES), the start of the
//   first few that read as text (EXCERPT_FILES, EXCERPT_CHARS each), which its proof is taken
//   from, and what the session said there. Its area is the folder alone. The whole draft, its
//   folder included, passes the secret scan before any of it is sent; a match, or patterns that
//   can't be read, means no offer, logged. A folder that matches isn't drafted at all.
// - Nothing goes on a connection before its first `offer-dismissals` (protocol 0.15.0): an offer, an
//   answer and making's progress wait for it, and then go live (link.ts sendLive). Nor is a
//   session's pass looked at before the office it came for has said them, so a runner started again
//   never offers a folder its person dismissed. An offer goes to each office whose latest pass of
//   the session may name the offer's repo (the session's own, or another repo that office holds),
//   never to one whose dismissals name its folder; one dismissed in any office is withdrawn from
//   the others.
// - An office that sees several sessions search one folder asks the runner of the latest to draft
//   an office-wide offer (`draft-offer`): drafted the same way, from the newest of those sessions
//   this runner reported to it, it goes to that office alone as scope `office`, with the request's
//   id, or `no-draft` goes back when none could be made. The same request again, while one is being
//   drafted or once it was, changes nothing.
// - An office ends an offer it won't keep at once: `dismissed`, or `made` with the key of an expert
//   that covers its folder already. So an offer counts as open in an office only once `keptMs` has
//   passed since it went there with no end; one sent on a connection that closed first goes again
//   on the next, which the office takes as the same offer.
// - While an offer is open, the session that showed the need is told through its hooks module, if
//   it is on this computer (lines.ts ExpertOfferLine), and again each time a hooks module connects
//   for it; and when the offer ends. Made or dismissed in one office, it is withdrawn from the
//   others; made, the session is told the expert is ready (ExpertReadyLine), once, by the next hooks module to connect
//   when none is now. The open offers of each session are also in
//   <claude dir>/isoplan/offers/<session>.json, `{ "offers": ExpertOfferLine[] }`, for
//   /isoplan:expert; the file goes when none is open.
// - Make expert (`make-expert`), only for this runner's own person (`by`): it finds this computer's
//   checkout of the repo as New session finds folders (repo-folders.ts). With none, it clones the
//   repo for the expert alone into Isoplan's own hidden folder (isoplan-clone.ts, as a hidden start
//   does; never into the person's folders), from https://<project id>.git, saying `cloning` while
//   it runs; a repo with no remote, or a clone git refuses, fails making with git's reason. An
//   expert of that name here already fails it at once, saying why. Else it writes
//   experts/<key>.json, naming the checkout or the clone as its `repo`, whole or not at all, which
//   the experts' watcher picks up (experts.ts), and follows the expert's state.json
//   (expert-state.ts) every `pollMs`, saying each step (`expert-making`): cloning (its own clone),
//   grounding, proof, then ready or failed, within MAKING_LIMIT_MS. A making that fails after
//   writing the file removes it, so the watcher stops that expert and its listing drops it; a
//   make-expert of the same key after it starts fresh, once that expert has stopped (CLEARED_MS at
//   most). A making stays in offers.json until its last state went on a live connection: a runner
//   started again sends a last state that hadn't gone, and goes on following the makings it had
//   under way, on their requests; a make-expert for the same offer and key as one under way, as the
//   office sends once that runner is back, takes it over.
// - Whether the person's message corrected the agent (`corrected`) is a `claude -p` call's word too
//   (prompts/correction.md, `draftModel`), on the person's own Claude account, never the office's:
//   one call at a time and at most `checksPerHour`; until it comes the message counts nothing, and
//   each later pass asks again, so a check that couldn't run is tried again.

import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {
  areaCovers,
  expertDisplayName,
  ExpertOfferMessageSchema,
  PROTOCOL_VERSION,
  type AreaFact,
  type DraftOfferMessage,
  type ExpertMakingState,
  type ExpertOfferMessage,
  type MakeExpertMessage,
  type OfferDismissal,
  type Project,
  type ServerExpertOfferEndedMessage,
} from "@isoplan/protocol";
import type { RunnerOfferMessage, ServerOfferMessage } from "../data-layer/link.js";
import type { SessionAreas } from "../data-layer/report-session.js";
import type { DataLayerLine, ExpertOfferLine } from "../lines.js";
import { parseExpertFile } from "./expert-file.js";
import { windowFor } from "./expert-meter.js";
import { readState } from "./expert-state.js";
import type { HostedExpert } from "./expert.js";
import type { Draft, DraftInput, OfferModelSettings } from "./offer-model.js";

/** runner.json's `expertOffers`. */
export interface ExpertOfferSettings extends OfferModelSettings {
  /** The share of the session's context window a folder's reads and searches took, from 0 to 1. */
  contextShare: number;
  tokens: number;
  minutes: number;
  corrections: number;
  /** How long an offered session and folder, and an offer, are remembered. */
  rememberDays: number;
  /** The expert file's promoteAtTokens for an expert made from an offer. */
  promoteAtTokens: number;
  /** The most correction checks an hour. */
  checksPerHour: number;
}

export interface OfferSettings {
  expertOffers: ExpertOfferSettings;
}

/** Why an offer is made: the signals of its folder. */
export type Why = ExpertOfferMessage["why"];

/** An office this runner answers for, by its index in the offices' list. */
export interface OfferOffice {
  /** Its data-layer address. */
  server: string;
  /** Its short name, as on the status line. */
  label?: string;
  /** Sends on its link while it is up; false when it isn't. */
  send(message: RunnerOfferMessage): boolean;
}

export interface OffersOptions {
  /** <claude dir>/isoplan */
  isoplanDir: string;
  settings: () => Promise<OfferSettings>;
  offices: readonly OfferOffice[];
  /** This runner's person: a make-expert for anyone else is refused. */
  account: { id: string };
  /** The name of the secret pattern `text` matches, UNREADABLE when they can't be read, or null. */
  scan: (text: string) => Promise<string | null>;
  draft: (input: DraftInput, settings: ExpertOfferSettings) => Promise<Draft | null>;
  /** Whether a message corrected the agent; null when no word came. */
  corrects: (text: string, reply: string | null, settings: ExpertOfferSettings) => Promise<boolean | null>;
  /** The experts this computer hosts. */
  experts: () => HostedExpert[];
  /** The project id of the repo a folder is in, lower-cased; null when there is none. */
  projectOf: (folder: string) => Promise<string | null>;
  /** This computer's checkout of `project`, as the office at `index` takes it (repo-folders.ts); null when there is none. */
  checkout: (index: number, project: Project) => Promise<string | null>;
  /** Isoplan's own hidden clone of `project` (an id), made from `url` or fetched (isoplan-clone.ts): its folder, or why there is none, with git's own words when git failed. */
  clone: (url: string, project: string) => Promise<string | { problem: string; reason?: string }>;
  /** The session's hooks module, while one is connected. */
  hooked: (bare: string) => { send(line: DataLayerLine): void } | null;
  log: (text: string) => void;
  now?: () => number;
  /** How often an expert being made is looked at. */
  pollMs?: number;
  /** How long an offer that went to an office must go unended there to count as open (KEPT_MS). */
  keptMs?: number;
}

export interface Offers {
  /** Reads offers.json: before it settles, nothing is offered. The makings under way when the runner stopped are followed again. */
  start(): Promise<void>;
  /** One pass's areas of a session for one office (report-session.ts `areas`). */
  seen(s: SessionAreas): void;
  /** report-session.ts `corrected`. */
  corrected(key: string, text: string, reply: string | null): boolean | null;
  /** A message from the office at `index`. */
  take(index: number, message: ServerOfferMessage): void;
  /** The office's link opened, or closed: nothing goes on it until its next offer-dismissals. */
  linked(index: number): void;
  /** A session's hooks module connected, changed or went (pipe server's onChange). */
  rehooked(bare: string): void;
  /** No draft, check, making or offer waiting to be kept under way. */
  idle(): boolean;
  close(): void;
}

/** The most files of a folder a draft is given by name; and of those, the most it is given the start of, and how much. */
export const MAX_FILES = 200;
export const EXCERPT_FILES = 6;
export const EXCERPT_CHARS = 3000;
/** How long making an expert may take before it is said to have failed. */
export const MAKING_LIMIT_MS = 60 * 60000;
/** How long an office has to end an offer it won't keep, which it does at once, before it counts as open there. */
export const KEPT_MS = 5000;
/** How long a folder whose draft couldn't be made waits, for that session, before it is tried again. */
export const RETRY_MS = 60 * 60000;
/** How long a make of a key whose making failed here waits for the expert it left to stop: two of the experts' watcher's looks, and more. */
export const CLEARED_MS = 60000;
// The most messages waiting for the correction check, and verdicts remembered.
const MAX_CHECKS_WAITING = 50;
const MAX_VERDICTS = 1000;
// The most sessions whose latest pass is kept for office-wide drafts, the least recently seen going first.
const MAX_SESSIONS = 200;
// How long an expert's repo's project, and runner.json's expertOffers, are believed.
const PROJECT_MS = 5 * 60000;
const SETTINGS_MS = 5000;
const HOUR_MS = 3600000;
const DAY_MS = 86400000;
const FILE_VERSION = 1;

/** The address of an offer's review on the office's floor: its http address, with `/?offer=<id>`. */
export function reviewUrl(server: string, id: string): string {
  const url = new URL(server);
  url.protocol = url.protocol === "wss:" ? "https:" : "http:";
  url.pathname = url.pathname.replace(/\/data-layer\/?$/, "") + "/";
  url.search = `offer=${id}`;
  url.hash = "";
  return url.toString();
}

/** A folder's signals, given the session's context window (null when it isn't known): its minutes to a tenth, rounded down. */
export function signalsOf(area: AreaFact, window: number | null): Why {
  return { share: window ? Math.min(1, area.tokens / window) : 0, tokens: area.tokens, minutes: Math.floor(area.ms / 6000) / 10, corrections: area.corrections };
}

/** Whether a folder's signals pass any of their thresholds. */
export const passes = (why: Why, t: ExpertOfferSettings) => why.share >= t.contextShare || why.tokens >= t.tokens || why.minutes >= t.minutes || why.corrections >= t.corrections;

/** The signals an offer gives (ADR 0004): those that passed their thresholds, each other one 0. Share and tokens are one signal, what reading and searching there took. */
export function passed(why: Why, t: ExpertOfferSettings): Why {
  const spent = why.share >= t.contextShare || why.tokens >= t.tokens;
  return { share: spent ? why.share : 0, tokens: spent ? why.tokens : 0, minutes: why.minutes >= t.minutes ? why.minutes : 0, corrections: why.corrections >= t.corrections ? why.corrections : 0 };
}

// `folder` is `other`, or inside it; or either is inside the other.
const within = (folder: string, other: string) => other === "." || folder === other || folder.startsWith(other + "/");
const near = (a: string, b: string) => within(a, b) || within(b, a);

/** Whether the person dismissed `folder` of `project` (a lower-cased id), or a folder it is inside, as of `now`. */
export const dismissed = (list: readonly OfferDismissal[], project: string, folder: string, now: number) =>
  list.some((d) => d.project.toLowerCase() === project && within(folder, d.folder) && (d.forever === true || Date.parse(d.until ?? "") > now));

/** The address Isoplan's own clone of a project is made from where this computer has no checkout: https, from its id; null for a repo with no remote. */
export const cloneUrl = (project: string) => (project.startsWith("local:") ? null : `https://${project}.git`);

/** The files under `folder` of `checkout`, relative to it, by name, at most `max`; dot entries and node_modules left out. */
export async function folderFiles(checkout: string, folder: string, max = MAX_FILES): Promise<string[]> {
  const out: string[] = [];
  const queue = [folder === "." ? "" : folder];
  while (queue.length && out.length < max) {
    const rel = queue.shift()!;
    const entries = await fs.readdir(path.join(checkout, rel), { withFileTypes: true }).catch(() => []);
    for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (e.name.startsWith(".") || e.name === "node_modules") continue;
      const p = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) queue.push(p);
      else if (e.isFile() && out.length < max) out.push(p);
    }
  }
  return out;
}

/** The start of the first `max` of `files` (relative to `checkout`) that read as text, each at most EXCERPT_CHARS; an empty file, or one with a NUL byte, is left out. */
export async function folderExcerpts(checkout: string, files: readonly string[], max = EXCERPT_FILES): Promise<{ file: string; text: string }[]> {
  const out: { file: string; text: string }[] = [];
  for (const file of files) {
    if (out.length >= max) break;
    const handle = await fs.open(path.join(checkout, file), "r").catch(() => null);
    if (!handle) continue;
    try {
      // Enough bytes for EXCERPT_CHARS characters of any UTF-8.
      const { bytesRead, buffer } = await handle.read(Buffer.alloc(EXCERPT_CHARS * 4), 0, EXCERPT_CHARS * 4, 0);
      const bytes = buffer.subarray(0, bytesRead);
      const text = bytes.includes(0) ? "" : bytes.toString("utf8").slice(0, EXCERPT_CHARS).trim();
      if (text) out.push({ file, text });
    } catch {
      // One that can't be read is left out.
    } finally {
      await handle.close().catch(() => {});
    }
  }
  return out;
}

// What a write leaves while it is under way: never a file the experts' watcher reads (*.json).
async function writeWhole(file: string, text: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(temp, text);
  // On Windows a reader that has the file open makes the rename fail for a moment.
  for (let tries = 0; ; tries++) {
    try {
      return await fs.rename(temp, file);
    } catch (err) {
      if (tries >= 5 || !["EPERM", "EBUSY", "EACCES"].includes((err as NodeJS.ErrnoException).code ?? "")) throw err;
      await new Promise((r) => setTimeout(r, 50 * (tries + 1)));
    }
  }
}

/** Where an offer is in one office: waiting for its connection, sent there but not yet kept (KEPT_MS), open there, or ended. */
type OfficeOffer = "pending" | "sent" | "open" | "ended";

/** One offer this runner made, as offers.json keeps it. */
interface OfferRecord {
  id: string;
  scope: "session" | "office";
  /** The session that showed the need, as its facts name it, and its bare id. */
  session: string;
  bare: string | null;
  project: Project;
  folder: string;
  key: string;
  at: number;
  message: ExpertOfferMessage;
  /** Where it is, by office. */
  offices: Record<string, OfficeOffer>;
  /** The expert made from it, in which office, and whether the session has been told. */
  made?: { key: string; server: string };
  told?: boolean;
}

interface Saved {
  version: number;
  /** Each session's folders offered, and when. */
  offered: { session: string; project: string; folder: string; at: number }[];
  offers: OfferRecord[];
  /** The experts being made here, by the office the request came from, until their last state, ready or failed, went to it. */
  makings: { request: string; offer: string; key: string; since: number; server: string; state?: "ready" | "failed"; detail?: string }[];
  /** Folders whose draft couldn't be made, by session, until they may be tried again. */
  held: { session: string; project: string; folder: string; until: number }[];
}

/** An expert being made here. */
interface Making {
  index: number;
  request: string;
  offer: string;
  key: string;
  since: number;
  state: ExpertMakingState;
  detail?: string;
  /** The state last sent on the office's connection. */
  sent: string | null;
  /** Whether this making wrote its expert file, which goes again if it fails. */
  wrote: boolean;
  timer: ReturnType<typeof setTimeout> | null;
}

export function createOffers(o: OffersOptions): Offers {
  const now = o.now ?? Date.now;
  const pollMs = o.pollMs ?? 2000;
  const keptMs = o.keptMs ?? KEPT_MS;
  const file = path.join(o.isoplanDir, "runner", "offers.json");
  const sessionFile = (bare: string) => path.join(o.isoplanDir, "offers", `${bare}.json`);
  const expertFile = (key: string) => path.join(o.isoplanDir, "experts", `${key}.json`);
  const offices = o.offices.map(() => ({ ready: false, dismissals: [] as OfferDismissal[], queue: [] as RunnerOfferMessage[] }));
  let saved: Saved = { version: FILE_VERSION, offered: [], offers: [], makings: [], held: [] };
  let started = false;
  let closed = false;
  // The latest pass of each session for each office that took it, by the session's id: which
  // offices may be told of which of its repos, and what office-wide drafts are made from.
  const latest = new Map<string, Map<string, SessionAreas>>();
  const busy = new Set<string>(); // the sessions whose areas are being looked at, or drafted from
  const draftingOffers = new Set<string>(); // the draft-offer requests being drafted
  // The keys whose expert file a failed making removed, until the experts' watcher has stopped that expert.
  const cleared = new Set<string>();
  // The offers sent to an office and not yet kept there, by `<id>\n<server>`: each one's wait.
  const keeping = new Map<string, ReturnType<typeof setTimeout>>();
  const makings = new Map<string, Making>();
  // The correction check: verdicts by key, the messages waiting, and when each check of the last hour ran.
  const verdicts = new Map<string, boolean>();
  const waiting: { key: string; text: string; reply: string | null }[] = [];
  const checked: number[] = [];
  let checking = false;
  let checkTimer: ReturnType<typeof setTimeout> | null = null;
  let saving: Promise<void> = Promise.resolve();

  // Read again at most every SETTINGS_MS: every session's pass looks at them.
  let read: { at: number; settings: Promise<ExpertOfferSettings> } | null = null;
  const settings = () => {
    if (!read || now() - read.at > SETTINGS_MS) read = { at: now(), settings: o.settings().then((s) => s.expertOffers) };
    const mine = read;
    return mine.settings.catch((err: unknown) => (read === mine && (read = null), Promise.reject(err)));
  };
  const indexOf = (server: string) => o.offices.findIndex((f) => f.server === server);
  const say = (text: string) => o.log(text);
  const done = (m: Making) => m.state === "ready" || m.state === "failed";

  const save = () => {
    const copy = JSON.stringify(saved, null, 2) + "\n";
    saving = saving.then(() => writeWhole(file, copy)).catch((err: Error) => say(`couldn't save the expert offers: ${err.message}`));
    return saving;
  };

  // What the session's hooks module is told of an offer open in one office.
  const lineOf = (r: OfferRecord, server: string): ExpertOfferLine => {
    const label = o.offices[indexOf(server)]?.label;
    return { type: "expert-offer", server, ...(label && { label }), id: r.id, key: r.key, name: expertDisplayName(r.key), folder: r.folder, url: reviewUrl(server, r.id), why: r.message.why };
  };
  const tell = (r: OfferRecord, line: DataLayerLine) => (r.bare ? o.hooked(r.bare)?.send(line) : undefined);

  // The session's file of its open offers, for /isoplan:expert; gone when none is open. One write at
  // a time for each session, each with the offers open as it runs.
  const sessionWrites = new Map<string, Promise<void>>();
  function writeSessionFile(bare: string | null) {
    if (!bare || !/^[\w-]{1,200}$/.test(bare)) return;
    const write = async () => {
      const open = saved.offers.filter((r) => r.bare === bare).flatMap((r) => Object.entries(r.offices).filter(([, s]) => s === "open").map(([server]) => lineOf(r, server)));
      if (open.length) await writeWhole(sessionFile(bare), JSON.stringify({ offers: open }, null, 2) + "\n");
      else await fs.rm(sessionFile(bare), { force: true });
    };
    const next = (sessionWrites.get(bare) ?? Promise.resolve())
      .then(write)
      .catch((err: Error) => say(`couldn't write the open expert offers of session ${bare}: ${err.message}`))
      .finally(() => sessionWrites.get(bare) === next && sessionWrites.delete(bare));
    sessionWrites.set(bare, next);
  }

  // Sends what waits for the office at `index`, once its connection has had offer-dismissals. An
  // offer whose folder its dismissals name isn't sent, and is withdrawn wherever else it went.
  function flush(index: number) {
    const office = o.offices[index]!;
    const st = offices[index]!;
    if (!st.ready || closed) return;
    while (st.queue.length && office.send(st.queue[0]!)) st.queue.shift();
    let changed = false;
    for (const r of saved.offers) {
      if (r.offices[office.server] !== "pending") continue;
      if (dismissed(st.dismissals, r.project.id.toLowerCase(), r.folder, now())) {
        r.offices[office.server] = "ended";
        changed = true;
        say(`the expert offer ${r.id} on ${r.folder} of ${r.project.name} isn't sent to ${office.server}, where its person dismissed that folder, and is withdrawn wherever else it went`);
        withdraw(r);
        writeSessionFile(r.bare);
        continue;
      }
      if (!office.send(r.message)) continue;
      r.offices[office.server] = "sent";
      changed = true;
      say(`offered an expert on ${r.folder} of ${r.project.name} (${r.key}) to ${office.server}, as ${r.id}`);
      keep(r, office.server);
    }
    if (changed) void save();
    for (const m of makings.values()) if (m.index === index) sendMaking(m);
  }

  // An offer the office hasn't ended within keptMs of its going is open there, and its session is told.
  function keep(r: OfferRecord, server: string) {
    const k = `${r.id}\n${server}`;
    clearTimeout(keeping.get(k));
    const timer = setTimeout(() => {
      keeping.delete(k);
      if (closed || r.offices[server] !== "sent") return;
      r.offices[server] = "open";
      tell(r, lineOf(r, server));
      writeSessionFile(r.bare);
      void save();
    }, keptMs);
    timer.unref?.();
    keeping.set(k, timer);
  }

  // Ends the offer in every office it hasn't ended in: one it went to is told it is withdrawn, and
  // the session of one open there that it went.
  function withdraw(r: OfferRecord) {
    for (const [other, state] of Object.entries(r.offices)) {
      if (state === "ended") continue;
      r.offices[other] = "ended";
      const i = indexOf(other);
      if (state === "pending" || i < 0) continue;
      sendOrQueue(i, { type: "expert-offer-ended", v: PROTOCOL_VERSION, id: r.id, why: "withdrawn" });
      if (state === "open") tell(r, { type: "expert-offer-ended", server: other, id: r.id, why: "withdrawn" });
    }
  }

  // Sends now when the office's connection is ready and up; else it waits there for flush.
  function sendOrQueue(index: number, message: RunnerOfferMessage) {
    const st = offices[index]!;
    if (!(st.ready && o.offices[index]!.send(message))) st.queue.push(message);
  }

  // Whether an expert on this computer covers `folder` of `project`. Its repo's project is looked up
  // again only every PROJECT_MS, since a covered folder that passes is looked at every pass.
  const expertProjects = new Map<string, { at: number; project: Promise<string | null> }>();
  async function coveredHere(project: string, folder: string) {
    for (const e of o.experts()) {
      if (!e.areas?.length || !areaCovers(e.areas, folder)) continue;
      let hit = expertProjects.get(e.repo);
      if (!hit || now() - hit.at > PROJECT_MS) expertProjects.set(e.repo, (hit = { at: now(), project: o.projectOf(e.repo).catch(() => null) }));
      if ((await hit.project) === project) return true;
    }
    return false;
  }

  const offeredNear = (session: string, project: string, folder: string) => saved.offered.some((x) => x.session === session && x.project === project && near(folder, x.folder));
  const heldNear = (session: string, project: string, folder: string, at: number) =>
    (saved.held = saved.held.filter((x) => x.until > at)).some((x) => x.session === session && x.project === project && near(folder, x.folder));

  // The repos an office's pass of a session may name, lower-cased: the session's own as it says
  // hello there, and the others its areas were let through for (report-session.ts).
  const names = (s: SessionAreas) => new Set([s.project, ...s.areas.map((a) => a.project ?? s.project)].map((p) => p.id.toLowerCase()));
  // The offices whose latest pass of the session may name `project`.
  const mayTell = (session: string, project: string) => [...(latest.get(session)?.values() ?? [])].filter((p) => names(p).has(project)).map((p) => p.server);

  // What is older than rememberDays goes: offered folders and offers, ended or not.
  function forget(t: ExpertOfferSettings, at: number) {
    const keep = t.rememberDays * DAY_MS;
    saved.offered = saved.offered.filter((x) => at - x.at < keep);
    saved.offers = saved.offers.filter((r) => at - r.at < keep);
  }

  const windowOf = (s: SessionAreas) => {
    if (s.window) return s.window;
    const w = s.model ? windowFor(s.model) : null;
    return w && w.ok ? w.window : null;
  };

  // The draft of an expert on `folder`, secret-checked, as an expert-offer; null when there is none to send.
  async function drafted(a: { id: string; scope: "session" | "office"; session: string; project: Project; folder: string; checkout: string | null; said: string[]; why: Why }, t: ExpertOfferSettings): Promise<ExpertOfferMessage | null> {
    const where = `${a.folder} of ${a.project.name}`;
    if (!a.checkout) {
      say(`no expert is offered on ${where}: this computer has no checkout of the repo to draft it from`);
      return null;
    }
    // Its folder leaves with it, so one that matches isn't drafted (nor written in the log).
    const named = await o.scan(a.folder);
    if (named) {
      say(`no expert is offered on a folder of ${a.project.name}: its path matches the secret pattern "${named}"`);
      return null;
    }
    const files = await folderFiles(a.checkout, a.folder);
    const excerpts = await folderExcerpts(a.checkout, files);
    if (!excerpts.length) {
      say(`no expert is offered on ${where}: none of its files could be read to draft it from`);
      return null;
    }
    const draft = await o.draft({ project: a.project, folder: a.folder, files, excerpts, said: a.said }, t);
    if (!draft) {
      say(`no expert is offered on ${where}: no usable draft came`);
      return null;
    }
    // The whole draft, its folder (its one area) included.
    const matched = await o.scan([a.folder, draft.key, draft.subject, draft.proof.question, draft.proof.answer].join("\n"));
    if (matched) {
      say(`no expert is offered on ${where}: its draft matches the secret pattern "${matched}"`);
      return null;
    }
    const message = { type: "expert-offer" as const, v: PROTOCOL_VERSION, id: a.id, session: a.session, project: { id: a.project.id, name: a.project.name }, folder: a.folder, scope: a.scope, key: draft.key, subject: draft.subject, area: [a.folder], proof: draft.proof, why: passed(a.why, t), at: new Date(now()).toISOString() };
    const parsed = ExpertOfferMessageSchema.safeParse(message);
    if (!parsed.success) {
      say(`no expert is offered on ${where}: its offer doesn't fit the protocol: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
      return null;
    }
    return parsed.data;
  }

  const record = (message: ExpertOfferMessage, bare: string | null, servers: Iterable<string>): OfferRecord => ({
    id: message.id,
    scope: message.scope,
    session: message.session,
    bare,
    project: message.project,
    folder: message.folder,
    key: message.key,
    at: now(),
    message,
    offices: Object.fromEntries([...servers].map((s) => [s, "pending" as const])),
  });

  // A session's pass, once the office it came for has said its person's dismissals: the deepest
  // folder that passes, not offered, held, dismissed or covered, is drafted and offered.
  async function consider(s: SessionAreas) {
    const index = indexOf(s.server);
    if (!offices[index]!.ready) return;
    const t = await settings();
    const window = windowOf(s);
    const at = now();
    forget(t, at);
    const candidates: { area: AreaFact; project: Project; why: Why }[] = [];
    for (const area of s.areas) {
      const project = area.project ?? s.project;
      const id = project.id.toLowerCase();
      const why = signalsOf(area, window);
      if (!passes(why, t) || offeredNear(s.session, id, area.folder) || heldNear(s.session, id, area.folder, at)) continue;
      if (offices.some((f) => dismissed(f.dismissals, id, area.folder, at))) continue;
      if (await coveredHere(id, area.folder)) continue;
      candidates.push({ area, project, why });
    }
    const depth = (folder: string) => folder.split("/").length;
    const best = candidates.sort((a, b) => depth(b.area.folder) - depth(a.area.folder) || b.area.tokens - a.area.tokens)[0];
    if (!best) return;
    const { area, project, why } = best;
    const id = project.id.toLowerCase();
    const checkout = area.project ? await o.checkout(index, project).catch(() => null) : s.checkout;
    const said = await s.said(area.project ? area.project.id : null, area.folder).catch(() => []);
    const message = await drafted({ id: randomBytes(12).toString("base64url"), scope: "session", session: s.session, project, folder: area.folder, checkout, said, why }, t);
    if (closed) return;
    if (!message) {
      saved.held.push({ session: s.session, project: id, folder: area.folder, until: now() + RETRY_MS });
      return void save();
    }
    saved.offered.push({ session: s.session, project: id, folder: area.folder, at });
    saved.offers.push(record(message, s.bare, new Set([s.server, ...mayTell(s.session, id)])));
    await save();
    o.offices.forEach((_, i) => flush(i));
  }

  // An office-wide draft, from the newest of the sessions it names that this runner reported to that office.
  async function draftOffer(index: number, m: DraftOfferMessage) {
    const server = o.offices[index]!.server;
    if (draftingOffers.has(m.request) || saved.offers.some((r) => r.id === m.request)) return;
    draftingOffers.add(m.request);
    try {
      const project = m.project.id.toLowerCase();
      const s = m.sessions.map((id) => latest.get(id)?.get(server)).find((x) => !!x);
      const area = s?.areas.find((a) => a.folder === m.folder && (a.project ?? s.project).id.toLowerCase() === project);
      const own = !!s && s.project.id.toLowerCase() === project && !area?.project;
      const checkout = own ? s!.checkout : await o.checkout(index, m.project).catch(() => null);
      const said = s ? await s.said(own ? null : m.project.id, m.folder).catch(() => []) : [];
      const why = area && s ? signalsOf(area, windowOf(s)) : { share: 0, tokens: 0, minutes: 0, corrections: 0 };
      const t = await settings();
      const message = await drafted({ id: m.request, scope: "office", session: m.sessions[0]!, project: m.project, folder: m.folder, checkout, said, why }, t);
      if (closed) return;
      if (!message) return sendOrQueue(index, { type: "expert-offer-ended", v: PROTOCOL_VERSION, id: m.request, why: "no-draft" });
      const first = m.sessions[0]!;
      // Its session isn't offered the same folder again on its own.
      saved.offered.push({ session: first, project, folder: m.folder, at: now() });
      saved.offers.push(record(message, first.startsWith("claude-code:") ? first.slice("claude-code:".length) : null, [server]));
      await save();
      flush(index);
    } finally {
      draftingOffers.delete(m.request);
    }
  }

  // How an offer ended in one office; made or dismissed there, it is withdrawn from the others. One that ended
  // before it was kept was never shown, so its session isn't told it ended.
  function ended(index: number, m: ServerExpertOfferEndedMessage) {
    const server = o.offices[index]!.server;
    const r = saved.offers.find((x) => x.id === m.id);
    if (!r || r.offices[server] === undefined) return say(`${server} says the expert offer ${m.id} ended, but this runner didn't offer it there`);
    const was = r.offices[server];
    r.offices[server] = "ended";
    if (was === "open") tell(r, { type: "expert-offer-ended", server, id: r.id, why: m.why });
    say(`the expert offer ${r.id} on ${r.folder} of ${r.project.name} ended in ${server}: ${m.why}`);
    if (m.why === "made") {
      r.made = { key: m.key, server };
      withdraw(r);
      tellReady(r);
    } else if (m.why === "dismissed") withdraw(r);
    void save();
    writeSessionFile(r.bare);
  }

  function tellReady(r: OfferRecord) {
    const hooks = r.made && !r.told && r.bare ? o.hooked(r.bare) : null;
    if (!hooks || !r.made) return;
    hooks.send({ type: "expert-ready", server: r.made.server, id: r.id, key: r.made.key, name: expertDisplayName(r.made.key), folder: r.folder });
    r.told = true;
    void save();
  }

  // Sends the making's state on its office's connection once it is ready, unless it went already. Its
  // last one sent on a live connection, it is done, and only then does offers.json let it go.
  function sendMaking(m: Making) {
    const text = `${m.state}\n${m.detail ?? ""}`;
    if (m.sent !== text && offices[m.index]!.ready && o.offices[m.index]!.send({ type: "expert-making", v: PROTOCOL_VERSION, request: m.request, offer: m.offer, state: m.state, ...(m.detail && { detail: m.detail }) })) m.sent = text;
    if (m.sent !== text || !done(m)) return;
    makings.delete(m.request);
    if (saved.makings.some((k) => k.request === m.request)) {
      saved.makings = saved.makings.filter((k) => k.request !== m.request);
      void save();
    }
  }

  function setMaking(m: Making, state: ExpertMakingState, detail?: string) {
    const changed = m.state !== state || m.detail !== detail;
    m.state = state;
    m.detail = detail;
    if (changed && done(m)) {
      say(`expert ${m.key}, made from offer ${m.offer}: ${state}${detail ? `: ${detail}` : ""}`);
      if (m.timer) clearTimeout(m.timer);
      m.timer = null;
      // Kept with its last state until that went, so a runner started again sends it as it was.
      const kept = saved.makings.find((k) => k.request === m.request);
      if (kept) {
        Object.assign(kept, { state, ...(detail && { detail }) });
        void save();
      }
      if (state === "failed" && m.wrote) void clear(m.key);
    }
    sendMaking(m);
  }

  // A failed making's expert file goes, so the experts' watcher stops that expert and its listing
  // drops it; a make of the same key may then start fresh.
  async function clear(key: string) {
    cleared.add(key);
    try {
      await fs.rm(expertFile(key), { force: true });
      say(`removed the expert file of ${key}, whose making failed, so this computer stops hosting it`);
    } catch (err) {
      say(`couldn't remove the expert file ${expertFile(key)}, whose making failed: ${(err as Error).message}`);
    }
  }

  // Whether the expert a failed making cleared has stopped here, waiting CLEARED_MS at most.
  async function stopped(key: string) {
    for (let waited = 0; o.experts().some((e) => e.name === key); waited += pollMs) {
      if (closed || waited >= CLEARED_MS) return false;
      await new Promise((r) => setTimeout(r, pollMs));
    }
    cleared.delete(key);
    return true;
  }

  // Where the expert being made stands, from its newest generation grounded since making began (a
  // folder an earlier expert of that name left has older ones), and the runner's view of it.
  async function follow(m: Making) {
    m.timer = null;
    if (closed || m.state === "ready" || m.state === "failed") return;
    const st = await readState(path.join(o.isoplanDir, "experts", m.key));
    const hosted = o.experts().find((e) => e.name === m.key);
    const g = st?.generations.filter((x) => x.groundedAt >= m.since).reduce<(typeof st.generations)[number] | null>((a, b) => (!a || b.n > a.n ? b : a), null) ?? null;
    if (g?.state === "junior" || g?.state === "senior") setMaking(m, "ready");
    else if (g?.state === "failed") setMaking(m, "failed", g.proof?.passed === false ? "its answer to the proof question didn't match the answer expected" : "its grounding failed; its health log on that computer says why");
    else if (!g && hosted?.state === "failed") setMaking(m, "failed", "its own copy of the repo couldn't be made");
    else if (now() - m.since > MAKING_LIMIT_MS) setMaking(m, "failed", `it wasn't ready within ${MAKING_LIMIT_MS / 60000} minutes`);
    else {
      setMaking(m, !g ? "cloning" : g.commit ? "proof" : "grounding");
      m.timer = setTimeout(() => void follow(m).catch((err: Error) => say(`couldn't follow expert ${m.key}: ${err.message}`)), pollMs);
      m.timer.unref?.();
    }
  }

  async function make(index: number, m: MakeExpertMessage) {
    if (makings.has(m.request)) return;
    const server = o.offices[index]!.server;
    // The same offer and key asked again, as the office asks once a runner that went mid-making is
    // back: the making under way answers it, from where it is.
    const same = m.by.id === o.account.id ? [...makings.values()].find((x) => x.offer === m.offer && x.key === m.key && x.state !== "failed") : undefined;
    if (same) {
      makings.delete(same.request);
      const kept = saved.makings.find((k) => k.request === same.request);
      if (kept) Object.assign(kept, { request: m.request, server });
      Object.assign(same, { request: m.request, index, sent: null });
      makings.set(m.request, same);
      say(`expert ${m.key}, made from offer ${m.offer}, is asked for again as ${m.request}: its making goes on`);
      void save();
      return sendMaking(same);
    }
    const making: Making = { index, request: m.request, offer: m.offer, key: m.key, since: now(), state: "cloning", sent: null, wrote: false, timer: null };
    makings.set(m.request, making);
    const fail = (detail: string) => setMaking(making, "failed", detail);
    if (m.by.id !== o.account.id) return fail("this computer's runner is someone else's, so it makes experts only for them");
    // A key whose making failed here is free once the expert it left has stopped.
    if (cleared.has(m.key) && !(await stopped(m.key))) return fail(`the expert named ${m.key}, whose making failed, is still stopping on this computer; try again in a minute`);
    const taken = o.experts().some((e) => e.name === m.key) || (await fs.stat(expertFile(m.key)).then(() => true, () => false));
    if (taken) return fail(`an expert named ${m.key} is already on this computer`);
    let checkout = await o.checkout(index, m.project).catch(() => null);
    if (!checkout) {
      // For the expert alone: Isoplan's own hidden clone, never one in the person's folders.
      const url = cloneUrl(m.project.id);
      if (!url) return fail(`this computer has no checkout of ${m.project.name}, and its repo has no remote to clone it from`);
      sendMaking(making);
      const clone = await o.clone(url, m.project.id);
      if (closed) return;
      if (typeof clone !== "string") return fail(`this computer has no checkout of ${m.project.name}, and Isoplan's own copy of it couldn't be made: ${clone.reason ?? clone.problem}`);
      checkout = clone;
    }
    const t = await settings();
    const body = { version: 1, name: m.key, repo: checkout, subject: m.subject, model: m.model, promoteAtTokens: t.promoteAtTokens, proof: m.proof, areas: m.area };
    const text = JSON.stringify(body, null, 2) + "\n";
    const parsed = parseExpertFile(text, `${m.key}.json`);
    if (!parsed.ok) return fail(`its expert file wouldn't be read: ${parsed.field} ${parsed.reason}`);
    try {
      await writeWhole(expertFile(m.key), text);
    } catch (err) {
      say(`couldn't write the expert file ${expertFile(m.key)}: ${(err as Error).message}`);
      return fail("its expert file couldn't be written on that computer");
    }
    making.wrote = true;
    say(`wrote the expert file for ${m.key}, made from offer ${m.offer} by ${m.by.name || m.by.id}, for ${checkout}`);
    saved.makings.push({ request: m.request, offer: m.offer, key: m.key, since: making.since, server });
    void save();
    await follow(making);
  }

  // The correction check, on the person's own Claude account (what it is given goes only there,
  // never to the office), one at a time, at most checksPerHour: past that, the next waits for the
  // hour's oldest check to be an hour old.
  async function check() {
    if (checking || closed || !waiting.length) return;
    checking = true;
    let again = false;
    try {
      const t = await settings();
      const at = now();
      while (checked.length && at - checked[0]! >= HOUR_MS) checked.shift();
      if (checked.length >= t.checksPerHour) {
        if (!checkTimer) {
          checkTimer = setTimeout(() => ((checkTimer = null), void check()), checked[0]! + HOUR_MS - at);
          checkTimer.unref?.();
        }
        return;
      }
      const next = waiting.shift()!;
      checked.push(at);
      again = true;
      const verdict = await o.corrects(next.text, next.reply, t);
      if (verdict !== null) {
        verdicts.set(next.key, verdict);
        if (verdicts.size > MAX_VERDICTS) verdicts.delete(verdicts.keys().next().value!);
      }
    } catch (err) {
      say(`couldn't check whether a message corrected the agent: ${(err as Error).message}`);
    } finally {
      checking = false;
    }
    if (again) void check();
  }

  const orLog = (what: string) => (err: Error) => say(`couldn't ${what}: ${err.message}`);

  return {
    async start() {
      const text = await fs.readFile(file, "utf8").catch((err: NodeJS.ErrnoException) => {
        if (err.code !== "ENOENT") say(`EXPERT OFFERS: couldn't read ${file} (${err.message}), so what was offered before isn't known and may be offered again`);
        return null;
      });
      if (text !== null) {
        let value: Saved | null = null;
        try {
          value = JSON.parse(text) as Saved;
        } catch {
          // Said below, with the file moved aside.
        }
        if (value?.version === FILE_VERSION && Array.isArray(value.offered) && Array.isArray(value.offers)) {
          saved = { ...value, makings: Array.isArray(value.makings) ? value.makings : [], held: Array.isArray(value.held) ? value.held : [] };
        } else {
          // Never overwritten in silence: it is kept beside, for whoever looks into why.
          const aside = `${file}.unreadable-${now()}`;
          const moved = await fs.rename(file, aside).then(
            () => `moved to ${aside}`,
            (err: Error) => `left where it is (${err.message})`,
          );
          say(`EXPERT OFFERS: ${file} isn't offers.json as this runner writes it, so it was ${moved}, and expert offers start again from nothing: folders offered before may be offered again`);
        }
      }
      // An offer sent before the runner stopped, and not yet kept, may not have reached its office: it goes again.
      for (const r of saved.offers) for (const [server, state] of Object.entries(r.offices)) if (state === "sent") r.offices[server] = "pending";
      // runner.json is read again on the next pass, which forgets what is old then.
      await settings().then(
        (t) => forget(t, now()),
        (err: Error) => say(`couldn't read runner.json's expertOffers as the expert offers started (${err.message}); it is read again on the next session's pass`),
      );
      started = true;
      // The makings under way when it stopped are followed again, on their requests, and one whose
      // last state hadn't gone is sent as it was; one for an office no longer listed goes.
      saved.makings = saved.makings.filter((k) => indexOf(k.server) >= 0);
      for (const k of saved.makings) {
        const index = indexOf(k.server);
        if (makings.has(k.request)) continue;
        const m: Making = { index, request: k.request, offer: k.offer, key: k.key, since: k.since, state: k.state ?? "cloning", ...(k.detail && { detail: k.detail }), sent: null, wrote: true, timer: null };
        makings.set(m.request, m);
        // A failed one's expert file goes, if it was still there, unless a later making of its key wrote it.
        if (k.state === "failed" && !saved.makings.some((x) => x.key === k.key && !x.state)) void clear(k.key);
        if (!k.state) void follow(m).catch((err: Error) => say(`couldn't follow expert ${m.key}: ${err.message}`));
      }
    },

    seen(s) {
      if (!started || closed || indexOf(s.server) < 0) return;
      const byOffice = latest.get(s.session) ?? new Map<string, SessionAreas>();
      latest.delete(s.session);
      latest.set(s.session, byOffice.set(s.server, s));
      if (latest.size > MAX_SESSIONS) latest.delete(latest.keys().next().value!);
      // An offer of this session made before this office took it goes to it too, if this office may
      // be told of its repo, unless it has ended anywhere (made, dismissed or expired).
      const may = names(s);
      let added = false;
      for (const r of saved.offers) {
        if (r.session !== s.session || r.scope !== "session" || r.offices[s.server] !== undefined || !may.has(r.project.id.toLowerCase()) || Object.values(r.offices).includes("ended")) continue;
        r.offices[s.server] = "pending";
        added = true;
      }
      if (added) {
        void save();
        flush(indexOf(s.server));
      }
      if (busy.has(s.session)) return;
      busy.add(s.session);
      void consider(s)
        .catch(orLog(`look at session ${s.bare}'s areas for an expert offer`))
        .finally(() => busy.delete(s.session));
    },

    corrected(key, text, reply) {
      const verdict = verdicts.get(key);
      if (verdict !== undefined) return verdict;
      if (closed) return null;
      if (!waiting.some((w) => w.key === key) && waiting.length < MAX_CHECKS_WAITING) waiting.push({ key, text, reply });
      // Each pass looks again, so a check that couldn't run (runner.json unreadable, say) is tried again.
      if (waiting.length) void check().catch(orLog("check whether a message corrected the agent"));
      return null;
    },

    take(index, message) {
      if (closed) return;
      if (message.type === "offer-dismissals") {
        offices[index]!.dismissals = message.dismissals;
        offices[index]!.ready = true;
        return flush(index);
      }
      if (message.type === "draft-offer") return void draftOffer(index, message).catch(orLog(`draft the office-wide expert offer ${message.request}`));
      if (message.type === "make-expert") return void make(index, message).catch(orLog(`make the expert ${message.key}`));
      ended(index, message);
    },

    linked(index) {
      offices[index]!.ready = false;
      for (const m of makings.values()) if (m.index === index) m.sent = null;
      // An offer sent on the connection that ended, and not yet kept, may not have reached the
      // office: it goes again on the next, which the office takes as the same offer.
      const server = o.offices[index]!.server;
      for (const r of saved.offers) if (r.offices[server] === "sent") r.offices[server] = "pending";
    },

    rehooked(bare) {
      const hooks = o.hooked(bare);
      if (!hooks) return;
      for (const r of saved.offers) {
        if (r.bare !== bare) continue;
        for (const [server, state] of Object.entries(r.offices)) if (state === "open") hooks.send(lineOf(r, server));
        tellReady(r);
      }
    },

    // A making that is done and waits only for its office's link holds nothing up.
    idle: () => draftingOffers.size === 0 && !checking && busy.size === 0 && keeping.size === 0 && [...makings.values()].every(done),

    close() {
      closed = true;
      if (checkTimer) clearTimeout(checkTimer);
      for (const m of makings.values()) if (m.timer) clearTimeout(m.timer);
      for (const timer of keeping.values()) clearTimeout(timer);
    },
  };
}
