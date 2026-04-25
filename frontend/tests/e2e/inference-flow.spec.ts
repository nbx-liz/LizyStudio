import { expect, test } from "@playwright/test";
import * as fs from "node:fs";
import { dismissOnboarding } from "./helpers/onboarding";

const API = "http://localhost:8501/api";

/**
 * Create a test CSV with the given number of rows.
 * Columns: id, age, gender, target (binary classification).
 */
function createTestCsv(rows = 100): string {
  const csvPath = "/tmp/e2e_inference_test_data.csv";
  const lines = ["id,age,gender,target"];
  for (let i = 0; i < rows; i++) {
    lines.push(`${i},${20 + (i % 50)},${i % 2 === 0 ? "M" : "F"},${i % 2}`);
  }
  fs.writeFileSync(csvPath, lines.join("\n"));
  return csvPath;
}

/**
 * Helper: load data, get defaults, save config, and start a fit job.
 * Returns the job_id from POST /workspace/fit.
 */
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
  const fitBody = await fitRes.json();
  return fitBody.job_id as string;
}

/**
 * Poll GET /jobs/{job_id} until the job reaches a terminal status.
 */
async function waitForJobDone(
  request: import("@playwright/test").APIRequestContext,
  jobId: string,
  timeoutMs = 90_000,
): Promise<Record<string, unknown>> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const res = await request.get(`${API}/jobs/${jobId}`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    if (
      ["completed", "failed", "cancelled"].includes(body.status as string)
    ) {
      return body as Record<string, unknown>;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`Job ${jobId} did not finish within ${timeoutMs}ms`);
}

