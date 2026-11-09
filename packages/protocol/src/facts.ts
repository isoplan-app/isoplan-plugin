import { z } from "zod";

// One session's facts, as its data layer reports them: v1's office model minus everything derived
// (rooms, roles, meaning) and minus what the hello already says (the owner, the project).

/** ISO time, with Z or an offset. */
const Time = z.iso.datetime({ offset: true });

/** Tool-specific detail that views never rely on. */
const Extra = z.record(z.string(), z.unknown()).optional();

export const SourceSchema = z.enum(["claude-code"]);

/** A project: one code repository, by its id (see projectId) and a short name. */
export const ProjectSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
});

/**
 * Where a file or a command lands when it isn't in the session's own project (#74): `project` is
 * the repo it is in, and `away` is true when that repo is outside the session's folder, so the
 * agent is working away from home; a repo inside the folder (a workspace above several repos) has
 * `project` and no `away`. Both absent: the session's own project, as for a peer that predates
 * them. A data layer sends them only to a server that said it reads them (`welcome`), and only for
 * a project the server's office holds; anything else stays on the machine.
 */
const Elsewhere = {
  project: ProjectSchema.optional(),
  away: z.boolean().optional(),
};

export const SessionFactSchema = z.object({
  id: z.string().min(1),
  source: SourceSchema,
  lead: z.string().min(1),
  title: z.string().nullable(),
  titleFrom: z.enum(["source", "branch"]),
  branch: z.string().nullable(),
  checkout: z.string().optional(),
  lastActive: Time,
  status: z.enum(["active", "idle"]),
  lights: z.enum(["on", "off"]),
  // `contextWindow` (protocol 0.6.0 on): the session's context window in tokens, as Claude Code
  // tells its status line (`context_window_size`); absent when the plugin wasn't told it.
  contextWindow: z.number().int().positive().optional(),
  // `takesMessages` (protocol 0.8.0 on): the plugin in this session can pass it a message from the
  // floor (an owner-message request); absent, the session takes none, and none is sent.
  takesMessages: z.literal(true).optional(),
  // `hooks` (protocol 0.11.0 on): Isoplan's hooks module runs inside this session, so it can be
  // answered from the floor. Absent: only the runner sees the session (from its transcript), and
  // nothing from the floor reaches it.
  hooks: z.literal(true).optional(),
  extra: Extra,
});

const TokenCount = z.number().int().nonnegative();

// A workflow's bounds (see WorkflowFactSchema).
/** The longest workflow name. */
export const MAX_WORKFLOW_NAME_LENGTH = 200;
/** The longest workflow description. */
export const MAX_WORKFLOW_DESCRIPTION_LENGTH = 1000;
/** The most phases a workflow lists. */
export const MAX_WORKFLOW_PHASES = 30;
/** The longest phase title, in a workflow's phases and in an agent's `workflow.phase`. */
export const MAX_WORKFLOW_PHASE_TITLE_LENGTH = 100;
/** The longest phase detail. */
export const MAX_WORKFLOW_PHASE_DETAIL_LENGTH = 500;
/** The longest label of a workflow's agent. */
export const MAX_WORKFLOW_LABEL_LENGTH = 200;
/** The most agents of one workflow a data layer sends; the workflow's `moreAgents` counts the rest. */
export const MAX_WORKFLOW_AGENTS = 100;

const TokenCounts = z.object({
  input: TokenCount,
  cacheWrite: TokenCount,
  cacheWrite1h: TokenCount,
  cacheRead: TokenCount,
  output: TokenCount,
});

