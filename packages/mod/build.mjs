// Bundles the hooks module and its end of the runner's pipe (dist/pipe.js) into dist/, each one ESM
// file with protocol and zod inlined, so the plugin runs from a git checkout with no install step,
// plus dist/data-layer.js (kept for older code: src/data-layer/main.ts), the
// wake hook (which install copies into the config folder), the install script, the runner, the
// handoff commands' script, the ask_earlier_session tool's script, the isoplan:// link handler (src/connect) and /isoplan:repos's script.
// dist/ is committed: rebuild it with every change to src/.

import { build } from "rolldown";

const common = { platform: "node", cwd: import.meta.dirname, logLevel: "warn" };
const output = { format: "esm", codeSplitting: false, sourcemap: false };

await build([
  { ...common, input: "src/hooks/register.ts", output: { ...output, file: "dist/hooks.js" } },
  { ...common, input: "src/data-layer/main.ts", output: { ...output, file: "dist/data-layer.js" } },
  { ...common, input: "src/pipe/entry.ts", output: { ...output, file: "dist/pipe.js" } },
  { ...common, input: "src/wake/main.ts", output: { ...output, file: "dist/wake.js" } },
  { ...common, input: "src/install/main.ts", output: { ...output, file: "dist/install.js" } },
  { ...common, input: "src/runner/main.ts", output: { ...output, file: "dist/runner.js" } },
  { ...common, input: "src/handoff/main.ts", output: { ...output, file: "dist/handoff.js" } },
  { ...common, input: "src/ask/main.ts", output: { ...output, file: "dist/ask.js" } },
  { ...common, input: "src/connect/main.ts", output: { ...output, file: "dist/connect.js" } },
  { ...common, input: "src/repos/main.ts", output: { ...output, file: "dist/repos.js" } },
]);
