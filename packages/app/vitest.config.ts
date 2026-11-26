import { defineConfig } from "vitest/config";

// The tests are the engine's, the menu's, the window of what's running's and the error reports', in src/bun; vite.config.ts builds both windows.
// tsconfigPaths: the mod code they import takes @isoplan/protocol from its source, through
// tsconfig.base.json's paths, as typecheck does, so the tests need no build first.
export default defineConfig({ resolve: { tsconfigPaths: true }, test: { root: ".", include: ["src/bun/*.test.ts"] } });
