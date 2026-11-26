// An employee's drafts on this computer (isoplan-app#341, CONTEXT.md: Draft): the only writer of
// employees/<key>/drafts-waiting.json and rejected-for-the-next-run.json.
//
// - `leave` is `leave_draft`'s check and keep, the draft written before the tool answers: refused
//   past the run's batch, for a recipient of any draft of this employee still waiting (from this run
//   or another), for one another sender's employee claimed or contacted, and for one this sender
//   skipped or contacted; a rejected recipient whose only row is this sender's kept claim is taken
//   (the draft is then `afterACorrection`).
// - A run's end (`endRun`) records which drafts the secret check held, which another sender's claim
//   dropped, and when the rest expire; those go to the office until it says it has them (`toSend`,
//   `received`).
// - A decision (`decide`, `by` this runner's person) is applied once, by draft id, and answered: an
//   approval after fetching the newest file of who was contacted (`marked`, the other sender, or
//   `unchecked`), its push afterwards; a rejection keeps the claim, puts the recipient and the
//   correction in rejected-for-the-next-run.json, and waits to be learned from; a skip marks the
//   recipient skipped. A repeat gets the same answer, for 30 days.
// - At its expiry a draft's claim is released, and it stays 30 days more, as long as the office may
//   still hold a decision made before; a late decision is still applied.
// Never logged: a draft's text and recipient stay in these files.

import { randomUUID } from "node:crypto";
import path from "node:path";
import { EmployeeDraftSchema, type EmployeeDraft, type EmployeeDraftDecidedMessage, type EmployeeDraftDecisionAppliedMessage, type FileWhatWasLearnedRestsOn } from "@isoplan/protocol";
import { readJson, writeJson } from "./expert-state.js";
import type { WhoWasContactedWriter } from "./who-was-contacted-writer.js";
import { prospectOf, type Row, type WhoWasContactedChange } from "./who-was-contacted.js";

const DAY = 24 * 3600000;
/** How long a draft stays after it expired, and an answer after it was given: the office's window for a decision. */
export const KEPT_AFTER_MS = 30 * DAY;

/** An expert's answer to a run's question, with the files it cited: what teaching it rests on. */
export interface RunAnswer {
  question: string;
  answer: string;
  files: FileWhatWasLearnedRestsOn[];
}

export type Answer = Pick<EmployeeDraftDecisionAppliedMessage, "whoWasContacted" | "refused">;

export interface KeptDraft {
  draft: Omit<EmployeeDraft, "expiresAt" | "askedExperts">;
  run: string;
  leftAt: string;
  /** The run's answers by expert, for those whose answers cited a file: the draft's askedExperts. */
  answers: Record<string, RunAnswer[]>;
  /** Set as its run ends. */
  expiresAt?: string;
  ended?: true;
  heldBySecretCheck?: true;
  someoneElseHad?: true;
  received?: "kept" | "record-gone" | "not-this-computer";
  decision?: { decision: EmployeeDraftDecidedMessage["decision"]; at: string; correction?: string; repeat?: true; teach?: string[] };
  answer?: Answer;
  /** For a rejection: learned into the employee, and into each expert taught; tries counted. */
  learning?: { employee: boolean; experts: string[]; tries: number };
  /** Its claim released at expiry. */
  released?: true;
}

export interface RejectedRecipient {
  prospect: string;
  name?: string;
  organisation?: string;
  correction: string;
  draft: string;
  at: string;
  /** The runs that carried it in their prompt. */
  runs: string[];
}

export interface EmployeeDraftsHereOptions {
  dir: string;
  writer: Pick<WhoWasContactedWriter, "fetch" | "lookUp" | "add" | "write">;
  /** This runner's person, as the office names them and as the file of who was contacted does. */
  account: () => { id: string; name: string };
  now?: () => number;
  log: (text: string) => void;
  /** A decision was recorded. */
  onDecided?: (d: KeptDraft) => void;
  /** An approval whose push found another sender had contacted its recipient, after it was answered `marked`. */
  onApprovedTwice?: (x: { approvedAt: string; alreadyContactedBy: string; at: string }) => void;
}

