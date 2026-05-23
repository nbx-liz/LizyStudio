import { expect, test } from "@playwright/test";
import * as fs from "node:fs";
import { isMobileProject } from "./helpers/mobile";
import { expectBudget, installFetchRecorder } from "./helpers/request-budget";
import { seedUiWorkspace } from "./helpers/workspace-ui";

/**
 * Issue #538 — Tune submit POST budget regression spec.
 *
 * Surface: clicking the Tune button after switching from the Fit tab
 * to the Tune tab. The risk class is **double-submit + replay** —
 * the latter being the regression archetype from #341 (TanStack
 * double-fire on terminal). A regression that re-arms the WS effect
 * during the invalidate-refetch window can cascade into multiple
 * POSTs to ``/workspace/tune`` even from a single user click.
 *
 * Budgets:
 *
 *   - ``POST /api/workspace/tune`` = **1 exactly** in the 6s window
 *     starting at click. Per #538 surface table: "POST = 1,
 *     replay-free".
 *   - ``GET /api/jobs/{id}`` ≤ **8** in the same window. Tune jobs
 *     have the same polling-cadence contract as Fit (see
 *     workspace-fit-submit-puts.spec.ts for the budget derivation).
 *
 * Per ``feedback_count_budget_assertions`` (memory): for storm/spam
 * bugs the regression test MUST count occurrences, not just assert
 * eventual correctness.
 */

const CSV_PATH = "/tmp/e2e_tune_submit_puts.csv";
const TUNE_POST_BUDGET = 1;
const JOB_POLL_BUDGET = 8;

function createTestCsv(): void {
  const rows = ["id,age,target"];
  for (let i = 0; i < 100; i += 1) {
    rows.push(`${i},${20 + (i % 50)},${i % 2}`);
  }
  fs.writeFileSync(CSV_PATH, rows.join("\n"));
}

test.describe("Tune submit — POST + job-poll budget (Issue #538)", () => {
  test.beforeAll(() => {
    createTestCsv();
  });

  test.afterAll(() => {
    if (fs.existsSync(CSV_PATH)) fs.unlinkSync(CSV_PATH);
  });

  test("single Tune click fires exactly one POST + bounded job polls", async ({
    page,
    request,
  }, testInfo) => {
    // 60s: 30s seed + 6s capture window + 20s job-complete grace.
    test.setTimeout(60_000);

    if (isMobileProject(testInfo)) {
      test.skip(
        true,
        "Mobile happy-path Tune is covered by workspace-mobile.spec.ts (B-8)",
      );
    }

    await request.post("/api/workspace/reset");

    // Install recorder BEFORE seeding so the post-snapshot delta
    // captures only the click + immediate poll window.
    const recorder = installFetchRecorder(page);
    await seedUiWorkspace(page, testInfo, {
      csvPath: CSV_PATH,
      target: "target",
      expectedRows: 100,
    });

    // Switch to the Tune tab. The Tune button is mounted lazily on
    // first navigation; the tab click also doesn't write (proven by
    // workspace-tab-switch-puts.spec.ts) so its PUT trail is already
    // bounded.
    await page.getByRole("tab", { name: "Tune" }).click();
    const tuneButton = page.getByRole("button", { name: "Tune", exact: true });
    await expect(tuneButton).toBeEnabled({ timeout: 15_000 });

    // Let any first-mount Tune-tab writes drain before the snapshot
    // (workspace-tune-firstmount.spec.ts pins the upper bound at 0,
    // but we wait anyway so the budget below is unambiguously about
    // the click and nothing else).
    await page.waitForTimeout(2000);

    const sincePost = recorder.snapshot({
      method: "POST",
      urlPattern: "/api/workspace/tune",
    });
    const sinceJobGet = recorder.snapshot({
      method: "GET",
      urlPattern: /\/api\/jobs\/[^/?]+(?:\?|$)/,
    });

    await tuneButton.click();

    // 6s capture window — same as fit-submit. Tune jobs take longer
    // than fit but the polling cadence contract is identical.
    await page.waitForTimeout(6000);

    const tunePosts = sincePost();
    expect(
      tunePosts.length,
      `Tune click fired ${tunePosts.length} POST(s) to /workspace/tune ` +
        `(budget ${TUNE_POST_BUDGET}, expected exactly 1). Risk class: ` +
        `double-submit + replay (see #341 TanStack double-fire). ` +
        `Captured:\n` +
        tunePosts
          .map(
            (p) =>
              `  keys=${
                p.bodyJson
                  ? JSON.stringify(Object.keys(p.bodyJson).sort())
                  : "(no body)"
              }`,
          )
          .join("\n"),
    ).toBe(TUNE_POST_BUDGET);

    const jobGets = sinceJobGet();
    expect(
      jobGets.length,
      `Tune submit fired ${jobGets.length} GET /api/jobs/{id} call(s) in 6s ` +
        `(budget ${JOB_POLL_BUDGET}). Risk class: polling storm (#339) + ` +
        `replay loop (#341). Captured URLs:\n` +
        jobGets.map((g) => `  ${g.url}`).join("\n"),
    ).toBeLessThanOrEqual(JOB_POLL_BUDGET);

    // Cross-check via the helper API on session totals.
    expectBudget(recorder, {
      method: "POST",
      urlPattern: "/api/workspace/tune",
      max: 1,
      label: "Full session (single Tune submit)",
    });
  });
});
