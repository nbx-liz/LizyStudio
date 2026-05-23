import { expect, test } from "@playwright/test";
import * as fs from "node:fs";
import { isMobileProject } from "./helpers/mobile";
import { dismissOnboarding } from "./helpers/onboarding";
import { expectBudget, installFetchRecorder } from "./helpers/request-budget";

/**
 * Issue #529 regression spec — partial-body PUTs from MetricsChips.
 *
 * Before the fix:
 *   - Clicking Target = `survived` from a clean workspace produced
 *     **2 partial-body PUTs** `{evaluation:{metrics:[...]}}` that
 *     `MetricsChips`'s task-change `useEffect` emitted while
 *     `ConfigForm`'s `configRef.current` was still empty.
 *   - The backend silently rejected these with
 *     `saved=false, blocking=5` (validation errors: `config_version`,
 *     `task`, `split`, etc. missing).
 *   - During the empty-`ws.config` window, `GET /data/split-preview`
 *     could fire and correctly return **400 WORKSPACE_NO_CONFIG**.
 *
 * The fix gates the MetricsChips task-change auto-reset on a
 * `configSeeded` prop (true once `config.config_version` is defined)
 * and pre-populates `evaluation.metrics` in `buildMergedConfig` from
 * the UiSchema's task-keyed eval registry. After both changes, the
 * partial PUTs never fire and split-preview returns 200.
 *
 * This spec uses ``installFetchRecorder`` + ``expectBudget`` from
 * ``helpers/request-budget.ts`` (Issue #538 helper extraction) so the
 * pattern is reusable for the other user-action budgets the issue
 * templates.
 *
 * Invariants asserted:
 *   1. No PUT body has only `{evaluation}` at top level (the partial
 *      signature). The body must contain at minimum `config_version`,
 *      `task`, `split`, `data` — the seed config's invariant keys.
 *   2. No GET /data/split-preview returns 400 during the Target flow.
 *   3. Total PUT count is within budget (locks in the network-noise
 *      regression and gives Bug B / #530 a numeric target to drive
 *      down further).
 */

const CSV_PATH = "/tmp/e2e_target_select_puts.csv";
// Local measurement: 2 PUTs after #529 + #530 fixes (target-select replace +
// auto-reset patch-many [objective, metric] merged by the funnel). Budget of
// 3 gives a 1-PUT headroom for CI scheduling variance (e.g. a third PUT only
// fires if the auto-reset effect happens to re-fire between the post-flush
// render and the StrictMode double-invoke; with the isFlushing gate that
// path is closed). Tighten further if the third PUT class ever vanishes.
const PUT_BUDGET = 3;

function createBinaryCsv(): void {
  const rows = ["id,age,survived"];
  for (let i = 0; i < 100; i += 1) {
    rows.push(`${i},${20 + (i % 50)},${i % 2}`);
  }
  fs.writeFileSync(CSV_PATH, rows.join("\n"));
}

