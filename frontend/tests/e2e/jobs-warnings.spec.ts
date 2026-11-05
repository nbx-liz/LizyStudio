import { expect, type Page, test, type WebSocketRoute } from "@playwright/test";
import { dismissOnboarding } from "./helpers/onboarding";

/**
 * P-0117 D4 (H-0140) — job warnings banner on the Jobs page.
 *
 * Lizyml raises the H-0140 memory warning only for a very deep model, which
 * is too heavy to train in E2E. The job list, the job detail and the
 * progress WebSocket are therefore stubbed at the network edge; the real
 * frontend (hooks, merge, banner) runs unchanged.
 */

const JOB_ID = "e2e-warn-job-1";
const WARNING = "Estimated peak memory is about 12 GB (max_depth=-1).";
const LIVE_WARNING = "Live estimate: peak memory is about 14 GB.";

type Status = "running" | "completed" | "failed";

function summary(status: Status) {
  return {
    job_id: JOB_ID,
    job_type: "fit",
    status,
    backend_name: "lizyml",
    model_name: "LGBMClassifier",
    created_at: "2026-01-01T00:00:00Z",
    completed_at: status === "running" ? null : "2026-01-01T00:01:00Z",
    error: status === "failed" ? "Out of memory" : null,
    primary_score: null,
    parent_job_id: null,
  };
}

function detail(status: Status, warnings: string[]) {
  return {
    ...summary(status),
    config: { model: { name: "LGBMClassifier" } },
    fit_result: null,
    tune_result: null,
    warnings,
  };
}

async function stubJob(page: Page, status: Status, warnings: string[]) {
  await page.route("**/api/jobs/**", async (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() !== "GET") return route.fallback();
    if (url.pathname.replace(/\/$/, "") === "/api/jobs") {
      return route.fulfill({ json: [summary(status)] });
    }
    if (url.pathname === `/api/jobs/${JOB_ID}`) {
      return route.fulfill({ json: detail(status, warnings) });
    }
    return route.fallback();
  });
}

async function openJobs(page: Page) {
  await dismissOnboarding(page);
  await page.goto("/jobs");
  await expect(page.getByRole("heading", { name: /^Fit\s*#1\b/ })).toBeVisible({
    timeout: 15_000,
  });
}

test.describe("Job warnings banner (P-0117 D4)", () => {
  test("a running job fed a WebSocket warning shows one item", async ({
    page,
  }) => {
    await stubJob(page, "running", []);
    const sockets: WebSocketRoute[] = [];
    await page.routeWebSocket(`**/ws/jobs/${JOB_ID}/progress`, (ws) => {
      sockets.push(ws);
    });

    await openJobs(page);
    // The job is loaded and running with no warnings yet: only the empty
    // announcer exists. Send the warning now so it arrives as a live message
    // (a warning already present at first mount is silent by design).
    await expect(page.getByTestId("job-warnings-announcer")).toBeEmpty();
    await expect(page.getByTestId("job-warnings")).toHaveCount(0);
    await expect.poll(() => sockets.length).toBeGreaterThan(0);
    // The hook re-subscribes once the job status is known, so the first
    // socket may already be closed: talk to the latest one.
    sockets[sockets.length - 1]?.send(
      JSON.stringify({ type: "warning", job_id: JOB_ID, message: LIVE_WARNING }),
    );

    const banner = page.getByTestId("job-warnings");
    await expect(banner).toBeVisible();
    await expect(banner.getByTestId("job-warning-item")).toHaveCount(1);
    await expect(banner.getByTestId("job-warning-item")).toHaveText(
      LIVE_WARNING,
    );
    await expect(page.getByTestId("job-warnings-announcer")).toHaveText(
      "New job warning.",
    );
  });

  test("a reloaded completed job shows its fetched warning", async ({
    page,
  }) => {
    await stubJob(page, "completed", [WARNING]);
    await openJobs(page);

    await expect(page.getByTestId("job-warning-item")).toHaveText(WARNING);

    await page.reload();
    await expect(page.getByRole("heading", { name: /^Fit\s*#1\b/ })).toBeVisible();
    await expect(page.getByTestId("job-warning-item")).toHaveText(WARNING);
    await expect(page.getByTestId("job-warnings-announcer")).toHaveCount(0);
  });

  test("a job with no warnings has no banner", async ({ page }) => {
    await stubJob(page, "completed", []);
    await openJobs(page);

    await expect(page.getByTestId("job-warnings")).toHaveCount(0);
  });

  test("a failed job keeps its warning without the not-stopped sentence", async ({
    page,
  }) => {
    await stubJob(page, "failed", [WARNING]);
    await openJobs(page);

    await expect(page.getByTestId("job-warning-item")).toHaveText(WARNING);
    await expect(page.getByTestId("job-warnings")).not.toContainText(
      "not stopped",
    );
  });

  test("three messages collapse to two and the toggle expands them", async ({
    page,
  }) => {
    await stubJob(page, "completed", [WARNING, "second", "third"]);
    await openJobs(page);

    await expect(page.getByTestId("job-warning-item")).toHaveCount(2);
    const toggle = page.getByTestId("job-warnings-toggle");
    await expect(toggle).toHaveText("Show 1 more");
    await toggle.press("Enter");
    await expect(page.getByTestId("job-warning-item")).toHaveCount(3);
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
  });

  test("an 80-character unbreakable token does not widen the banner at 375px", async ({
    page,
  }) => {
    // The Jobs shell is not responsive at 375px (the pane has no fixed
    // width and grows with its content), so an absolute pane width cannot be
    // the reference. Measure a short-message baseline first, then require the
    // long-token banner to stay within it.
    const measure = async () =>
      page.getByTestId("job-warnings").evaluate((el) => {
        const pane = el.parentElement as HTMLElement;
        return {
          scrollWidth: el.scrollWidth,
          clientWidth: el.clientWidth,
          width: el.getBoundingClientRect().width,
          paneClientWidth: pane.clientWidth,
        };
      });

    await page.setViewportSize({ width: 375, height: 800 });
    await stubJob(page, "completed", ["Short message."]);
    await openJobs(page);
    await expect(page.getByTestId("job-warnings")).toBeVisible();
    const baseline = await measure();

    await page.unrouteAll({ behavior: "ignoreErrors" });
    await stubJob(page, "completed", [`path /var/tmp/${"x".repeat(80)}`]);
    await page.reload();
    await expect(page.getByTestId("job-warnings")).toBeVisible();
    const withToken = await measure();

    // The banner must not overflow itself...
    expect(withToken.scrollWidth).toBeLessThanOrEqual(withToken.clientWidth);
    // ...nor be wider than the pane that holds it, and the long token must
    // not make that pane (or the banner) wider than it is for a short one.
    expect(withToken.width).toBeLessThanOrEqual(withToken.paneClientWidth);
    expect(withToken.paneClientWidth).toBeLessThanOrEqual(
      baseline.paneClientWidth,
    );
    expect(withToken.width).toBeLessThanOrEqual(baseline.width);
  });
});
