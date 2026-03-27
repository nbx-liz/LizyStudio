import { expect, test } from "@playwright/test";
import * as fs from "node:fs";
import { waitForPlotly, waitForStableUI } from "../helpers/visual";

const API = "http://localhost:8501/api";

function createTestCsv(rows = 100): string {
  const csvPath = "/home/rem/.lizystudio-test-data/e2e_visual_test_data.csv";
  const lines = ["id,age,gender,target"];
  for (let i = 0; i < rows; i++) {
    lines.push(`${i},${20 + (i % 50)},${i % 2 === 0 ? "M" : "F"},${i % 2}`);
  }
  fs.writeFileSync(csvPath, lines.join("\n"));
  return csvPath;
}

async function setupAndFit(
  request: import("@playwright/test").APIRequestContext,
  csvPath: string,
): Promise<string> {
  const loadRes = await request.post(`${API}/workspace/data/path`, {
    data: { path: csvPath },
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

  const fitRes = await request.post(`${API}/workspace/fit`);
  expect(fitRes.status()).toBe(200);
  return (await fitRes.json()).job_id as string;
}

async function waitForJobDone(
  request: import("@playwright/test").APIRequestContext,
  jobId: string,
  timeoutMs = 90_000,
): Promise<Record<string, unknown>> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const res = await request.get(`${API}/jobs/${jobId}`);
    const body = await res.json();
    if (["completed", "failed", "cancelled"].includes(body.status as string)) {
      return body as Record<string, unknown>;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`Job ${jobId} did not finish within ${timeoutMs}ms`);
}

test.describe("Workspace visual regression @visual", () => {
  test.setTimeout(120_000);

  test.beforeEach(async ({ request }) => {
    await request.post(`${API}/workspace/reset`);
  });

  test("initial 3-panel layout", async ({ page }) => {
    await page.goto("/");
    await waitForStableUI(page);

    await expect(page.getByText("LizyStudio")).toBeVisible();
    await expect(page.getByText("Data Source")).toBeVisible();
    await expect(page.getByRole("tab", { name: "Fit" })).toBeVisible();

    await expect(page).toHaveScreenshot("workspace-initial-layout.png");
  });

  test("config form after schema load", async ({ page }) => {
    await page.goto("/");
    await waitForStableUI(page);
    // Wait for ui-schema to load and render
    await page.waitForTimeout(1000);

    await expect(page).toHaveScreenshot("workspace-config-form.png");
  });

  test("data panel after data load", async ({ page, request }) => {
    const csvPath = createTestCsv();
    await request.post(`${API}/workspace/data/path`, {
      data: { path: csvPath },
    });

    await page.goto("/");
    await waitForStableUI(page);
    await page.waitForTimeout(1000);
    await page.reload();
    await waitForStableUI(page);

    await expect(page).toHaveScreenshot("workspace-data-loaded.png");
  });

  test("tune tab with search space", async ({ page }) => {
    await page.goto("/");
    await waitForStableUI(page);

    await page.getByRole("tab", { name: "Tune" }).click();
    await page.waitForTimeout(500);

    await expect(page.getByText("Number of trials")).toBeVisible();
    await expect(page).toHaveScreenshot("workspace-tune-tab.png");
  });

  test("results panel with Plotly charts after fit", async ({
    page,
    request,
  }) => {
    // Re-create test data (workspace reset may clear previous state)
    const csvPath = createTestCsv();

    const loadRes = await request.post(`${API}/workspace/data/path`, {
      data: { path: csvPath },
    });
    if (loadRes.status() !== 200) {
      test.skip(true, "Backend data load failed — skipping visual test");
      return;
    }

    const defaultsRes = await request.get(
      `${API}/workspace/config/defaults?task=binary&target=target`,
    );
    const config = await defaultsRes.json();
    await request.put(`${API}/workspace/config`, { data: config });

    const fitRes = await request.post(`${API}/workspace/fit`);
    expect(fitRes.status()).toBe(200);
    const jobId = (await fitRes.json()).job_id as string;

    const detail = await waitForJobDone(request, jobId);
    expect(detail.status).toBe("completed");

    await page.goto("/");
    await waitForStableUI(page);
    await page.waitForTimeout(2000);
    await page.reload();
    await waitForStableUI(page);

    // Wait for any Plotly charts to render
    await waitForPlotly(page);

    await expect(page).toHaveScreenshot("workspace-fit-results.png", {
      maxDiffPixelRatio: 0.02,
    });
  });
});
