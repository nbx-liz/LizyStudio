import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { FormField } from "./FormField";

function renderField(props: Parameters<typeof FormField>[0]) {
  return render(
    <TooltipProvider>
      <FormField {...props} />
    </TooltipProvider>,
  );
}

describe("FormField", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders the label text", () => {
    renderField({ label: "Learning Rate", children: <input /> });
    expect(screen.getByText("Learning Rate")).toBeInTheDocument();
  });

  it("renders children inside the field", () => {
    renderField({
      label: "My Field",
      children: <input data-testid="child-input" />,
    });
    expect(screen.getByTestId("child-input")).toBeInTheDocument();
  });

  it("does not render tooltip icon when description is absent", () => {
    renderField({ label: "No Desc", children: <span>child</span> });
    // lucide Info icon is rendered as SVG — should be absent without description
    const svgIcons = document.querySelectorAll("svg");
    expect(svgIcons).toHaveLength(0);
  });

  it("renders tooltip icon when description is provided", () => {
    renderField({
      label: "With Desc",
      description: "Some help text",
      children: <span>child</span>,
    });
    // The Info icon from lucide is rendered as SVG
    const svgIcons = document.querySelectorAll("svg");
    expect(svgIcons.length).toBeGreaterThan(0);
  });

  it("tooltip content is hidden by default (not visible)", () => {
    renderField({
      label: "With Desc",
      description: "Hidden tooltip text",
      children: <span>child</span>,
    });
    // Tooltip content is hidden until hover; element should not be visible
    const tooltipText = screen.queryByText("Hidden tooltip text");
    // If the element is present in the DOM it should not be visible
    if (tooltipText) {
      expect(tooltipText).not.toBeVisible();
    }
  });

  // Issue #90: programmatically wire <Label htmlFor> to the child input
  // so screen readers announce the label and axe stops flagging the
  // NumberInput / Input / SelectTrigger pattern as unlabeled.
  it("associates the label with a child input via htmlFor / id", () => {
    renderField({
      label: "Inner Valid Ratio",
      children: <input data-testid="child" />,
    });
    const input = screen.getByTestId("child");
    const id = input.getAttribute("id");
    expect(id).toBeTruthy();
    const label = screen.getByText("Inner Valid Ratio");
    expect(label.getAttribute("for")).toBe(id);
  });

  it("respects an id the caller already set on the child", () => {
    renderField({
      label: "N Trials",
      children: <input data-testid="child" id="caller-supplied-id" />,
    });
    const input = screen.getByTestId("child");
    expect(input.getAttribute("id")).toBe("caller-supplied-id");
    const label = screen.getByText("N Trials");
    expect(label.getAttribute("for")).toBe("caller-supplied-id");
  });
});
