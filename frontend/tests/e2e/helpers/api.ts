import { expect } from "@playwright/test";
import * as fs from "node:fs";

export const API = "http://localhost:8501/api";

/**
 * Create a test CSV with the given number of rows.
 * Columns: id, age, gender, target (binary classification).
 */
export function createTestCsv(
  rows = 100,
  filename = "/tmp/e2e_test_data.csv",
): string {
  const lines = ["id,age,gender,target"];
  for (let i = 0; i < rows; i++) {
    lines.push(`${i},${20 + (i % 50)},${i % 2 === 0 ? "M" : "F"},${i % 2}`);
  }
  fs.writeFileSync(filename, lines.join("\n"));
  return filename;
}

/**
 * Create a test CSV without target column (for prediction-only inference).
 */
export function createTestCsvNoTarget(
  rows = 50,
  filename = "/tmp/e2e_no_target.csv",
): string {
  const lines = ["id,age,gender"];
  for (let i = 0; i < rows; i++) {
    lines.push(`${i},${20 + (i % 50)},${i % 2 === 0 ? "M" : "F"}`);
  }
  fs.writeFileSync(filename, lines.join("\n"));
  return filename;
}

/**
 * Upload a local file via multipart POST /workspace/data/upload.
 * Returns the raw APIResponse so callers can assert status / body
 * themselves (mirrors the negative-path tests that craft the multipart
 * payload inline).
 */
export async function uploadDataFile(
  request: import("@playwright/test").APIRequestContext,
  filePath: string,
  mimeType = "text/csv",
): Promise<import("@playwright/test").APIResponse> {
  const buffer = fs.readFileSync(filePath);
  const name = filePath.split("/").pop() ?? "upload.csv";
  return await request.post(`${API}/workspace/data/upload`, {
    multipart: {
      file: { name, mimeType, buffer },
    },
  });
}

/**
 * Load data, get defaults, save config, start fit. Returns job_id.
 */
export async function setupAndFit(
  request: import("@playwright/test").APIRequestContext,
  csvPath: string,
  target = "target",
  task = "binary",
): Promise<string> {
  const loadRes = await request.post(`${API}/workspace/data/path`, {
    data: { path: csvPath },
  });
  expect(loadRes.status()).toBe(200);

  const defaultsRes = await request.get(
    `${API}/workspace/config/defaults?task=${task}&target=${target}`,
  );
  expect(defaultsRes.status()).toBe(200);
  const config = await defaultsRes.json();

  const putRes = await request.put(`${API}/workspace/config`, {
    data: config,
  });
  expect(putRes.status()).toBe(200);

  const fitRes = await request.post(`${API}/workspace/fit`);
  expect(fitRes.status()).toBe(200);
  const fitBody = await fitRes.json();
  return fitBody.job_id as string;
}

/**
 * Poll until job reaches terminal status.
 */
export async function waitForJobDone(
  request: import("@playwright/test").APIRequestContext,
  jobId: string,
  timeoutMs = 90_000,
): Promise<Record<string, unknown>> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const res = await request.get(`${API}/jobs/${jobId}`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    if (
      ["completed", "failed", "cancelled"].includes(body.status as string)
    ) {
      return body as Record<string, unknown>;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`Job ${jobId} did not finish within ${timeoutMs}ms`);
}
