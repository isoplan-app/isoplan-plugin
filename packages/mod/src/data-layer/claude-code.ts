// The claude-code source: turns the transcripts Claude Code already writes into one session's
// facts — the session, its lead and subagents, who started whom, their edits, reads, waits and
// reports, and what each one is doing now. It reads only the session it was started for: each
// session reports itself (#6), so no other session's transcript is ever opened.
//
// The transcript format is internal and undocumented, so every assumption about it lives in this
// one file (see docs/designs/agent-office-transcript-probe.md for where each field was found).
// A format change should be a one-file fix here, reported as a status rather than a crash.
//
// Ids are source-scoped: the session is claude-code:<session id>, its lead claude-code:<session
// id>:lead, and a subagent claude-code:<agent id>.

import type { AgentFact, Facts, FileFact, Project, QuestionFact, WorkflowFact } from "@isoplan/protocol";
import { attributionCache, createAttribution, type Attribution, type Placed } from "./attribution.js";
import type { Config } from "./config.js";
import { join, normalize, pathKey, relativeTo, type MaybePromise, type Stat, type Where } from "./git.js";
import type { DirEntry } from "./io.js";
import { shellFiles } from "./shell-writes.js";
import { agentsInView, createWorkflowReader, endStatus, listWorkflows, viewWorkflow, workflowLaunch, type RunState, type WorkflowAgentView, type WorkflowFiles, type WorkflowLaunch } from "./workflows.js";

const SOURCE = "claude-code";

// A session whose own transcript has been quiet longer than this is not checked for busy
// subagents. A parent waiting on a long foreground agent writes nothing, so the window has to be
// far wider than the liveness one.
const SUBAGENT_LOOKBACK_MS = 24 * 60 * 60 * 1000;

// A transcript not where the session's folder names it is searched for in every project folder at
// most this often.
const SEARCH_MS = 10000;

// What an agent is doing, read from the last tool it called. Any other tool shows as nothing, and a
// shell tool (`shellTools`) whose command writes a file shows as "write".
const DOING: Record<string, NonNullable<AgentFact["doing"]>["kind"]> = {
  Edit: "write",
  Write: "write",
  NotebookEdit: "write",
  Read: "read",
  Bash: "run",
  PowerShell: "run",
  Grep: "search",
  Glob: "search",
  WebSearch: "search",
  WebFetch: "search",
  Agent: "talk",
  SendMessage: "talk",
};

// The tool an agent asks its owner with. Each call with no result yet is an open question.
const ASK_TOOL = "AskUserQuestion";

// The tools whose file path counts as a read. A shell tool (`shellTools`) counts the files its
// command reads.
const READ_TOOLS = ["Read"];

const encoder = new TextEncoder();

export interface SourceIo {
  /** Claude Code's config folder: $CLAUDE_CONFIG_DIR, or ~/.claude. */
  claudeDir: string;
  /** The person's home folder: `~` in shell commands, and never a workspace, nor any folder above it. */
  home?: string;
  listDir(dir: string): MaybePromise<DirEntry[]>;
  stat(path: string): MaybePromise<Stat | null>;
  read(path: string, start?: number, end?: number): MaybePromise<string>;
  /** The path with symlinks resolved; without it, paths are compared as written. */
  realpath?(path: string): MaybePromise<string>;
  /** Whether a path is a folder now, asked as a transcript line is read: a copy into one names the file. */
  isDirSync?(path: string): boolean;
}

export interface ReadInput {
  /** The session's id, the name of its transcript file. */
  sessionId: string;
  /** The folder the session runs in, which names its transcript's project folder. */
  cwd: string;
  now: number;
  config: Config;
  /** Places a folder in git (the caller caches it). */
  resolve: (dir: string) => Promise<Where | null>;
  /** The project a repo is (the caller caches it), for an edit or command that lands in another repo. */
  projectOf: (where: Where) => MaybePromise<Project>;
}

export interface SourceRead {
  /** The session's facts, or null while there is nothing to report or it is left out. */
  facts: Facts | null;
  /** Why the facts can't be read at all, in one line; null when they can. */
  status: string | null;
  /** The session's transcript hasn't started: none is found yet, or it has only bookkeeping lines. */
  unstarted?: boolean;
  /** Transcripts that couldn't be read, counted, with the first error. */
  errors: { count: number; first: string | null };
  /** The session's folder is a workspace above several repos, so its own project is a local path. */
  workspace?: boolean;
  /** The project of each subagent whose worktree is another repo's, by agent id: its checkout goes only where that repo may (forOffice). */
  checkouts?: Record<string, string>;
  /** Whether the call with this id has a result that isn't an error: for a question, that it was answered. */
  answered?: (id: string) => boolean;
}

/**
 * Keep the object for the life of the data layer: it caches each transcript's parsed state by
 * size, so a pass reads only the bytes written since the last one. A cache entry the latest pass
 * didn't use is dropped, so a long session holds only what is in view.
 */
