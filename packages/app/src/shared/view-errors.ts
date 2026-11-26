// A window's own errors, passed to the app's main process over the window's RPC, which reports them
// to the offices (bun/error-reports.ts): Vue's, and any error or rejected promise nothing in the
// window caught. Vue's are still logged to the window's console, as Vue logs them without a handler.
// Passing one on never throws, and a failure to pass one on is never passed on itself.

import type { App } from "vue";
import { errorOf, type RawError } from "./error-of.ts";

export function passViewErrors(app: App, send: (error: RawError) => void): void {
  const pass = (value: unknown) => {
    try {
      send(errorOf(value));
    } catch {
      // The app can't be told: the error is only in the console.
    }
  };
  app.config.errorHandler = (err) => {
    console.error(err);
    pass(err);
  };
  window.addEventListener("error", (event) => pass(event.error ?? event.message));
  window.addEventListener("unhandledrejection", (event) => pass(event.reason));
}
