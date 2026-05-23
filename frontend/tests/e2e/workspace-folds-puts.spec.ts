import { expect, test } from "@playwright/test";
import * as fs from "node:fs";
import { isMobileProject } from "./helpers/mobile";
import { expectBudget, installFetchRecorder } from "./helpers/request-budget";
import { seedUiWorkspace } from "./helpers/workspace-ui";

/**
 * Issue #538 — Folds spinbutton PUT budget regression spec.
 *
 * Surface: rapid value changes on the ``split.n_splits`` Folds
 * NumberInput. CvSection wires the input through ``ConfigForm`` so each
 * value commit fans out through the same write funnel that landed the
 * v0.6.2 Target-select bug cluster. The risk class is **debounce
 * regression**: a future refactor that drops the funnel coalesce or
 * splits the field into a one-PUT-per-keystroke shape would inflate
 * the write count linearly with edit speed.
 *
 * Budget: ≤ 3 PUTs across a sequence of 4 quick fill+blur events
 * (5 → 3 → 7 → 4 → 6). Per #538 surface table: "PUT ≤ 3 in 1s window".
 * The +1 headroom over "ideally 1 coalesced PUT" covers the legitimate
 * funnel cadence where consecutive blurs may straddle a flush boundary.
 *
 * Companion budget: ``GET /api/workspace/data/split-preview`` ≤ 3.
 * Each n_splits change should re-fetch the preview, but never more
 * than once per coalesced PUT.
 *
 * Per ``feedback_count_budget_assertions`` (memory): for storm/spam
 * bugs the regression test MUST count occurrences, not just assert
 * eventual correctness.
 */

const CSV_PATH = "/tmp/e2e_folds_puts.csv";
const PUT_BUDGET = 3;
const SPLIT_PREVIEW_BUDGET = 3;

function createTestCsv(): void {
  const rows = ["id,age,target"];
  for (let i = 0; i < 100; i += 1) {
    rows.push(`${i},${20 + (i % 50)},${i % 2}`);
  }
  fs.writeFileSync(CSV_PATH, rows.join("\n"));
}

test.describe("Folds spinbutton — PUT + split-preview budget (Issue #538)", () => {
  test.beforeAll(() => {
    createTestCsv();
  });

  test.afterAll(() => {
    if (fs.existsSync(CSV_PATH)) fs.unlinkSync(CSV_PATH);
  });

  test("rapid Folds value changes stay within budget", async ({
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
    // starts from the Folds-change sequence.
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

    // Drive 4 rapid fill+blur sequences on the Folds NumberInput.
    // CvSection sets ariaLabel="Folds" so the <input> surfaces as
    // role=textbox with that accessible name (matches the field-fixture
    // table in workspace-config-fields-loop.spec.ts).
    const foldsInput = page.getByRole("textbox", { name: "Folds", exact: true });
    await expect(foldsInput).toBeEnabled({ timeout: 10_000 });

    for (const value of ["3", "7", "4", "6"]) {
      await foldsInput.fill(value);
      await foldsInput.blur();
      // Brief delay so each value commit propagates through onChange
      // but the funnel still gets a chance to coalesce adjacent edits.
      await page.waitForTimeout(150);
    }

    // 3s drain budget — matches workspace-cv-strategy-puts.
    await page.waitForTimeout(3000);

    const foldsPuts = sincePut();
    expect(
      foldsPuts.length,
      `4 rapid Folds edits fired ${foldsPuts.length} PUT(s) (budget ${PUT_BUDGET}). ` +
        `Risk class: debounce regression — the write funnel should coalesce ` +
        `rapid edits, not emit one PUT per fill+blur. Captured:\n` +
        foldsPuts
          .map(
            (p) =>
              `  keys=${
                p.bodyJson
                  ? JSON.stringify(Object.keys(p.bodyJson).sort())
                  : "(no body)"
              }`,
          )
          .join("\n"),
    ).toBeLessThanOrEqual(PUT_BUDGET);

    const previewGets = sincePreview();
    expect(
      previewGets.length,
      `4 rapid Folds edits fired ${previewGets.length} GET /split-preview(s) ` +
        `(budget ${SPLIT_PREVIEW_BUDGET}). One refetch per coalesced PUT is ` +
        `expected; more suggests preview cache-invalidation runs ahead of the ` +
        `funnel flush.`,
    ).toBeLessThanOrEqual(SPLIT_PREVIEW_BUDGET);

    // Cross-check via the helper API on session totals.
    expectBudget(recorder, {
      method: "PUT",
      urlPattern: "/api/workspace/config",
      // Session budget = seed PUTs (≈ 2-4) + Folds-edit PUTs (≤ 3).
      max: 8,
      label: "Full session (seed + 4 Folds edits)",
    });
  });
});
