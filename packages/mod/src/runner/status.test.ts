import path from "node:path";
import { expect, test } from "vitest";
import { tempRoot } from "../data-layer/fixture.js";
import { closeProcess, createStatus, linkState, readStatus, sessionsSeen, type OfficeSeen } from "./status.js";

const A = "wss://a.example/data-layer";
const B = "wss://b.example/data-layer";

test("status: the worker writes each office's link as it opens, closes and is stopped, and the links waiting to pair the machine", async () => {
  const file = path.join(tempRoot(), "runner", "status.json");
  let clock = 1000;
  const status = createStatus({ file, offices: [{ server: A, label: "a" }, { server: B, label: "b" }], pid: 7, now: () => clock });
  await status.written();
  expect(await readStatus(file)).toEqual({ pid: 7, offices: [{ server: A, label: "a", open: false, since: 1000 }, { server: B, label: "b", open: false, since: 1000 }], pairs: [], sessions: [] });

  status.pair({ type: "pair", server: B, label: "b", url: "https://b.example/pair/1", expires: "2030-01-01T00:00:00Z" });
  clock = 2000;
  status.opened(A);
  await status.written();
  let seen = await readStatus(file);
  expect(seen?.offices[0]).toEqual({ server: A, label: "a", open: true, since: 2000 });
  expect(seen?.pairs).toEqual([{ server: B, label: "b", url: "https://b.example/pair/1", expires: "2030-01-01T00:00:00Z" }]);

  // Paired and open, B's link to pair is gone; A drops, and B's office stops it.
  clock = 3000;
  status.opened(B);
  status.closed(A);
  status.stopped(B, "not-wanted");
  await status.written();
  seen = await readStatus(file);
  expect(seen?.pairs).toEqual([]);
  expect(seen?.offices).toEqual([
    { server: A, label: "a", open: false, since: 3000 },
    { server: B, label: "b", open: true, since: 3000, stopped: "not-wanted" },
  ]);
  // Opened again, what stopped it no longer holds.
  status.opening(B);
  await status.written();
  expect((await readStatus(file))?.offices[1]?.stopped).toBeUndefined();
});

test("status: a link down is reconnecting, then unreachable; one waiting to be paired says so; one the office stopped isn't answering", () => {
  const down: OfficeSeen = { server: A, label: "a", open: false, since: 0 };
  const pair = [{ server: A, url: "https://a.example/pair", expires: new Date(100_000).toISOString() }];
  expect(linkState({ ...down, open: true }, [], 10, 60_000)).toBe("connected");
  expect(linkState(down, [], 59_999, 60_000)).toBe("reconnecting");
  expect(linkState(down, [], 60_000, 60_000)).toBe("unreachable");
  expect(linkState(down, pair, 70_000, 60_000)).toBe("pairing");
  // An expired link to pair no longer counts.
  expect(linkState(down, pair, 100_000, 60_000)).toBe("unreachable");
  expect(linkState({ ...down, stopped: "unpaired" }, [], 10, 60_000)).toBe("not-answering");
});

test("status: each office's entry names the email of its pairing's person once known, and the sessions go in as they change", async () => {
  const file = path.join(tempRoot(), "runner", "status.json");
  const status = createStatus({ file, offices: [{ server: A, label: "a" }, { server: B, label: "b" }], pid: 7, now: () => 1000 });
  status.email(A, "ada@example.com");
  status.email(B, undefined);
  status.sessions([{ name: "app", headless: true, close: "claude-code:1" }]);
  await status.written();
  const seen = await readStatus(file);
  expect(seen?.offices.map((o) => o.email)).toEqual(["ada@example.com", undefined]);
  expect(seen?.sessions).toEqual([{ name: "app", headless: true, close: "claude-code:1" }]);
  status.email(A, undefined);
  await status.written();
  expect((await readStatus(file))?.offices[0]).not.toHaveProperty("email");
});

