import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { Defs, SchemaProperty } from "./config-utils";
import {
  renderBooleanField,
  renderEnumField,
  renderField,
  renderNumberField,
} from "./field-renderers";

type OnChange = (path: string[], value: unknown) => void;

/** Wrap ReactNode in providers required by FormField (TooltipProvider). */
function renderNode(node: React.ReactNode) {
  return render(<TooltipProvider>{node}</TooltipProvider>);
}

const noop: OnChange = () => {};
const emptyDefs: Defs = {};

describe("renderField", () => {
  afterEach(() => {
    cleanup();
  });

  // 1. const properties
  it("returns null for const properties", () => {
    const prop: SchemaProperty = { const: "fixed_value" };
    const { container } = renderNode(
      <>{renderField(prop, "mode", ["mode"], undefined, noop, emptyDefs)}</>,
    );
    expect(container.innerHTML).toBe("");
  });

  // 2. GLOBALLY_HIDDEN names
  it('returns null for GLOBALLY_HIDDEN name "validation_ratio"', () => {
    const prop: SchemaProperty = { type: "number" };
    const { container } = renderNode(
      <>
        {renderField(
          prop,
          "validation_ratio",
          ["validation_ratio"],
          0.2,
          noop,
          emptyDefs,
        )}
      </>,
    );
    expect(container.innerHTML).toBe("");
  });

  it('returns null for GLOBALLY_HIDDEN name "inner_valid"', () => {
    const prop: SchemaProperty = { type: "boolean" };
    const { container } = renderNode(
      <>
        {renderField(
          prop,
          "inner_valid",
          ["inner_valid"],
          true,
          noop,
          emptyDefs,
        )}
      </>,
    );
    expect(container.innerHTML).toBe("");
  });

  // 3. enum renders Select with options
  it("renders enum as Select with options", () => {
    const prop: SchemaProperty = { enum: ["gini", "entropy", "log_loss"] };
    renderNode(
      <>
        {renderField(prop, "criterion", ["criterion"], "gini", noop, emptyDefs)}
      </>,
    );
    expect(screen.getByText("Criterion")).toBeInTheDocument();
    // The SelectTrigger should display the current value
    expect(screen.getByText("gini")).toBeInTheDocument();
  });

  // 4. boolean renders Switch
  it("renders boolean as Switch", () => {
    const prop: SchemaProperty = { type: "boolean", default: false };
    renderNode(
      <>
        {renderField(prop, "use_cache", ["use_cache"], true, noop, emptyDefs)}
      </>,
    );
    expect(screen.getByText("Use Cache")).toBeInTheDocument();
    const switchEl = screen.getByRole("switch");
    expect(switchEl).toBeInTheDocument();
    expect(switchEl).toBeChecked();
  });

  // 5. number renders NumberInput
  it("renders number with NumberInput", () => {
    const prop: SchemaProperty = { type: "number", default: 0.01 };
    renderNode(
      <>
        {renderField(
          prop,
          "learning_rate",
          ["learning_rate"],
          0.05,
          noop,
          emptyDefs,
        )}
      </>,
    );
    expect(screen.getByText("Learning Rate")).toBeInTheDocument();
    // NumberInput renders Increment/Decrement buttons
    expect(
      screen.getByRole("button", { name: "Increment" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Decrement" }),
    ).toBeInTheDocument();
  });

  // 6. integer renders with step=1
  it("renders integer with step=1", () => {
    const onChange = vi.fn();
    const prop: SchemaProperty = { type: "integer" };
    renderNode(
      <>
        {renderField(
          prop,
          "n_estimators",
          ["n_estimators"],
          100,
          onChange,
          emptyDefs,
        )}
      </>,
    );
    // Click increment: value should go from 100 to 101 (step=1)
    fireEvent.click(screen.getByRole("button", { name: "Increment" }));
    expect(onChange).toHaveBeenCalledWith(["n_estimators"], 101);
  });

  // 7. string fallback renders text Input
  it("renders string as text Input (fallback)", () => {
    const prop: SchemaProperty = { type: "string" };
    renderNode(
      <>
        {renderField(
          prop,
          "output_dir",
          ["output_dir"],
          "/tmp/out",
          noop,
          emptyDefs,
        )}
      </>,
    );
    expect(screen.getByText("Output Dir")).toBeInTheDocument();
    const input = screen.getByDisplayValue("/tmp/out");
    expect(input).toBeInTheDocument();
  });

  // 8. object with nested fields shows label
  it("renders object with nested fields (shows label)", () => {
    const prop: SchemaProperty = {
      type: "object",
      properties: {
        patience: { type: "integer", default: 5 },
      },
    };
    renderNode(
      <>
        {renderField(
          prop,
          "early_stopping",
          ["early_stopping"],
          { patience: 10 },
          noop,
          emptyDefs,
        )}
      </>,
    );
    expect(screen.getByText("Early Stopping")).toBeInTheDocument();
    expect(screen.getByText("Patience")).toBeInTheDocument();
  });

  // 9. free-form dict returns null
  it("skips free-form dict (type=object, no properties, has additionalProperties)", () => {
    const prop: SchemaProperty = {
      type: "object",
      additionalProperties: true,
    };
    const { container } = renderNode(
      <>
        {renderField(
          prop,
          "extra_params",
          ["extra_params"],
          {},
          noop,
          emptyDefs,
        )}
      </>,
    );
    expect(container.innerHTML).toBe("");
  });

  // 10. humanize converts snake_case
  it('humanize converts snake_case (e.g. "early_stopping" renders as "Early Stopping")', () => {
    const prop: SchemaProperty = { type: "string" };
    renderNode(
      <>
        {renderField(
          prop,
          "early_stopping",
          ["early_stopping"],
          "",
          noop,
          emptyDefs,
        )}
      </>,
    );
    expect(screen.getByText("Early Stopping")).toBeInTheDocument();
  });

  // 11. uses prop.title if not ending with "Config" or "Schema"
  it('uses prop.title if not ending with "Config" or "Schema"', () => {
    const prop: SchemaProperty = {
      type: "number",
      title: "Learning Rate (alpha)",
    };
    renderNode(<>{renderField(prop, "lr", ["lr"], 0.01, noop, emptyDefs)}</>);
    expect(screen.getByText("Learning Rate (alpha)")).toBeInTheDocument();
  });

  // 12. humanizes if title ends with "Config"
  it('humanizes name if title ends with "Config"', () => {
    const prop: SchemaProperty = {
      type: "object",
      title: "EarlyStoppingConfig",
      properties: {
        patience: { type: "integer" },
      },
    };
    renderNode(
      <>
        {renderField(
          prop,
          "early_stopping",
          ["early_stopping"],
          {},
          noop,
          emptyDefs,
        )}
      </>,
    );
    // Should use humanized name, not the Config title
    expect(screen.getByText("Early Stopping")).toBeInTheDocument();
    expect(screen.queryByText("EarlyStoppingConfig")).not.toBeInTheDocument();
  });
});

describe("renderBooleanField", () => {
  afterEach(() => {
    cleanup();
  });

  // 13. switch toggles onChange
  it("switch toggles onChange", () => {
    const onChange = vi.fn();
    renderNode(
      <>
        {renderBooleanField(
          "verbose",
          "Verbose",
          undefined,
          ["verbose"],
          false,
          false,
          onChange,
        )}
      </>,
    );
    const switchEl = screen.getByRole("switch");
    expect(switchEl).not.toBeChecked();
    fireEvent.click(switchEl);
    expect(onChange).toHaveBeenCalledWith(["verbose"], true);
  });
});

describe("renderEnumField", () => {
  afterEach(() => {
    cleanup();
  });

  // 14. selecting value calls onChange
  it("selecting value calls onChange", () => {
    const onChange = vi.fn();
    renderNode(
      <>
        {renderEnumField(
          "solver",
          "Solver",
          undefined,
          ["lbfgs", "sgd", "adam"],
          ["solver"],
          "lbfgs",
          "lbfgs",
          onChange,
        )}
      </>,
    );
    expect(screen.getByText("Solver")).toBeInTheDocument();
    // Verify trigger shows current value
    expect(screen.getByText("lbfgs")).toBeInTheDocument();
  });
});

describe("renderNumberField", () => {
  afterEach(() => {
    cleanup();
  });

  // 15. with range shows min~max label
  it("with range shows min~max label", () => {
    const prop: SchemaProperty = {
      type: "number",
      minimum: 0,
      maximum: 1,
    };
    renderNode(
      <>
        {renderNumberField(
          "threshold",
          "Threshold",
          "Decision threshold",
          prop,
          ["threshold"],
          0.5,
          noop,
        )}
      </>,
    );
    expect(screen.getByText("Threshold")).toBeInTheDocument();
    expect(screen.getByText("0~1")).toBeInTheDocument();
  });
});
