import { expect, type Page, test } from "@playwright/test";
import * as fs from "node:fs";
import { isMobileProject } from "./helpers/mobile";
import { installFetchRecorder } from "./helpers/request-budget";
import { seedUiWorkspace } from "./helpers/workspace-ui";

/**
 * P-0111 regression spec — the Tune tab's two write paths.
 *
 * Q1: the tuning fields (``n_trials`` / ``timeout`` / ``direction`` /
 * ``evaluation_metrics`` / ``space``) are written through
 * ``PUT /api/workspace/config/tuning-overrides`` and never through the
 * legacy ``PUT /api/workspace/config``; ``model.params``, ``inner_valid``
 * and ``re_tune`` keep the legacy path.
 *
 * The Proposal's acceptance item expected a Fixed <-> Range row-mode toggle
 * to issue one PUT on each path (budget 2). Measured on the shipped
 * SearchSpaceTable, the toggle writes only ``space`` (``handleModeChange``
 * calls the space ``onChange`` alone), so it issues ONE overrides PUT and no
 * legacy PUT. The spec pins the measured routing and keeps 2 as the budget.
 *
 * Counts are asserted, not just eventual state (Issue #537 convention).
 */

const CSV_PATH = "/tmp/e2e_tune_write_routing.csv";
const OVERRIDES_URL = "/api/workspace/config/tuning-overrides";
const LEGACY_URL = "/api/workspace/config";
const SETTLE_MS = 1500;
const TOGGLE_WRITE_BUDGET = 2;

function createBinaryCsv(): void {
  const rows = ["id,age,target"];
  for (let i = 0; i < 100; i += 1) {
    rows.push(`${i},${20 + (i % 50)},${i % 2}`);
  }
  fs.writeFileSync(CSV_PATH, rows.join("\n"));
}

async function openTuneTab(page: Page): Promise<void> {
  await page.getByRole("tab", { name: "Tune", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Tune", exact: true }),
  ).toBeEnabled({ timeout: 15_000 });
  // Let any first-mount write (none expected) drain before counting.
  await page.waitForTimeout(SETTLE_MS);
}

function rowFor(page: Page, key: string) {
  return page
    .locator("span.font-mono", { hasText: new RegExp(`^${key}$`) })
    .locator("xpath=ancestor::div[contains(@class, 'border-b')][1]");
}

test.describe("Tune tab write routing (P-0111)", () => {
  test.beforeAll(() => {
    createBinaryCsv();
  });

  test.afterAll(() => {
    if (fs.existsSync(CSV_PATH)) fs.unlinkSync(CSV_PATH);
  });

  test.beforeEach(async ({ request }, testInfo) => {
    if (isMobileProject(testInfo)) {
      test.skip(true, "Mobile layout collapses the Tune tab into a bottom-tab");
    }
    await request.post("/api/workspace/reset");
  });

  test("row-mode toggle writes space through PUT /config/tuning-overrides only and badges the row", async ({
    page,
    request,
  }, testInfo) => {
    test.setTimeout(60_000);
    const recorder = installFetchRecorder(page);
    await seedUiWorkspace(page, testInfo, { csvPath: CSV_PATH });
    await openTuneTab(page);

    const sinceOverrides = recorder.snapshot({
      method: "PUT",
      urlPattern: OVERRIDES_URL,
    });
    const sinceLegacy = recorder.snapshot({
      method: "PUT",
      urlPattern: LEGACY_URL,
    });

    const objectiveRow = rowFor(page, "objective");
    await expect(objectiveRow).toBeVisible({ timeout: 15_000 });
    await objectiveRow.getByRole("radio", { name: "Choice" }).click();
    await page.waitForTimeout(SETTLE_MS);

    const overridesPuts = sinceOverrides();
    const legacyPuts = sinceLegacy();
    expect(
      overridesPuts.length,
      `row toggle sent ${overridesPuts.length} overrides PUT(s)`,
    ).toBe(1);
    expect(
      legacyPuts.length,
      `row toggle sent ${legacyPuts.length} legacy PUT /config(s): ` +
        legacyPuts.map((p) => JSON.stringify(p.bodyJson)).join("\n"),
    ).toBe(0);
    expect(overridesPuts.length + legacyPuts.length).toBeLessThanOrEqual(
      TOGGLE_WRITE_BUDGET,
    );
    const space = overridesPuts[0].bodyJson?.space as
      | Record<string, Record<string, unknown>>
      | undefined;
    expect(space?.objective?.type).toBe("categorical");

    // Q2: the snapshot is refreshed after the write settled, so the
    // "Modified" badge follows the overrides write.
    await expect(
      page.getByTestId("search-space-row-modified-objective"),
    ).toBeVisible({ timeout: 10_000 });

    const snapshot = await (
      await request.get("/api/workspace/config/tuning-snapshot")
    ).json();
    expect(snapshot.tuning_overrides.space.objective.type).toBe("categorical");
  });

  test("an n_trials edit goes to PUT /config/tuning-overrides and a Re-tune edit to PUT /config, without reverting each other", async ({
    page,
    request,
  }, testInfo) => {
    test.setTimeout(60_000);
    const recorder = installFetchRecorder(page);
    await seedUiWorkspace(page, testInfo, { csvPath: CSV_PATH });
    await openTuneTab(page);

    const sinceOverrides = recorder.snapshot({
      method: "PUT",
      urlPattern: OVERRIDES_URL,
    });
    const sinceLegacy = recorder.snapshot({
      method: "PUT",
      urlPattern: LEGACY_URL,
    });

    await page.getByRole("button", { name: "200", exact: true }).click();
    await page.waitForTimeout(SETTLE_MS);
    const nTrialsOverrides = sinceOverrides();
    expect(nTrialsOverrides.length).toBe(1);
    expect(nTrialsOverrides[0].bodyJson?.n_trials).toBe(200);
    expect(sinceLegacy().length).toBe(0);

    await page
      .getByRole("switch", { name: "Enable Re-tune (multi-round)" })
      .click();
    await page.waitForTimeout(SETTLE_MS);
    // Still exactly one overrides PUT: the Re-tune toggle did not add one.
    expect(sinceOverrides().length).toBe(1);
    const legacyPuts = sinceLegacy();
    expect(legacyPuts.length).toBe(1);
    const legacyTuning = legacyPuts[0].bodyJson?.tuning as
      | Record<string, Record<string, unknown>>
      | undefined;
    expect(legacyTuning?.re_tune?.n_rounds).toBe(3);
    // The legacy body carries the n_trials the overrides write committed,
    // so the absorb shim keeps it (DC8: no stale-writer revert).
    const optuna = legacyTuning?.optuna as
      | Record<string, Record<string, unknown>>
      | undefined;
    expect(optuna?.params?.n_trials).toBe(200);

    const snapshot = await (
      await request.get("/api/workspace/config/tuning-snapshot")
    ).json();
    expect(snapshot.tuning_overrides.n_trials).toBe(200);
  });
});