export function createClaudeCode(io: SourceIo) {
  const transcripts = new Map<string, TranscriptState>();
  const metas = new Map<string, { mtimeMs: number; meta: Meta }>();
  const found = new Map<string, string>(); // session id → its transcript, once located
  const workspaces = new Map<string, { at: number; is: boolean }>(); // folder → whether it is a workspace
  const places = attributionCache(); // which folders exist and where links lead, across passes
  const searched = new Map<string, number>(); // session id → when every project folder was last searched
  const runs = createWorkflowReader(io); // the session's workflow runs (workflows.ts)
  let used = new Set<string>(); // the cache keys this pass has used

  async function read({ sessionId, cwd, now, config, resolve, projectOf }: ReadInput): Promise<SourceRead> {
    used = new Set();
    runs.begin();
    const errors = { count: 0, first: null as string | null };
    const fail = (err: unknown) => {
      errors.count++;
      if (errors.first === null) errors.first = message(err);
    };
    const none = (status: string | null = null): SourceRead => ({ facts: null, status, errors });

    const c = await candidate(sessionId, cwd, now, config);
    if (c === "unstarted") return { ...none(), unstarted: true };
    if (!c) return none();
    let main: TranscriptState;
    try {
      main = await readTranscript(c.path, c.size, config.tailBytes);
    } catch (err) {
      fail(err);
      return none(`could not read the session transcript: ${errors.first}`);
    }
    try {
      if (leftOut(main, c, config)) return none();
      if (!main.cwd) {
        // Lines that don't parse, or message lines that parse but never name a folder: the format
        // has moved on. A session that has written only bookkeeping lines (ai-title, mode…) is not
        // drift, just not started.
        if (main.seen && (!main.parsed || main.messages)) return none("transcript format not recognised");
        return { ...none(), unstarted: true };
      }
      // The session's own folder is home (#74). One git can't place that holds repos is a workspace:
      // the session stays in its own room, whichever of its repos it works in.
      const home = await resolve(cwd);
      const workspace = !home && (await isWorkspace(cwd, now, config));
      const where = workspace ? { toplevel: normalize(cwd), commonDir: "", branch: null } : await resolve(main.cwd);
      if (!where) return none(`git could not place ${normalize(main.cwd)}`);
      const place = createAttribution({
        folder: cwd,
        where: workspace ? null : (home ?? where),
        resolve,
        projectOf,
        stat: (p) => io.stat(p),
        realpath: (p) => (io.realpath ? io.realpath(p) : p),
        cache: places,
        now,
      });
      const checkouts: Record<string, string> = {};
      const { facts, answered } = await sessionFacts(c, main, where, workspace, now, config, resolve, place, fail, checkouts);
      return { facts, status: null, errors, workspace, checkouts, answered };
    } finally {
      for (const cache of [transcripts, metas]) {
        for (const key of cache.keys()) if (!used.has(key)) cache.delete(key);
      }
      // An ended run's fact is kept while the run is listed at all, so one that leaves the view
      // and comes back (the lights going off move the view) is the same fact.
      runs.prune(c.listed);
    }
  }

  // What the runner needs of a session's lead before it forks it. The transcript is found by name
  // in every project folder, since the runner doesn't know the session's folder.
  async function lead(sessionId: string, now: number, config: Pick<Config, "tailBytes" | "stalledMinutes">): Promise<LeadState | null> {
    const path = await locate(sessionId, "", now);
    const st = path && (await io.stat(path));
    if (!path || !st) return null;
    const t = await readTranscript(path, st.size, config.tailBytes);
    if (!t.cwd) return null;
    return {
      cwd: t.cwd,
      working: t.turnOpen && now - st.mtimeMs <= config.stalledMinutes * 60000,
      compacted: t.compacted,
      context: t.usage?.context ?? 0,
      lastActive: st.mtimeMs,
    };
  }

  // The session's transcript goes straight to <projects>/<cwd as a folder name>/<id>.jsonl. Claude
  // Code may name the folder otherwise (a session moved, a long path shortened), so a miss looks
  // for <id>.jsonl in each project folder, by name: no transcript is opened to find it. Before
  // the first prompt there is no transcript at all, so that search runs at most every SEARCH_MS.
  async function locate(sessionId: string, cwd: string, now: number): Promise<string | null> {
    const known = found.get(sessionId);
    if (known && (await io.stat(known))) return known;
    const remember = (p: string) => (found.set(sessionId, p), p);
    const projects = join(io.claudeDir, "projects");
    const name = `${sessionId}.jsonl`;
    const guess = join(projects, `${cwd.replace(/[^a-zA-Z0-9]/g, "-")}/${name}`);
    if (await io.stat(guess)) return remember(guess);
    if (now - (searched.get(sessionId) ?? -Infinity) < SEARCH_MS) return null;
    searched.set(sessionId, now);
    for (const dir of await io.listDir(projects)) {
      if (!dir.isDir) continue;
      const p = join(projects, `${dir.name}/${name}`);
      if (await io.stat(p)) return remember(p);
    }
    return null;
  }

  // The session's transcript and its subagents', with the session's lights: on while its newest
  // write (its own, or any subagent's) is inside the idle window, off inside `lightsOffHours`,
  // and none past that. A subagent is kept while it is inside the idle window or the touched-file
  // window, whichever is wider, so its edits still count towards a possible conflict. With the
  // lights off that window ends at the session's last activity, not now: the room keeps whoever
  // was there when it went quiet.
  async function candidate(sessionId: string, cwd: string, now: number, config: Config): Promise<Candidate | "unstarted" | null> {
    const path = await locate(sessionId, cwd, now);
    const st = path && (await io.stat(path));
    if (!path || !st) return "unstarted";
    const idleMs = config.idleMinutes * 60000;
    const keepMs = Math.max(idleMs, config.lightsOffHours * 3600000);
    const agentWindowMs = Math.max(idleMs, config.touchedWindowMinutes * 60000);
    const all: AgentFile[] = [];
    let workflows: WorkflowFiles[] = [];
    if (now - st.mtimeMs <= Math.max(SUBAGENT_LOOKBACK_MS, keepMs)) {
      // Subagents of subagents sit in the same folder; meta.json says who started them.
      const subDir = join(path.slice(0, -".jsonl".length), "subagents");
      for (const f of await io.listDir(subDir)) {
        const m = /^agent-(.+)\.jsonl$/.exec(f.name);
        if (f.isDir || !m) continue;
        const ast = await io.stat(join(subDir, f.name));
        if (ast) all.push({ id: m[1]!, path: join(subDir, f.name), metaPath: join(subDir, `agent-${m[1]}.meta.json`), ...ast });
      }
      // A workflow's agents sit one folder down, in subagents/workflows/<run id>/ (workflows.ts).
      workflows = await listWorkflows(io, path.slice(0, -".jsonl".length), now, keepMs);
    }
    const lastActive = Math.max(st.mtimeMs, ...all.map((a) => a.mtimeMs), ...workflows.map((w) => w.lastActive));
    if (now - lastActive > keepMs) return null;
    const lit = now - lastActive <= idleMs;
    const from = lit ? now : lastActive;
    const agents = all.filter((a) => from - a.mtimeMs <= agentWindowMs);
    // A workflow in view brings all its agents, so its graph is whole.
    const inView = workflows.filter((w) => from - w.lastActive <= agentWindowMs);
    const subagents = all.length + workflows.reduce((n, w) => n + w.agents.length, 0);
    return { id: sessionId, path, size: st.size, ownMtime: st.mtimeMs, lastActive, lights: lit ? "on" : "off", agents, workflows: inView, listed: workflows.map((w) => w.id), subagents };
  }

  // A folder with a repo directly in it.
  // A folder the person works in that holds repos: one to `workspaceRepos` repos directly in it.
  // The home folder and the folders above it never are (~/Projects with dozens of repos is not a
  // piece of work). The answer is looked up again once gitCacheSeconds have passed.
  async function isWorkspace(dir: string, now: number, config: Config): Promise<boolean> {
    if (io.home && (pathKey(dir) === pathKey(io.home) || relativeTo(dir, io.home) !== null)) return false;
    const key = pathKey(dir);
    const hit = workspaces.get(key);
    if (hit && now - hit.at <= config.gitCacheSeconds * 1000) return hit.is;
    const st = await io.stat(dir);
    let repos = 0;
    if (st && st.isDir) for (const e of await io.listDir(dir)) if (e.isDir && (await io.stat(join(dir, `${e.name}/.git`)))) repos++;
    const is = repos >= 1 && repos <= config.workspaceRepos;
    workspaces.set(key, { at: now, is });
    return is;
  }

  async function sessionFacts(
    c: Candidate,
    main: TranscriptState,
    where: Where,
    workspace: boolean,
    now: number,
    config: Config,
    resolve: ReadInput["resolve"],
    place: Attribution,
    fail: (err: unknown) => void,
    checkouts: Record<string, string>,
  ): Promise<{ facts: Facts; answered: (id: string) => boolean }> {
    const session = `${SOURCE}:${c.id}`;
    const lead = `${session}:lead`;
    const agentFiles: (AgentFile & { t: TranscriptState; meta: Meta })[] = [];
    const readAgents = async (list: AgentFile[]) => {
      for (const a of list) {
        try {
          agentFiles.push({ ...a, t: await readTranscript(a.path, a.size, config.tailBytes), meta: await readMeta(a.metaPath) });
        } catch (err) {
          // An unreadable subagent transcript (deleted mid-read, locked) costs that agent, counted.
          fail(err);
        }
      }
    };
    // The subagents first, so a run one of them launched is read with its launch's script.
    await readAgents(c.agents);
    const scripts = new Map<string, string | null>();
    for (const t of [main, ...agentFiles.map((a) => a.t)]) for (const [runId, l] of t.workflows) scripts.set(runId, l.script);
    // Each workflow run in view, read off disk, and its agents, read as any subagent's are.
    const sessionDir = c.path.slice(0, -".jsonl".length);
    const runStates = new Map<string, { files: WorkflowFiles; run: RunState; more: number }>();
    const workflowAgents: AgentFile[] = [];
    for (const w of c.workflows) {
      try {
        const run = await runs.read(w, sessionDir, scripts.get(w.id) ?? null);
        const { kept, more } = agentsInView(w, run);
        runStates.set(w.id, { files: w, run, more });
        workflowAgents.push(...kept);
      } catch (err) {
        fail(err);
      }
    }
    await readAgents(workflowAgents);
    // The session's agents, by file id (any case), and by the names their spawning calls gave
    // them: what a check-in may name. A name two agents share names neither.
    const known = new Map(agentFiles.map((a) => [a.id.toLowerCase(), a.id]));
    const spawnNames = new Map([main, ...agentFiles.map((a) => a.t)].flatMap((t) => [...t.spawnNames]));
    const named = new Map<string, string | null>();
    for (const a of agentFiles) {
      const names = typeof a.meta.toolUseId === "string" ? (spawnNames.get(a.meta.toolUseId) ?? []) : [];
      for (const n of new Set(names.map((x) => x.toLowerCase()))) named.set(n, named.has(n) && named.get(n) !== a.id ? null : a.id);
    }
    const toId = (to: string) => known.get(to.toLowerCase()) ?? named.get(to.toLowerCase()) ?? null;
    // An agent's recent check-ins on another of the session's agents, newest last, whatever it is
    // doing now (protocol 0.3.6); none is left out of the facts.
    const checkMs = config.checkInSeconds * 1000;
    const checkInsOf = (self: string, t: TranscriptState, fallbackMs: number): { checkIns?: NonNullable<AgentFact["checkIns"]> } => {
      const list: NonNullable<AgentFact["checkIns"]> = [];
      for (const c of t.checks) {
        const to = toId(c.to);
        if (!to || agentId(to) === self || !(now - c.at < checkMs)) continue;
        const item = { with: agentId(to), kind: c.kind, since: iso(c.at, fallbackMs) };
        if (!list.some((x) => x.with === item.with && x.kind === item.kind && x.since === item.since)) list.push(item);
      }
      return list.length ? { checkIns: list.slice(-MAX_REPORTED) } : {};
    };

    // Done signals and spawns can sit in the session's own transcript or, for an agent's own
    // agents, in that agent's transcript, so look in all of them. A spawn keeps which file made it.
    const results = new Map(main.results);
    const notes = new Map(main.notes);
    const spawns = new Map<string, { at: number; by: string }>();
    for (const [toolUseId, at] of main.spawns) spawns.set(toolUseId, { at, by: lead });
    for (const a of agentFiles) {
      for (const [k, v] of a.t.results) results.set(k, v);
      for (const [k, v] of a.t.notes) notes.set(k, v);
      for (const [toolUseId, at] of a.t.spawns) spawns.set(toolUseId, { at, by: agentId(a.id) });
    }
    // Each transcript's newest write, by the agent that writes it.
    const mtimes = new Map<string, number>([[lead, c.ownMtime], ...agentFiles.map((a): [string, number] => [agentId(a.id), a.mtimeMs])]);

    // Each run's fact and its agents' places: started by whichever transcript's Workflow call
    // launched it, or the lead when that call isn't in view. An ended run's fact stays as first built.
    const launches = new Map<string, WorkflowLaunch & { at: number; by: string }>();
    for (const [runId, l] of main.workflows) launches.set(runId, { ...l, by: lead });
    for (const a of agentFiles) for (const [runId, l] of a.t.workflows) launches.set(runId, { ...l, by: agentId(a.id) });
    const workflowViews = new Map<string, Map<string, WorkflowAgentView>>();
    const workflowFacts: WorkflowFact[] = [];
    for (const [runId, { files, run, more }] of runStates) {
      const view = viewWorkflow({
        files,
        run,
        launch: launches.get(runId) ?? null,
        agents: agentFiles.filter((a) => a.run === runId).map((a) => ({ file: { ...a, run: runId }, firstAt: a.t.firstAt, lastAt: a.t.lastAt, tokens: tokensOf(a.t), meta: a.meta })),
        more,
        session,
        lead,
        now,
        config,
        frozen: runs.frozen.get(runId),
      });
      if (run.record) runs.frozen.set(runId, view.fact);
      workflowViews.set(runId, view.agents);
      // A starter no longer in view reads as the lead, as for its agents; the frozen fact keeps it.
      workflowFacts.push(mtimes.has(view.fact.startedBy) ? view.fact : { ...view.fact, startedBy: lead });
    }

    const branch = main.branch || where.branch;
    const facts: Facts = {
      session: {
        id: session,
        source: SOURCE,
        lead,
        title: main.title || branch,
        // A title written for a branch stand-in replaces it later; Claude Code's own stays as it is.
        titleFrom: main.title ? "source" : "branch",
        branch,
        checkout: where.toplevel,
        lastActive: iso(c.lastActive),
        status: now - c.lastActive <= config.activeMinutes * 60000 ? "active" : "idle",
        lights: c.lights,
      },
      agents: [],
      edits: [],
      reads: [],
      waits: [],
      reports: [],
      questions: [],
      ...(workflowFacts.length ? { workflows: workflowFacts } : {}),
    };

    // The lead works while its turn is open: from a prompt (or a notification it takes up) until
    // it answers without asking for a tool. A lead never stalls: an open turn quiet past
    // `stalledMinutes` is idle, even while it waits on a foreground agent, and it keeps its waits.
    // Idle runs from its last message line, so a later bookkeeping line doesn't move it.
    const leadWorking = main.turnOpen && now - c.ownMtime <= config.stalledMinutes * 60000;
    facts.agents.push({
      id: lead,
      source: SOURCE,
      session,
      startedBy: null,
      agentType: null,
      task: null,
      status: leadWorking ? "working" : "idle",
      statusSince: iso(leadWorking ? main.turnAt : main.lastMessageAt, c.ownMtime),
      lastActive: iso(c.ownMtime),
      doing: leadWorking ? await doingOf(main, place, c.ownMtime, config) : null,
      ...checkInsOf(lead, main, c.ownMtime),
      usage: usageOf(main, c.ownMtime),
    });
    // Its last reply, as its owner reads it on the floor: the server sends it to them alone.
    if (main.answer) facts.reports.push({ agent: lead, at: iso(main.answer.at, c.ownMtime), text: main.answer.text });
    main.touches = await addFiles(facts.edits, lead, main.touches, [...config.touchedTools, ...config.shellTools], now, config, place);
    main.reads = await addFiles(facts.reads, lead, main.reads, [...READ_TOOLS, ...config.shellTools], now, config, place);
    // The lead's question is open while its turn is: a prompt after it means it was never answered.
    if (main.turnOpen) addQuestions(facts.questions!, lead, main, results, c.ownMtime);

    for (const a of agentFiles) {
      const id = agentId(a.id);
      // One of a workflow's agents: its place and state come from its run (workflows.ts).
      const wf = a.run ? workflowViews.get(a.run)?.get(a.id) : undefined;
      const type = typeof a.meta.agentType === "string" && a.meta.agentType ? a.meta.agentType : null;
      const at = a.t.cwd ? await resolve(a.t.cwd) : null;
      // The worktree trap: a worktree-isolated agent's lines carry the PARENT's gitBranch, so the
      // agent's branch comes from meta.json, or from git at the agent's own folder — never its lines.
      let worktree = typeof a.meta.worktreePath === "string" ? normalize(a.meta.worktreePath) : null;
      // In a workspace, an agent working in one of its repos is not in a worktree.
      if (!worktree && at && !workspace && pathKey(at.toplevel) !== pathKey(where.toplevel)) worktree = at.toplevel;
      // A worktree of another repo is that repo's: where it may go is decided with its files.
      const elsewhere = worktree ? await place.dir(worktree) : null;
      if (elsewhere?.project) checkouts[id] = elsewhere.project.id;
      const agentBranch = worktree
        ? (typeof a.meta.worktreeBranch === "string" && a.meta.worktreeBranch) || (at && pathKey(at.toplevel) === pathKey(worktree) ? at.branch : null)
        : null;

      // Started by whichever transcript made the Agent call, else the parent meta.json names, else
      // the lead. One not in view (aged out, or never seen) falls back to the lead too.
      const spawn = typeof a.meta.toolUseId === "string" ? spawns.get(a.meta.toolUseId) : undefined;
      let startedBy = wf
        ? (workflowFacts.find((w) => w.id === a.run)?.startedBy ?? lead)
        : spawn
          ? spawn.by
          : typeof a.meta.parentAgentId === "string"
            ? agentId(a.meta.parentAgentId)
            : lead;
      if (!mtimes.has(startedBy)) startedBy = lead;

      const s: AgentStatus = wf ? { status: wf.status, since: wf.since, ...(wf.endState ? { endState: wf.endState } : {}) } : agentStatus(a, results, notes, spawn, now, mtimes.get(startedBy)!, config);
      const working = s.status === "working";
      // A stalled agent keeps its last action, to show where it stopped.
      const live = working || s.status === "stalled";
      facts.agents.push({
        id,
        source: SOURCE,
        session,
        startedBy,
        agentType: type,
        task: typeof a.meta.description === "string" && a.meta.description ? a.meta.description : null,
        status: s.status,
        statusSince: iso(s.since, a.mtimeMs),
        lastActive: iso(a.mtimeMs),
        doing: live ? await doingOf(a.t, place, a.mtimeMs, config) : null,
        ...checkInsOf(id, a.t, a.mtimeMs),
        usage: usageOf(a.t, a.mtimeMs),
        ...(worktree ? { checkout: worktree, branch: agentBranch } : {}),
        ...(wf ? { workflow: wf.workflow } : {}),
        extra: { description: a.meta.description ?? null, ...(s.endState ? { endState: s.endState } : {}) },
      });
      // Nobody waits on a workflow's agents: the Workflow tool returns as it launches them.
      if (live && !wf) {
        facts.waits.push({ waiter: startedBy, on: id, since: iso(spawn ? spawn.at : a.t.firstAt, a.mtimeMs) });
      }
      if (live) addQuestions(facts.questions!, id, a.t, results, a.mtimeMs);
      // A workflow agent's report is its result in the run's journal.
      if (wf) {
        if (wf.status === "done" && wf.report !== null) facts.reports.push({ agent: id, at: iso(wf.since, a.mtimeMs), text: wf.report });
      } else if ((s.status === "done" || s.status === "failed") && a.t.lastText !== null) {
        facts.reports.push({ agent: id, at: iso(a.t.lastTextAt, a.mtimeMs), text: a.t.lastText });
      }
      a.t.touches = await addFiles(facts.edits, id, a.t.touches, [...config.touchedTools, ...config.shellTools], now, config, place);
      a.t.reads = await addFiles(facts.reads, id, a.t.reads, [...READ_TOOLS, ...config.shellTools], now, config, place);
    }
    // A question no longer open was answered if its call has a result that isn't an error; an
    // interruption is an error, and a prompt that came first left it with no result at all.
    const answered = (id: string) => {
      const r = results.get(id);
      return !!r && !r.launched && r.status === "completed";
    };
    return { facts, answered };
  }

  async function readMeta(p: string): Promise<Meta> {
    used.add(p);
    const st = await io.stat(p);
    if (!st) return {};
    const cached = metas.get(p);
    if (cached && cached.mtimeMs === st.mtimeMs) return cached.meta;
    let meta: Meta = {};
    try {
      const value: unknown = JSON.parse(await io.read(p));
      if (value && typeof value === "object") meta = value as Meta;
    } catch {
      // An unreadable meta.json leaves the agent typeless.
    }
    metas.set(p, { mtimeMs: st.mtimeMs, meta });
    return meta;
  }

  // Parse a transcript incrementally. On first sight only the last `tailBytes` are read in full (a
  // busy session's file runs to megabytes); the part before them is read only for its usage, so
  // the token totals cover the whole session. After that, only what was appended since is read. A
  // file that shrank was rewritten, so it starts again.
  async function readTranscript(path: string, size: number, tailBytes: number): Promise<TranscriptState> {
    used.add(path);
    let st = transcripts.get(path);
    if (!st || size < st.offset) {
      st = newTranscriptState();
      st.offset = Math.max(0, size - tailBytes);
      st.fromStart = st.offset === 0;
      if (st.offset > 0) st.head = await sumUsage(path, st, tailBytes);
      transcripts.set(path, st);
    }
    if (size <= st.offset) return st;
    const text = await io.read(path, st.offset, size);
    const lastNl = text.lastIndexOf("\n");
    if (lastNl < 0) return st; // a line still being written; take it next time
    // Advance only past complete lines, so a half-written last line is read whole next time.
    st.offset = size - encoder.encode(text.slice(lastNl + 1)).length;
    const lines = text.slice(0, lastNl).split("\n");
    if (st.head !== null) {
      lines[0] = st.head + lines[0]; // a tail read starts mid-line
      st.head = null;
    }
    for (const line of lines) if (line.trim()) foldLine(st, line, io.home ?? null, io.isDirSync);
    return st;
  }

  // The usage of every reply before the tail, read in pieces of `chunk` bytes. Returns the start of
  // the line the tail begins inside, which is left for the tail read to finish and fold.
  async function sumUsage(path: string, st: TranscriptState, chunk: number): Promise<string> {
    let rest = "";
    for (let pos = 0; pos < st.offset; pos += chunk) {
      const text = rest + (await io.read(path, pos, Math.min(st.offset, pos + chunk)));
      const lastNl = text.lastIndexOf("\n");
      if (lastNl < 0) {
        rest = text;
        continue;
      }
      for (const line of text.slice(0, lastNl).split("\n")) foldUsage(st, line);
      rest = text.slice(lastNl + 1);
    }
    return rest;
  }

  return { id: SOURCE, read, lead };
}