test("status: a driven session or a take's first turn is headless and closed by its session or process; a fork is listed on its own, as a fork; a claude --bg session is headless with no close; a session in a terminal has no close", () => {
  const reported = [
    { session: "u-driven", cwd: "C:/w/app" },
    { session: "u-terminal", cwd: "C:/w/site" },
    { session: "u-lead", cwd: "C:/w/api" },
    { session: "u-bg", cwd: "C:/w/bg" },
  ];
  const records = [
    { kind: "driven" as const, pid: 11, session: "claude-code:u-driven", folder: "C:/w/app", driven: { name: "Fix login" } },
    // Its process ended: not listed unless reported.
    { kind: "driven" as const, pid: null, session: "claude-code:u-idle", folder: "C:/w/old" },
    // A fork shares its lead's id, so the lead (in a terminal) isn't taken for headless.
    { kind: "fork" as const, pid: 12, session: "claude-code:u-lead", folder: "C:/w/api" },
    { kind: "desktop-read" as const, pid: 13, session: "claude-code:u-take", folder: "C:/w/take" },
    // A fork of a driven lead goes by the lead's name, so it is listed beside it.
    { kind: "fork" as const, pid: 14, session: "claude-code:u-driven", folder: "C:/w/app" },
  ];
  expect(sessionsSeen(reported, records, new Set(["u-bg"]))).toEqual([
    { name: "api", headless: true, close: "pid:12", fork: true },
    { name: "api", headless: false },
    { name: "bg", headless: true },
    { name: "Fix login", headless: true, close: "claude-code:u-driven" },
    { name: "Fix login", headless: true, close: "pid:14", fork: true },
    { name: "site", headless: false },
    { name: "take", headless: true, close: "pid:13" },
  ]);
});

test("status: a session goes by its driven name, else the title its report gave the offices, else its folder's name, so two sessions in one folder don't look the same", () => {
  const reported = [
    { session: "u-a", cwd: "C:/w/app" },
    { session: "u-b", cwd: "C:/w/app" },
    { session: "u-driven", cwd: "C:/w/app" },
    { session: "u-new", cwd: "C:/w/app" },
  ];
  const records = [
    { kind: "driven" as const, pid: 11, session: "claude-code:u-driven", folder: "C:/w/app", driven: { name: "Fix login" } },
    // Not named yet: its report's title until it is.
    { kind: "driven" as const, pid: 12, session: "claude-code:u-b", folder: "C:/w/app" },
  ];
  const titles = new Map([
    ["u-a", "Tidy the docs"],
    ["u-b", "main"],
    ["u-driven", "Something else"],
  ]);
  expect(sessionsSeen(reported, records, new Set(), titles)).toEqual([
    { name: "app", headless: false },
    { name: "Fix login", headless: true, close: "claude-code:u-driven" },
    { name: "main", headless: true, close: "claude-code:u-b" },
    { name: "Tidy the docs", headless: false },
  ]);
});

test("status: a Close by process ends a take's first turn and marks it closed from the menu; one still running is unmarked, so its later failure says its own reason", async () => {
  const records = [
    { kind: "desktop-read" as const, pid: 7, session: "claude-code:u7", folder: "/r" },
    { kind: "driven" as const, pid: 8, session: "claude-code:u8", folder: "/r" },
  ];
  const closing = new Set<string>();
  const running = new Set([7, 8]);
  const killed: number[] = [];
  const ends = { kill: (pid: number) => (killed.push(pid), running.delete(pid)), alive: (pid: number) => running.has(pid), waitMs: 300, closing };
  expect(await closeProcess("pid:7", records, ends)).toBe(records[0]);
  expect([...closing]).toEqual(["u7"]);
  // A driven session is closed by its session, never by its process here.
  expect(await closeProcess("pid:8", records, ends)).toBeNull();
  expect(killed).toEqual([7]);

  closing.clear();
  running.add(7);
  expect(await closeProcess("pid:7", records, { ...ends, kill: () => {} })).toBeNull();
  expect(closing.size).toBe(0);
});
