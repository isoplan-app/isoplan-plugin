// Offers to make an employee (isoplan-app#341, E6, ADR 0013): where this computer's person started
// the same job by hand on a rhythm (jobs-started-by-hand.ts), the runner writes a job from those
// sessions on this computer (job-from-sessions-model-call.ts), checks it against the secret and the
// personal-data patterns (a match, or patterns that can't be read, makes no offer, logged with the
// field), and offers to make an employee, to one office: the one the employee would be published to.
// No job written, or one that didn't pass its check, is no offer: the skill or prompt is tried again
// `jobFromSessionsTriedAgainAfterHours` later, on its next start by hand.
//
// - Once per skill or prompt, ever: never one an employee here was made from, never one offered
//   before. An ended offer is kept 30 days; what it was made for, for good (`offeredFor`).
// - The offer carries only its id, its rhythm and, for a skill, the skill's name; the job stays here
//   (offers-to-make-an-employee.json), and goes to the floor only when its person opens the offer
//   (`offer-to-make-an-employee-job-wanted`, by this runner's person), checked again first.
// - It is sent after each new connection's listing there until it ended; its end deletes the job,
//   and `made` marks what it was made for as done. The newest matching session's status line carries
//   it while it is open.

import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { PROTOCOL_VERSION, type OfferToMakeAnEmployeeEndedMessage, type OfferToMakeAnEmployeeJobWantedMessage, type Project } from "@isoplan/protocol";
import type { DataLayerLine } from "../lines.js";
import type { RunnerEmployeeMessage } from "../data-layer/link.js";
import type { EmployeesSettings } from "./employee.js";
import { definitionCheck } from "./employee-ties.js";
import { readJson, writeJson } from "./expert-state.js";
import type { JobFromSessions, JobFromSessionsInput } from "./job-from-sessions-model-call.js";
import type { Rhythm, StartedByHand } from "./jobs-started-by-hand.js";
import type { CheckBeforeItLeaves } from "./what-was-learned-before-it-leaves.js";

const DAY = 24 * 3600000;
const KEPT_AFTER_IT_ENDED_MS = 30 * DAY;

interface Offer {
  id: string;
  /** What it was made for: what its person started by hand, `skill:<name>` or `prompt:<sha256>`. */
  startedWith: string;
  skill?: string;
  rhythm: Rhythm;
  server: string;
  project: string;
  /** The job written from its sessions: kept only here, until it ends. */
  jobFromSessions?: JobFromSessions;
  /** The newest matching session, whose status line carries it. */
  session: string;
  at: number;
  sent: boolean;
  ended?: OfferToMakeAnEmployeeEndedMessage["why"];
  endedAt?: number;
}

interface OffersFile {
  version: 1;
  offers: Offer[];
  /** What an offer that ended over 30 days ago was made for: never offered again. */
  offeredFor: string[];
  /** What no job could be written from, or whose job didn't pass its check, and when. */
  noJob: { startedWith: string; at: number }[];
}

export interface OffersToMakeAnEmployeeOptions {
  file: string;
  projectsDir: string;
  claudeDir: string;
  account: { id: string; name: string };
  settings: () => Promise<Pick<EmployeesSettings, "sessionsAJobIsWrittenFrom" | "jobFromSessionsTriedAgainAfterHours">>;
  /** The office an employee of this project would be published to; null when none takes it now. */
  officeFor: (project: string, cwd: string) => Promise<{ server: string; project: Project } | null>;
  /** Sends on that office's employee link while it carries the family; false when it can't now. */
  send: (server: string, m: RunnerEmployeeMessage) => boolean;
  write: (input: JobFromSessionsInput) => Promise<JobFromSessions | null>;
  check: (thing: { text: string; files: { path: string }[] }) => Promise<CheckBeforeItLeaves>;
  /** The experts the sessions asked, from the asking module's file. */
  expertsAsked: (sessions: readonly string[]) => Promise<string[]>;
  /** Whether an employee here was made from what its person started by hand already. */
  madeHere: (startedWith: string) => boolean;
  hooked: (session: string) => { send(line: DataLayerLine): void } | null;
  log: (text: string) => void;
  now?: () => number;
}

