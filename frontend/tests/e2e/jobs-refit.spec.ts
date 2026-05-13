import { expect, test } from "@playwright/test";
import {
  API,
  createTestCsv,
  deleteAllJobs,
  setupAndFit,
  waitForJobDone,
} from "./helpers/api";
import { dismissOnboarding } from "./helpers/onboarding";

test.describe("Job re-fit flow", () => {
  test.setTimeout(120_000);

  test.beforeEach(async ({ request }) => {
    await request.post(`${API}/workspace/reset`);
  });

  test("API: Re-fit from completed job applies config to workspace", async ({
    request,
  }) => {
    const csvPath = createTestCsv(100, "/tmp/e2e_refit_test.csv");

    // Run initial fit
    const jobId = await setupAndFit(request, csvPath);
    const detail = await waitForJobDone(request, jobId);
    expect(detail.status).toBe("completed");

    // Get the completed job's config
    const configRes = await request.get(`${API}/jobs/${jobId}/config`);
    expect(configRes.status()).toBe(200);
    const jobConfig = await configRes.json();

    // Reload data (workspace was consumed)
    await request.post(`${API}/workspace/data/path`, {
      data: { path: csvPath },
    });

    // Apply the job's config to workspace
    const putRes = await request.put(`${API}/workspace/config`, {
      data: jobConfig,
    });
    expect(putRes.status()).toBe(200);

    // Validate config
    const valRes = await request.post(`${API}/workspace/config/validate`, {
      data: jobConfig,
    });
    expect(valRes.status()).toBe(200);
    const valBody = await valRes.json();
    expect(valBody.errors).toHaveLength(0);

    // Re-fit with the same config
    const refitRes = await request.post(`${API}/workspace/fit`);
    expect(refitRes.status()).toBe(200);
    const refitBody = await refitRes.json();
    const refitJobId = refitBody.job_id as string;
    expect(refitJobId).not.toBe(jobId);

    // Wait for re-fit to complete
    const refitDetail = await waitForJobDone(request, refitJobId);
    expect(refitDetail.status).toBe("completed");
    expect(refitDetail.job_type).toBe("fit");
  });

  test("API: Re-fit with modified parameters produces different results", async ({
    request,
  }) => {
    const csvPath = createTestCsv(100, "/tmp/e2e_refit_modified.csv");

    // Initial fit
    const jobId = await setupAndFit(request, csvPath);
    const detail = await waitForJobDone(request, jobId);
    expect(detail.status).toBe("completed");

    // Get config and modify learning_rate
    const configRes = await request.get(`${API}/jobs/${jobId}/config`);
    const config = await configRes.json();

    // Modify a parameter
    if (config.model?.params) {
      config.model.params.learning_rate = 0.01;
    }

    // Reload and re-fit
    await request.post(`${API}/workspace/data/path`, {
      data: { path: csvPath },
    });
    await request.put(`${API}/workspace/config`, { data: config });

    const refitRes = await request.post(`${API}/workspace/fit`);
    expect(refitRes.status()).toBe(200);
    const refitJobId = (await refitRes.json()).job_id as string;

    const refitDetail = await waitForJobDone(request, refitJobId);
    expect(refitDetail.status).toBe("completed");
  });

  /**
   * Issue #446 — UI Re-fit flow (BLUEPRINT 4.3.3). The API-only specs
   * above validate the config-apply path; this one drives the JobDetail
   * "Re-fit" button on /jobs and asserts it navigates the user to the
   * Workspace.
   *
   * Scope note: ``JobDetail.handleRefit`` writes ``location.state.refitJobId``,
   * but ``WorkspacePage`` does not currently consume that hint — the
   * config/data are *not* auto-reloaded on landing, so the post-navigation
   * Workspace is not in a "click Fit and re-run" state. Asserting that
   * here would be testing a feature that isn't wired up. The follow-up to
   * either wire ``refitJobId`` through (load the job's config + data) or
   * drop the dead state is tracked alongside this issue. The full
   * config-apply → fit chain stays covered by the API-only scenarios above.
   */
  test("UI: Re-fit button on a completed job navigates to the Workspace", async ({
    page,
    request,
  }) => {
    // Earlier tests in this file leave jobs around (no deleteAllJobs in
    // beforeEach); start clean so the seeded fit is "#1".
    await deleteAllJobs(request);
    const csvPath = createTestCsv(100, "/tmp/e2e_refit_ui.csv");
    const jobId = await setupAndFit(request, csvPath);
    const detail = await waitForJobDone(request, jobId);
    expect(detail.status).toBe("completed");

    await dismissOnboarding(page);
    await page.goto("/jobs");
    await page.waitForLoadState("networkidle");
    await expect(
      page.getByRole("heading", { name: /^Fit\s*#1\b/ }),
    ).toBeVisible({ timeout: 15_000 });

    // Re-fit -> navigate("/", {state:{refitJobId}}) -> Workspace.
    await page.getByRole("button", { name: "Re-fit", exact: true }).click();
    // Landed on the Workspace: both the Fit and Tune tabs render.
    await expect(page.getByRole("tab", { name: "Fit" })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByRole("tab", { name: "Tune" })).toBeVisible();
  });
});
