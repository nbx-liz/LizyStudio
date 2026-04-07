import { describe, expect, it } from "vitest";
import { ApiError } from "./client";
import { getErrorMessage, isStudioError } from "./errors";

describe("isStudioError", () => {
  it("returns true for valid StudioError body", () => {
    const body = {
      error: { code: "VALIDATION_ERROR", message: "bad input", details: {} },
    };
    expect(isStudioError(body)).toBe(true);
  });

  it("returns true when details is missing (optional)", () => {
    const body = { error: { code: "NOT_FOUND", message: "not found" } };
    expect(isStudioError(body)).toBe(true);
  });

  it("returns false for null", () => {
    expect(isStudioError(null)).toBe(false);
  });

  it("returns false for undefined", () => {
    expect(isStudioError(undefined)).toBe(false);
  });

  it("returns false for primitive", () => {
    expect(isStudioError("string")).toBe(false);
    expect(isStudioError(42)).toBe(false);
  });

  it("returns false for object without error key", () => {
    expect(isStudioError({ detail: "some error" })).toBe(false);
  });

  it("returns false when error.code is missing", () => {
    expect(isStudioError({ error: { message: "no code" } })).toBe(false);
  });

  it("returns false when error.message is missing", () => {
    expect(isStudioError({ error: { code: "ERR" } })).toBe(false);
  });

  it("returns false when error is not an object", () => {
    expect(isStudioError({ error: "string" })).toBe(false);
  });
});

describe("getErrorMessage", () => {
  it("extracts message from ApiError with StudioError body", () => {
    const err = new ApiError(400, {
      error: {
        code: "VALIDATION_ERROR",
        message: "Invalid config",
        details: {},
      },
    });
    expect(getErrorMessage(err)).toBe("Invalid config");
  });

  it("falls back to Error.message for ApiError with non-StudioError body", () => {
    const err = new ApiError(500, null);
    expect(getErrorMessage(err)).toBe("API error 500");
  });

  it("returns Error.message for plain Error", () => {
    const err = new Error("Something broke");
    expect(getErrorMessage(err)).toBe("Something broke");
  });

  it("converts non-Error to string", () => {
    expect(getErrorMessage("raw string")).toBe("raw string");
    expect(getErrorMessage(42)).toBe("42");
  });

  it("handles ApiError with partial body (no error key)", () => {
    const err = new ApiError(422, { detail: "unprocessable" });
    expect(getErrorMessage(err)).toBe("API error 422");
  });
});
