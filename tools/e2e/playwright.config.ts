import { defineConfig } from "@playwright/test";

// 스택(DB·zero-cache·허브·Vite)은 tools/e2e/run.ts가 띄운다 — 여기서는 webServer를 쓰지 않는다.
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
