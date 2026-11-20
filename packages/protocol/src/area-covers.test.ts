import { expect, test } from "vitest";
import { areaCovers } from "./index.js";

test.each([
  ["docs/adr/*.md", "docs/adr", true],
  ["docs/adr/*.md", "docs/adr/x", true],
  ["docs/adr/*.md", "docs", false],
  ["packages/server", "packages/server/src", true],
  ["packages/server", "packages/serverless", false],
  [".", "a/b", true],
  ["**/*.ts", "a/b", true],
  ["Packages/Server", "packages/server/SRC", true],
])("%s covers %s: %s", (area, folder, covered) => {
  expect(areaCovers([area], folder)).toBe(covered);
});

test("any one of the areas is enough, and none covers nothing", () => {
  expect(areaCovers(["docs", "packages/mod/src/**"], "packages/mod/src/runner")).toBe(true);
  expect(areaCovers([], "docs")).toBe(false);
});
