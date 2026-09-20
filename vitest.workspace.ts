import { defineWorkspace } from "vitest/config";
import { omnisAlias } from "./vitest.shared.js";

export default defineWorkspace([
  {
    resolve: { alias: omnisAlias },
    test: {
      name: "unit",
      // 계약 §2: unit은 *.test.ts와 *.test.tsx를 둘 다 덮는다(packages/ui·apps/desktop의 tsx 테스트가
      // pnpm test에서 조용히 스킵되지 않도록). src/ 옆 테스트와 test/ 디렉터리 테스트를 모두 수집한다.
      include: [
        "packages/*/src/**/*.test.{ts,tsx}",
        "packages/*/test/**/*.test.{ts,tsx}",
        "packages/adapters/*/src/**/*.test.{ts,tsx}",
        "packages/adapters/*/test/**/*.test.{ts,tsx}",
        "apps/*/src/**/*.test.{ts,tsx}",
        "apps/*/test/**/*.test.{ts,tsx}",
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
      fileParallelism: false,
      testTimeout: 20_000,
      hookTimeout: 60_000,
    },
  },
]);
