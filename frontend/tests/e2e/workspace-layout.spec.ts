import { expect, test } from "@playwright/test";
import { isMobileProject } from "./helpers/mobile";
import { dismissOnboarding } from "./helpers/onboarding";

test.describe("Workspace layout", () => {
  test.beforeEach(async ({ page }, testInfo) => {
    // Issue #178: the 3-panel ResizablePanelGroup is desktop/tablet
    // only. Mobile uses a bottom-tab navigation and the assertions
    // below (3 simultaneously-visible panels, ResizablePanel slot)
    // never hold there.
    test.skip(
      isMobileProject(testInfo),
      "3-panel layout is desktop/tablet only (Issue #178)",
    );
    await dismissOnboarding(page);
  });

  test("3-panel layout renders correctly", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    await expect(page).toHaveScreenshot("workspace-layout.png");

    // Verify sidebar and main content exist
    await expect(page.getByText("LizyStudio").first()).toBeVisible();
    await expect(page.getByRole("link", { name: "Workspace" })).toBeVisible();

    // Verify Fit/Tune tabs are visible (Model panel)
    await expect(page.getByRole("tab", { name: "Fit" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Tune" })).toBeVisible();

    // Verify Results panel placeholder
    await expect(
      page.getByRole("heading", { name: "Results" }),
    ).toBeVisible();
  });

  test("Model panel shows config form accordion sections", async ({
    page,
  }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Wait for schema to load
    await page.waitForTimeout(1000);

    await expect(page).toHaveScreenshot("workspace-model-panel.png");

    // Check that config form sections are rendered as accordions (not flat inputs)
    // After $ref resolution, "model", "training" should appear as expandable sections
    const accordionTriggers = page.locator("[data-state]").filter({
      has: page.locator("button"),
    });
    const triggerCount = await accordionTriggers.count();

    // We expect at least model + training sections
    // (take a screenshot regardless for debugging)
    console.log(`Found ${triggerCount} accordion sections`);
  });

  test("Data panel has sufficient width", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Look for Data Source section text
    const dataSource = page.getByText("Data Source");
    await expect(dataSource).toBeVisible();

    // Measure panel widths at different points in time
    const t0 = await page.evaluate(() => {
      const panels = document.querySelectorAll(
        '[data-slot="resizable-panel"]',
      );
      return Array.from(panels).map((p) => ({
        id: p.id,
        flex: (p as HTMLElement).style.flex,
        width: p.getBoundingClientRect().width,
      }));
    });
    console.log("T=0 (immediate):", JSON.stringify(t0));

    await page.waitForTimeout(2000);

    const t1 = await page.evaluate(() => {
      const panels = document.querySelectorAll(
        '[data-slot="resizable-panel"]',
      );
      return Array.from(panels).map((p) => ({
        id: p.id,
        flex: (p as HTMLElement).style.flex,
        width: p.getBoundingClientRect().width,
      }));
    });
    console.log("T=2s (after delay):", JSON.stringify(t1));

    await expect(page).toHaveScreenshot("workspace-data-panel.png");
  });
});
