import { expect, test } from "@playwright/test";
import * as fs from "node:fs";

const API = "http://localhost:8501/api";

/** Generate a small binary-classification CSV for testing. */
function createTestCsv(): string {
  const csvPath = "/tmp/e2e_tune_test_data.csv";
  const rows = ["id,age,income,gender,target"];
  for (let i = 0; i < 100; i++) {
    rows.push(
      `${i},${20 + (i % 50)},${30000 + i * 100},${i % 2 === 0 ? "M" : "F"},${i % 2}`,
    );
  }
  fs.writeFileSync(csvPath, rows.join("\n"));
  return csvPath;
}

/** Poll GET /api/jobs/{jobId} until terminal status. */
async function pollJobUntilDone(
  request: import("@playwright/test").APIRequestContext,
  jobId: string,
  timeoutMs = 90_000,
  intervalMs = 1_000,
): Promise<Record<string, unknown>> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await request.get(`${API}/jobs/${jobId}`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    if (
      body.status === "completed" ||
      body.status === "failed" ||
      body.status === "cancelled"
    ) {
      return body;
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`Job ${jobId} did not finish within ${timeoutMs}ms`);
}

test.describe("Workspace tune flow", () => {
  // Tune jobs involve model training; give plenty of time.
  test.setTimeout(120_000);

  test.beforeEach(async ({ request }) => {
    await request.post(`${API}/workspace/reset`);
  });

  test("API: Load data, set config with tuning, run tune, verify results", async ({
    request,
  }) => {
    const csvPath = createTestCsv();

    // 1. Load CSV data
    const loadRes = await request.post(`${API}/workspace/data/path`, {
      data: { path: csvPath },
    });
    expect(loadRes.status()).toBe(200);
    const loadBody = await loadRes.json();
    expect(loadBody.data_ref.shape).toEqual([100, 5]);

    // 2. Get columns + suggested task
    const colsRes = await request.get(
      `${API}/workspace/data/columns?target=target`,
    );
    expect(colsRes.status()).toBe(200);
    const colsBody = await colsRes.json();
    expect(colsBody.suggested_task).toBe("binary");

    // 3. Get default config
    const defaultsRes = await request.get(
      `${API}/workspace/config/defaults?task=binary&target=target`,
    );
    expect(defaultsRes.status()).toBe(200);
    const defaults = await defaultsRes.json();

    // 4. Add tuning section with low n_trials for speed
    const configWithTuning = {
      ...defaults,
      tuning: {
        optuna: {
          params: { n_trials: 3, direction: "minimize", timeout: null },
          space: {
            learning_rate: {
              type: "float",
              low: 0.001,
              high: 0.3,
              log: true,
            },
          },
        },
      },
    };

    // 5. Save config
    const putRes = await request.put(`${API}/workspace/config`, {
      data: configWithTuning,
    });
    expect(putRes.status()).toBe(200);
    expect((await putRes.json()).saved).toBe(true);

    // 6. Start tune job
    const tuneRes = await request.post(`${API}/workspace/tune`);
    expect(tuneRes.status()).toBe(200);
    const tuneBody = await tuneRes.json();
    expect(tuneBody.job_id).toBeTruthy();

    // 7. Poll for completion
    const jobDetail = await pollJobUntilDone(request, tuneBody.job_id);
    expect(jobDetail.status).toBe("completed");

    // 8. Verify tune_result structure
    const tuneResult = jobDetail.tune_result as Record<string, unknown>;
    expect(tuneResult).toBeTruthy();
    expect(tuneResult).toHaveProperty("best_params");
    expect(tuneResult).toHaveProperty("best_score");
    expect(tuneResult).toHaveProperty("trials");
    expect(tuneResult).toHaveProperty("metric_name");
    expect(tuneResult).toHaveProperty("direction");

    // best_params should be a non-empty object
    expect(typeof tuneResult.best_params).toBe("object");
    expect(Object.keys(tuneResult.best_params as object).length).toBeGreaterThan(0);

    // best_score should be a number
    expect(typeof tuneResult.best_score).toBe("number");

    // trials count should match n_trials
    const trials = tuneResult.trials as unknown[];
    expect(Array.isArray(trials)).toBe(true);
    expect(trials.length).toBe(3);
  });

  test("API: Tune with empty space (auto search)", async ({ request }) => {
    const csvPath = createTestCsv();

    // 1. Load data
    const loadRes = await request.post(`${API}/workspace/data/path`, {
      data: { path: csvPath },
    });
    expect(loadRes.status()).toBe(200);

    // 2. Get defaults
    const defaultsRes = await request.get(
      `${API}/workspace/config/defaults?task=binary&target=target`,
    );
    expect(defaultsRes.status()).toBe(200);
    const defaults = await defaultsRes.json();

    // 3. Set config with tuning but WITHOUT space (empty object)
    const configNoSpace = {
      ...defaults,
      tuning: {
        optuna: {
          params: { n_trials: 2, direction: "minimize", timeout: null },
          space: {},
        },
      },
    };

    const putRes = await request.put(`${API}/workspace/config`, {
      data: configNoSpace,
    });
    expect(putRes.status()).toBe(200);

    // 4. Start tune — should succeed even with empty space
    const tuneRes = await request.post(`${API}/workspace/tune`);
    expect(tuneRes.status()).toBe(200);
    const tuneBody = await tuneRes.json();
    expect(tuneBody.job_id).toBeTruthy();

    // 5. Poll for completion
    const jobDetail = await pollJobUntilDone(request, tuneBody.job_id);
    expect(jobDetail.status).toBe("completed");

    // tune_result should still be present
    expect(jobDetail.tune_result).toBeTruthy();
    const tuneResult = jobDetail.tune_result as Record<string, unknown>;
    expect(tuneResult).toHaveProperty("best_params");
    expect(tuneResult).toHaveProperty("best_score");

    const trials = tuneResult.trials as unknown[];
    expect(Array.isArray(trials)).toBe(true);
    expect(trials.length).toBe(2);
  });

  test("API: Export code from completed tune job", async ({ request }) => {
    const csvPath = createTestCsv();

    // 1. Load data + set config with tuning
    await request.post(`${API}/workspace/data/path`, {
      data: { path: csvPath },
    });
    const defaultsRes = await request.get(
      `${API}/workspace/config/defaults?task=binary&target=target`,
    );
    const defaults = await defaultsRes.json();

    const configWithTuning = {
      ...defaults,
      tuning: {
        optuna: {
          params: { n_trials: 2, direction: "minimize", timeout: null },
          space: {
            learning_rate: {
              type: "float",
              low: 0.01,
              high: 0.1,
              log: true,
            },
          },
        },
      },
    };
    await request.put(`${API}/workspace/config`, {
      data: configWithTuning,
    });

    // 2. Start tune and wait for completion
    const tuneRes = await request.post(`${API}/workspace/tune`);
    expect(tuneRes.status()).toBe(200);
    const { job_id: jobId } = await tuneRes.json();

    const jobDetail = await pollJobUntilDone(request, jobId);
    expect(jobDetail.status).toBe("completed");

    // 3. Export code — should return a ZIP file
    const exportRes = await request.post(`${API}/jobs/${jobId}/export-code`);
    expect(exportRes.status()).toBe(200);

    // Verify response is a ZIP (content-type header)
    const contentType = exportRes.headers()["content-type"];
    expect(contentType).toContain("application/zip");

    // Verify non-empty body
    const body = await exportRes.body();
    expect(body.length).toBeGreaterThan(0);

    // ZIP magic bytes: PK\x03\x04
    expect(body[0]).toBe(0x50); // P
    expect(body[1]).toBe(0x4b); // K
  });
});
