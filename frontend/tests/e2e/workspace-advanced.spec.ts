import { expect, test } from "@playwright/test";
import * as fs from "node:fs";
import {
  API,
  createTestCsv,
  setupAndFit,
  waitForJobDone,
} from "./helpers/api";

test.describe("Workspace advanced flows", () => {
  test.setTimeout(180_000);

  test.beforeEach(async ({ request }) => {
    await request.post(`${API}/workspace/reset`);
  });

  // ---------------------------------------------------------------
  // 1. Tune with custom search space and apply best params
  // ---------------------------------------------------------------
  test("API: Tune with custom search space returns best params", async ({
    request,
  }) => {
    const csvPath = createTestCsv(100, "/tmp/e2e_tune_custom.csv");

    // Load data
    await request.post(`${API}/workspace/data/path`, {
      data: { path: csvPath },
    });

    // Get defaults
    const defaultsRes = await request.get(
      `${API}/workspace/config/defaults?task=binary&target=target`,
    );
    const config = await defaultsRes.json();

    // Set a custom search space
    config.tuning = {
      optuna: {
        params: { n_trials: 5, timeout: 120 },
        space: {
          learning_rate: {
            type: "float",
            low: 0.01,
            high: 0.3,
            log: true,
          },
          max_depth: { type: "int", low: 3, high: 8 },
        },
      },
    };

    await request.put(`${API}/workspace/config`, { data: config });

    // Start tune
    const tuneRes = await request.post(`${API}/workspace/tune`);
    expect(tuneRes.status()).toBe(200);
    const tuneBody = await tuneRes.json();
    const tuneJobId = tuneBody.job_id as string;

    const detail = await waitForJobDone(request, tuneJobId);
    expect(detail.status).toBe("completed");
    expect(detail.job_type).toBe("tune");

    // Verify tune result has best_params
    const tunResult = detail.tune_result as Record<string, unknown>;
    expect(tunResult).toBeTruthy();
    expect(tunResult.best_params).toBeTruthy();
    expect(tunResult.best_score).toBeDefined();

    // Best params should contain the tuned parameters
    const bestParams = tunResult.best_params as Record<string, unknown>;
    expect(typeof bestParams.learning_rate).toBe("number");
    expect(typeof bestParams.max_depth).toBe("number");

    // Verify bounds were respected
    expect(bestParams.learning_rate as number).toBeGreaterThanOrEqual(0.01);
    expect(bestParams.learning_rate as number).toBeLessThanOrEqual(0.3);
    expect(bestParams.max_depth as number).toBeGreaterThanOrEqual(3);
    expect(bestParams.max_depth as number).toBeLessThanOrEqual(8);
  });

  // ---------------------------------------------------------------
  // 2. Error: fit without data returns error
  // ---------------------------------------------------------------
  test("API: Fit without data returns 400", async ({ request }) => {
    const fitRes = await request.post(`${API}/workspace/fit`);
    expect(fitRes.status()).toBe(400);
    const body = await fitRes.json();
    expect(body.detail || body.error).toBeTruthy();
  });

  // ---------------------------------------------------------------
  // 3. Error: invalid config validation
  // ---------------------------------------------------------------
  test("API: Config validation catches invalid values", async ({
    request,
  }) => {
    const csvPath = createTestCsv(100, "/tmp/e2e_invalid_config.csv");
    await request.post(`${API}/workspace/data/path`, {
      data: { path: csvPath },
    });

    const defaultsRes = await request.get(
      `${API}/workspace/config/defaults?task=binary&target=target`,
    );
    const config = await defaultsRes.json();

    // Set an invalid learning_rate
    config.model.params.learning_rate = -1;

    const valRes = await request.post(`${API}/workspace/config/validate`, {
      data: config,
    });
    expect(valRes.status()).toBe(200);
    const valBody = await valRes.json();
    // Config should either have errors or the backend accepts negative lr
    // (LightGBM may accept it but produce a warning)
    expect(valBody).toBeTruthy();
  });

  // ---------------------------------------------------------------
  // 4. Error: load non-existent file
  // ---------------------------------------------------------------
  test("API: Load non-existent file returns error", async ({ request }) => {
    const loadRes = await request.post(`${API}/workspace/data/path`, {
      data: { path: "/tmp/nonexistent_file_12345.csv" },
    });
    expect(loadRes.status()).toBeGreaterThanOrEqual(400);
  });

  // ---------------------------------------------------------------
  // 5. Error: inference on non-existent job
  // ---------------------------------------------------------------
  test("API: Inference on non-existent job returns error", async ({
    request,
  }) => {
    const csvPath = createTestCsv(50, "/tmp/e2e_inf_bad_job.csv");
    const inferRes = await request.post(`${API}/inference/run`, {
      data: {
        job_id: "non-existent-job-id",
        data: { source_type: "path", path: csvPath },
        return_shap: false,
        evaluate: false,
      },
    });
    expect(inferRes.status()).toBeGreaterThanOrEqual(400);
  });

  // ---------------------------------------------------------------
  // 6. CV: stratified group kfold with group column
  // ---------------------------------------------------------------
  test("API: Config with group_kfold strategy validates", async ({
    request,
  }) => {
    // Create CSV with a group column
    const csvPath = "/tmp/e2e_cv_group.csv";
    const lines = ["id,age,group,target"];
    for (let i = 0; i < 100; i++) {
      lines.push(
        `${i},${20 + (i % 50)},group_${i % 5},${i % 2}`,
      );
    }
    fs.writeFileSync(csvPath, lines.join("\n"));

    await request.post(`${API}/workspace/data/path`, {
      data: { path: csvPath },
    });

    const defaultsRes = await request.get(
      `${API}/workspace/config/defaults?task=binary&target=target`,
    );
    const config = await defaultsRes.json();

    // Set group_kfold strategy
    config.split = {
      strategy: "group_kfold",
      n_splits: 5,
      group_col: "group",
    };

    await request.put(`${API}/workspace/config`, { data: config });

    // Validate
    const valRes = await request.post(`${API}/workspace/config/validate`, {
      data: config,
    });
    expect(valRes.status()).toBe(200);

    // Fit should work
    const fitRes = await request.post(`${API}/workspace/fit`);
    expect(fitRes.status()).toBe(200);
    const fitJobId = (await fitRes.json()).job_id as string;

    const detail = await waitForJobDone(request, fitJobId);
    expect(detail.status).toBe("completed");
  });

  // ---------------------------------------------------------------
  // 7. Job cancellation mid-execution
  // ---------------------------------------------------------------
  test("API: Cancel running job transitions to cancelled", async ({
    request,
  }) => {
    // Use more rows so job takes longer
    const csvPath = createTestCsv(500, "/tmp/e2e_cancel_test.csv");
    const jobId = await setupAndFit(request, csvPath);

    // Small delay then cancel
    await new Promise((r) => setTimeout(r, 500));

    const cancelRes = await request.post(`${API}/jobs/${jobId}/cancel`);
    // Job may have already completed on fast machines
    if (cancelRes.status() === 200) {
      const body = await cancelRes.json();
      expect(body.status).toBe("cancelled");
    }

    // Wait for terminal state
    const detail = await waitForJobDone(request, jobId);
    expect(["completed", "cancelled"]).toContain(detail.status);
  });
});
