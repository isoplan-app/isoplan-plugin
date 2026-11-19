import { expect, test } from "vitest";
import { isDismissed, type ExpertCreationSuggestionDismissal } from "./index.js";

const project = "github.com/isoplan-app/isoplan-plugin";
const now = Date.parse("2026-11-19T12:00:00Z");
const forever = (folder: string): ExpertCreationSuggestionDismissal => ({ project, folder, forever: true });

test.each([
  ["packages/mod", "packages/mod/src", true],
  ["packages/mod/src", "packages/mod", false],
  ["packages/mod", "packages/modx", false],
  [".", "a/b", true],
  ["Packages/Mod", "packages/mod/SRC", true],
])("a dismissal of %s covers %s: %s", (dismissed, folder, covered) => {
  expect(isDismissed([forever(dismissed)], project, folder, now)).toBe(covered);
});

test("the project must match, whatever its letter case", () => {
  expect(isDismissed([forever("docs")], "GitHub.com/Isoplan-App/Isoplan-Plugin", "docs", now)).toBe(true);
  expect(isDismissed([forever("docs")], "github.com/isoplan-app/isoplan-app", "docs", now)).toBe(false);
});

test("a dismissal until a time holds only while that time is later than now", () => {
  const until = (at: string): ExpertCreationSuggestionDismissal[] => [{ project, folder: "docs", until: at }];
  expect(isDismissed(until("2026-11-19T12:00:01Z"), project, "docs", now)).toBe(true);
  expect(isDismissed(until("2026-11-19T12:00:00Z"), project, "docs", now)).toBe(false);
  expect(isDismissed(until("2026-11-18T12:00:00Z"), project, "docs", now)).toBe(false);
});

test("any one dismissal is enough, and none covers nothing", () => {
  expect(isDismissed([forever("src"), forever("docs")], project, "docs/adr", now)).toBe(true);
  expect(isDismissed([], project, "docs", now)).toBe(false);
});
