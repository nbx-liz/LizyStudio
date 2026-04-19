import type { Page, TestInfo } from "@playwright/test";

// Issue #178: the mobile Workspace layout (<768px) is a bottom-tab
// navigation where Data / Model / Results live in separate tab panels
// instead of a 3-panel side-by-side view. Existing e2e tests assume the
// 3-panel layout, so mobile runs need to open the right section before
// interacting with panel content.
//
// Usage:
//
//   await openWorkspaceSectionIfMobile(page, testInfo, "model");
//   await page.getByRole("tab", { name: "Tune" }).click();
//
// On non-mobile projects this is a no-op — the Model panel is always
// visible next to Data and Results.

export type MobileSection = "data" | "model" | "results";

export function isMobileProject(testInfo: TestInfo): boolean {
  return testInfo.project.name === "chromium-mobile";
}

export async function openWorkspaceSectionIfMobile(
  page: Page,
  testInfo: TestInfo,
  section: MobileSection,
): Promise<void> {
  if (!isMobileProject(testInfo)) return;
  // Bottom tab bar lives at the workspace root; match by accessible
  // name. The `^=` anchor keeps the matcher stable if an icon with a
  // trailing badge is rendered alongside the label.
  const label = section.charAt(0).toUpperCase() + section.slice(1);
  await page.getByRole("tab", { name: label, exact: true }).click();
  // Small settle for the Radix Tabs transition to mount the panel.
  await page.waitForTimeout(200);
}