/** A session's lead as the runner sees it before forking it. */
export interface LeadState {
  /** The folder its newest line ran in. */
  cwd: string;
  /** Its turn is open now: a fork would miss what it is doing. */
  working: boolean;
  /** It was compacted at least once, so earlier work survives only as a summary. */
  compacted: boolean;
  /** Its newest reply's prompt in tokens (input and both cache counts); 0 before any reply. */
  context: number;
  /** When its transcript was last written, in ms since the epoch. */
  lastActive: number;
}

// The transcript's types: what the source reads off a file, before it becomes facts.

interface AgentFile extends Stat {
  id: string;
  path: string;
  metaPath: string;
  /** The workflow run it is an agent of, if any. */
  run?: string;
}

interface Candidate {
  id: string;
  path: string;
  size: number;
  ownMtime: number;
  lastActive: number;
  lights: "on" | "off";
  agents: AgentFile[];
  /** The workflow runs in view, whose agents are read with the subagents. */
  workflows: WorkflowFiles[];
  /** Every run listed, in view or not: an ended one's fact is kept while it is. */
  listed: string[];
  subagents: number;
}

/** A subagent's meta.json, read defensively: any field may be missing or another type. */
interface Meta {
  agentType?: unknown;
  description?: unknown;
  toolUseId?: unknown;
  parentAgentId?: unknown;
  worktreePath?: unknown;
  worktreeBranch?: unknown;
}

