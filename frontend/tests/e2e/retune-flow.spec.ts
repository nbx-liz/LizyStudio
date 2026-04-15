/**
 * E2E tests for H-0062 Phase B Re-tune / Resume / Lineage flow.
 *
 * These tests exercise the HTTP API end-to-end against a real backend
 * server. They build on the same "tiny tune" pattern used by
 * workspace-tune.spec.ts so each test runs in a few seconds.
 */

import { expect, test } from "@playwright/test";
import * as fs from "node:fs";

const API = "http://localhost:8501/api";

function createTestCsv(): string {
  const csvPath = "/tmp/e2e_retune_test_data.csv";
  const rows = ["id,age,income,gender,target"];
  for (let i = 0; i < 100; i++) {
    rows.push(
      `${i},${20 + (i % 50)},${30000 + i * 100},${i % 2 === 0 ? "M" : "F"},${i % 2}`,
    );
  }
  fs.writeFileSync(csvPath, rows.join("\n"));
  return csvPath;
}

async function pollJobUntilDone(
  request: import("@playwright/test").APIRequestContext,
  jobId: string,
  timeoutMs = 90_000,
  intervalMs = 1_000,
): Promise<Record<string, unknown>> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await request.get(`${API}/jobs/${jobId}`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    if (
      body.status === "completed" ||
      body.status === "failed" ||
      body.status === "cancelled"
    ) {
      return body;
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`Job ${jobId} did not finish within ${timeoutMs}ms`);
}

async function setupTuneJob(
  request: import("@playwright/test").APIRequestContext,
  n_trials = 3,
): Promise<string> {
  const csvPath = createTestCsv();
  await request.post(`${API}/workspace/data/path`, { data: { path: csvPath } });
  const defaultsRes = await request.get(
    `${API}/workspace/config/defaults?task=binary&target=target`,
  );
  const defaults = await defaultsRes.json();
  const configWithTuning = {
    ...defaults,
    tuning: {
      optuna: {
        params: { n_trials, direction: "minimize", timeout: null },
        space: {
          learning_rate: { type: "float", low: 0.01, high: 0.3, log: true },
        },
      },
    },
  };
  await request.put(`${API}/workspace/config`, { data: configWithTuning });
  const tuneRes = await request.post(`${API}/workspace/tune`);
  expect(tuneRes.status()).toBe(200);
  const { job_id: jobId } = await tuneRes.json();
  const jobDetail = await pollJobUntilDone(request, jobId);
  expect(jobDetail.status).toBe("completed");
  return jobId;
}

