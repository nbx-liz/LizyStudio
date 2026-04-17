import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FormRow } from "./FormRow";

describe("FormRow", () => {
  it("renders the label text", () => {
    render(<FormRow label="Learning Rate">child</FormRow>);
    expect(screen.getByText("Learning Rate")).toBeInTheDocument();
  });

  it("renders children", () => {
    render(
      <FormRow label="Epochs">
        <input data-testid="ctrl" />
      </FormRow>,
    );
    expect(screen.getByTestId("ctrl")).toBeInTheDocument();
  });

  it("uses label as title attribute by default", () => {
    render(<FormRow label="Max Depth">child</FormRow>);
    const span = screen.getByTitle("Max Depth");
    expect(span).toBeInTheDocument();
  });

  it("uses description as title attribute when provided", () => {
    render(
      <FormRow label="LR" description="Learning rate for the optimizer">
        child
      </FormRow>,
    );
    expect(
      screen.getByTitle("Learning rate for the optimizer"),
    ).toBeInTheDocument();
  });

  it("label span has overflow ellipsis style for long labels", () => {
    render(
      <FormRow label="A very long label that should be truncated">
        child
      </FormRow>,
    );
    const span = screen.getByText("A very long label that should be truncated");
    expect(span).toHaveStyle({
      overflow: "hidden",
      textOverflow: "ellipsis",
      whiteSpace: "nowrap",
    });
  });

  // Issue #90: associate the label with the child input so axe's
  // `label` rule passes for steppers / inputs rendered inside FormRow.
  it("associates the label with a child input via htmlFor / id", () => {
    render(
      <FormRow label="N Estimators">
        <input data-testid="child" />
      </FormRow>,
    );
    const input = screen.getByTestId("child");
    const id = input.getAttribute("id");
    expect(id).toBeTruthy();
    const label = screen.getByText("N Estimators");
    expect(label.tagName.toLowerCase()).toBe("label");
    expect(label.getAttribute("for")).toBe(id);
  });

  it("respects an id the caller already set on the child", () => {
    render(
      <FormRow label="K">
        <input data-testid="child" id="caller-id" />
      </FormRow>,
    );
    expect(screen.getByTestId("child").getAttribute("id")).toBe("caller-id");
    expect(screen.getByText("K").getAttribute("for")).toBe("caller-id");
  });
});
