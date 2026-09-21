import { defineConfig } from "@playwright/test";

// tools/e2e/run.ts brings up the stack (DB, zero-cache, hub, Vite) — no webServer here.
export default defineConfig({
  testDir: ".",
  // phase-a is the end-to-end smoke; aurora is US-D06's surface map; d9-surfaces is US-D09's
  // material map (nested glass, the chrome recipe, the body scale). All three append to
  // .tmp/assertions.json rather than writing it, so the report carries every spec's rows.
  testMatch: /(phase-a|aurora|d9-surfaces)\.spec\.ts/,
  timeout: 90_000,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  outputDir: ".playwright/artifacts",
  use: {
    baseURL: "http://127.0.0.1:5173",
    headless: true,
    viewport: { width: 1440, height: 1400 },
  },
});
