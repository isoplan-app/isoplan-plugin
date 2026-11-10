import type { ElectrobunConfig } from "electrobun";
import pkg from "./package.json" with { type: "json" };

// Signing: macOS signs and notarizes when the release workflow sets ELECTROBUN_DEVELOPER_ID and the
// App Store Connect key (README.md); unsigned local builds leave it out. Windows is signed by the
// workflow, with signtool, before it packs the app.
const signMac = !!process.env.ELECTROBUN_DEVELOPER_ID;

export default {
  app: {
    name: "Isoplan",
    identifier: "app.isoplan.desktop",
    version: pkg.version,
  },
  runtime: {
    // A tray app: closing a window leaves it running.
    exitOnLastWindowClosed: false,
  },
  build: {
    mainProcess: "bun",
    bun: { entrypoint: "src/bun/index.ts" },
    copy: {
      "dist/pairing/index.html": "views/pairing/index.html",
      "dist/running/index.html": "views/running/index.html",
      "dist/view-assets": "views/view-assets",
      "assets/isoplan.ico": "views/assets/isoplan.ico",
      "assets/tray-template.png": "views/assets/tray-template.png",
      "assets/tray-template@2x.png": "views/assets/tray-template@2x.png",
    },
    watchIgnore: ["dist/**"],
    mac: { bundleCEF: false, createDmg: false, codesign: signMac, notarize: signMac, icons: "assets/icon.iconset" },
    linux: { bundleCEF: false },
    win: { bundleCEF: false, icon: "assets/isoplan.ico" },
  },
  release: { generatePatch: false },
} satisfies ElectrobunConfig;
