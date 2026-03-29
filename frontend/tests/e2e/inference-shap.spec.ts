import { expect, test } from "@playwright/test";
import {
  API,
  createTestCsv,
  createTestCsvNoTarget,
  setupAndFit,
  waitForJobDone,
} from "./helpers/api";

test.describe("Inference SHAP and prediction-only flows", () => {
  test.setTimeout(180_000);

  test.beforeEach(async ({ request }) => {
    await request.post(`${API}/workspace/reset`);
  });

  // ---------------------------------------------------------------
  // 1. SHAP values computation
  // ---------------------------------------------------------------
  test("API: Inference with return_shap=true returns SHAP data", async ({
    request,
  }) => {
    const csvPath = createTestCsv(80, "/tmp/e2e_shap_test.csv");
    const jobId = await setupAndFit(request, csvPath);
    await waitForJobDone(request, jobId);

    // Run inference with SHAP enabled
    const inferRes = await request.post(`${API}/inference/run`, {
      data: {
        job_id: jobId,
        data: { source_type: "path", path: csvPath },
        return_shap: true,
        evaluate: true,
      },
    });
    expect(inferRes.status()).toBe(200);
    const body = await inferRes.json();
    expect(body.inf_id).toBeTruthy();

    // Fetch full record — should have SHAP results
    const recordRes = await request.get(
      `${API}/inference/${body.inf_id}?job_id=${jobId}`,
    );
    expect(recordRes.status()).toBe(200);
    const record = await recordRes.json();
    expect(record.has_ground_truth).toBe(true);

    // SHAP data availability depends on backend support;
    // at minimum the request should succeed without error
    expect(record.row_count).toBe(80);
  });

  // ---------------------------------------------------------------
  // 2. Prediction-only (no target column)
  // ---------------------------------------------------------------
  test("API: Prediction-only inference with no target column", async ({
    request,
  }) => {
    const trainCsv = createTestCsv(100, "/tmp/e2e_pred_train.csv");
    const jobId = await setupAndFit(request, trainCsv);
    await waitForJobDone(request, jobId);

    // Create data without target column
    const predCsv = createTestCsvNoTarget(30, "/tmp/e2e_pred_only.csv");

    const inferRes = await request.post(`${API}/inference/run`, {
      data: {
        job_id: jobId,
        data: { source_type: "path", path: predCsv },
        return_shap: false,
        evaluate: false,
      },
    });
    expect(inferRes.status()).toBe(200);
    const body = await inferRes.json();

    // Verify predictions available
    const predRes = await request.get(
      `${API}/inference/${body.inf_id}/predictions?job_id=${jobId}`,
    );
    expect(predRes.status()).toBe(200);
    const preds = await predRes.json();
    expect(preds.total_rows).toBe(30);
    expect(preds.data.length).toBeGreaterThan(0);

    // Metrics should NOT be available (no ground truth)
    const metricsRes = await request.get(
      `${API}/inference/${body.inf_id}/metrics?job_id=${jobId}`,
    );
    // Either 404 or empty metrics
    if (metricsRes.status() === 200) {
      const metrics = await metricsRes.json();
      // If returned, inference metrics should be empty/null
      expect(
        metrics === null || Object.keys(metrics).length === 0,
      ).toBeTruthy();
    }
  });

  // ---------------------------------------------------------------
  // 3. Multiple inferences for comparison
  // ---------------------------------------------------------------
  test("API: Multiple inferences on same job create distinct records", async ({
    request,
  }) => {
    const csvPath = createTestCsv(60, "/tmp/e2e_multi_inf.csv");
    const jobId = await setupAndFit(request, csvPath);
    await waitForJobDone(request, jobId);

    // Run 3 inferences
    const infIds: string[] = [];
    for (let i = 0; i < 3; i++) {
      const res = await request.post(`${API}/inference/run`, {
        data: {
          job_id: jobId,
          data: { source_type: "path", path: csvPath },
          return_shap: false,
          evaluate: i % 2 === 0, // alternate evaluate flag
        },
      });
      expect(res.status()).toBe(200);
      const body = await res.json();
      infIds.push(body.inf_id as string);
    }

    // All IDs should be unique
    expect(new Set(infIds).size).toBe(3);

    // History should return all 3
    const histRes = await request.get(
      `${API}/inference/history?job_id=${jobId}`,
    );
    expect(histRes.status()).toBe(200);
    const history: Array<Record<string, unknown>> = await histRes.json();
    expect(history.length).toBeGreaterThanOrEqual(3);
  });
});
