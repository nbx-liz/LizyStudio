import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ConfigForm } from "./ConfigForm";

// Mock DynParam which needs TooltipProvider
vi.mock("./DynParam", () => ({
  DynParam: () => <div data-testid="dyn-param" />,
}));

function renderConfigForm(props: Parameters<typeof ConfigForm>[0]) {
  return render(
    <TooltipProvider>
      <ConfigForm {...props} />
    </TooltipProvider>,
  );
}

const minimalSchema = {
  properties: {
    model: {
      type: "object",
      title: "Model",
      properties: {
        name: { type: "string", const: "lgbm" },
        params: { type: "object", additionalProperties: true },
      },
    },
  },
  $defs: {},
};

const minimalConfig = {
  model: { name: "lgbm", params: {} },
};

const multiSectionSchema = {
  properties: {
    model: {
      type: "object",
      title: "Model",
      properties: {
        name: { type: "string", const: "lgbm" },
        params: { type: "object", additionalProperties: true },
      },
    },
    training: {
      type: "object",
      title: "Training",
      properties: {
        n_iterations: { type: "integer", title: "Iterations", default: 100 },
      },
    },
    config_version: { type: "string", title: "Config Version" },
    tuning: {
      type: "object",
      title: "Tuning",
      properties: { optuna: { type: "object" } },
    },
    data: {
      type: "object",
      title: "Data",
      properties: { path: { type: "string" } },
    },
    features: { type: "object", title: "Features", properties: {} },
    split: { type: "object", title: "Split", properties: {} },
    task: { type: "string", title: "Task" },
    output_dir: { type: "string", title: "Output Dir" },
  },
  $defs: {},
};

const multiSectionConfig = {
  model: { name: "lgbm", params: {} },
  training: { n_iterations: 100 },
  config_version: "1.0",
  tuning: { optuna: {} },
  data: { path: "/data" },
  features: {},
  split: {},
  task: "binary",
  output_dir: "/output",
};

describe("ConfigForm", () => {
  afterEach(() => {
    cleanup();
  });

  it("returns null when schema has no properties", () => {
    const { container } = renderConfigForm({
      schema: { $defs: {} },
      config: {},
      onChange: vi.fn(),
    });
    // ConfigForm returns null when no rawProperties → TooltipProvider wraps empty
    expect(container.textContent).toBe("");
  });

  it("renders accordion sections for object properties", () => {
    renderConfigForm({
      schema: minimalSchema,
      config: minimalConfig,
      onChange: vi.fn(),
    });
    expect(screen.getByText("Model")).toBeInTheDocument();
  });

  it("hidden fields (config_version, tuning) are not shown", () => {
    renderConfigForm({
      schema: multiSectionSchema,
      config: multiSectionConfig,
      onChange: vi.fn(),
    });
    expect(screen.queryByText("Config Version")).toBeNull();
    expect(screen.queryByText("Tuning")).toBeNull();
  });

  it("DATA_PANEL_FIELDS are not shown", () => {
    renderConfigForm({
      schema: multiSectionSchema,
      config: multiSectionConfig,
      onChange: vi.fn(),
    });
    expect(screen.queryByText("Output Dir")).toBeNull();
  });

  it("renders Evaluation section when task is provided", () => {
    renderConfigForm({
      schema: minimalSchema,
      config: minimalConfig,
      onChange: vi.fn(),
      task: "binary",
    });
    expect(screen.getByText("Evaluation")).toBeInTheDocument();
  });

  it("does not render Evaluation section when task is null", () => {
    renderConfigForm({
      schema: minimalSchema,
      config: minimalConfig,
      onChange: vi.fn(),
      task: null,
    });
    expect(screen.queryByText("Evaluation")).toBeNull();
  });

  it("renders Training section heading", () => {
    renderConfigForm({
      schema: multiSectionSchema,
      config: multiSectionConfig,
      onChange: vi.fn(),
    });
    expect(screen.getByText("Training")).toBeInTheDocument();
  });
});
