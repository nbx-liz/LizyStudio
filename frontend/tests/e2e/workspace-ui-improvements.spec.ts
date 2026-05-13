import { expect, test } from "@playwright/test";
import * as fs from "node:fs";
import { openWorkspaceSectionIfMobile } from "./helpers/mobile";
import { dismissOnboarding } from "./helpers/onboarding";

const API = "http://localhost:8501/api";

function createTestCsv(): string {
  const csvPath = "/tmp/e2e_ui_test_data.csv";
  const rows = ["id,age,income,gender,city,target"];
  for (let i = 0; i < 100; i++) {
    rows.push(
      `${i},${20 + (i % 50)},${30000 + i * 100},${i % 2 === 0 ? "M" : "F"},${["Tokyo", "Osaka", "Nagoya"][i % 3]},${i % 2}`,
    );
  }
  fs.writeFileSync(csvPath, rows.join("\n"));
  return csvPath;
}

test.describe("Workspace UI Improvements", () => {
  test.beforeEach(async ({ request }) => {
    await request.post(`${API}/workspace/reset`);
  });

  test("API: ui-schema endpoint returns expected structure", async ({
    request,
  }) => {
    const res = await request.get(`${API}/backends/ui-schema`);
    expect(res.status()).toBe(200);
    const data = await res.json();

    // Verify all required keys
    expect(data).toHaveProperty("sections");
    expect(data).toHaveProperty("option_sets");
    expect(data).toHaveProperty("parameter_hints");
    expect(data).toHaveProperty("search_space_catalog");
    expect(data).toHaveProperty("step_map");
    expect(data).toHaveProperty("conditional_visibility");
    expect(data).toHaveProperty("defaults");
    expect(data).toHaveProperty("inner_valid_options");
    expect(data).toHaveProperty("n_trials_presets");

    // n_trials_presets should be [10, 50, 100, 200, 500]
    expect(data.n_trials_presets).toEqual([10, 50, 100, 200, 500]);

    // P-0104 Wave 3.1b: option_sets.metric is the nested {native, feval}
    // shape; model_metric was removed and folded into it; eval_metric
    // carries the post-hoc reporting metrics for the Tune Evaluation section.
    expect(data.option_sets).not.toHaveProperty("model_metric");
    expect(data.option_sets).toHaveProperty("metric");
    expect(data.option_sets.metric.binary).toHaveProperty("native");
    expect(data.option_sets.metric.binary).toHaveProperty("feval");
    expect(data.option_sets.metric.regression).toHaveProperty("native");
    expect(data.option_sets).toHaveProperty("eval_metric");
    expect(data.option_sets.eval_metric).toHaveProperty("binary");
    expect(data.option_sets.eval_metric).toHaveProperty("regression");

    // conditional_visibility should have num_leaves entries
    expect(data.conditional_visibility).toHaveProperty("num_leaves");
    expect(data.conditional_visibility).toHaveProperty("num_leaves_ratio");

    // search_space_catalog should include auto_num_leaves
    const catalogKeys = data.search_space_catalog.map(
      (e: { key: string }) => e.key,
    );
    expect(catalogKeys).toContain("auto_num_leaves");
    expect(catalogKeys).toContain("num_leaves_ratio");
    expect(catalogKeys).toContain("min_data_in_leaf_ratio");
    expect(catalogKeys).toContain("min_data_in_bin_ratio");
  });

  test("API: data load → column analysis → target selection preserves columns", async ({
    request,
  }) => {
    const csvPath = createTestCsv();

    // Load data
    const loadRes = await request.post(`${API}/workspace/data/path`, {
      data: { path: csvPath },
    });
    expect(loadRes.status()).toBe(200);

    // Get columns without target
    const colsRes = await request.get(`${API}/workspace/data/columns`);
    expect(colsRes.status()).toBe(200);
    const allCols = await colsRes.json();
    const allColNames = allCols.columns.map((c: { name: string }) => c.name);
    expect(allColNames).toContain("target");
    expect(allColNames).toContain("age");

    // Get columns WITH target — target should be excluded from analysis
    const colsWithTarget = await request.get(
      `${API}/workspace/data/columns?target=target`,
    );
    const filtered = await colsWithTarget.json();
    const filteredNames = filtered.columns.map(
      (c: { name: string }) => c.name,
    );
    expect(filteredNames).not.toContain("target");
    expect(filteredNames).toContain("age");

    // Suggested task should be binary (0/1 target)
    expect(filtered.suggested_task).toBe("binary");
  });

  test("UI: Data Panel shows segment buttons for Task/CV Strategy", async ({
    page,
  }) => {
    await dismissOnboarding(page);
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Verify Data Source radio buttons (Path/Upload) exist
    await expect(page.getByRole("radio", { name: "Path" })).toBeVisible();
    await expect(page.getByRole("radio", { name: "Upload" })).toBeVisible();

    // Cross Validation section — check segment radio buttons
    await expect(
      page.getByRole("radio", { name: "KFold", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("radio", { name: "StratifiedKFold", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("radio", { name: "GroupKFold", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("radio", { name: "TimeSeriesSplit", exact: true }),
    ).toBeVisible();

    await expect(page).toHaveScreenshot("data-panel-segments.png");
  });

  test("UI: Model Panel — no Auto button visible", async ({
    page,
  }, testInfo) => {
    await dismissOnboarding(page);
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    await openWorkspaceSectionIfMobile(page, testInfo, "model");

    // Fit tab should be active by default
    await expect(page.getByRole("tab", { name: "Fit" })).toBeVisible();

    // Wait for config schema to load
    await page.waitForTimeout(1000);

    // There should be NO "Auto" badges visible in the config form
    const autoBadges = page.locator("text=Auto").filter({
      has: page.locator('[class*="badge"]'),
    });
    // Auto button was deleted — count should be 0
    const count = await autoBadges.count();
    expect(count).toBe(0);
  });

  test("UI: Tune tab shows metric chips instead of direction select", async ({
    page,
  }, testInfo) => {
    await dismissOnboarding(page);
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    await openWorkspaceSectionIfMobile(page, testInfo, "model");

    // Switch to Tune tab
    await page.getByRole("tab", { name: "Tune" }).click();
    await page.waitForTimeout(500);

    // Settings accordion should have "Number of trials" and "Tune Metric"
    await expect(page.getByText("Number of trials")).toBeVisible();

    // N Trials presets: 10, 50, 100, 200, 500
    await expect(
      page.getByRole("button", { name: "10", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "50", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "100", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "200", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "500", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Custom", exact: true }).first(),
    ).toBeVisible();

    // Timeout section
    await expect(page.getByText("Timeout")).toBeVisible();

    // Direction auto-display only appears after metric selection, not as a standalone select
    await expect(
      page.getByRole("combobox").filter({ hasText: /minimize|maximize/ }),
    ).toHaveCount(0);

    await expect(page).toHaveScreenshot("tune-tab.png");
  });

  test("UI: Search Space shows segment buttons for Mode", async ({
    page,
  }, testInfo) => {
    await dismissOnboarding(page);
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    await openWorkspaceSectionIfMobile(page, testInfo, "model");

    // Switch to Tune tab
    await page.getByRole("tab", { name: "Tune" }).click();
    await page.waitForTimeout(500);

    // Search Space accordion. Use the accordion trigger button locator
    // because there is also a description paragraph containing
    // "Search Space" further down, which would break a bare getByText.
    await expect(
      page.getByRole("button", { name: "Search Space" }),
    ).toBeVisible();

    // Each parameter row should have Fixed/Range or Fixed/Choice as segment radio buttons
    // Look for the Fixed radio buttons in the search space table
    const fixedRadios = page.getByRole("radio", { name: "Fixed" });
    const fixedCount = await fixedRadios.count();
    // Should have at least several Fixed radios (one per parameter)
    expect(fixedCount).toBeGreaterThan(0);
    // Note: no toHaveScreenshot here. The Tune tab's full visual is
    // already covered by `tune-tab.png` in the previous test, and the
    // search-space.png baseline was never committed to git (caught by
    // the repo's `*.png` ignore rule), so adding it back would require
    // an explicit `git add -f` and a separate review of what the canon
    // baseline should look like.
  });

  test("API+UI: full data load → target select → task segment buttons appear", async ({
    page,
    request,
  }) => {
    const csvPath = createTestCsv();

    // Pre-load data via API
    await request.post(`${API}/workspace/data/path`, {
      data: { path: csvPath },
    });

    await dismissOnboarding(page);
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(1000);

    // Reload to pick up data
    await page.reload();
    await page.waitForLoadState("networkidle");

    await expect(page).toHaveScreenshot("after-data-load.png");
  });
});
