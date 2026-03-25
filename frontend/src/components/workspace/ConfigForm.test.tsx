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

  it("renders Model section with Smart Params and Additional Params labels", () => {
    renderConfigForm({
      schema: minimalSchema,
      config: minimalConfig,
      onChange: vi.fn(),
    });
    expect(screen.getByText("Smart Params")).toBeInTheDocument();
    expect(screen.getByText("Model Params")).toBeInTheDocument();
    expect(screen.getByText("Additional Params")).toBeInTheDocument();
  });

  it("renders inner_valid ratio when early_stopping is enabled", () => {
    const schema = {
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
            early_stopping: {
              type: "object",
              properties: {
                enabled: { type: "boolean", default: true },
                patience: { type: "integer", default: 10 },
              },
            },
          },
        },
      },
      $defs: {},
    };
    const config = {
      model: { name: "lgbm", params: {} },
      training: {
        early_stopping: { enabled: true, patience: 10 },
        inner_valid: { method: "holdout", ratio: 0.15 },
      },
    };

    renderConfigForm({
      schema,
      config,
      onChange: vi.fn(),
    });

    expect(screen.getByText("Inner Valid Ratio")).toBeInTheDocument();
  });

  it("does not render inner_valid ratio when early_stopping is disabled", () => {
    const schema = {
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
            early_stopping: {
              type: "object",
              properties: {
                enabled: { type: "boolean", default: false },
              },
            },
          },
        },
      },
      $defs: {},
    };
    const config = {
      model: { name: "lgbm", params: {} },
      training: {
        early_stopping: { enabled: false },
      },
    };

    renderConfigForm({
      schema,
      config,
      onChange: vi.fn(),
    });

    expect(screen.queryByText("Inner Valid Ratio")).not.toBeInTheDocument();
  });

  it("renders calibration section for binary task by default", () => {
    renderConfigForm({
      schema: minimalSchema,
      config: { ...minimalConfig, calibration: null },
      onChange: vi.fn(),
      task: "binary",
    });

    expect(screen.getByText("Calibration")).toBeInTheDocument();
  });

  it("does not render calibration section for regression task", () => {
    renderConfigForm({
      schema: minimalSchema,
      config: { ...minimalConfig, calibration: null },
      onChange: vi.fn(),
      task: "regression",
    });

    expect(screen.queryByText("Calibration")).not.toBeInTheDocument();
  });

  it("renders section title from uiSchema when provided", () => {
    renderConfigForm({
      schema: multiSectionSchema,
      config: multiSectionConfig,
      onChange: vi.fn(),
      uiSchema: {
        sections: [{ key: "training", title: "Training Settings" }],
      },
    });
    expect(screen.getByText("Training Settings")).toBeInTheDocument();
  });

  it("renders calibration section based on conditional_visibility", () => {
    renderConfigForm({
      schema: minimalSchema,
      config: { ...minimalConfig, calibration: null },
      onChange: vi.fn(),
      task: "multiclass",
      uiSchema: {
        conditional_visibility: {
          calibration: { task: ["binary", "multiclass"] },
        },
      },
    });

    expect(screen.getByText("Calibration")).toBeInTheDocument();
  });

  it("hides calibration section based on conditional_visibility when task not included", () => {
    renderConfigForm({
      schema: minimalSchema,
      config: { ...minimalConfig, calibration: null },
      onChange: vi.fn(),
      task: "regression",
      uiSchema: {
        conditional_visibility: {
          calibration: { task: ["binary", "multiclass"] },
        },
      },
    });

    expect(screen.queryByText("Calibration")).not.toBeInTheDocument();
  });

  it("renders DynParam components when parameter_hints are provided", () => {
    renderConfigForm({
      schema: minimalSchema,
      config: minimalConfig,
      onChange: vi.fn(),
      uiSchema: {
        parameter_hints: [
          { key: "objective", kind: "objective", label: "Objective" },
        ],
      },
    });

    expect(screen.getByTestId("dyn-param")).toBeInTheDocument();
  });
});
