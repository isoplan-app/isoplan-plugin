// The experts on this computer (isoplan-app#340): this computer's one instance of each expert it
// keeps, each run by expert.ts in experts/<key>/, with its health log at
// ~/.claude/isoplan/logs/expert-<key>.log. On its owner's computers an expert runs from its expert
// file, ~/.claude/isoplan/experts/<key>.json; on every other computer from its instance file,
// ~/.claude/isoplan/expert-instances/<key>.json (expert-instance-file.ts), with the definition of the
// expert record it was set up from (experts/<key>/expert-records.json, expert-instance.ts). Both
// folders are watched (expert-files.ts).
//
// - One instance per key: a key with both files runs from its expert file, and the instance file is
//   logged as ignored. A file moving from one folder to the other (its owner changed) isn't a
//   removal: the running expert takes the new file, with the same fingerprint, so no new generation
//   grounds. An instance file whose record this computer doesn't have doesn't start.
// - Its clone, read/, is where it was first made, so its trunks can still be resumed: <key>/read,
//   or <folder>/experts/<key>/read for a folder runner.json's `clonesFolder` names or named before.
//   A new one goes in the folder `clonesFolder` names, else in <key>/ (readFolder).
// - A file that doesn't parse is logged, to runner.log and to that expert's health log, and its
//   expert doesn't start; one already running keeps running. A field the runner doesn't know is
//   logged once per load. A change is the expert's to apply; with both files gone its expert stops,
//   and its folder is kept. `refresh` reads a key's files again at once, as expert-instance.ts does
//   after it writes them; `remove` deletes an expert's instance, as its deletion on the floor does.
// - `start()` settles once every file and every state.json is read: from then every recorded trunk
//   is known to `isExpertSession`, and an expert that can resume its junior is ready. Git and
//   groundings run in the background.
// - Each key's record of what its instance learned and was told of (what-was-learned-for-one-expert.ts,
//   isoplan-app#366) is made here and given to its expert, and bound, once the instances and each
//   office's link exist, to which records the key's file is tied to (`bindWhatWasLearned`). A key
//   removed here forgets it, so a new expert of the key starts with nothing of the old one.

import fs from "node:fs";
import path from "node:path";
import type { Spawn, Track } from "./claude.js";
import { inside } from "./expert-claude.js";
import { parseExpertFile, type ExpertFile } from "./expert-file.js";
import { watchExpertFiles, type ExpertFiles } from "./expert-files.js";
import { createHealthLog, type HealthLog } from "./expert-health.js";
import { expertFileFromRecord, parseExpertInstanceFile, type ExpertInstanceFile } from "./expert-instance-file.js";
import { readExpertRecords } from "./expert-records-file.js";
import { createExpert, type Expert, type ExpertFailure, type ExpertSettings, type HostedExpert } from "./expert.js";
import type { RunGit } from "../handoff/git.js";
import { createWhatWasLearnedForOneExpert, type WhatWasLearnedBinding, type WhatWasLearnedForOneExpert } from "./what-was-learned-for-one-expert.js";

export type { HostedExpert } from "./expert.js";

export interface ExpertsOptions {
  /** <claudeDir>/isoplan/experts */
  expertsDir: string;
  /** <claudeDir>/isoplan/expert-instances */
  instancesDir: string;
  /** runner.json's `clonesFolder`, where a new expert's clone goes; "" for its folder in expertsDir. */
  clonesFolder?: string;
  /** Every folder `clonesFolder` has named (repo-folders.ts readClonesFolders), where an expert's clone made earlier may be. */
  clonesFolders?: readonly string[];
  /** <claudeDir>/isoplan/logs */
  logsDir: string;
  /** <claudeDir>/projects, where trunk transcripts are (resume check) */
  projectsDir: string;
  /** The runner's app folder: prompts/expert-*.md */
  appDir: string;
  binary: () => Promise<string | null>;
  /** runner.json */
  settings: () => Promise<ExpertSettings>;
  scan: (text: string) => Promise<string | null>;
  git: RunGit;
  gitTimeoutMs: () => Promise<number>;
  spawn?: Spawn;
  env?: Record<string, string | undefined>;
  track?: Track;
  log: (text: string) => void;
  now?: () => number;
  lookMs?: number;
  minuteMs?: number;
}

