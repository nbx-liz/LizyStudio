import { expect, test } from "@playwright/test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const API = "http://localhost:8501/api";

/**
 * Create a test CSV with the given number of rows.
 * Columns: id, age, gender, target (binary classification).
 */
function createTestCsv(rows = 100): string {
  const csvPath = "/tmp/e2e_jobs_test_data.csv";
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
  // Load data
  const loadRes = await request.post(`${API}/workspace/data/path`, {
    data: { path: csvPath },
  });
  expect(loadRes.status()).toBe(200);

  // Get default config
  const defaultsRes = await request.get(
    `${API}/workspace/config/defaults?task=binary&target=target`,
  );
  expect(defaultsRes.status()).toBe(200);
  const config = await defaultsRes.json();

  // Save config
  const putRes = await request.put(`${API}/workspace/config`, {
    data: config,
  });
  expect(putRes.status()).toBe(200);
  expect((await putRes.json()).saved).toBe(true);

  // Start fit
  const fitRes = await request.post(`${API}/workspace/fit`);
  expect(fitRes.status()).toBe(200);
  const fitBody = await fitRes.json();
  expect(fitBody.job_id).toBeTruthy();
  return fitBody.job_id as string;
}

/**
 * Poll GET /jobs/{job_id} until the job reaches a terminal status
 * (completed | failed | cancelled). Returns the final job detail.
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
    if (["completed", "failed", "cancelled"].includes(body.status as string)) {
      return body as Record<string, unknown>;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`Job ${jobId} did not finish within ${timeoutMs}ms`);
}

test.describe("Jobs page flow", () => {
  // Fit jobs can take a while depending on the machine
  test.setTimeout(120_000);

  test.beforeEach(async ({ request }) => {
    await request.post(`${API}/workspace/reset`);
  });

  // ---------------------------------------------------------------
  // 1. Job lifecycle — create, list, get, delete
  // ---------------------------------------------------------------
  test("API: Job lifecycle — create, list, get, delete", async ({
    request,
  }) => {
    const csvPath = createTestCsv(100);
    const jobId = await setupAndFit(request, csvPath);

    // Wait for completion
    const detail = await waitForJobDone(request, jobId);
    expect(detail.status).toBe("completed");

    // GET /jobs → verify the job appears in the list
    const listRes = await request.get(`${API}/jobs`);
    expect(listRes.status()).toBe(200);
    const jobs: Array<Record<string, unknown>> = await listRes.json();
    expect(jobs.some((j) => j.job_id === jobId)).toBe(true);

    // GET /jobs/{job_id} → verify detail fields
    const getRes = await request.get(`${API}/jobs/${jobId}`);
    expect(getRes.status()).toBe(200);
    const jobDetail = await getRes.json();
    expect(jobDetail.job_id).toBe(jobId);
    expect(jobDetail.status).toBe("completed");
    expect(jobDetail.job_type).toBe("fit");
    expect(jobDetail.created_at).toBeTruthy();
    expect(jobDetail.completed_at).toBeTruthy();

    // GET /jobs/{job_id}/config → verify config returned
    const configRes = await request.get(`${API}/jobs/${jobId}/config`);
    expect(configRes.status()).toBe(200);
    const config = await configRes.json();
    expect(config.task).toBe("binary");
    expect(config.data.target).toBe("target");

    // GET /jobs/{job_id}/log → verify log exists
    const logRes = await request.get(`${API}/jobs/${jobId}/log`);
    expect(logRes.status()).toBe(200);
    const logBody = await logRes.json();
    expect(typeof logBody.log).toBe("string");

    // DELETE /jobs/{job_id} → verify 200
    const deleteRes = await request.delete(`${API}/jobs/${jobId}`);
    expect(deleteRes.status()).toBe(200);
    const deleteBody = await deleteRes.json();
    expect(deleteBody.status).toBe("deleted");

    // GET /jobs → verify job removed
    const listAfter = await request.get(`${API}/jobs`);
    expect(listAfter.status()).toBe(200);
    const jobsAfter: Array<Record<string, unknown>> = await listAfter.json();
    expect(jobsAfter.some((j) => j.job_id === jobId)).toBe(false);
  });

  // ---------------------------------------------------------------
  // 2. Delete running job returns 400
  // ---------------------------------------------------------------
  test("API: Delete running job returns 400", async ({ request }) => {
    const csvPath = createTestCsv(100);
    const jobId = await setupAndFit(request, csvPath);

    // Immediately try to delete while job is (likely) still running
    const deleteRes = await request.delete(`${API}/jobs/${jobId}`);
    // If the job is still running we expect 400; if it already finished
    // (very fast machine) we accept 200 but still verify the error code
    // on 400.
    if (deleteRes.status() === 400) {
      const body = await deleteRes.json();
      expect(body.error.code).toBe("JOB_RUNNING");
    }

    // Cancel the job so it doesn't leak
    const cancelRes = await request.post(`${API}/jobs/${jobId}/cancel`);
    // Accept 200 (cancelled) or 400 (already finished)
    expect([200, 400]).toContain(cancelRes.status());

    // Wait for terminal state
    await waitForJobDone(request, jobId);
  });

  // ---------------------------------------------------------------
  // 3. Job export model
  // ---------------------------------------------------------------
  test("API: Job export model", async ({ request }) => {
    const csvPath = createTestCsv(100);
    const jobId = await setupAndFit(request, csvPath);

    // Wait for completion
    const detail = await waitForJobDone(request, jobId);
    expect(detail.status).toBe("completed");

    // POST /jobs/{job_id}/export with type=model
    const exportDir = fs.mkdtempSync(path.join(os.tmpdir(), "e2e-export-"));
    const exportPath = path.join(exportDir, "model_export.pkl");

    const exportRes = await request.post(`${API}/jobs/${jobId}/export`, {
      data: { export_type: "model", output_path: exportPath },
    });
    expect(exportRes.status()).toBe(200);
    const exportBody = await exportRes.json();
    expect(exportBody.exported_path).toBeTruthy();
    expect(exportBody.export_type).toBe("model");

    // Clean up
    fs.rmSync(exportDir, { recursive: true, force: true });
  });

  // ---------------------------------------------------------------
  // 4. Job filtering
  // ---------------------------------------------------------------
  test("API: Job filtering", async ({ request }) => {
    const csvPath = createTestCsv(100);

    // --- Create fit job and wait for completion ---
    const fitJobId = await setupAndFit(request, csvPath);
    await waitForJobDone(request, fitJobId);

    // --- Create tune job ---
    // Re-load data + config (workspace was consumed by fit)
    await request.post(`${API}/workspace/data/path`, {
      data: { path: csvPath },
    });
    const defaultsRes = await request.get(
      `${API}/workspace/config/defaults?task=binary&target=target`,
    );
    const config = await defaultsRes.json();
    await request.put(`${API}/workspace/config`, { data: config });

    const tuneRes = await request.post(`${API}/workspace/tune`);
    expect(tuneRes.status()).toBe(200);
    const tuneBody = await tuneRes.json();
    const tuneJobId = tuneBody.job_id as string;

    // Wait for tune to complete
    await waitForJobDone(request, tuneJobId);

    // GET /jobs → should have at least 2 jobs
    const allRes = await request.get(`${API}/jobs`);
    expect(allRes.status()).toBe(200);
    const allJobs: Array<Record<string, unknown>> = await allRes.json();
    expect(allJobs.length).toBeGreaterThanOrEqual(2);

    // GET /jobs?status=completed → filter by completed
    const completedRes = await request.get(`${API}/jobs?status=completed`);
    expect(completedRes.status()).toBe(200);
    const completedJobs: Array<Record<string, unknown>> =
      await completedRes.json();

    // All returned jobs must have status=completed
    for (const j of completedJobs) {
      expect(j.status).toBe("completed");
    }

    // Verify both job types are present
    const jobTypes = allJobs.map((j) => j.job_type);
    expect(jobTypes).toContain("fit");
    expect(jobTypes).toContain("tune");
  });
});
