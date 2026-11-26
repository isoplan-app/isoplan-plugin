// Asking an expert on this computer (isoplan-app#340, D8, D15, D16): the session's ask_expert
// script asks through the runner's pipe (src/ask/expert-main.ts, src/pipe/server.ts), and the runner
// answers it from this computer's own instance of the expert. Neither the question nor its answer
// leaves the computer: the office is told only a record of it with no words (`expert-question`).
//
// Checked in order, each check telling the agent at once:
// 1. An empty question, or one longer than MAX_QUESTION_LENGTH.
// 2. The same session and tool call asked before: that question, as it stands (no second fork).
// 3. The office, picked as ask_earlier_session picks it (askIn): one not in config.json, or one that
//    refuses the session's repo, is EXPERT_RUNNER_UNREACHABLE. Its directory is the one this
//    connection got, else the one saved (expert-records-per-office.ts); with neither, EXPERT_PLUGIN_OLD
//    when the link is up and showed the office is from before 0.17.0, else EXPERT_RUNNER_UNREACHABLE:
//    this runner hasn't heard from that office yet.
// 4. The experts the session may ask there (the office's `expert-rights`, as
//    expert-rights-on-this-computer.ts rewrites them; else the saved ones; else the directory's): one
//    not among them is EXPERT_UNKNOWN, with the office's words.
// 5. This computer's instance of it (expert-instance.ts): with none, its set-up is offered, or with
//    runner.json's `expertInstances.setUpWithoutAsking` started (expert-instance-set-up-offer.ts);
//    offered, EXPERT_NOT_SET_UP.
// 6. The office's caps (the directory's `asking`), over this person's questions on every computer:
//    this file's, and what the office last said of their other computers. EXPERT_CAP, with the
//    office's words.
// 7. Kept in the file, then given to the instance, whose own caps (its expert or instance file) give
//    EXPERT_CAP too, saying where to raise them.
//
// Then: with no junior yet (setting up, or a junior lost while its replacement grounds), or a junior
// that more was learned for on other computers than one question carries (its new generation
// grounds first, isoplan-app#366, D17), the agent is told EXPERT_STARTING at once, and the answer
// comes later. The instance is told before each question it is given (`beforeQuestion`), so it can
// start that generation. A blocking question waits up to
// runner.json's expertWaitSeconds from when the runner was asked, then is told to explore meanwhile;
// any other is told it was asked. An end told in the call is shown once its line was written to the
// script; any other goes to the session's hooks module as an `asked` line, now if it is connected,
// else when one registers for the session, and again every three minutes until it is acked (the hooks
// module acks through dist/ask.js --ack, which main.ts routes here): its question and answer are then
// deleted, and a record with no words is kept a day, for the caps. An answer not yet possible
// (`not-yet`) is asked again every two minutes, and ends EXPERT_FORK_FAILED once older than the office's
// `maxAgeHours`. Every question still open to an expert deleted here, or waiting for its set-up,
// ends EXPERT_UNKNOWN, "the <Name> was deleted".
//
// What it keeps is in ~/.claude/isoplan/runner/expert-questions-asked-here.json: each question's id,
// session, expert, office, words, state, answer, code, commit, branch, when it was asked and ended,
// whether its end was shown, and what was last sent to the office. On start, a question still being
// asked is given to its instance again, at most twice, then ends EXPERT_FORK_FAILED; an end not shown
// waits for the session's hooks module; anything older than `questionsKeptHours` goes.
//
// The wordless records go to the asking office: `asking` once past the checks (with EXPERT_STARTING
// while it waits for a junior), again with `senior`
// when the junior first asks its senior, then `answered`, or `dropped` with its code; EXPERT_NOT_SET_UP
// as `dropped`. EXPERT_UNKNOWN, the office's EXPERT_CAP, EXPERT_PLUGIN_OLD and
// EXPERT_RUNNER_UNREACHABLE aren't reported, nor any question to this computer's own expert whose
// key another expert has (the office has no record of it). One the link couldn't send goes after its
// next connection's first directory.

