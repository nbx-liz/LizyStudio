import { defineConfig } from "@playwright/test";

/**
 * Production-fixture capture (P-0116 child 8, owner ruling D-20261022-005).
 *
 * Not a test suite: ``capture.spec.ts`` drives the real SPA against a real
 * backend to produce the jobs that ``scripts/export_lizyml_fixtures.py``
 * turns into ``tests/fixtures/lizyml/`` and its frontend mirror. It lives
 * outside ``tests/e2e`` so neither CI nor ``pnpm test:e2e`` runs it.
 *
 * Run (see ``tests/fixtures/lizyml/README.md`` § Re-capture):
 *
 *   CAPTURE_JOBS_DIR=<new dir> CAPTURE_MANIFEST=<file> \
 *     pnpm exec playwright test -c tests/fixture-capture/playwright.capture.config.ts
 *
 * Both servers are started fresh (never reused), so the jobs land in
 * ``CAPTURE_JOBS_DIR`` and nowhere else.
 */
const jobsDir = process.env.CAPTURE_JOBS_DIR;
if (!jobsDir) {
  throw new Error("CAPTURE_JOBS_DIR must name a new, empty jobs directory");
}

export default defineConfig({
  testDir: ".",
  testMatch: "capture.spec.ts",
  outputDir: "../../test-results/fixture-capture",
  forbidOnly: true,
  workers: 1,
  retries: 0,
  timeout: 300_000,
  webServer: [
    {
      // --jobs-dir, not LIZYSTUDIO_JOBS_DIR: the CLI overwrites that variable
      // with its own --jobs-dir default.
      command: `LIZYSTUDIO_FILES_ROOT=/tmp uv run lizystudio --port 8501 --jobs-dir ${jobsDir}`,
      url: "http://localhost:8501/api/workspace/status",
      reuseExistingServer: false,
      cwd: "../../..",
    },
    {
      command: "pnpm dev",
      url: "http://localhost:5173",
      reuseExistingServer: false,
      cwd: "../..",
    },
  ],
  use: {
    baseURL: "http://localhost:5173",
    viewport: { width: 1440, height: 900 },
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
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
});
