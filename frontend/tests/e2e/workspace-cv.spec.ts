import { expect, test } from "@playwright/test";
import * as fs from "node:fs";
import { API, createTestCsv } from "./helpers/api";
import { waitForConfigSettle } from "./helpers/config-reflection";
import { isMobileProject } from "./helpers/mobile";
import { seedUiWorkspace } from "./helpers/workspace-ui";

/**
 * B-3 (gui-e2e-plan.md) — CV strategy switching invariants.
 *
 * The post-#271 smoke surfaced multiple state-sync regressions where
 * clicking a CV Strategy radio failed to land the new method on the
 * server (#272 / #278), or where switching strategies left the previous
 * strategy's fields in the wire payload and tripped Pydantic
 * validation (#258 / #259). PR #281 (P-0087) locked the schema-level
 * drift via contract tests; this spec adds the matching UI-level lock:
 *
 *   - Clicking each Strategy radio drives `split.method` to that wire
 *     value through PUT /api/workspace/config.
 *   - The saved config exposes ONLY the fields declared by that
 *     strategy's Pydantic model — fields belonging to a previously
 *     selected strategy must not leak through.
 *
 * Group-dependent strategies (group_kfold / stratified_group_kfold /
 * group_time_series / blocked_group_kfold) are exercised via the same
 * radio click, but `group_col` defaults to null on the seeded dataset
 * (no group column selected) — that's still the regression we want to
 * prevent: clicking the radio MUST update method even when downstream
 * fields aren't filled in. Filling in group_col / time_col is covered
 * by the per-field reflection specs (D-3 onward).
 *
 * BlockedGroupKFold is excluded from the simple loop because it has a
 * dedicated 2-axis editor that reshapes the entire panel; it warrants
 * its own spec (B-3b, deferred).
 */

const CSV_PATH = "/tmp/e2e_cv_strategy.csv";

// Allowed top-level keys per strategy. Must match the lizyml Pydantic
// `*Config.model_fields` for each method. If a backend bump adds or
// removes a field, this array is the canary that flips red.
const ALLOWED_SPLIT_KEYS: Record<string, readonly string[]> = {
  kfold: ["method", "n_splits", "random_state", "shuffle"],
  stratified_kfold: ["method", "n_splits", "random_state"],
  group_kfold: ["method", "n_splits"],
  stratified_group_kfold: ["method", "n_splits", "random_state", "shuffle"],
  time_series: [
    "method",
    "n_splits",
    "gap",
    "train_size_max",
    "test_size_max",
  ],
  purged_time_series: [
    "method",
    "n_splits",
    "purge_gap",
    "embargo",
    "train_size_max",
    "test_size_max",
  ],
  group_time_series: [
    "method",
    "n_splits",
    "gap",
    "train_size_max",
    "test_size_max",
  ],
};

const STRATEGY_LABELS: Record<string, string> = {
  kfold: "KFold",
  stratified_kfold: "StratifiedKFold",
  group_kfold: "GroupKFold",
  stratified_group_kfold: "StratifiedGroup",
  time_series: "TimeSeriesSplit",
  purged_time_series: "PurgedTimeSeries",
  group_time_series: "GroupTimeSeries",
};

test.describe("Workspace CV strategy switching (B-3)", () => {
  test.beforeAll(() => {
    createTestCsv(100, CSV_PATH);
  });

  test.afterAll(() => {
    if (fs.existsSync(CSV_PATH)) fs.unlinkSync(CSV_PATH);
  });

  test.beforeEach(async ({ request }) => {
    await request.post(`${API}/workspace/reset`);
  });

  // One test per strategy. We intentionally do NOT loop them inside one
  // test — Playwright's report becomes much more useful when each
  // strategy is its own independent failure (caller can rerun a single
  // strategy without rebuilding the whole CV state).
  for (const [strategy, label] of Object.entries(STRATEGY_LABELS)) {
    test(`switching to ${strategy} sets split.method and prunes prior strategy fields`, async ({
      page,
      request,
    }, testInfo) => {
      if (isMobileProject(testInfo)) {
        test.skip(
          true,
          "Mobile layout collapses Data accordion; covered by B-8",
        );
      }

      await seedUiWorkspace(page, testInfo, {
        csvPath: CSV_PATH,
        target: "target",
        expectedRows: 100,
      });

      // useConfigSync issues several PUTs after target selection (one
      // per state dependency) before settling on the seeded default.
      // Wait for that burst to land before treating the saved config
      // as the baseline — otherwise the GET races against an in-flight
      // PUT and `seeded.split` can be observed as undefined.
      const seeded = await waitForConfigSettle(
        request,
        (cfg) =>
          (cfg.split as Record<string, unknown> | undefined)?.method ===
          "stratified_kfold",
      );
      // Sanity guard: seedUiWorkspace lands on stratified_kfold for a
      // binary classification target. If the default ever changes we
      // want this to fail loudly with a meaningful message rather than
      // a confusing downstream mismatch.
      expect((seeded.split as Record<string, unknown>).method).toBe(
        "stratified_kfold",
      );

      // The Strategy SegmentGroup renders each method as a role=radio
      // with the visible label as accessible name. Click the radio and
      // poll the saved config until the new method lands. We do not
      // try to single out the "right" PUT in waitForRequest because
      // useConfigSync emits a short burst of PUTs across multiple
      // useEffect re-runs after a state change — racing against that
      // burst is brittle. The saved config (post-burst) is the
      // observable contract we actually want to lock.
      const strategyRadio = page.getByRole("radio", {
        name: label,
        exact: true,
      });
      await expect(strategyRadio).toBeVisible();
      await strategyRadio.click();

      const after = await waitForConfigSettle(
        request,
        (cfg) =>
          (cfg.split as Record<string, unknown> | undefined)?.method ===
          strategy,
      );
      const splitAfter = after.split as Record<string, unknown>;
      expect(splitAfter.method).toBe(strategy);

      // post-#271 invariant: the saved split block exposes ONLY the
      // fields declared by the new strategy's Pydantic model. Fields
      // belonging to a previously selected strategy must not survive
      // the discriminated union.
      const allowed = ALLOWED_SPLIT_KEYS[strategy];
      const actualKeys = Object.keys(splitAfter).sort();
      const unexpected = actualKeys.filter((k) => !allowed.includes(k));
      expect(
        unexpected,
        `unexpected split keys for ${strategy}: ${unexpected.join(", ")}`,
      ).toEqual([]);
    });
  }
});
