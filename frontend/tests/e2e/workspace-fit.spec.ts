import { expect, test } from "@playwright/test";
import * as fs from "node:fs";
import {
  isMobileProject,
  openWorkspaceSectionIfMobile,
} from "./helpers/mobile";
import { dismissOnboarding } from "./helpers/onboarding";

const API = "http://localhost:8501/api";

/**
 * Create a synthetic CSV with 100 rows for binary classification.
 * Includes numeric + categorical features and a binary target column.
 */
function createTestCsv(): string {
  const csvPath = "/tmp/e2e_fit_test.csv";
  const rows = ["id,age,income,gender,target"];
  for (let i = 0; i < 100; i++) {
    rows.push(
      `${i},${20 + (i % 50)},${30000 + i * 100},${i % 2 === 0 ? "M" : "F"},${i % 2}`,
    );
  }
  fs.writeFileSync(csvPath, rows.join("\n"));
  return csvPath;
}

test.describe("Workspace Fit Flow", () => {
  test.beforeEach(async ({ request }) => {
    await request.post(`${API}/workspace/reset`);
  });

  test("API: Load data, set config, run fit, verify results", async ({
    request,
  }) => {
    // Fit jobs can take a while depending on data size and model
    test.setTimeout(120_000);

    const csvPath = createTestCsv();

    // 1. Load data via path
    const loadRes = await request.post(`${API}/workspace/data/path`, {
      data: { path: csvPath },
    });
    expect(loadRes.status()).toBe(200);
    const loadBody = await loadRes.json();
    expect(loadBody.data_ref.shape).toEqual([100, 5]);

    // 2. Get columns and verify auto-detection
    const colsRes = await request.get(
      `${API}/workspace/data/columns?target=target`,
    );
    expect(colsRes.status()).toBe(200);
    const cols = await colsRes.json();
    expect(cols.suggested_task).toBe("binary");
    // Target column should be excluded from returned columns
    const colNames = cols.columns.map((c: { name: string }) => c.name);
    expect(colNames).not.toContain("target");
    expect(colNames).toContain("age");

    // 3. Get default config for binary classification
    const defaultsRes = await request.get(
      `${API}/workspace/config/defaults?task=binary&target=target`,
    );
    expect(defaultsRes.status()).toBe(200);
    const defaults = await defaultsRes.json();
    expect(defaults.task).toBe("binary");
    expect(defaults.data.target).toBe("target");

    // 4. Validate config before saving
    const valRes = await request.post(`${API}/workspace/config/validate`, {
      data: defaults,
    });
    expect(valRes.status()).toBe(200);
    expect((await valRes.json()).valid).toBe(true);

    // 5. Save config
    const putRes = await request.put(`${API}/workspace/config`, {
      data: defaults,
    });
    expect(putRes.status()).toBe(200);
    expect((await putRes.json()).saved).toBe(true);

    // 6. Verify workspace status is ready for fit
    const statusRes = await request.get(`${API}/workspace/status`);
    expect(statusRes.status()).toBe(200);
    const status = await statusRes.json();
    expect(status.has_data).toBe(true);
    expect(status.has_config).toBe(true);

    // 7. Run fit
    const fitRes = await request.post(`${API}/workspace/fit`);
    expect(fitRes.status()).toBe(200);
    const { job_id } = await fitRes.json();
    expect(job_id).toBeTruthy();

    // 8. Poll for completion (max 60s, polling every 2s)
    let job: Record<string, unknown> = {};
    for (let i = 0; i < 30; i++) {
      const jobRes = await request.get(`${API}/jobs/${job_id}`);
      expect(jobRes.status()).toBe(200);
      job = (await jobRes.json()) as Record<string, unknown>;
      if (job.status === "completed" || job.status === "failed") break;
      await new Promise((r) => setTimeout(r, 2000));
    }
    expect(job.status).toBe("completed");

    // 9. Verify fit_result is present with expected structure
    const fitResult = job.fit_result as Record<string, unknown>;
    expect(fitResult).toBeTruthy();
    expect(fitResult.fold_count).toBeGreaterThan(0);
    expect(fitResult.metrics).toBeTruthy();

    // 10. Verify metrics endpoint
    const metricsRes = await request.get(`${API}/jobs/${job_id}/metrics`);
    expect(metricsRes.status()).toBe(200);
    const metrics = await metricsRes.json();
    expect(Array.isArray(metrics)).toBe(true);

    // 11. Verify available plots
    const plotsRes = await request.get(`${API}/jobs/${job_id}/plots`);
    expect(plotsRes.status()).toBe(200);
    const plots = await plotsRes.json();
    expect(Array.isArray(plots)).toBe(true);
    expect(plots.length).toBeGreaterThan(0);

    // 12. Fetch one plot and verify it returns plotly JSON
    if (plots.length > 0) {
      const firstPlot = plots[0] as string;
      const plotRes = await request.get(
        `${API}/jobs/${job_id}/plot/${firstPlot}`,
      );
      expect(plotRes.status()).toBe(200);
      const plotData = await plotRes.json();
      expect(plotData.plotly_json).toBeTruthy();
    }

    // 13. Verify split summary
    const splitRes = await request.get(`${API}/jobs/${job_id}/split-summary`);
    expect(splitRes.status()).toBe(200);
    const splits = await splitRes.json();
    expect(Array.isArray(splits)).toBe(true);
    expect(splits.length).toBeGreaterThan(0);

    // 14. Verify feature importance
    const importanceRes = await request.get(
      `${API}/jobs/${job_id}/importance`,
    );
    expect(importanceRes.status()).toBe(200);
    const importance = await importanceRes.json();
    expect(typeof importance).toBe("object");

    // 15. Verify job config endpoint returns saved config
    const jobConfigRes = await request.get(`${API}/jobs/${job_id}/config`);
    expect(jobConfigRes.status()).toBe(200);
    const jobConfig = await jobConfigRes.json();
    expect(jobConfig.task).toBe("binary");

    // 16. Verify job appears in job list
    const listRes = await request.get(`${API}/jobs`);
    expect(listRes.status()).toBe(200);
    const jobList = await listRes.json();
    const found = jobList.find(
      (j: Record<string, unknown>) => j.job_id === job_id,
    );
    expect(found).toBeTruthy();
    expect(found.status).toBe("completed");
  });

  test("API: Fit fails without data loaded", async ({ request }) => {
    // Try to run fit without loading data
    const fitRes = await request.post(`${API}/workspace/fit`);
    // Should fail — either 400 or 422
    expect(fitRes.status()).toBeGreaterThanOrEqual(400);
  });

  test("API: Fit fails without config saved", async ({ request }) => {
    const csvPath = createTestCsv();

    // Load data but do not save config
    await request.post(`${API}/workspace/data/path`, {
      data: { path: csvPath },
    });

    const fitRes = await request.post(`${API}/workspace/fit`);
    expect(fitRes.status()).toBeGreaterThanOrEqual(400);
  });

  test("UI: Workspace page loads with 3-panel layout and Fit tab", async ({
    page,
  }, testInfo) => {
    // Issue #178: the 3-panel ResizablePanelGroup does not exist on
    // mobile — the Workspace renders a bottom-tab navigation instead.
    // Mobile-equivalent coverage lives in the `workspace-ui-improvements`
    // suite where each panel is verified individually.
    test.skip(
      isMobileProject(testInfo),
      "3-panel layout is desktop/tablet only (Issue #178)",
    );

    await dismissOnboarding(page);
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Sidebar branding
    await expect(page.getByText("LizyStudio").first()).toBeVisible();
    await expect(page.getByRole("link", { name: "Workspace" })).toBeVisible();

    // Data panel
    await expect(page.getByText("Data Source")).toBeVisible();

    // Model panel with Fit/Tune tabs
    await expect(page.getByRole("tab", { name: "Fit" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Tune" })).toBeVisible();

    // Results panel
    await expect(
      page.getByRole("heading", { name: "Results" }),
    ).toBeVisible();

    // Verify 3 resizable panels exist
    const panels = page.locator('[data-slot="resizable-panel"]');
    await expect(panels).toHaveCount(3);

    await expect(page).toHaveScreenshot("fit-workspace-layout.png");
  });

  test("UI: Fit tab is active by default and shows config form", async ({
    page,
  }, testInfo) => {
    await dismissOnboarding(page);
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await openWorkspaceSectionIfMobile(page, testInfo, "model");

    // Fit tab should be selected/active by default
    const fitTab = page.getByRole("tab", { name: "Fit" });
    await expect(fitTab).toBeVisible();
    await expect(fitTab).toHaveAttribute("aria-selected", "true");

    // Wait for schema to load
    await page.waitForTimeout(1000);

    await expect(page).toHaveScreenshot("fit-tab-config.png");
  });

  test("UI: Data load via Path button populates data panel", async ({
    page,
    request,
  }) => {
    const csvPath = createTestCsv();

    // Pre-load data via API for consistency
    await request.post(`${API}/workspace/data/path`, {
      data: { path: csvPath },
    });

    await dismissOnboarding(page);
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(1000);

    // Reload to pick up server-side data state
    await page.reload();
    await page.waitForLoadState("networkidle");

    await expect(page).toHaveScreenshot("fit-data-loaded.png");
  });

  /**
   * Issue #257 / #258 / #259 — UI-driven Fit happy path.
   *
   * Before this spec, the E2E suite exercised Fit only through
   * ``request.post``. The real frontend path — where
   * ``buildSyncedConfig`` assembles a payload on top of backend defaults
   * — was never run in CI, so drift between the UI schema helper and
   * the lizyml Pydantic model (#258) could only be caught by live
   * browser testing. This spec drives the minimal UI flow and fails if
   * ``POST /api/workspace/fit`` comes back with anything other than 200.
   */
  test("UI: load data -> pick target -> click Fit -> fit returns 200", async ({
    page,
    request,
  }, testInfo) => {
    // 120s was too tight on slow CI (15s schema load + 15s combo enable +
    // 30s fit accept + 90s poll) — 180s matches the existing API-only
    // ``run fit, verify results`` spec.
    test.setTimeout(180_000);
    if (isMobileProject(testInfo)) {
      // The mobile layout hides the Fit button behind the tab nav;
      // covered separately by ui-improvements specs.
      test.skip(true, "Mobile layout path is covered elsewhere");
    }

    const csvPath = createTestCsv();

    await dismissOnboarding(page);
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await openWorkspaceSectionIfMobile(page, testInfo, "data");

    // Use the UI Path flow (more faithful to user behaviour than
    // pre-seeding via API). The Data Source segment defaults to
    // Upload; switch to Path, type the CSV path, and click Load.
    await page.getByRole("radio", { name: "Path" }).click();
    const pathInput = page.getByPlaceholder("/path/to/data.csv");
    await pathInput.fill(csvPath);
    await page.getByRole("button", { name: "Load" }).click();
    await expect(
      page.getByText(/100 rows × \d+ columns/),
    ).toBeVisible({ timeout: 15_000 });

    // Pick the target column so the UI can assemble a complete config.
    const targetCombo = page.getByRole("combobox", {
      name: /target column/i,
    });
    await expect(targetCombo).toBeEnabled({ timeout: 15_000 });
    await targetCombo.click();
    await page.getByRole("option", { name: "target" }).click();

    await openWorkspaceSectionIfMobile(page, testInfo, "model");

    // The Fit button enables once target is set and config is synced.
    const fitButton = page.getByRole("button", { name: "Fit", exact: true });
    await expect(fitButton).toBeEnabled({ timeout: 15_000 });

    // Arm the response listener *before* clicking so we capture the
    // POST /workspace/fit round trip the click triggers.
    const fitResponsePromise = page.waitForResponse(
      (res) =>
        res.url().endsWith("/api/workspace/fit") && res.request().method() === "POST",
      { timeout: 30_000 },
    );

    await fitButton.click();

    const fitResponse = await fitResponsePromise;
    expect(
      fitResponse.status(),
      `POST /workspace/fit must succeed for default UI flow (got ${fitResponse.status()}). ` +
        `Body: ${await fitResponse.text()}`,
    ).toBe(200);
    const fitBody = await fitResponse.json();
    expect(fitBody.job_id).toBeTruthy();

    // Poll until the job completes so the regression net covers the
    // full lifecycle, not just the accept-on-submit moment.
    let status = "";
    for (let i = 0; i < 45; i++) {
      const jobRes = await request.get(`${API}/jobs/${fitBody.job_id}`);
      expect(jobRes.status()).toBe(200);
      const job = await jobRes.json();
      status = job.status;
      if (status === "completed" || status === "failed") break;
      await page.waitForTimeout(2000);
    }
    expect(status).toBe("completed");
  });
});
