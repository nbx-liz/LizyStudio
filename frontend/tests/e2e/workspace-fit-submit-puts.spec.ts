import { expect, test } from "@playwright/test";
import * as fs from "node:fs";
import { isMobileProject } from "./helpers/mobile";
import { expectBudget, installFetchRecorder } from "./helpers/request-budget";
import { seedUiWorkspace } from "./helpers/workspace-ui";

/**
 * Issue #538 — Fit submit POST budget regression spec.
 *
 * Surface: clicking the Fit button on the workspace Model panel.
 * The risk class is **double-submit + polling storm**:
 *
 *   - A regression that drops the in-flight guard on the Fit button
 *     turns one user click into two ``POST /api/workspace/fit`` calls,
 *     spawning two competing jobs.
 *   - A regression in the post-submit job polling cadence (cf.
 *     #339 polling storm) inflates ``GET /api/jobs/{id}`` past the
 *     ~1 / 2s steady-state cadence.
 *
 * Budgets:
 *
 *   - ``POST /api/workspace/fit`` = **1 exactly** in the 6s window
 *     starting at click. Per #538 surface table: "POST = 1".
 *   - ``GET /api/jobs/{id}`` ≤ **8** in the same window. The polling
 *     cadence is 1 / 2s plus an immediate-fetch on the terminal
 *     WS event; 8 covers the worst case (~1 / 1s for the first 3-4s,
 *     then a terminal burst).
 *
 * Per ``feedback_count_budget_assertions`` (memory): for storm/spam
 * bugs the regression test MUST count occurrences, not just assert
 * eventual correctness.
 */

const CSV_PATH = "/tmp/e2e_fit_submit_puts.csv";
const FIT_POST_BUDGET = 1;
const JOB_POLL_BUDGET = 8;

function createTestCsv(): void {
  const rows = ["id,age,target"];
  for (let i = 0; i < 100; i += 1) {
    rows.push(`${i},${20 + (i % 50)},${i % 2}`);
  }
  fs.writeFileSync(CSV_PATH, rows.join("\n"));
}

test.describe("Fit submit — POST + job-poll budget (Issue #538)", () => {
  test.beforeAll(() => {
    createTestCsv();
  });

  test.afterAll(() => {
    if (fs.existsSync(CSV_PATH)) fs.unlinkSync(CSV_PATH);
  });

  test("single Fit click fires exactly one POST + bounded job polls", async ({
    page,
    request,
  }, testInfo) => {
    // 60s: 30s seed + 6s capture window + 20s job-complete grace.
    test.setTimeout(60_000);

    if (isMobileProject(testInfo)) {
      test.skip(
        true,
        "Mobile happy-path Fit is covered by workspace-mobile.spec.ts (B-8)",
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

    // Let the seed funnel drain so its PUTs / GETs don't bleed in.
    await page.waitForTimeout(2000);

    const fitButton = page.getByRole("button", { name: "Fit", exact: true });
    await expect(fitButton).toBeEnabled({ timeout: 15_000 });

    const sincePost = recorder.snapshot({
      method: "POST",
      urlPattern: "/api/workspace/fit",
    });
    const sinceJobGet = recorder.snapshot({
      method: "GET",
      urlPattern: /\/api\/jobs\/[^/?]+(?:\?|$)/,
    });

    // Single click — Playwright debounces the click event itself, so
    // a "stuck-button-fires-twice" regression has to come from the
    // app code rather than the test setup.
    await fitButton.click();

    // 6s capture window — long enough to observe the first few polls
    // (~3 polls at 1/2s) but short enough that the job-complete WS
    // event lands and a terminal burst is captured too.
    await page.waitForTimeout(6000);

    const fitPosts = sincePost();
    expect(
      fitPosts.length,
      `Fit click fired ${fitPosts.length} POST(s) to /workspace/fit ` +
        `(budget ${FIT_POST_BUDGET}, expected exactly 1). Risk class: ` +
        `double-submit — the button's in-flight guard must keep one ` +
        `user click === one POST. Captured:\n` +
        fitPosts
          .map(
            (p) =>
              `  keys=${
                p.bodyJson
                  ? JSON.stringify(Object.keys(p.bodyJson).sort())
                  : "(no body)"
              }`,
          )
          .join("\n"),
    ).toBe(FIT_POST_BUDGET);

    const jobGets = sinceJobGet();
    expect(
      jobGets.length,
      `Fit submit fired ${jobGets.length} GET /api/jobs/{id} call(s) in 6s ` +
        `(budget ${JOB_POLL_BUDGET}). Risk class: polling storm — see ` +
        `#339 (post-terminal GETs cascade) for the regression archetype. ` +
        `Captured URLs:\n` +
        jobGets.map((g) => `  ${g.url}`).join("\n"),
    ).toBeLessThanOrEqual(JOB_POLL_BUDGET);

    // Cross-check via the helper API on session totals.
    expectBudget(recorder, {
      method: "POST",
      urlPattern: "/api/workspace/fit",
      max: 1,
      label: "Full session (single Fit submit)",
    });
  });
});
