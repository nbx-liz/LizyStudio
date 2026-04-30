import { expect, test } from "@playwright/test";
import * as fs from "node:fs";
import { API, createTestCsv } from "./helpers/api";
import { isMobileProject } from "./helpers/mobile";
import { seedUiWorkspace } from "./helpers/workspace-ui";

/**
 * G-3 (P-0089 / Issue #279) UI half — E2E for the running-lock
 * mapping in the workspace.
 *
 * The backend regression at
 * `tests/regression/test_reg_0279_workspace_locked_during_run.py`
 * already pins the server-side INV-1..INV-4 contract: PUT/PATCH
 * /api/workspace/config returns 409 WORKSPACE_LOCKED while a job is
 * active and the saved config is unchanged. What is NOT covered
 * anywhere is the UI mapping:
 *
 *   - Does the funnel-routed PUT actually surface as the
 *     `Config is locked while a job is running` info-toast (and
 *     not the generic error-toast)?
 *   - Does the cache invalidate so the form resyncs to the locked
 *     config instead of holding the rejected payload?
 *   - Once the job finishes, does the same edit succeed?
 *
 * The spec drives a real Tune (tune is slower than Fit on a 100-row
 * dataset, giving us a ~10s "running" window without needing a
 * synthetic test backdoor) and then issues a config edit through
 * the UI while the job is in flight.
 *
 * Why Tune and not Fit: a 100-row Fit completes in <2s on the CI
 * runners, leaving an unreliable race window. Tune with a default
 * n_trials runs Optuna iterations sequentially and stays in the
 * `running` state long enough for the spec to issue a UI edit and
 * still observe the lock.
 */

const CSV_PATH = "/tmp/e2e_running_lock.csv";

