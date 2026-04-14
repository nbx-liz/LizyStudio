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

  test.beforeEach(async ({ request }) => {
    await request.post(`${API}/workspace/reset`);
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
    expect(childBest).toBeLessThanOrEqual(parentBest);
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
  });
});
