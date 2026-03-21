/**
 * Tests for ConfigForm utility functions extracted for testability.
 * Covers: resolveSchema, getNestedValue, setNestedValue
 */
import { describe, expect, it } from "vitest";
import {
  type Defs,
  getNestedValue,
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
});
