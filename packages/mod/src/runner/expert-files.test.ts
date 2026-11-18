import fs from "node:fs";
import path from "node:path";
import { afterEach, expect, test } from "vitest";
import { tempRoot } from "../data-layer/fixture.js";
import { watchExpertFiles, type ExpertFileChange, type ExpertFiles } from "./expert-files.js";

const watching: ExpertFiles[] = [];
afterEach(() => watching.splice(0).forEach((w) => w.stop()));

function watch() {
  const dir = path.join(tempRoot(), "experts");
  const changes: ExpertFileChange[] = [];
  // Looked at only when the test says, by a lookMs no test waits for.
  const w = watchExpertFiles({ dir, lookMs: 3600000, log: () => {}, onChange: (c) => void changes.push(c) });
  watching.push(w);
  const write = (file: string, text: string, at = Date.now()) => {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, file), text);
    fs.utimesSync(path.join(dir, file), new Date(at), new Date(at));
  };
  return { dir, w, changes, write };
}

test("expert files: a file added, changed and removed is told once each; a folder that isn't there has none", async () => {
  const t = watch();
  await t.w.look();
  expect(t.changes).toEqual([]);
  t.write("adr.json", "{}", Date.now() - 60000);
  fs.mkdirSync(path.join(t.dir, "adr")); // its state folder, not a file
  t.write("notes.txt", "not an expert");
  await t.w.look();
  expect(t.changes).toEqual([{ name: "adr", kind: "added", text: "{}" }]);
  t.write("adr.json", '{"version":1}');
  await t.w.look();
  fs.rmSync(path.join(t.dir, "adr.json"));
  await t.w.look();
  expect(t.changes.slice(1)).toEqual([{ name: "adr", kind: "changed", text: '{"version":1}' }, { name: "adr", kind: "removed" }]);
});

test("expert files: saved again with the same content, nothing changes", async () => {
  const t = watch();
  t.write("adr.json", "{}", Date.now() - 60000);
  await t.w.look();
  t.write("adr.json", "{}");
  await t.w.look();
  await t.w.look();
  expect(t.changes).toEqual([{ name: "adr", kind: "added", text: "{}" }]);
});
