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
 * Issue #538 / #559 — Inference run POST budget regression spec.
 *
 * Surface: clicking the **Run Inference** button on the
 * ``/inference`` page after picking a completed model + data path.
 *
 * Risk classes (both locked here):
 *
 *   1. **Silent extra POST** from a useEffect re-fire (same family
 *      as the v0.6.2 Target-select cluster, #530). A regression that
 *      adds a defensive effect re-firing the mutation would inflate
 *      the per-click POST count.
 *   2. **Double-click guard** (#559). ``mutation.isPending`` is React
 *      state and only flips to true after the next render; a
 *      synthetic double-click within one event-loop tick used to
 *      race past the DOM ``disabled`` update and fire 2 POSTs. PR
 *      that closes #559 adds a synchronous ``inFlightRef`` so the
 *      second ``mutate()`` call is absorbed before it leaves the
 *      handler.
 *
 * Budget: ``POST /api/inference/run`` = **1 exactly** for **two
 * back-to-back clicks**. The spec deliberately drives the
 * race condition that surfaced #559; the in-flight ref keeps the
 * count at 1.
 *
 * Per ``feedback_count_budget_assertions`` (memory): storm/spam bugs
 * MUST be caught by counting occurrences, not just asserting eventual
 * correctness — and "I got a 200 back" passes even when a second
 * 500'd job ran in the background.
 */

const CSV_PATH = "/tmp/e2e_inference_run_puts.csv";
const INFER_POST_BUDGET = 1;

test.describe("Inference run — POST budget (Issue #538 / #559)", () => {
  test.beforeAll(() => {
    createTestCsv(100, CSV_PATH);
  });

  test.afterAll(() => {
    if (fs.existsSync(CSV_PATH)) fs.unlinkSync(CSV_PATH);
  });

  test("double-click on Run Inference fires exactly one POST", async ({
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

    // Issue #559 — drive the race condition. The first click sets
    // ``inFlightRef.current = true`` synchronously inside the
    // ``runInferenceAction`` callback BEFORE ``mutation.mutate()``
    // returns; the second click hits the same handler in the same
    // event-loop tick and is absorbed by the ref check.
    //
    // ``{ force: true, noWaitAfter: true }`` skips Playwright's
    // actionability checks so the second click is attempted even if
    // the button transitions to disabled in the DOM between the two
    // events (which is the correct end state, but is async). If the
    // ref guard is removed, this DOES fire a second POST and the
    // budget assertion below fails.
    await runButton.click();
    await runButton
      .click({ force: true, noWaitAfter: true })
      .catch(() => {
        // Force-click can throw if the button is genuinely disabled.
        // That's the correct end state and complementary to the ref
        // guard; swallow so the assertion below is what fails the
        // test, not the click attempt.
      });

    // 6s capture window — long enough that any delayed extra POST
    // from a useEffect re-fire regression has landed.
    await page.waitForTimeout(6000);

    const inferPosts = sincePost();
    expect(
      inferPosts.length,
      `Double-click on Run Inference fired ${inferPosts.length} POST(s) ` +
        `(budget ${INFER_POST_BUDGET}, expected exactly 1). Risk classes: ` +
        `(1) silent extra POST from useEffect re-fire (#530 family); ` +
        `(2) double-click guard regression (#559 — synchronous ` +
        `inFlightRef in InferencePage.runInferenceAction). Captured:\n` +
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
      label: "Full session (double-click Run Inference)",
    });
  });
});
