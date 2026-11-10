import { fileURLToPath } from "node:url";
import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite";

// The app's windows, the pairing window and the window of what's running, built into dist/ for
// Electrobun to copy into the app: dist/<window>/index.html, sharing dist/view-assets. Their browser API
// comes from the toolchain projection Electrobun makes in .hutch/devkit.
const page = (name: string) => fileURLToPath(new URL(`./src/${name}/index.html`, import.meta.url));
export default defineConfig({
  plugins: [vue()],
  root: "src",
  // Absolute, because a views:// address treats the window's folder as its root, so ../ can't reach
  // view-assets: each page loads views://view-assets/….
  base: "views://",
  resolve: { alias: { "electrobun/view": fileURLToPath(new URL("./.hutch/devkit/api/browser/index.ts", import.meta.url)) } },
  build: { outDir: "../dist", emptyOutDir: true, assetsDir: "view-assets", rollupOptions: { input: { pairing: page("pairing"), running: page("running") } } },
});