export interface EmployeeDraftsHere {
  load(): Promise<void>;
  /** `leave_draft`'s check and keep: the words its tool answers. `batch`: the run's most; `answers`: the run's answers so far. */
  leave(run: string, input: Record<string, unknown>, batch: number, answers: Record<string, RunAnswer[]>): Promise<string>;
  ofRun(run: string): KeptDraft[];
  /** The rejected recipients a run carries in its prompt, the run added to each. */
  carry(run: string): Promise<RejectedRecipient[]>;
  /** A run's end: what the check held, what another sender's claim dropped, and when the rest expire. */
  endRun(run: string, o: { held: ReadonlySet<string>; dropped: ReadonlySet<string>; expiresAt: string; outcome: "ran" | "failed" | "stopped" }): Promise<void>;
  /** Each run's drafts that wait for the office to have them. */
  toSend(): { run: string; drafts: EmployeeDraft[] }[];
  received(kept: readonly string[], refused: readonly { id: string; reason: "record-gone" | "not-this-computer" }[]): Promise<void>;
  decide(m: EmployeeDraftDecidedMessage): Promise<Answer>;
  /** Undecided, unexpired drafts that went to the office: what holds a run back. */
  waiting(): number;
  /** Releases the claims of expired drafts, and forgets what is past keeping. */
  tidy(): Promise<void>;
  /** Rejections still to be learned from, oldest first. */
  toLearn(): KeptDraft[];
  learned(ids: readonly string[], part: "employee" | string, ok: boolean): Promise<void>;
  /** Every claim of the employee, released: it is being deleted. */
  releaseAll(): WhoWasContactedChange[];
  written(): Promise<void>;
}

const shortDate = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
const isWaiting = (d: KeptDraft, now: number) => !!d.ended && !d.heldBySecretCheck && !d.someoneElseHad && !d.decision && (!d.expiresAt || Date.parse(d.expiresAt) > now);
const unended = (d: KeptDraft) => !d.ended;