interface Touch {
  at: number;
  cwd: string | null;
  name: string;
  path: string;
}

interface LastTool {
  name: string;
  file: string | null;
  cwd: string | null;
  /** The folder a shell command's programs last ran in. */
  dir?: string;
  at: number;
  wrote?: boolean;
}

type ToolResult = { launched: true; at?: number } | { status: string; at: number; launched?: undefined };

interface Tally {
  input: number;
  cacheWrite: number;
  cacheWrite1h: number;
  cacheRead: number;
  output: number;
}

interface TranscriptState {
  offset: number;
  head: string | null; // on a tail read, the start of the line the tail begins inside
  seen: number;
  parsed: number;
  messages: number; // parsed user/assistant/attachment/system lines, the ones that carry a cwd
  cwd: string | null;
  branch: string | null;
  title: string | null;
  firstAt: number; // the first timestamp seen (the start of the tail on a long file)
  lastAt: number;
  lastMessageAt: number; // the newest user/assistant/attachment/system line's time
  lastTool: LastTool | null; // wrote when a shell command writes `file`
  lastText: string | null;
  lastTextAt: number;
  lastRole: "user" | "assistant" | null; // the newest message line
  waiting: boolean; // the newest assistant line asked for a tool
  turnOpen: boolean; // a lead's turn is in progress
  turnAt: number; // when it opened
  answer: { text: string; at: number } | null; // a lead's newest text as its last turn ended: its reply, kept while the next turn runs
  results: Map<string, ToolResult>; // tool_use_id → its result
  spawns: Map<string, number>; // id of each Agent tool_use this file made → its time
  spawnNames: Map<string, string[]>; // id of each Agent or Task tool_use → the name and description it gave the agent
  checks: { to: string; kind: "talk" | "read"; at: number }[]; // check-ins on other agents, by id or name as written, newest last
  notes: Map<string, { status: string; at: number }>; // agent id → from <task-notification>
  touches: Touch[]; // tool uses that name a file
  reads: Touch[]; // the same, for the files a tool use read
  usage: { model: string; context: number; at: number } | null; // from the newest reply
  totals: Tally; // token counts summed over the replies, the whole file's even on a tail read
  over100k: Tally; // the part of them from replies whose prompt was over 100k tokens
  reply: { id: string | null; over100k: boolean; counts: Tally } | null; // the newest reply, as counted
  fromStart: boolean; // false when the first read was a tail read
  prompts: number; // user lines that opened a turn, tool results and interruptions aside
  tools: number; // tool_use blocks
  firstPrompt: string | null; // the first prompt's opening, for leftOut only: it is never sent
  compacted: boolean; // the session was compacted at least once
  asks: Map<string, { at: number; input: unknown }>; // id of each AskUserQuestion tool_use since the last prompt → its time and input
  workflows: Map<string, WorkflowLaunch & { at: number }>; // run id of each workflow this file launched → its launch
}

