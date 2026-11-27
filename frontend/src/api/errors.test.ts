import { describe, expect, it } from "vitest";
import {
  N_SPLITS_ERROR,
  validationProblem,
  validationProblemBody,
  workspaceLockedProblem,
} from "@/test/problemDetails";
import { ApiError } from "./client";
import {
  getErrorCode,
  getErrorMessage,
  getValidationErrors,
  isProblemDetails,
  isStudioError,
  isWorkspaceLocked,
  summarizeValidationErrors,
} from "./errors";

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

  it("extracts detail from an RFC 9457 Problem Details body (P-0110)", () => {
    expect(getErrorMessage(workspaceLockedProblem("xyz"))).toBe(
      "Config is locked while job xyz is running",
    );
  });
});

// ---------------------------------------------------------------------------
// P-0110: RFC 9457 Problem Details accessors. The workspace router answers
// with Problem Details; jobs / inference / files keep the legacy envelope,
// so every accessor reads both.
// ---------------------------------------------------------------------------
const LEGACY_LOCKED = new ApiError(409, {
  error: {
    code: "WORKSPACE_LOCKED",
    message: "Config is locked while job xyz is running",
    details: { job_id: "xyz" },
  },
});

describe("isProblemDetails", () => {
  it("accepts the real 422 body", () => {
    expect(isProblemDetails(validationProblemBody())).toBe(true);
  });

  it("rejects the legacy envelope and partial bodies", () => {
    expect(isProblemDetails(LEGACY_LOCKED.body)).toBe(false);
    expect(isProblemDetails({ detail: "unprocessable" })).toBe(false);
    expect(isProblemDetails({ type: "about:blank", title: "x" })).toBe(false);
    expect(isProblemDetails(null)).toBe(false);
  });
});

describe("getErrorCode", () => {
  it("reads the code from either envelope", () => {
    expect(getErrorCode(workspaceLockedProblem())).toBe("WORKSPACE_LOCKED");
    expect(getErrorCode(LEGACY_LOCKED)).toBe("WORKSPACE_LOCKED");
    expect(getErrorCode(validationProblem())).toBe("VALIDATION_ERROR");
  });

  it("is null for a non-ApiError or an unknown body", () => {
    expect(getErrorCode(new Error("x"))).toBeNull();
    expect(getErrorCode(new ApiError(500, null))).toBeNull();
  });
});

describe("isWorkspaceLocked", () => {
  it("is true for a 409 WORKSPACE_LOCKED in either envelope", () => {
    expect(isWorkspaceLocked(workspaceLockedProblem())).toBe(true);
    expect(isWorkspaceLocked(LEGACY_LOCKED)).toBe(true);
  });

  it("is false for another status or code", () => {
    expect(isWorkspaceLocked(validationProblem())).toBe(false);
    const wrongStatus = new ApiError(400, workspaceLockedProblem().body);
    expect(isWorkspaceLocked(wrongStatus)).toBe(false);
    expect(isWorkspaceLocked(new Error("WORKSPACE_LOCKED"))).toBe(false);
  });
});

describe("getValidationErrors", () => {
  it("returns validation_errors of a 422 VALIDATION_ERROR problem", () => {
    expect(getValidationErrors(validationProblem())).toEqual([N_SPLITS_ERROR]);
  });

  it("is null for any other failure", () => {
    expect(getValidationErrors(workspaceLockedProblem())).toBeNull();
    expect(getValidationErrors(new Error("x"))).toBeNull();
    // A legacy VALIDATION_ERROR (jobs router, request-body parse error)
    // carries no validation_errors member.
    const legacy = new ApiError(422, {
      error: { code: "VALIDATION_ERROR", message: "x", details: {} },
    });
    expect(getValidationErrors(legacy)).toBeNull();
  });
});

describe("summarizeValidationErrors", () => {
  it("names the first blocking entry, not a leading warning", () => {
    expect(
      summarizeValidationErrors([
        { path: "m", message: "a warning", severity: "warning" },
        N_SPLITS_ERROR,
      ]),
    ).toBe(N_SPLITS_ERROR.message);
  });

  it("treats a missing severity as blocking and falls back on empty", () => {
    expect(summarizeValidationErrors([{ path: "d", message: "req" }])).toBe(
      "req",
    );
    expect(summarizeValidationErrors([])).toBe(
      "Config rejected by backend validation",
    );
  });
});
