import { expect, test } from "@playwright/test";
import * as fs from "node:fs";
import { isMobileProject } from "./helpers/mobile";
import { dismissOnboarding } from "./helpers/onboarding";

/**
 * Issue #529 regression spec — partial-body PUTs from MetricsChips.
 *
 * Before the fix:
 *   - Clicking Target = `survived` from a clean workspace produced
 *     **2 partial-body PUTs** `{evaluation:{metrics:[...]}}` that
 *     `MetricsChips`'s task-change `useEffect` emitted while
 *     `ConfigForm`'s `configRef.current` was still empty.
 *   - The backend silently rejected these with
 *     `saved=false, blocking=5` (validation errors: `config_version`,
 *     `task`, `split`, etc. missing).
 *   - During the empty-`ws.config` window, `GET /data/split-preview`
 *     could fire and correctly return **400 WORKSPACE_NO_CONFIG**.
 *
 * The fix gates the MetricsChips task-change auto-reset on a
 * `configSeeded` prop (true once `config.config_version` is defined)
 * and pre-populates `evaluation.metrics` in `buildMergedConfig` from
 * the UiSchema's task-keyed eval registry. After both changes, the
 * partial PUTs never fire and split-preview returns 200.
 *
 * This spec intercepts every `PUT /api/workspace/config` and asserts:
 *   1. No PUT body has only `{evaluation}` at top level (the partial
 *      signature). The body must contain at minimum `config_version`,
 *      `task`, `split`, `data` — the seed config's invariant keys.
 *   2. No GET /data/split-preview returns 400 during the Target flow.
 *   3. Total PUT count is within budget (locks in the network-noise
 *      regression and gives Bug B / #530 a numeric target to drive
 *      down further).
 */

const CSV_PATH = "/tmp/e2e_target_select_puts.csv";
const PUT_BUDGET = 6;

function createBinaryCsv(): void {
  const rows = ["id,age,survived"];
  for (let i = 0; i < 100; i += 1) {
    rows.push(`${i},${20 + (i % 50)},${i % 2}`);
  }
  fs.writeFileSync(CSV_PATH, rows.join("\n"));
}

test.describe("Target selection — no partial PUT, no split-preview 400 (Issue #529)", () => {
  test.beforeAll(() => {
    createBinaryCsv();
  });

  test.afterAll(() => {
    if (fs.existsSync(CSV_PATH)) fs.unlinkSync(CSV_PATH);
  });

  test("partial-body PUT regression locks", async ({
    page,
    request,
  }, testInfo) => {
    if (isMobileProject(testInfo)) {
      test.skip(
        true,
        "Mobile layout uses a different Data Panel collapse pattern; covered by the desktop project",
      );
    }

    // Reset workspace so the seed config is genuinely empty when the
    // Target selection fires. Without this, a leftover config from a
    // previous test masks the bug.
    await request.post("/api/workspace/reset");

    // Set up interception BEFORE driving any UI so we observe every
    // PUT /config from page load onward — though the partial-PUT bug
    // fires only after Target is picked, capturing the full session
    // gives diagnostic context if the test fails.
    const allPuts: Array<{
      keys: string[];
      hasConfigVersion: boolean;
      hasTask: boolean;
      hasSplit: boolean;
      bodySize: number;
    }> = [];
    page.on("request", (req) => {
      if (req.method() !== "PUT") return;
      if (!req.url().endsWith("/api/workspace/config")) return;
      try {
        const body = req.postDataJSON() as Record<string, unknown>;
        const keys = Object.keys(body).sort();
        allPuts.push({
          keys,
          hasConfigVersion: "config_version" in body,
          hasTask: "task" in body,
          hasSplit: "split" in body,
          bodySize: req.postData()?.length ?? 0,
        });
      } catch {
        // Ignore non-JSON bodies — none exist on this endpoint.
      }
    });

    // Watch for split-preview 400 responses (Bug C / #531 — symptom of
    // this bug). A passing run should see 200s only.
    const splitPreview400s: number[] = [];
    page.on("response", (res) => {
      if (!res.url().endsWith("/api/workspace/data/split-preview")) return;
      if (res.status() === 400) splitPreview400s.push(res.status());
    });

    // Drive the UI flow. Inlining the seed instead of using
    // `seedUiWorkspace` because that helper picks `target="target"` and
    // does its own quiescence wait that subsumes the events we want to
    // count. Here we want to count PUTs *across* the Target-select
    // window.
    await dismissOnboarding(page);
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    await page.getByRole("radio", { name: "Path" }).click();
    await page.getByPlaceholder("/path/to/data.csv").fill(CSV_PATH);
    await page.getByRole("button", { name: "Load" }).click();
    await expect(page.getByText(/100 rows × \d+ columns/)).toBeVisible({
      timeout: 15_000,
    });

    // Snapshot PUTs BEFORE the Target click so post-click delta is clean.
    const putsBeforeTarget = allPuts.length;

    const combo = page.getByRole("combobox", { name: /target column/i });
    await expect(combo).toBeEnabled({ timeout: 15_000 });
    await combo.click();
    await page.getByRole("option", { name: "survived" }).click();

    // Wait for the funnel to drain. 3s is generous against typical
    // 200 ms convergence; CI machines vary.
    await page.waitForTimeout(3000);

    const targetPuts = allPuts.slice(putsBeforeTarget);

    // Invariant 1: NO partial-body PUTs. A partial body has only
    // `evaluation` (or a tiny subset) as the top-level key set. Every
    // PUT must carry the seed config invariants (config_version, task,
    // split).
    const partials = targetPuts.filter(
      (p) => !p.hasConfigVersion || !p.hasTask || !p.hasSplit,
    );
    expect(
      partials,
      `Issue #529 regression — partial-body PUT(s) observed.
` +
        `These bodies lack config_version/task/split and the backend ` +
        `rejects them with saved=false, blocking=5. Captured:
` +
        partials.map((p) => `  keys=${JSON.stringify(p.keys)}`).join("\n"),
    ).toHaveLength(0);

    // Invariant 2: split-preview never 400'd. Bug C disappears when
    // Bug A is fixed because ws.config is always populated.
    expect(
      splitPreview400s,
      `Issue #531 regression — GET /split-preview returned 400 ` +
        `WORKSPACE_NO_CONFIG. Likely cause: partial PUT from MetricsChips ` +
        `left ws.config empty (Issue #529 root cause).`,
    ).toHaveLength(0);

    // Invariant 3: PUT count within budget. We measured 4 PUTs after
    // the fix (1 target-select + 3 auto-reset oscillation from #530).
    // Budget of 6 gives headroom for #530 not yet being fixed; tighten
    // when #530 lands.
    expect(
      targetPuts.length,
      `Target-select fired ${targetPuts.length} PUTs (budget ${PUT_BUDGET}). ` +
        `Pre-#529 fix this was 9. Investigate if it exceeds the budget — ` +
        `likely a new useEffect was added that derives state from cache ` +
        `and emits a write. See also Issue #530 (oscillation between ` +
        `model.params.objective and model.params.metric).`,
    ).toBeLessThanOrEqual(PUT_BUDGET);
  });
});
