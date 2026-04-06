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
});
