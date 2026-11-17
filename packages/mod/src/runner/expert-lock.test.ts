import { expect, test } from "vitest";
import { createCheckoutLock, createGate } from "./expert-lock.js";

/** A hold that lasts until `release` is called, and records when it ran. */
function hold(log: string[], name: string) {
  let release = () => {};
  const held = new Promise<void>((r) => (release = r));
  return {
    run: async () => {
      log.push(`${name} in`);
      await held;
      log.push(`${name} out`);
    },
    release,
  };
}
const tick = () => new Promise((r) => setTimeout(r, 0));

test("lock: shared holds run together; an exclusive one waits for them all, and new shared holds wait behind it", async () => {
  const lock = createCheckoutLock();
  const log: string[] = [];
  const [a, b, move, c] = [hold(log, "a"), hold(log, "b"), hold(log, "move"), hold(log, "c")];
  const done = [lock.shared(a.run), lock.shared(b.run), lock.exclusive(move.run), lock.shared(c.run)];
  await tick();
  expect(log).toEqual(["a in", "b in"]);
  a.release();
  await tick();
  expect(log).toEqual(["a in", "b in", "a out"]);
  b.release();
  await tick();
  expect(log).toEqual(["a in", "b in", "a out", "b out", "move in"]);
  move.release();
  await tick();
  expect(log.slice(4)).toEqual(["move in", "move out", "c in"]);
  c.release();
  await Promise.all(done);
});

test("lock: shared holds waiting when an exclusive one lets go go before the next exclusive one; a hold that throws lets go", async () => {
  const lock = createCheckoutLock();
  const log: string[] = [];
  const [first, r1, second] = [hold(log, "first"), hold(log, "r1"), hold(log, "second")];
  const done = [lock.exclusive(first.run), lock.shared(r1.run), lock.exclusive(second.run)];
  await tick();
  first.release();
  await tick();
  expect(log).toEqual(["first in", "first out", "r1 in"]);
  r1.release();
  await tick();
  second.release();
  await Promise.all(done);
  await expect(lock.exclusive(async () => Promise.reject(new Error("git failed")))).rejects.toThrow("git failed");
  expect(await lock.shared(async () => "free")).toBe("free");
});

test("gate: a fork waits while an append runs, and goes once it ends", async () => {
  const gate = createGate();
  await gate.opened();
  const log: string[] = [];
  const append = hold(log, "append");
  const appended = gate.closed(append.run);
  const fork = gate.opened().then(() => log.push("fork"));
  await tick();
  expect(log).toEqual(["append in"]);
  append.release();
  await Promise.all([appended, fork]);
  expect(log).toEqual(["append in", "append out", "fork"]);
});
