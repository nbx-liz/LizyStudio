import { expect, test } from "@playwright/test";
import * as fs from "node:fs";
import {
  API,
  createTestCsv,
  deleteAllJobs,
  setupAndFit,
  waitForJobDone,
} from "./helpers/api";
import { dismissOnboarding } from "./helpers/onboarding";

/**
 * B-1 (gui-e2e-plan §4.1) — Jobs page UI E2E coverage.
 *
 * Pre-B-1 there is `jobs-flow.spec.ts` covering the API surface
 * (lifecycle / cancel / delete) plus a unit suite at
 * `JobsPage.test.tsx`, but no E2E walks through the Jobs page UI:
 * list click → detail panel, status / type filters, Export dialog,
 * Delete dialog, and the running-job Cancel confirm dialog.
 *
 * Each test below seeds the backend independently and asserts the
 * smallest UI mapping that, if regressed, would silently break the
 * Jobs page. They are split rather than chained so a failure in one
 * area does not mask regressions elsewhere.
 */

const CSV_PATH = "/tmp/e2e_jobs_ui.csv";

test.describe("Jobs page UI (B-1)", () => {
  test.setTimeout(120_000);

  test.beforeAll(() => {
    createTestCsv(100, CSV_PATH);
  });

  test.afterAll(() => {
    if (fs.existsSync(CSV_PATH)) fs.unlinkSync(CSV_PATH);
  });

  test.beforeEach(async ({ request }) => {
    await request.post(`${API}/workspace/reset`);
    await deleteAllJobs(request);
  });

  test("list click renders the JobDetail panel for the picked job", async ({
    page,
    request,
  }) => {
    const jobId = await setupAndFit(request, CSV_PATH);
    await waitForJobDone(request, jobId);

    await dismissOnboarding(page);
    await page.goto("/jobs");
    await page.waitForLoadState("networkidle");

    // Jobs are sorted newest-first; this completed fit lands at #1
    // (the only job in the freshly cleaned list). The auto-select
    // in JobsPage already picks it, so the heading should resolve.
    const heading = page.getByRole("heading", { name: /^Fit\s*#1\b/ });
    await expect(heading).toBeVisible({ timeout: 15_000 });

    // The Config accordion is part of every JobDetail render — a
    // regression in JobDetail mounting would surface as missing.
    await expect(
      page.getByRole("button", { name: "Config" }),
    ).toBeVisible();

    // Smoke-check the right-panel switches when the user clicks the
    // job button explicitly. With only one job the click is a no-op,
    // but we still drive it so a regression in onSelectJob wiring
    // (e.g. handler stripped from JobList) would fail before reaching
    // a multi-job scenario.
    const jobButton = page.getByRole("button", { name: /^✓ #1\b/ });
    await expect(jobButton).toBeVisible();
    await jobButton.click();
    await expect(heading).toBeVisible();
  });

  test("status + type filters narrow the visible list", async ({
    page,
    request,
  }) => {
    // Seed a single completed fit. With no failed/running siblings,
    // selecting "Fail" must collapse the list to the empty-state
    // copy, and selecting "Tune" type filter must do the same — both
    // assertions prove the filter wiring (JobList.tsx:103) actually
    // affects the rendered set.
    const jobId = await setupAndFit(request, CSV_PATH);
    await waitForJobDone(request, jobId);

    await dismissOnboarding(page);
    await page.goto("/jobs");
    await page.waitForLoadState("networkidle");

    const fitButton = page.getByRole("button", { name: /^✓ #1\b/ });
    await expect(fitButton).toBeVisible({ timeout: 15_000 });

    // Click "Fail" status filter → no jobs remain visible.
    await page.getByRole("button", { name: "Fail", exact: true }).click();
    await expect(fitButton).toHaveCount(0);
    await expect(
      page.getByText("No jobs match the current filters."),
    ).toBeVisible();

    // Reset to "All" → the fit reappears.
    await page.getByRole("button", { name: "All", exact: true }).click();
    await expect(fitButton).toBeVisible();

    // Type filter: switch to "Tune" → list collapses again because
    // our seed is a fit. The filter Select uses aria-label="Job type
    // filter" (JobList.tsx:137).
    await page
      .getByRole("combobox", { name: "Job type filter" })
      .click();
    await page.getByRole("option", { name: "Tune" }).click();
    await expect(fitButton).toHaveCount(0);

    // Reset to All Types → fit reappears.
    await page
      .getByRole("combobox", { name: "Job type filter" })
      .click();
    await page.getByRole("option", { name: "All Types" }).click();
    await expect(fitButton).toBeVisible();
  });

  test("Export and Delete buttons open their respective dialogs", async ({
    page,
    request,
  }) => {
    const jobId = await setupAndFit(request, CSV_PATH);
    await waitForJobDone(request, jobId);

    await dismissOnboarding(page);
    await page.goto("/jobs");
    await page.waitForLoadState("networkidle");

    await expect(
      page.getByRole("heading", { name: /^Fit\s*#1\b/ }),
    ).toBeVisible({ timeout: 15_000 });

    // Export → ExportDialog with title "Export Job #1"
    // (ExportDialog.tsx:64).
    await page.getByRole("button", { name: "Export", exact: true }).click();
    const exportDialog = page.getByRole("dialog");
    await expect(exportDialog).toBeVisible({ timeout: 5_000 });
    await expect(
      exportDialog.getByText("Export Job #1", { exact: true }),
    ).toBeVisible();
    // Default export type is "model" — the Format SegmentButton
    // surfaces a "Model" / "Report" pair (ExportDialog.tsx:71). The
    // active button gets variant=default so toBeVisible is the
    // smallest non-ambiguous mount check.
    await expect(
      exportDialog.getByRole("button", { name: "Model", exact: true }),
    ).toBeVisible();
    await expect(
      exportDialog.getByRole("button", { name: "Report", exact: true }),
    ).toBeVisible();
    // Close via Escape so the next dialog can open cleanly. The
    // standard Dialog onOpenChange(false) handler is wired to ESC.
    await page.keyboard.press("Escape");
    await expect(exportDialog).not.toBeVisible();

    // Delete → DeleteDialog with title "Delete Job #1?"
    // (DeleteDialog.tsx:77). The dialog must offer an explicit
    // confirm before destructive action — clicking Cancel must
    // dismiss without firing the DELETE.
    await page.getByRole("button", { name: "Delete", exact: true }).click();
    const deleteDialog = page.getByRole("dialog");
    await expect(deleteDialog).toBeVisible({ timeout: 5_000 });
    await expect(
      deleteDialog.getByText("Delete Job #1?", { exact: true }),
    ).toBeVisible();

    // INV: Cancel keeps the job. Watch the network — no DELETE
    // request must fire while the dialog is dismissed via Cancel.
    let deleteRequested = false;
    page.on("request", (req) => {
      if (
        req.method() === "DELETE" &&
        req.url().includes(`/api/jobs/${jobId}`)
      ) {
        deleteRequested = true;
      }
    });
    await deleteDialog.getByRole("button", { name: "Cancel" }).click();
    await expect(deleteDialog).not.toBeVisible();
    expect(deleteRequested).toBe(false);

    // Job must still be reachable.
    const stillThere = await request.get(`${API}/jobs/${jobId}`);
    expect(stillThere.status()).toBe(200);
  });

  test("Cancel button on a running job opens confirm dialog and cancels", async ({
    page,
    request,
  }) => {
    test.setTimeout(180_000);
    // Start a tune so we have a real running job to cancel. Tune is
    // long enough that the user can navigate to /jobs, click Cancel,
    // confirm, and observe the terminal status before the job would
    // have completed on its own.
    const loadRes = await request.post(`${API}/workspace/data/path`, {
      data: { path: CSV_PATH },
    });
    expect(loadRes.status()).toBe(200);

    const defaultsRes = await request.get(
      `${API}/workspace/config/defaults?task=binary&target=target`,
    );
    expect(defaultsRes.status()).toBe(200);
    const config = await defaultsRes.json();
    const putRes = await request.put(`${API}/workspace/config`, {
      data: config,
    });
    expect(putRes.status()).toBe(200);

    const tuneRes = await request.post(`${API}/workspace/tune`);
    expect(tuneRes.status()).toBe(200);
    const { job_id: jobId } = await tuneRes.json();
    expect(jobId).toBeTruthy();

    // Wait until the backend reports the job as running so the UI
    // sees the Cancel action button (visible when status==="running",
    // JobDetail.tsx:286).
    await expect
      .poll(
        async () => {
          const res = await request.get(`${API}/jobs/${jobId}`);
          if (res.status() !== 200) return null;
          return ((await res.json()) as { status: string }).status;
        },
        {
          timeout: 30_000,
          intervals: [50, 100, 200, 500],
          message: "tune job never transitioned to running",
        },
      )
      .toBe("running");

    await dismissOnboarding(page);
    await page.goto("/jobs");
    await page.waitForLoadState("networkidle");

    await expect(
      page.getByRole("heading", { name: /^Tune\s*#1\b/ }),
    ).toBeVisible({ timeout: 15_000 });

    // Cancel button → confirm dialog → "Yes, Cancel" fires the
    // POST /api/jobs/{id}/cancel request.
    const cancelButton = page.getByRole("button", {
      name: "Cancel",
      exact: true,
    });
    await expect(cancelButton).toBeVisible();
    await cancelButton.click();

    const confirmDialog = page.getByRole("dialog");
    await expect(confirmDialog).toBeVisible({ timeout: 5_000 });
    await expect(
      confirmDialog.getByText("Cancel job?", { exact: true }),
    ).toBeVisible();

    const cancelResponsePromise = page.waitForResponse(
      (res) =>
        res.url().endsWith(`/api/jobs/${jobId}/cancel`) &&
        res.request().method() === "POST",
      { timeout: 10_000 },
    );
    await confirmDialog
      .getByRole("button", { name: "Yes, Cancel" })
      .click();
    const cancelResponse = await cancelResponsePromise;
    expect(cancelResponse.status()).toBe(200);

    // Backend reaches a terminal status. Cancel may resolve as
    // cancelled, completed, or failed depending on race timing — any
    // terminal state proves the cancel request landed.
    await expect
      .poll(
        async () => {
          const res = await request.get(`${API}/jobs/${jobId}`);
          if (res.status() !== 200) return null;
          return ((await res.json()) as { status: string }).status;
        },
        {
          timeout: 60_000,
          intervals: [200, 500, 1000],
          message: "tune job never reached a terminal status after Cancel",
        },
      )
      .toMatch(/^(cancelled|completed|failed)$/);
  });

  /**
   * Issue #445 — Export dialog Format toggle drives the export_type
   * request payload (BLUEPRINT 4.3.4). The existing "Export and Delete
   * buttons open their respective dialogs" test stops at "dialog opens";
   * this one parametrises over the two formats and asserts (a) the
   * POST /export body carries the selected export_type and (b) the
   * dialog auto-dismisses on success.
   */
  for (const format of ["model", "report"] as const) {
    test(`Export dialog: Format=${format} drives export_type and dismisses on success`, async ({
      page,
      request,
    }) => {
      const jobId = await setupAndFit(request, CSV_PATH);
      await waitForJobDone(request, jobId);

      await dismissOnboarding(page);
      await page.goto("/jobs");
      await page.waitForLoadState("networkidle");
      await expect(
        page.getByRole("heading", { name: /^Fit\s*#1\b/ }),
      ).toBeVisible({ timeout: 15_000 });

      // Open the Export dialog from the JobDetail action row.
      await page.getByRole("button", { name: "Export", exact: true }).click();
      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible({ timeout: 5_000 });

      // Pick the format chip (re-selecting "Model" is harmless).
      await dialog
        .getByRole("button", {
          name: format === "model" ? "Model" : "Report",
          exact: true,
        })
        .click();

      // The confirm button inside the dialog is also labelled "Export"
      // (ExportDialog.tsx) — scope to the dialog to disambiguate from
      // the JobDetail "Export" button that opened it.
      const exportReqPromise = page.waitForRequest(
        (req) =>
          req.url().includes(`/api/jobs/${jobId}/export`) &&
          req.method() === "POST",
        { timeout: 15_000 },
      );
      await dialog.getByRole("button", { name: "Export", exact: true }).click();
      const exportReq = await exportReqPromise;
      expect(
        (exportReq.postDataJSON() as { export_type: string }).export_type,
      ).toBe(format);

      // export_model / export_report create the parent dir, so the
      // export succeeds and ExportDialog calls onOpenChange(false).
      await expect(dialog).not.toBeVisible({ timeout: 20_000 });
    });
  }

  /**
   * Issue #442 — UI Pause / Resume buttons on the Jobs detail panel
   * (v3-20f). tune-resume.spec.ts covers the HTTP contract; this walks
   * the actual PauseActionButton / UnpauseActionButton (labels "Pause" /
   * "Resume") through a real browser -> backend round-trip.
   *
   * @ci-flaky — depends on a long-running tune subprocess being in
   * "running" when the pause request lands; CI runners occasionally
   * SIGTERM the subprocess mid-tune (see session-restore.spec.ts).
   */
  test("Pause / Resume buttons drive backend state transitions through the UI @ci-flaky", async ({
    page,
    request,
  }) => {
    test.setTimeout(180_000);

    // Start a small tune via API (n_trials=4 keeps it under budget while
    // still being "running" when /pause lands).
    expect(
      (
        await request.post(`${API}/workspace/data/path`, {
          data: { path: CSV_PATH },
        })
      ).status(),
    ).toBe(200);
    const defaultsRes = await request.get(
      `${API}/workspace/config/defaults?task=binary&target=target`,
    );
    expect(defaultsRes.status()).toBe(200);
    const config = {
      ...(await defaultsRes.json()),
      tuning: {
        optuna: {
          params: { n_trials: 4, timeout: null },
          space: {
            learning_rate: { type: "float", low: 0.001, high: 0.3, log: true },
          },
        },
      },
    };
    expect(
      (await request.put(`${API}/workspace/config`, { data: config })).status(),
    ).toBe(200);
    const tuneRes = await request.post(`${API}/workspace/tune`);
    expect(tuneRes.status()).toBe(200);
    const jobId = (await tuneRes.json()).job_id as string;

    const pollStatus = async (): Promise<string | null> => {
      const res = await request.get(`${API}/jobs/${jobId}`);
      return res.status() === 200
        ? ((await res.json()) as { status: string }).status
        : null;
    };

    // Wait until the worker has claimed the slot (a /pause before
    // status="running" would 400).
    await expect
      .poll(pollStatus, { timeout: 30_000, intervals: [200, 250] })
      .toBe("running");

    await dismissOnboarding(page);
    await page.goto("/jobs");
    await page.waitForLoadState("networkidle");
    await page
      .getByRole("button", { name: /#1\b/ })
      .first()
      .click();
    await expect(
      page.getByRole("heading", { name: /^Tune\s*#1\b/ }),
    ).toBeVisible({ timeout: 15_000 });

    // Pause via the UI button -> backend status becomes paused.
    const pauseRespPromise = page.waitForResponse(
      (res) =>
        res.url().endsWith(`/api/jobs/${jobId}/pause`) &&
        res.request().method() === "POST",
      { timeout: 15_000 },
    );
    await page.getByRole("button", { name: /^Pause/ }).click();
    expect((await pauseRespPromise).status()).toBe(200);
    await expect
      .poll(pollStatus, { timeout: 30_000, intervals: [250, 500] })
      .toBe("paused");

    // Resume via the UI button -> backend status returns to running.
    const unpauseRespPromise = page.waitForResponse(
      (res) =>
        res.url().endsWith(`/api/jobs/${jobId}/unpause`) &&
        res.request().method() === "POST",
      { timeout: 15_000 },
    );
    await page.getByRole("button", { name: /^Resume/ }).click();
    expect((await unpauseRespPromise).status()).toBe(200);
    await expect
      .poll(pollStatus, { timeout: 30_000, intervals: [250, 500] })
      // "running" again, or it may have already finished the 4 trials.
      .toMatch(/^(running|completed)$/);

    // Best-effort cleanup.
    await request.post(`${API}/jobs/${jobId}/cancel`);
  });
});