export interface OffersToMakeAnEmployee {
  load(): Promise<void>;
  /** What its person started by hand crossed its rhythm's threshold. */
  rhythm(startedWith: string, rhythm: Rhythm, starts: StartedByHand[]): Promise<void>;
  /** The office's employee link carries the family now: what didn't go, goes. */
  opened(server: string): void;
  ended(server: string, m: OfferToMakeAnEmployeeEndedMessage): void;
  jobWanted(server: string, m: OfferToMakeAnEmployeeJobWantedMessage): Promise<void>;
  /** What an offer was made for, for `make-an-employee`'s check that it came from one. */
  get(id: string): { startedWith: string } | null;
  /** The session's pipe connected afresh: it is given its open offer again. */
  rehooked(session: string): void;
  written(): Promise<void>;
}

/** The floor's link that opens an offer, from the office's data-layer address. */
export function offerUrl(server: string, id: string): string {
  const url = new URL(server);
  url.protocol = url.protocol === "wss:" ? "https:" : "http:";
  url.pathname = url.pathname.replace(/\/data-layer\/?$/, "") + "/";
  url.search = `offer-to-make-an-employee=${encodeURIComponent(id)}`;
  url.hash = "";
  return url.toString();
}

/** A session's first prompt and its last reply, from its transcript under projectsDir; empty when it is gone. */
async function sessionTexts(projectsDir: string, session: string): Promise<{ firstPrompt: string; finalReport: string }> {
  for (const d of await fs.readdir(projectsDir, { withFileTypes: true }).catch(() => [])) {
    if (!d.isDirectory()) continue;
    const text = await fs.readFile(path.join(projectsDir, d.name, `${session}.jsonl`), "utf8").catch(() => null);
    if (text === null) continue;
    let firstPrompt = "";
    let finalReport = "";
    for (const line of text.split("\n")) {
      let e: { type?: string; isMeta?: boolean; message?: { content?: unknown } };
      try {
        e = JSON.parse(line);
      } catch {
        continue;
      }
      const content = e.message?.content;
      const said = typeof content === "string" ? content : Array.isArray(content) ? content.filter((c) => c?.type === "text" && typeof c.text === "string").map((c) => c.text as string).join("\n") : "";
      if (e.type === "user" && !e.isMeta && !firstPrompt && said.trim() && !/^\s*<(command-|local-command-)/.test(said)) firstPrompt = said.slice(0, 4000);
      if (e.type === "assistant" && said.trim()) finalReport = said.slice(0, 4000);
    }
    return { firstPrompt, finalReport };
  }
  return { firstPrompt: "", finalReport: "" };
}

