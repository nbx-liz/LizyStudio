import { expect, test } from "@playwright/test";
import * as fs from "node:fs";
import { API, createTestCsv } from "./helpers/api";
import {
  deepGet,
  nextPutConfigBody,
  readSavedConfig,
  waitForConfigSettle,
} from "./helpers/config-reflection";
import { isMobileProject } from "./helpers/mobile";
import { seedUiWorkspace } from "./helpers/workspace-ui";

/**
 * B-6 (gui-e2e-plan §4.1) — Preset Save → Load → form-reflection
 * end-to-end coverage.
 *
 * The existing Save Preset spec at
 * `workspace-model-panel.spec.ts:101` only asserts that the dialog
 * accepts a name and surfaces a toast — it never reloads the preset
 * and thus never proves the wire path from the Load dropdown back
 * through `handleLoadPreset` (useModelPanelData.ts:317) into PUT
 * /api/workspace/config. A regression in the Phase 2 funnel coalesce,
 * the data-field merge guard at line 330, or the form's reflective
 * read of `config.split.n_splits` would slip through.
 *
 * Invariants under test:
 *
 *   INV-1  Save preset of the seeded config (split.n_splits = 5)
 *          completes via the dialog flow and the Load Preset
 *          dropdown surfaces the saved name. (Pinned in
 *          workspace-model-panel.spec.ts already; included here as
 *          a precondition to exercise the rest.)
 *   INV-2  Drift the form away from the preset (Folds = 8) via the
 *          UI. The saved config and the UI both reflect the drift.
 *   INV-3  Load the preset → PUT body carries split.n_splits = 5
 *          (the preset's value). data-bound fields survive the
 *          preset merge (Issue #276 / useModelPanelData.ts:330).
 *   INV-4  After load, the Folds input reads "5" (the form is
 *          subscribed to the saved config — without that wiring, the
 *          input would still show "8").
 *
 * Mobile is skipped: `seedUiWorkspace` collapses the Data accordion
 * holding the Folds input on initial mobile mount; covered by B-8.
 */

const CSV_PATH = "/tmp/e2e_presets.csv";
const PRESET_NAME = "b6-roundtrip-preset";

test.describe("Workspace preset Save → Load reflection (B-6)", () => {
  test.beforeAll(() => {
    createTestCsv(100, CSV_PATH);
  });

  test.afterAll(() => {
    if (fs.existsSync(CSV_PATH)) fs.unlinkSync(CSV_PATH);
  });

  test.beforeEach(async ({ request }) => {
    await request.post(`${API}/workspace/reset`);
  });

  test("Save → drift Folds → Load preset restores split.n_splits in wire and form", async ({
    page,
    request,
  }, testInfo) => {
    if (isMobileProject(testInfo)) {
      test.skip(true, "Mobile layout collapses Data accordion; covered by B-8");
    }

    await seedUiWorkspace(page, testInfo, {
      csvPath: CSV_PATH,
      target: "target",
      expectedRows: 100,
    });

    // Sanity: the seed lands on stratified_kfold with n_splits = 5.
    // If this base changes, the assertions need to follow.
    const seeded = await readSavedConfig(request);
    expect(deepGet(seeded, "split.method")).toBe("stratified_kfold");
    expect(deepGet(seeded, "split.n_splits")).toBe(5);

    // ----------------------------------------------------------------
    // INV-1: Save the seeded config as a preset.
    // ----------------------------------------------------------------
    const savePresetButton = page.getByRole("button", { name: "Save Preset" });
    await expect(savePresetButton).toBeVisible();
    await savePresetButton.click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 3000 });
    const nameInput = dialog.getByLabel("Name");
    await expect(nameInput).toBeFocused();
    await nameInput.fill(PRESET_NAME);
    await dialog.getByRole("button", { name: /^save$/i }).click();
    await expect(
      page.getByText(`Preset "${PRESET_NAME}" saved`),
    ).toBeVisible({ timeout: 5000 });

    // The Load Preset menu trigger should now appear. Issue #369:
    // the trigger used to be a Select combobox whose ``onValueChange``
    // suppressed re-applies of the same preset; the menu replacement
    // exposes a button whose menu items always fire on click.
    const loadPresetTrigger = page.getByRole("button", {
      name: "Load preset",
    });
    await expect(loadPresetTrigger).toBeVisible({ timeout: 3000 });

    // ----------------------------------------------------------------
    // INV-2: Drift the form away from the preset by editing Folds.
    // ----------------------------------------------------------------
    const folds = page.getByRole("textbox", { name: "Folds", exact: true });
    await expect(folds).toBeVisible();

    const driftPut = nextPutConfigBody(
      page,
      (body) => deepGet(body, "split.n_splits") === 8,
    );
    await folds.fill("8");
    await folds.blur();
    const driftBody = await driftPut;
    expect(deepGet(driftBody, "split.n_splits")).toBe(8);

    await waitForConfigSettle(
      request,
      (cfg) => deepGet(cfg, "split.n_splits") === 8,
    );
    await expect(folds).toHaveValue("8");

    // ----------------------------------------------------------------
    // INV-3: Load the preset → PUT carries the preset's n_splits = 5.
    // ----------------------------------------------------------------
    const loadPut = nextPutConfigBody(
      page,
      (body) => deepGet(body, "split.n_splits") === 5,
    );
    await loadPresetTrigger.click();
    await page
      .getByRole("menuitem", { name: PRESET_NAME, exact: true })
      .click();
    const loadBody = await loadPut;
    expect(deepGet(loadBody, "split.n_splits")).toBe(5);
    // Issue #276 guard: preset merges with current data section so
    // the wire body is a complete config, not a fragment that
    // backend validation would reject.
    expect(deepGet(loadBody, "data.target")).toBe("target");

    // INV-4: Saved config + form reflect n_splits = 5 again.
    await waitForConfigSettle(
      request,
      (cfg) => deepGet(cfg, "split.n_splits") === 5,
    );
    await expect(folds).toHaveValue("5");
  });
});
