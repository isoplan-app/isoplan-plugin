// The window of what's running's end of what it and the app's main process say to each other
// (shared/running-rpc.ts), made once: App.vue asks through it, and main.ts passes the window's
// errors through it.
import { Electroview } from "electrobun/view";
import type { RunningRPC } from "../shared/running-rpc.ts";

// How long the app may take to answer (listing the processes can take a few seconds), and how long the
// window waits before asking again until an answer gives its own pace.
export const REQUEST_MS = 15000;
export const rpc = Electroview.defineRPC<RunningRPC>({ maxRequestTime: REQUEST_MS, handlers: { requests: {}, messages: {} } });
new Electroview({ rpc });
