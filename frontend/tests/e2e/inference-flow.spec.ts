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

  /**
   * B-2 (gui-e2e-plan §4.1) — History list click switches the result
   * panel.
   *
   * The auto-select-latest flow is already covered by InferencePage's
   * unit tests, but the round-trip "user clicks an older history
   * entry → result panel re-renders against the older record" has no
   * E2E coverage. The result panel keys on `selectedRecord.inf_id`,
   * so a regression in:
   *   - the ``onSelect`` wiring in HistoryList
   *   - the ``selectedInfId`` derivation on InferencePage
   *   - the ``key`` on Results* that forces a remount on switch
   * would silently leave the panel pinned to whatever it auto-
   * selected first. Unit tests with mocked records cannot detect a
   * real backend mismatch (e.g., wrong job_id propagated to the
   * predictions fetch) — only the integration path can.
   *
   * Invariants:
   *
   *   INV-1  Two inference runs land in history; the page auto-
   *          selects the latest (#2) on job pick.
   *   INV-2  Clicking the older "#1" history button switches the
   *          right-panel heading to "Inf #1".
   *   INV-3  Clicking back to "#2" restores the heading.
   */
  test("UI: clicking a history entry switches the inference result panel (B-2)", async ({
    page,
    request,
  }) => {
    test.setTimeout(180_000);

    const csvPath = createTestCsv(100);
    const jobId = await setupAndFit(request, csvPath);
    await waitForJobDone(request, jobId);

    // Run inference twice with evaluate=true so both records have
    // ground truth and render through ResultsWithGT (where the
    // "Inf #N -- jobLabel" heading lives at line 72).
    for (let i = 0; i < 2; i++) {
      const res = await request.post(`${API}/inference/run`, {
        data: {
          job_id: jobId,
          data: { source_type: "path", path: csvPath },
          return_shap: false,
          evaluate: true,
        },
      });
      expect(res.status()).toBe(200);
    }

    await dismissOnboarding(page);
    await page.goto("/inference");
    await page.waitForLoadState("networkidle");

    const modelCombo = page.getByRole("combobox", {
      name: "Select completed job",
    });
    await expect(modelCombo).toBeEnabled({ timeout: 15_000 });
    await modelCombo.click();
    const openListbox = page.getByRole("listbox");
    await openListbox.getByRole("option").first().click();

    // INV-1: history list materialises with 2 entries; the latest
    // (#2) is auto-selected. The heading "Inf #2 -- jobLabel" is
    // unique to the right panel.
    const hist2 = page.getByRole("button", { name: /^#2\s/ });
    const hist1 = page.getByRole("button", { name: /^#1\s/ });
    await expect(hist2).toBeVisible({ timeout: 10_000 });
    await expect(hist1).toBeVisible();
    await expect(
      page.getByRole("heading").filter({ hasText: /Inf\s*#2/ }),
    ).toBeVisible({ timeout: 10_000 });

    // INV-2: click the older "#1" → heading switches to Inf #1.
    await hist1.click();
    await expect(
      page.getByRole("heading").filter({ hasText: /Inf\s*#1/ }),
    ).toBeVisible({ timeout: 10_000 });
    // The newest heading must no longer be in the right panel — if
    // both stayed mounted, the key on Results* would not be working.
    await expect(
      page.getByRole("heading").filter({ hasText: /Inf\s*#2/ }),
    ).toHaveCount(0);

    // INV-3: click back to the newest → heading restores.
    await hist2.click();
    await expect(
      page.getByRole("heading").filter({ hasText: /Inf\s*#2/ }),
    ).toBeVisible({ timeout: 10_000 });
    await expect(
      page.getByRole("heading").filter({ hasText: /Inf\s*#1/ }),
    ).toHaveCount(0);
  });
});
