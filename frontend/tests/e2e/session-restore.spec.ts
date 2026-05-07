/**
 * E2E coverage for session restore (Issue #91 / Issue #101).
 *
 * Verifies that:
 *  - The backend exposes a started job's id via `/workspace/status`
 *    so a reload can recover state from the URL.
 *  - The Workspace page hydrates `currentJobId` from the `?job_id=`
 *    query param on mount and re-attaches the ResultsPanel to the
 *    job's progress / completed view after a browser reload.
 */

import { expect, test } from "@playwright/test";
import { randomBytes } from "node:crypto";
import {
  API,
  createTestCsv,
  setupAndFit,
  waitForJobDone,
} from "./helpers/api";
import { openWorkspaceSectionIfMobile } from "./helpers/mobile";
import { dismissOnboarding } from "./helpers/onboarding";

// Per-spec random suffix avoids /tmp filename collisions across
// parallel Playwright workers / repeated runs.
const RUN_TAG = randomBytes(4).toString("hex");
const tmp = (label: string) => `/tmp/e2e_restore_${RUN_TAG}_${label}.csv`;

test.describe("Session Restore", () => {
  test.beforeEach(async ({ request }) => {
    await request.post(`${API}/workspace/reset`);
  });

  // @ci-flaky: GitHub Actions runners occasionally kill the backend
  // subprocess with SIGTERM mid-fit (observed as
  // "Subprocess exited with code -15"), which leaves
  // ``ws.current_job_id`` unset even though the fit's POST return
  // value came through.  Local runs pass deterministically.  Excluded
  // from the blocking e2e-chromium job via
  // ``--grep-invert=...|@ci-flaky`` until a dedicated investigation
  // fixes the resource-pressure root cause.
  test("API: /workspace/status surfaces current_job_id after fit completes @ci-flaky", async ({
    request,
  }) => {
    test.setTimeout(120_000);

    // The backend sets ws.current_job_id only when the subprocess /
    // thread reports `finished` (see services/training.py). A reload
    // during the run still works because the fit's job_id is returned
    // synchronously from `POST /workspace/fit` and the frontend stores
    // it locally; this test pins the post-completion contract that
    // Issue #101's URL-hydration depends on for late reloads.
    const csvPath = createTestCsv(100, tmp("status"));
    const jobId = await setupAndFit(request, csvPath);
    const finished = await waitForJobDone(request, jobId);
    expect(finished.status).toBe("completed");

    const statusRes = await request.get(`${API}/workspace/status`);
    expect(statusRes.status()).toBe(200);
    const status = await statusRes.json();
    expect(status.current_job_id).toBe(jobId);
  });

  test("UI: reload with ?job_id= restores ResultsPanel onto completed job", async ({
    page,
    request,
  }, testInfo) => {
    test.setTimeout(120_000);

    // Set up a completed job purely via the API, then drop the user
    // into the Workspace with `?job_id=` to simulate the
    // "shared deep link" / "reload mid-flow" recovery path.
    const csvPath = createTestCsv(100, tmp("ui"));
    const jobId = await setupAndFit(request, csvPath);
    const finished = await waitForJobDone(request, jobId);
    expect(finished.status).toBe("completed");

    await dismissOnboarding(page);
    await page.goto(`/?job_id=${encodeURIComponent(jobId)}`);
    await page.waitForLoadState("networkidle");
    await openWorkspaceSectionIfMobile(page, testInfo, "results");

    // The Completed badge is rendered by ResultsCompletedView only
    // after the page successfully hydrates currentJobId AND fetches
    // the matching JobDetail, so it acts as a reliable end-to-end
    // assertion for the restore path.
    await expect(page.getByText("Completed").first()).toBeVisible({
      timeout: 30_000,
    });
  });

  test("UI: reload without ?job_id= restores last job from workspace status", async ({
    page,
    request,
  }, testInfo) => {
    // P-0102 v3-24a (R-2.2): a browser reload without ``?job_id=``
    // now auto-hydrates ``currentJobId`` from
    // ``workspaceStatus.current_job_id`` so the Workspace re-attaches
    // to the previously-running / -completed job. Inversion of the
    // pre-v3-24 behavior pinned by Issue #101 ("leaves Workspace
    // empty") — the change is gated by HISTORY P-0102 Decision.
    const csvPath = createTestCsv(100, tmp("restore"));
    const jobId = await setupAndFit(request, csvPath);
    const finished = await waitForJobDone(request, jobId);
    expect(finished.status).toBe("completed");

    await dismissOnboarding(page);
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await openWorkspaceSectionIfMobile(page, testInfo, "results");

    // The Completed badge appears only after currentJobId is hydrated
    // and JobDetail has been fetched, so it pins INV-reload-2: URL
    // empty + workspaceStatus.current_job_id non-null → state attaches.
    await expect(page.getByText("Completed").first()).toBeVisible({
      timeout: 30_000,
    });
  });
});
