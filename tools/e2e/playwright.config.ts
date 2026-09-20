import { defineConfig } from "@playwright/test";

// tools/e2e/run.ts brings up the stack (DB, zero-cache, hub, Vite) — no webServer here.
export default defineConfig({
  testDir: ".",
  testMatch: /phase-a\.spec\.ts/,
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
