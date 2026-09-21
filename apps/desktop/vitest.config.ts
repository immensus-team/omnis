import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    setupFiles: ["./test/setup.ts"],
    // Same split as the root workspace (vitest.workspace.ts): this config is the jsdom unit run,
    // and test/integration is the node-env project that needs a live zero-cache (it skips itself
    // without OMNIS_ZERO_URL, but it cannot be collected here — its @omnis/db import only resolves
    // through the workspace alias, and under jsdom that package's import.meta.url is not a file
    // URL). Without this exclusion `pnpm --filter @omnis/desktop test` fails on an import error
    // before that skip can happen.
    exclude: ["**/test/integration/**", "**/node_modules/**", "**/dist/**"],
  },
});
