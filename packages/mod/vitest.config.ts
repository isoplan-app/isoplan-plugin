import { defineConfig } from "vitest/config";

// tsconfigPaths: the tests take @isoplan/protocol from its source, through tsconfig.base.json's
// paths, as typecheck and build.mjs do, so they need no build first.
export default defineConfig({ resolve: { tsconfigPaths: true } });