export const AgentFactSchema = z.object({
  id: z.string().min(1),
  source: SourceSchema,
  session: z.string().min(1),
  startedBy: z.string().min(1).nullable(),
  agentType: z.string().nullable(),
  task: z.string().nullable(),
  status: z.enum(["working", "idle", "done", "stalled", "stopped", "failed"]),
  statusSince: Time,
  lastActive: Time,
  doing: z
    .object({
      kind: z.enum(["write", "read", "run", "search", "talk"]),
      file: z.string().optional(),
      since: Time,
      ...Elsewhere,
    })
    .nullable(),
  usage: TokenCounts.extend({
    model: z.string().min(1),
    context: TokenCount,
    over100k: TokenCounts,
    at: Time,
  }).nullable(),
  checkout: z.string().optional(),
  branch: z.string().nullable().optional(),
  // `checkIns` (protocol 0.3.6 on): its recent check-ins on other agents of the same session,
  // newest last, whatever it is doing now: a message sent to one (talk), or its output or
  // transcript read (read), each with the other agent's id and when. Absent when there are none.
  checkIns: z
    .array(z.object({ with: z.string().min(1), kind: z.enum(["talk", "read"]), since: Time }))
    .max(20)
    .optional(),
  // `workflow`: the agent is one of a Claude Code workflow's (its run, by the WorkflowFact's id),
  // in that phase, under that label. Absent for every other agent.
  workflow: z
    .object({
      id: z.string().min(1),
      phase: z.string().max(MAX_WORKFLOW_PHASE_TITLE_LENGTH),
      label: z.string().max(MAX_WORKFLOW_LABEL_LENGTH),
    })
    .optional(),
  extra: Extra,
});

/**
 * A Claude Code workflow run (the Workflow tool, also used by ultracode): `id` is its run id, so a
 * new run is a new workflow and an ended one doesn't change again. `startedBy` is the agent whose
 * Workflow call started it. Its agents are AgentFacts with `workflow.id` naming it; at most
 * MAX_WORKFLOW_AGENTS of them are sent, and `moreAgents` counts the rest. `status`: running while
 * it writes, stalled once it has been quiet a while and idle after longer, with no end record;
 * done, stopped or failed once it ended. `usage.tokens`: its tokens, counted by Claude Code when it
 * ended, summed over its agents before. A data layer cuts each text to its MAX_* limit.
 */
export const WorkflowFactSchema = z.object({
  id: z.string().min(1),
  session: z.string().min(1),
  startedBy: z.string().min(1),
  name: z.string().min(1).max(MAX_WORKFLOW_NAME_LENGTH),
  description: z.string().max(MAX_WORKFLOW_DESCRIPTION_LENGTH).optional(),
  phases: z
    .array(z.object({ title: z.string().max(MAX_WORKFLOW_PHASE_TITLE_LENGTH), detail: z.string().max(MAX_WORKFLOW_PHASE_DETAIL_LENGTH).optional() }))
    .max(MAX_WORKFLOW_PHASES),
  status: z.enum(["running", "stalled", "idle", "done", "stopped", "failed"]),
  startedAt: Time,
  endedAt: Time.optional(),
  usage: z.object({ tokens: TokenCount }).optional(),
  moreAgents: z.number().int().positive().optional(),
  extra: Extra,
});

/**
 * An edit or a read: `file` is relative to its repo's root, with forward slashes. One is known by
 * its agent, file and project, so one agent's README.md at home and in another repo are two.
 */
export const FileFactSchema = z.object({
  agent: z.string().min(1),
  file: z.string().min(1),
  at: Time,
  ...Elsewhere,
  extra: Extra,
});

export const WaitFactSchema = z.object({
  waiter: z.string().min(1),
  on: z.string().min(1),
  since: Time,
  extra: Extra,
});

/**
 * An agent's final report. One the secret scan matched, and its owner hasn't released, is
 * `withheld`: its `text` then only says so, and the report follows once the owner releases it by
 * `withheld.id`, a random id for this one text. A newer report of the same agent gets a new id.
 */
export const ReportFactSchema = z.object({
  agent: z.string().min(1),
  at: Time,
  text: z.string(),
  withheld: z.object({ id: z.string().min(1) }).optional(),
  extra: Extra,
});

