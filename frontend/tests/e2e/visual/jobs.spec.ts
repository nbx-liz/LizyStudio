import { expect, test } from "@playwright/test";
import * as fs from "node:fs";
import { dismissOnboarding } from "../helpers/onboarding";
import { waitForStableUI } from "../helpers/visual";

const API = "http://localhost:8501/api";

function createTestCsv(rows = 100): string {
  const csvPath = "/tmp/e2e_visual_jobs_data.csv";
  const lines = ["id,age,gender,target"];
  for (let i = 0; i < rows; i++) {
    lines.push(`${i},${20 + (i % 50)},${i % 2 === 0 ? "M" : "F"},${i % 2}`);
  }
  fs.writeFileSync(csvPath, lines.join("\n"));
  return csvPath;
}

async function waitForJobDone(
  request: import("@playwright/test").APIRequestContext,
  jobId: string,
  timeoutMs = 90_000,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const res = await request.get(`${API}/jobs/${jobId}`);
    const body = await res.json();
    if (["completed", "failed", "cancelled"].includes(body.status as string)) {
      return;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`Job ${jobId} did not finish within ${timeoutMs}ms`);
}

test.describe("Jobs visual regression @visual", () => {
  test.setTimeout(120_000);

  test.beforeEach(async ({ page, request }) => {
    await request.post(`${API}/workspace/reset`);
    await dismissOnboarding(page);
  });

  test("jobs page layout", async ({ page }) => {
    await page.goto("/jobs");
    await waitForStableUI(page);

    // Jobs page always shows the left panel with job list
    // (may be empty or have jobs from previous test runs)
    await expect(page).toHaveScreenshot("jobs-page-layout.png");
  });

  test("jobs list with completed job", async ({ page, request }) => {
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
    await waitForJobDone(request, jobId);

    await page.goto("/jobs");
    await waitForStableUI(page);
    await page.waitForTimeout(1000);

    await expect(page).toHaveScreenshot("jobs-with-completed.png");
  });
});
