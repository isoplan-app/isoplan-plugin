import { fileURLToPath } from "node:url";
import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite";

// The pairing window, built into dist/ for Electrobun to copy into the app. Its browser API comes
// from the toolchain projection Electrobun makes in .hutch/devkit.
export default defineConfig({
  plugins: [vue()],
  root: "src/pairing",
  base: "./",
  resolve: { alias: { "electrobun/view": fileURLToPath(new URL("./.hutch/devkit/api/browser/index.ts", import.meta.url)) } },
  build: { outDir: "../../dist", emptyOutDir: true },
});
