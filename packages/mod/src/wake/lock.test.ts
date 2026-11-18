import fs from "node:fs";
import path from "node:path";
import { expect, test } from "vitest";
import { tempRoot } from "../data-layer/fixture.js";
import { HOLD_OFF_MS, holdOff, lockPath, takeLock } from "./lock.js";

const OTHER = 4242; // a pid that isn't this process

function setup() {
  const claudeDir = path.join(tempRoot(), ".claude");
  return { lock: lockPath(claudeDir, "s-1") };
}

test("lock: a hold-off counts as held until it ends, except for a taker that forces it", async () => {
  const s = setup();
  await takeLock(s.lock, OTHER);
  await holdOff(s.lock, OTHER, Date.now() + HOLD_OFF_MS);
  expect(await takeLock(s.lock, OTHER + 1, () => false)).toBe(false);
  expect(await takeLock(s.lock, OTHER + 1, () => false, false, Date.now() + HOLD_OFF_MS + 1)).toBe(true);
  await holdOff(s.lock, OTHER + 1, Date.now() + HOLD_OFF_MS);
  expect(await takeLock(s.lock, OTHER + 2, () => false, true)).toBe(true);
  expect(JSON.parse(fs.readFileSync(s.lock, "utf8"))).toEqual({ pid: OTHER + 2 });
});

test("lock: a second data layer is refused while the first lives; a stale lock is taken over", async () => {
  const s = setup();
  expect(await takeLock(s.lock, OTHER)).toBe(true);
  expect(await takeLock(s.lock, OTHER + 1, () => true)).toBe(false);
  // The plugin's data layer takes it from the runner regardless.
  expect(await takeLock(s.lock, OTHER + 2, () => true, true)).toBe(true);
  expect(await takeLock(s.lock, OTHER + 1, () => false)).toBe(true);
  expect(JSON.parse(fs.readFileSync(s.lock, "utf8"))).toEqual({ pid: OTHER + 1 });
});

test("lock: a takeover in progress beside a stale lock makes another taker lose, and one a crashed taker left is cleared once old", async () => {
  const s = setup();
  fs.mkdirSync(path.dirname(s.lock), { recursive: true });
  fs.writeFileSync(s.lock, JSON.stringify({ pid: OTHER }));
  fs.writeFileSync(`${s.lock}.take`, "1");
  expect(await takeLock(s.lock, OTHER + 1, () => false)).toBe(false);
  expect(JSON.parse(fs.readFileSync(s.lock, "utf8"))).toEqual({ pid: OTHER });
  const old = new Date(Date.now() - 60000);
  fs.utimesSync(`${s.lock}.take`, old, old);
  expect(await takeLock(s.lock, OTHER + 1, () => false)).toBe(true);
  expect(JSON.parse(fs.readFileSync(s.lock, "utf8"))).toEqual({ pid: OTHER + 1 });
  expect(fs.readdirSync(path.dirname(s.lock))).toEqual(["s-1.json"]);
});