const agentId = (id: string) => `${SOURCE}:${id}`;

// Pushes each question `t` asked that has no result yet, as the protocol shapes it. A call whose
// input doesn't have that shape (the tool's input is the model's to write) is left out. One of which
// a question or option was left out (no text, no label) is marked `incomplete`: an answer from the
// floor would not cover all of it, so it is answered in the terminal.
function addQuestions(list: QuestionFact[], agent: string, t: TranscriptState, results: Map<string, ToolResult>, mtimeMs: number): void {
  for (const [id, ask] of t.asks) {
    if (results.has(id)) continue;
    const asked = (ask.input as { questions?: unknown } | null)?.questions;
    if (!Array.isArray(asked)) continue;
    const questions: QuestionFact["questions"] = [];
    let incomplete = false;
    for (const q of asked as Line[]) {
      if (!q || typeof q.question !== "string" || !q.question) {
        incomplete = true;
        continue;
      }
      const given: Line[] = Array.isArray(q.options) ? q.options : [];
      const options = given.filter((o) => o && typeof o.label === "string" && o.label);
      if (options.length !== given.length) incomplete = true;
      questions.push({
        question: q.question,
        header: typeof q.header === "string" ? q.header : "",
        options: options.map((o) => ({ label: o.label, description: typeof o.description === "string" ? o.description : "", ...(typeof o.preview === "string" && o.preview ? { preview: o.preview } : {}) })),
        multiSelect: q.multiSelect === true,
      });
    }
    if (questions.length) list.push({ id, agent, at: iso(ask.at, mtimeMs), questions, ...(incomplete ? { extra: { incomplete: true } } : {}) });
  }
}

