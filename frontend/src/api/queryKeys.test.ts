/**
 * Contract tests for queryKeys factory.
 *
 * The factory must produce byte-identical arrays to the pre-refactor
 * inline keys, because this PR only renames the construction site — not
 * the cache namespace. Any drift here would split a cache entry in two
 * and silently cause stale data.
 */

import { describe, expect, it } from "vitest";
import { queryKeys } from "./queryKeys";

describe("queryKeys factory — bit-identical to pre-refactor inline keys", () => {
  describe("jobs family", () => {
    it("jobs() → ['jobs']", () => {
      expect(queryKeys.jobs()).toEqual(["jobs"]);
    });

    it("job(id) → ['job', id]", () => {
      expect(queryKeys.job("job_abc")).toEqual(["job", "job_abc"]);
    });

    it("job(null) → ['job', null] (disabled-query sentinel)", () => {
      expect(queryKeys.job(null)).toEqual(["job", null]);
    });

    it("jobDetail(id) → ['job-detail', id]", () => {
      expect(queryKeys.jobDetail("job_abc")).toEqual(["job-detail", "job_abc"]);
    });

    it("jobLog(id) → ['job-log', id]", () => {
      expect(queryKeys.jobLog("job_abc")).toEqual(["job-log", "job_abc"]);
    });

    it("jobLog(null) → ['job-log', null]", () => {
      expect(queryKeys.jobLog(null)).toEqual(["job-log", null]);
    });

    it("jobLineage(id) → ['job-lineage', id]", () => {
      expect(queryKeys.jobLineage("job_abc")).toEqual([
        "job-lineage",
        "job_abc",
      ]);
    });

    it("jobPlots(id) → ['job-plots', id]", () => {
      expect(queryKeys.jobPlots("job_abc")).toEqual(["job-plots", "job_abc"]);
    });

    it("jobPlot(id, type) → ['job-plot', id, type]", () => {
      expect(queryKeys.jobPlot("job_abc", "confusion_matrix")).toEqual([
        "job-plot",
        "job_abc",
        "confusion_matrix",
      ]);
    });

    it("jobPlotLearningCurve → ['job-plot', id, 'learning-curve', metric]", () => {
      expect(queryKeys.jobPlotLearningCurve("job_abc", "rmse")).toEqual([
        "job-plot",
        "job_abc",
        "learning-curve",
        "rmse",
      ]);
    });

    it("jobPlotLearningCurve accepts null metric before user selects one", () => {
      expect(queryKeys.jobPlotLearningCurve("job_abc", null)).toEqual([
        "job-plot",
        "job_abc",
        "learning-curve",
        null,
      ]);
    });

    it("jobPlotImportance → ['job-plot', id, 'importance', kind]", () => {
      expect(queryKeys.jobPlotImportance("job_abc", "gain")).toEqual([
        "job-plot",
        "job_abc",
        "importance",
        "gain",
      ]);
    });

    it("jobPlotTuning → ['job-plot', id, 'tuning']", () => {
      expect(queryKeys.jobPlotTuning("job_abc")).toEqual([
        "job-plot",
        "job_abc",
        "tuning",
      ]);
    });

    it("jobImportance → ['job-importance', id, kind]", () => {
      expect(queryKeys.jobImportance("job_abc", "split")).toEqual([
        "job-importance",
        "job_abc",
        "split",
      ]);
    });

    it("jobImportanceKinds → ['job-importance-kinds', id]", () => {
      expect(queryKeys.jobImportanceKinds("job_abc")).toEqual([
        "job-importance-kinds",
        "job_abc",
      ]);
    });

    it("jobLearningCurveMetrics → ['job-learning-curve-metrics', id]", () => {
      expect(queryKeys.jobLearningCurveMetrics("job_abc")).toEqual([
        "job-learning-curve-metrics",
        "job_abc",
      ]);
    });

    it("jobSplitSummary → ['job-split-summary', id]", () => {
      expect(queryKeys.jobSplitSummary("job_abc")).toEqual([
        "job-split-summary",
        "job_abc",
      ]);
    });
  });

  describe("inference family", () => {
    it("infHistory(jobId) → ['inf-history', jobId]", () => {
      expect(queryKeys.infHistory("job_abc")).toEqual([
        "inf-history",
        "job_abc",
      ]);
    });

    it("infHistoryAll() → ['inf-history']", () => {
      expect(queryKeys.infHistoryAll()).toEqual(["inf-history"]);
    });

    it("infRecord(infId, jobId) → ['inf-record', infId, jobId]", () => {
      expect(queryKeys.infRecord("inf1", "job_abc")).toEqual([
        "inf-record",
        "inf1",
        "job_abc",
      ]);
    });

    it("infMetrics → ['inf-metrics', infId, jobId]", () => {
      expect(queryKeys.infMetrics("inf1", "job_abc")).toEqual([
        "inf-metrics",
        "inf1",
        "job_abc",
      ]);
    });

    it("infPredictions → ['inf-predictions', infId, jobId, page]", () => {
      expect(queryKeys.infPredictions("inf1", "job_abc", 2)).toEqual([
        "inf-predictions",
        "inf1",
        "job_abc",
        2,
      ]);
    });

    it("infPlot → ['inf-plot', infId, jobId, plotType]", () => {
      expect(
        queryKeys.infPlot("inf1", "job_abc", "prediction-distribution"),
      ).toEqual(["inf-plot", "inf1", "job_abc", "prediction-distribution"]);
    });

    it("infShap → ['inf-shap', infId, jobId]", () => {
      expect(queryKeys.infShap("inf1", "job_abc")).toEqual([
        "inf-shap",
        "inf1",
        "job_abc",
      ]);
    });

    it("infComparison → ['inf-comparison', infId, compareInfId, jobId]", () => {
      expect(queryKeys.infComparison("inf1", "inf2", "job_abc")).toEqual([
        "inf-comparison",
        "inf1",
        "inf2",
        "job_abc",
      ]);
    });

    it("infComparison handles null compareInfId", () => {
      expect(queryKeys.infComparison("inf1", null, "job_abc")).toEqual([
        "inf-comparison",
        "inf1",
        null,
        "job_abc",
      ]);
    });
  });

  describe("workspace / config family", () => {
    it("config → ['config']", () => {
      expect(queryKeys.config()).toEqual(["config"]);
    });

    it("configSchema → ['config-schema']", () => {
      expect(queryKeys.configSchema()).toEqual(["config-schema"]);
    });

    it("uiSchema → ['ui-schema']", () => {
      expect(queryKeys.uiSchema()).toEqual(["ui-schema"]);
    });

    it("backends → ['backends']", () => {
      expect(queryKeys.backends()).toEqual(["backends"]);
    });

    it("columns → ['columns']", () => {
      expect(queryKeys.columns()).toEqual(["columns"]);
    });

    it("files(path) → ['files', path]", () => {
      expect(queryKeys.files("~/data")).toEqual(["files", "~/data"]);
    });

    it("files('~') fallback for null path is caller's responsibility", () => {
      expect(queryKeys.files("~")).toEqual(["files", "~"]);
    });
  });

  describe("invalidation compatibility", () => {
    it("jobs() matches the key used for list invalidation", () => {
      // Pre-refactor call: queryClient.invalidateQueries({ queryKey: ["jobs"] })
      const pre = ["jobs"];
      const post = queryKeys.jobs();
      expect(post).toEqual(pre);
    });

    it("job(id) matches the key used for detail invalidation", () => {
      const jobId = "job_abc";
      const pre = ["job", jobId];
      const post = queryKeys.job(jobId);
      expect(post).toEqual(pre);
    });

    it("infHistoryAll() matches the root-level inference invalidation", () => {
      const pre = ["inf-history"];
      const post = queryKeys.infHistoryAll();
      expect(post).toEqual(pre);
    });
  });
});
