// What the pairing window and the app's main process say to each other. The window passes on its own
// errors, which the app reports to the offices (bun/error-reports.ts).

import type { RPCSchema } from "electrobun/main";
import type { PairingView } from "../bun/menu.ts";
import type { RawError } from "./error-of.ts";

export type PairingRPC = {
  bun: RPCSchema<{
    requests: { view: { params: Record<string, never>; response: PairingView } };
    messages: { open: { url: string }; error: RawError };
  }>;
  webview: RPCSchema<{ requests: Record<string, never>; messages: Record<string, never> }>;
};
