import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { renderWithQuery } from "@/test/helpers";
import { ConfigDiffBadge } from "./ConfigDiffBadge";

describe("ConfigDiffBadge", () => {
  const baseConfig = {
    data: { target: "price" },
    features: {
      exclude: ["id", "date"],
      categorical: ["color"],
    },
  };

  it("renders nothing when configs are identical", () => {
    const jobConfig = {
      data: { target: "price" },
      features: { exclude: ["id", "date"], categorical: ["color"] },
    };
    const currentConfig = {
      data: { target: "price" },
      features: { exclude: ["id", "date"], categorical: ["color"] },
    };
    const { container } = renderWithQuery(
      <ConfigDiffBadge jobConfig={jobConfig} currentConfig={currentConfig} />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("renders nothing when currentConfig is undefined", () => {
    const { container } = renderWithQuery(
      <ConfigDiffBadge jobConfig={baseConfig} currentConfig={undefined} />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("renders badge when exclude lists differ", () => {
    const currentConfig = {
      ...baseConfig,
      features: { ...baseConfig.features, exclude: ["id"] },
    };
    renderWithQuery(
      <ConfigDiffBadge jobConfig={baseConfig} currentConfig={currentConfig} />,
    );
    expect(screen.getByText("Settings changed")).toBeInTheDocument();
  });

  it("renders badge when categorical lists differ", () => {
    const currentConfig = {
      ...baseConfig,
      features: {
        ...baseConfig.features,
        categorical: ["color", "size"],
      },
    };
    renderWithQuery(
      <ConfigDiffBadge jobConfig={baseConfig} currentConfig={currentConfig} />,
    );
    expect(screen.getByText("Settings changed")).toBeInTheDocument();
  });

  it("renders badge when target differs", () => {
    const currentConfig = {
      ...baseConfig,
      data: { target: "quantity" },
    };
    renderWithQuery(
      <ConfigDiffBadge jobConfig={baseConfig} currentConfig={currentConfig} />,
    );
    expect(screen.getByText("Settings changed")).toBeInTheDocument();
  });

  it("shows diff details on click", async () => {
    const user = userEvent.setup();
    const currentConfig = {
      data: { target: "quantity" },
      features: {
        exclude: ["id"],
        categorical: ["color", "size"],
      },
    };
    renderWithQuery(
      <ConfigDiffBadge jobConfig={baseConfig} currentConfig={currentConfig} />,
    );
    await user.click(screen.getByText("Settings changed"));
    expect(screen.getByText(/Target/)).toBeInTheDocument();
    expect(screen.getByText(/Excluded/)).toBeInTheDocument();
    expect(screen.getByText(/Categorical/)).toBeInTheDocument();
  });

  it("treats missing features as empty arrays", () => {
    const jobConfig = { data: { target: "price" } };
    const currentConfig = {
      data: { target: "price" },
      features: { exclude: ["id"], categorical: [] },
    };
    renderWithQuery(
      <ConfigDiffBadge jobConfig={jobConfig} currentConfig={currentConfig} />,
    );
    expect(screen.getByText("Settings changed")).toBeInTheDocument();
  });

  it("ignores order differences in exclude/categorical arrays", () => {
    const jobConfig = {
      ...baseConfig,
      features: { exclude: ["date", "id"], categorical: ["color"] },
    };
    const currentConfig = {
      ...baseConfig,
      features: { exclude: ["id", "date"], categorical: ["color"] },
    };
    const { container } = renderWithQuery(
      <ConfigDiffBadge jobConfig={jobConfig} currentConfig={currentConfig} />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("has accessible role=button on the badge trigger", () => {
    const currentConfig = {
      ...baseConfig,
      data: { target: "quantity" },
    };
    renderWithQuery(
      <ConfigDiffBadge jobConfig={baseConfig} currentConfig={currentConfig} />,
    );
    expect(screen.getByRole("button")).toBeInTheDocument();
  });
});
