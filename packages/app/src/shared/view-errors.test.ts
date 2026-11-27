import { afterEach, expect, test, vi } from "vitest";
import type { App } from "vue";
import type { RawError } from "./error-of.ts";
import { passViewErrors } from "./view-errors.ts";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** A window with a Vue app whose errors are passed to `send`. */
function view(send: (error: RawError) => void) {
  const target = new EventTarget();
  vi.stubGlobal("window", target);
  const app = { config: {} } as App;
  passViewErrors(app, send);
  return { app, target };
}

test("Vue's errors, and errors and rejections nothing in the window caught, are passed on; Vue's still go to the console", () => {
  const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  const sent: RawError[] = [];
  const { app, target } = view((error) => sent.push(error));
  const vueError = new TypeError("x is undefined");
  app.config.errorHandler!(vueError, null, "render function");
  target.dispatchEvent(Object.assign(new Event("error"), { error: new RangeError("too far") }));
  target.dispatchEvent(Object.assign(new Event("unhandledrejection"), { reason: "no answer" }));
  expect(consoleError).toHaveBeenCalledWith(vueError);
  expect(sent.map((e) => e.message)).toEqual(["TypeError: x is undefined", "RangeError: too far", "no answer"]);
});

test("a send that throws is swallowed", () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  const { app, target } = view(() => {
    throw new Error("no RPC yet");
  });
  expect(() => app.config.errorHandler!(new Error("x"), null, "setup function")).not.toThrow();
  expect(() => target.dispatchEvent(Object.assign(new Event("unhandledrejection"), { reason: "r" }))).not.toThrow();
});
