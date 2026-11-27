// An employee's Claude Code processes (isoplan-app#341): their command lines, each run hidden in the
// employee's read clone with forkEnv's environment (claude.ts), as an expert's are (expert-claude.ts):
//
//   trunk   claude -p --session-id <trunk> --model <m> EMPLOYEE_TOOLS STREAM        grounding
//   append  claude -p --resume <trunk> --model <m> EMPLOYEE_TOOLS STREAM            what it learned, one turn
//   fork    claude -p --resume <trunk> --fork-session --no-session-persistence --resume-session-at <uuid> --model <m> EMPLOYEE_TOOLS STREAM
//                                                                                     a run, or learning from corrections
//   EMPLOYEE_TOOLS = --tools <the job's tools, in JOB_TOOLS order> --disallowedTools <employeeDisallowed(job)>
//                    --setting-sources "" NO_HOOKS --mcp-config <its process's config> --strict-mcp-config
//                    --allowedTools mcp__isoplan__ask_expert,mcp__isoplan__leave_draft[,WebSearch][,WebFetch]
//                    --permission-mode dontAsk --autocompact 1000000
//
// - Nothing that leaves the company is ever a tool: only the JOB_TOOLS its job lists, and Isoplan's
//   own two, which the runner serves itself (employee-tools.ts). `--strict-mcp-config` loads no MCP
//   server of the person's, and `--setting-sources ""` and NO_HOOKS no plugin, skill or hook. The
//   same list a run is given as `--disallowedTools` is what `converse` ends it on, so a job that
//   lists WebSearch gets it in `--tools`, and a tool of that list offered or used ends it.
// - Every trunk turn and every fork has the same definition: the same tools, the same model, the
//   same folder, and an MCP server whose answers are the same bytes for the same job; only the
//   config's address and token differ, which never reach the Messages API. So a run reads its trunk
//   from the prompt cache while that is warm.
// - MCP_TOOL_TIMEOUT is set above the longest an `ask_expert` waits, so Claude Code never gives up
//   on a blocking question first.

import { JOB_TOOLS, type Job } from "@isoplan/protocol";
import { NO_HOOKS } from "./claude.js";
import { DISALLOWED_TOOLS } from "./expert-claude.js";

/** The MCP server's name, so its tools read as a session's do. */
export const ISOPLAN_MCP_SERVER = "isoplan";
export const ASK_EXPERT_TOOL = "mcp__isoplan__ask_expert";
export const LEAVE_DRAFT_TOOL = "mcp__isoplan__leave_draft";
/** What a turn or run whose init event lacks Isoplan's tools fails with. */
export const TOOLS_DIDNT_CONNECT = "Isoplan's tools didn't connect";

/** The tools that end an employee's process when offered or used: every one an expert may not use and every job tool, but the job's own. */
export function employeeDisallowed(job: Pick<Job, "tools">): string[] {
  return [...new Set([...DISALLOWED_TOOLS, ...JOB_TOOLS])].filter((t) => !(job.tools as string[]).includes(t));
}

const STREAM = ["--input-format", "stream-json", "--output-format", "stream-json", "--verbose"];

function employeeTools(job: Pick<Job, "tools">, mcpConfig: string): string[] {
  const tools = JOB_TOOLS.filter((t) => job.tools.includes(t));
  const allowed = [ASK_EXPERT_TOOL, LEAVE_DRAFT_TOOL, ...tools.filter((t) => t === "WebSearch" || t === "WebFetch")];
  return ["--tools", tools.join(","), "--disallowedTools", employeeDisallowed(job).join(","), "--setting-sources", "", ...NO_HOOKS, "--mcp-config", mcpConfig, "--strict-mcp-config", "--allowedTools", allowed.join(","), "--permission-mode", "dontAsk", "--autocompact", "1000000"];
}

/** A new trunk's grounding, saved under `trunk`. */
export const employeeTrunkArgs = (trunk: string, model: string, job: Pick<Job, "tools">, mcpConfig: string) => ["-p", "--session-id", trunk, "--model", model, ...employeeTools(job, mcpConfig), ...STREAM];
/** One turn added to its trunk: what it learned. */
export const employeeAppendArgs = (trunk: string, model: string, job: Pick<Job, "tools">, mcpConfig: string) => ["-p", "--resume", trunk, "--model", model, ...employeeTools(job, mcpConfig), ...STREAM];
/** A fork of its trunk up to `at` for one run, or for learning from corrections, never saved. */
export const employeeForkArgs = (trunk: string, model: string, at: string | null, job: Pick<Job, "tools">, mcpConfig: string) => ["-p", "--resume", trunk, "--fork-session", "--no-session-persistence", ...(at ? ["--resume-session-at", at] : []), "--model", model, ...employeeTools(job, mcpConfig), ...STREAM];

/** One process's MCP config: the runner's address for it and its token, nothing else. */
export const mcpConfigText = (url: string, token: string) => JSON.stringify({ mcpServers: { [ISOPLAN_MCP_SERVER]: { type: "http", url, headers: { Authorization: `Bearer ${token}` } } } }, null, 2) + "\n";

/** MCP_TOOL_TIMEOUT for a process whose ask_expert waits up to `minutes`: a minute more, in ms. */
export const mcpToolTimeout = (minutes: number) => String((minutes + 1) * 60000);
