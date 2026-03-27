import type { Page } from "@playwright/test";

/**
 * Wait for the page to reach a visually stable state.
 * Waits for network idle and CSS transitions/animations to settle.
 */
export async function waitForStableUI(page: Page): Promise<void> {
  await page.waitForLoadState("networkidle");
  // Wait for CSS transitions to complete
  await page.evaluate(() =>
    Promise.all(
      Array.from(document.querySelectorAll("*")).flatMap((el) =>
        el.getAnimations().map((a) => a.finished),
      ),
    ),
  );
}

/**
 * Wait for all Plotly charts on the page to finish rendering.
 * Checks for `.js-plotly-plot` elements and waits for `plotly_afterplot` event.
 */
export async function waitForPlotly(page: Page): Promise<void> {
  const hasPlotly = await page.locator(".js-plotly-plot").count();
  if (hasPlotly === 0) return;

  await page.evaluate(() => {
    const plots = document.querySelectorAll(".js-plotly-plot");
    return Promise.all(
      Array.from(plots).map(
        (plot) =>
          new Promise<void>((resolve) => {
            // If already rendered, resolve immediately
            if ((plot as HTMLElement & { data?: unknown[] }).data) {
              resolve();
              return;
            }
            const handler = () => {
              plot.removeEventListener("plotly_afterplot", handler);
              resolve();
            };
            plot.addEventListener("plotly_afterplot", handler);
            // Timeout fallback
            setTimeout(resolve, 5000);
          }),
      ),
    );
  });
}

/** Common screenshot assertion options. */
export const screenshotOptions = {
  animations: "disabled" as const,
};