import { randomUUID } from "node:crypto";
import { AreaPathSchema, expertDisplayName, MAX_QUESTION_LENGTH, PROTOCOL_VERSION, type ExpertCode, type ExpertDirectoryMessage, type ExpertQuestionMessage, type ExpertRight, type FileWhatWasLearnedRestsOn } from "@isoplan/protocol";
import type { Config } from "../data-layer/config.js";
import { askIn } from "../ask/machine.js";
import { answeredText, askedText, expertText, exploreMeanwhileText, type ExpertAbout } from "../ask/expert-text.js";
import type { DataLayerLine } from "../lines.js";
import type { ExpertTold, PipeAskExpert, Told } from "../pipe/pipe.js";
import type { ExpertInstanceSetUpOffers } from "./expert-instance-set-up-offer.js";
import type { ExpertInstances, FoundInstance } from "./expert-instance.js";
import type { ExpertRecordLink } from "./expert-record-link.js";
import type { InstanceOutcome } from "./expert.js";
import { readJson, writeJson } from "./expert-state.js";

const DAY_MS = 24 * 3600000;
// How long a question its instance can't take yet waits before it is asked again.
const ASKED_AGAIN_AFTER_MS = 2 * 60000;
// How often an end its session hasn't shown yet is sent to it again.
const LATE_END_SENT_AGAIN_EVERY_MS = 3 * 60000;

/** What a question to an instance whose set-up failed is told. */
const SET_UP_FAILED_WORDS = "its set-up on this computer failed; the floor says why and offers to try again";

/** runner.json, as asking reads it. */
export interface ExpertQuestionsAskedHereSettings {
  expertWaitSeconds: number;
  expertInstances: { setUpWithoutAsking: boolean; questionsKeptHours: number };
}

export interface ExpertQuestionsAskedHereOptions {
  /** <claudeDir>/isoplan/runner/expert-questions-asked-here.json */
  file: string;
  claudeDir: string;
  config: () => Promise<Config>;
  settings: () => Promise<ExpertQuestionsAskedHereSettings>;
  /** Each office's record link, by its data-layer address. */
  links: ReadonlyMap<string, Pick<ExpertRecordLink, "directory" | "showedOld" | "otherComputers" | "sendNow" | "onDirectory">>;
  instances: Pick<ExpertInstances, "lookUp" | "beforeQuestion" | "onChange" | "onDeleted">;
  offers: Pick<ExpertInstanceSetUpOffers, "offerOrSetUp">;
  /** The experts the session may ask through the office, as this computer has them; null when it has none. */
  rights: (session: string, server: string) => ExpertRight[] | null;
  hooked: (session: string) => { send(line: DataLayerLine): void } | null;
  log: (text: string) => void;
}

export interface ExpertQuestionsAskedHere {
  start(): Promise<void>;
  ask(request: PipeAskExpert): Promise<ExpertTold>;
  /**
   * A run's question to one of its job's experts, answered from this computer's instance as a
   * session's is, with the asker `employee:<key>` for the instance's own caps, and not counted in the
   * office's per-person caps, which the job's own limits stand in for. It waits for the answer up to
   * `waitMs`, then is told to explore meanwhile. Its wordless record names the employee, and goes only
   * to an office whose directory says `employees`.
   */
  askForAnEmployeeRun(r: EmployeeRunQuestion): Promise<{ text: string; answer?: { question: string; answer: string; files: FileWhatWasLearnedRestsOn[] } }>;
  /** Whether `question` is one of these, so its ack is this module's. */
  holds(question: string): boolean;
  ack(session: string, question: string): Promise<Told>;
  /** The session's hooks module connected: the ends it hasn't been shown go to it. */
  rehooked(session: string): void;
  idle(): boolean;
  close(): void;
}

