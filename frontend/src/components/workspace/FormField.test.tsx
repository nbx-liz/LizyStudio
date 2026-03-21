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
});
