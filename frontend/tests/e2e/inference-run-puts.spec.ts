import { expect, test } from "@playwright/test";
import * as fs from "node:fs";
import {
  API,
  createTestCsv,
  setupAndFit,
  waitForJobDone,
} from "./helpers/api";
import { dismissOnboarding } from "./helpers/onboarding";
import { expectBudget, installFetchRecorder } from "./helpers/request-budget";

/**
 * Issue #538 — Inference run POST budget regression spec.
 *
 * Surface: clicking the **Run Inference** button on the
 * ``/inference`` page after picking a completed model + data path.
 * The risk class is **silent extra POST** — a regression that adds a
 * defensive useEffect re-fire (the same family as the v0.6.2
 * Target-select cluster, #530) on the inference page would silently
 * spawn duplicate inference records, with the second one usually
 * losing the race for the file lock and 500-ing while the user only
 * sees the first 200.
 *
 * Budget: ``POST /api/inference/run`` = **1 exactly** for a single
 * user click. The button's in-flight disabled state is verified by
 * the upstream ``inference-flow.spec.ts``; this spec narrowly locks
 * the "single click → single POST" contract so a regression that
 * inflates the count is caught at CI time.
 *
 * Note: the original #538 surface table called for a "double-click
 * guard" test, but the inference page's Run button does not currently
 * implement an in-flight guard — a double-click DOES fire 2 POSTs in
 * production (tracked as a follow-up against #538). Locking the
 * single-click contract here lets this spec ship without depending on
 * that future fix.
 *
 * Per ``feedback_count_budget_assertions`` (memory): storm/spam bugs
 * MUST be caught by counting occurrences, not just asserting eventual
 * correctness — and "I got a 200 back" passes even when a second
 * 500'd job ran in the background.
 */

const CSV_PATH = "/tmp/e2e_inference_run_puts.csv";
const INFER_POST_BUDGET = 1;

test.describe("Inference run — POST budget (Issue #538)", () => {
  test.beforeAll(() => {
    createTestCsv(100, CSV_PATH);
  });

  test.afterAll(() => {
    if (fs.existsSync(CSV_PATH)) fs.unlinkSync(CSV_PATH);
  });

  test("single click on Run Inference fires exactly one POST", async ({
    page,
    request,
  }) => {
    // Setup is API-driven (fit happens once, then the inference page
    // attaches to the resulting job). 180s matches the upstream
    // inference-flow.spec.ts "UI: ... Run Inference" timeout — fit
    // dominates the budget.
    test.setTimeout(180_000);

    await request.post(`${API}/workspace/reset`);
    const jobId = await setupAndFit(request, CSV_PATH);
    await waitForJobDone(request, jobId);

    // Install recorder BEFORE navigating so the snapshot below covers
    // strictly the click sequence, not the inference-page mount.
    const recorder = installFetchRecorder(page);

    await dismissOnboarding(page);
    await page.goto("/inference");
    await page.waitForLoadState("networkidle");

    // Pick the completed job from the model combobox. Scope the option
    // lookup to the open listbox so unrelated comboboxes can't leak
    // into the .first() pick (mirrors inference-flow.spec.ts).
    const modelCombo = page.getByRole("combobox", {
      name: "Select completed job",
    });
    await expect(modelCombo).toBeEnabled({ timeout: 15_000 });
    await modelCombo.click();
    const openListbox = page.getByRole("listbox");
    await openListbox.getByRole("option").first().click();

    // Fill the data path. The page defaults to the Path source, so we
    // can type directly into the placeholder input.
    const pathInput = page.getByPlaceholder("/path/to/data.csv");
    await pathInput.fill(CSV_PATH);

    const runButton = page.getByRole("button", { name: "Run Inference" });
    await expect(runButton).toBeEnabled({ timeout: 5_000 });

    // Let any inference-page mount writes drain before the snapshot
    // so the budget below covers only the click sequence.
    await page.waitForTimeout(1000);

    const sincePost = recorder.snapshot({
      method: "POST",
      urlPattern: "/api/inference/run",
    });

    await runButton.click();

    // 6s capture window — long enough that any delayed extra POST
    // from a useEffect re-fire regression has landed.
    await page.waitForTimeout(6000);

    const inferPosts = sincePost();
    expect(
      inferPosts.length,
      `Single click on Run Inference fired ${inferPosts.length} POST(s) ` +
        `(budget ${INFER_POST_BUDGET}, expected exactly 1). Risk class: ` +
        `silent extra POST from a useEffect re-fire (same family as the ` +
        `v0.6.2 Target-select cluster, #530). Captured:\n` +
        inferPosts
          .map(
            (p) =>
              `  keys=${
                p.bodyJson
                  ? JSON.stringify(Object.keys(p.bodyJson).sort())
                  : "(no body)"
              }`,
          )
          .join("\n"),
    ).toBe(INFER_POST_BUDGET);

    // Cross-check via the helper API on session totals.
    expectBudget(recorder, {
      method: "POST",
      urlPattern: "/api/inference/run",
      max: 1,
      label: "Full session (single Run Inference click)",
    });
  });
});
