import { expect, test } from "@playwright/test";
import * as fs from "node:fs";
import { isMobileProject } from "./helpers/mobile";
import { pollJobUntilTerminal, seedUiWorkspace } from "./helpers/workspace-ui";

/**
 * Issue #734 regression spec — the Tune tab's Re-tune settings reach the job.
 *
 * Before the fix, ``PUT /workspace/config`` and ``POST /workspace/tune``
 * (with the Tune button's body) dropped ``tuning.re_tune``, so a Tune
 * started from the Tune tab always ran one round. This spec drives the
 * Tune tab's normal path: switch Re-tune on (3 rounds by default), click
 * Tune, and check the job's config and its rounds. Switching Re-tune off
 * then removes ``re_tune`` from the next job.
 */

const CSV_PATH = "/tmp/e2e_tune_retune_settings.csv";
const N_ROUNDS = 3;

function createBinaryCsv(): void {
  const rows = ["id,age,target"];
  for (let i = 0; i < 100; i += 1) {
    rows.push(`${i},${20 + (i % 50)},${i % 2}`);
  }
  fs.writeFileSync(CSV_PATH, rows.join("\n"));
}

test.describe("Tune tab Re-tune settings reach the job (Issue #734)", () => {
  test.beforeAll(() => {
    createBinaryCsv();
  });

  test.afterAll(() => {
    if (fs.existsSync(CSV_PATH)) fs.unlinkSync(CSV_PATH);
  });

  test("a Tune started after enabling Re-tune runs the configured rounds", async ({
    page,
    request,
  }, testInfo) => {
    test.setTimeout(120_000);
    if (isMobileProject(testInfo)) {
      test.skip(true, "Mobile layout collapses the Tune tab into a bottom-tab");
    }
    await request.post("/api/workspace/reset");
    await seedUiWorkspace(page, testInfo, { csvPath: CSV_PATH });

    await page.getByRole("tab", { name: "Tune", exact: true }).click();
    const tuneButton = page.getByRole("button", { name: "Tune", exact: true });
    await expect(tuneButton).toBeEnabled({ timeout: 15_000 });

    // Keep the run short: 10 trials in total.
    await page.getByRole("button", { name: "10", exact: true }).click();
    await page
      .getByRole("switch", { name: "Enable Re-tune (multi-round)" })
      .click();
    await expect
      .poll(
        async () => {
          const cfg = await (await request.get("/api/workspace/config")).json();
          return cfg.tuning?.re_tune?.n_rounds ?? null;
        },
        { timeout: 10_000 },
      )
      .toBe(N_ROUNDS);

    const tuneResponse = page.waitForResponse(
      (res) =>
        res.url().endsWith("/api/workspace/tune") &&
        res.request().method() === "POST",
      { timeout: 30_000 },
    );
    await tuneButton.click();
    const response = await tuneResponse;
    expect(response.status(), await response.text()).toBe(200);
    const { job_id: jobId } = await response.json();

    const job = await pollJobUntilTerminal(request, jobId as string);
    expect(job.status).toBe("completed");
    const config = job.config as { tuning: { re_tune?: { n_rounds: number } } };
    expect(config.tuning.re_tune?.n_rounds).toBe(N_ROUNDS);
    const rounds = (job.tune_result as { rounds: unknown[] | null }).rounds;
    expect(rounds).toHaveLength(N_ROUNDS);

    // Switching Re-tune off clears it from the stored config. The form is
    // locked while the job runs; wait until the UI saw it finish.
    await expect(tuneButton).toBeEnabled({ timeout: 30_000 });
    await page
      .getByRole("switch", { name: "Enable Re-tune (multi-round)" })
      .click();
    await expect
      .poll(
        async () => {
          const cfg = await (await request.get("/api/workspace/config")).json();
          return cfg.tuning?.re_tune ?? null;
        },
        { timeout: 10_000 },
      )
      .toBeNull();
  });
});
