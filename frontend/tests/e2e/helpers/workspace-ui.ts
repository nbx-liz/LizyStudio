import { expect, type Page, type TestInfo } from "@playwright/test";
import type { APIRequestContext } from "@playwright/test";
import { API } from "./api";
import { isMobileProject, openWorkspaceSectionIfMobile } from "./mobile";
import { dismissOnboarding } from "./onboarding";

/**
 * Shared UI-driven setup boilerplate for workspace E2E specs.
 *
 * Rationale (Issue #257): Scenario A / B in workspace-fit.spec.ts, the
 * Scenario T in workspace-tune.spec.ts (Tune), and any future Retune /
 * Inference UI specs all share the same opening sequence: dismiss
 * onboarding, load data via the Path source, pick the target column,
 * and wait for the ConfigForm to be ready. Keeping this in one place
 * means future layout tweaks (e.g. onboarding copy change, Data Source
 * segment rename) only need one edit.
 *
 * The helper deliberately uses the UI Path flow (not a direct
 * ``request.post(/workspace/data/path)``) because the regression class
 * we want to lock is the full ``ConfigForm onChange -> PUT /config``
 * write path. Seeding via API bypasses the exact code paths Issue #253
 * touched.
 */

export interface SeedUiWorkspaceOptions {
  /** Path to the CSV that will be typed into the Data Source "Path" input. */
  csvPath: string;
  /** Name of the target column to pick via the combobox. Default "target". */
  target?: string;
  /** Expected row count used to wait for data-loaded confirmation. */
  expectedRows?: number;
}

/**
 * Drive the UI through "dismiss onboarding -> goto / -> switch to Path
 * data source -> type CSV path -> Load -> pick target -> open Model
 * section". Returns once the ConfigForm is in a state where the primary
 * action button (Fit / Tune) should be reachable.
 *
 * On mobile viewports, the caller must still open the Model section
 * again AFTER switching Fit/Tune tabs if the layout collapses between
 * them. For desktop chromium (the primary project), the Model section
 * stays open.
 */
export async function seedUiWorkspace(
  page: Page,
  testInfo: TestInfo,
  { csvPath, target = "target", expectedRows = 100 }: SeedUiWorkspaceOptions,
): Promise<void> {
  await dismissOnboarding(page);
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  await openWorkspaceSectionIfMobile(page, testInfo, "data");

  // Switch the Data Source segment from the default Upload to Path and
  // load the synthetic CSV. ``15s`` matches the schema-load budget used
  // by the original inline specs.
  await page.getByRole("radio", { name: "Path" }).click();
  await page.getByPlaceholder("/path/to/data.csv").fill(csvPath);
  await page.getByRole("button", { name: "Load" }).click();
  await expect(
    page.getByText(new RegExp(`${expectedRows} rows × \\d+ columns`)),
  ).toBeVisible({ timeout: 15_000 });

  // Pick the target column. The combobox is disabled until
  // useTargetSelection resolves the column analysis request, so wait
  // explicitly before clicking.
  const targetCombo = page.getByRole("combobox", {
    name: /target column/i,
  });
  await expect(targetCombo).toBeEnabled({ timeout: 15_000 });
  await targetCombo.click();
  await page.getByRole("option", { name: target }).click();

  // On mobile the Model panel collapses; re-open it so the caller can
  // interact with Fit/Tune controls. On desktop this is a no-op.
  await openWorkspaceSectionIfMobile(page, testInfo, "model");

  // P-0092 Q-1 Phase 5 helper invariant: target-select kicks off
  // a funnel-routed PUT (useTargetSelection writes the merged
  // config). Specs that hit GET /workspace/config via a direct
  // APIRequestContext immediately after seedUiWorkspace returns
  // would otherwise race the funnel flush and observe a partial
  // backend state. Polling for `split.method` here is the cheapest
  // way to gate the helper on "backend has the seeded config".
  // 5s is generous — the merged-PUT lands within ~50-200ms locally,
  // but CI runners are slower and ConfigForm's auto-reset effects
  // may queue behind it.
  await expect
    .poll(
      async () => {
        const res = await page.request.get(`${API}/workspace/config`);
        if (res.status() !== 200) return null;
        const body = (await res.json()) as { split?: { method?: string } };
        return body.split?.method ?? null;
      },
      {
        timeout: 5_000,
        intervals: [50, 100, 200, 500],
        message:
          "seedUiWorkspace: backend never observed the seeded config.split.method (target-select PUT likely failed)",
      },
    )
    .not.toBeNull();
}

/** Re-export mobile guard so specs don't need two imports. */
export { isMobileProject };

export interface PollJobOptions {
  /** Max wait in ms. Default 90s (45 iterations × 2s). */
  timeoutMs?: number;
  /** Interval between polls in ms. Default 2s. */
  intervalMs?: number;
}

/**
 * Poll ``GET /api/jobs/{id}`` until the job hits any terminal status
 * (``completed`` / ``failed`` / ``cancelled``) or the timeout expires.
 * Returns the last body seen. All three UI Scenarios (A / B / T) share
 * this so a ``cancelled`` status doesn't silently burn the full
 * timeout budget before the caller asserts ``=== "completed"``.
 */
export async function pollJobUntilTerminal(
  request: APIRequestContext,
  jobId: string,
  { timeoutMs = 90_000, intervalMs = 2_000 }: PollJobOptions = {},
): Promise<Record<string, unknown>> {
  const deadline = Date.now() + timeoutMs;
  let last: Record<string, unknown> | null = null;
  while (Date.now() < deadline) {
    const res = await request.get(
      `http://localhost:8501/api/jobs/${jobId}`,
    );
    expect(res.status()).toBe(200);
    last = (await res.json()) as Record<string, unknown>;
    const status = last.status as string;
    if (status === "completed" || status === "failed" || status === "cancelled") {
      return last;
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(
    `Job ${jobId} did not reach a terminal status within ${timeoutMs}ms ` +
      `(last status=${last?.status ?? "<no response>"}).`,
  );
}
