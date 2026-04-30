import { expect, test } from "@playwright/test";
import * as fs from "node:fs";
import { API, createTestCsv } from "./helpers/api";
import { isMobileProject } from "./helpers/mobile";
import {
  pollJobUntilTerminal,
  seedUiWorkspace,
} from "./helpers/workspace-ui";

/**
 * G-1 (P-0092 Phase 6) — Apply-to-Fit E2E.
 *
 * Phase 6 was the last writer to migrate to the funnel — handleApplyToFit
 * in WorkspacePage.tsx routes through enqueueWrite with reason="apply-to-fit"
 * and relies on the funnel's onWriteCommitted to update the cache. Up to
 * the audit there was zero Playwright coverage of the full user flow:
 * unit/component tests use prop-capture mocks (WorkspacePage.test.tsx:239+),
 * but the production chain "complete a Tune → click Apply to Fit → run Fit"
 * was untested end-to-end.
 *
 * What this spec locks:
 *
 *   1. After a successful UI Tune, the "Apply to Fit" button is reachable.
 *   2. Clicking it issues PUT /api/workspace/config with model.params
 *      matching the tune's best_params.
 *   3. The funnel's success path switches the ModelPanel to the Fit tab.
 *   4. A subsequent Fit click consumes the applied config (best_params
 *      visible in the merged body sent to POST /api/workspace/fit).
 *
 * The dataset is the standard 100-row binary CSV; tune defaults use the
 * backend ui_schema's smallest n_trials path so the spec stays under the
 * project-level 180s budget the existing UI Tune scenario uses.
 */

const CSV_PATH = "/tmp/e2e_apply_to_fit.csv";

