import type { FullConfig } from "@playwright/test";

/**
 * Playwright globalSetup — env-fingerprint guard (Issue #256, P-0088).
 *
 * Why: when a developer runs ``uv run lizystudio --reload`` by hand and
 * then kicks off ``pnpm test:e2e``, Playwright's ``reuseExistingServer``
 * hits the already-listening process on port 8501 and skips its own
 * managed backend. That process uses the default ``LIZYSTUDIO_FILES_ROOT``
 * (``$HOME``), so every spec that writes to ``/tmp/e2e_*.csv`` gets a
 * silent 400 PATH_NOT_FOUND. 42/75 functional tests fail for this single
 * reason.
 *
 * This guard hits ``GET /api/workspace/status`` once before the suite
 * starts and asserts the backend's active ``files_root`` matches the
 * E2E-configured value (``/tmp``). If it does not, we throw a loud,
 * actionable error pointing the developer at the exact env mismatch.
 */
export default async function globalSetup(
  _config: FullConfig,
): Promise<void> {
  const expected = process.env.LIZYSTUDIO_FILES_ROOT ?? "/tmp";
  const statusUrl = "http://localhost:8501/api/workspace/status";

  // Give the webServer block a brief window to start its managed backend
  // before we probe; if it's already up, this resolves on the first try.
  const deadline = Date.now() + 30_000;
  let lastError: unknown = null;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(statusUrl);
      if (!res.ok) {
        // Use the "E2E env guard:" prefix so the catch re-throws
        // immediately instead of retrying a genuine 4xx/5xx until the
        // 30s deadline. Retries are only useful while the backend is
        // coming up (connect/ECONNREFUSED), not when it is actively
        // saying "no".
        throw new Error(
          `E2E env guard: /api/workspace/status returned HTTP ${res.status}. ` +
            `The backend is reachable but rejecting the status probe — ` +
            `fix the backend before re-running tests.`,
        );
      }
      const body = (await res.json()) as { files_root?: string };
      const actual = body.files_root;
      if (!actual) {
        throw new Error(
          `E2E env guard: /api/workspace/status did not return files_root. ` +
            `Regenerate the OpenAPI schema and restart the backend.`,
        );
      }
      if (actual !== expected) {
        throw new Error(
          `E2E env guard: backend on :8501 reports files_root=${JSON.stringify(
            actual,
          )} but E2E expects ${JSON.stringify(expected)}.\n` +
            `\n` +
            `Most likely cause: a dev server is already running on :8501 with ` +
            `the default files_root (HOME). Playwright's reuseExistingServer ` +
            `picked it up and every spec that writes to /tmp/e2e_*.csv will ` +
            `fail with PATH_NOT_FOUND.\n` +
            `\n` +
            `Fix: stop the dev server (pkill -f 'lizystudio --port 8501') and ` +
            `re-run pnpm test:e2e.`,
        );
      }
      return;
    } catch (err) {
      lastError = err;
      // If it's our explicit guard error (mismatch, missing field, or
      // non-OK HTTP), do not retry — re-throw now.
      if (err instanceof Error && err.message.startsWith("E2E env guard:")) {
        throw err;
      }
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  const suffix =
    lastError instanceof Error
      ? `${lastError.message}\n${lastError.stack ?? ""}`
      : String(lastError);
  throw new Error(
    `E2E env guard: backend on :8501 was not reachable within 30s. ` +
      `Last error: ${suffix}`,
  );
}