const message = (err: unknown) => String((err && (err as Error).message) || err);

// An ISO time from milliseconds, or from `fallback` when the transcript gave no usable time.
function iso(ms: number, fallback?: number): string {
  return new Date(Number.isFinite(ms) ? ms : fallback!).toISOString();
}

// Pushes { agent, file, at } to `list` for each file `touches` names by one of `tools`: the file
// relative to the innermost worktree it is in, with that repo when it isn't the session's own
// (attribution.ts), at its newest time, one per repo and file. In no repo: dropped. Whether it may
// leave the machine is decided later (forOffice). Returns the touches still inside the window.
async function addFiles(list: FileFact[], agent: string, touches: Touch[], tools: string[], now: number, config: Config, place: Attribution): Promise<Touch[]> {
  const since = now - config.touchedWindowMinutes * 60000;
  const kept = touches.filter((t) => t.at >= since);
  const newest = new Map<string, { placed: Placed; at: number }>();
  for (const t of kept) {
    if (!tools.includes(t.name) || !t.cwd) continue;
    const placed = await place.file(t.path);
    if (!placed) continue;
    const key = `${placed.project?.id ?? ""}\n${placed.file}`;
    if (!((newest.get(key)?.at ?? -Infinity) >= t.at)) newest.set(key, { placed, at: t.at });
  }
  for (const { placed, at } of newest.values()) list.push({ agent, ...placed, at: iso(at) });
  return kept;
}

const tally = (): Tally => ({ input: 0, cacheWrite: 0, cacheWrite1h: 0, cacheRead: 0, output: 0 });

function newTranscriptState(): TranscriptState {
  return {
    offset: 0,
    head: null,
    seen: 0,
    parsed: 0,
    messages: 0,
    cwd: null,
    branch: null,
    title: null,
    firstAt: NaN,
    lastAt: NaN,
    lastMessageAt: NaN,
    lastTool: null,
    lastText: null,
    lastTextAt: NaN,
    lastRole: null,
    waiting: false,
    turnOpen: false,
    turnAt: NaN,
    answer: null,
    results: new Map(),
    spawns: new Map(),
    spawnNames: new Map(),
    checks: [],
    notes: new Map(),
    touches: [],
    reads: [],
    usage: null,
    totals: tally(),
    over100k: tally(),
    reply: null,
    fromStart: true,
    prompts: 0,
    tools: 0,
    firstPrompt: null,
    compacted: false,
    asks: new Map(),
    workflows: new Map(),
  };
}

const MESSAGE_TYPES = new Set(["user", "assistant", "attachment", "system"]);

// A transcript line, read defensively: it is internal, and lines come and go.
type Line = Record<string, any>;

// Fold one transcript line into the file's running state. Lines that don't parse, or parse to
// something without a `type`, are skipped.
function foldLine(st: TranscriptState, line: string, home: string | null, isDir?: (path: string) => boolean): void {
  st.seen++;
  let ev: Line;
  try {
    ev = JSON.parse(line);
  } catch {
    return;
  }
  if (!ev || typeof ev !== "object" || typeof ev.type !== "string") return;
  st.parsed++;
  if (MESSAGE_TYPES.has(ev.type)) st.messages++;

  const at = Date.parse(ev.timestamp);
  if (Number.isFinite(at)) {
    st.lastAt = at;
    if (!Number.isFinite(st.firstAt)) st.firstAt = at;
    if (MESSAGE_TYPES.has(ev.type)) st.lastMessageAt = at;
  }
  // Bookkeeping lines (ai-title, queue-operation, mode…) carry no cwd; keep the newest that does.
  if (typeof ev.cwd === "string" && ev.cwd) st.cwd = ev.cwd;
  if (typeof ev.gitBranch === "string" && ev.gitBranch) st.branch = ev.gitBranch;
  if (ev.type === "ai-title" && typeof ev.aiTitle === "string" && ev.aiTitle) st.title = ev.aiTitle;
  if (ev.type === "queue-operation" && typeof ev.content === "string") readNotifications(st, ev.content, at);
  if (isCompaction(ev)) st.compacted = true;

  const content = ev.message && ev.message.content;
  if (ev.type === "assistant" && Array.isArray(content)) {
    st.lastRole = "assistant";
    st.waiting = false;
    readUsage(st, ev.message, at);
    for (const c of content) {
      if (!c || typeof c !== "object") continue;
      if (c.type === "text" && typeof c.text === "string" && c.text.trim()) {
        st.lastText = c.text;
        st.lastTextAt = at;
      }
      if (c.type !== "tool_use") continue;
      st.tools++;
      st.waiting = true;
      if (c.name === "Agent" && typeof c.id === "string") st.spawns.set(c.id, at);
      if (SPAWN_TOOLS.has(c.name) && typeof c.id === "string" && c.input && typeof c.input === "object") {
        const names = [c.input.name, c.input.description].filter((x): x is string => typeof x === "string" && x.trim() !== "");
        if (names.length) st.spawnNames.set(c.id, names.map((x) => x.trim()));
      }
      if (c.name === ASK_TOOL && typeof c.id === "string") st.asks.set(c.id, { at, input: c.input });
      const input = c.input || {};
      // The line's cwd is the folder the shell is in when the call runs: a lead's shell keeps a cd
      // between calls and its next lines carry the new folder; a subagent's shell starts each call
      // in the agent's own folder, and its lines stay there. So a cd in an earlier call is already
      // in this line, and shellFiles follows only the ones inside this command.
      const cwd: string | null = ev.cwd || st.cwd;
      // Any tool with a command is read as a shell: read time keeps only the `shellTools`.
      const shell = typeof input.command === "string" ? shellFiles(input.command, cwd, { powershell: c.name === "PowerShell", home, isDir }) : { writes: [], reads: [], dirs: [] };
      const writes = shell.writes;
      const file = typeof input.file_path === "string" ? input.file_path : typeof input.notebook_path === "string" ? input.notebook_path : typeof input.path === "string" ? input.path : null;
      const dir = shell.dirs[shell.dirs.length - 1];
      st.lastTool = writes.length ? { name: c.name, file: writes[writes.length - 1]!, cwd, at, wrote: true } : { name: c.name, file, cwd, ...(dir ? { dir } : {}), at };
      // A check-in on another agent: by its id or name, as the call wrote it; resolved at read time.
      for (const check of checkIns(c.name, input, writes)) st.checks.push({ ...check, at });
      if (st.checks.length > MAX_CHECKS) st.checks.splice(0, st.checks.length - MAX_CHECKS);
      // Edit and Read paths and shell writes and reads are absolute; they are resolved against this
      // line's cwd at read time, which also keeps only the tools that count.
      const target = input.file_path || input.notebook_path;
      const targets: string[] = typeof target === "string" ? [target] : writes;
      const reads: string[] = typeof target === "string" ? [target] : shell.reads;
      if (Number.isFinite(at)) {
        for (const path of targets) st.touches.push({ at, cwd, name: c.name, path });
        for (const path of reads) st.reads.push({ at, cwd, name: c.name, path });
      }
    }
    // Each content block is its own line, so a text or thinking line inside a turn that goes on to
    // call a tool carries stop_reason "tool_use" while the tool_use line itself is still to come.
    setTurn(st, st.waiting || ev.message.stop_reason === "tool_use", at);
  } else if (ev.type === "user" && content != null) {
    st.lastRole = "user";
    let toolResults = false;
    if (typeof content === "string") readNotifications(st, content, at);
    else if (Array.isArray(content)) {
      for (const c of content) {
        if (!c || typeof c !== "object") continue;
        if (c.type === "text" && typeof c.text === "string") readNotifications(st, c.text, at);
        if (c.type === "tool_result" && typeof c.tool_use_id === "string") {
          toolResults = true;
          st.results.set(c.tool_use_id, { ...toolResult(ev.toolUseResult, c.is_error), at });
          const launch = workflowLaunch(ev.toolUseResult);
          if (launch) st.workflows.set(launch.runId, { ...launch, at });
        }
      }
    }
    const turn = userTurn(ev, content);
    if (turn !== null) setTurn(st, turn, at);
    // A prompt (not a tool result) starts a new turn: the last turn's tool is not what it is doing.
    if (turn === true && !toolResults) {
      st.lastTool = null;
      st.asks.clear();
      st.prompts++;
      if (st.firstPrompt === null) st.firstPrompt = promptText(content).slice(0, PROMPT_CHARS);
    }
  }
}

