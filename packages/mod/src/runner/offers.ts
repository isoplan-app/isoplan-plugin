// Expert offers (isoplan-app#328, ADR 0013): the runner notices when a session on this computer
// would have been helped by an expert on one folder of its repo, drafts one with a local model and
// offers it, once per session and folder, to each office that takes the repo. Whoever picks it up
// on the floor makes it on one of their own computers: that computer's runner writes the expert
// file and says how making it goes until the expert is ready.
//
// - The signals are the session's areas (data-layer/claude-code.ts), each pass's as one office may
//   be told of them (report-session.ts SessionAreas). A folder passes when what its reads and
//   searches took is `contextShare` of the session's context window or more (the window its hooks
//   module said, else its model's, expert-meter.ts), or `tokens`; or its calls took `minutes`; or
//   the person corrected the agent there `corrections` times: runner.json's `expertOffers`. Of the
//   folders that pass, the deepest is offered. Never one the session was offered, or one inside or
//   above it; never one the person dismissed in any office (`offer-dismissals`: until its time, or
//   for good), nor one inside it; and never one an expert on this computer covers, by its file's
//   areas: a folder or glob whose part before the first wildcard is the folder or above it. The
//   office checks other computers' experts itself. Which sessions and folders were offered, and the
//   open offers, are kept in <claude dir>/isoplan/runner/offers.json for `snoozeDays`.
// - The draft: a local model call with no tools and no hooks (offer-model.ts, prompts/expert-draft.md,
//   `draftModel`) writes the expert's key, subject and proof question with its answer, from the
//   folder's files (in the session's checkout, at most MAX_FILES) and what the session said there.
//   Its area is the folder alone. The whole draft passes the secret scan before any of it is sent;
//   a match, or patterns that can't be read, means no offer, logged.
// - Nothing goes on a connection before its first `offer-dismissals` (protocol 0.15.0): an offer, an
//   answer and making's progress wait for it, and then go live (link.ts sendLive).
// - An office that sees several sessions search one folder asks the runner of the latest to draft
//   an office-wide offer (`draft-offer`): drafted the same way, from the newest of those sessions
//   this runner reported, it goes to that office alone as scope `office`, with the request's id, or
//   `no-draft` goes back when none could be made.
// - While an offer is open, the session that showed the need is told through its hooks module, if
//   it is on this computer (lines.ts ExpertOfferLine), and again each time a hooks module connects
//   for it; and when the offer ends. Made in one office, it is withdrawn from the others, and the
//   session is told the expert is ready (ExpertReadyLine), once, by the next hooks module to connect
//   when none is now. The open offers of each session are also in
//   <claude dir>/isoplan/offers/<session>.json, `{ "offers": ExpertOfferLine[] }`, for
//   /isoplan:expert; the file goes when none is open.
// - Make expert (`make-expert`), only for this runner's own person (`by`): it finds this computer's
//   checkout of the repo as New session finds folders (repo-folders.ts); with none, or an expert of
//   that name here already, making fails at once, saying why. Else it writes experts/<key>.json,
//   whole or not at all, which the experts' watcher picks up (experts.ts), and follows the expert's
//   state.json (expert-state.ts) every `pollMs`, saying each step (`expert-making`): cloning (its
//   own clone), grounding, proof, then ready or failed, within MAKING_LIMIT_MS.
// - Whether the person's message corrected the agent (`corrected`) is a local model's word too
//   (prompts/correction.md, `draftModel`), one call at a time and at most `checksPerHour`; until it
//   comes the message counts nothing, and it is asked about again on a later pass.

import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {
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
  /** For the office server, which makes office-wide offers: how many sessions, within how many days. */
  officeSessions: number;
  officeDays: number;
  /** How long an offered session and folder, and an open offer, are remembered. */
  snoozeDays: number;
  /** For the floor, which sets the model an expert grounds with: the one it proposes. */
  model: string;
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
  /** The session's hooks module, while one is connected. */
  hooked: (bare: string) => { send(line: DataLayerLine): void } | null;
  log: (text: string) => void;
  now?: () => number;
  /** How often an expert being made is looked at. */
  pollMs?: number;
}

