import { defineConfig } from "vitest/config";

// The tests are the engine's, the menu's and the window of what's running's, in src/bun; vite.config.ts builds both windows.
export default defineConfig({ test: { root: ".", include: ["src/bun/*.test.ts"] } });
