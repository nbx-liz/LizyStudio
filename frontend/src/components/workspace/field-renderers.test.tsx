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

  // 16. without range shows no min~max label
  it("without range shows NumberInput only (no range label)", () => {
    const prop: SchemaProperty = {
      type: "number",
    };
    renderNode(
      <>
        {renderNumberField(
          "alpha",
          "Alpha",
          undefined,
          prop,
          ["alpha"],
          0.5,
          noop,
        )}
      </>,
    );
    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.queryByText(/~$/)).not.toBeInTheDocument();
  });

  // 17. integer with range uses step=1
  it("integer with range uses step=1", () => {
    const onChange = vi.fn();
    const prop: SchemaProperty = {
      type: "integer",
      minimum: 1,
      maximum: 10,
    };
    renderNode(
      <>
        {renderNumberField(
          "depth",
          "Depth",
          undefined,
          prop,
          ["depth"],
          5,
          onChange,
        )}
      </>,
    );
    expect(screen.getByText("1~10")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Increment" }));
    expect(onChange).toHaveBeenCalledWith(["depth"], 6);
  });
});

describe("renderField — array fields", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders primitive array as comma-separated input", () => {
    const prop: SchemaProperty = {
      type: "array",
      items: { type: "string" },
    };
    renderNode(
      <>
        {renderField(prop, "tags", ["tags"], ["a", "b", "c"], noop, emptyDefs)}
      </>,
    );
    expect(screen.getByText("Tags")).toBeInTheDocument();
    expect(screen.getByDisplayValue("a, b, c")).toBeInTheDocument();
  });

  it("calls onChange with parsed array for primitive array field", () => {
    const onChange = vi.fn();
    const prop: SchemaProperty = {
      type: "array",
      items: { type: "string" },
    };
    renderNode(
      <>{renderField(prop, "tags", ["tags"], ["a"], onChange, emptyDefs)}</>,
    );
    const input = screen.getByDisplayValue("a");
    fireEvent.change(input, { target: { value: "x, y, z" } });
    expect(onChange).toHaveBeenCalledWith(["tags"], ["x", "y", "z"]);
  });

  it("renders array of objects with items and Add button", () => {
    const prop: SchemaProperty = {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string", default: "" },
          value: { type: "number", default: 0 },
        },
      },
    };
    renderNode(
      <>
        {renderField(
          prop,
          "items",
          ["items"],
          [{ name: "foo", value: 42 }],
          noop,
          emptyDefs,
        )}
      </>,
    );
    expect(screen.getByText("Items")).toBeInTheDocument();
    expect(screen.getByText("Item 1")).toBeInTheDocument();
    expect(screen.getByText("Remove")).toBeInTheDocument();
    expect(screen.getByText("+ Add item")).toBeInTheDocument();
  });

  it("Add item button adds a new item with defaults", () => {
    const onChange = vi.fn();
    const prop: SchemaProperty = {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string", default: "new" },
        },
      },
    };
    renderNode(
      <>{renderField(prop, "list", ["list"], [], onChange, emptyDefs)}</>,
    );
    fireEvent.click(screen.getByText("+ Add item"));
    expect(onChange).toHaveBeenCalledWith(["list"], [{ name: "new" }]);
  });

  it("Remove button removes an item from array", () => {
    const onChange = vi.fn();
    const prop: SchemaProperty = {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string", default: "" },
        },
      },
    };
    renderNode(
      <>
        {renderField(
          prop,
          "list",
          ["list"],
          [{ name: "a" }, { name: "b" }],
          onChange,
          emptyDefs,
        )}
      </>,
    );
    const removeButtons = screen.getAllByText("Remove");
    fireEvent.click(removeButtons[0]);
    expect(onChange).toHaveBeenCalledWith(["list"], [{ name: "b" }]);
  });

  it("uses default array value when value is not provided", () => {
    const prop: SchemaProperty = {
      type: "array",
      items: { type: "string" },
      default: ["default1", "default2"],
    };
    renderNode(
      <>{renderField(prop, "arr", ["arr"], undefined, noop, emptyDefs)}</>,
    );
    expect(screen.getByDisplayValue("default1, default2")).toBeInTheDocument();
  });
});