/** One running expert: which file runs it, the expert file it runs, and with an instance file that file. */
export interface RunningExpert {
  key: string;
  from: "expert-file" | "instance-file";
  file: ExpertFile;
  instance: ExpertInstanceFile | null;
  expert: Expert;
}

export interface Experts {
  /** Settles once the files and each state.json are read; the rest runs in the background. */
  start(): Promise<void>;
  hosted(): HostedExpert[];
  running(key: string): RunningExpert | null;
  all(): RunningExpert[];
  /** Something of `all()` changed: an expert added, removed, its file or its state. */
  onChange(listener: () => void): void;
  /** A grounding of the expert `key` isn't tried again on its own any more. */
  onTriesRanOut(listener: (key: string, ran: { why: ExpertFailure; proofAnswer: string | null }) => void): void;
  /** Reads the key's expert file, instance file and record again now, and runs what they say. */
  refresh(key: string): Promise<void>;
  /** Stops the key's expert and deletes its trunks, its clone and its folder. */
  remove(key: string): Promise<void>;
  health(key: string): HealthLog;
  expertFilePath(key: string): string;
  instanceFilePath(key: string): string;
  /** The key's folder: its state, ledger, clone and expert-records.json. */
  dir(key: string): string;
  /** A bare uuid of a trunk, any generation. */
  isExpertSession(sessionId: string): boolean;
  /** The key's record of what its instance learned and was told of. */
  whatWasLearned(key: string): WhatWasLearnedForOneExpert;
  /** Binds every key's record of what was learned, now and for keys to come. */
  bindWhatWasLearned(binding: (key: string) => WhatWasLearnedBinding): void;
  /** The files' ties to records may have changed: each key's record of what was learned looks again. */
  tiesMayHaveChanged(): void;
  /** No grounding, fork, addition or judge running. */
  idle(): boolean;
  /** Ends every process tree, the judge's included. */
  close(): void;
}

interface Slot {
  key: string;
  /** The last good parse of each file, kept while a later text doesn't parse; null once it is gone. */
  expertFile: ExpertFile | null;
  instanceFile: ExpertInstanceFile | null;
  /** The last text of each file that was logged as not parsing, so it is logged once. */
  badText: { expert: string | null; instance: string | null };
  saidIgnored: boolean;
  saidNoRecord: boolean;
  running: RunningExpert | null;
  /** The expert stopped when its files were removed, kept so that `remove` still deletes its trunks. */
  stoppedExpert: Expert | null;
  chain: Promise<void>;
}

const readText = (file: string) => fs.promises.readFile(file, "utf8").catch(() => null);

