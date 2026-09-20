import { defineConfig } from "vitest/config";
import { omnisAlias } from "../../vitest.shared.js";

export default defineConfig({
  resolve: { alias: omnisAlias },
  test: {
    include: ["test/**/*.test.ts"],
    globalSetup: ["../../vitest.global-setup.ts"],
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 60_000,
  },
});
