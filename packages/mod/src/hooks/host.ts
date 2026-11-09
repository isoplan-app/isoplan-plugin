// The part of Claude Code's mod API this hooks module uses, typed by hand. The full declaration
// (`claude-code`) is written per Claude Code build into a temp folder, so it can't be a build
// input here; each member below matches that file as of Claude Code 2.1.303.

export interface ToolCallInput {
  tool: string;
  tool_use_id: string;
  /** The subagent's id; absent on the main loop. */
  agentId?: string;
  /** The tool's own arguments, beside these. */
  [argument: string]: unknown;
}

/** `{ deny }`, or the tool's result, possibly an error, with notes the model reads after it. */
export interface ToolCallResult {
  deny?: string;
  isError?: true;
  context?: readonly string[];
  [key: string]: unknown;
}

export interface SessionStartInput {
  cwd: string;
}

export type ModelCompleteResult = { isAnswered: true; text: string } | { isAnswered: false; reason: string };

export interface Host {
  plugin: {
    /** The plugin's directory (the one holding .claude-plugin/plugin.json), absolute. */
    root: string;
  };
  session: {
    id(): Promise<string>;
    cwd(): Promise<string>;
    /** The status line's figures; `context.window` is its `context_window_size`. Not in every Claude Code build: call it inside a try. */
    usage?(): Promise<{ context: { window: number } }>;
    /** The engine's version (`2.1.312`) and the release it is built from (`2.1.312-dev` for a development build). Not in every Claude Code build: call it inside a try. */
    version?(): Promise<{ version: string; base?: string }>;
  };
  /** Not in every Claude Code build (2.1.312 has it): call it inside a try, never read it as a value. */
  prompt?: {
    /**
     * Submits a prompt the model reads as a user turn of its own, once the session is idle; it
     * resolves once the prompt entered, or `{ drop }` when it didn't. `asUser`: read bare, as the
     * person's own words, though the transcript still names the plugin. The prompt box is untouched.
     */
    submit?(input: { text: string; asUser?: true }): Promise<{ drop?: string }>;
  };
  /** Not in every Claude Code build: call it inside a try, never read it as a value. */
  turn?: {
    /** Ends the main loop's running turn, closing any dialog in it; rejects, naming the running turn's id, when `turnId` isn't it. */
    abort?(input: { turnId: string }): Promise<void>;
  };
  process: {
    /** Streams a child's output; the loop is the child's life: `return()` or the module's unload ends it. */
    spawn(request: { argv: readonly string[]; cwd?: string }): AsyncGenerator<{ stream: "stdout" | "stderr"; text: string }, { code: number | null; signal: string | null }>;
    /** Runs a command by argv (no shell) and resolves once it exits; the timeout is 30 s unless given, ten minutes at most. */
    run(argv: readonly string[], init?: { cwd?: string; stdin?: string; timeoutMs?: number }): Promise<{ exitCode: number; stdout: string; stderr: string }>;
  };
  agent: {
    /** The session's agents, each with its id (a loop's `agentId`) and status. */
    list(): Promise<{ id: string; status: string }[]>;
  };
  tool: {
    /** Declares a tool the model can call, as `mcp__<plugin>__<name>`, served by a `tool.call` hook on that name. */
    register(tool: { name: string; description: string; inputSchema?: Record<string, unknown>; isDeferred?: boolean }): Promise<{ tool: string }>;
  };
  model: {
    complete(request: { model: string; prompt: string; system?: string; maxTokens?: number }): Promise<ModelCompleteResult>;
  };
  fs: {
    write(path: string, text: string): Promise<void>;
    /** Not in every Claude Code build: check before calling. */
    exists?(path: string): Promise<boolean>;
  };
  ui: {
    /** This plugin's one status line under the prompt; undefined clears it. */
    status(text: string | undefined): void;
    log(text: string, options?: { to?: "transcript" | "debug" }): void;
  };
  clock: {
    now(): Promise<number>;
    sleep(ms: number): Promise<void>;
    after(ms: number, fn: () => void): { cancel(): void };
  };
}

export interface SessionEndInput {
  reason: string;
  sessionId: string;
}

type Hook<E, R> = ($: Host, e: E, next: (e: E) => Promise<R>) => R | Promise<R>;

interface Registration<E, R> {
  /** Answers in the hook's place when it throws. */
  catch(handler: Hook<E, R>): void;
}

export interface On {
  (event: "session.start", hook: Hook<SessionStartInput, unknown>): Registration<SessionStartInput, unknown>;
  (event: "session.end", hook: Hook<SessionEndInput, unknown>): Registration<SessionEndInput, unknown>;
  (event: "tool.call", hook: Hook<ToolCallInput, ToolCallResult>): Registration<ToolCallInput, ToolCallResult>;
}