// The newest reply's model and context size (its input plus both cache counts), and its token
// counts summed over the replies read: input, cache written (of it, for an hour), cache read and
// output. Each content block of a reply is its own line carrying the same usage, so a reply counts
// once: a line with the newest reply's id replaces that reply's counts. A reply whose prompt (its
// input and both cache counts) is over 100k tokens is also summed in over100k, for a model priced
// higher above that. A line the client made up (model "<synthetic>") is no reply.
const OVER = 100000;

function readUsage(st: TranscriptState, message: Line, at: number): void {
  const u = message.usage;
  if (!u || typeof u !== "object" || typeof message.model !== "string" || !message.model || message.model.startsWith("<")) return;
  const n = (o: Line | undefined, key: string): number => (o && typeof o === "object" && Number.isFinite(o[key]) ? o[key] : 0);
  const counts: Tally = {
    input: n(u, "input_tokens"),
    cacheWrite: n(u, "cache_creation_input_tokens"),
    cacheWrite1h: n(u.cache_creation, "ephemeral_1h_input_tokens"),
    cacheRead: n(u, "cache_read_input_tokens"),
    output: n(u, "output_tokens"),
  };
  const id = typeof message.id === "string" ? message.id : null;
  const prompt = counts.input + counts.cacheRead + counts.cacheWrite;
  const before = st.reply && id && st.reply.id === id ? st.reply : null;
  for (const key of Object.keys(counts) as (keyof Tally)[]) {
    st.totals[key] += counts[key] - (before ? before.counts[key] : 0);
    if (before && before.over100k) st.over100k[key] -= before.counts[key];
    if (prompt > OVER) st.over100k[key] += counts[key];
  }
  st.reply = { id, over100k: prompt > OVER, counts };
  st.usage = { model: message.model, context: prompt, at };
}

// A line from before the tail, read for its usage alone: a line that doesn't name usage isn't parsed.
// A compaction there is read too, so a long session compacted early still counts as compacted.
function foldUsage(st: TranscriptState, line: string): void {
  if (!line.includes('"usage"') && !line.includes("compact")) return;
  let ev: Line;
  try {
    ev = JSON.parse(line);
  } catch {
    return;
  }
  if (isCompaction(ev)) st.compacted = true;
  if (ev && ev.type === "assistant" && ev.message && typeof ev.message === "object") readUsage(st, ev.message, Date.parse(ev.timestamp));
}

// Claude Code marks a compaction with a compact_boundary system line, then the summary as a user line.
const isCompaction = (ev: Line): boolean => !!ev && typeof ev === "object" && ((ev.type === "system" && ev.subtype === "compact_boundary") || ev.isCompactSummary === true);

// An agent's tokens as Claude Code counts them for a workflow's total: its newest reply's prompt and output.
const tokensOf = (st: TranscriptState) => (st.usage?.context ?? 0) + (st.reply?.counts.output ?? 0);

// An agent's usage: null until a reply with usage has been read.
function usageOf(st: TranscriptState, fallbackMs: number): AgentFact["usage"] {
  return st.usage && { model: st.usage.model, context: st.usage.context, ...st.totals, over100k: { ...st.over100k }, at: iso(st.usage.at, fallbackMs) };
}

function setTurn(st: TranscriptState, open: boolean, at: number): void {
  if (open && !st.turnOpen) st.turnAt = at;
  // A turn that ends having said something leaves that as its reply; one that said nothing keeps the last.
  if (!open && st.turnOpen && st.lastText !== null && !(st.lastTextAt < st.turnAt)) st.answer = { text: st.lastText, at: st.lastTextAt };
  st.turnOpen = open;
}

// How a user line moves the lead's turn: a prompt, a tool result or a notification opens it (true),
// an interruption ends it (false), and meta lines, slash-command echoes and compaction summaries
// leave it as it was (null).
function userTurn(ev: Line, content: unknown): boolean | null {
  if (ev.isMeta || ev.isCompactSummary) return null;
  const texts =
    typeof content === "string"
      ? [content]
      : Array.isArray(content)
        ? content.filter((c) => c && c.type === "text" && typeof c.text === "string").map((c) => c.text as string)
        : [];
  if (texts.some((t) => t.startsWith("[Request interrupted by user"))) return false;
  if (texts.length && texts.every((t) => /^\s*<(command-|local-command-)/.test(t))) return null;
  return true;
}

// The first prompt's opening is kept only to match it against `helperPrompts`.
const PROMPT_CHARS = 200;

function promptText(content: unknown): string {
  if (typeof content === "string") return content;
  const text = Array.isArray(content) && content.find((c) => c && c.type === "text" && typeof c.text === "string");
  return text ? text.text : "";
}

