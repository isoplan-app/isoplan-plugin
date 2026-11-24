// What the window of what's running and the app's main process say to each other: the window asks,
// at the pace the answer gives, and only while it is open; and, once a person has confirmed, asks the
// app to end one process (by its pid and when it started) or every one it offers in a folder (#144).

import type { RPCSchema } from "electrobun/main";
import type { RunningView } from "../bun/running.ts";

export type RunningRPC = {
  bun: RPCSchema<{
    requests: {
      view: { params: Record<string, never>; response: RunningView };
      end: { params: { folder: string; pid?: number; started?: string }; response: { ended: number; failed: number } };
    };
    messages: Record<string, never>;
  }>;
  webview: RPCSchema<{ requests: Record<string, never>; messages: Record<string, never> }>;
};
