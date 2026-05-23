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
 * The risk class is **double-click guard** — a regression that drops
 * the in-flight gate on the Run button turns a too-fast double-click
 * into two ``POST /api/inference/run`` calls and two parallel
 * inference records, with the second one usually losing the race for
 * the file lock and 500-ing.
 *
 * Budget: ``POST /api/inference/run`` = **1 exactly** for two
 * back-to-back clicks. The spec deliberately double-clicks; the
 * button's disabled state during the in-flight request must absorb
 * the second click silently.
 *
 * Per #538 surface table: "POST = 1". Per
 * ``feedback_count_budget_assertions`` (memory): storm/spam bugs
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

  test("double-click Run Inference fires exactly one POST", async ({
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

    // Double-click — Playwright's ``dblclick`` fires two clicks
    // back-to-back, which is exactly the "rapid mouse double-tap"
    // scenario the in-flight guard must defend against. We use
    // explicit pair-clicks instead of ``dblclick`` so that even if
    // the button moves to disabled between the two clicks, the
    // second click is still attempted.
    await runButton.click();
    // ``noWaitAfter`` would skip the actionability checks; we want
    // them so a regression that flips the button to disabled (the
    // correct behaviour) still has the second click attempted.
    await runButton.click({ force: true }).catch(() => {
      // Force-click can throw if the button is genuinely disabled —
      // that's the *correct* state. Swallow so the assertion below
      // is what fails the test, not the click attempt.
    });

    // 6s capture window — long enough that any delayed second POST
    // from a debounce regression has landed.
    await page.waitForTimeout(6000);

    const inferPosts = sincePost();
    expect(
      inferPosts.length,
      `Double-click on Run Inference fired ${inferPosts.length} POST(s) ` +
        `(budget ${INFER_POST_BUDGET}, expected exactly 1). Risk class: ` +
        `double-click guard — the button's in-flight disabled state must ` +
        `absorb the second click silently. Captured:\n` +
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
