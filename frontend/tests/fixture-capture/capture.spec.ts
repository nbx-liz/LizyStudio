import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Page, test } from "@playwright/test";
import { API } from "../e2e/helpers/api";
import { pollJobUntilTerminal, seedUiWorkspace } from "../e2e/helpers/workspace-ui";

/**
 * Capture one production job per fixture scenario through the real SPA
 * (P-0116 child 8, D-20261022-005). The frontend writes part of the config
 * a job runs with (the reporting-metric list, the seed, the inner_valid
 * marker, the direction omission), so the jobs are made the way a user
 * makes them: load the CSV by path, pick the target, set the scenario's
 * excluded columns, and click Fit or Tune with everything else at the UI
 * default. Each completed job id is written to ``CAPTURE_MANIFEST`` for
 * ``scripts/export_lizyml_fixtures.py``.
 */

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const FIXTURES = resolve(REPO, "tests/fixtures/lizyml");

interface Scenario {
  name: string;
  target: string;
  rows: number;
  exclude: string[];
  calibration?: string;
  tuneTrials?: string;
}

// The excluded columns are the ones the lizyml 0.9.1 capture used, so the
// re-capture differs only by lizyml and the current UI.
const SCENARIOS: Scenario[] = [
  {
    name: "binary_no_cal",
    target: "Survived",
    rows: 418,
    exclude: ["PassengerId", "Name", "Sex"],
  },
  {
    name: "binary_isotonic",
    target: "Survived",
    rows: 418,
    exclude: ["PassengerId", "Name", "Sex"],
    calibration: "isotonic",
  },
  {
    name: "regression",
    target: "target",
    rows: 80,
    exclude: ["feature_x1", "feature_x2"],
  },
  {
    name: "tune",
    target: "target",
    rows: 150,
    exclude: ["feature_c"],
    tuneTrials: "10",
  },
];

function manifestPath(): string {
  const path = process.env.CAPTURE_MANIFEST;
  if (!path) throw new Error("CAPTURE_MANIFEST must name the output file");
  return path;
}

function recordJob(scenario: string, jobId: string): void {
  const path = manifestPath();
  const manifest: Record<string, string> = existsSync(path)
    ? JSON.parse(readFileSync(path, "utf-8"))
    : {};
  writeFileSync(path, `${JSON.stringify({ ...manifest, [scenario]: jobId }, null, 2)}\n`);
}

async function savedExclude(page: Page): Promise<string[]> {
  const res = await page.request.get(`${API}/workspace/config`);
  expect(res.status()).toBe(200);
  const body = (await res.json()) as { features?: { exclude?: string[] } };
  return [...(body.features?.exclude ?? [])].sort();
}

async function setExcluded(page: Page, wanted: string[]): Promise<void> {
  const current = await savedExclude(page);
  const toggle = [
    ...wanted.filter((c) => !current.includes(c)),
    ...current.filter((c) => !wanted.includes(c)),
  ];
  for (const column of toggle) {
    const row = page.locator(`[data-testid="column-row-${column}"]`);
    await expect(row).toBeVisible({ timeout: 15_000 });
    await row.getByRole("checkbox").click();
  }
  await expect
    .poll(() => savedExclude(page), {
      timeout: 15_000,
      message: "the excluded columns never reached the saved config",
    })
    .toEqual([...wanted].sort());
}

async function enableCalibration(page: Page, method: string): Promise<void> {
  await page.getByRole("switch", { name: "Calibration" }).click();
  await page.getByRole("button", { name: /Calibration/i }).click();
  await page.getByRole("combobox", { name: "Calibration method" }).click();
  await page.getByRole("option", { name: method, exact: true }).click();
  await expect
    .poll(
      async () => {
        const res = await page.request.get(`${API}/workspace/config`);
        const body = (await res.json()) as { calibration?: { method?: string } };
        return body.calibration?.method ?? null;
      },
      { timeout: 15_000, message: "calibration never reached the saved config" },
    )
    .toBe(method);
}

async function runAndWait(page: Page, kind: "fit" | "tune"): Promise<string> {
  const label = kind === "fit" ? "Fit" : "Tune";
  const button = page.getByRole("button", { name: label, exact: true });
  await expect(button).toBeEnabled({ timeout: 15_000 });
  const started = page.waitForResponse(
    (res) =>
      res.url().endsWith(`/api/workspace/${kind}`) &&
      res.request().method() === "POST",
    { timeout: 30_000 },
  );
  await button.click();
  const response = await started;
  expect(response.status(), await response.text()).toBe(200);
  const jobId = ((await response.json()) as { job_id: string }).job_id;
  const terminal = await pollJobUntilTerminal(page.request, jobId, {
    timeoutMs: 240_000,
  });
  expect(terminal.status, JSON.stringify(terminal.error ?? null)).toBe("completed");
  return jobId;
}

for (const scenario of SCENARIOS) {
  test(`capture ${scenario.name}`, async ({ page }, testInfo) => {
    const reset = await page.request.post(`${API}/workspace/reset`);
    expect(reset.status()).toBe(200);
    // The backend reads paths under LIZYSTUDIO_FILES_ROOT=/tmp.
    const csvPath = `/tmp/fixture_capture_${scenario.name}.csv`;
    copyFileSync(resolve(FIXTURES, scenario.name, "data.csv"), csvPath);

    await seedUiWorkspace(page, testInfo, {
      csvPath,
      target: scenario.target,
      expectedRows: scenario.rows,
    });
    await setExcluded(page, scenario.exclude);
    if (scenario.calibration) {
      await enableCalibration(page, scenario.calibration);
    }

    let jobId: string;
    if (scenario.tuneTrials) {
      await page.getByRole("tab", { name: "Tune" }).click();
      const form = page.getByTestId("config-form-area");
      const settings = form.getByRole("button", { name: "Settings", exact: true });
      if ((await settings.getAttribute("aria-expanded")) !== "true") {
        await settings.click();
      }
      await form.getByRole("button", { name: scenario.tuneTrials, exact: true }).click();
      jobId = await runAndWait(page, "tune");
      const job = await page.request.get(`${API}/jobs/${jobId}`);
      const config = ((await job.json()) as {
        config: { tuning?: { optuna?: { params?: { n_trials?: number } } } };
      }).config;
      expect(config.tuning?.optuna?.params?.n_trials).toBe(Number(scenario.tuneTrials));
    } else {
      jobId = await runAndWait(page, "fit");
    }
    recordJob(scenario.name, jobId);
  });
}
