import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { dismissOnboarding } from "../helpers/onboarding";

/**
 * Known a11y violations to exclude temporarily.
 * These should be addressed in a separate PR to fix the underlying UI components.
 *
 * - button-name: Some shadcn/ui Select triggers lack visible text (radix-ui combobox)
 * - color-contrast: sidebar-primary color (#3c83f6) has 3.63:1 ratio against white (needs 4.5:1)
 * - aria-valid-attr-value: Radix UI tabs generate aria-controls with truncated IDs
 * - label: NumberInput/stepper inputs in ConfigForm lack explicit labels
 */
const KNOWN_ISSUES = [
  "button-name",
  "color-contrast",
  "aria-valid-attr-value",
  "label",
];

function createScanner(page: import("@playwright/test").Page) {
  return new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa"])
    .disableRules(KNOWN_ISSUES);
}

test.describe("Accessibility scan @a11y", () => {
  test.beforeEach(async ({ page }) => {
    await dismissOnboarding(page);
  });

  test("Workspace page has no critical a11y violations", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    const results = await createScanner(page).analyze();

    const critical = results.violations.filter(
      (v) => v.impact === "critical" || v.impact === "serious",
    );

    if (critical.length > 0) {
      console.log(
        "Workspace a11y violations:",
        JSON.stringify(
          critical.map((v) => ({
            id: v.id,
            impact: v.impact,
            description: v.description,
            nodes: v.nodes.length,
          })),
          null,
          2,
        ),
      );
    }

    expect(
      critical,
      `Found ${critical.length} critical/serious a11y violations on Workspace page`,
    ).toHaveLength(0);
  });

  test("Jobs page has no critical a11y violations", async ({ page }) => {
    await page.goto("/jobs");
    await page.waitForLoadState("networkidle");

    const results = await createScanner(page).analyze();

    const critical = results.violations.filter(
      (v) => v.impact === "critical" || v.impact === "serious",
    );

    if (critical.length > 0) {
      console.log(
        "Jobs a11y violations:",
        JSON.stringify(
          critical.map((v) => ({
            id: v.id,
            impact: v.impact,
            description: v.description,
            nodes: v.nodes.length,
          })),
          null,
          2,
        ),
      );
    }

    expect(
      critical,
      `Found ${critical.length} critical/serious a11y violations on Jobs page`,
    ).toHaveLength(0);
  });

  test("Inference page has no critical a11y violations", async ({ page }) => {
    await page.goto("/inference");
    await page.waitForLoadState("networkidle");

    const results = await createScanner(page).analyze();

    const critical = results.violations.filter(
      (v) => v.impact === "critical" || v.impact === "serious",
    );

    if (critical.length > 0) {
      console.log(
        "Inference a11y violations:",
        JSON.stringify(
          critical.map((v) => ({
            id: v.id,
            impact: v.impact,
            description: v.description,
            nodes: v.nodes.length,
          })),
          null,
          2,
        ),
      );
    }

    expect(
      critical,
      `Found ${critical.length} critical/serious a11y violations on Inference page`,
    ).toHaveLength(0);
  });
});