export interface Offers {
  /** Reads offers.json: before it settles, nothing is offered. */
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
  /** No draft, check or making under way. */
  idle(): boolean;
  close(): void;
}

/** The most files of a folder a draft is given. */
export const MAX_FILES = 200;
/** How long making an expert may take before it is said to have failed. */
export const MAKING_LIMIT_MS = 60 * 60000;
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

// `folder` is `other`, or inside it.
const within = (folder: string, other: string) => other === "." || folder === other || folder.startsWith(other + "/");

/** Whether the person dismissed `folder` of `project` (a lower-cased id), or a folder it is inside, as of `now`. */
export const dismissed = (list: readonly OfferDismissal[], project: string, folder: string, now: number) =>
  list.some((d) => d.project.toLowerCase() === project && within(folder, d.folder) && (d.forever === true || Date.parse(d.until ?? "") > now));

/** Whether an expert's areas cover `folder`: one whose part before its first wildcard is the folder or above it. */
export function covers(areas: readonly string[], folder: string): boolean {
  return areas.some((a) => {
    const parts = a.split("/");
    const wild = parts.findIndex((p) => /[*?[\]{}]/.test(p));
    const prefix = (wild < 0 ? parts : parts.slice(0, wild)).join("/") || ".";
    return within(folder, prefix);
  });
}

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

type OfficeOffer = "pending" | "open" | "ended";

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
  /** Where it is, by office: waiting for the office's connection, open there, or ended. */
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
  timer: ReturnType<typeof setTimeout> | null;
}

