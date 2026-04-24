import { defineConfig } from "@playwright/test";

// Flaky-test strategy (Issue #29):
// - CI retries failing tests twice before reporting red. Local runs do
//   NOT retry so flakiness is visible during development.
// - Chromium (primary) retries 2×; tablet/mobile retry 1× to cap CI
//   walltime. Override per-project via `projects[].retries` below.
// - `trace`/`video` are retained only on retry to keep artifact size
//   bounded while still providing debug context.
const CI = !!process.env.CI;

export default defineConfig({
  testDir: "tests/e2e",
  outputDir: "test-results",
  forbidOnly: CI,
  workers: 1,
  timeout: 120_000,
  retries: CI ? 2 : 0,
  // Issue #256 / P-0088: before any spec runs, verify the backend on :8501
  // is the E2E-configured one (LIZYSTUDIO_FILES_ROOT=/tmp). Fails loud if a
  // developer forgot to stop ``uv run lizystudio --reload`` before invoking
  // ``pnpm test:e2e``.
  globalSetup: "./tests/e2e/global-setup.ts",
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
    trace: CI ? "retain-on-failure" : "off",
    video: CI ? "retain-on-failure" : "off",
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
      retries: CI ? 1 : 0,
      use: {
        browserName: "chromium",
        viewport: { width: 768, height: 1024 },
      },
    },
    {
      name: "chromium-mobile",
      retries: CI ? 1 : 0,
      use: {
        browserName: "chromium",
        viewport: { width: 375, height: 812 },
      },
    },
  ],
});
