import { defineWorkspace } from "vitest/config";
import { omnisAlias } from "./vitest.shared.js";

export default defineWorkspace([
  {
    resolve: { alias: omnisAlias },
    test: {
      name: "unit",
      // Contract §2: unit covers both *.test.ts and *.test.tsx (so tsx tests in packages/ui and
      // apps/desktop are not silently skipped by pnpm test). Collects tests beside src/ and under test/.
      include: [
        "packages/*/src/**/*.test.{ts,tsx}",
        "packages/*/test/**/*.test.{ts,tsx}",
        "packages/adapters/*/src/**/*.test.{ts,tsx}",
        "packages/adapters/*/test/**/*.test.{ts,tsx}",
        "apps/*/src/**/*.test.{ts,tsx}",
        "apps/*/test/**/*.test.{ts,tsx}",
        "tools/auth-kit/*.test.{ts,tsx}",
      ],
      exclude: [
        "**/test/integration/**",
        "**/test/contract.test.ts",
        "**/node_modules/**",
        "**/dist/**",
      ],
    },
  },
  {
    resolve: { alias: omnisAlias },
    test: { name: "contract", include: ["packages/adapters/*/test/contract.test.ts"] },
  },
  {
    resolve: { alias: omnisAlias },
    test: {
      name: "integration",
      include: ["packages/*/test/integration/**/*.test.ts", "apps/*/test/integration/**/*.test.ts"],
      globalSetup: ["./vitest.global-setup.ts"],
      // ponytail: vitest 2.1 ignores project-level fileParallelism (root/CLI only). Integration tests
      // share the single omnis_test DB, so overlapping files mix their NOTIFYs → serialize with singleFork.
      poolOptions: { forks: { singleFork: true } },
      testTimeout: 20_000,
      hookTimeout: 60_000,
    },
  },
]);
