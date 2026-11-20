import fs from "node:fs";
import path from "node:path";
import { expect, test } from "vitest";
import { loadConfig, loadSettings, officeNamed, officesOf } from "./config.js";
import { nodeIo } from "./io.js";
import { defaults, modDir, tempRoot } from "./fixture.js";

const defaultsPath = path.join(modDir, "config.json");

async function withUser(user: string | object) {
  const p = path.join(tempRoot(), "isoplan", "config.json");
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, typeof user === "string" ? user : JSON.stringify(user));
  return loadConfig(nodeIo(), defaultsPath, p);
}

test("config: the mod's defaults when the person has no file", async () => {
  expect(await loadConfig(nodeIo(), defaultsPath, path.join(tempRoot(), "missing.json"))).toEqual(defaults);
  expect(defaults.server).toBe("ws://127.0.0.1:4747/data-layer");
});

test("config: a missing, null or wrong-typed user value falls back to the default", async () => {
  const config = await withUser('{"activeMinutes": null, "idleMinutes": "30", "quietSeconds": -1, "tailBytes": 1e999, "touchedTools": "Edit", "touchedWindowMinutes": 45}');
  expect(config).toEqual({ ...defaults, touchedWindowMinutes: 45 });
  expect(await withUser("{ broken")).toEqual(defaults);
});

test("config: the server is the person's when it is wss://, or ws:// to this machine only", async () => {
  expect((await withUser({ server: "wss://office.example.com/data-layer" })).server).toBe("wss://office.example.com/data-layer");
  for (const local of ["ws://localhost:4747/data-layer", "ws://[::1]:4747/data-layer", "ws://127.0.0.1:9000/x"]) {
    expect((await withUser({ server: local })).server).toBe(local);
  }
  expect((await withUser({ server: "ws://office.example.com/data-layer" })).server).toBe(defaults.server);
  expect((await withUser({ server: "ws://10.0.0.5:4747/data-layer" })).server).toBe(defaults.server);
  expect((await withUser({ server: "http://office.example.com" })).server).toBe(defaults.server);
  expect((await withUser({ server: "not a url" })).server).toBe(defaults.server);
});

test("config: a byte count must be a whole number; a fractional tailBytes falls back to the default", async () => {
  expect((await withUser({ tailBytes: 1000.5 })).tailBytes).toBe(defaults.tailBytes);
  expect((await withUser({ tailBytes: 2048 })).tailBytes).toBe(2048);
});

test("config: streamSeconds below its floor falls back to the default", async () => {
  expect((await withUser({ streamSeconds: 0.01 })).streamSeconds).toBe(defaults.streamSeconds);
  expect((await withUser({ streamSeconds: 0.25 })).streamSeconds).toBe(0.25);
});

test("config: a person's own lightsOffHours 0 turns lights-off rooms off", async () => {
  expect((await withUser({ lightsOffHours: 0 })).lightsOffHours).toBe(0);
});

test("config: the offices are the entries of servers with a ws:// or wss:// address, labelled, once each; without one, server alone, labelled by its host (#105)", async () => {
  const single = await withUser({ server: "wss://office.example.com/data-layer" });
  // The server a version before #105 reports to is marked, so its pairing lock and releases stay put.
  expect(officesOf(single)).toEqual([{ label: "office.example.com", server: "wss://office.example.com/data-layer", legacy: true }]);
  expect(officesOf(defaults)).toEqual([{ label: "127.0.0.1:4747", server: "ws://127.0.0.1:4747/data-layer", legacy: true }]);

  const both = await withUser({
    servers: [
      { label: " internal ", server: "wss://isoplan-internal.example/data-layer" },
      { label: "dev", server: "ws://127.0.0.1:4747/data-layer" },
      { label: "again", server: "ws://127.0.0.1:4747/data-layer" },
      { label: "plain", server: "ws://10.0.0.5:4747/data-layer" },
      { label: "web", server: "https://office.example.com" },
      { server: "wss://other.example:8443/data-layer" },
      { label: "Internal", server: "wss://second.example/data-layer" },
      "not an entry",
    ],
  });
  expect(officesOf(both)).toEqual([
    { label: "internal", server: "wss://isoplan-internal.example/data-layer" },
    { label: "dev", server: "ws://127.0.0.1:4747/data-layer", legacy: true },
    { label: "plain", server: "ws://10.0.0.5:4747/data-layer", plainRefused: true },
    { label: "other.example:8443", server: "wss://other.example:8443/data-layer" },
    // A label already taken, in any case, is made unique.
    { label: "Internal-2", server: "wss://second.example/data-layer" },
  ]);
  expect(officesOf({ ...both, allowPlainWs: true })[2]).toEqual({ label: "plain", server: "ws://10.0.0.5:4747/data-layer" });
  // A plain ws:// server to another machine, alone, is kept to say why it isn't used.
  expect(officesOf(await withUser({ server: "ws://10.0.0.5:4747/data-layer" }))).toEqual([{ label: "10.0.0.5:4747", server: "ws://10.0.0.5:4747/data-layer", plainRefused: true }]);
  expect(officesOf(await withUser({ servers: [{ server: "nope" }] }))).toEqual(officesOf(defaults));
});

test("config: --office names an office by its label in any case, its address or its host (#105)", async () => {
  const offices = officesOf(await withUser({ servers: [{ label: "internal", server: "wss://isoplan-internal.example/data-layer" }, { label: "dev", server: "ws://127.0.0.1:4747/data-layer" }] }));
  expect(officeNamed(offices, "DEV")?.label).toBe("dev");
  expect(officeNamed(offices, "wss://isoplan-internal.example/data-layer")?.label).toBe("internal");
  expect(officeNamed(offices, "isoplan-internal.example")?.label).toBe("internal");
  expect(officeNamed(offices, "127.0.0.1:4747")?.label).toBe("dev");
  expect(officeNamed(offices, "elsewhere")).toBeUndefined();
});

test("settings: a block is overridden key by key, each key that doesn't fit keeping the mod's default", async () => {
  const root = tempRoot();
  const mod = path.join(root, "runner.json");
  const user = path.join(root, "user.json");
  fs.writeFileSync(mod, JSON.stringify({ maxForks: 2, expertCreationSuggestions: { tokens: 30000, minutes: 10, draftModel: "haiku" } }));
  fs.writeFileSync(user, JSON.stringify({ expertCreationSuggestions: { tokens: 50000, minutes: -1, extra: true } }));
  expect(await loadSettings(nodeIo(), mod, user)).toEqual({ maxForks: 2, expertCreationSuggestions: { tokens: 50000, minutes: 10, draftModel: "haiku" } });
  fs.writeFileSync(user, JSON.stringify({ expertCreationSuggestions: "off" }));
  expect(await loadSettings(nodeIo(), mod, user)).toEqual({ maxForks: 2, expertCreationSuggestions: { tokens: 30000, minutes: 10, draftModel: "haiku" } });
});
