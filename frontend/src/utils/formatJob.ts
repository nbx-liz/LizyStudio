/**
 * Shared formatting utilities for job/inference numbering and model names.
 */

/**
 * Extract model name from a job config or model_name field.
 * Traverses config.model.name with fallback to "Unknown".
 */
export function getModelName(
  config?: Record<string, unknown>,
  modelName?: string,
): string {
  if (modelName) return modelName;
  if (!config) return "Unknown";
  const model = config.model;
  if (model && typeof model === "object" && model !== null) {
    const name = (model as Record<string, unknown>).name;
    if (typeof name === "string" && name) return name;
  }
  return "Unknown";
}

/**
 * Compute sequential #N from position in a list (oldest = 1, newest = N).
 * Lists are assumed to be sorted newest-first (as returned by the API).
 */
export function getJobNumber(
  jobId: string,
  allJobs: Array<{ job_id: string }>,
): number {
  const idx = allJobs.findIndex((j) => j.job_id === jobId);
  if (idx < 0) return 0;
  return allJobs.length - idx;
}

/**
 * Compute sequential #N for inference records (oldest = 1, newest = N).
 * History is assumed to be sorted newest-first.
 */
export function getInfNumber(
  infId: string,
  history: Array<{ inf_id: string }>,
): number {
  const idx = history.findIndex((h) => h.inf_id === infId);
  if (idx < 0) return 0;
  return history.length - idx;
}

/**
 * Format a job label like "#5 fit LightGBM".
 */
export function formatJobLabel(
  num: number,
  jobType: string,
  modelName: string,
): string {
  return `#${num} ${jobType} ${modelName}`;
}

/**
 * Format an inference label like "Inf #3".
 */
export function formatInfLabel(num: number): string {
  return `Inf #${num}`;
}
