import path from "node:path";
import { expect, test } from "vitest";
import { tempRoot } from "../data-layer/fixture.js";
import { createStatus, linkState, readStatus, sessionsSeen, type OfficeSeen } from "./status.js";

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

test("status: a driven session or a take's first turn is headless and closed by its session or process; a fork is listed on its own; a session in a terminal has no close", () => {
  const reported = [
    { session: "u-driven", cwd: "C:/w/app" },
    { session: "u-terminal", cwd: "C:/w/site" },
    { session: "u-lead", cwd: "C:/w/api" },
  ];
  const records = [
    { kind: "driven" as const, pid: 11, session: "claude-code:u-driven", folder: "C:/w/app", driven: { name: "Fix login" } },
    // Its process ended: not listed unless reported.
    { kind: "driven" as const, pid: null, session: "claude-code:u-idle", folder: "C:/w/old" },
    // A fork shares its lead's id, so the lead (in a terminal) isn't taken for headless.
    { kind: "fork" as const, pid: 12, session: "claude-code:u-lead", folder: "C:/w/api" },
    { kind: "desktop-read" as const, pid: 13, session: "claude-code:u-take", folder: "C:/w/take" },
  ];
  expect(sessionsSeen(reported, records)).toEqual([
    { name: "api", headless: true, close: "pid:12" },
    { name: "api", headless: false },
    { name: "Fix login", headless: true, close: "claude-code:u-driven" },
    { name: "site", headless: false },
    { name: "take", headless: true, close: "pid:13" },
  ]);
});
