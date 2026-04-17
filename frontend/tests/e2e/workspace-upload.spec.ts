/**
 * E2E coverage for the multipart file-upload flow (Issue #91).
 *
 * Existing workspace-fit.spec.ts only exercises path-based loading via
 * `POST /workspace/data/path`. The UI default surface for users is the
 * Upload tab in DataSourceSection, which posts multipart to
 * `POST /workspace/data/upload`. This spec covers that flow at both the
 * API level and the UI level so future regressions in the upload
 * pipeline are caught before release.
 */

import { expect, test } from "@playwright/test";
import { randomBytes } from "node:crypto";
import * as fs from "node:fs";
import {
  API,
  createTestCsv,
  uploadDataFile,
  waitForJobDone,
} from "./helpers/api";
import { dismissOnboarding } from "./helpers/onboarding";

// Per-spec random suffix prevents file collisions when multiple
// Playwright workers run the upload spec in parallel against the same
// /tmp scratch directory (LIZYSTUDIO_FILES_ROOT).
const RUN_TAG = randomBytes(4).toString("hex");
const tmp = (label: string, ext = "csv") =>
  `/tmp/e2e_upload_${RUN_TAG}_${label}.${ext}`;

test.describe("Workspace Upload Flow", () => {
  test.beforeEach(async ({ request }) => {
    await request.post(`${API}/workspace/reset`);
  });

  test("API: multipart upload -> fit -> completion", async ({ request }) => {
    test.setTimeout(120_000);

    const csvPath = createTestCsv(100, tmp("fit"));
    const uploadRes = await uploadDataFile(request, csvPath);
    expect(uploadRes.status()).toBe(200);
    const uploadBody = (await uploadRes.json()) as Record<string, unknown>;
    const dataRef = uploadBody.data_ref as Record<string, unknown>;
    expect(dataRef.shape).toEqual([100, 4]);
    expect(dataRef.source_type).toBe("upload");

    const defaultsRes = await request.get(
      `${API}/workspace/config/defaults?task=binary&target=target`,
    );
    expect(defaultsRes.status()).toBe(200);
    const defaults = await defaultsRes.json();

    const putRes = await request.put(`${API}/workspace/config`, {
      data: defaults,
    });
    expect(putRes.status()).toBe(200);

    const fitRes = await request.post(`${API}/workspace/fit`);
    expect(fitRes.status()).toBe(200);
    const { job_id } = await fitRes.json();

    const job = await waitForJobDone(request, job_id);
    expect(job.status).toBe("completed");
  });

  test("API: rejects unsupported file extension", async ({ request }) => {
    const txtPath = tmp("invalid", "txt");
    fs.writeFileSync(txtPath, "not,a,csv\n1,2,3\n");

    const res = await uploadDataFile(request, txtPath, "text/plain");

    // Backend raises FileInvalidError -> 4xx
    expect(res.status()).toBeGreaterThanOrEqual(400);
    expect(res.status()).toBeLessThan(500);
  });

  test("API: rejects empty file", async ({ request }) => {
    const emptyPath = tmp("empty");
    fs.writeFileSync(emptyPath, "");

    const res = await uploadDataFile(request, emptyPath);

    expect(res.status()).toBeGreaterThanOrEqual(400);
    expect(res.status()).toBeLessThan(500);
  });

  test("UI: hidden file input accepts CSV and shows shape", async ({
    page,
  }) => {
    const csvPath = createTestCsv(50, tmp("ui"));

    await dismissOnboarding(page);
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // The Upload segment is the second option in the SegmentGroup,
    // which renders as <button role="radio">; click it so the hidden
    // file input becomes the active surface.
    await page.getByRole("radio", { name: "Upload" }).click();

    // Wait for the hidden <input type="file"> to attach after the
    // segment switch (the input is conditionally rendered, so it does
    // not exist while the Path segment is active).
    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.waitFor({ state: "attached" });

    // setInputFiles bypasses the native click-to-open dialog and
    // triggers the React onChange handler directly.
    await fileInput.setInputFiles(csvPath);

    // After upload, DataSourceSection renders "<rows> rows × <cols> columns".
    await expect(page.getByText(/50 rows × 4 columns/)).toBeVisible({
      timeout: 15_000,
    });
  });
});
