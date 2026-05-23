import { type APIRequestContext, expect, test } from "@playwright/test";
import * as fs from "node:fs";

const API = "http://localhost:8501/api";

/**
 * P-0099 v3-20g: end-to-end pause / unpause flow against the real
 * backend.
 *
 * Drives the full HTTP contract — POST /tune, POST /pause,
 * GET /jobs/{id} polling, POST /unpause, terminal completion — so a
 * regression in any layer (cancel-aware-cb, _run_job_core paused
 * branch, subprocess parent finally, JobStore primitives, API
 * validation) surfaces as a black-box failure.
 *
 * The spec uses a small-but-realistic Tune (n_trials=8) so the worker
 * is alive long enough for /pause to land mid-flight. Each trial in
 * lizyml is dominated by k-fold CV on 100 rows, so total walltime is
 * ~20-30 s on CI. The wider window (8 vs 4) absorbs the
 * ~tens-of-ms latency added by ``run_tune``'s ``_assert_inv_t3``
 * warn-only helper (Issue #527 / P-0109 PR-6b) so the assertion below
 * does not race the trial loop.
 *
 * Why this lives in Playwright instead of pytest: the only reliable
 * way to exercise the full pause flow is through the public HTTP API
 * (the worker thread + cooperative-cb path is genuinely concurrent),
 * and the existing tune E2E specs already use APIRequestContext for
 * the same reason. This spec is API-driven — the UI button affordances
 * are covered separately by the Vitest component tests in v3-20f.
 */

function createTestCsv(): string {
  const csvPath = "/tmp/e2e_tune_resume_test_data.csv";
  const rows = ["id,age,income,gender,target"];
  for (let i = 0; i < 100; i++) {
    rows.push(
      `${i},${20 + (i % 50)},${30000 + i * 100},${i % 2 === 0 ? "M" : "F"},${i % 2}`,
    );
  }
  fs.writeFileSync(csvPath, rows.join("\n"));
  return csvPath;
}

