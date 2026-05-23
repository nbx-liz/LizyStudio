import { expect, test } from "@playwright/test";
import * as fs from "node:fs";
import { isMobileProject } from "./helpers/mobile";
import { dismissOnboarding } from "./helpers/onboarding";
import { expectBudget, installFetchRecorder } from "./helpers/request-budget";

/**
 * Issue #538 — data-load cascade budget regression spec.
 *
 * Surface: loading a CSV via the Data Source "Path" input. The
 * canonical load sequence fires:
 *   - 1× POST /api/workspace/data/path  (load)
 *   - 1× GET /api/workspace/data/columns (column metadata)
 *   - 1× GET /api/workspace/data/preview (preview rows)
 *   - 1× GET /api/workspace/config       (seed config refresh)
 *
 * = 4 requests in the happy path. The #538 surface table suggests a
 * budget of 6 (== 4 baseline + 2 headroom for cache invalidation
 * race / refetch storms). Anything above that is the
 * "initial-load cascade" regression class — typically a duplicate
 * dispatch from cache invalidation that runs the load twice.
 *
 * Per ``feedback_count_budget_assertions`` (memory): for storm/spam
 * bugs the regression test MUST count occurrences, not just assert
 * eventual correctness.
 */

const CSV_PATH = "/tmp/e2e_data_load_puts.csv";
const TOTAL_LOAD_BUDGET = 6;

function createBinaryCsv(): void {
  const rows = ["id,age,target"];
  for (let i = 0; i < 100; i += 1) {
    rows.push(`${i},${20 + (i % 50)},${i % 2}`);
  }
  fs.writeFileSync(CSV_PATH, rows.join("\n"));
}

test.describe("Data load via Path — load cascade budget (Issue #538)", () => {
  test.beforeAll(() => {
    createBinaryCsv();
  });

  test.afterAll(() => {
    if (fs.existsSync(CSV_PATH)) fs.unlinkSync(CSV_PATH);
  });

  test("Path load fires ≤ 6 workspace/data requests total", async ({
    page,
    request,
  }, testInfo) => {
    if (isMobileProject(testInfo)) {
      test.skip(
        true,
        "Mobile layout uses a different Data Panel collapse pattern; covered by the desktop project",
      );
    }

    await request.post("/api/workspace/reset");

    // Install recorder, then navigate so the recorder sees the initial
    // GET /config + GET /status that always fire on page mount. We
    // exclude those from the load-specific snapshot by taking the
    // snapshot AFTER the page is idle.
    const recorder = installFetchRecorder(page);
    await dismissOnboarding(page);
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Snapshot the data-related endpoints. The pattern matches the
    // four endpoints listed in the #538 surface table.
    const sinceLoad = recorder.snapshot({
      urlPattern: /\/api\/workspace\/(data\/(path|columns|preview)|config)$/,
    });

    await page.getByRole("radio", { name: "Path" }).click();
    await page.getByPlaceholder("/path/to/data.csv").fill(CSV_PATH);
    await page.getByRole("button", { name: "Load" }).click();
    await expect(page.getByText(/100 rows × \d+ columns/)).toBeVisible({
      timeout: 15_000,
    });

    // 2s buffer for any post-load cache invalidation refetch to land.
    await page.waitForTimeout(2000);

    const loadRequests = sinceLoad();
    expect(
      loadRequests.length,
      `Path load fired ${loadRequests.length} data-related request(s) ` +
        `(budget ${TOTAL_LOAD_BUDGET}). Baseline: 1 POST /path + 1 GET ` +
        `/columns + 1 GET /preview + 1 GET /config = 4. Headroom +2 for ` +
        `cache invalidation refetch races. Captured:\n` +
        loadRequests.map((r) => `  ${r.method} ${r.url}`).join("\n"),
    ).toBeLessThanOrEqual(TOTAL_LOAD_BUDGET);

    // POST /data/path must be exactly 1 (no double-load).
    expectBudget(recorder, {
      method: "POST",
      urlPattern: "/api/workspace/data/path",
      max: 1,
      label: "Path load button click",
    });
  });
});
