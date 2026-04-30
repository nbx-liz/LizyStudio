import { expect, test } from "@playwright/test";
import * as fs from "node:fs";
import { API, createTestCsv } from "./helpers/api";
import {
  assertConfigReflection,
  type ConfigFieldSpec,
} from "./helpers/config-reflection";
import { CONFIG_FIELD_FIXTURES } from "./fixtures/config-fields";
import { isMobileProject } from "./helpers/mobile";
import { seedUiWorkspace } from "./helpers/workspace-ui";

/**
 * Phase C (gui-e2e-plan §4.2) — config-reflection invariant
 * generator.
 *
 * Each fixture row in `fixtures/config-fields.ts` declares the four
 * data points needed to lock the "UI control → PUT /config" path
 * for one Config field. This spec loops `assertConfigReflection`
 * over those rows, so adding coverage for a new field is a fixture
 * row diff instead of a new spec file.
 *
 * The first wave covers `split.n_splits` (NumberInput) and
 * `model.balanced` (Switch) — chosen to exercise both core control
 * shapes and verify the loop pattern works before extending the
 * fixture set.
 *
 * Mobile is skipped: every field in the initial wave lives in the
 * Data / Model panels which collapse on mobile bottom-tab mount.
 * B-8 is the dedicated mobile coverage track.
 */

const CSV_PATH = "/tmp/e2e_config_fields_loop.csv";

test.describe("Workspace config-fields loop (Phase C)", () => {
  test.beforeAll(() => {
    createTestCsv(100, CSV_PATH);
  });

  test.afterAll(() => {
    if (fs.existsSync(CSV_PATH)) fs.unlinkSync(CSV_PATH);
  });

  test.beforeEach(async ({ request }) => {
    await request.post(`${API}/workspace/reset`);
  });

  for (const fixture of CONFIG_FIELD_FIXTURES) {
    test(fixture.spec.name, async ({ page, request }, testInfo) => {
      if (isMobileProject(testInfo)) {
        test.skip(
          true,
          "Phase C wave 1 fixtures live in Data/Model panels; mobile " +
            "needs a separate path covered by B-8.",
        );
      }

      await seedUiWorkspace(page, testInfo, {
        csvPath: CSV_PATH,
        target: "target",
        expectedRows: 100,
      });

      // Sanity guard: the seed lands on stratified_kfold (binary
      // classification default). If the seed ever changes, every
      // fixture's defaultValue would silently mismatch — the
      // single-line check below makes that failure loud and
      // pointable.
      const seeded = await request.get(`${API}/workspace/config`);
      expect(seeded.status()).toBe(200);
      const seededBody = await seeded.json();
      expect(seededBody.split.method).toBe("stratified_kfold");
      expect(seededBody.task).toBe("binary");

      if (fixture.precondition) {
        await fixture.precondition(page);
      }

      await assertConfigReflection(
        page,
        request,
        fixture.spec as ConfigFieldSpec<unknown>,
      );
    });
  }
});
