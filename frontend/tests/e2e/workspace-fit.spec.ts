import { expect, test } from "@playwright/test";
import * as fs from "node:fs";
import {
  isMobileProject,
  openWorkspaceSectionIfMobile,
} from "./helpers/mobile";
import { dismissOnboarding } from "./helpers/onboarding";
import {
  pollJobUntilTerminal,
  seedUiWorkspace,
} from "./helpers/workspace-ui";

const API = "http://localhost:8501/api";

/**
 * Create a synthetic CSV with 100 rows for binary classification.
 * Includes numeric + categorical features and a binary target column.
 *
 * Kept local (vs. the shared helper) because the API-only specs at the
 * top of this file reuse the same file path to avoid a redundant write.
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
      test.skip(true, "Mobile layout path is covered elsewhere — see Issue #304");
    }

    const csvPath = createTestCsv();
    await seedUiWorkspace(page, testInfo, { csvPath });

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
    // full lifecycle, not just the accept-on-submit moment. Uses the
    // shared helper so ``cancelled`` short-circuits instead of burning
    // the full 90s budget before the final ``=== "completed"`` assert.
    const jobBody = await pollJobUntilTerminal(
      request,
      fitBody.job_id as string,
    );
    expect(jobBody.status).toBe("completed");
  });

  /**
   * Scenario B (Issue #257 Phase 2): the user edits the config via the
   * UI — toggling a ConfigForm control — and then clicks Fit. Before the
   * #253 fix this race would land an outdated config in the final PUT.
   * This spec catches that regression at the integration layer (the
   * Vitest unit only covers two-writes-in-same-tick at the hook level).
   *
   * Edit chosen: toggle the Calibration switch ON. It writes to a nested
   * path (``model.calibration``) that is distinct from the defaults-only
   * shape of Scenario A, so any drop-write regression surfaces as an
   * absent ``model.calibration`` object in the final PUT payload.
   */
  test("UI: toggle Calibration, click Fit, verify edit reached PUT /config", async ({
    page,
    request,
  }, testInfo) => {
    // Same 180s budget as Scenario A (15s schema load + 15s combo enable
    // + calibration PUT observe + 30s fit accept + 90s poll). Overrides
    // the 120s default in playwright.config.ts.
    test.setTimeout(180_000);
    if (isMobileProject(testInfo)) {
      test.skip(true, "Mobile layout path is covered elsewhere — see Issue #304");
    }

    const csvPath = createTestCsv();
    await seedUiWorkspace(page, testInfo, { csvPath });

    // Wait for the ConfigForm to finish seeding; the Calibration section
    // only appears once the model accordion is populated.
    const calibrationHeader = page.getByRole("button", {
      name: /Calibration/i,
    });
    await expect(calibrationHeader).toBeVisible({ timeout: 15_000 });

    // Calibration Switch is a sibling of the accordion trigger within
    // the same row. Located by its aria-label so the query survives
    // future layout tweaks around the header.
    const calibrationSwitch = page.getByRole("switch", { name: "Calibration" });
    await expect(calibrationSwitch).toBeVisible();

    // Arm the PUT listener BEFORE the click so the race is observable.
    // Calibration is written at top-level config.calibration, not under
    // model — see ConfigForm.tsx handleFieldChange(["calibration"], cal).
    const calibrationPutPromise = page.waitForRequest(
      (req) =>
        req.url().endsWith("/api/workspace/config") &&
        req.method() === "PUT" &&
        (() => {
          try {
            const body = req.postDataJSON() as { calibration?: unknown };
            return body?.calibration != null;
          } catch {
            return false;
          }
        })(),
      { timeout: 15_000 },
    );

    await calibrationSwitch.click();

    // Confirm the UI edit produced a PUT whose payload includes the new
    // calibration object (not a stale copy without it).
    const calibrationPut = await calibrationPutPromise;
    const putBody = calibrationPut.postDataJSON() as {
      calibration: Record<string, unknown>;
    };
    expect(putBody.calibration).not.toBeNull();
    expect(putBody.calibration.method).toBeTruthy();

    const fitButton = page.getByRole("button", { name: "Fit", exact: true });
    await expect(fitButton).toBeEnabled({ timeout: 15_000 });

    const fitResponsePromise = page.waitForResponse(
      (res) =>
        res.url().endsWith("/api/workspace/fit") &&
        res.request().method() === "POST",
      { timeout: 30_000 },
    );

    await fitButton.click();

    const fitResponse = await fitResponsePromise;
    expect(
      fitResponse.status(),
      `POST /workspace/fit must succeed after UI edit (got ${fitResponse.status()}). ` +
        `Body: ${await fitResponse.text()}`,
    ).toBe(200);
    const fitBody = await fitResponse.json();
    expect(fitBody.job_id).toBeTruthy();

    // Poll to completion so backend actually runs with the calibrated
    // config (any schema mismatch on the extra field surfaces here, not
    // only at accept-time). Shared helper breaks on any terminal state.
    const jobBody = await pollJobUntilTerminal(
      request,
      fitBody.job_id as string,
    );
    expect(jobBody.status).toBe("completed");
  });

  /**
   * Issue #265 — UI-driven Balanced switch lock.
   *
   * The Smart Params Balanced switch must propagate to ``model.balanced``
   * (the LGBMConfig top-level field consumed by lizyml). Before the fix
   * a duplicate parameter_hint rendered a second toggle in Advanced
   * Model Params that wrote to ``model.params.balanced`` — silently
   * dropped by lizyml. This spec locks the contract: only one Balanced
   * switch is rendered, and toggling it reaches ``model.balanced`` in
   * the next PUT body.
   */
  test("UI: toggle Balanced, verify model.balanced reaches PUT /config and only one toggle exists", async ({
    page,
  }, testInfo) => {
    test.setTimeout(60_000);
    if (isMobileProject(testInfo)) {
      test.skip(true, "Mobile layout path is covered elsewhere — see Issue #304");
    }

    const csvPath = createTestCsv();
    await seedUiWorkspace(page, testInfo, { csvPath });

    // Smart Params Balanced switch (role="switch") — distinct from any
    // CompactToggle in Advanced Model Params. Locating by accessible
    // name guarantees we hit the Switch primitive, not a sibling input.
    const balancedSwitch = page.getByRole("switch", { name: "Balanced" });
    await expect(balancedSwitch).toBeVisible({ timeout: 15_000 });

    // Issue #265 root cause: a parameter_hint named "balanced" rendered
    // a SECOND toggle in the Advanced section that wrote to the wrong
    // path. Open Advanced and assert there is exactly one Balanced
    // switch on the page.
    await page.getByTestId("toggle-advanced-params").click();
    const allBalanced = page.getByRole("switch", { name: "Balanced" });
    await expect(allBalanced).toHaveCount(1);

    // Arm a PUT listener that watches for ``model.balanced === true``.
    const balancedPutPromise = page.waitForRequest(
      (req) =>
        req.url().endsWith("/api/workspace/config") &&
        req.method() === "PUT" &&
        (() => {
          try {
            const body = req.postDataJSON() as {
              model?: { balanced?: unknown };
            };
            return body?.model?.balanced === true;
          } catch {
            return false;
          }
        })(),
      { timeout: 15_000 },
    );

    await balancedSwitch.click();
    const put = await balancedPutPromise;
    const putBody = put.postDataJSON() as {
      model: { balanced: unknown; params?: { balanced?: unknown } };
    };
    expect(putBody.model.balanced).toBe(true);
    // model.params.balanced must NOT be set — that path is silently
    // dropped by lizyml and is the wrong target.
    expect(putBody.model.params?.balanced).toBeUndefined();
  });
});