// A session left out of the office. A tool's helper session: read from its start, one prompt that
// opens with one of `helperPrompts` (case aside), and no tool calls or subagents; it goes back in
// once it takes a second prompt or calls a tool. And a session gone lights-off that never got a
// real reply (one with usage): a terminal opened and closed, or a lone slash command.
function leftOut(st: TranscriptState, c: Candidate, config: Config): boolean {
  if (c.lights === "off" && !st.usage) return true;
  if (!st.fromStart || st.prompts !== 1 || st.tools || c.subagents) return false;
  const opening = st.firstPrompt!.trimStart().toLowerCase();
  return config.helperPrompts.some((p) => typeof p === "string" && p && opening.startsWith(p.toLowerCase()));
}

// A background Agent call answers at once with a launch acknowledgement. That is not "done".
function toolResult(r: unknown, isError: unknown): { launched: true } | { status: string } {
  if (r && typeof r === "object") {
    const o = r as Line;
    if (o.isAsync || o.status === "async_launched") return { launched: true };
    if (typeof o.status === "string") return { status: o.status };
  }
  return { status: isError ? "failed" : "completed" };
}

function readNotifications(st: TranscriptState, text: string, at: number): void {
  if (!text.includes("<task-notification>")) return;
  for (const m of text.matchAll(/<task-notification>([\s\S]*?)<\/task-notification>/g)) {
    const id = /<task-id>\s*([^<\s]+)\s*<\/task-id>/.exec(m[1]!);
    const status = /<status>\s*([^<\s]+)\s*<\/status>/.exec(m[1]!);
    if (id && status && status[1] !== "running") st.notes.set(id[1]!, { status: status[1]!, at });
  }
}

interface AgentStatus {
  status: "working" | "stalled" | "done" | "stopped" | "failed";
  since: number;
  endState?: string;
}

/**
 * A subagent's { status, since, endState? }, with the raw end state Claude Code gave (completed,
 * killed, stopped, failed…) when it has ended.
 */
function agentStatus(
  a: AgentFile & { t: TranscriptState; meta: Meta },
  results: Map<string, ToolResult>,
  notes: Map<string, { status: string; at: number }>,
  spawn: { at: number } | undefined,
  now: number,
  starterMtimeMs: number,
  config: Config,
): AgentStatus {
  // Foreground: the parent's tool_result for the Agent call. A launch acknowledgement doesn't count.
  const r = typeof a.meta.toolUseId === "string" ? results.get(a.meta.toolUseId) : undefined;
  if (r && !r.launched) return ended(r.status, r.at);
  // Background: the completion notification, unless the agent was resumed and has written since.
  const n = notes.get(a.id);
  if (n && !(a.t.lastAt > n.at)) return ended(n.status, n.at);
  // The parent's Agent call is in view with neither signal: working while the agent or whoever
  // started it (the lead, or the parent subagent) has written within `stalledMinutes`. Both quiet
  // longer than that is stalled: most often an orphan whose parent crashed or exited, though a
  // foreground agent stuck in one long tool call while its parent waits looks the same.
  if (spawn) {
    const stalledMs = config.stalledMinutes * 60000;
    const quietSince = Math.max(a.mtimeMs, starterMtimeMs);
    if (now - quietSince > stalledMs) return { status: "stalled", since: quietSince + stalledMs };
    return { status: "working", since: spawn.at };
  }
  // The spawn isn't in view (perhaps before the part of the parent we read): the quiet-file rule.
  if (now - a.mtimeMs >= config.quietSeconds * 1000 && a.t.lastRole === "assistant" && !a.t.waiting) return ended("completed", a.t.lastAt);
  return { status: "working", since: a.t.firstAt };
}

function ended(state: string, at: number): AgentStatus {
  return { status: endStatus(state), since: at, endState: state };
}

// The tools that start an agent, whose input names it; the tools that only read a file or folder,
// at `file_path` or `path`; and how many check-ins a transcript keeps and the facts report.
const SPAWN_TOOLS = new Set(["Agent", "Task"]);
const READ_LIKE = new Set(["Read", "Grep", "Glob", "NotebookRead"]);
const MAX_CHECKS = 20;
const MAX_REPORTED = 5;

// A background agent's output file (<tasks folder>/<agent id>.output) or its transcript
// (subagents/agent-<agent id>.jsonl, or subagents/workflows/<run id>/agent-<agent id>.jsonl for a
// workflow's agent), anywhere in a path or command, in any case. Background shells' output files
// match too: only ids of the session's agents are kept at read time.
const AGENT_FILES = /[\\/](?:tasks[\\/]([a-z0-9_-]+)\.output|subagents[\\/](?:workflows[\\/][a-z0-9_-]+[\\/])?agent-([a-z0-9_-]+)\.jsonl)(?![\w.-])/gi;
const agentsIn = (text: string) => [...text.matchAll(AGENT_FILES)].map((m) => (m[1] ?? m[2])!.toLowerCase());

// The check-ins a tool call makes on other agents, by id or name as it wrote them: SendMessage to
// one; TaskOutput; a read-only tool at an agent's output file or transcript; or a shell command
// that names one without writing it (one that writes repo files keeps that as what it is doing).
// A Write or an Edit to such a file is not a check-in.
function checkIns(name: string, input: Record<string, unknown>, writes: readonly string[]): { to: string; kind: "talk" | "read" }[] {
  if (name === "SendMessage") return typeof input.to === "string" && input.to.trim() ? [{ to: input.to.trim(), kind: "talk" }] : [];
  if (name === "TaskOutput") return typeof input.task_id === "string" && input.task_id ? [{ to: input.task_id, kind: "read" }] : [];
  let ids: string[] = [];
  if (READ_LIKE.has(name)) ids = [input.file_path, input.path].flatMap((x) => (typeof x === "string" ? agentsIn(x) : []));
  else if (typeof input.command === "string") {
    const written = new Set(writes.flatMap(agentsIn));
    ids = agentsIn(input.command).filter((id) => !written.has(id));
  }
  return [...new Set(ids)].map((to) => ({ to, kind: "read" as const }));
}

// The agent's last tool call as { kind, file?, since }, the file relative to the worktree it is in,
// with its repo when that isn't the session's, as for edits; in no repo the file is dropped. A
// shell command with no file names the repo its programs ran in. A tool with no kind in DOING shows
// as nothing; a shell tool's write shows as "write".
async function doingOf(st: TranscriptState, place: Attribution, fallbackMs: number, config: Config): Promise<AgentFact["doing"]> {
  const t = st.lastTool;
  const kind = t && (t.wrote && config.shellTools.includes(t.name) ? "write" : Object.hasOwn(DOING, t.name) ? DOING[t.name] : undefined);
  if (!t || !kind) return null;
  const placed = t.file && t.cwd ? await place.file(t.file) : t.dir ? await place.dir(t.dir) : null;
  return { kind, ...placed, since: iso(t.at, fallbackMs) };
}
