// This computer's employees and one office server (protocol 0.19.0, isoplan-app#341): one of these
// per office in config.json, beside that office's record link (expert-record-link.ts) and what was
// learned (what-was-learned-link.ts).
//
// - The gate: nothing of the family goes on a connection whose first `expert-directory` didn't say
//   `employees`, and only after a listing on that connection, since the listing makes the office's row
//   of each employee. A connection whose first directory lacks the flag is said once, to runner.log
//   and each employee's health log.
// - `employee-runs`: every employee of this computer tied to a record of this server, the whole list
//   each time: the first after each connection's first listing, then on each change.
// - `employee-drafts`: each run's drafts the office hasn't said it has, after each listing, on change
//   and on the timer, each draft at most once every 2 minutes on a connection.
// - A decision (`employee-draft-decided`) is applied by its employee's drafts here and answered
//   `employee-draft-decision-applied`; one that comes before this connection's listing is answered
//   just after it.
// - The offers to make an employee and the making from the floor go through `offers` and `make`,
//   which send with `sendNow`. Everything counts as sent only when the link took it.

import { EmployeeDraftsMessageSchema, EmployeeRunsMessageSchema, PROTOCOL_VERSION, type EmployeeDraftDecisionAppliedMessage, type EmployeeDraftsMessage, type EmployeeRunsMessage } from "@isoplan/protocol";
import type { RunnerEmployeeMessage, ServerEmployeeMessage } from "../data-layer/link.js";
import type { EmployeeTies } from "./employee-ties.js";
import type { Employees } from "./employees.js";
import type { ExpertRecordLink } from "./expert-record-link.js";

/** How long a draft sent and not answered waits before it is sent again on the same connection. */
export const DRAFTS_SENT_AGAIN_AFTER_MS = 2 * 60000;

/** What the offers module and the making take from a link. */
export interface EmployeeLinkHandlers {
  offerEnded?(m: Extract<ServerEmployeeMessage, { type: "offer-to-make-an-employee-ended" }>): void;
  offerJobWanted?(m: Extract<ServerEmployeeMessage, { type: "offer-to-make-an-employee-job-wanted" }>): void;
  make?(m: Extract<ServerEmployeeMessage, { type: "make-an-employee" }>): void;
  /** This connection may carry the family now: what waits to go, goes. */
  opened?(): void;
}

export interface EmployeeLinkOptions {
  server: string;
  recordLink: Pick<ExpertRecordLink, "directory" | "onDirectory" | "onListingSent" | "onEmployeeMessage">;
  employees: Pick<Employees, "get" | "rowOf" | "decide" | "onChange" | "all" | "health">;
  ties: Pick<EmployeeTies, "tiedRecords" | "serverOf">;
  send: (m: RunnerEmployeeMessage) => boolean;
  log: (text: string) => void;
  checkMs: number;
  now?: () => number;
}

export interface EmployeeLink {
  onOpen(): void;
  onClose(): void;
  stop(): void;
  /** Whether this connection carries the family now. */
  open(): boolean;
  /** Sends one message of the family now if the gate is open; false when it couldn't. */
  sendNow(m: RunnerEmployeeMessage): boolean;
  handle(h: EmployeeLinkHandlers): void;
}