async function pollJobUntilStatus(
  request: APIRequestContext,
  jobId: string,
  target: string,
  timeoutMs = 120_000,
  intervalMs = 500,
): Promise<Record<string, unknown>> {
  const deadline = Date.now() + timeoutMs;
  let lastStatus: string | undefined;
  while (Date.now() < deadline) {
    const res = await request.get(`${API}/jobs/${jobId}`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    lastStatus = body.status as string;
    if (lastStatus === target) {
      return body;
    }
    // Short-circuit on terminal-but-not-target so the test fails fast
    // instead of timing out when the worker died unexpectedly.
    if (
      target !== lastStatus &&
      (lastStatus === "completed" ||
        lastStatus === "failed" ||
        lastStatus === "cancelled")
    ) {
      throw new Error(
        `Job ${jobId} reached terminal "${lastStatus}" before target "${target}"`,
      );
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(
    `Job ${jobId} did not reach "${target}" within ${timeoutMs}ms (last: ${lastStatus})`,
  );
}

test.describe("Tune pause / unpause flow (P-0099 v3-20g)", () => {
  test.setTimeout(180_000);

  test.beforeEach(async ({ request }) => {
    await request.post(`${API}/workspace/reset`);
  });

  test("API: tune -> pause -> paused -> unpause -> completed (in-place resume)", async ({
    request,
  }) => {
    // ---- Setup: load data + config + start tune --------------------------
    const csvPath = createTestCsv();
    const loadRes = await request.post(`${API}/workspace/data/path`, {
      data: { path: csvPath },
    });
    expect(loadRes.status()).toBe(200);

    const defaultsRes = await request.get(
      `${API}/workspace/config/defaults?task=binary&target=target`,
    );
    expect(defaultsRes.status()).toBe(200);
    const defaults = await defaultsRes.json();

    // n_trials=8 keeps the test under the 3-minute budget while still
    // giving the worker enough wall-clock to be in "running" when the
    // pause request lands. Issue #527: this was previously 4 but the
    // ``_assert_inv_t3`` warn-only helper's ~tens-of-ms latency raced
    // the pause-observation timing; doubling the trial count makes the
    // helper's setup cost negligible relative to the trial-loop window.
    const config = {
      ...defaults,
      tuning: {
        optuna: {
          params: { n_trials: 8, timeout: null },
          space: {
            learning_rate: { type: "float", low: 0.001, high: 0.3, log: true },
          },
        },
      },
    };

    const putRes = await request.put(`${API}/workspace/config`, {
      data: config,
    });
    expect(putRes.status()).toBe(200);

    const tuneRes = await request.post(`${API}/workspace/tune`);
    expect(tuneRes.status()).toBe(200);
    const tuneBody = await tuneRes.json();
    const jobId = tuneBody.job_id as string;
    expect(jobId).toBeTruthy();

    // Wait until the worker has actually claimed the slot — a /pause
    // before status="running" would 400 with JOB_NOT_RUNNING.
    await pollJobUntilStatus(request, jobId, "running", 30_000, 250);

    // ---- Pause ------------------------------------------------------------
    const pauseRes = await request.post(`${API}/jobs/${jobId}/pause`);
    expect(
      pauseRes.status(),
      `POST /pause should accept a running tune; got ${pauseRes.status()} with body ${await pauseRes.text()}`,
    ).toBe(200);
    const pauseBody = await pauseRes.json();
    expect(pauseBody.status).toBe("pause_requested");

    // The worker observes the on-disk PAUSE flag at the next
    // cooperative-cb boundary. With trials of ~3 s each, the longest
    // we should wait is one trial duration plus the fold-cb cadence.
    const pausedJob = await pollJobUntilStatus(
      request,
      jobId,
      "paused",
      60_000,
      250,
    );
    expect(pausedJob.completed_at).toBeNull();

    // INV-pause-1: the workspace status must report the paused job as
    // the active slot owner — a /tune attempt while paused must be
    // rejected with JOB_CONFLICT.
    const conflictRes = await request.post(`${API}/workspace/tune`);
    expect(
      conflictRes.status(),
      "INV-1 + INV-pause-1: /tune while paused must be 409 JOB_CONFLICT",
    ).toBe(409);

    // ---- Unpause ----------------------------------------------------------
    const unpauseRes = await request.post(`${API}/jobs/${jobId}/unpause`);
    expect(
      unpauseRes.status(),
      `POST /unpause should accept a paused tune; got ${unpauseRes.status()} with body ${await unpauseRes.text()}`,
    ).toBe(200);
    const unpauseBody = await unpauseRes.json();
    expect(unpauseBody.status).toBe("unpause_started");
    expect(unpauseBody.job_id).toBe(jobId); // in-place: same id

    // ---- Wait for terminal completion -------------------------------------
    const completedJob = await pollJobUntilStatus(
      request,
      jobId,
      "completed",
      120_000,
      500,
    );
    const tuneResult = completedJob.tune_result as Record<string, unknown>;
    expect(tuneResult).toBeTruthy();
    const trials = tuneResult.trials as unknown[];
    expect(Array.isArray(trials)).toBe(true);
    // INV-4: total trials over the pause/resume round-trip equals
    // n_trials. If lizyml had silently restarted the study instead of
    // re-attaching, we'd see > 8 (duplicates) or < 8 (lost trials).
    expect(trials.length).toBe(8);
  });

  test("API: pause on fit job is rejected with JOB_NOT_PAUSEABLE", async ({
    request,
  }) => {
    const csvPath = createTestCsv();
    const loadRes = await request.post(`${API}/workspace/data/path`, {
      data: { path: csvPath },
    });
    expect(loadRes.status()).toBe(200);
    const defaultsRes = await request.get(
      `${API}/workspace/config/defaults?task=binary&target=target`,
    );
    expect(defaultsRes.status()).toBe(200);
    const defaults = await defaultsRes.json();
    await request.put(`${API}/workspace/config`, { data: defaults });

    const fitRes = await request.post(`${API}/workspace/fit`);
    expect(fitRes.status()).toBe(200);
    const fitJobId = (await fitRes.json()).job_id as string;

    // Try /pause as fast as possible — the fit may still be running or
    // may already be completed; both states reject /pause for a fit
    // job (running -> JOB_NOT_PAUSEABLE; terminal -> same).
    const pauseRes = await request.post(`${API}/jobs/${fitJobId}/pause`);
    expect(
      [400, 404].includes(pauseRes.status()),
      `Pause on a fit job must be rejected (400/404); got ${pauseRes.status()}`,
    ).toBe(true);
    if (pauseRes.status() === 400) {
      const body = await pauseRes.json();
      expect(body.error.code).toBe("JOB_NOT_PAUSEABLE");
    }
  });

  test("API: unpause on a non-paused job is rejected with JOB_NOT_PAUSED", async ({
    request,
  }) => {
    const csvPath = createTestCsv();
    await request.post(`${API}/workspace/data/path`, { data: { path: csvPath } });
    const defaultsRes = await request.get(
      `${API}/workspace/config/defaults?task=binary&target=target`,
    );
    const defaults = await defaultsRes.json();
    await request.put(`${API}/workspace/config`, {
      data: {
        ...defaults,
        tuning: {
          optuna: { params: { n_trials: 1, timeout: null }, space: {} },
        },
      },
    });
    const tuneRes = await request.post(`${API}/workspace/tune`);
    const tuneJobId = (await tuneRes.json()).job_id as string;

    // Wait for completion (n_trials=1 keeps this fast).
    const completed = await pollJobUntilStatus(
      request,
      tuneJobId,
      "completed",
      60_000,
      500,
    );
    expect(completed.status).toBe("completed");

    const unpauseRes = await request.post(`${API}/jobs/${tuneJobId}/unpause`);
    expect(unpauseRes.status()).toBe(400);
    const body = await unpauseRes.json();
    expect(body.error.code).toBe("JOB_NOT_PAUSED");
  });
});
