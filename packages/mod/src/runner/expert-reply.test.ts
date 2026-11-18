import { MAX_EXPERT_ANSWER_LENGTH } from "@isoplan/protocol";
import { expect, test } from "vitest";
import { answerText, citationBlock, fileOf, parseReply, stamp } from "./expert-reply.js";

const A = "a".repeat(40);
const B = "b".repeat(40);
const HEAD = "c".repeat(40);

test("reply: its blocks parsed; paths that aren't repo-relative dropped", () => {
  const reply = parseReply(`<answer>
Nothing leaves.
</answer>
<cited>
docs/adr/0004-what-leaves-a-machine.md
- packages/server/src/asks.ts:166-173
packages\\mod\\src\\lines.ts
/etc/passwd
C:/Users/x/secret.ts
../other/repo.ts
docs/adr/0004-what-leaves-a-machine.md
</cited>
<learned>
Rule or fact: hello waits for the list. Why: ADR 0004. Files: report-session.ts
</learned>`);
  expect(reply).toEqual({
    answer: "Nothing leaves.",
    cited: ["docs/adr/0004-what-leaves-a-machine.md", "packages/server/src/asks.ts:166-173", "packages/mod/src/lines.ts"],
    dropped: ["/etc/passwd", "C:/Users/x/secret.ts", "../other/repo.ts"],
    learned: "Rule or fact: hello waits for the list. Why: ADR 0004. Files: report-session.ts",
    askSenior: null,
  });
  expect(parseReply("<learned>" + "x".repeat(5000) + "</learned>").learned).toHaveLength(3000);
});

test("reply: a reply that is only <ask-senior> asks the senior; one with an answer too doesn't; no <answer> block and an empty one", () => {
  expect(parseReply("  <ask-senior>Why does hello wait?</ask-senior>\n").askSenior).toBe("Why does hello wait?");
  expect(parseReply("<answer>x</answer><ask-senior>y</ask-senior>").askSenior).toBe(null);
  expect(parseReply("Just prose.")).toMatchObject({ answer: null, cited: [] });
  expect(parseReply("<answer>  \n </answer>").answer).toBe("");
});

test("stamp: read in this fork, else the senior's, else the index, else unknown; a line-ranged citation goes by its file", () => {
  expect(fileOf("packages/server/src/asks.ts:166-173")).toBe("packages/server/src/asks.ts");
  expect(fileOf("a.ts:12")).toBe("a.ts");
  const stamped = stamp(["read.ts:10-20", "senior.ts", "indexed.ts", "new.ts"], new Set(["read.ts"]), { "senior.ts": A, "read.ts": B }, { "indexed.ts": B, "senior.ts": B }, HEAD);
  expect(stamped).toEqual([
    { cited: "read.ts:10-20", file: "read.ts", commit: HEAD, from: "read" },
    { cited: "senior.ts", file: "senior.ts", commit: A, from: "senior" },
    { cited: "indexed.ts", file: "indexed.ts", commit: B, from: "index" },
    { cited: "new.ts", file: "new.ts", commit: null, from: "unknown" },
  ]);
  expect(citationBlock(stamped, "main", HEAD, new Set(["senior.ts", "read.ts"]))).toBe(
    ["Cited, on main at ccccccc:", "- read.ts:10-20 (read at ccccccc)", "- senior.ts (read at aaaaaaa, changed since)", "- indexed.ts (read at bbbbbbb)", "- new.ts (commit unknown)"].join("\n"),
  );
  expect(citationBlock([], "main", HEAD, new Set())).toBe("");
});

test("answer text: a 9,000-character answer is cut, its whole block kept, within the limit; a block alone too long drops its last citations", () => {
  const block = citationBlock(stamp(["docs/adr/0004.md", "a.ts"], new Set(["a.ts"]), {}, { "docs/adr/0004.md": A }, HEAD), "main", HEAD, new Set());
  const text = answerText("x".repeat(9000), block);
  expect(text.length).toBe(MAX_EXPERT_ANSWER_LENGTH);
  expect(text.endsWith(`…\n\n${block}`)).toBe(true);
  expect(answerText("short", block)).toBe(`short\n\n${block}`);
  expect(answerText("y".repeat(9000), "")).toHaveLength(MAX_EXPERT_ANSWER_LENGTH);

  const many = stamp(Array.from({ length: 400 }, (_, i) => `packages/mod/src/runner/some-long-file-name-${i}.ts`), new Set(), {}, {}, HEAD);
  const long = citationBlock(many, "main", HEAD, new Set());
  expect(long.length).toBeLessThanOrEqual(MAX_EXPERT_ANSWER_LENGTH - 3);
  expect(long).toMatch(/\n- … and \d+ more$/);
  expect(answerText("z", long).length).toBeLessThanOrEqual(MAX_EXPERT_ANSWER_LENGTH);
});
