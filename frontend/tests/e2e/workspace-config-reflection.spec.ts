import { expect, test } from "@playwright/test";
import * as fs from "node:fs";
import { API, createTestCsv } from "./helpers/api";
import {
  assertConfigReflection,
  type ConfigFieldSpec,
} from "./helpers/config-reflection";
import { isMobileProject } from "./helpers/mobile";
import { seedUiWorkspace } from "./helpers/workspace-ui";

/**
 * Phase A scaffold (gui-e2e-plan.md) — locks the four-step
 * config-reflection invariant for ONE representative UI control:
 * the CV Folds NumberInput, which writes `split.n_splits` on the
 * stratified_kfold default that `seedUiWorkspace` lands on.
 *
 * Subsequent PRs (D-2 onwards) extend the fixture set in
 * `fixtures/config-fields.ts` and loop this same assertion shape over
 * every Config field. This file intentionally exercises ONE field so
 * the helper contract (locator + action + path + values) is locked
 * before the fixture-driven loop is built.
 *
 * Why we skip on mobile: `seedUiWorkspace` re-opens the Model panel
 * after target selection, which on mobile collapses the Data accordion
 * and hides the CV section. The CV controls live in the Data panel,
 * so the mobile path needs a separate `openWorkspaceSectionIfMobile`
 * step that's not yet wired into this helper.
 */

const CSV_PATH = "/tmp/e2e_config_reflection.csv";

test.describe("Workspace config reflection (Phase A scaffold)", () => {
  test.beforeAll(() => {
    createTestCsv(100, CSV_PATH);
  });

  test.afterAll(() => {
    if (fs.existsSync(CSV_PATH)) fs.unlinkSync(CSV_PATH);
  });

  test.beforeEach(async ({ request }) => {
    await request.post(`${API}/workspace/reset`);
  });

  test("CV Folds NumberInput writes split.n_splits to PUT /config", async ({
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

    // Sanity guard: the seed lands the workspace on stratified_kfold
    // with n_splits=5 (binary classification default). If this base
    // changes, the spec's defaultValue / testValue need to follow.
    const seeded = await request.get(`${API}/workspace/config`);
    expect(seeded.status()).toBe(200);
    const seededBody = await seeded.json();
    expect(seededBody.split.method).toBe("stratified_kfold");

    const spec: ConfigFieldSpec<number> = {
      name: "split.n_splits via Folds NumberInput",
      configPath: "split.n_splits",
      defaultValue: 5,
      testValue: 7,
      uiLocator: (p) =>
        // CvSection renders the Folds NumberInput with `ariaLabel="Folds"`,
        // surfacing the input as a role=textbox with that accessible name.
        // Using getByRole avoids the deeply-nested locator chain that the
        // first iteration of this spec relied on (which paid a several-
        // minute auto-wait penalty under React's re-render churn after
        // target selection — the helper would time out before the first
        // `fill` call could even resolve).
        p.getByRole("textbox", { name: "Folds", exact: true }),
      uiAction: async (locator, value) => {
        await locator.fill(String(value));
        await locator.blur();
      },
    };

    await assertConfigReflection(page, request, spec);
  });
});
