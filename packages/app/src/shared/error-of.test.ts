import { expect, test } from "vitest";
import { passedError } from "./error-of.ts";

test("what a window passes is an error only with a string message, and keeps its stack only if it is a string", () => {
  expect(passedError({ message: "Error: x", stack: "at a (b.js:1:2)" })).toEqual({ message: "Error: x", stack: "at a (b.js:1:2)" });
  expect(passedError({ message: "Error: x", stack: 3 })).toEqual({ message: "Error: x" });
  expect(passedError({ message: 1 })).toBeNull();
  expect(passedError(null)).toBeNull();
});
