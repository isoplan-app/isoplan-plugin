import { expect, test } from "vitest";
import type { RunnerStatus } from "../../../mod/src/runner/status.js";
import { pairingView, trayMenu, type MenuInput } from "./menu.ts";

const NOW = Date.parse("2026-11-08T12:00:00Z");
const status: RunnerStatus = {
  pid: 1,
  offices: [
    { server: "wss://lorveil.example/data-layer", label: "Lorveil", open: true, since: NOW - 5000 },
    { server: "wss://demo.example/data-layer", label: "Demo", open: false, since: NOW - 10_000 },
    { server: "wss://old.example/data-layer", label: "Old", open: false, since: NOW - 120_000 },
    { server: "wss://new.example/data-layer", label: "New", open: false, since: NOW - 120_000 },
  ],
  pairs: [{ server: "wss://new.example/data-layer", url: "https://new.example/pair/abc", expires: "2026-11-08T12:10:00Z" }],
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
        { type: "normal", label: "Lorveil: connected", enabled: false },
        { type: "normal", label: "Demo: reconnecting…", enabled: false },
        { type: "normal", label: "Old: can't be reached", enabled: false },
        { type: "normal", label: "New: waiting to be paired", enabled: false },
      ],
    },
    { type: "normal", label: "Pause", action: "pause", enabled: true },
    { type: "normal", label: "Pair this computer… (1 waiting)", action: "pairing" },
    { type: "divider" },
    { type: "normal", label: "Quit Isoplan", action: "quit" },
  ]);
});

test("menu: paused, it offers resume and tells no office's state; starting, nothing can be paused yet", () => {
  const paused = trayMenu(input({ engine: "paused" }));
  expect(paused[0]).toEqual({ type: "normal", label: "Isoplan is paused", enabled: false });
  expect(paused[2]).toEqual({ type: "normal", label: "Offices", submenu: [{ type: "normal", label: "Paused: no office is told anything", enabled: false }] });
  expect(paused[3]).toEqual({ type: "normal", label: "Resume", action: "resume" });
  expect(paused[4]).toEqual({ type: "normal", label: "Open pairing…", action: "pairing" });
  expect(trayMenu(input({ engine: "starting", status: null }))[3]).toEqual({ type: "normal", label: "Pause", action: "pause", enabled: false });
  expect(trayMenu(input({ status: { pid: 1, offices: [], pairs: [] } }))[2]).toMatchObject({ submenu: [{ label: "No office yet" }] });
});

test("menu: the pairing window lists the links that haven't expired, named by office", () => {
  expect(pairingView(input())).toEqual({ running: true, waiting: [{ office: "New", url: "https://new.example/pair/abc", expires: "2026-11-08T12:10:00Z" }], connected: ["Lorveil"] });
  expect(pairingView(input({ now: Date.parse("2026-11-08T12:10:00Z") })).waiting).toEqual([]);
  expect(pairingView(input({ engine: "paused" }))).toEqual({ running: false, waiting: [], connected: [] });
});