/**
 * A question an agent asked its owner, open until it is answered, so the floor can show it and the
 * owner can answer it there. One of the named cases of session-derived text leaving a machine: the
 * server keeps it only for the retention period. `id` is the tool call's own id. An option's
 * `preview` (protocol 0.11.0 on) is the option's preview as the agent gave it, which Claude Code
 * shows when the option is focused. `answerable`: the session's own hooks module is waiting for it,
 * so an answer from the floor answers the dialog itself. `asMessage` (protocol 0.11.0 on): the
 * question can be answered from the floor even though the hooks module didn't see it asked (it was
 * asked before the plugin loaded): the plugin stops the agent's turn, which closes the dialog, and
 * submits the answers as the owner's own message. It never comes with `answerable` or `withheld`.
 * With neither, the floor shows the question read-only, and it is answered in the terminal.
 * `withheld`: the secret scan matched its text, or the patterns couldn't be read, so `questions` is
 * only a placeholder; it is answered in the terminal.
 */
export const QuestionFactSchema = z.object({
  id: z.string().min(1),
  agent: z.string().min(1),
  at: Time,
  questions: z
    .array(
      z.object({
        question: z.string().min(1),
        header: z.string(),
        options: z.array(z.object({ label: z.string().min(1), description: z.string(), preview: z.string().optional() })),
        multiSelect: z.boolean(),
      }),
    )
    .min(1),
  answerable: z.literal(true).optional(),
  asMessage: z.literal(true).optional(),
  withheld: z.literal(true).optional(),
  extra: Extra,
});

export const FactsSchema = z.object({
  session: SessionFactSchema,
  agents: z.array(AgentFactSchema),
  edits: z.array(FileFactSchema),
  reads: z.array(FileFactSchema),
  waits: z.array(WaitFactSchema),
  reports: z.array(ReportFactSchema),
  /** Absent from a data layer that doesn't report questions, which is the same as none. */
  questions: z.array(QuestionFactSchema).optional(),
  /** Absent from a data layer that doesn't report workflows, which is the same as none. */
  workflows: z.array(WorkflowFactSchema).optional(),
});

/** The records that changed, each replacing the one with the same key. */
export const FactUpsertSchema = z.object({
  session: SessionFactSchema.optional(),
  agents: z.array(AgentFactSchema).optional(),
  edits: z.array(FileFactSchema).optional(),
  reads: z.array(FileFactSchema).optional(),
  waits: z.array(WaitFactSchema).optional(),
  reports: z.array(ReportFactSchema).optional(),
  questions: z.array(QuestionFactSchema).optional(),
  workflows: z.array(WorkflowFactSchema).optional(),
});

const FileKey = FileFactSchema.pick({ agent: true, file: true, project: true });

/**
 * The keys of records that went away: an agent by its id, an edit or read by agent, file and
 * project (absent for the session's own), a
 * wait by waiter and on, a report by its agent, a question or a workflow by its id. The session itself goes with
 * the connection. `questionOutcomes`: how each question in `questions` ended, by its id: `answered`,
 * in the terminal or from the floor, or `abandoned`, with no answer (interrupted, or a new prompt
 * came first). Absent, or without a question's id, from a peer that doesn't say (protocol 0.3.5 on).
 */
export const FactRemoveSchema = z.object({
  agents: z.array(z.string().min(1)).optional(),
  edits: z.array(FileKey).optional(),
  reads: z.array(FileKey).optional(),
  waits: z.array(WaitFactSchema.pick({ waiter: true, on: true })).optional(),
  reports: z.array(z.string().min(1)).optional(),
  questions: z.array(z.string().min(1)).optional(),
  questionOutcomes: z.record(z.string().min(1), z.enum(["answered", "abandoned"])).optional(),
  workflows: z.array(z.string().min(1)).optional(),
});

export type Source = z.infer<typeof SourceSchema>;
export type Project = z.infer<typeof ProjectSchema>;
export type SessionFact = z.infer<typeof SessionFactSchema>;
export type AgentFact = z.infer<typeof AgentFactSchema>;
export type FileFact = z.infer<typeof FileFactSchema>;
export type WaitFact = z.infer<typeof WaitFactSchema>;
export type ReportFact = z.infer<typeof ReportFactSchema>;
export type QuestionFact = z.infer<typeof QuestionFactSchema>;
export type WorkflowFact = z.infer<typeof WorkflowFactSchema>;
export type Facts = z.infer<typeof FactsSchema>;
export type FactUpsert = z.infer<typeof FactUpsertSchema>;
export type FactRemove = z.infer<typeof FactRemoveSchema>;