interface Kept {
  id: string;
  /** The asking session's bare id. */
  session: string;
  server: string;
  key: string;
  /** The record it is a question to; null for this computer's own expert whose key another expert has. */
  expertRecordId: string | null;
  blocking: boolean;
  /** The question; null once its end was shown. */
  text: string | null;
  state: "asking" | "answered" | "dropped";
  code?: ExpertCode;
  answer?: string;
  /** Why it ended, in words the agent is told: the asked line's `note`. */
  endWords?: string;
  commit?: string;
  branch?: string;
  senior?: true;
  askedAt: number;
  endedAt?: number;
  shown: boolean;
  /** Counted in the office's caps: one given to an instance. */
  counts: boolean;
  /** Runner starts after which it was given to its instance again. */
  restarts: number;
  /** What the office was last sent of it, `<state>` or `<state>+senior`; null for nothing yet, "never" for one not reported. */
  sent: string | null;
  /** A run of this computer's employee of this key asked it, not a session (isoplan-app#341): `session` is then `employee:<key>`. */
  employee?: string;
}

/** A run's question to one of its job's experts (isoplan-app#341). */
export interface EmployeeRunQuestion {
  employee: string;
  /** The office its employee's record is on. */
  server: string;
  run: string;
  expert: string;
  question: string;
  /** How long it waits for the answer: there is no late answer for a run. */
  waitMs: number;
}

