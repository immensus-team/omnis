import { defineConfig } from "@playwright/test";

// The stack (DB, zero-cache, hub, Vite) is brought up by tools/e2e/run.ts — no webServer here.
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
