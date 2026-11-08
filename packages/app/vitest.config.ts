import { defineConfig } from "vitest/config";

// The tests are the engine's and the menu's, in src/bun; vite.config.ts is the pairing window's build.
export default defineConfig({ test: { root: ".", include: ["src/bun/*.test.ts"] } });
