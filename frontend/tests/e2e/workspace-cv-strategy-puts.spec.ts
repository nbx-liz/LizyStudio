import { expect, test } from "@playwright/test";
import * as fs from "node:fs";
import { isMobileProject } from "./helpers/mobile";
import { expectBudget, installFetchRecorder } from "./helpers/request-budget";
import { seedUiWorkspace } from "./helpers/workspace-ui";

/**
 * Issue #538 — CV strategy change PUT budget regression spec.
 *
 * Surface: clicking a CV strategy radio (e.g. KFold → TimeSeriesSplit)
 * is identified in the #538 surface table as the **highest-risk**
 * write-budget surface because it shares the
 * "auto-reset useEffect chain" with the v0.6.2 Target-select cluster
 * (#530). Specifically:
 *
 *   - The strategy change rewrites ``split.method`` AND prunes the
 *     no-longer-applicable strategy-specific fields (e.g. switching
 *     from kfold → time_series drops `random_state` / `shuffle`).
 *   - This fans out as 2 hooks emitting writes within one frame, and
 *     the funnel coalesces them.
 *
 * Budget: ≤ 2 PUTs per strategy click (matches the #538 surface table
 * "PUT ≤ 2" entry). split-preview GET ≤ 1 follows directly.
 *
 * Per ``feedback_count_budget_assertions`` (memory): for storm/spam
 * bugs the regression test MUST count occurrences, not just assert
 * eventual correctness.
 */

const CSV_PATH = "/tmp/e2e_cv_strategy_puts.csv";
const PUT_BUDGET = 2;
const SPLIT_PREVIEW_BUDGET = 1;

function createTestCsv(): void {
  const rows = ["id,age,target"];
  for (let i = 0; i < 100; i += 1) {
    rows.push(`${i},${20 + (i % 50)},${i % 2}`);
  }
  fs.writeFileSync(CSV_PATH, rows.join("\n"));
}

test.describe("CV strategy change — PUT + split-preview budget (Issue #538)", () => {
  test.beforeAll(() => {
    createTestCsv();
  });

  test.afterAll(() => {
    if (fs.existsSync(CSV_PATH)) fs.unlinkSync(CSV_PATH);
  });

  test("KFold → TimeSeriesSplit stays within budget", async ({
    page,
    request,
  }, testInfo) => {
    if (isMobileProject(testInfo)) {
      test.skip(
        true,
        "Mobile layout collapses the Data accordion; covered by B-8",
      );
    }

    await request.post("/api/workspace/reset");

    // Install recorder BEFORE seeding so the snapshot below truly
    // starts from the strategy click.
    const recorder = installFetchRecorder(page);
    await seedUiWorkspace(page, testInfo, {
      csvPath: CSV_PATH,
      target: "target",
      expectedRows: 100,
    });

    // Let the seed funnel drain so its PUTs don't bleed into the budget.
    await page.waitForTimeout(2000);

    const sincePut = recorder.snapshot({
      method: "PUT",
      urlPattern: "/api/workspace/config",
    });
    const sincePreview = recorder.snapshot({
      method: "GET",
      urlPattern: "/api/workspace/data/split-preview",
    });

    // Click the TimeSeriesSplit radio — drives split.method and prunes
    // stratified_kfold-only fields (random_state, shuffle).
    const radio = page.getByRole("radio", { name: "TimeSeriesSplit" });
    await expect(radio).toBeEnabled({ timeout: 10_000 });
    await radio.click();

    // 3s drain budget — same as workspace-target-select-puts.
    await page.waitForTimeout(3000);

    const strategyPuts = sincePut();
    expect(
      strategyPuts.length,
      `CV strategy change fired ${strategyPuts.length} PUT(s) (budget ${PUT_BUDGET}). ` +
        `Risk class: auto-reset useEffect chain (same hook family as ` +
        `#530 Target-select oscillation). Captured:\n` +
        strategyPuts
          .map(
            (p) =>
              `  keys=${
                p.bodyJson ? JSON.stringify(Object.keys(p.bodyJson).sort()) : "(no body)"
              }`,
          )
          .join("\n"),
    ).toBeLessThanOrEqual(PUT_BUDGET);

    const previewGets = sincePreview();
    expect(
      previewGets.length,
      `CV strategy change fired ${previewGets.length} GET /split-preview(s) ` +
        `(budget ${SPLIT_PREVIEW_BUDGET}). One refetch per method change is ` +
        `expected; more suggests cache-invalidation cascade.`,
    ).toBeLessThanOrEqual(SPLIT_PREVIEW_BUDGET);

    // Cross-check via the helper API on session totals.
    expectBudget(recorder, {
      method: "PUT",
      urlPattern: "/api/workspace/config",
      // Session budget = seed PUTs (≈ 2-4) + strategy-click PUTs (≤ 2).
      max: 8,
      label: "Full session (seed + strategy click)",
    });
  });
});
