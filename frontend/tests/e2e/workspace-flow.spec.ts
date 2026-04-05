import { expect, test } from "@playwright/test";
import * as fs from "node:fs";
import * as path from "node:path";
import { dismissOnboarding } from "./helpers/onboarding";

const API = "http://localhost:8501/api";

// Create a test CSV in /tmp
function createTestCsv(): string {
  const csvPath = "/tmp/e2e_test_data.csv";
  const rows = ["id,age,gender,target"];
  for (let i = 0; i < 100; i++) {
    rows.push(`${i},${20 + (i % 50)},${i % 2 === 0 ? "M" : "F"},${i % 2}`);
  }
  fs.writeFileSync(csvPath, rows.join("\n"));
  return csvPath;
}

test.describe("Workspace core flow", () => {
  test.beforeEach(async ({ request }) => {
    await request.post(`${API}/workspace/reset`);
  });

  test("API: load data → columns → config defaults → validate", async ({
    request,
  }) => {
    const csvPath = createTestCsv();

    // 1. Load data
    const loadRes = await request.post(`${API}/workspace/data/path`, {
      data: { path: csvPath },
    });
    expect(loadRes.status()).toBe(200);
    const loadBody = await loadRes.json();
    expect(loadBody.data_ref.shape).toEqual([100, 4]);

    // 2. Get columns with target
    const colsRes = await request.get(
      `${API}/workspace/data/columns?target=target`,
    );
    expect(colsRes.status()).toBe(200);
    const colsBody = await colsRes.json();
    expect(colsBody.columns.length).toBeGreaterThanOrEqual(3);
    expect(colsBody.suggested_task).toBe("binary");

    // 3. Get default config
    const defaultsRes = await request.get(
      `${API}/workspace/config/defaults?task=binary&target=target`,
    );
    expect(defaultsRes.status()).toBe(200);
    const defaults = await defaultsRes.json();
    expect(defaults.task).toBe("binary");
    expect(defaults.data.target).toBe("target");

    // 4. Save config
    const putRes = await request.put(`${API}/workspace/config`, {
      data: defaults,
    });
    expect(putRes.status()).toBe(200);
    expect((await putRes.json()).saved).toBe(true);

    // 5. Validate config
    const valRes = await request.post(`${API}/workspace/config/validate`, {
      data: defaults,
    });
    expect(valRes.status()).toBe(200);
    expect((await valRes.json()).valid).toBe(true);

    // 6. Check workspace status
    const statusRes = await request.get(`${API}/workspace/status`);
    expect(statusRes.status()).toBe(200);
    const status = await statusRes.json();
    expect(status.has_data).toBe(true);
    expect(status.has_config).toBe(true);
  });

  test("UI: 3-panel layout renders with Data/Model/Results", async ({
    page,
  }) => {
    await dismissOnboarding(page);
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Sidebar
    await expect(page.getByText("LizyStudio").first()).toBeVisible();
    await expect(page.getByRole("link", { name: "Workspace" })).toBeVisible();

    // Data Panel sections
    await expect(page.getByText("Data Source")).toBeVisible();

    // Model Panel tabs
    await expect(page.getByRole("tab", { name: "Fit" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Tune" })).toBeVisible();

    // Results Panel placeholder
    await expect(
      page.getByRole("heading", { name: "Results" }),
    ).toBeVisible();

    await expect(page).toHaveScreenshot("workspace-layout.png");
  });

  test("UI: navigate between pages", async ({ page }) => {
    await dismissOnboarding(page);
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Navigate to Jobs
    await page.getByRole("link", { name: "Jobs" }).click();
    await expect(page).toHaveURL(/\/jobs/);

    // Navigate to Inference
    await page.getByRole("link", { name: "Inference" }).click();
    await expect(page).toHaveURL(/\/inference/);

    // Navigate back to Workspace
    await page.getByRole("link", { name: "Workspace" }).click();
    await expect(page).toHaveURL(/\/$/);
  });
});
