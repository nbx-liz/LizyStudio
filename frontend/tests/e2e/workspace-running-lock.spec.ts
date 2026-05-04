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
 * active and the saved config is unchanged. This spec covers the
 * **UI mapping** half:
 *
 *   1. While the job runs, the workspace controls (Folds NumberInput
 *      stands in for the whole disabled-form set) are visibly disabled.
 *      This is the user-facing "you cannot edit" surface.
 *   2. A direct PUT issued by the test runner — simulating any in-flight
 *      writer that bypasses the disabled UI (e.g. delayed funnel ops
 *      coalesced after `running=true` propagated) — gets 409 +
 *      WORKSPACE_LOCKED, and ws.config stays unchanged.
 *   3. Once the job releases (cancel → terminal), the controls re-enable
 *      and a UI-driven edit lands as a 200 PUT.
 *
 * Why we do NOT try to drive the UI lock surface via the disabled input:
 * the production UI guards the lock at TWO layers (input disabled
 * AND backend 409). The disabled-input guard fires first under normal
 * user interaction, so a direct UI fill returns no PUT response at
 * all and the spec deadlocks waiting for one. The toast that fires
 * from useConfigSync / useModelPanelData on a 409 is reachable only
 * through asynchronous race conditions that are not deterministic at
 * the E2E layer; it is locked at the unit level instead.
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

  test("UI: form disables + backend 409s while tune runs; both release on terminal", async ({
    page,
    request,
  }, testInfo) => {
    test.setTimeout(120_000);
    if (isMobileProject(testInfo)) {
      // Mobile collapses the Data accordion that holds the Folds input
      // we use as the lock-surface witness; covered by B-8.
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

    const folds = page.getByRole("textbox", { name: "Folds", exact: true });
    await expect(folds).toBeVisible();
    await expect(folds).toBeEnabled();

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
    // which is the same instant the UI receives `running=true` and
    // disables the form controls.
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

    // INV (UI mapping): the Folds NumberInput is disabled while a job
    // is running. This is the user-facing half of the lock — without
    // it, the user sees a clickable input that mysteriously rejects
    // their edit.
    await expect(folds).toBeDisabled({ timeout: 5_000 });

    // INV-1 + INV-3 (backend contract under UI fixture): a PUT issued
    // by anyone OTHER than the disabled input — e.g. an in-flight
    // funnel op coalesced after `running=true` propagated, or a
    // direct API caller — gets 409 + WORKSPACE_LOCKED, and ws.config
    // is unchanged. We drive this from the test-runner request rather
    // than the UI because the UI input is now disabled (which is the
    // correct production behaviour); the contract under test is the
    // server-side rejection path.
    const lockedPut = await request.put(`${API}/workspace/config`, {
      data: { ...seededConfig, split: { ...seededConfig.split, n_splits: 8 } },
    });
    expect(
      lockedPut.status(),
      "PUT /config while tune is running must be rejected with 409",
    ).toBe(409);
    const lockedBody = await lockedPut.json();
    expect(lockedBody.error?.code).toBe("WORKSPACE_LOCKED");

    // INV-3 (no mutation): the saved config still carries the seeded
    // n_splits=5, not the rejected n_splits=8.
    const lockedGet = await request.get(`${API}/workspace/config`);
    expect(lockedGet.status()).toBe(200);
    const lockedConfig = await lockedGet.json();
    expect(lockedConfig.split.n_splits).toBe(seededFolds);

    // Cancel the tune so INV-4 (release) can be exercised. Lock
    // releases on any terminal status.
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

    // INV (UI mapping, release half): the input re-enables once the
    // job hits a terminal status, the workspace polling layer
    // observes it, and `running=false` propagates to the form.
    await expect(folds).toBeEnabled({ timeout: 15_000 });

    // INV-4 (release): a UI-driven edit now lands as a 200 PUT.
    // Use a fresh value (n_splits=6) so the assertion is positive —
    // if the lock were still engaged, the PUT would 409.
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
