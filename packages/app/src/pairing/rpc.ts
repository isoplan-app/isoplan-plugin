// The pairing window's end of what it and the app's main process say to each other
// (shared/pairing-rpc.ts), made once: App.vue asks through it, and main.ts passes the window's
// errors through it.
import { Electroview } from "electrobun/view";
import type { PairingRPC } from "../shared/pairing-rpc.ts";

// How long the app may take to answer; unanswered, it is asked again after as long.
export const REQUEST_MS = 5000;
export const rpc = Electroview.defineRPC<PairingRPC>({ maxRequestTime: REQUEST_MS, handlers: { requests: {}, messages: {} } });
new Electroview({ rpc });
