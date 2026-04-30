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
 * B-4 (gui-e2e-plan §4.1) — Feature Weights editor end-to-end coverage.
 *
 * The unit-level coverage in `FeatureWeightsEditor.test.tsx` pins the
 * component's own contract (toggle / add / edit / remove) against an
 * isolated `onChange` spy, but the wire path from
 * `FeatureWeightsEditor.onChange` → ConfigForm.handleFieldChange →
 * useConfigSync → PUT /api/workspace/config has never been locked at
 * the integration level. P-0091 (Issue #277) and the
 * `nonExcludedColumns` filter both touch this surface, and a regression
 * here would silently break a model invariant — the user would see the
 * Switch flip but the saved config would carry the wrong shape.
 *
 * Invariants under test (gui-e2e-plan.md §4.1, Phase A.4):
 *
 *   INV-1  Toggle ON  → PUT body has `model.feature_weights = {}`
 *                      (empty object, the explicit "ON but no entries"
 *                      wire form). null → empty object is the only
 *                      transition that flips the Switch UI state.
 *   INV-2  Add column → PUT body has `model.feature_weights = {col: 1.0}`.
 *                      The column source is `nonExcludedColumns`
 *                      (target / suggested_excluded / user-excluded
 *                      filtered out — see useModelPanelData.ts:97).
 *   INV-3  Edit weight → PUT body has the new numeric value at
 *                       `model.feature_weights.<col>`.
 *   INV-4  Toggle OFF → PUT body has `model.feature_weights = null`.
 *                       null is the explicit "feature weights disabled"
 *                       wire form; absent vs. null both deserialize to
 *                       OFF, but the wire we send must be null so the
 *                       saved config replaces any prior dict.
 *
 * Why we skip on mobile: `seedUiWorkspace` re-opens the Model panel via
 * `openWorkspaceSectionIfMobile`, but the FeatureWeightsEditor lives in
 * the model accordion's Smart Params block which collapses the
 * accordion on initial mobile mount. Mobile is covered by B-8.
 */

const CSV_PATH = "/tmp/e2e_feature_weights.csv";

test.describe("Workspace FeatureWeightsEditor reflection (B-4)", () => {
  test.beforeAll(() => {
    createTestCsv(100, CSV_PATH);
  });

  test.afterAll(() => {
    if (fs.existsSync(CSV_PATH)) fs.unlinkSync(CSV_PATH);
  });

  test.beforeEach(async ({ request }) => {
    await request.post(`${API}/workspace/reset`);
  });

  test("ON → Add → edit weight → OFF reflects model.feature_weights via PUT /config", async ({
    page,
    request,
  }, testInfo) => {
    if (isMobileProject(testInfo)) {
      test.skip(true, "Mobile layout collapses Model accordion; covered by B-8");
    }

    await seedUiWorkspace(page, testInfo, {
      csvPath: CSV_PATH,
      target: "target",
      expectedRows: 100,
    });

    // Baseline: model.feature_weights is null (or absent) on a fresh
    // workspace. The Pydantic default is null; we accept either
    // serialization form to keep the spec resilient to harmless wire
    // changes (omit-if-null vs explicit-null).
    const seeded = await readSavedConfig(request);
    const seededFw = deepGet(seeded, "model.feature_weights");
    expect(
      seededFw === null || seededFw === undefined,
      `expected model.feature_weights to be null/absent on seed, got ${JSON.stringify(seededFw)}`,
    ).toBe(true);

    // ----------------------------------------------------------------
    // INV-1: Toggle ON → PUT carries model.feature_weights = {}.
    // ----------------------------------------------------------------
    const fwSwitch = page.getByRole("switch", {
      name: "Enable feature weights",
    });
    await expect(fwSwitch).toBeVisible();
    await expect(fwSwitch).toHaveAttribute("data-state", "unchecked");

    const onPut = nextPutConfigBody(page, (body) => {
      const v = deepGet(body, "model.feature_weights") as
        | Record<string, unknown>
        | null
        | undefined;
      // The toggle-on PUT carries an empty object; reject null/absent
      // so we don't latch onto an unrelated funnel-coalesced PUT that
      // happens to flush a stale null value.
      return (
        v !== null &&
        v !== undefined &&
        typeof v === "object" &&
        Object.keys(v).length === 0
      );
    });
    await fwSwitch.click();
    const onBody = await onPut;
    expect(deepGet(onBody, "model.feature_weights")).toEqual({});
    await expect(fwSwitch).toHaveAttribute("data-state", "checked");

    await waitForConfigSettle(request, (cfg) => {
      const v = deepGet(cfg, "model.feature_weights") as
        | Record<string, unknown>
        | null
        | undefined;
      return (
        v !== null &&
        v !== undefined &&
        typeof v === "object" &&
        Object.keys(v).length === 0
      );
    });

    // ----------------------------------------------------------------
    // INV-2: Add `age` from the picker → PUT carries
    //        model.feature_weights = { age: 1.0 }.
    // The test CSV columns are id / age / gender / target. id is
    // auto-flagged suggested_excluded; target is the prediction target.
    // nonExcludedColumns therefore yields [age, gender] (see
    // useModelPanelData.ts:97).
    // ----------------------------------------------------------------
    const addTrigger = page.getByRole("combobox", { name: "Add feature" });
    await expect(addTrigger).toBeVisible();
    await addTrigger.click();

    const addPut = nextPutConfigBody(page, (body) => {
      const v = deepGet(body, "model.feature_weights") as
        | Record<string, unknown>
        | null
        | undefined;
      return (
        v !== null && v !== undefined && (v as Record<string, unknown>).age === 1.0
      );
    });
    await page.getByRole("option", { name: "age", exact: true }).click();
    const addBody = await addPut;
    expect(deepGet(addBody, "model.feature_weights")).toEqual({ age: 1.0 });

    await waitForConfigSettle(request, (cfg) => {
      const v = deepGet(cfg, "model.feature_weights") as
        | Record<string, unknown>
        | null
        | undefined;
      return v !== null && v !== undefined && v.age === 1.0;
    });

    // ----------------------------------------------------------------
    // INV-3: Edit the row's NumberInput → PUT carries new value.
    // The row's NumberInput has no aria-label of its own, so we anchor
    // on the row's "Remove age" button (which carries an
    // unambiguous aria-label) and walk to the parent row's textbox.
    // ----------------------------------------------------------------
    const removeBtn = page.getByRole("button", {
      name: "Remove age",
      exact: true,
    });
    await expect(removeBtn).toBeVisible();
    const ageRow = removeBtn.locator("xpath=..");
    const ageInput = ageRow.getByRole("textbox");

    const editPut = nextPutConfigBody(page, (body) => {
      const v = deepGet(body, "model.feature_weights") as
        | Record<string, unknown>
        | null
        | undefined;
      return v !== null && v !== undefined && v.age === 2.5;
    });
    await ageInput.fill("2.5");
    await ageInput.blur();
    const editBody = await editPut;
    expect(deepGet(editBody, "model.feature_weights")).toEqual({ age: 2.5 });

    await waitForConfigSettle(request, (cfg) => {
      const v = deepGet(cfg, "model.feature_weights") as
        | Record<string, unknown>
        | null
        | undefined;
      return v?.age === 2.5;
    });

    // ----------------------------------------------------------------
    // INV-4: Toggle OFF → PUT carries model.feature_weights = null.
    // ----------------------------------------------------------------
    const offPut = nextPutConfigBody(
      page,
      (body) => deepGet(body, "model.feature_weights") === null,
    );
    await fwSwitch.click();
    const offBody = await offPut;
    expect(deepGet(offBody, "model.feature_weights")).toBeNull();
    await expect(fwSwitch).toHaveAttribute("data-state", "unchecked");

    await waitForConfigSettle(request, (cfg) => {
      const v = deepGet(cfg, "model.feature_weights");
      // After OFF, the saved config's feature_weights may serialize as
      // null OR be omitted by Pydantic — accept either as "disabled".
      return v === null || v === undefined;
    });
  });
});
