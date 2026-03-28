/**
 * Tests for ConfigForm utility functions extracted for testability.
 * Covers: resolveSchema, getNestedValue, setNestedValue
 */
import { describe, expect, it } from "vitest";
import {
  type Defs,
  getNestedValue,
  isNullableUnion,
  resolveSchema,
  type SchemaProperty,
  setNestedValue,
} from "./config-utils";

describe("setNestedValue", () => {
  it("sets a top-level key", () => {
    const obj = { a: 1, b: 2 };
    const result = setNestedValue(obj, ["a"], 10);
    expect(result).toEqual({ a: 10, b: 2 });
  });

  it("does not mutate original object", () => {
    const obj = { a: 1 };
    const result = setNestedValue(obj, ["a"], 2);
    expect(obj.a).toBe(1);
    expect(result.a).toBe(2);
  });

  it("sets a nested key", () => {
    const obj = { model: { name: "lgbm", params: { lr: 0.1 } } };
    const result = setNestedValue(obj, ["model", "params", "lr"], 0.01);
    expect(
      (
        (result.model as Record<string, unknown>).params as Record<
          string,
          unknown
        >
      ).lr,
    ).toBe(0.01);
  });

  it("creates intermediate objects if missing", () => {
    const obj = {};
    const result = setNestedValue(obj, ["a", "b", "c"], 42);
    expect(getNestedValue(result, ["a", "b", "c"])).toBe(42);
  });

  it("handles single-element path", () => {
    const result = setNestedValue({}, ["key"], "value");
    expect(result).toEqual({ key: "value" });
  });
});

describe("getNestedValue", () => {
  it("returns top-level value", () => {
    expect(getNestedValue({ a: 1 }, ["a"])).toBe(1);
  });

  it("returns nested value", () => {
    const obj = { model: { params: { lr: 0.1 } } };
    expect(getNestedValue(obj, ["model", "params", "lr"])).toBe(0.1);
  });

  it("returns undefined for missing path", () => {
    expect(getNestedValue({ a: 1 }, ["b"])).toBeUndefined();
  });

  it("returns undefined for null intermediate", () => {
    expect(getNestedValue({ a: null }, ["a", "b"])).toBeUndefined();
  });

  it("returns undefined for non-object intermediate", () => {
    expect(getNestedValue({ a: 42 }, ["a", "b"])).toBeUndefined();
  });

  it("returns the root object for empty path", () => {
    const obj = { a: 1 };
    expect(getNestedValue(obj, [])).toEqual(obj);
  });
});

// --- resolveSchema ---