export function createOffersToMakeAnEmployee(o: OffersToMakeAnEmployeeOptions): OffersToMakeAnEmployee {
  const now = o.now ?? Date.now;
  let offers: Offer[] = [];
  let offeredFor: string[] = [];
  let noJob: OffersFile["noJob"] = [];
  let writing: Promise<void> = Promise.resolve();
  const busy = new Set<string>();
  const save = () => {
    const copy: OffersFile = structuredClone({ version: 1, offers, offeredFor, noJob });
    writing = writing.then(() => writeJson(o.file, copy)).catch((err: Error) => o.log(`couldn't write ${o.file}: ${err.message}`));
    return writing;
  };
  const line = (x: Offer): DataLayerLine => ({ type: "offer-to-make-an-employee", server: x.server, id: x.id, ...(x.skill && { skill: x.skill }), url: offerUrl(x.server, x.id) });
  const send = (x: Offer) => {
    if (x.sent || x.ended) return;
    if (o.send(x.server, { type: "offer-to-make-an-employee", v: PROTOCOL_VERSION, id: x.id, rhythm: x.rhythm, ...(x.skill && { skill: x.skill }), at: new Date(x.at).toISOString() })) {
      x.sent = true;
      void save();
    }
  };

  return {
    async load() {
      const read = (await readJson(o.file)) as Partial<OffersFile> | null;
      if (read?.version === 1) {
        if (Array.isArray(read.offers)) offers = read.offers;
        if (Array.isArray(read.offeredFor)) offeredFor = read.offeredFor;
        if (Array.isArray(read.noJob)) noJob = read.noJob;
      }
      const old = offers.filter((x) => x.endedAt !== undefined && now() - x.endedAt >= KEPT_AFTER_IT_ENDED_MS);
      offeredFor = [...new Set([...offeredFor, ...old.map((x) => x.startedWith)])];
      offers = offers.filter((x) => !old.includes(x));
    },
    async rhythm(startedWith, rhythm, starts) {
      if (busy.has(startedWith) || offers.some((x) => x.startedWith === startedWith) || offeredFor.includes(startedWith) || o.madeHere(startedWith)) return;
      const s = await o.settings();
      noJob = noJob.filter((x) => now() - x.at < s.jobFromSessionsTriedAgainAfterHours * 3600000);
      if (noJob.some((x) => x.startedWith === startedWith)) return;
      busy.add(startedWith);
      try {
        const newest = starts[0]!;
        const office = await o.officeFor(newest.project, newest.cwd);
        if (!office) return;
        const sessions = starts.slice(0, s.sessionsAJobIsWrittenFrom);
        const skill = newest.skill;
        const skillFile = skill ? await skillText(o.claudeDir, newest.cwd, skill) : null;
        const texts = await Promise.all(sessions.map(async (s) => ({ ...(await sessionTexts(o.projectsDir, s.session)), startedAt: new Date(s.at).toISOString() })));
        const written = await o.write({ ...(skill && { skill: { name: skill, text: skillFile } }), sessions: texts, experts: await o.expertsAsked(sessions.map((s) => s.session)) });
        const id = randomBytes(12).toString("base64url");
        const hit = written ? await definitionCheck(written, o.check) : null;
        if (!written || hit) {
          o.log(`no offer to make an employee for a job started by hand on a rhythm, tried again in ${s.jobFromSessionsTriedAgainAfterHours} hours: ${!written ? "no job could be written from its sessions" : hit === "unreadable" ? "the patterns can't be read" : hit!.why}`);
          noJob.push({ startedWith, at: now() });
          return void (await save());
        }
        const offer: Offer = { id, startedWith, ...(skill && { skill: skill.toLowerCase() }), rhythm, server: office.server, project: office.project.id, session: newest.session, at: now(), sent: false, jobFromSessions: written };
        offers.push(offer);
        await save();
        o.log(`offers to make an employee on ${office.server}: the same job was started by hand on ${rhythm.kind === "days" ? `${rhythm.days} of the last 7 days` : `each of the last ${rhythm.weeks} weeks`}`);
        send(offer);
        o.hooked(offer.session)?.send(line(offer));
      } finally {
        busy.delete(startedWith);
      }
    },
    opened(server) {
      for (const x of offers) if (x.server === server && !x.ended) (x.sent = false), send(x);
    },
    ended(server, m) {
      const x = offers.find((y) => y.id === m.id && y.server === server);
      if (!x || x.ended) return;
      x.ended = m.why;
      x.endedAt = now();
      delete x.jobFromSessions;
      void save();
      o.hooked(x.session)?.send({ type: "offer-to-make-an-employee-ended", server: x.server, id: x.id });
      o.log(`the offer to make an employee ${x.id} ended: ${m.why}`);
    },
    async jobWanted(server, m) {
      const answer = (job?: object) => o.send(server, { type: "offer-to-make-an-employee-job", v: PROTOCOL_VERSION, request: m.request, id: m.id, ...(job ? { job } : { gone: true as const }) } as RunnerEmployeeMessage);
      if (m.by.id !== o.account.id) return void o.log(`${server} asked for the job of an offer to make an employee for ${m.by.name || m.by.id}, not this runner's own account, so nothing is sent`);
      const x = offers.find((y) => y.id === m.id && y.server === server);
      const j = x?.jobFromSessions;
      if (!x || x.ended || !j) return void answer();
      const project = { id: x.project, name: x.project.split("/").pop() ?? x.project };
      const hit = await definitionCheck(j, o.check);
      if (hit) return (o.log(`the job of offer ${x.id} didn't pass its check again, so it isn't sent: ${hit === "unreadable" ? "the patterns can't be read" : hit.why}`), void answer());
      answer({ key: j.key, subject: j.subject, project, job: j.job });
    },
    get: (id) => {
      const x = offers.find((y) => y.id === id);
      return x ? { startedWith: x.startedWith } : null;
    },
    rehooked(session) {
      for (const x of offers) if (x.session === session && !x.ended && x.jobFromSessions) o.hooked(session)?.send(line(x));
    },
    written: () => writing,
  };
}

/** A skill's own file, or a command's, where it is one of the person's. */
async function skillText(claudeDir: string, cwd: string, name: string): Promise<string | null> {
  const places = [path.join(claudeDir, "skills", name, "SKILL.md"), path.join(claudeDir, "commands", `${name}.md`), path.join(cwd, ".claude", "skills", name, "SKILL.md"), path.join(cwd, ".claude", "commands", `${name}.md`)];
  for (const p of places) {
    const text = await fs.readFile(p, "utf8").catch(() => null);
    if (text !== null) return text.slice(0, 20000);
  }
  return null;
}
