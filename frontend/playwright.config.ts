import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  outputDir: "test-results",
  forbidOnly: !!process.env.CI,
  workers: 1,
  timeout: 120_000,
  snapshotPathTemplate:
    "{testDir}/__screenshots__/{projectName}/{testFilePath}/{arg}{ext}",
  expect: {
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.01,
      animations: "disabled",
    },
  },
  webServer: [
    {
      command:
        "LIZYSTUDIO_FILES_ROOT=/tmp LIZYSTUDIO_JOBS_DIR=/tmp/e2e_jobs uv run lizystudio --port 8501",
      url: "http://localhost:8501/api/workspace/status",
      reuseExistingServer: !process.env.CI,
      cwd: "..",
    },
    {
      command: "pnpm dev",
      url: "http://localhost:5173",
      reuseExistingServer: !process.env.CI,
    },
  ],
  use: {
    baseURL: "http://localhost:5173",
    screenshot: "on",
    viewport: { width: 1440, height: 900 },
    // Dismiss onboarding dialog for all E2E tests
    storageState: {
      cookies: [],
      origins: [
        {
          origin: "http://localhost:5173",
          localStorage: [
            { name: "lizystudio-onboarding-completed", value: "true" },
          ],
        },
      ],
    },
  },
  projects: [
    {
      name: "chromium",
      use: { browserName: "chromium" },
    },
    {
      name: "chromium-tablet",
      use: {
        browserName: "chromium",
        viewport: { width: 768, height: 1024 },
      },
    },
    {
      name: "chromium-mobile",
      use: {
        browserName: "chromium",
        viewport: { width: 375, height: 812 },
      },
    },
  ],
});