export function createExperts(o: ExpertsOptions): Experts {
  const slots = new Map<string, Slot>();
  const stopped: Expert[] = []; // stopped, kept so their processes are still ended on close
  const trunks = new Set<string>();
  const listeners: (() => void)[] = [];
  const triesListeners: ((key: string, ran: { why: ExpertFailure; proofAnswer: string | null }) => void)[] = [];
  const healths = new Map<string, HealthLog>();
  const loading: Promise<void>[] = [];
  const watchers: ExpertFiles[] = [];
  const learned = new Map<string, WhatWasLearnedForOneExpert>();
  let binding: ((key: string) => WhatWasLearnedBinding) | null = null;

  const whatWasLearned = (key: string) => {
    let w = learned.get(key);
    if (!w) {
      learned.set(key, (w = createWhatWasLearnedForOneExpert({ dir: dir(key), log: (t) => o.log(`expert ${key}: ${t}`), ...(o.now && { now: o.now }) })));
      if (binding) w.bind(binding(key));
    }
    return w;
  };

  const changed = () => listeners.forEach((l) => l());
  const health = (key: string) => {
    let h = healths.get(key);
    if (!h) healths.set(key, (h = createHealthLog(path.join(o.logsDir, `expert-${key}.log`), o.now)));
    return h;
  };
  const dir = (key: string) => path.join(o.expertsDir, key);
  const expertFilePath = (key: string) => path.join(o.expertsDir, `${key}.json`);
  const instanceFilePath = (key: string) => path.join(o.instancesDir, `${key}.json`);
  // Where an expert's clone is: where it was made, since its trunks resume only from there; else where a new one goes.
  const readFolder = (key: string) => {
    const made = [path.join(dir(key), "read"), ...[o.clonesFolder ?? "", ...(o.clonesFolders ?? [])].filter(Boolean).map((f) => path.join(f, "experts", key, "read"))];
    return made.find((p) => fs.existsSync(p)) ?? (o.clonesFolder ? path.join(o.clonesFolder, "experts", key, "read") : made[0]!);
  };
  const slotOf = (key: string) => {
    let s = slots.get(key);
    if (!s) slots.set(key, (s = { key, expertFile: null, instanceFile: null, badText: { expert: null, instance: null }, saidIgnored: false, saidNoRecord: false, running: null, stoppedExpert: null, chain: Promise.resolve() }));
    return s;
  };

  // Each file's text read now: a parse, kept as the last good one, or the one before when it doesn't parse.
  function readExpertText(s: Slot, text: string | null) {
    if (text === null) return void ((s.expertFile = null), (s.badText.expert = null));
    const fileName = `${s.key}.json`;
    const parsed = parseExpertFile(text, fileName);
    if (!parsed.ok) {
      if (s.badText.expert === text) return;
      s.badText.expert = text;
      const error = `${fileName}: ${parsed.field}: ${parsed.reason}`;
      o.log(`expert file ${error}${s.running?.from === "expert-file" ? "; the expert keeps running as it was" : ""}`);
      health(s.key).say("file", { error });
      return;
    }
    s.badText.expert = null;
    if (parsed.unknown.length && JSON.stringify(parsed.expert) !== JSON.stringify(s.expertFile)) o.log(`expert file ${fileName}: fields this runner doesn't know, ignored: ${parsed.unknown.join(", ")}`);
    s.expertFile = parsed.expert;
  }

  function readInstanceText(s: Slot, text: string | null) {
    if (text === null) return void ((s.instanceFile = null), (s.badText.instance = null));
    const fileName = `${s.key}.json`;
    const parsed = parseExpertInstanceFile(text, fileName);
    if (!parsed.ok) {
      if (s.badText.instance === text) return;
      s.badText.instance = text;
      const error = `${fileName}: ${parsed.field}: ${parsed.reason}`;
      o.log(`instance file ${error}${s.running?.from === "instance-file" ? "; the expert keeps running as it was" : ""}`);
      health(s.key).say("file", { error });
      return;
    }
    s.badText.instance = null;
    if (parsed.unknown.length && JSON.stringify(parsed.instance) !== JSON.stringify(s.instanceFile)) o.log(`instance file ${fileName}: fields this runner doesn't know, ignored: ${parsed.unknown.join(", ")}`);
    s.instanceFile = parsed.instance;
  }

  // Runs what the slot's files say now: the expert file's expert, else the instance file's, else none.
  async function apply(s: Slot) {
    let file: ExpertFile | null = null;
    let from: RunningExpert["from"] = "expert-file";
    let instance: ExpertInstanceFile | null = null;
    if (s.expertFile) {
      file = s.expertFile;
      if (s.instanceFile && !s.saidIgnored) o.log(`expert ${s.key}: both an expert file and an instance file are here, so it runs from the expert file and ${instanceFilePath(s.key)} is ignored`);
      s.saidIgnored = !!s.instanceFile;
    } else if (s.instanceFile) {
      s.saidIgnored = false;
      const held = (await readExpertRecords(dir(s.key))).servers[s.instanceFile.server]?.record;
      if (held) {
        s.saidNoRecord = false;
        file = expertFileFromRecord(held.definition, s.instanceFile);
        from = "instance-file";
        instance = s.instanceFile;
      } else if (!s.saidNoRecord) {
        s.saidNoRecord = true;
        o.log(`expert ${s.key}: its instance file names ${s.instanceFile.server}, whose record of it this computer doesn't have, so it doesn't start`);
      }
    }
    const running = s.running;
    if (!file) {
      if (!running) return;
      o.log(`expert ${s.key}: its file was removed, so it stops; its folder is kept`);
      running.expert.stop();
      stopped.push(running.expert);
      s.running = null;
      s.stoppedExpert = running.expert;
      return changed();
    }
    if (running) {
      const same = JSON.stringify(running.file) === JSON.stringify(file);
      Object.assign(running, { from, file, instance });
      if (!same) running.expert.update(file);
      return changed();
    }
    const key = s.key;
    const expert = createExpert({
      ...o,
      file,
      dir: dir(key),
      read: readFolder(key),
      health: health(key),
      onChange: changed,
      onTrunk: (trunk) => trunks.add(trunk),
      onTriesRanOut: (ran) => triesListeners.forEach((l) => l(key, ran)),
      whatWasLearned: whatWasLearned(key),
    });
    s.running = { key, from, file, instance, expert };
    s.stoppedExpert = null;
    loading.push(expert.start().catch((err: Error) => o.log(`expert ${key}: couldn't start: ${err.message}`)));
    changed();
  }

  // One key's work at a time, in order.
  const queue = (s: Slot, work: () => Promise<void>) => (s.chain = s.chain.then(work).catch((err: Error) => o.log(`expert ${s.key}: ${err.message}`)));

  const refresh = (key: string) => {
    const s = slotOf(key);
    return queue(s, async () => {
      readExpertText(s, await readText(expertFilePath(key)));
      readInstanceText(s, await readText(instanceFilePath(key)));
      await apply(s);
    });
  };

  return {
    async start() {
      for (const [folder, read] of [
        [o.expertsDir, readExpertText],
        [o.instancesDir, readInstanceText],
      ] as const) {
        const watcher = watchExpertFiles({
          dir: folder,
          ...(o.lookMs !== undefined && { lookMs: o.lookMs }),
          log: o.log,
          onChange: (change) => {
            const s = slotOf(change.name);
            void queue(s, async () => {
              read(s, change.kind === "removed" ? null : change.text!);
              await apply(s);
            });
          },
        });
        watchers.push(watcher);
        await watcher.look();
      }
      await Promise.all([...slots.values()].map((s) => s.chain));
      await Promise.all(loading);
    },
    hosted: () => [...slots.values()].flatMap((s) => (s.running ? [s.running.expert.hosted()] : [])).sort((a, b) => a.name.localeCompare(b.name)),
    running: (key) => slots.get(key)?.running ?? null,
    all: () => [...slots.values()].flatMap((s) => (s.running ? [s.running] : [])).sort((a, b) => a.key.localeCompare(b.key)),
    onChange: (listener) => void listeners.push(listener),
    onTriesRanOut: (listener) => void triesListeners.push(listener),
    refresh,
    remove(key) {
      const s = slotOf(key);
      return queue(s, async () => {
        const expert = s.running?.expert ?? s.stoppedExpert;
        s.running = null;
        s.stoppedExpert = null;
        s.expertFile = null;
        s.instanceFile = null;
        learned.get(key)?.forget();
        learned.delete(key);
        if (expert) await expert.remove();
        else await fs.promises.rm(dir(key), { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(() => {});
        changed();
      });
    },
    health,
    expertFilePath,
    instanceFilePath,
    dir,
    isExpertSession: (sessionId) => trunks.has(sessionId),
    whatWasLearned,
    bindWhatWasLearned(b) {
      binding = b;
      for (const [key, w] of learned) w.bind(b(key));
    },
    tiesMayHaveChanged: () => learned.forEach((w) => w.checkTies()),
    idle: () => [...[...slots.values()].flatMap((s) => (s.running ? [s.running.expert] : [])), ...stopped].every((e) => e.idle()),
    close() {
      for (const w of watchers) w.stop();
      for (const e of [...[...slots.values()].flatMap((s) => (s.running ? [s.running.expert] : [])), ...stopped]) e.close();
    },
  };
}

/** Whether a session is an expert's, to keep it off the floor: in the experts' folder or experts/ of a folder `clonesFolder` has named, or a trunk of one (while `experts` is made). */
export const expertIgnored =
  (expertsDir: string, experts: () => Pick<Experts, "isExpertSession"> | null, clonesFolders: readonly string[] = []) =>
  (id: string, cwd: string | null): boolean =>
    (cwd !== null && [expertsDir, ...clonesFolders.map((f) => path.join(f, "experts"))].some((dir) => inside(dir, cwd) !== null)) || (experts()?.isExpertSession(id) ?? false);
