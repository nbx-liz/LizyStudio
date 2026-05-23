import { expect, test } from "@playwright/test";
import * as fs from "node:fs";
import { isMobileProject } from "./helpers/mobile";
import { dismissOnboarding } from "./helpers/onboarding";
import { expectBudget, installFetchRecorder } from "./helpers/request-budget";

/**
 * Issue #538 — tab-switch PUT budget regression spec.
 *
 * Surface: switching between the Fit and Tune tabs on the workspace
 * Model panel. The tab switch is a pure-UI navigation — no config
 * mutation is implied — so the budget should be **0** PUTs in steady
 * state. The +1 headroom covers any incidental re-mount that wraps
 * an existing cached value into a no-op replace; the budget is
 * intentionally tight so a regression that re-writes a defensive
 * useEffect (the v0.6.2 Target-select bug class) trips this on the
 * very next CI run.
 *
 * Risk class: "tab change should not write" — exactly the row in the
 * #538 surface table that has no historical bug but is the most
 * sensitive sentinel against the same pattern recurring elsewhere.
 *
 * Per ``feedback_count_budget_assertions`` (memory): for storm/spam
 * bugs the regression test MUST count occurrences, not just assert
 * eventual correctness.
 */

const CSV_PATH = "/tmp/e2e_tab_switch_puts.csv";
// Budget = 1 (steady-state expectation = 0, +1 headroom for the first
// tab mount that may seed a Tune-only field). A regression that fires
// a per-tab-switch PUT will exceed this on the second toggle.
const TAB_SWITCH_BUDGET = 1;

function createBinaryCsv(): void {
  const rows = ["id,age,target"];
  for (let i = 0; i < 100; i += 1) {
    rows.push(`${i},${20 + (i % 50)},${i % 2}`);
  }
  fs.writeFileSync(CSV_PATH, rows.join("\n"));
}

test.describe("Fit ↔ Tune tab switch — zero-write budget (Issue #538)", () => {
  test.beforeAll(() => {
    createBinaryCsv();
  });

  test.afterAll(() => {
    if (fs.existsSync(CSV_PATH)) fs.unlinkSync(CSV_PATH);
  });

  test("toggling Fit ↔ Tune does not fire PUTs", async ({
    page,
    request,
  }, testInfo) => {
    if (isMobileProject(testInfo)) {
      test.skip(
        true,
        "Mobile layout collapses the tab nav; covered by the desktop project",
      );
    }

    await request.post("/api/workspace/reset");
    const recorder = installFetchRecorder(page);

    // Seed: load data + pick target so the workspace is fully populated.
    await dismissOnboarding(page);
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await page.getByRole("radio", { name: "Path" }).click();
    await page.getByPlaceholder("/path/to/data.csv").fill(CSV_PATH);
    await page.getByRole("button", { name: "Load" }).click();
    await expect(page.getByText(/100 rows × \d+ columns/)).toBeVisible({
      timeout: 15_000,
    });
    const combo = page.getByRole("combobox", { name: /target column/i });
    await expect(combo).toBeEnabled({ timeout: 15_000 });
    await combo.click();
    await page.getByRole("option", { name: "target" }).click();

    // Wait for the initial seed funnel to drain so the snapshot below
    // captures only tab-switch traffic.
    await page.waitForTimeout(3000);

    const sinceSwitch = recorder.snapshot({
      method: "PUT",
      urlPattern: "/api/workspace/config",
    });

    // Toggle: Fit (current) → Tune → Fit → Tune. Four observations
    // gives a stable sentinel: a single per-mount PUT inflates the
    // count by 4 (one per switch), well above the budget of 1.
    await page.getByRole("tab", { name: "Tune" }).click();
    await page.waitForTimeout(500);
    await page.getByRole("tab", { name: "Fit" }).click();
    await page.waitForTimeout(500);
    await page.getByRole("tab", { name: "Tune" }).click();
    await page.waitForTimeout(500);
    await page.getByRole("tab", { name: "Fit" }).click();
    await page.waitForTimeout(2000);

    const switchPuts = sinceSwitch();
    expect(
      switchPuts.length,
      `Tab switch fired ${switchPuts.length} PUT(s) (budget ${TAB_SWITCH_BUDGET}). ` +
        `A tab change is pure navigation — no mutation implied. Investigate ` +
        `if any per-tab useEffect is writing back into config on mount.`,
    ).toBeLessThanOrEqual(TAB_SWITCH_BUDGET);

    // Cross-check via the helper API. Total session PUT count includes
    // the initial seed (which is fine); we only care that the tab
    // switches themselves did not inflate it.
    expectBudget(recorder, {
      method: "PUT",
      urlPattern: "/api/workspace/config",
      // Generous session-wide budget — the seed itself may emit a
      // handful. Tab-switch contribution above is the strict assertion.
      max: 10,
      label: "Full session (seed + 4 tab toggles)",
    });
  });
});