export function createEmployeeDraftsHere(o: EmployeeDraftsHereOptions): EmployeeDraftsHere {
  const now = o.now ?? Date.now;
  const file = path.join(o.dir, "drafts-waiting.json");
  const rejectedFile = path.join(o.dir, "rejected-for-the-next-run.json");
  let drafts: KeptDraft[] = [];
  let answered: { id: string; answer: Answer; at: string }[] = [];
  let rejected: RejectedRecipient[] = [];
  let writing: Promise<void> = Promise.resolve();

  const save = () => {
    const copy = structuredClone({ version: 1, drafts, answered });
    const r = structuredClone({ version: 1, recipients: rejected });
    writing = writing.then(() => writeJson(file, copy)).then(() => writeJson(rejectedFile, r)).catch((err: Error) => o.log(`couldn't write its drafts: ${err.message}`));
    return writing;
  };
  const me = () => ({ sender: o.account().name || o.account().id });
  const iso = () => new Date(now()).toISOString();

  async function leave(run: string, input: Record<string, unknown>, batch: number, answers: Record<string, RunAnswer[]>): Promise<string> {
    const mine = drafts.filter((d) => d.run === run);
    if (mine.length >= batch) return `This run's ${batch} drafts are left: end the run now.`;
    const to = input.to && typeof input.to === "object" ? (input.to as Record<string, unknown>) : undefined;
    const id = randomUUID();
    const candidate = { id, text: input.text, ...(input.subject !== undefined && { subject: input.subject }), ...(to && { to }), askedExperts: [], expiresAt: iso() };
    const parsed = EmployeeDraftSchema.safeParse(candidate);
    if (!parsed.success) {
      const issue = parsed.error.issues[0]!;
      return `That draft wasn't left: its ${issue.path.join(".") || "draft"} ${issue.message}. Fix it and leave it again.`;
    }
    const draft = parsed.data;
    let afterACorrection = false;
    if (draft.to) {
      const prospect = prospectOf(draft.to.address);
      const address = draft.to.address;
      if (drafts.some((d) => d.draft.to && prospectOf(d.draft.to.address) === prospect && (unended(d) || isWaiting(d, now())))) return `A draft to ${address} waits for your owner already: pick another.`;
      const look = o.writer.lookUp(address);
      const other = look.others[0];
      if (other) return `${other.sender}'s employee ${other.state === "contacted" ? "contacted" : "claimed"} ${address} on ${shortDate(other.since)}: pick another.`;
      const carried = rejected.find((r) => r.prospect === prospect);
      if (look.mine?.state === "skipped") return `You skipped ${address} on ${shortDate(look.mine.since)}: pick another.`;
      if (look.mine?.state === "contacted") return `You contacted ${address} on ${shortDate(look.mine.since)}: pick another.`;
      if (look.mine?.state === "claimed" && !carried) return `You claimed ${address} on ${shortDate(look.mine.since)}, for a draft that waits: pick another.`;
      if (carried) {
        afterACorrection = true;
        rejected = rejected.filter((r) => r !== carried);
      }
    }
    // Only the experts whose answers in this run cited a file can be taught from it.
    const cited = Object.fromEntries(Object.entries(answers).filter(([, list]) => list.some((a) => a.files.length)));
    const kept: KeptDraft = { draft: { id, text: draft.text, ...(draft.subject && { subject: draft.subject }), ...(draft.to && { to: draft.to }), ...(afterACorrection && { afterACorrection: true as const }) }, run, leftAt: iso(), answers: cited };
    drafts.push(kept);
    await save();
    return `Left draft ${mine.length + 1} of ${batch}.`;
  }

  const sendable = (d: KeptDraft): EmployeeDraft => ({ ...d.draft, askedExperts: Object.keys(d.answers).sort(), expiresAt: d.expiresAt! });

  async function decide(m: EmployeeDraftDecidedMessage): Promise<Answer> {
    if (m.by.id !== o.account().id) return { refused: "not-yours" };
    const done = answered.find((a) => a.id === m.draft);
    const d = drafts.find((x) => x.draft.id === m.draft);
    if (d?.answer) return d.answer;
    if (!d) return done?.answer ?? { refused: "unknown-draft" };
    d.decision = { decision: m.decision, at: m.at, ...(m.decision === "rejected" && { correction: m.correction, ...(m.repeat && { repeat: true as const }), teach: [...m.teach].filter((k) => Object.hasOwn(d.answers, k)) }) };
    await save();
    const to = d.draft.to;
    const change = (op: WhoWasContactedChange["op"]): WhoWasContactedChange[] => (to ? [{ op, prospect: prospectOf(to.address), ...(to.name && { name: to.name }), ...(to.organisation && { organisation: to.organisation }), draft: d.draft.id, at: iso() }] : []);
    let answer: Answer = {};
    if (m.decision === "approved") {
      if (to) {
        const fetched = await o.writer.fetch();
        const other: Row | undefined = fetched.ok ? o.writer.lookUp(to.address).others[0] : undefined;
        answer = { whoWasContacted: !fetched.ok ? "unchecked" : other ? { alreadyContactedBy: other.sender, at: other.since, ...(other.state === "claimed" && { claimed: true as const }) } : "marked" };
        await o.writer.add(change("contacted"));
        const marked = answer.whoWasContacted === "marked";
        void o.writer.write().then((r) => {
          const twice = r.pushed ? r.contactedTwice.find((x) => x.draft === d.draft.id) : undefined;
          if (twice && marked) o.onApprovedTwice?.({ approvedAt: m.at, alreadyContactedBy: twice.other.sender, at: twice.other.since });
        });
      }
    } else if (m.decision === "rejected") {
      await o.writer.add(change("keep"));
      if (to) rejected.push({ prospect: prospectOf(to.address), ...(to.name && { name: to.name }), ...(to.organisation && { organisation: to.organisation }), correction: m.correction, draft: d.draft.id, at: m.at, runs: [] });
      d.learning = { employee: false, experts: [], tries: 0 };
      void o.writer.write();
    } else {
      await o.writer.add(change("skip"));
      void o.writer.write();
    }
    d.answer = answer;
    answered.push({ id: d.draft.id, answer, at: iso() });
    // Applied: its words go, but a rejection's until it is learned from.
    if (m.decision !== "rejected") drafts = drafts.filter((x) => x !== d);
    await save();
    o.onDecided?.(d);
    return answer;
  }

  return {
    async load() {
      const read = (await readJson(file)) as { version?: unknown; drafts?: unknown; answered?: unknown } | null;
      if (read?.version === 1 && Array.isArray(read.drafts)) drafts = read.drafts as KeptDraft[];
      if (read?.version === 1 && Array.isArray(read.answered)) answered = read.answered as typeof answered;
      const r = (await readJson(rejectedFile)) as { version?: unknown; recipients?: unknown } | null;
      if (r?.version === 1 && Array.isArray(r.recipients)) rejected = r.recipients as RejectedRecipient[];
    },
    leave,
    ofRun: (run) => drafts.filter((d) => d.run === run),
    async carry(run) {
      for (const r of rejected) if (!r.runs.includes(run)) r.runs.push(run);
      await save();
      return rejected.map((r) => ({ ...r }));
    },
    async endRun(run, e) {
      for (const d of drafts.filter((x) => x.run === run && !x.ended)) {
        d.ended = true;
        d.expiresAt = e.expiresAt;
        if (e.held.has(d.draft.id)) d.heldBySecretCheck = true;
        else if (e.dropped.has(d.draft.id)) d.someoneElseHad = true;
      }
      // A run that failed keeps what it carried for its try again; one that ran or stopped lets go of the rest.
      if (e.outcome !== "failed") {
        const going = rejected.filter((r) => r.runs.includes(run));
        rejected = rejected.filter((r) => !going.includes(r));
        await o.writer.add(going.map((r) => ({ op: "release" as const, prospect: r.prospect, draft: r.draft, at: iso() })));
        if (going.length) void o.writer.write();
      }
      // A held draft never leaves, and neither its words nor its claim stay: it is gone.
      drafts = drafts.filter((d) => !(d.run === run && (d.heldBySecretCheck || d.someoneElseHad)));
      await save();
    },
    toSend() {
      const byRun = new Map<string, EmployeeDraft[]>();
      for (const d of drafts) if (d.ended && !d.received && !d.decision && !d.heldBySecretCheck && !d.someoneElseHad) byRun.set(d.run, [...(byRun.get(d.run) ?? []), sendable(d)]);
      return [...byRun].map(([run, list]) => ({ run, drafts: list }));
    },
    async received(kept, refused) {
      for (const d of drafts) {
        if (kept.includes(d.draft.id)) d.received = "kept";
        const r = refused.find((x) => x.id === d.draft.id);
        if (r) d.received = r.reason;
      }
      await save();
    },
    decide,
    waiting: () => drafts.filter((d) => isWaiting(d, now())).length,
    async tidy() {
      const t = now();
      const releasing: WhoWasContactedChange[] = [];
      for (const d of drafts) {
        if (!d.expiresAt || d.released || d.decision || Date.parse(d.expiresAt) > t) continue;
        d.released = true;
        if (d.draft.to) releasing.push({ op: "release", prospect: prospectOf(d.draft.to.address), draft: d.draft.id, at: iso() });
      }
      drafts = drafts.filter((d) => !(d.expiresAt && Date.parse(d.expiresAt) + KEPT_AFTER_MS < t && !d.learning));
      answered = answered.filter((a) => Date.parse(a.at) + KEPT_AFTER_MS > t);
      if (releasing.length) await o.writer.add(releasing);
      await save();
      if (releasing.length) void o.writer.write();
    },
    toLearn: () => drafts.filter((d) => d.learning && (!d.learning.employee || (d.decision?.teach ?? []).some((k) => !d.learning!.experts.includes(k)))),
    async learned(ids, part, ok) {
      for (const d of drafts) {
        if (!ids.includes(d.draft.id) || !d.learning) continue;
        if (!ok) d.learning.tries++;
        else if (part === "employee") d.learning.employee = true;
        else if (!d.learning.experts.includes(part)) d.learning.experts.push(part);
        // A fork that failed twice leaves it to the next run's prompt, which carries the correction's words.
        if (d.learning.tries >= 2) d.learning = { employee: true, experts: [...(d.decision?.teach ?? [])], tries: d.learning.tries };
      }
      drafts = drafts.filter((d) => !(d.learning && d.learning.employee && (d.decision?.teach ?? []).every((k) => d.learning!.experts.includes(k))));
      await save();
    },
    releaseAll() {
      return drafts.filter((d) => d.draft.to && !d.decision).map((d) => ({ op: "release" as const, prospect: prospectOf(d.draft.to!.address), draft: d.draft.id, at: iso() }));
    },
    written: () => writing,
  };
}