test.describe("Workspace Apply-to-Fit (G-1, P-0092 Phase 6)", () => {
  test.beforeAll(() => {
    createTestCsv(100, CSV_PATH);
  });

  test.afterAll(() => {
    if (fs.existsSync(CSV_PATH)) fs.unlinkSync(CSV_PATH);
  });

  test.beforeEach(async ({ request }) => {
    await request.post(`${API}/workspace/reset`);
    const list = await request.get(`${API}/jobs/`);
    if (list.status() === 200) {
      const jobs = (await list.json()) as Array<{ job_id: string }>;
      for (const j of jobs) {
        await request
          .delete(`${API}/jobs/${j.job_id}?cascade=true`)
          .catch(() => {});
      }
    }
  });

  test("UI: Tune → Apply to Fit → Fit consumes best_params", async ({
    page,
    request,
  }, testInfo) => {
    test.setTimeout(180_000);
    if (isMobileProject(testInfo)) {
      // On mobile the Tune trials section, Apply to Fit button, and
      // Model panel sit on the Results / Model tabs respectively;
      // covered by B-8.
      test.skip(true, "Mobile layout path is covered elsewhere");
    }

    await seedUiWorkspace(page, testInfo, {
      csvPath: CSV_PATH,
      target: "target",
      expectedRows: 100,
    });

    // 1. Run a Tune through the UI. Same shape as workspace-tune.spec.ts.
    await page.getByRole("tab", { name: "Tune" }).click();
    const tuneButton = page.getByRole("button", { name: "Tune", exact: true });
    await expect(tuneButton).toBeEnabled({ timeout: 15_000 });

    const tuneResponsePromise = page.waitForResponse(
      (res) =>
        res.url().endsWith("/api/workspace/tune") &&
        res.request().method() === "POST",
      { timeout: 30_000 },
    );
    await tuneButton.click();
    const tuneResponse = await tuneResponsePromise;
    expect(tuneResponse.status()).toBe(200);
    const { job_id: tuneJobId } = await tuneResponse.json();
    expect(tuneJobId).toBeTruthy();

    // 2. Wait for terminal status. The shared helper bails on
    // ``cancelled`` / ``failed`` so a regression surfaces here rather
    // than burning the test budget.
    const tuneTerminal = await pollJobUntilTerminal(
      request,
      tuneJobId as string,
    );
    expect(tuneTerminal.status).toBe("completed");
    const tuneResult = tuneTerminal.tune_result as {
      best_params: Record<string, number>;
    } | null;
    expect(tuneResult).toBeTruthy();
    expect(tuneResult?.best_params).toBeTruthy();
    const bestParams = tuneResult?.best_params ?? {};
    // Sanity: at least one tunable parameter must have come back —
    // otherwise the rest of the assertions below have no signal.
    expect(Object.keys(bestParams).length).toBeGreaterThan(0);

    // 3. Click "Apply to Fit". The button is rendered by
    // TuneTrialsSection within ResultsPanel; on desktop it is visible
    // once the trial-results section paints.
    const applyButton = page.getByRole("button", { name: "Apply to Fit" });
    await expect(applyButton).toBeVisible({ timeout: 15_000 });

    // Capture the funnel-routed PUT triggered by Apply to Fit.
    const applyPutPromise = page.waitForResponse(
      (res) =>
        res.url().endsWith("/api/workspace/config") &&
        res.request().method() === "PUT",
      { timeout: 15_000 },
    );
    await applyButton.click();
    const applyPut = await applyPutPromise;
    expect(applyPut.status()).toBe(200);

    // 4. The PUT body must carry model.params merged with best_params.
    // PUT /config sends the full snapshot, so we read the request body
    // and assert each best_param key is present.
    const putBody = JSON.parse(applyPut.request().postData() ?? "{}") as {
      model?: { params?: Record<string, unknown> };
    };
    const writtenParams = putBody.model?.params ?? {};
    for (const key of Object.keys(bestParams)) {
      expect(writtenParams).toHaveProperty(key);
      // best_params can be numeric or categorical (e.g. lgbm boosting_type);
      // assert equality on the JSON-encoded form so number/string parity
      // matches what the funnel actually shipped.
      expect(JSON.stringify(writtenParams[key])).toBe(
        JSON.stringify(bestParams[key]),
      );
    }

    // 5. The success path switches the ModelPanel to the Fit tab.
    // Radix Tabs marks the active trigger with aria-selected=true.
    const fitTab = page.getByRole("tab", { name: "Fit" });
    await expect(fitTab).toHaveAttribute("aria-selected", "true", {
      timeout: 5_000,
    });

    // Toast confirms the apply landed.
    await expect(
      page.getByText(/Best params applied to Fit tab/i),
    ).toBeVisible({ timeout: 5_000 });

    // 6. Click Fit and assert the body still carries best_params —
    // i.e. the Apply-to-Fit write actually persisted in the cache that
    // POST /workspace/fit reads from.
    const fitButton = page.getByRole("button", { name: "Fit", exact: true });
    await expect(fitButton).toBeEnabled({ timeout: 15_000 });

    const fitResponsePromise = page.waitForResponse(
      (res) =>
        res.url().endsWith("/api/workspace/fit") &&
        res.request().method() === "POST",
      { timeout: 30_000 },
    );
    await fitButton.click();
    const fitResponse = await fitResponsePromise;
    expect(fitResponse.status()).toBe(200);

    // POST /fit accepts an optional `config` body (P-0086) — assert
    // the merged params are in there too. If the body is absent the
    // backend falls back to ws.config which we already verified, so
    // either path is acceptable; we only fail if a body IS present
    // and contradicts best_params.
    const fitPostBody = (() => {
      try {
        return JSON.parse(fitResponse.request().postData() ?? "null") as {
          model?: { params?: Record<string, unknown> };
        } | null;
      } catch {
        return null;
      }
    })();
    if (fitPostBody?.model?.params) {
      const fitParams = fitPostBody.model.params;
      for (const key of Object.keys(bestParams)) {
        expect(JSON.stringify(fitParams[key])).toBe(
          JSON.stringify(bestParams[key]),
        );
      }
    }

    // Cancel the fit so we do not burn the spec budget waiting for
    // it to complete — the contract under test is the apply-to-fit
    // chain, not the fit run itself.
    const { job_id: fitJobId } = await fitResponse.json();
    if (fitJobId) {
      await request.post(`${API}/jobs/${fitJobId}/cancel`).catch(() => {});
    }
  });
});
