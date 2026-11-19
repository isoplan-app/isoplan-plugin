import type { Facts } from "@isoplan/protocol";
import { expect, test } from "vitest";
import { forOffice } from "./attribution.js";

const at = "2026-10-20T09:00:00.000Z";
const web = { id: "github.com/team/web", name: "web" };
const secret = { id: "github.com/me/notes", name: "notes" };
const facts: Facts = {
  session: { id: "s", source: "claude-code", lead: "s:lead", title: "x", titleFrom: "source", branch: null, lastActive: at, status: "active", lights: "on" },
  agents: [
    { id: "s:lead", source: "claude-code", session: "s", startedBy: null, agentType: null, task: null, status: "working", statusSince: at, lastActive: at, doing: { kind: "write", file: "n.md", since: at, project: secret, away: true }, usage: null },
    { id: "w", source: "claude-code", session: "s", startedBy: "s:lead", agentType: "worker", task: null, status: "working", statusSince: at, lastActive: at, doing: { kind: "run", since: at, project: web, away: true }, usage: null },
  ],
  edits: [
    { agent: "w", file: "README.md", at },
    { agent: "w", file: "README.md", at, project: web, away: true },
    { agent: "s:lead", file: "n.md", at, project: secret, away: true },
  ],
  reads: [{ agent: "w", file: "x.md", at, project: secret }],
  waits: [],
  reports: [],
};

test("forOffice: another repo's files and commands leave only for a project the office holds, and none before a welcome", () => {
  const kept = forOffice(facts, new Set(["github.com/team/web"]));
  expect(kept.edits).toEqual([facts.edits[0], facts.edits[1]]);
  expect(kept.reads).toEqual([]);
  expect(kept.agents.map((a) => a.doing)).toEqual([{ kind: "write", since: at }, facts.agents[1]!.doing]);
  const before = forOffice(facts, null);
  expect(before.edits).toEqual([facts.edits[0]]);
  expect(before.agents.map((a) => a.doing)).toEqual([{ kind: "write", since: at }, { kind: "run", since: at }]);
});

test("forOffice: a subagent's checkout in another repo goes only where that repo's files may", () => {
  const withCheckout: Facts = { ...facts, agents: facts.agents.map((a) => (a.id === "w" ? { ...a, checkout: "C:/w/web-wt", branch: "feat/x" } : a)) };
  const checkouts = { w: "github.com/team/web" };
  expect(forOffice(withCheckout, new Set(["github.com/team/web"]), checkouts).agents[1]).toMatchObject({ checkout: "C:/w/web-wt", branch: "feat/x" });
  const hidden = forOffice(withCheckout, null, checkouts).agents[1]!;
  expect(["checkout" in hidden, "branch" in hidden]).toEqual([false, false]);
  // The session's own worktrees aren't named, and go as before.
  expect(forOffice(withCheckout, null, {}).agents[1]).toMatchObject({ checkout: "C:/w/web-wt" });
});

test("forOffice: another repo's areas leave only for a project the office holds, the session's own always", () => {
  const own = { folder: "src", reads: 1, searches: 0, tokens: 10, ms: 5, corrections: 0 };
  const away = { ...own, folder: "docs", project: secret, away: true as const };
  const withAreas: Facts = { ...facts, areas: [own, away] };
  expect(forOffice(withAreas, new Set(["github.com/me/notes"])).areas).toEqual([own, away]);
  expect(forOffice(withAreas, new Set(["github.com/team/web"])).areas).toEqual([own]);
  expect(forOffice(withAreas, null).areas).toEqual([own]);
  expect("areas" in forOffice(facts, null)).toBe(false);
});
