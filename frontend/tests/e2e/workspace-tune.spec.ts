import { expect, test } from "@playwright/test";
import * as fs from "node:fs";
import { isMobileProject } from "./helpers/mobile";
import {
  pollJobUntilTerminal,
  seedUiWorkspace,
} from "./helpers/workspace-ui";

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
          params: { n_trials: 3, timeout: null },
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

    // Bug 2026-04-14 regression guard: a binary task with the default
    // AUC metric MUST run as ``maximize``. The previous workspace inject
    // path hardcoded ``minimize`` and AUC was being optimized as
    // low-is-better, producing meaningless ``best_params``.
    expect(tuneResult.metric_name).toBe("auc");
    expect(tuneResult.direction).toBe("maximize");

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
          params: { n_trials: 2, timeout: null },
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
          params: { n_trials: 2, timeout: null },
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

    // 3. Export code — should return a ZIP file.
    // NOTE: the backend route is ``GET /jobs/{id}/export-code`` (see
    // api/jobs.py). The original v2-11 test used POST, which returned
    // 405 Method Not Allowed and never exercised the real export path.
    const exportRes = await request.get(`${API}/jobs/${jobId}/export-code`);
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

  /**
   * Issue #257 Phase 3 — UI-driven Tune happy path.
   *
   * Parallel to the UI-Fit Scenario A in workspace-fit.spec.ts. Drives
   * the real frontend path: seed data via the Path input, pick target,
   * switch to the Tune tab, click the Tune button, assert POST
   * /workspace/tune returns 200 and the job completes.
   *
   * TuneTab auto-populates a default search space from
   * ``catalog_entries.default_range`` (see TuneTab.tsx:62-86), so a
   * user-driven Tune with no manual search-space edits still submits a
   * valid config. This spec locks that contract.
   */
  test("UI: load data -> pick target -> Tune tab -> click Tune -> tune returns 200", async ({
    page,
    request,
  }, testInfo) => {
    // Same budget as the UI-Fit scenarios (15s schema load + 15s combo
    // enable + 30s tune accept + 90s poll), plus a margin for Optuna
    // overhead on the first trial.
    test.setTimeout(180_000);
    if (isMobileProject(testInfo)) {
      // Mobile layout collapses the Tune tab behind the tab nav;
      // covered separately by ui-improvements specs.
      test.skip(true, "Mobile layout path is covered elsewhere");
    }

    const csvPath = createTestCsv();
    await seedUiWorkspace(page, testInfo, { csvPath });

    // Switch to the Tune tab. Radix Tabs uses role="tab" for triggers.
    await page.getByRole("tab", { name: "Tune" }).click();
    const tuneButton = page.getByRole("button", { name: "Tune", exact: true });
    await expect(tuneButton).toBeEnabled({ timeout: 15_000 });

    // Arm the response listener BEFORE the click so we don't miss the
    // fast accept-on-submit path.
    const tuneResponsePromise = page.waitForResponse(
      (res) =>
        res.url().endsWith("/api/workspace/tune") &&
        res.request().method() === "POST",
      { timeout: 30_000 },
    );

    await tuneButton.click();

    const tuneResponse = await tuneResponsePromise;
    expect(
      tuneResponse.status(),
      `POST /workspace/tune must succeed for default UI flow (got ${tuneResponse.status()}). ` +
        `Body: ${await tuneResponse.text()}`,
    ).toBe(200);
    const tuneBody = await tuneResponse.json();
    expect(tuneBody.job_id).toBeTruthy();

    // Poll until the job completes. Tune walltime is dominated by the
    // number of trials; TuneTab's default n_trials comes from the
    // backend ui_schema. The shared helper caps at 90s and breaks on
    // any terminal status (``cancelled`` included) so a cancel in-flight
    // surfaces with a clear status rather than timing out.
    const terminalBody = await pollJobUntilTerminal(
      request,
      tuneBody.job_id as string,
    );
    expect(terminalBody.status).toBe("completed");

    // Sanity-check the tune_result shape so a "200 OK but garbage
    // result" regression is also caught.
    const tuneResult = terminalBody.tune_result as
      | Record<string, unknown>
      | null;
    expect(tuneResult).toBeTruthy();
    expect(tuneResult).toHaveProperty("best_params");
    expect(tuneResult).toHaveProperty("best_score");
  });

  /**
   * Issue #263 — UI-driven Retune happy path.
   *
   * Drives the full user flow: complete a Tune via the UI (Scenario T
   * shape), wait for the workspace ResultsCompletedView to render the
   * "Re-tune (+N trials)" button (only shown for completed Tune jobs
   * with tune_result, see ResultsCompletedView.tsx:85), open the
   * dialog, click "Start Re-tune", and assert
   * ``POST /api/jobs/{parent}/retune`` returns 200 with the parent_job_id
   * threaded through.
   *
   * This locks the regression class where a UI re-tune produces a
   * malformed body (e.g. missing parent_job_id, wrong n_trials shape)
   * because the API-only specs already in this file cannot catch it —
   * they craft the body in TypeScript by hand.
   */
  test("UI: complete Tune -> click Re-tune -> dialog -> Start -> retune returns 200", async ({
    page,
    request,
  }, testInfo) => {
    // Tune + Retune walltime stacks: seed (~30s) + parent poll (90s
    // default) + child poll (capped to 60s below since a continued
    // Optuna study is faster than a fresh one) = ~180s in the worst
    // case. 300s leaves ~2× headroom for CI IO jitter.
    test.setTimeout(300_000);
    if (isMobileProject(testInfo)) {
      test.skip(true, "Mobile layout path is covered elsewhere");
    }

    const csvPath = createTestCsv();
    await seedUiWorkspace(page, testInfo, { csvPath });

    // Drive the parent Tune through the UI (same as Scenario T).
    await page.getByRole("tab", { name: "Tune" }).click();
    const tuneButton = page.getByRole("button", { name: "Tune", exact: true });
    await expect(tuneButton).toBeEnabled({ timeout: 15_000 });
    const tuneResponsePromise = page.waitForResponse(
      (res) =>
        res.url().endsWith("/api/workspace/tune") &&
        res.request().method() === "POST",
      { timeout: 30_000 },
    );
    await tuneButton.click();
    const tuneResponse = await tuneResponsePromise;
    expect(tuneResponse.status()).toBe(200);
    const { job_id: parentJobId } = await tuneResponse.json();

    const parentBody = await pollJobUntilTerminal(request, parentJobId);
    expect(parentBody.status).toBe("completed");

    // Once parent is completed the workspace ResultsCompletedView
    // renders the Re-tune button. ``aria-label="Re-tune with additional
    // trials"`` is set in RetuneActionButton.tsx:99 — locator survives
    // copy tweaks on the visible label.
    const retuneTrigger = page.getByRole("button", {
      name: "Re-tune with additional trials",
    });
    await expect(retuneTrigger).toBeVisible({ timeout: 15_000 });
    await retuneTrigger.click();

    // Dialog opens with default n_trials pre-filled. The Start button
    // is the second button inside the dialog footer; lookup by role.
    const startButton = page.getByRole("button", { name: "Start Re-tune" });
    await expect(startButton).toBeEnabled({ timeout: 5_000 });

    // Arm POST /jobs/{parentId}/retune capture before clicking Start.
    const retuneResponsePromise = page.waitForResponse(
      (res) =>
        res.url().endsWith(`/api/jobs/${parentJobId}/retune`) &&
        res.request().method() === "POST",
      { timeout: 30_000 },
    );
    await startButton.click();

    const retuneResponse = await retuneResponsePromise;
    expect(
      retuneResponse.status(),
      `POST /jobs/${parentJobId}/retune must succeed for default UI flow ` +
        `(got ${retuneResponse.status()}). Body: ${await retuneResponse.text()}`,
    ).toBe(200);
    const retuneBody = await retuneResponse.json();
    expect(retuneBody.parent_job_id).toBe(parentJobId);
    expect(retuneBody.job_id).toBeTruthy();

    // Poll the child to terminal. Re-tune continues the existing study
    // so it is typically faster than the parent — cap at 60s so a
    // child stuck in ``running`` surfaces as a clear timeout rather
    // than burning the test-level 300s budget.
    const childBody = await pollJobUntilTerminal(
      request,
      retuneBody.job_id as string,
      { timeoutMs: 60_000 },
    );
    expect(childBody.status).toBe("completed");
    const childTuneResult = childBody.tune_result as
      | Record<string, unknown>
      | null;
    expect(childTuneResult).toBeTruthy();
    expect(childTuneResult).toHaveProperty("best_params");
  });

  /**
   * Issue #266 — empty-Choice Tune button gate.
   *
   * Switching a Search Space row to Choice mode without entering any
   * choices used to produce ``{type:"categorical", choices:[]}`` and the
   * backend rejected the resulting Tune with 422. This spec drives the
   * UI through the offending sequence and asserts the Tune button is
   * disabled with a banner pointing at the offending row, then re-
   * enables once the user reverts the row to Fixed.
   */
  test("UI: empty Choice mode disables Tune button and shows a banner", async ({
    page,
  }, testInfo) => {
    test.setTimeout(60_000);
    if (isMobileProject(testInfo)) {
      test.skip(true, "Mobile layout path is covered elsewhere");
    }

    const csvPath = createTestCsv();
    await seedUiWorkspace(page, testInfo, { csvPath });

    await page.getByRole("tab", { name: "Tune" }).click();
    const tuneButton = page.getByRole("button", { name: "Tune", exact: true });
    await expect(tuneButton).toBeEnabled({ timeout: 15_000 });

    // Drive the SearchSpaceTable: switch the ``objective`` row to Choice.
    // SearchSpaceRow renders the param key as ``<span class="font-mono">``
    // and the mode segments as ``role="radio"`` with capitalized labels
    // (Fixed / Range / Choice — see SegmentGroup.tsx + SearchSpaceRow.tsx).
    // The row wrapper carries ``border-b`` AND ``last:border-b-0``;
    // matching just ``border-b`` was too loose and resolved to the
    // SearchSpaceTable header card. Anchor to the row by walking up
    // from the param-key ``<span>`` to the closest ``<div>`` that
    // contains the ``radiogroup``.
    const objectiveKey = page.locator("span.font-mono", {
      hasText: /^objective$/,
    });
    const objectiveRow = objectiveKey
      .locator("xpath=ancestor::div[.//*[@role='radiogroup']][1]");
    await expect(objectiveRow).toBeVisible({ timeout: 15_000 });
    await objectiveRow.getByRole("radio", { name: "Choice" }).click();

    // The banner appears and the Tune button gates off.
    await expect(page.getByTestId("empty-choice-banner")).toBeVisible({
      timeout: 5_000,
    });
    await expect(page.getByTestId("empty-choice-banner")).toContainText(
      "objective",
    );
    await expect(tuneButton).toBeDisabled();

    // Reverting the row to Fixed must re-enable Tune and remove the
    // banner. This is the recovery path users will take.
    await objectiveRow.getByRole("radio", { name: "Fixed" }).click();
    await expect(page.getByTestId("empty-choice-banner")).toHaveCount(0);
    await expect(tuneButton).toBeEnabled({ timeout: 5_000 });
  });
});
