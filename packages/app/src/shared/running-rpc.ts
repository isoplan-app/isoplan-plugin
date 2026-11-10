// What the window of what's running and the app's main process say to each other: the window asks,
// at the pace the answer gives, and only while it is open.

import type { RPCSchema } from "electrobun/main";
import type { RunningView } from "../bun/running.ts";

export type RunningRPC = {
  bun: RPCSchema<{
    requests: { view: { params: Record<string, never>; response: RunningView } };
    messages: Record<string, never>;
  }>;
  webview: RPCSchema<{ requests: Record<string, never>; messages: Record<string, never> }>;
};
