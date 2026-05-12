/**
 * Inference Results panel + Download CSV + multi-task coverage.
 *
 * Closes the E2E gaps tracked by:
 *   - #443: Download CSV button on a completed inference.
 *   - #444: Results-panel UI elements (Predictions table, Plots, Comparison).
 *   - #448: non-binary tasks (multiclass / regression) drive
 *           fit → inference → results-render without crashing.
 *
 * (#447 — the inference concurrent-run / cancel guard — is out of scope:
 * ``POST /api/inference/run`` is synchronous and stateless; there is no
 * long-running inference state, no cancel endpoint, and no running-lock
 * window to conflict over. The Issue is closed as not-applicable.)
 *
 * All scenarios run against the real backend (no MSW) so a backend
 * response-shape change surfaces here, not just in subcomponent unit tests.
 */

import { expect, test } from "@playwright/test";
import { randomBytes } from "node:crypto";
import * as fs from "node:fs";
import { API, createTestCsv, setupAndFit, waitForJobDone } from "./helpers/api";
import { dismissOnboarding } from "./helpers/onboarding";

const RUN_TAG = randomBytes(4).toString("hex");
const tmp = (label: string) => `/tmp/e2e_inf_${RUN_TAG}_${label}.csv`;

/** Write a CSV with a 3-class target column (for the multiclass loop). */
function createMulticlassCsv(rows: number, filename: string): string {
  const lines = ["id,age,income,target"];
  for (let i = 0; i < rows; i++) {
    lines.push(`${i},${20 + (i % 50)},${30000 + i * 100},class${i % 3}`);
  }
  fs.writeFileSync(filename, lines.join("\n"));
  return filename;
}

/** Write a CSV with a continuous target column (for the regression loop). */
function createRegressionCsv(rows: number, filename: string): string {
  const lines = ["id,age,income,target"];
  for (let i = 0; i < rows; i++) {
    const target = (i * 1.7 + (i % 7) - 3).toFixed(3);
    lines.push(`${i},${20 + (i % 50)},${30000 + i * 100},${target}`);
  }
  fs.writeFileSync(filename, lines.join("\n"));
  return filename;
}

const TASK_FIXTURES: {
  task: "binary" | "multiclass" | "regression";
  makeCsv: (label: string) => string;
}[] = [
  { task: "binary", makeCsv: (l) => createTestCsv(120, tmp(l)) },
  { task: "multiclass", makeCsv: (l) => createMulticlassCsv(120, tmp(l)) },
  { task: "regression", makeCsv: (l) => createRegressionCsv(120, tmp(l)) },
];

