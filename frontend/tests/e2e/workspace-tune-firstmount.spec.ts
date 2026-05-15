import { expect, test } from "@playwright/test";
import * as fs from "node:fs";
import { isMobileProject } from "./helpers/mobile";
import { seedUiWorkspace } from "./helpers/workspace-ui";

/**
 * P-0109 PR-5 regression spec — Tune tab first-mount rendering.
 *
 * The user-visible bug: opening the Tune tab on a fresh workspace
 * rendered all 13 catalog rows in **Fixed** mode instead of their
 * canonical Range/Choice modes. Root cause diagnosis (2026-05-14):
 * three useEffects (TuneTab search-space init, TuneEvaluationSection
 * direction defensive sync, TuneEvaluationSection metrics seed) all
 * enqueued same-reason ``config-form-edit`` writes through the
 * ConfigWriteFunnel. The funnel coalesces same-reason writes to the
 * last-arriver, so the search-space write lost every time and the
 * rows defaulted to Fixed.
 *
 * PR-5 deletes all three useEffects and falls back to render-time
 * memos / fallbacks. No PUT fires on first mount, so the funnel race
 * has no writes to coalesce. The first PUT happens only when the user
 * explicitly edits a row.
 *
 * This spec drives the user flow that produced the bug:
 *
 *   1. Load CSV (binary classification).
 *   2. Switch from the default Fit tab to the Tune tab.
 *   3. Confirm there is no automatic ``PUT /api/workspace/config``
 *      carrying ``tuning.optuna.space`` (the canonical signature of
 *      the deleted useEffect's write).
 *   4. Confirm the Search Space accordion mounts with at least the
 *      ``Learning Rate`` Range row visible — the row the user saw
 *      mis-rendered as Fixed pre-PR-5.
 */

const CSV_PATH = "/tmp/e2e_tune_firstmount.csv";

function createBinaryCsv(): void {
  const rows = ["id,age,target"];
  for (let i = 0; i < 100; i += 1) {
    rows.push(`${i},${20 + (i % 50)},${i % 2}`);
  }
  fs.writeFileSync(CSV_PATH, rows.join("\n"));
}

test.describe("Tune tab first-mount (P-0109 PR-5 regression)", () => {
  test.beforeAll(() => {
    createBinaryCsv();
  });

  test.afterAll(() => {
    if (fs.existsSync(CSV_PATH)) fs.unlinkSync(CSV_PATH);
  });

  test("Switching to Tune tab does NOT fire a PUT /config carrying tuning.optuna.space", async ({
    page,
  }, testInfo) => {
    if (isMobileProject(testInfo)) {
      test.skip(
        true,
        "Mobile layout collapses the Tune tab into a separate bottom-tab",
      );
    }

    await seedUiWorkspace(page, testInfo, {
      csvPath: CSV_PATH,
      target: "target",
      expectedRows: 100,
    });

    // Watch for any PUT /config whose body sets ``tuning.optuna.space``
    // — that is the exact wire signature of the deleted useEffect. If
    // PR-5 regresses, we will see this request fire on first mount.
    const offendingPuts: string[] = [];
    page.on("request", (req) => {
      if (req.method() !== "PUT") return;
      if (!req.url().endsWith("/api/workspace/config")) return;
      let body: Record<string, unknown> | null = null;
      try {
        body = req.postDataJSON() as Record<string, unknown>;
      } catch {
        return;
      }
      const tuning = body?.tuning as Record<string, unknown> | undefined;
      const optuna = tuning?.optuna as Record<string, unknown> | undefined;
      const space = optuna?.space as Record<string, unknown> | undefined;
      if (space && Object.keys(space).length > 0) {
        offendingPuts.push(JSON.stringify(space).slice(0, 200));
      }
    });

    // Switch to the Tune tab.
    await page.getByRole("tab", { name: "Tune", exact: true }).click();

    // Give the (now-deleted) useEffects time to run if a regression
    // re-introduces them. 800ms is generous against the typical
    // funnel debounce window (~150–500ms) plus a margin.
    await page.waitForTimeout(800);

    expect(
      offendingPuts,
      `PR-5 regression — PUT /config carried tuning.optuna.space on first mount. ` +
        `Likely cause: the deleted "search-space init" useEffect in TuneTab ` +
        `has been resurrected, or a new useEffect with the same write shape ` +
        `was added. Captured bodies:\n${offendingPuts.join("\n")}`,
    ).toHaveLength(0);
  });
});
