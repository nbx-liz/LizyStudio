import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  outputDir: "test-results",
  forbidOnly: !!process.env.CI,
  timeout: 120_000,
  use: {
    baseURL: "http://localhost:5173",
    screenshot: "on",
    viewport: { width: 1440, height: 900 },
  },
  projects: [
    {
      name: "chromium",
      use: { browserName: "chromium" },
    },
  ],
});