test.describe("Inference coverage (#443/#444/#448)", () => {
  test.beforeEach(async ({ request }) => {
    await request.post(`${API}/workspace/reset`);
  });

  async function runInference(
    request: import("@playwright/test").APIRequestContext,
    jobId: string,
    csvPath: string,
    evaluate: boolean,
  ): Promise<string> {
    const res = await request.post(`${API}/inference/run`, {
      data: {
        job_id: jobId,
        data: { source_type: "path", path: csvPath },
        return_shap: false,
        evaluate,
      },
    });
    expect(
      res.status(),
      `POST /inference/run must succeed (got ${res.status()}): ${await res.text()}`,
    ).toBe(200);
    return (await res.json()).inf_id as string;
  }

  /** Navigate to /inference, pick the most recent completed job → its
   * latest inference record auto-renders in the right panel. */
  async function openLatestInferenceResult(
    page: import("@playwright/test").Page,
  ): Promise<void> {
    await dismissOnboarding(page);
    await page.goto("/inference");
    await page.waitForLoadState("networkidle");
    const combo = page.getByRole("combobox", { name: "Select completed job" });
    await expect(combo).toBeEnabled({ timeout: 15_000 });
    await combo.click();
    await page.getByRole("listbox").getByRole("option").first().click();
    // The page auto-selects the latest inference record (#1 for a single
    // run, #N after N runs) — wait for whichever "Inf #<n>" heading lands.
    await expect(
      page.getByRole("heading").filter({ hasText: /Inf\s*#\d/ }).first(),
    ).toBeVisible({ timeout: 15_000 });
  }

  test("UI: labelled inference results panel renders Plots + Predictions table + Download CSV (#443/#444)", async ({
    page,
    request,
  }) => {
    test.setTimeout(180_000);
    const csvPath = createTestCsv(120, tmp("labelled"));
    const jobId = await setupAndFit(request, csvPath, "target", "binary");
    await waitForJobDone(request, jobId);
    await runInference(request, jobId, csvPath, true);

    await openLatestInferenceResult(page);

    // Plots section (binary fit always exposes ≥1 plot type).
    await expect(
      page.getByRole("heading", { name: "Plots" }),
    ).toBeVisible();

    // Predictions accordion → table + Download CSV link.
    await page.getByRole("button", { name: "Predictions" }).click();
    await expect(page.getByRole("table").first()).toBeVisible({
      timeout: 10_000,
    });
    const downloadLink = page.getByRole("link", { name: /Download CSV/i });
    await expect(downloadLink).toBeVisible();
    await expect(downloadLink).toHaveAttribute("href", /\/download\?job_id=/);
  });

  test("UI: unlabelled inference results panel renders Predictions heading + table (#444)", async ({
    page,
    request,
  }) => {
    test.setTimeout(180_000);
    const csvPath = createTestCsv(120, tmp("unlabelled"));
    const jobId = await setupAndFit(request, csvPath, "target", "binary");
    await waitForJobDone(request, jobId);
    await runInference(request, jobId, csvPath, false);

    await openLatestInferenceResult(page);

    await expect(
      page.getByRole("heading", { name: "Predictions" }),
    ).toBeVisible();
    await expect(page.getByRole("table").first()).toBeVisible({
      timeout: 10_000,
    });
  });

  test("UI: Download CSV button on a completed inference triggers a CSV download (#443)", async ({
    page,
    request,
  }) => {
    test.setTimeout(180_000);
    const csvPath = createTestCsv(120, tmp("dl"));
    const jobId = await setupAndFit(request, csvPath, "target", "binary");
    await waitForJobDone(request, jobId);
    await runInference(request, jobId, csvPath, false);

    await openLatestInferenceResult(page);
    await expect(page.getByRole("table").first()).toBeVisible({
      timeout: 15_000,
    });

    const dlPromise = page.waitForEvent("download");
    await page.getByRole("link", { name: /Download CSV/i }).click();
    const dl = await dlPromise;
    expect(dl.suggestedFilename()).toMatch(/\.csv$/i);
  });

  test("UI: Comparison panel appears after a 2nd inference on the same job (#444)", async ({
    page,
    request,
  }) => {
    test.setTimeout(180_000);
    const csvPath = createTestCsv(120, tmp("cmp"));
    const jobId = await setupAndFit(request, csvPath, "target", "binary");
    await waitForJobDone(request, jobId);
    await runInference(request, jobId, csvPath, false);
    await runInference(request, jobId, csvPath, false);

    await openLatestInferenceResult(page);

    // The latest record (#2) is auto-selected; with a 2nd record in
    // history, ResultsPredOnly renders the Comparison section.
    await expect(
      page.getByRole("heading", { name: "Comparison" }),
    ).toBeVisible({ timeout: 15_000 });
  });

  // #448: every task drives fit → inference → results-render without a crash.
  for (const fixture of TASK_FIXTURES) {
    test(`UI: ${fixture.task} inference renders the results panel (#448)`, async ({
      page,
      request,
    }) => {
      test.setTimeout(180_000);
      const csvPath = fixture.makeCsv(`task_${fixture.task}`);
      const jobId = await setupAndFit(
        request,
        csvPath,
        "target",
        fixture.task,
      );
      await waitForJobDone(request, jobId);
      await runInference(request, jobId, csvPath, false);

      await openLatestInferenceResult(page);
      await expect(
        page.getByRole("heading", { name: "Predictions" }),
      ).toBeVisible();
      await expect(page.getByRole("table").first()).toBeVisible({
        timeout: 10_000,
      });
    });
  }
});