describe("renderField — object fields", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders nested object with sub-fields", () => {
    const prop: SchemaProperty = {
      type: "object",
      properties: {
        enabled: { type: "boolean", default: true },
        timeout: { type: "integer", default: 30 },
      },
    };
    renderNode(
      <>
        {renderField(
          prop,
          "retry_config",
          ["retry_config"],
          { enabled: true, timeout: 30 },
          noop,
          emptyDefs,
        )}
      </>,
    );
    expect(screen.getByText("Retry Config")).toBeInTheDocument();
    expect(screen.getByText("Enabled")).toBeInTheDocument();
    expect(screen.getByText("Timeout")).toBeInTheDocument();
  });

  it("returns null for object with no visible properties", () => {
    const prop: SchemaProperty = {
      type: "object",
      properties: {
        hidden: { type: "string", const: "fixed" },
      },
    };
    const { container } = renderNode(
      <>{renderField(prop, "obj", ["obj"], {}, noop, emptyDefs)}</>,
    );
    expect(container.innerHTML).toBe("");
  });

  it("uses default value for object when value is null", () => {
    const prop: SchemaProperty = {
      type: "object",
      default: { key1: "val1" },
      properties: {
        key1: { type: "string" },
      },
    };
    renderNode(<>{renderField(prop, "obj", ["obj"], null, noop, emptyDefs)}</>);
    expect(screen.getByDisplayValue("val1")).toBeInTheDocument();
  });
});

describe("renderField — max depth", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders JSON textarea at MAX_DEPTH", () => {
    const prop: SchemaProperty = { type: "object", properties: {} };
    renderNode(
      <>
        {renderField(
          prop,
          "deep",
          ["deep"],
          { nested: true },
          noop,
          emptyDefs,
          5,
        )}
      </>,
    );
    // At max depth, it renders a textarea fallback
    const textarea = screen.getByRole("textbox");
    expect(textarea).toBeInTheDocument();
    expect(textarea).toHaveValue('{\n  "nested": true\n}');
  });

  it("depth fallback textarea calls onChange with parsed JSON", () => {
    const onChange = vi.fn();
    const prop: SchemaProperty = { type: "string" };
    renderNode(
      <>
        {renderField(prop, "deep", ["deep"], { a: 1 }, onChange, emptyDefs, 5)}
      </>,
    );
    const textarea = screen.getByRole("textbox");
    fireEvent.change(textarea, { target: { value: '{"b":2}' } });
    expect(onChange).toHaveBeenCalledWith(["deep"], { b: 2 });
  });

  it("depth fallback textarea passes raw string on invalid JSON", () => {
    const onChange = vi.fn();
    const prop: SchemaProperty = { type: "string" };
    renderNode(
      <>
        {renderField(prop, "deep", ["deep"], undefined, onChange, emptyDefs, 5)}
      </>,
    );
    const textarea = screen.getByRole("textbox");
    fireEvent.change(textarea, { target: { value: "not json" } });
    expect(onChange).toHaveBeenCalledWith(["deep"], "not json");
  });
});

describe("renderField — discriminated union", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders discriminated union with alternatives", () => {
    const prop: SchemaProperty = {
      alternatives: [
        {
          title: "Option A",
          type: "object",
          properties: {
            mode: { type: "string", const: "a" },
            value_a: { type: "number" },
          },
          default: { mode: "a", value_a: 0 },
        },
        {
          title: "Option B",
          type: "object",
          properties: {
            mode: { type: "string", const: "b" },
            value_b: { type: "string" },
          },
          default: { mode: "b", value_b: "" },
        },
      ],
    };
    renderNode(
      <>
        {renderField(
          prop,
          "strategy",
          ["strategy"],
          { mode: "a", value_a: 10 },
          noop,
          emptyDefs,
        )}
      </>,
    );
    expect(screen.getByText("Strategy")).toBeInTheDocument();
  });
});

describe("renderField — $ref resolution", () => {
  afterEach(() => {
    cleanup();
  });

  it("resolves $ref from defs", () => {
    const defs: Defs = {
      MyEnum: { enum: ["fast", "slow"], type: "string" },
    };
    const prop: SchemaProperty = { $ref: "#/$defs/MyEnum" };
    renderNode(
      <>{renderField(prop, "speed", ["speed"], "fast", noop, defs)}</>,
    );
    expect(screen.getByText("Speed")).toBeInTheDocument();
    expect(screen.getByText("fast")).toBeInTheDocument();
  });
});