describe("resolveSchema", () => {
  it("resolves a simple $ref", () => {
    const prop: SchemaProperty = { $ref: "#/$defs/MyType" };
    const defs: Defs = { MyType: { type: "string", title: "My Type" } };
    const result = resolveSchema(prop, defs);
    expect(result.type).toBe("string");
    expect(result.title).toBe("My Type");
  });

  it("preserves prop-level title over ref title", () => {
    const prop: SchemaProperty = {
      $ref: "#/$defs/MyType",
      title: "Override",
    };
    const defs: Defs = { MyType: { type: "string", title: "Original" } };
    const result = resolveSchema(prop, defs);
    expect(result.title).toBe("Override");
  });

  it("detects circular $ref and returns prop as-is", () => {
    const prop: SchemaProperty = { $ref: "#/$defs/Recursive" };
    const defs: Defs = { Recursive: { $ref: "#/$defs/Recursive" } };
    const result = resolveSchema(prop, defs);
    // The second resolution returns the inner prop unchanged (cycle guard)
    expect(result.$ref).toBe("#/$defs/Recursive");
  });

  it("resolves anyOf with null (Optional pattern)", () => {
    const prop: SchemaProperty = {
      title: "Learning Rate",
      anyOf: [{ type: "number" }, { type: "null" }],
    };
    const result = resolveSchema(prop, {});
    expect(result.type).toBe("number");
    expect(result.nullable).toBe(true);
    expect(result.title).toBe("Learning Rate");
  });

  it("resolves anyOf without null", () => {
    const prop: SchemaProperty = {
      anyOf: [{ type: "string" }],
    };
    const result = resolveSchema(prop, {});
    expect(result.type).toBe("string");
    expect(result.nullable).toBeUndefined();
  });

  it("returns prop unchanged when $ref target not found", () => {
    const prop: SchemaProperty = { $ref: "#/$defs/Missing" };
    const result = resolveSchema(prop, {});
    expect(result.$ref).toBe("#/$defs/Missing");
  });

  it("handles plain property without $ref or anyOf", () => {
    const prop: SchemaProperty = {
      type: "integer",
      title: "Max Depth",
      default: -1,
    };
    const result = resolveSchema(prop, {});
    expect(result).toEqual(prop);
  });

  it("resolves anyOf with multiple non-null types and exposes alternatives", () => {
    const typeA: SchemaProperty = {
      type: "object",
      title: "TypeA",
      properties: { x: { type: "number" } },
    };
    const typeB: SchemaProperty = {
      type: "object",
      title: "TypeB",
      properties: { y: { type: "string" } },
    };
    const prop: SchemaProperty = {
      title: "MyUnion",
      anyOf: [typeA, typeB],
    };
    const result = resolveSchema(prop, {});
    // Should expose alternatives so UI can render a type selector
    expect(result.alternatives).toBeDefined();
    expect(result.alternatives).toHaveLength(2);
    expect(result.alternatives?.[0].title).toBe("TypeA");
    expect(result.alternatives?.[1].title).toBe("TypeB");
    // Title should be preserved
    expect(result.title).toBe("MyUnion");
  });

  it("resolves anyOf with null + multiple non-null types and sets nullable + alternatives", () => {
    const typeA: SchemaProperty = { type: "object", title: "A" };
    const typeB: SchemaProperty = { type: "object", title: "B" };
    const prop: SchemaProperty = {
      title: "NullableUnion",
      anyOf: [typeA, { type: "null" }, typeB],
    };
    const result = resolveSchema(prop, {});
    expect(result.nullable).toBe(true);
    expect(result.alternatives).toHaveLength(2);
    expect(result.title).toBe("NullableUnion");
  });

  it("resolves anyOf with multiple non-null types and picks matching alternative by currentValue shape", () => {
    const typeA: SchemaProperty = {
      type: "object",
      title: "TypeA",
      properties: { kind: { const: "a" }, x: { type: "number" } },
    };
    const typeB: SchemaProperty = {
      type: "object",
      title: "TypeB",
      properties: { kind: { const: "b" }, y: { type: "string" } },
    };
    const prop: SchemaProperty = { anyOf: [typeA, typeB] };
    // When current value has kind="b", should resolve to TypeB as primary
    const result = resolveSchema(prop, {}, { kind: "b", y: "hello" });
    expect(result.properties?.y).toBeDefined();
  });

  it("resolves oneOf with discriminator matching currentValue", () => {
    const variantA: SchemaProperty = {
      type: "object",
      properties: {
        strategy: { const: "kfold" },
        n_splits: { type: "integer" },
      },
    };
    const variantB: SchemaProperty = {
      type: "object",
      properties: {
        strategy: { const: "timeseries" },
        gap: { type: "integer" },
      },
    };
    const prop: SchemaProperty = {
      title: "CV Strategy",
      oneOf: [variantA, variantB],
      discriminator: { propertyName: "strategy" },
    };
    const result = resolveSchema(prop, {}, { strategy: "timeseries", gap: 5 });
    expect(result.title).toBe("CV Strategy");
    expect(result.properties?.gap).toBeDefined();
    expect(result.properties?.strategy?.const).toBe("timeseries");
  });

  it("resolves oneOf with discriminator fallback to first variant when no match", () => {
    const variantA: SchemaProperty = {
      type: "object",
      properties: { strategy: { const: "kfold" } },
    };
    const variantB: SchemaProperty = {
      type: "object",
      properties: { strategy: { const: "timeseries" } },
    };
    const prop: SchemaProperty = {
      title: "CV Strategy",
      oneOf: [variantA, variantB],
      discriminator: { propertyName: "strategy" },
    };
    // currentValue has unknown strategy
    const result = resolveSchema(prop, {}, { strategy: "unknown" });
    expect(result.title).toBe("CV Strategy");
    expect(result.properties?.strategy?.const).toBe("kfold");
  });

  it("resolves oneOf with discriminator and null currentValue falls back to first variant", () => {
    const variantA: SchemaProperty = {
      type: "object",
      properties: { mode: { const: "auto" } },
    };
    const prop: SchemaProperty = {
      oneOf: [variantA],
      discriminator: { propertyName: "mode" },
    };
    const result = resolveSchema(prop, {}, null);
    expect(result.properties?.mode?.const).toBe("auto");
  });

  it("resolves oneOf without discriminator using first variant", () => {
    const variantA: SchemaProperty = {
      type: "object",
      title: "OptionA",
      properties: { x: { type: "number" } },
    };
    const variantB: SchemaProperty = {
      type: "object",
      title: "OptionB",
      properties: { y: { type: "string" } },
    };
    const prop: SchemaProperty = {
      title: "MyChoice",
      default: { x: 42 },
      oneOf: [variantA, variantB],
    };
    const result = resolveSchema(prop, {});
    expect(result.title).toBe("MyChoice");
    expect(result.default).toEqual({ x: 42 });
    expect(result.properties?.x).toBeDefined();
  });
});

// --- isNullableUnion ---

describe("isNullableUnion", () => {
  it("returns true for [T, null] pattern (Optional<T>)", () => {
    const anyOf: SchemaProperty[] = [{ type: "number" }, { type: "null" }];
    expect(isNullableUnion(anyOf)).toBe(true);
  });

  it("returns true for [null, T] pattern", () => {
    const anyOf: SchemaProperty[] = [{ type: "null" }, { type: "string" }];
    expect(isNullableUnion(anyOf)).toBe(true);
  });

  it("returns false for [T1, T2] — discriminated union", () => {
    const anyOf: SchemaProperty[] = [
      { type: "object", title: "A" },
      { type: "object", title: "B" },
    ];
    expect(isNullableUnion(anyOf)).toBe(false);
  });

  it("returns false for empty array", () => {
    expect(isNullableUnion([])).toBe(false);
  });

  it("returns false for single non-null type", () => {
    expect(isNullableUnion([{ type: "string" }])).toBe(false);
  });

  it("returns true when exactly one non-null type exists alongside null", () => {
    const anyOf: SchemaProperty[] = [
      { type: "object", properties: { x: { type: "number" } } },
      { type: "null" },
    ];
    expect(isNullableUnion(anyOf)).toBe(true);
  });

  it("returns false for null + multiple non-null types", () => {
    const anyOf: SchemaProperty[] = [
      { type: "object", title: "A" },
      { type: "null" },
      { type: "object", title: "B" },
    ];
    expect(isNullableUnion(anyOf)).toBe(false);
  });
});
