import path from "node:path";
import { expect, test } from "vitest";
import { tempRoot } from "../data-layer/fixture.js";
import { createStatus, linkState, readStatus, type OfficeSeen } from "./status.js";

const A = "wss://a.example/data-layer";
const B = "wss://b.example/data-layer";

test("status: the worker writes each office's link as it opens, closes and is stopped, and the links waiting to pair the machine", async () => {
  const file = path.join(tempRoot(), "runner", "status.json");
  let clock = 1000;
  const status = createStatus({ file, offices: [{ server: A, label: "a" }, { server: B, label: "b" }], pid: 7, now: () => clock });
  await status.written();
  expect(await readStatus(file)).toEqual({ pid: 7, offices: [{ server: A, label: "a", open: false, since: 1000 }, { server: B, label: "b", open: false, since: 1000 }], pairs: [] });

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