/** The files an answer's citation block names, each with the commit it was read at where it is the answer's own. */
export function citedFiles(answer: string, commit: string | undefined): FileWhatWasLearnedRestsOn[] {
  const files: FileWhatWasLearnedRestsOn[] = [];
  for (const m of answer.matchAll(/^- (.+?)(?::\d+(?:-\d+)?)? \((?:read at ([0-9a-f]{7})|commit unknown)/gm)) {
    const path = m[1]!.trim();
    if (files.some((f) => f.path === path) || !AreaPathSchema.safeParse(path).success) continue;
    files.push({ path, ...(commit && m[2] && commit.startsWith(m[2]) && { commit }) });
  }
  return files;
}

export function createExpertQuestionsAskedHere(o: ExpertQuestionsAskedHereOptions): ExpertQuestionsAskedHere {
  const kept = new Map<string, Kept>(); // by session and id
  const waiters = new Map<string, () => void>(); // a blocking call waiting for its end
  const given = new Set<string>(); // handed to an expert in this run and not back yet
  const retries = new Map<string, ReturnType<typeof setTimeout>>();
  const timers: ReturnType<typeof setInterval>[] = [];
  let writing: Promise<void> = Promise.resolve();
  let closed = false;

  const keyOf = (session: string, id: string) => `${session}\n${id}`;
  const k = (q: Kept) => keyOf(q.session, q.id);
  const about = (q: { key: string; id: string }): ExpertAbout => ({ expert: q.key, id: q.id, name: expertDisplayName(q.key) });
  const save = () => {
    const copy = [...kept.values()].map((q) => ({ ...q }));
    writing = writing.then(() => writeJson(o.file, { version: 1, questions: copy })).catch((err: Error) => o.log(`couldn't write ${o.file}: ${err.message}`));
    return writing;
  };
  const maxAgeMs = (server: string) => (o.links.get(server)?.directory()?.asking.maxAgeHours ?? 72) * 3600000;

  // The wordless record of where it stands, to the asking office.
  function record(q: Kept) {
    if (q.sent === "never" || !q.expertRecordId) return;
    // A run's question goes only to an office that takes employees.
    if (q.employee && o.links.get(q.server)?.directory()?.employees !== true) return;
    const tag = q.state + (q.senior ? "+senior" : "");
    if (q.sent === tag) return;
    const m: ExpertQuestionMessage = {
      type: "expert-question",
      v: PROTOCOL_VERSION,
      id: q.id,
      key: q.key,
      expertRecordId: q.expertRecordId,
      session: q.employee ? q.session : `claude-code:${q.session}`,
      ...(q.employee && { employee: q.employee }),
      blocking: q.blocking,
      state: q.state,
      ...(q.code && { code: q.code }),
      ...(q.senior && { senior: true as const }),
      askedAt: new Date(q.askedAt).toISOString(),
      ...(q.endedAt !== undefined && { endedAt: new Date(q.endedAt).toISOString() }),
    };
    if (o.links.get(q.server)?.sendNow(m)) {
      q.sent = tag;
      void save();
    }
  }

  // Its end, as a late line, to the session's hooks module.
  function late(q: Kept) {
    if (q.state === "asking" || q.shown || closed) return;
    o.hooked(q.session)?.send({
      type: "asked",
      v: PROTOCOL_VERSION,
      question: q.id,
      key: q.id,
      text: q.text ?? "(the question)",
      state: q.state,
      ...(q.answer && { answer: q.answer }),
      ...(q.endWords && { note: q.endWords }),
      expert: q.key,
      ...(q.code && { code: q.code }),
      ...(q.commit && { commit: q.commit }),
      ...(q.branch && { branch: q.branch }),
      server: q.server,
    });
  }

  const forgetWords = (q: Kept) => {
    q.text = null;
    delete q.answer;
    delete q.endWords;
  };

  function end(q: Kept, state: "answered" | "dropped", code: ExpertCode | undefined, more: { answer?: string; commit?: string; branch?: string; endWords?: string } = {}) {
    if (q.state !== "asking") return;
    Object.assign(q, { state, ...more, endedAt: Date.now() });
    if (code) q.code = code;
    else delete q.code;
    given.delete(k(q));
    clearTimeout(retries.get(k(q)));
    retries.delete(k(q));
    void save();
    record(q);
    const waiter = waiters.get(k(q));
    if (waiter) {
      waiters.delete(k(q));
      waiter();
    } else late(q);
  }

  // Asked again in two minutes, unless it is past the office's maxAgeHours.
  function later(q: Kept) {
    if (closed || q.state !== "asking" || retries.has(k(q))) return;
    const hours = maxAgeMs(q.server) / 3600000;
    if (Date.now() - q.askedAt > maxAgeMs(q.server)) return end(q, "dropped", "EXPERT_FORK_FAILED", { endWords: `the expert couldn't answer within ${hours} hours` });
    const timer = setTimeout(() => {
      retries.delete(k(q));
      void give(q);
    }, ASKED_AGAIN_AFTER_MS);
    timer.unref?.();
    retries.set(k(q), timer);
  }

  function outcome(q: Kept, out: InstanceOutcome, capsIn: string) {
    // The runner stopping ends its experts' forks: the question is asked again when it starts.
    if (closed) return;
    given.delete(k(q));
    if (out.kind === "answered") return end(q, "answered", undefined, { answer: out.answer, commit: out.commit, branch: out.branch });
    if (out.kind === "not-yet") return later(q);
    if (out.code === "EXPERT_CAP") return end(q, "dropped", "EXPERT_CAP", { endWords: `${out.detail}; ${out.frees !== undefined ? `it frees at ${new Date(out.frees).toISOString()}, or ` : ""}raise it in ${capsIn}` });
    end(q, "dropped", out.code, { endWords: out.detail });
  }

  // Gives the question to its instance; one with no instance yet waits for it.
  async function give(q: Kept) {
    if (closed || q.state !== "asking" || given.has(k(q))) return;
    const entry = o.links.get(q.server)?.directory()?.experts.find((e) => e.key === q.key && !e.employee) ?? null;
    const found = o.instances.lookUp(q.server, q.key, entry);
    if (!found || found.kind === "setting-up") return later(q);
    if (found.kind === "set-up-failed") return end(q, "dropped", "EXPERT_FORK_FAILED", { endWords: SET_UP_FAILED_WORDS });
    given.add(k(q));
    await o.instances.beforeQuestion(q.server, q.key).catch((err: Error) => o.log(`expert ${q.key}: couldn't apply its newer revision: ${err.message}`));
    if (q.state !== "asking") return;
    found.running.expert.beforeQuestion();
    found.running.expert.answer(
      { id: q.id, question: q.text ?? "", blocking: q.blocking, asker: q.session },
      (out) => outcome(q, out, found.capsIn),
      () => {
        if (q.senior) return;
        q.senior = true;
        void save();
        record(q);
      },
    );
  }

  // What the call is told of `q` now; an end with its `shown`.
  function told(q: Kept): ExpertTold {
    const a = about(q);
    if (q.state === "asking") return { text: q.blocking ? exploreMeanwhileText(a) : askedText(a) };
    const shown = async (written: boolean) => {
      if (!written) return late(q);
      q.shown = true;
      forgetWords(q);
      await save();
    };
    if (q.state === "answered") return { text: answeredText({ ...a, answer: q.answer ?? "", commit: q.commit, branch: q.branch }), shown };
    const code = q.code ?? "EXPERT_FORK_FAILED";
    return { text: expertText(code, { ...a, words: q.endWords }), failed: true, code, shown };
  }

  // Waits, when blocking, until its end or the deadline; with no junior yet, says it is starting.
  async function answerFor(q: Kept, deadline: number, starting: boolean): Promise<ExpertTold> {
    if (q.state === "asking" && starting) return { text: expertText("EXPERT_STARTING", about(q)), code: "EXPERT_STARTING" };
    const left = deadline - Date.now();
    if (q.state === "asking" && q.blocking && left > 0) {
      await new Promise<void>((resolve) => {
        const done = () => (clearTimeout(timer), resolve());
        const timer = setTimeout(() => {
          if (waiters.get(k(q)) === done) waiters.delete(k(q));
          resolve();
        }, left);
        waiters.set(k(q), done);
      });
    }
    return told(q);
  }

  // The office's caps, over this person's questions through it on this computer and on their others.
  function officeCap(server: string, key: string, asking: ExpertDirectoryMessage["asking"]): string | null {
    const others = o.links.get(server)?.otherComputers() ?? null;
    const here = [...kept.values()].filter((q) => q.counts && q.server === server);
    const open = here.filter((q) => q.state === "asking" && q.key === key).length + (others?.open.find((x) => x.key === key)?.count ?? 0);
    if (open >= asking.openPerPersonPerExpert) return `You have ${open} questions waiting for expert ${key} already, which is as many as this office allows; carry on: their answers reach you as notes.`;
    const since = Date.now() - DAY_MS;
    const times = [...here.map((q) => q.askedAt), ...(others?.askedAtInTheLastDay ?? []).map((t) => Date.parse(t))].filter((t) => t > since).sort((a, b) => a - b);
    if (times.length >= asking.perPersonPerDay) return `You have asked ${times.length} expert questions in the last day, which is as many as this office allows; it frees at ${new Date(times[0]! + DAY_MS).toISOString()}, or an admin can raise perAskerPerDay in asks.json.`;
    return null;
  }

  // What is kept no longer: an end shown a day ago, and anything older than questionsKeptHours.
  async function prune() {
    const keep = (await o.settings()).expertInstances.questionsKeptHours * 3600000;
    let changed = false;
    for (const [id, q] of kept) {
      if (Date.now() - q.askedAt > keep || (q.shown && q.endedAt !== undefined && Date.now() - q.endedAt > DAY_MS)) {
        kept.delete(id);
        changed = true;
      }
    }
    if (changed) await save();
  }

  const giveWaiting = () => {
    for (const q of kept.values()) if (q.state === "asking" && !given.has(k(q)) && !retries.has(k(q))) void give(q);
  };

  return {
    async start() {
      const read = (await readJson(o.file)) as { version?: unknown; questions?: unknown } | null;
      if (read?.version === 1 && Array.isArray(read.questions)) for (const q of read.questions as Kept[]) kept.set(k(q), q);
      await prune();
      for (const q of kept.values()) {
        if (q.state !== "asking") continue;
        // A run that asked it ended with the runner: no one waits for its answer now.
        if (q.employee) {
          end(q, "dropped", "EXPERT_FORK_FAILED", { endWords: "the runner stopped while it was being answered" });
          continue;
        }
        if (q.restarts >= 2) {
          end(q, "dropped", "EXPERT_FORK_FAILED", { endWords: "the runner stopped while it was being answered" });
          continue;
        }
        q.restarts++;
        void give(q);
      }
      await save();
      o.instances.onChange(giveWaiting);
      // Its expert deleted here: every question to it still open ends, those its set-up was waiting for too.
      o.instances.onDeleted((key) => {
        for (const q of kept.values()) if (q.state === "asking" && q.key === key) end(q, "dropped", "EXPERT_UNKNOWN", { endWords: `the ${expertDisplayName(key)} was deleted` });
      });
      for (const [server, link] of o.links) link.onDirectory(() => [...kept.values()].filter((q) => q.server === server).forEach(record));
      const resend = setInterval(() => [...kept.values()].forEach(late), LATE_END_SENT_AGAIN_EVERY_MS);
      const tidy = setInterval(() => void prune().catch(() => {}), 3600000);
      for (const t of [resend, tidy]) t.unref?.();
      timers.push(resend, tidy);
    },

    async ask(r) {
      const received = Date.now();
      const a: ExpertAbout = { expert: r.expert, id: r.key, name: expertDisplayName(r.expert) };
      const unreachable = (words: string): ExpertTold => ({ text: expertText("EXPERT_RUNNER_UNREACHABLE", { ...a, words }), failed: true, code: "EXPERT_RUNNER_UNREACHABLE" });
      const question = r.question.trim();
      if (!question) return { text: "Give the question to ask as `question`.", failed: true };
      if (question.length > MAX_QUESTION_LENGTH) return { text: `Expert ${r.expert}, question ${r.key}: that question is too long to ask: keep it under ${MAX_QUESTION_LENGTH} characters.`, failed: true };
      const deadline = received + (await o.settings()).expertWaitSeconds * 1000;
      const known = kept.get(keyOf(r.session, r.key));
      if (known) return answerFor(known, deadline, false);

      const found = await askIn(await o.config(), r.servers, r.session, r.cwd, o.claudeDir);
      if (!found) return unreachable(`${r.servers.join(", ")} isn't one of the office servers in config.json`);
      if ("refused" in found) return unreachable(found.refused);
      const server = found.office.server;
      const link = o.links.get(server);
      const directory = link?.directory() ?? null;
      if (!directory) {
        if (link?.showedOld()) return { text: expertText("EXPERT_PLUGIN_OLD", a), failed: true, code: "EXPERT_PLUGIN_OLD" };
        return unreachable(`this computer's runner hasn't heard from the office at ${server} yet; try again in a minute`);
      }

      // An employee's record is never one a session may ask (protocol 0.19.0).
      const rights = (o.rights(r.session, server) ?? directory.experts.filter((e) => !e.employee).map((e) => ({ name: e.key }))).filter((x) => !directory.experts.some((e) => e.employee && e.key === x.name));
      const unknown = (): ExpertTold => ({ text: expertText("EXPERT_UNKNOWN", { ...a, words: rights.length ? `No expert named ${r.expert} in this session's office; ask one of: ${rights.map((x) => x.name).join(", ")}.` : "There are no experts in this session's office now." }), failed: true, code: "EXPERT_UNKNOWN" });
      if (!rights.some((x) => x.name === r.expert)) return unknown();

      const entry = directory.experts.find((e) => e.key === r.expert && !e.employee) ?? null;
      let instance: FoundInstance | null = o.instances.lookUp(server, r.expert, entry);
      if (!instance) {
        if (!entry) return unknown();
        if ((await o.offers.offerOrSetUp(server, entry, r.session)) === "offered") {
          const q: Kept = { id: r.key, session: r.session, server, key: r.expert, expertRecordId: entry.expertRecordId, blocking: r.blocking, text: null, state: "dropped", code: "EXPERT_NOT_SET_UP", askedAt: received, endedAt: received, shown: true, counts: false, restarts: 0, sent: null };
          kept.set(k(q), q);
          await save();
          record(q);
          return { text: expertText("EXPERT_NOT_SET_UP", a), failed: true, code: "EXPERT_NOT_SET_UP" };
        }
        instance = o.instances.lookUp(server, r.expert, entry) ?? { kind: "setting-up", expertRecordId: entry.expertRecordId };
      }

      const cap = officeCap(server, r.expert, directory.asking);
      if (cap) return { text: expertText("EXPERT_CAP", { ...a, words: cap }), failed: true, code: "EXPERT_CAP" };

      // With no junior yet, or one catching up on what its other instances learned, its record says it waits (EXPERT_STARTING).
      if (instance.kind === "running") instance.running.expert.beforeQuestion();
      const starting = instance.kind === "setting-up" || (instance.kind === "running" && (instance.running.expert.hosted().state === "starting" || instance.running.expert.catchingUp()));
      const q: Kept = { id: r.key, session: r.session, server, key: r.expert, expertRecordId: instance.expertRecordId, blocking: r.blocking, text: question, state: "asking", ...(starting && { code: "EXPERT_STARTING" as const }), askedAt: received, shown: false, counts: true, restarts: 0, sent: instance.expertRecordId ? null : "never" };
      kept.set(k(q), q);
      await save();
      record(q);
      void give(q);
      return answerFor(q, deadline, starting);
    },

    async askForAnEmployeeRun(r) {
      const askedAt = Date.now();
      const id = `${r.run.slice(0, 8)}-${randomUUID()}`;
      const a: ExpertAbout = { expert: r.expert, id, name: expertDisplayName(r.expert) };
      const question = r.question.trim();
      if (!question) return { text: "Give the question to ask as `question`." };
      if (question.length > MAX_QUESTION_LENGTH) return { text: `Expert ${r.expert}, question ${id}: that question is too long to ask: keep it under ${MAX_QUESTION_LENGTH} characters.` };
      const directory = o.links.get(r.server)?.directory() ?? null;
      if (!directory) return { text: expertText("EXPERT_RUNNER_UNREACHABLE", { ...a, words: `this computer's runner hasn't heard from the office at ${r.server} yet` }) };
      const entry = directory.experts.find((e) => e.key === r.expert && !e.employee) ?? null;
      let instance: FoundInstance | null = o.instances.lookUp(r.server, r.expert, entry);
      const session = `employee:${r.employee}`;
      if (!instance) {
        if (!entry) return { text: expertText("EXPERT_UNKNOWN", { ...a, words: `No expert named ${r.expert} in this employee's office now.` }) };
        if ((await o.offers.offerOrSetUp(r.server, entry, session)) === "offered") {
          const q: Kept = { id, session, employee: r.employee, server: r.server, key: r.expert, expertRecordId: entry.expertRecordId, blocking: true, text: null, state: "dropped", code: "EXPERT_NOT_SET_UP", askedAt, endedAt: askedAt, shown: true, counts: false, restarts: 0, sent: null };
          kept.set(k(q), q);
          await save();
          record(q);
          return { text: expertText("EXPERT_NOT_SET_UP", a) };
        }
        instance = o.instances.lookUp(r.server, r.expert, entry) ?? { kind: "setting-up", expertRecordId: entry.expertRecordId };
      }
      if (instance.kind === "running") instance.running.expert.beforeQuestion();
      const q: Kept = { id, session, employee: r.employee, server: r.server, key: r.expert, expertRecordId: instance.expertRecordId, blocking: true, text: question, state: "asking", askedAt, shown: true, counts: false, restarts: 0, sent: instance.expertRecordId ? null : "never" };
      kept.set(k(q), q);
      await save();
      record(q);
      void give(q);
      if (q.state === "asking" && r.waitMs > 0) {
        await new Promise<void>((resolve) => {
          const done = () => (clearTimeout(timer), resolve());
          const timer = setTimeout(() => {
            if (waiters.get(k(q)) === done) waiters.delete(k(q));
            resolve();
          }, r.waitMs);
          waiters.set(k(q), done);
        });
      }
      if (q.state === "asking") return { text: exploreMeanwhileText(a) };
      if (q.state === "answered") {
        const answer = q.answer ?? "";
        return { text: answeredText({ ...a, answer, commit: q.commit, branch: q.branch }), answer: { question, answer, files: citedFiles(answer, q.commit) } };
      }
      return { text: expertText(q.code ?? "EXPERT_FORK_FAILED", { ...a, words: q.endWords }) };
    },

    holds: (question) => [...kept.values()].some((q) => q.id === question),

    async ack(session, question) {
      const q = kept.get(keyOf(session, question));
      if (q && !q.shown) {
        q.shown = true;
        forgetWords(q);
        await save();
      }
      return { text: `acked ${question}` };
    },

    rehooked(session) {
      for (const q of kept.values()) if (q.session === session) late(q);
    },

    idle: () => given.size === 0,

    close() {
      closed = true;
      for (const t of timers) clearInterval(t);
      for (const t of retries.values()) clearTimeout(t);
    },
  };
}