export function createOffers(o: OffersOptions): Offers {
  const now = o.now ?? Date.now;
  const pollMs = o.pollMs ?? 2000;
  const file = path.join(o.isoplanDir, "runner", "offers.json");
  const sessionFile = (bare: string) => path.join(o.isoplanDir, "offers", `${bare}.json`);
  const expertFile = (key: string) => path.join(o.isoplanDir, "experts", `${key}.json`);
  const offices = o.offices.map(() => ({ ready: false, dismissals: [] as OfferDismissal[], queue: [] as RunnerOfferMessage[] }));
  let saved: Saved = { version: FILE_VERSION, offered: [], offers: [] };
  let started = false;
  let closed = false;
  // The latest pass of each session, by its id, for office-wide drafts; and the offices that take each.
  const latest = new Map<string, SessionAreas>();
  const takers = new Map<string, Set<string>>();
  const busy = new Set<string>(); // the sessions whose areas are being looked at, or drafted from
  let drafting = 0;
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
    return { type: "expert-offer", server, ...(label && { label }), id: r.id, key: r.key, name: expertDisplayName(r.key), folder: r.folder, url: reviewUrl(server, r.id) };
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

  // Sends what waits for the office at `index`, once its connection has had offer-dismissals.
  function flush(index: number) {
    const office = o.offices[index]!;
    const st = offices[index]!;
    if (!st.ready || closed) return;
    while (st.queue.length && office.send(st.queue[0]!)) st.queue.shift();
    let changed = false;
    for (const r of saved.offers) {
      if (r.offices[office.server] !== "pending" || !office.send(r.message)) continue;
      r.offices[office.server] = "open";
      changed = true;
      say(`offered an expert on ${r.folder} of ${r.project.name} (${r.key}) to ${office.server}, as ${r.id}`);
      tell(r, lineOf(r, office.server));
      writeSessionFile(r.bare);
    }
    if (changed) void save();
    for (const m of makings.values()) if (m.index === index) sendMaking(m);
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
      if (!e.areas?.length || !covers(e.areas, folder)) continue;
      let hit = expertProjects.get(e.repo);
      if (!hit || now() - hit.at > PROJECT_MS) expertProjects.set(e.repo, (hit = { at: now(), project: o.projectOf(e.repo).catch(() => null) }));
      if ((await hit.project) === project) return true;
    }
    return false;
  }

  const offeredNear = (session: string, project: string, folder: string) =>
    saved.offered.some((x) => x.session === session && x.project === project && (within(folder, x.folder) || within(x.folder, folder)));

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
    drafting++;
    try {
      const files = await folderFiles(a.checkout, a.folder);
      const draft = await o.draft({ project: a.project, folder: a.folder, files, said: a.said }, t);
      if (!draft) {
        say(`no expert is offered on ${where}: no usable draft came`);
        return null;
      }
      const matched = await o.scan([draft.key, draft.subject, draft.proof.question, draft.proof.answer].join("\n"));
      if (matched) {
        say(`no expert is offered on ${where}: its draft matches the secret pattern "${matched}"`);
        return null;
      }
      const message = { type: "expert-offer" as const, v: PROTOCOL_VERSION, id: a.id, session: a.session, project: { id: a.project.id, name: a.project.name }, folder: a.folder, scope: a.scope, key: draft.key, subject: draft.subject, area: [a.folder], proof: draft.proof, why: a.why, at: new Date(now()).toISOString() };
      const parsed = ExpertOfferMessageSchema.safeParse(message);
      if (!parsed.success) {
        say(`no expert is offered on ${where}: its offer doesn't fit the protocol: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
        return null;
      }
      return parsed.data;
    } finally {
      drafting--;
    }
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

  // A session's pass: the deepest folder that passes, not offered, dismissed or covered, is drafted and offered.
  async function consider(s: SessionAreas) {
    const t = await settings();
    const window = windowOf(s);
    const at = now();
    const candidates: { area: AreaFact; project: Project; why: Why }[] = [];
    for (const area of s.areas) {
      const project = area.project ?? s.project;
      const id = project.id.toLowerCase();
      const why = signalsOf(area, window);
      if (!passes(why, t) || offeredNear(s.session, id, area.folder)) continue;
      if (offices.some((f) => dismissed(f.dismissals, id, area.folder, at))) continue;
      if (await coveredHere(id, area.folder)) continue;
      candidates.push({ area, project, why });
    }
    const depth = (folder: string) => folder.split("/").length;
    const best = candidates.sort((a, b) => depth(b.area.folder) - depth(a.area.folder) || b.area.tokens - a.area.tokens)[0];
    if (!best) return;
    const { area, project, why } = best;
    saved.offered.push({ session: s.session, project: project.id.toLowerCase(), folder: area.folder, at });
    void save();
    const index = indexOf(s.server);
    const checkout = area.project ? await o.checkout(index, project).catch(() => null) : s.checkout;
    const said = await s.said(area.project ? area.project.id : null, area.folder).catch(() => []);
    const message = await drafted({ id: randomBytes(12).toString("base64url"), scope: "session", session: s.session, project, folder: area.folder, checkout, said, why }, t);
    if (!message || closed) return;
    saved.offers.push(record(message, s.bare, takers.get(s.session) ?? [s.server]));
    await save();
    o.offices.forEach((_, i) => flush(i));
  }

  // An office-wide draft, from the newest of the sessions it names that this runner reported.
  async function draftOffer(index: number, m: DraftOfferMessage) {
    const server = o.offices[index]!.server;
    if (saved.offers.some((r) => r.id === m.request)) return;
    const project = m.project.id.toLowerCase();
    const s = m.sessions.map((id) => latest.get(id)).find((x) => !!x);
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
  }

  // How an offer ended in one office; made there, it is withdrawn from the others.
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
      for (const [other, state] of Object.entries(r.offices)) {
        if (state === "ended") continue;
        r.offices[other] = "ended";
        const i = indexOf(other);
        if (state === "open" && i >= 0) {
          sendOrQueue(i, { type: "expert-offer-ended", v: PROTOCOL_VERSION, id: r.id, why: "withdrawn" });
          tell(r, { type: "expert-offer-ended", server: other, id: r.id, why: "withdrawn" });
        }
      }
      tellReady(r);
    }
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

  // Sends the making's state on its office's connection once it is ready, unless it went already; a
  // last one sent, it is done.
  function sendMaking(m: Making) {
    const text = `${m.state}\n${m.detail ?? ""}`;
    if (m.sent !== text && offices[m.index]!.ready && o.offices[m.index]!.send({ type: "expert-making", v: PROTOCOL_VERSION, request: m.request, offer: m.offer, state: m.state, ...(m.detail && { detail: m.detail }) })) m.sent = text;
    if (m.sent === text && done(m)) makings.delete(m.request);
  }

  function setMaking(m: Making, state: ExpertMakingState, detail?: string) {
    const changed = m.state !== state || m.detail !== detail;
    m.state = state;
    m.detail = detail;
    if (changed && done(m)) {
      say(`expert ${m.key}, made from offer ${m.offer}: ${state}${detail ? `: ${detail}` : ""}`);
      if (m.timer) clearTimeout(m.timer);
      m.timer = null;
    }
    sendMaking(m);
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
    const making: Making = { index, request: m.request, offer: m.offer, key: m.key, since: now(), state: "cloning", sent: null, timer: null };
    makings.set(m.request, making);
    const fail = (detail: string) => setMaking(making, "failed", detail);
    if (m.by.id !== o.account.id) return fail("this computer's runner is someone else's, so it makes experts only for them");
    const taken = o.experts().some((e) => e.name === m.key) || (await fs.stat(expertFile(m.key)).then(() => true, () => false));
    if (taken) return fail(`an expert named ${m.key} is already on this computer`);
    const checkout = await o.checkout(index, m.project).catch(() => null);
    if (!checkout) return fail(`this computer has no checkout of ${m.project.name}`);
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
    say(`wrote the expert file for ${m.key}, made from offer ${m.offer} by ${m.by.name || m.by.id}, for ${checkout}`);
    await follow(making);
  }

  // The correction check, one at a time, at most checksPerHour: past that, the next waits for the
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
      try {
        const value = JSON.parse(await fs.readFile(file, "utf8")) as Saved;
        if (value?.version === FILE_VERSION && Array.isArray(value.offered) && Array.isArray(value.offers)) saved = value;
      } catch {
        // None yet, or one that doesn't parse: nothing was offered.
      }
      const keep = (await settings()).snoozeDays * DAY_MS;
      const at = now();
      saved.offered = saved.offered.filter((x) => at - x.at < keep);
      saved.offers = saved.offers.filter((r) => at - r.at < keep);
      started = true;
    },

    seen(s) {
      if (!started || closed || indexOf(s.server) < 0) return;
      latest.delete(s.session);
      latest.set(s.session, s);
      if (latest.size > MAX_SESSIONS) {
        const oldest = latest.keys().next().value!;
        latest.delete(oldest);
        takers.delete(oldest);
      }
      let servers = takers.get(s.session);
      if (!servers) takers.set(s.session, (servers = new Set()));
      servers.add(s.server);
      // An offer of this session made before this office took it goes to it too, unless it has
      // ended anywhere (made, dismissed or expired).
      let added = false;
      for (const r of saved.offers) {
        if (r.session !== s.session || r.scope !== "session" || r.offices[s.server] !== undefined || Object.values(r.offices).includes("ended")) continue;
        r.offices[s.server] = "pending";
        added = true;
      }
      if (added) flush(indexOf(s.server));
      if (busy.has(s.session)) return;
      busy.add(s.session);
      void consider(s)
        .catch(orLog(`look at session ${s.bare}'s areas for an expert offer`))
        .finally(() => busy.delete(s.session));
    },

    corrected(key, text, reply) {
      const verdict = verdicts.get(key);
      if (verdict !== undefined) return verdict;
      if (!closed && !waiting.some((w) => w.key === key) && waiting.length < MAX_CHECKS_WAITING) {
        waiting.push({ key, text, reply });
        void check().catch(orLog("check whether a message corrected the agent"));
      }
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
    idle: () => drafting === 0 && !checking && busy.size === 0 && [...makings.values()].every(done),

    close() {
      closed = true;
      if (checkTimer) clearTimeout(checkTimer);
      for (const m of makings.values()) if (m.timer) clearTimeout(m.timer);
    },
  };
}
