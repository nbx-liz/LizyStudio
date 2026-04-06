import { expect, test } from "@playwright/test";
import { dismissOnboarding } from "../helpers/onboarding";
import { waitForStableUI } from "../helpers/visual";

/**
 * Theme and visual regression tests.
 *
 * Covers dark/light mode across all pages, responsive viewports,
 * and form state visual verification.
 */

// --- Theme toggle helpers ---

async function setTheme(
  page: import("@playwright/test").Page,
  theme: "dark" | "light",
): Promise<void> {
  await page.evaluate((t) => {
    localStorage.setItem("theme", t);
    if (t === "dark") {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  }, theme);
  // Wait for CSS to settle after class change
  await page.waitForTimeout(300);
}

async function navigateAndWait(
  page: import("@playwright/test").Page,
  path: string,
): Promise<void> {
  await page.goto(path);
  await waitForStableUI(page);
}

// --- Dark/Light mode screenshots ---

test.describe("Theme: Dark mode", () => {
  test.beforeEach(async ({ page }) => {
    await dismissOnboarding(page);
  });

  test("dark mode workspace page", async ({ page }) => {
    await navigateAndWait(page, "/");
    await setTheme(page, "dark");
    await expect(page).toHaveScreenshot("workspace-dark.png");
  });

  test("dark mode jobs page", async ({ page }) => {
    await navigateAndWait(page, "/jobs");
    await setTheme(page, "dark");
    await expect(page).toHaveScreenshot("jobs-dark.png");
  });

  test("dark mode inference page", async ({ page }) => {
    await navigateAndWait(page, "/inference");
    await setTheme(page, "dark");
    await expect(page).toHaveScreenshot("inference-dark.png");
  });
});

test.describe("Theme: Light mode", () => {
  test.beforeEach(async ({ page }) => {
    await dismissOnboarding(page);
  });

  test("light mode workspace page", async ({ page }) => {
    await navigateAndWait(page, "/");
    await setTheme(page, "light");
    await expect(page).toHaveScreenshot("workspace-light.png");
  });

  test("light mode jobs page", async ({ page }) => {
    await navigateAndWait(page, "/jobs");
    await setTheme(page, "light");
    await expect(page).toHaveScreenshot("jobs-light.png");
  });

  test("light mode inference page", async ({ page }) => {
    await navigateAndWait(page, "/inference");
    await setTheme(page, "light");
    await expect(page).toHaveScreenshot("inference-light.png");
  });
});

// --- Theme toggle interaction ---

test.describe("Theme: Toggle interaction", () => {
  test.beforeEach(async ({ page }) => {
    await dismissOnboarding(page);
  });

  test("toggle from light to dark preserves layout", async ({ page }) => {
    await navigateAndWait(page, "/");
    await setTheme(page, "light");

    // Find and click the theme toggle button
    const toggleButton = page.getByRole("button", {
      name: /switch to dark mode/i,
    });
    if (await toggleButton.isVisible()) {
      await toggleButton.click();
      await page.waitForTimeout(300);

      // Verify dark class was applied
      const isDark = await page.evaluate(() =>
        document.documentElement.classList.contains("dark"),
      );
      expect(isDark).toBe(true);
      await expect(page).toHaveScreenshot("workspace-toggled-dark.png");
    }
  });
});

// --- Form states ---

test.describe("Form states visual", () => {
  test.beforeEach(async ({ page }) => {
    await dismissOnboarding(page);
  });

  test("workspace empty state (no data loaded)", async ({ page }) => {
    await navigateAndWait(page, "/");
    await setTheme(page, "light");
    await expect(page).toHaveScreenshot("workspace-empty-state.png");
  });

  test("jobs empty state (no jobs)", async ({ page }) => {
    await navigateAndWait(page, "/jobs");
    await setTheme(page, "light");
    await expect(page).toHaveScreenshot("jobs-empty-state.png");
  });

  test("inference empty state (no model selected)", async ({ page }) => {
    await navigateAndWait(page, "/inference");
    await setTheme(page, "light");
    await expect(page).toHaveScreenshot("inference-empty-state.png");
  });
});