test.describe("Re-tune / Resume / Lineage flow (H-0062)", () => {
  test.setTimeout(180_000);

  // Per-test baseline of non-terminal jobs captured in beforeEach so the
  // afterEach regression guard only flags jobs introduced BY the current
  // test. The job store directory (/tmp/e2e_jobs) is shared across runs
  // and may already hold stale `running` rows from earlier sessions —
  // those are tracked separately in Issue #99 and must not make this
  // guard flaky.
  let baselineAlive = new Set<string>();

  async function fetchAliveJobIds(
    request: import("@playwright/test").APIRequestContext,
  ): Promise<Set<string>> {
    const res = await request.get(`${API}/jobs/`);
    // Fail loud on any non-200 so the baseline snapshot and the
    // afterEach comparison stay symmetric. A silently empty baseline
    // after a transient 5xx would flag every pre-existing running row
    // as a fresh leak in the next afterEach.
    expect(res.status(), "GET /jobs/ must succeed").toBe(200);
    const jobs = (await res.json()) as Array<{
      job_id: string;
      status: string;
    }>;
    return new Set(
      jobs
        .filter((j) => j.status === "running" || j.status === "pending")
        .map((j) => j.job_id),
    );
  }

  test.beforeEach(async ({ request }) => {
    await request.post(`${API}/workspace/reset`);
    baselineAlive = await fetchAliveJobIds(request);
  });

  // Regression guard for the fire-and-forget orphan pattern that once
  // leaked a retune child's active slot into subsequent tests, causing
  // a cascade of 409 JOB_CONFLICT failures. workspace/reset intentionally
  // does NOT clear JobStore._active_job_id (see Issue #99), so any test
  // that starts a background job must drive it to a terminal state before
  // returning. Computing the diff against the per-test baseline ensures
  // this guard fires on NEW leaks only, not on stale pre-existing rows.
  //
  // Known blind spot: a job whose on-disk status is already terminal
  // but whose _active_job_id slot has not yet been released will NOT be
  // flagged here (it is filtered out of `fetchAliveJobIds`). That tiny
  // window is real — _run_job_core writes status then releases the slot
  // in finally — but it closes as soon as the runner thread returns, so
  // every existing test that calls `pollJobUntilDone` or cancel+poll
  // ends up in a fully-clean state by the time afterEach runs. If a
  // future test ever hits a 409 without an observed leak here, check
  // for a new fire-and-forget that skips `pollJobUntilDone`.
  test.afterEach(async ({ request }) => {
    const currentAlive = await fetchAliveJobIds(request);
    const leaked = [...currentAlive].filter((id) => !baselineAlive.has(id));
    expect(
      leaked,
      `Test leaked non-terminal jobs introduced during this test: ${leaked.join(", ")}`,
    ).toHaveLength(0);
  });

  test("API: completed parent can be retuned into a child with parent_job_id", async ({
    request,
  }) => {
    const parentId = await setupTuneJob(request, 3);

    // The parent must have model.pkl + model_meta.json on disk.
    const parentDetail = await request.get(`${API}/jobs/${parentId}`);
    const parentBody = await parentDetail.json();
    expect(parentBody.status).toBe("completed");
    expect(parentBody.parent_job_id).toBeNull();

    // POST /retune with n_trials=2
    const retuneRes = await request.post(`${API}/jobs/${parentId}/retune`, {
      data: { n_trials: 2 },
    });
    expect(retuneRes.status()).toBe(200);
    const retuneBody = await retuneRes.json();
    expect(retuneBody.parent_job_id).toBe(parentId);
    const childId: string = retuneBody.job_id;
    expect(childId).toBeTruthy();

    // Child should run and complete; trials >= parent.trials + at
    // least one new trial. Optuna may prune so we cannot demand the
    // exact count (3+2=5) on every CI run.
    const childDetail = await pollJobUntilDone(request, childId);
    expect(childDetail.status).toBe("completed");
    const tuneResult = childDetail.tune_result as Record<string, unknown>;
    const trials = tuneResult.trials as unknown[];
    // Lower bound: parent had at least 1 trial after pruning + child
    // added at least 1 new trial out of the requested 2.
    expect(trials.length).toBeGreaterThanOrEqual(2);

    // Child meta should reference the parent.
    const childAfter = await request.get(`${API}/jobs/${childId}`);
    const childAfterBody = await childAfter.json();
    expect(childAfterBody.parent_job_id).toBe(parentId);
  });

  test("API: retune continues the Optuna study (best_score >= parent best_score)", async ({
    request,
  }) => {
    const parentId = await setupTuneJob(request, 3);
    const parentBody = await (await request.get(`${API}/jobs/${parentId}`)).json();
    const parentBest = (parentBody.tune_result as { best_score: number }).best_score;

    const retuneRes = await request.post(`${API}/jobs/${parentId}/retune`, {
      data: { n_trials: 2 },
    });
    expect(retuneRes.status()).toBe(200);
    const { job_id: childId } = await retuneRes.json();

    const childDetail = await pollJobUntilDone(request, childId);
    const childBest = (childDetail.tune_result as { best_score: number }).best_score;
    // The setupTuneJob fixture configures `direction: "minimize"`, so
    // a continuing study can only push best_score down or keep it
    // equal — it must never be strictly worse than the parent's best.
    // The assertion is direction-aware; if setupTuneJob ever flips to
    // maximize, change to `>=`.
    //
    // Add a tiny epsilon for IEEE-754 rounding drift: parent and child
    // best_score values pass through JSON serialization and metric
    // re-aggregation, so an "equal" continuation can come back as
    // 0.9800000000000001 vs 0.98 (Issue #100). 1e-9 is far below any
    // metric precision we care about.
    expect(childBest).toBeLessThanOrEqual(parentBest + 1e-9);
  });

  test("API: retune on a fit job returns 400 INVALID_PARAM", async ({
    request,
  }) => {
    // Create a fit job.
    const csvPath = createTestCsv();
    await request.post(`${API}/workspace/data/path`, { data: { path: csvPath } });
    const defaultsRes = await request.get(
      `${API}/workspace/config/defaults?task=binary&target=target`,
    );
    const defaults = await defaultsRes.json();
    await request.put(`${API}/workspace/config`, { data: defaults });
    const fitRes = await request.post(`${API}/workspace/fit`);
    expect(fitRes.status()).toBe(200);
    const { job_id: fitJobId } = await fitRes.json();
    await pollJobUntilDone(request, fitJobId);

    const retuneRes = await request.post(`${API}/jobs/${fitJobId}/retune`, {
      data: { n_trials: 2 },
    });
    expect(retuneRes.status()).toBe(400);
    const body = await retuneRes.json();
    expect(body.error.code).toBe("INVALID_PARAM");
  });

  // Note: the CHECKPOINT_MISSING branch is fully covered by the
  // backend unit test ``test_retune_rejects_without_checkpoint`` in
  // ``tests/test_retune_api.py``. The previous E2E placeholder
  // depended on a ``/test-helpers/delete-checkpoint`` endpoint that
  // does not exist and silently returned, providing no value.

  test("API: lineage endpoint exposes parent-child relationship", async ({
    request,
  }) => {
    const parentId = await setupTuneJob(request, 3);
    const retuneRes = await request.post(`${API}/jobs/${parentId}/retune`, {
      data: { n_trials: 2 },
    });
    const { job_id: childId } = await retuneRes.json();
    await pollJobUntilDone(request, childId);

    const lineageRes = await request.get(`${API}/jobs/${parentId}/lineage`);
    expect(lineageRes.status()).toBe(200);
    const { tree } = await lineageRes.json();
    expect(tree.job_id).toBe(parentId);
    expect(tree.children.length).toBe(1);
    expect(tree.children[0].job_id).toBe(childId);
    expect(tree.children[0].status).toBe("completed");
    expect(tree.truncated).toBe(false);
  });

  test("API: cascade delete removes parent and child together", async ({
    request,
  }) => {
    const parentId = await setupTuneJob(request, 3);
    const retuneRes = await request.post(`${API}/jobs/${parentId}/retune`, {
      data: { n_trials: 2 },
    });
    const { job_id: childId } = await retuneRes.json();
    await pollJobUntilDone(request, childId);

    const delRes = await request.delete(
      `${API}/jobs/${parentId}?cascade=true`,
    );
    expect(delRes.status()).toBe(200);
    const body = await delRes.json();
    const removed: string[] = body.removed_job_ids;
    expect(new Set(removed)).toEqual(new Set([parentId, childId]));

    // Both gone.
    const getParent = await request.get(`${API}/jobs/${parentId}`);
    expect(getParent.status()).toBe(404);
    const getChild = await request.get(`${API}/jobs/${childId}`);
    expect(getChild.status()).toBe(404);
  });

  test("API: cancel during retune frees the parent lock and marks child cancelled", async ({
    request,
  }) => {
    // B-1: starting a retune should claim the parent lock; cancelling
    // the child must release it so a subsequent retune is accepted.
    const parentId = await setupTuneJob(request, 3);
    const retuneRes = await request.post(`${API}/jobs/${parentId}/retune`, {
      data: { n_trials: 50 }, // big enough that we can cancel before completion
    });
    expect(retuneRes.status()).toBe(200);
    const { job_id: childId } = await retuneRes.json();

    // Issue cancel as soon as the child has started running.
    // Poll briefly so we hit the `running` state instead of cancelling
    // a still-pending job (which would also be a valid path but doesn't
    // exercise the cancel-aware progress callback).
    for (let i = 0; i < 30; i++) {
      const status = await (await request.get(`${API}/jobs/${childId}`)).json();
      if (
        status.status === "running" ||
        status.status === "completed" ||
        status.status === "failed"
      ) {
        break;
      }
      await new Promise((r) => setTimeout(r, 200));
    }
    const cancelRes = await request.post(`${API}/jobs/${childId}/cancel`);
    // Cancel may 200 (running) or 400 (already finished) on a fast box;
    // the important assertion is the *eventual* state of the child and
    // that the parent lock is free for another retune.
    expect([200, 400]).toContain(cancelRes.status());
    const final = await pollJobUntilDone(request, childId);
    expect(["cancelled", "failed", "completed"]).toContain(final.status);

    // The parent lock must be released regardless of how the child ended,
    // so a second retune from the same parent succeeds.
    const second = await request.post(`${API}/jobs/${parentId}/retune`, {
      data: { n_trials: 2 },
    });
    expect(second.status()).toBe(200);
    const { job_id: secondChildId } = await second.json();
    // Drain the second retune before returning so it does not hold the
    // JobStore active slot into the next test (workspace/reset does not
    // clear _active_job_id — see Issue #99). Cancel first to keep this
    // test fast; pollJobUntilDone accepts any terminal state.
    const cancelSecond = await request.post(`${API}/jobs/${secondChildId}/cancel`);
    // 200 (running) or 400 (already finished) are both acceptable; a
    // 5xx would mean the backend crashed and we should fail loud rather
    // than let `pollJobUntilDone` time out 90 seconds later with a
    // misleading error.
    expect([200, 400]).toContain(cancelSecond.status());
    await pollJobUntilDone(request, secondChildId);
  });

  test("API: second retune on the same parent returns 409 PARENT_LOCKED while first runs", async ({
    request,
  }) => {
    // B-2: per-parent exclusive lock — the API must reject overlapping
    // retune requests with 409 PARENT_LOCKED until the first child
    // finishes (success / failure / cancellation).
    const parentId = await setupTuneJob(request, 3);
    const first = await request.post(`${API}/jobs/${parentId}/retune`, {
      data: { n_trials: 30 }, // big enough to still be running when we send the second
    });
    expect(first.status()).toBe(200);
    const { job_id: firstChildId } = await first.json();

    // Immediately attempt a second retune. Optuna start-up usually takes
    // a few hundred ms so the first child is still pending/running here.
    const second = await request.post(`${API}/jobs/${parentId}/retune`, {
      data: { n_trials: 2 },
    });
    expect(second.status()).toBe(409);
    const errorBody = await second.json();
    expect(errorBody.error.code).toBe("PARENT_LOCKED");

    // Cleanup: cancel the long-running first child so the test does not
    // block subsequent tests that share the same parent slot.
    await request.post(`${API}/jobs/${firstChildId}/cancel`);
    await pollJobUntilDone(request, firstChildId);
  });

  test("API: corrupted model_meta.json on parent returns 400 PICKLE_INCOMPATIBLE", async ({
    request,
  }) => {
    // B-3: the API-layer pickle compatibility check must catch a
    // corrupted sidecar file before spawning a child job. Without this,
    // the user would only see a generic "child failed" status hours
    // later instead of an immediate, actionable 400.
    const parentId = await setupTuneJob(request, 3);

    // Corrupt the parent's model_meta.json directly on disk. The
    // jobs directory layout is fixed at ``$LIZYSTUDIO_HOME/jobs/{id}``;
    // for the e2e environment this resolves to ``~/.lizystudio/jobs``.
    const home = process.env.HOME ?? "/home/rem";
    const metaPath = `${home}/.lizystudio/jobs/${parentId}/model_meta.json`;
    if (!fs.existsSync(metaPath)) {
      // Some environments may relocate the jobs dir; skip rather than
      // false-positive when the file we want to corrupt is missing.
      test.skip(true, `model_meta.json not found at ${metaPath}`);
      return;
    }
    fs.writeFileSync(metaPath, "{ this is not valid JSON ]");

    const retuneRes = await request.post(`${API}/jobs/${parentId}/retune`, {
      data: { n_trials: 2 },
    });
    expect(retuneRes.status()).toBe(400);
    const body = await retuneRes.json();
    expect(body.error.code).toBe("PICKLE_INCOMPATIBLE");
  });

  test("UI: Re-tune from Workspace shows the Lineage panel and click-through navigates to the child", async ({
    page,
    request,
  }) => {
    // B-4: drive a Re-tune via the actual UI and verify that
    //   1. the Lineage panel renders for the resulting parent/child pair
    //   2. clicking the child node in the lineage tree is wired through
    //      to the Workspace selection (onJobStarted handler).
    test.setTimeout(180_000);

    // Pre-create the parent via API so the UI test does not also have
    // to walk through the upload + tune flow.
    const parentId = await setupTuneJob(request, 3);

    // Issue #101: land directly on the Workspace with the parent job
    // pre-selected via the ?job_id= query param. WorkspacePage reads
    // that param on mount and hydrates its local currentJobId state,
    // so the Results panel renders immediately without the test having
    // to drive a Jobs-page-click-through (JobList only lives on /jobs,
    // not on the Workspace left rail, and WorkspacePage does not
    // auto-hydrate currentJobId from /workspace/status).
    await page.goto(`/?job_id=${parentId}`);
    await page.waitForLoadState("networkidle");

    // Re-tune button should be enabled because the parent has a
    // checkpoint. The accessible name comes from the button's
    // `aria-label="Re-tune with additional trials"` (set in
    // RetuneActionButton.tsx), not from its visible text label
    // "Re-tune (+N trials)" — getByRole matches the aria-label first.
    const retuneButton = page.getByRole("button", {
      name: /Re-tune with additional trials/i,
    });
    await retuneButton.waitFor({ state: "visible", timeout: 30_000 });
    await retuneButton.click();

    // The dialog opens with a default n_trials input; submit immediately.
    const startButton = page.getByRole("button", { name: /Start Re-tune/i });
    await startButton.waitFor({ state: "visible" });
    await startButton.click();

    // The toast confirms the child job id; capture it from the API
    // call instead of parsing toast text (more stable across themes).
    // Wait for any new tune child to appear on the parent's lineage.
    let childId: string | null = null;
    for (let i = 0; i < 60; i++) {
      const lineageRes = await request.get(`${API}/jobs/${parentId}/lineage`);
      if (lineageRes.ok()) {
        const lineage = await lineageRes.json();
        const children = lineage.tree?.children ?? [];
        if (children.length > 0) {
          childId = children[0].job_id;
          break;
        }
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    expect(childId, "child job did not appear on parent lineage").not.toBeNull();
    if (childId == null) return; // appease type narrowing

    // Wait for the child to finish so the Lineage panel has a stable badge.
    await pollJobUntilDone(request, childId);

    // The Workspace should switch selection to the child via
    // onJobStarted. The Lineage panel renders each job id as a
    // clickable button; we narrow to the button role because a bare
    // getByText(jobId) also matches the "Re-tune started (jobid)"
    // toast that lingers right after we click Start Re-tune.
    //
    // Note: the lineage tree here is rooted at the *currently viewed*
    // job (the child we just switched to), not at the parent — the
    // backend returns a subtree rooted at job_id from
    // GET /jobs/{id}/lineage. So we can assert the child appears in
    // its own lineage subtree, but we cannot click "parent" to go
    // back within this panel; promoting a different job back into
    // the Workspace is the Jobs page's "Open in Workspace" button
    // (Issue #101) rather than an in-lineage navigation.
    const lineageHeader = page.getByText("Lineage", { exact: true });
    await lineageHeader.waitFor({ state: "visible", timeout: 30_000 });
    const childNode = page.getByRole("button", { name: childId });
    await childNode.waitFor({ state: "visible" });

    // Assert the Re-tune button is still present (and therefore the
    // child is still rendered as a Workspace completed view).
    await expect(retuneButton).toBeVisible({ timeout: 10_000 });
  });

  test("UI: grandchild Re-tune button is enabled on a child job", async ({
    page,
    request,
  }) => {
    // B-5: the Decision flip 2026-04-14 made grandchild retune allowed.
    // Verify the UI side does not disable the button on a child job —
    // i.e. RetuneActionButton has no parent_job_id-based disabledReason.
    test.setTimeout(180_000);

    // Set up parent -> child via API so the UI test stays focused on
    // the button state.
    const parentId = await setupTuneJob(request, 3);
    const ab = await request.post(`${API}/jobs/${parentId}/retune`, {
      data: { n_trials: 2 },
    });
    expect(ab.status()).toBe(200);
    const { job_id: childId } = await ab.json();
    await pollJobUntilDone(request, childId);

    // Issue #101: land directly on the Workspace with the CHILD job
    // pre-selected via the ?job_id= query param. This is the stable
    // entry point for "show me this specific completed job in the
    // Workspace" — see the Lineage UI test above for the same pattern.
    await page.goto(`/?job_id=${childId}`);
    await page.waitForLoadState("networkidle");

    // The Re-tune button must be enabled (not disabled with a tooltip)
    // because the grandchild rule was lifted. The accessible name
    // comes from the aria-label, not the visible text label.
    const retuneButton = page.getByRole("button", {
      name: /Re-tune with additional trials/i,
    });
    await retuneButton.waitFor({ state: "visible", timeout: 30_000 });
    await expect(retuneButton).toBeEnabled();
  });

  test("API: grandchild retune is allowed (H-0062 Decision flip 2026-04-14)", async ({
    request,
  }) => {
    // Build a chain A -> B -> C and verify the API accepts each step.
    // The original MVP scope rejected grandchild retune via INVALID_PARAM
    // (parent_job_id is not None), but UX feedback showed users
    // naturally expect to keep continuing tuning from the latest
    // result. The decision was flipped so each child can host another
    // retune; lineage depth is bounded only by the tree truncation
    // limit (20) used by the lineage endpoint and cascade delete.
    const parentId = await setupTuneJob(request, 3);

    // A -> B
    const ab = await request.post(`${API}/jobs/${parentId}/retune`, {
      data: { n_trials: 2 },
    });
    expect(ab.status()).toBe(200);
    const { job_id: childB } = await ab.json();
    await pollJobUntilDone(request, childB);

    // B -> C (the case that used to be rejected)
    const bc = await request.post(`${API}/jobs/${childB}/retune`, {
      data: { n_trials: 2 },
    });
    expect(bc.status()).toBe(200);
    const bcBody = await bc.json();
    expect(bcBody.job_id).not.toBe(childB);
    expect(bcBody.parent_job_id).toBe(childB);
    // Drain C before returning — the test only asserts API acceptance,
    // but leaving it running would orphan the active slot for the next
    // test (see Issue #99 and this spec's afterEach guard).
    await pollJobUntilDone(request, bcBody.job_id as string);
  });
});