export function createEmployeeLink(o: EmployeeLinkOptions): EmployeeLink {
  const now = o.now ?? Date.now;
  let says: boolean | null = null;
  let listed = false;
  let stopped = false;
  let lastRuns: string | null = null;
  const sentAt = new Map<string, number>();
  const answers: EmployeeDraftDecisionAppliedMessage[] = [];
  const handlers: EmployeeLinkHandlers[] = [];

  const open = () => !stopped && says === true && listed;
  const sendNow = (m: RunnerEmployeeMessage) => open() && o.send(m);

  function sendRuns(force: boolean) {
    if (!open()) return;
    const employees = o.ties.tiedRecords(o.server).flatMap(({ key, expertRecordId }) => {
      const row = o.employees.rowOf(key);
      return row ? [{ key, expertRecordId, ...row }] : [];
    });
    const m: EmployeeRunsMessage = { type: "employee-runs", v: PROTOCOL_VERSION, employees };
    const text = JSON.stringify(employees);
    if (!force && text === lastRuns) return;
    const parsed = EmployeeRunsMessageSchema.safeParse(m);
    if (!parsed.success) return o.log(`how this computer's employees' runs go doesn't fit the protocol for ${o.server} (${parsed.error.issues[0]!.path.join(".")}: ${parsed.error.issues[0]!.message}), so it isn't sent`);
    if (o.send(m)) lastRuns = text;
  }

  function sendDrafts(again: boolean) {
    if (!open()) return;
    for (const { key, expertRecordId } of o.ties.tiedRecords(o.server)) {
      for (const { run, drafts } of o.employees.get(key)?.drafts.toSend() ?? []) {
        const due = drafts.filter((d) => {
          const at = sentAt.get(d.id);
          return at === undefined || (again && now() - at >= DRAFTS_SENT_AGAIN_AFTER_MS);
        });
        if (!due.length) continue;
        const m: EmployeeDraftsMessage = { type: "employee-drafts", v: PROTOCOL_VERSION, key, expertRecordId, run, drafts: due };
        if (!EmployeeDraftsMessageSchema.safeParse(m).success) {
          o.log(`employee ${key}: run ${run}'s drafts don't fit the protocol, so they aren't sent`);
          continue;
        }
        if (!o.send(m)) return;
        for (const d of due) sentAt.set(d.id, now());
      }
    }
  }

  o.recordLink.onDirectory(() => {
    if (says !== null) return;
    says = o.recordLink.directory()?.employees === true;
    if (says) return;
    const words = `${o.server} doesn't take employees yet: update its Isoplan server`;
    if (o.employees.all().length) o.log(words);
    for (const e of o.employees.all()) if (o.ties.serverOf(e.key) === o.server || o.ties.serverOf(e.key) === null) o.employees.health(e.key).say("office", { server: o.server, employees: "no", why: words });
  });

  o.recordLink.onListingSent(() => {
    if (says !== true || stopped || listed) return void (listed && sendRuns(false));
    listed = true;
    sendRuns(true);
    sendDrafts(true);
    for (const a of answers.splice(0)) o.send(a);
    for (const h of handlers) h.opened?.();
  });

  o.employees.onChange((key) => {
    if (o.ties.serverOf(key) !== o.server) return;
    sendRuns(false);
    sendDrafts(false);
  });

  o.recordLink.onEmployeeMessage((m) => {
    if (stopped) return;
    switch (m.type) {
      case "employee-drafts-received":
        return void o.employees.get(m.key)?.drafts.received(m.kept, m.refused);
      case "employee-draft-decided":
        return void (async () => {
          const answer = await o.employees.decide(m.key, m);
          const applied: EmployeeDraftDecisionAppliedMessage = { type: "employee-draft-decision-applied", v: PROTOCOL_VERSION, key: m.key, expertRecordId: m.expertRecordId, draft: m.draft, ...answer };
          if (!sendNow(applied)) answers.push(applied);
        })().catch((err: Error) => o.log(`employee ${m.key}: couldn't apply a decision on its draft: ${err.message}`));
      case "offer-to-make-an-employee-ended":
        return handlers.forEach((h) => h.offerEnded?.(m));
      case "offer-to-make-an-employee-job-wanted":
        return handlers.forEach((h) => h.offerJobWanted?.(m));
      case "make-an-employee":
        return handlers.forEach((h) => h.make?.(m));
    }
  });

  const timer = setInterval(() => {
    sendRuns(false);
    sendDrafts(true);
  }, o.checkMs);
  timer.unref?.();

  const fresh = () => {
    says = null;
    listed = false;
    lastRuns = null;
    sentAt.clear();
  };

  return {
    onOpen: fresh,
    onClose: fresh,
    stop() {
      stopped = true;
      clearInterval(timer);
    },
    open,
    sendNow,
    handle: (h) => void handlers.push(h),
  };
}
