import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DistributionBar } from "./DistributionBar";

describe("DistributionBar", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders segments for each value count", () => {
    render(
      <DistributionBar
        totalCount={100}
        valueCounts={[
          { value: "A", count: 60 },
          { value: "B", count: 40 },
        ]}
      />,
    );
    expect(screen.getByTestId("distribution-bar")).toBeInTheDocument();
    expect(screen.getByTestId("segment-A")).toBeInTheDocument();
    expect(screen.getByTestId("segment-B")).toBeInTheDocument();
  });

  it("renders nothing when valueCounts is empty", () => {
    const { container } = render(
      <DistributionBar totalCount={0} valueCounts={[]} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when totalCount is zero", () => {
    const { container } = render(
      <DistributionBar
        totalCount={0}
        valueCounts={[{ value: "A", count: 10 }]}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders __other__ segment with distinct styling", () => {
    render(
      <DistributionBar
        totalCount={100}
        valueCounts={[
          { value: "A", count: 70 },
          { value: "__other__", count: 30 },
        ]}
      />,
    );
    expect(screen.getByTestId("segment-__other__")).toBeInTheDocument();
  });

  it("applies custom height", () => {
    render(
      <DistributionBar
        totalCount={100}
        height={16}
        valueCounts={[{ value: "X", count: 100 }]}
      />,
    );
    const bar = screen.getByTestId("distribution-bar");
    expect(bar.style.height).toBe("16px");
  });

  it("sets correct segment widths proportional to counts", () => {
    render(
      <DistributionBar
        totalCount={200}
        valueCounts={[
          { value: "A", count: 100 },
          { value: "B", count: 100 },
        ]}
      />,
    );
    const segA = screen.getByTestId("segment-A");
    const segB = screen.getByTestId("segment-B");
    // Each should be 50%
    expect(segA.style.width).toBe("50%");
    expect(segB.style.width).toBe("50%");
  });

  it("has accessible role and label", () => {
    render(
      <DistributionBar
        totalCount={100}
        valueCounts={[{ value: "A", count: 100 }]}
      />,
    );
    expect(screen.getByRole("img")).toHaveAttribute(
      "aria-label",
      "Value distribution",
    );
  });
});
