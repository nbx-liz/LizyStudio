import type { Page } from "@playwright/test";

/**
 * Dismiss the onboarding dialog by setting localStorage before navigation.
 * Must be called BEFORE page.goto().
 */
export async function dismissOnboarding(page: Page): Promise<void> {
  await page.addInitScript(() => {
    localStorage.setItem("lizystudio-onboarding-completed", "true");
  });
}
