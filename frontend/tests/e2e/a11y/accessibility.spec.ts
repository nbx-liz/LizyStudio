import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { dismissOnboarding } from "../helpers/onboarding";

/**
 * Known a11y violations still excluded.
 *
 * All four original Issue #90 rules are now resolved:
 * - color-contrast: --sidebar-primary darkened from 60% -> 50% lightness
 * - label: FormField now wires <Label htmlFor> to its child via useId()
 * - button-name: every shadcn Select trigger has an explicit aria-label
 * - aria-valid-attr-value: TabsContent nodes added so Radix's auto
 *   aria-controls references have real DOM targets
 *
 * Keep this list empty. Any new axe violation should be fixed at the
 * source, not suppressed here.
 */
const KNOWN_ISSUES: string[] = [];

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
