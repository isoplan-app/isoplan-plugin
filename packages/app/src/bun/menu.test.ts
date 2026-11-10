import { expect, test } from "vitest";
import type { RunnerStatus } from "../../../mod/src/runner/status.js";
import { closing, currentStatus, pairingView, sessionItems, trayMenu, type MenuInput } from "./menu.ts";

const NOW = Date.parse("2026-11-08T12:00:00Z");
const status: RunnerStatus = {
  pid: 1,
  offices: [
    { server: "wss://lorveil.example/data-layer", label: "Lorveil", open: true, since: NOW - 5000, email: "ada@example.com" },
    { server: "wss://internal.example/data-layer", label: "internal", open: true, since: NOW - 5000 },
    { server: "wss://demo.example/data-layer", label: "Demo", open: false, since: NOW - 10_000 },
    { server: "wss://old.example/data-layer", label: "Old", open: false, since: NOW - 120_000 },
    { server: "wss://new.example/data-layer", label: "New", open: false, since: NOW - 120_000 },
  ],
  pairs: [{ server: "wss://new.example/data-layer", url: "https://new.example/pair/abc", expires: "2026-11-08T12:10:00Z" }],
  sessions: [
    { name: "app", headless: true, close: "claude-code:u1", folder: "C:/w/app", id: "u1" },
    { name: "site", headless: false, folder: "C:/w/site", id: "u2" },
  ],
};
const input = (over: Partial<MenuInput> = {}): MenuInput => ({ engine: "running", status, now: NOW, unreachableMs: 60_000, ...over });

test("menu: says Isoplan is running, each office's link, and the actions", () => {
  expect(trayMenu(input())).toEqual([
    { type: "normal", label: "Isoplan is running", enabled: false },
    { type: "divider" },
    {
      type: "normal",
      label: "Offices",
      submenu: [
        { type: "normal", label: "Lorveil: connected as ada@example.com", enabled: false },
        { type: "normal", label: "internal: connected (account not known yet: the office needs updating)", enabled: false },
        { type: "normal", label: "Demo: reconnecting…", enabled: false },
        { type: "normal", label: "Old: can't be reached", enabled: false },
        { type: "normal", label: "New: waiting to be paired", enabled: false },
      ],
    },
    {
      type: "normal",
      label: "Sessions",
      submenu: [
        {
          type: "normal",
          label: "app (headless)",
          submenu: [
            { type: "normal", label: "Close session", action: "close:claude-code:u1" },
            { type: "normal", label: "End and remove", action: "remove:claude-code:u1" },
          ],
        },
        { type: "normal", label: "site (in a terminal or the Claude app)", enabled: false },
      ],
    },
    { type: "normal", label: "Pair this computer… (1 waiting)", action: "pairing" },
    { type: "normal", label: "Show what's running…", action: "running" },
    { type: "divider" },
    { type: "normal", label: "Quit Isoplan", action: "quit" },
  ]);
});

test("menu: starting, it tells no office's state and offers Open pairing…; with no office yet it says so", () => {
  const starting = trayMenu(input({ engine: "starting", status: null }));
  expect(starting[0]).toEqual({ type: "normal", label: "Isoplan is starting", enabled: false });
  expect(starting[2]).toEqual({ type: "normal", label: "Offices", submenu: [{ type: "normal", label: "Not running", enabled: false }] });
  expect(starting[4]).toEqual({ type: "normal", label: "Open pairing…", action: "pairing" });
  expect(trayMenu(input({ status: { pid: 1, offices: [], pairs: [] } }))[2]).toMatchObject({ submenu: [{ label: "No office yet" }] });
});

test("menu: a worker that has gone (crashed, or replaced on new code) isn't believed; the offices show as starting until the new one says", () => {
  expect(currentStatus(status, (pid) => pid === 1)).toBe(status);
  expect(currentStatus(status, () => false)).toBeNull();
  expect(trayMenu(input({ status: currentStatus(status, () => false) }))[2]).toEqual({ type: "normal", label: "Offices", submenu: [{ type: "normal", label: "Starting…", enabled: false }] });
  expect(pairingView(input({ status: null }), 2000)).toEqual({ refreshMs: 2000, running: true, waiting: [], connected: [] });
});

test("menu: the pairing window lists the links that haven't expired, named by office", () => {
  expect(pairingView(input(), 2000)).toEqual({ refreshMs: 2000, running: true, waiting: [{ office: "New", url: "https://new.example/pair/abc", expires: "2026-11-08T12:10:00Z" }], connected: ["Lorveil", "internal"] });
  expect(pairingView(input({ now: Date.parse("2026-11-08T12:10:00Z") }), 2000).waiting).toEqual([]);
  // The window asks again at the pace trayRefreshSeconds sets.
  expect(pairingView(input({ engine: "stopped" }), 5000)).toEqual({ refreshMs: 5000, running: false, waiting: [], connected: [] });
});

test("menu: sessions: only a headless one can be closed, a driven one closed or ended and removed, and only an action on a session the status still lists is acted on; stopped, starting, none and an older worker each say so", () => {
  expect(sessionItems(input({ engine: "stopped" }))).toEqual([{ type: "normal", label: "Not running", enabled: false }]);
  expect(sessionItems(input({ status: null }))).toEqual([{ type: "normal", label: "Starting…", enabled: false }]);
  expect(sessionItems(input({ status: { ...status, sessions: [] } }))).toEqual([{ type: "normal", label: "No session on this computer", enabled: false }]);
  const { sessions: _, ...older } = status;
  expect(sessionItems(input({ status: older }))).toEqual([{ type: "normal", label: "Not listed: Isoplan's runner needs updating", enabled: false }]);
  expect(closing("close:claude-code:u1", status)).toEqual({ close: "claude-code:u1", remove: false });
  expect(closing("remove:claude-code:u1", status)).toEqual({ close: "claude-code:u1", remove: true });
  // One gone since the menu was drawn, or one in a terminal, isn't closed.
  expect(closing("close:claude-code:gone", status)).toBeNull();
  expect(closing("remove:claude-code:gone", status)).toBeNull();
  expect(closing("close:", { ...status, sessions: [{ name: "site", headless: false, folder: "C:/w/site", id: "u2" }] })).toBeNull();
  expect(closing("quit", status)).toBeNull();
  // A fork or a take's first turn is only closed, never removed.
  expect(closing("remove:pid:12", { ...status, sessions: [{ name: "api", headless: true, close: "pid:12", fork: true, folder: "C:/w/api", id: "u3" }] })).toBeNull();
  // A fork is told apart from its lead, and a claude --bg session the runner started is headless with no Close.
  const forked = [
    { name: "api", headless: true, close: "pid:12", fork: true, folder: "C:/w/api", id: "u3" },
    { name: "api", headless: false, folder: "C:/w/api", id: "u3" },
    { name: "bg", headless: true, folder: "C:/w/bg", id: "u4" },
  ];
  expect(sessionItems(input({ status: { ...status, sessions: forked } }))).toEqual([
    { type: "normal", label: "api (headless, a fork)", submenu: [{ type: "normal", label: "Close", action: "close:pid:12" }] },
    { type: "normal", label: "api (in a terminal or the Claude app)", enabled: false },
    { type: "normal", label: "bg (headless)", enabled: false },
  ]);
});