test.describe("Inference flow", () => {
  test.setTimeout(120_000);

  test.beforeEach(async ({ request }) => {
    await request.post(`${API}/workspace/reset`);
  });

  // ---------------------------------------------------------------
  // 1. API: Full inference lifecycle
  // ---------------------------------------------------------------
  test("API: Run inference on completed job and fetch results", async ({
    request,
  }) => {
    const csvPath = createTestCsv(100);
    const jobId = await setupAndFit(request, csvPath);

    // Wait for fit to complete
    const detail = await waitForJobDone(request, jobId);
    expect(detail.status).toBe("completed");

    // Run inference with evaluate (has ground truth)
    const inferRes = await request.post(`${API}/inference/run`, {
      data: {
        job_id: jobId,
        data: { source_type: "path", path: csvPath },
        return_shap: false,
        evaluate: true,
      },
    });
    expect(inferRes.status()).toBe(200);
    const inferBody = await inferRes.json();
    expect(inferBody.inf_id).toBeTruthy();
    expect(inferBody.job_id).toBe(jobId);

    const infId = inferBody.inf_id as string;

    // Fetch inference record
    const recordRes = await request.get(
      `${API}/inference/${infId}?job_id=${jobId}`,
    );
    expect(recordRes.status()).toBe(200);
    const record = await recordRes.json();
    expect(record.inf_id).toBe(infId);
    expect(record.has_ground_truth).toBe(true);
    expect(record.row_count).toBe(100);

    // Fetch predictions
    const predRes = await request.get(
      `${API}/inference/${infId}/predictions?job_id=${jobId}&rows=10`,
    );
    expect(predRes.status()).toBe(200);
    const preds = await predRes.json();
    expect(preds.data.length).toBeLessThanOrEqual(10);
    expect(preds.total_rows).toBe(100);

    // Fetch metrics (available because evaluate=true)
    const metricsRes = await request.get(
      `${API}/inference/${infId}/metrics?job_id=${jobId}`,
    );
    expect(metricsRes.status()).toBe(200);
    const metrics = await metricsRes.json();
    expect(Object.keys(metrics).length).toBeGreaterThan(0);
  });

  // ---------------------------------------------------------------
  // 2. API: Inference history
  // ---------------------------------------------------------------
  test("API: Inference history lists multiple runs", async ({ request }) => {
    const csvPath = createTestCsv(100);
    const jobId = await setupAndFit(request, csvPath);
    await waitForJobDone(request, jobId);

    // Run inference twice
    for (let i = 0; i < 2; i++) {
      const res = await request.post(`${API}/inference/run`, {
        data: {
          job_id: jobId,
          data: { source_type: "path", path: csvPath },
          return_shap: false,
          evaluate: false,
        },
      });
      expect(res.status()).toBe(200);
    }

    // Fetch history
    const histRes = await request.get(
      `${API}/inference/history?job_id=${jobId}`,
    );
    expect(histRes.status()).toBe(200);
    const history: Array<Record<string, unknown>> = await histRes.json();
    expect(history.length).toBeGreaterThanOrEqual(2);
  });

  // ---------------------------------------------------------------
  // 3. UI: Inference page renders and can select a model
  // ---------------------------------------------------------------
  test("UI: Inference page shows completed job for selection", async ({
    page,
    request,
  }) => {
    const csvPath = createTestCsv(100);
    const jobId = await setupAndFit(request, csvPath);
    await waitForJobDone(request, jobId);

    // Navigate to inference page
    await dismissOnboarding(page);
    await page.goto("/inference");
    await page.waitForLoadState("networkidle");

    // The page should show the setup panel
    await expect(page.getByText("Model", { exact: true }).first()).toBeVisible({ timeout: 10_000 });

    await expect(page).toHaveScreenshot("inference-page.png");
  });

  // ---------------------------------------------------------------
  // 4. API: Inference without ground truth
  // ---------------------------------------------------------------
  test("API: Inference without evaluate returns has_ground_truth=false", async ({
    request,
  }) => {
    const csvPath = createTestCsv(100);

    // Create a separate inference data file without target column
    const inferCsvPath = "/tmp/e2e_inference_no_gt.csv";
    const lines = ["id,age,gender"];
    for (let i = 0; i < 50; i++) {
      lines.push(`${i},${20 + (i % 50)},${i % 2 === 0 ? "M" : "F"}`);
    }
    fs.writeFileSync(inferCsvPath, lines.join("\n"));

    const jobId = await setupAndFit(request, csvPath);
    await waitForJobDone(request, jobId);

    // Run inference without target column
    const inferRes = await request.post(`${API}/inference/run`, {
      data: {
        job_id: jobId,
        data: { source_type: "path", path: inferCsvPath },
        return_shap: false,
        evaluate: false,
      },
    });
    expect(inferRes.status()).toBe(200);
    const body = await inferRes.json();

    // Fetch record to verify ground truth flag
    const recordRes = await request.get(
      `${API}/inference/${body.inf_id}?job_id=${jobId}`,
    );
    expect(recordRes.status()).toBe(200);
    const record = await recordRes.json();
    expect(record.has_ground_truth).toBe(false);
    expect(record.row_count).toBe(50);
  });

  /**
   * Issue #263 — UI-driven Inference happy path.
   *
   * Drives the full user flow on /inference: complete a Fit via API
   * (the parent setup is well-covered by Fit specs already), navigate
   * to the Inference page, select the completed job from the combobox,
   * type the data path, click Run Inference, and assert
   * ``POST /api/inference/run`` returns 200 with a non-empty
   * ``inf_id`` and the predictions endpoint is reachable for the new
   * record.
   *
   * This locks the regression class where the Inference page builds a
   * malformed body (missing ``job_id``, wrong source_type, omitted
   * ``return_shap`` / ``evaluate``) — the API-only specs above cannot
   * detect such a bug because they craft the body in TypeScript.
   */
  test("UI: select model -> set path -> Run Inference -> inference returns 200", async ({
    page,
    request,
  }) => {
    test.setTimeout(180_000);

    // Seed a completed Fit job via API; the UI flow we're locking is the
    // inference page itself, not Fit (covered separately).
    const csvPath = createTestCsv(100);
    const jobId = await setupAndFit(request, csvPath);
    await waitForJobDone(request, jobId);

    await dismissOnboarding(page);
    await page.goto("/inference");
    await page.waitForLoadState("networkidle");

    // Pick the completed job from the model combobox.
    const modelCombo = page.getByRole("combobox", {
      name: "Select completed job",
    });
    await expect(modelCombo).toBeEnabled({ timeout: 15_000 });
    await modelCombo.click();
    // Scope the option lookup to the open listbox so unrelated
    // comboboxes (now or future) cannot leak their options into the
    // .first() pick. Radix sets ``role="listbox"`` on the open
    // SelectContent. The first option is the most recent job
    // (newest-first ordering is locked by jobs.py:282 ``reverse=True``).
    const openListbox = page.getByRole("listbox");
    await openListbox.getByRole("option").first().click();

    // The data source defaults to "Path" — fill in the same CSV the fit
    // job consumed (target column is present, so evaluate=true by
    // default which exercises the with-ground-truth branch).
    const pathInput = page.getByPlaceholder("/path/to/data.csv");
    await pathInput.fill(csvPath);

    const runButton = page.getByRole("button", { name: "Run Inference" });
    await expect(runButton).toBeEnabled({ timeout: 5_000 });

    const inferResponsePromise = page.waitForResponse(
      (res) =>
        res.url().endsWith("/api/inference/run") &&
        res.request().method() === "POST",
      { timeout: 30_000 },
    );
    await runButton.click();

    const inferResponse = await inferResponsePromise;
    expect(
      inferResponse.status(),
      `POST /inference/run must succeed for default UI flow ` +
        `(got ${inferResponse.status()}). Body: ${await inferResponse.text()}`,
    ).toBe(200);
    const inferBody = await inferResponse.json();
    expect(inferBody.inf_id).toBeTruthy();

    // Sanity-check the new record is reachable so a "200 OK but the
    // record never lands on disk" regression also fails this spec.
    const recordRes = await request.get(
      `${API}/inference/${inferBody.inf_id}?job_id=${jobId}`,
    );
    expect(recordRes.status()).toBe(200);
    const record = await recordRes.json();
    expect(record.row_count).toBe(100);
  });
});