test.describe("Target selection — no partial PUT, no split-preview 400 (Issue #529)", () => {
  test.beforeAll(() => {
    createBinaryCsv();
  });

  test.afterAll(() => {
    if (fs.existsSync(CSV_PATH)) fs.unlinkSync(CSV_PATH);
  });

  test("partial-body PUT regression locks", async ({
    page,
    request,
  }, testInfo) => {
    if (isMobileProject(testInfo)) {
      test.skip(
        true,
        "Mobile layout uses a different Data Panel collapse pattern; covered by the desktop project",
      );
    }

    // Reset workspace so the seed config is genuinely empty when the
    // Target selection fires. Without this, a leftover config from a
    // previous test masks the bug.
    await request.post("/api/workspace/reset");

    // Install recorder BEFORE driving any UI so we observe every
    // PUT /config from page load onward — though the partial-PUT bug
    // fires only after Target is picked, capturing the full session
    // gives diagnostic context if the test fails.
    const recorder = installFetchRecorder(page);

    // Drive the UI flow. Inlining the seed instead of using
    // `seedUiWorkspace` because that helper picks `target="target"` and
    // does its own quiescence wait that subsumes the events we want to
    // count. Here we want to count PUTs *across* the Target-select
    // window.
    await dismissOnboarding(page);
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    await page.getByRole("radio", { name: "Path" }).click();
    await page.getByPlaceholder("/path/to/data.csv").fill(CSV_PATH);
    await page.getByRole("button", { name: "Load" }).click();
    await expect(page.getByText(/100 rows × \d+ columns/)).toBeVisible({
      timeout: 15_000,
    });

    // Snapshot PUTs BEFORE the Target click so post-click delta is clean.
    const sinceTargetClick = recorder.snapshot({
      method: "PUT",
      urlPattern: "/api/workspace/config",
    });

    const combo = page.getByRole("combobox", { name: /target column/i });
    await expect(combo).toBeEnabled({ timeout: 15_000 });
    await combo.click();
    await page.getByRole("option", { name: "survived" }).click();

    // Wait for the funnel to drain. 3s is generous against typical
    // 200 ms convergence; CI machines vary.
    await page.waitForTimeout(3000);

    const targetPuts = sinceTargetClick();

    // Invariant 1: NO partial-body PUTs. A partial body has only
    // `evaluation` (or a tiny subset) as the top-level key set. Every
    // PUT must carry the seed config invariants (config_version, task,
    // split).
    const partials = targetPuts.filter((p) => {
      const body = p.bodyJson;
      if (!body) return true;
      return !("config_version" in body) || !("task" in body) || !("split" in body);
    });
    expect(
      partials,
      `Issue #529 regression — partial-body PUT(s) observed.
` +
        `These bodies lack config_version/task/split and the backend ` +
        `rejects them with saved=false, blocking=5. Captured:
` +
        partials
          .map(
            (p) =>
              `  keys=${
                p.bodyJson ? JSON.stringify(Object.keys(p.bodyJson).sort()) : "(no body)"
              }`,
          )
          .join("\n"),
    ).toHaveLength(0);

    // Invariant 2: split-preview never 400'd. Bug C disappears when
    // Bug A is fixed because ws.config is always populated.
    const splitPreview400s = recorder.matchingResponses({
      urlPattern: "/api/workspace/data/split-preview",
      status: 400,
    });
    expect(
      splitPreview400s,
      `Issue #531 regression — GET /split-preview returned 400 ` +
        `WORKSPACE_NO_CONFIG. Likely cause: partial PUT from MetricsChips ` +
        `left ws.config empty (Issue #529 root cause).`,
    ).toHaveLength(0);

    // Invariant 3: PUT count within budget. Pre-#529 fix: 9 PUTs.
    // After #529 (PR-A): 4 PUTs. After #530 Phase 1 (coalesce
    // patches): 3 PUTs. After #530 Phase 2 (isFlushing gate): 2 PUTs.
    // Budget locks the converged value plus a 1-PUT headroom for CI
    // scheduling variance. If this fails, suspect a new useEffect
    // that derives state from cache and emits a write, OR a regression
    // in `coalesceByReason` / the `isFlushing` gate.
    expect(
      targetPuts.length,
      `Target-select fired ${targetPuts.length} PUTs (budget ${PUT_BUDGET}). ` +
        `History: 9 -> 4 (#529) -> 3 (#530 Phase 1) -> 2 (#530 Phase 2). ` +
        `Investigate if it exceeds the budget — suspect a new useEffect ` +
        `that derives state from cache and emits a write, or a regression ` +
        `in coalesceByReason / the isFlushing gate.`,
    ).toBeLessThanOrEqual(PUT_BUDGET);

    // Bonus: smoke-test the helper's expectBudget on the same data so
    // a future regression in either the helper or the underlying
    // observer surfaces immediately. Same threshold; redundant by
    // design.
    expectBudget(recorder, {
      method: "PUT",
      urlPattern: "/api/workspace/config",
      max: PUT_BUDGET + 1, // +1 because expectBudget counts session-wide, not just post-snapshot
      label: "Target-select click (session-wide PUT count)",
    });
  });
});
