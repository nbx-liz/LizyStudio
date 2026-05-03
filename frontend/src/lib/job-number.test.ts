import { describe, expect, it } from "vitest";
import type { JobSummary } from "@/api/types";
import { getJobNumber } from "./job-number";

function fakeJob(id: string, status: JobSummary["status"]): JobSummary {
  return {
    job_id: id,
    status,
    backend_name: "lizyml",
    job_type: "fit",
    created_at: "2026-05-03T00:00:00Z",
    completed_at: null,
    error: null,
    model_name: "lgbm",
    primary_score: status === "completed" ? 0.5 : null,
    parent_job_id: null,
  };
}

describe("getJobNumber", () => {
  // Issue #359: Inference dropdown drift. Jobs are sorted newest-first
  // in the API response. ``getJobNumber`` returns the absolute job
  // number (total - idx) so every page renders the same ``#N`` for the
  // same job, regardless of whether the page filters its list to only
  // ``completed`` jobs.
  it("returns 1-indexed numbering against the full all-jobs list (newest first)", () => {
    const all: JobSummary[] = [
      fakeJob("c", "completed"), // idx 0 -> #3
      fakeJob("b", "completed"), // idx 1 -> #2
      fakeJob("a", "completed"), // idx 2 -> #1
    ];
    expect(getJobNumber(all[0], all)).toBe(3);
    expect(getJobNumber(all[1], all)).toBe(2);
    expect(getJobNumber(all[2], all)).toBe(1);
  });

  // The bug-of-record: when only the completed jobs are passed, a
  // failed/cancelled job in the middle of the all-jobs list pulls the
  // numbering out of sync with what JobsPage shows. The fix is to
  // always derive against the full list.
  it("matches JobsPage numbering when failed/cancelled jobs sit between completed ones", () => {
    const all: JobSummary[] = [
      fakeJob("e", "completed"), // #5
      fakeJob("d", "failed"), //    #4
      fakeJob("c", "completed"), // #3
      fakeJob("b", "cancelled"), // #2
      fakeJob("a", "completed"), // #1
    ];
    expect(getJobNumber(all[0], all)).toBe(5);
    expect(getJobNumber(all[2], all)).toBe(3);
    expect(getJobNumber(all[4], all)).toBe(1);
  });

  it("returns 0 when the job is not present in the list", () => {
    const all: JobSummary[] = [fakeJob("a", "completed")];
    const stranger = fakeJob("z", "completed");
    expect(getJobNumber(stranger, all)).toBe(0);
  });
});
