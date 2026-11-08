// What the pairing window and the app's main process say to each other.

import type { RPCSchema } from "electrobun/main";
import type { PairingView } from "../bun/menu.ts";

export type PairingRPC = {
  bun: RPCSchema<{
    requests: { view: { params: Record<string, never>; response: PairingView } };
    messages: { open: { url: string } };
  }>;
  webview: RPCSchema<{ requests: Record<string, never>; messages: Record<string, never> }>;
};
