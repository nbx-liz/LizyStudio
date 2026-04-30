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
 * B-5 (gui-e2e-plan §4.1) — Column Settings (Excl / Num / Cat) E2E.
 *
 * Pins the wire path from the per-column controls in
 * `ColumnSettingsSection.tsx` through `useColumnOverrides` and
 * `buildSyncedConfig` to PUT /api/workspace/config. The unit-level
 * coverage in `useColumnOverrides.test.ts` and
 * `useDataPanel.types.test.ts` pins the override → array extraction
 * step in isolation, but a regression in `useDataPanel`'s wiring or
 * the funnel-routed PUT body would slip through.
 *
 * Wire rules under test (useDataPanel.types.ts:32):
 *
 *   features.categorical  = overrides where !excluded && type==="categorical"
 *   features.exclude      = overrides where excluded === true
 *
 * Invariants:
 *
 *   INV-1  Click `Cat` on a numeric-suggested column → that column
 *          appears in `features.categorical` on the next PUT body.
 *          Default `age` (integer 20–69) is suggested numeric, so
 *          flipping it to categorical is the cleanest single-field
 *          change.
 *   INV-2  Click the Exclude checkbox on the same column → the column
 *          MOVES from `features.categorical` to `features.exclude`
 *          (the extractor's filter `!excluded` drops categorical
 *          entries that flip to excluded). This catches a class of
 *          bug where one of the two arrays is updated but not the
 *          other.
 *
 * Mobile is skipped: the Data accordion that holds the column table
 * collapses on initial mobile mount; covered by B-8.
 */

const CSV_PATH = "/tmp/e2e_columns.csv";

test.describe("Workspace ColumnSettings reflection (B-5)", () => {
  test.beforeAll(() => {
    createTestCsv(100, CSV_PATH);
  });

  test.afterAll(() => {
    if (fs.existsSync(CSV_PATH)) fs.unlinkSync(CSV_PATH);
  });

  test.beforeEach(async ({ request }) => {
    await request.post(`${API}/workspace/reset`);
  });

  test("Cat then Exclude on `age` reflects features.categorical → features.exclude via PUT /config", async ({
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

    // Snapshot the seeded features arrays so we can assert MOVES (not
    // just additions). The CSV columns are id / age / gender / target.
    // The backend's column analysis flags `id` as suggested_excluded
    // and `gender` (M/F strings) as suggested_categorical. `age` is the
    // clean numeric column we drive in this spec.
    const seeded = await readSavedConfig(request);
    const seededExclude = (deepGet(seeded, "features.exclude") ?? []) as string[];
    const seededCategorical = (deepGet(seeded, "features.categorical") ??
      []) as string[];
    expect(seededExclude).not.toContain("age");
    expect(seededCategorical).not.toContain("age");

    const ageRow = page.locator('[data-testid="column-row-age"]');
    await expect(ageRow).toBeVisible();
    const ageCatBtn = ageRow.getByRole("button", { name: "Cat", exact: true });
    const ageExcludeCheckbox = ageRow.getByRole("checkbox");

    // ----------------------------------------------------------------
    // INV-1: Cat button on `age` → PUT carries `age` in
    //        features.categorical.
    // ----------------------------------------------------------------
    const catPut = nextPutConfigBody(page, (body) => {
      const cat = deepGet(body, "features.categorical") as string[] | undefined;
      return Array.isArray(cat) && cat.includes("age");
    });
    await ageCatBtn.click();
    const catBody = await catPut;
    expect(deepGet(catBody, "features.categorical")).toContain("age");

    await waitForConfigSettle(request, (cfg) => {
      const cat = deepGet(cfg, "features.categorical") as string[] | undefined;
      return Array.isArray(cat) && cat.includes("age");
    });

    // ----------------------------------------------------------------
    // INV-2: Excl checkbox on `age` → PUT carries `age` in
    //        features.exclude AND removes it from features.categorical
    //        (the extractor filter drops excluded entries from
    //        categorical — this catches a class of bug where one
    //        array updates but not the other).
    // ----------------------------------------------------------------
    const exclPut = nextPutConfigBody(page, (body) => {
      const exc = deepGet(body, "features.exclude") as string[] | undefined;
      const cat = deepGet(body, "features.categorical") as string[] | undefined;
      return (
        Array.isArray(exc) &&
        exc.includes("age") &&
        Array.isArray(cat) &&
        !cat.includes("age")
      );
    });
    await ageExcludeCheckbox.click();
    const exclBody = await exclPut;
    expect(deepGet(exclBody, "features.exclude")).toContain("age");
    expect(deepGet(exclBody, "features.categorical")).not.toContain("age");

    await waitForConfigSettle(request, (cfg) => {
      const exc = deepGet(cfg, "features.exclude") as string[] | undefined;
      const cat = deepGet(cfg, "features.categorical") as string[] | undefined;
      return (
        Array.isArray(exc) &&
        exc.includes("age") &&
        Array.isArray(cat) &&
        !cat.includes("age")
      );
    });

    // Type buttons should now be disabled per
    // ColumnSettingsSection.tsx:156 — the disabled prop fires when
    // `isExcluded || disabled`. This is the user-facing contract that
    // matches the wire rule "excluded entries cannot also be
    // categorical": if Cat were still clickable, the user would see
    // optimistic UI flicker that the wire rule then drops.
    await expect(ageCatBtn).toBeDisabled();
  });
});