test.describe("Workspace running-lock UI mapping (G-3 / Issue #279)", () => {
  test.beforeAll(() => {
    createTestCsv(100, CSV_PATH);
  });

  test.afterAll(() => {
    if (fs.existsSync(CSV_PATH)) fs.unlinkSync(CSV_PATH);
  });

  test.beforeEach(async ({ request }) => {
    await request.post(`${API}/workspace/reset`);
    // Cleanup any stale jobs from prior runs so /api/jobs/ counts
    // are deterministic.
    const list = await request.get(`${API}/jobs/`);
    if (list.status() === 200) {
      const jobs = (await list.json()) as Array<{ job_id: string }>;
      for (const j of jobs) {
        await request
          .delete(`${API}/jobs/${j.job_id}?cascade=true`)
          .catch(() => {});
      }
    }
  });

  test("UI: PUT /config while tune is running → info-toast + cache resync + later edit succeeds", async ({
    page,
    request,
  }, testInfo) => {
    test.setTimeout(120_000);
    if (isMobileProject(testInfo)) {
      // Mobile collapses the Data accordion that holds the Folds input
      // we use to drive the lock; the desktop spec is the contract.
      test.skip(true, "Mobile layout collapses Data accordion; covered by B-8");
    }

    await seedUiWorkspace(page, testInfo, {
      csvPath: CSV_PATH,
      target: "target",
      expectedRows: 100,
    });

    // Snapshot the seeded config.split.n_splits so we can assert
    // INV-3 (no mutation) after the rejected write attempt.
    const seededRes = await request.get(`${API}/workspace/config`);
    expect(seededRes.status()).toBe(200);
    const seededConfig = await seededRes.json();
    const seededFolds = seededConfig.split.n_splits as number;
    expect(seededFolds).toBe(5);

    // Switch to Tune tab and start a real tune. Same pattern as the
    // happy-path workspace-tune spec.
    await page.getByRole("tab", { name: "Tune" }).click();
    const tuneButton = page.getByRole("button", { name: "Tune", exact: true });
    await expect(tuneButton).toBeEnabled({ timeout: 15_000 });

    const tuneResponsePromise = page.waitForResponse(
      (res) =>
        res.url().endsWith("/api/workspace/tune") &&
        res.request().method() === "POST",
      { timeout: 30_000 },
    );
    await tuneButton.click();
    const tuneResponse = await tuneResponsePromise;
    expect(tuneResponse.status()).toBe(200);
    const { job_id: jobId } = await tuneResponse.json();
    expect(jobId).toBeTruthy();

    // Wait until the backend reports the job as `running`. The
    // active-slot lock engages the moment the runner takes over,
    // which is the same instant the UI starts polling for status.
    await expect
      .poll(
        async () => {
          const res = await request.get(`${API}/jobs/${jobId}`);
          if (res.status() !== 200) return null;
          const body = (await res.json()) as { status: string };
          return body.status;
        },
        {
          timeout: 15_000,
          intervals: [50, 100, 200, 500],
          message: "tune job never transitioned to running",
        },
      )
      .toBe("running");

    // Now drive a UI edit while the lock is engaged. The Folds
    // NumberInput lives in the Data panel; on Tune-tab it is still
    // mounted (only the Model panel switched between Fit/Tune).
    //
    // Watch for the PUT response so we can assert the 409 mapping
    // surfaced before any test-side polling could mask the toast.
    const putWhileLockedPromise = page.waitForResponse(
      (res) =>
        res.url().endsWith("/api/workspace/config") &&
        res.request().method() === "PUT",
      { timeout: 15_000 },
    );

    const folds = page.getByRole("textbox", { name: "Folds", exact: true });
    await expect(folds).toBeVisible();
    await folds.fill("8");
    await folds.blur();

    const lockedPut = await putWhileLockedPromise;
    expect(
      lockedPut.status(),
      "PUT /config while tune is running must be rejected with 409",
    ).toBe(409);
    const lockedBody = await lockedPut.json();
    expect(lockedBody.error?.code).toBe("WORKSPACE_LOCKED");

    // Info-toast surfaces, NOT the generic error-toast. sonner renders
    // the toast text directly into the DOM with role=status; matching
    // by text is enough.
    await expect(
      page.getByText("Config is locked while a job is running"),
    ).toBeVisible({ timeout: 5_000 });

    // INV-3 (no mutation): the saved config still carries the seeded
    // n_splits=5, not the rejected n_splits=8.
    const lockedGet = await request.get(`${API}/workspace/config`);
    expect(lockedGet.status()).toBe(200);
    const lockedConfig = await lockedGet.json();
    expect(lockedConfig.split.n_splits).toBe(seededFolds);

    // The 409 path must invalidate the React Query cache so the form
    // re-fetches and re-renders the input back to the saved value.
    // Wait for the input to reflect the saved n_splits, not the
    // rejected n_splits=8 the user tried to type.
    await expect
      .poll(async () => folds.inputValue(), {
        timeout: 5_000,
        intervals: [100, 200, 400],
        message: "Folds NumberInput never resynced to saved n_splits",
      })
      .toBe(String(seededFolds));

    // Wait for the tune to terminate so INV-4 (release) can be
    // exercised. Cancel for speed — the lock releases on any
    // terminal status.
    await request.post(`${API}/jobs/${jobId}/cancel`);
    await expect
      .poll(
        async () => {
          const res = await request.get(`${API}/jobs/${jobId}`);
          if (res.status() !== 200) return null;
          const body = (await res.json()) as { status: string };
          return body.status;
        },
        {
          timeout: 30_000,
          intervals: [200, 500, 1000],
          message: "tune job never reached a terminal status after cancel",
        },
      )
      .toMatch(/^(cancelled|completed|failed)$/);

    // INV-4 (release): the same edit now succeeds. Use a fresh value
    // (n_splits=6) so the assertion is positive — if the lock were
    // still engaged, the input would remain at seededFolds=5 again.
    const putAfterReleasePromise = page.waitForResponse(
      (res) =>
        res.url().endsWith("/api/workspace/config") &&
        res.request().method() === "PUT" &&
        res.status() === 200,
      { timeout: 15_000 },
    );
    await folds.fill("6");
    await folds.blur();
    const releasedPut = await putAfterReleasePromise;
    expect(releasedPut.status()).toBe(200);

    const releasedConfig = await (
      await request.get(`${API}/workspace/config`)
    ).json();
    expect(releasedConfig.split.n_splits).toBe(6);
  });
});
