import { ApiError } from "./client";
import type { components } from "./generated/schema";
import type { ConfigError, ValidationEntry } from "./types";

/**
 * Legacy backend StudioError JSON envelope. The jobs / inference / files
 * routers still answer with it; the workspace router moved to RFC 9457
 * Problem Details in P-0110.
 */
export interface StudioErrorBody {
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}

/**
 * RFC 9457 Problem Details body of `/api/workspace/**` (P-0110), served as
 * `application/problem+json`. Generated from the backend `ProblemDetails`
 * model, so a backend rename breaks this type at compile time.
 */
export type ProblemDetailsBody = components["schemas"]["ProblemDetails"];

/** Runtime type guard for the legacy StudioError envelope. */
export function isStudioError(body: unknown): body is StudioErrorBody {
  if (typeof body !== "object" || body === null) return false;
  const obj = body as Record<string, unknown>;
  if (typeof obj.error !== "object" || obj.error === null) return false;
  const err = obj.error as Record<string, unknown>;
  return typeof err.code === "string" && typeof err.message === "string";
}

/** Runtime type guard for an RFC 9457 Problem Details body (P-0110). */
export function isProblemDetails(body: unknown): body is ProblemDetailsBody {
  if (typeof body !== "object" || body === null) return false;
  const obj = body as Record<string, unknown>;
  return (
    typeof obj.type === "string" &&
    typeof obj.title === "string" &&
    typeof obj.status === "number" &&
    typeof obj.code === "string" &&
    typeof obj.detail === "string"
  );
}

/**
 * The LizyStudio error code (`WORKSPACE_LOCKED`, `VALIDATION_ERROR`, ...)
 * of an API failure, from either envelope. `null` when `err` is not an
 * `ApiError` or its body is neither envelope.
 */
export function getErrorCode(err: unknown): string | null {
  if (!(err instanceof ApiError)) return null;
  if (isProblemDetails(err.body)) return err.body.code;
  if (isStudioError(err.body)) return err.body.error.code;
  return null;
}

/** True for the 409 `WORKSPACE_LOCKED` refusal of a config write (P-0089). */
export function isWorkspaceLocked(err: unknown): boolean {
  return (
    err instanceof ApiError &&
    err.status === 409 &&
    getErrorCode(err) === "WORKSPACE_LOCKED"
  );
}

/**
 * The `validation_errors` of a 422 `VALIDATION_ERROR` Problem Details body
 * (P-0110), or `null` when `err` is any other failure. A blocking config
 * write lands here: the backend did not save it, and these entries say why.
 */
export function getValidationErrors(err: unknown): ValidationEntry[] | null {
  if (!(err instanceof ApiError) || !isProblemDetails(err.body)) return null;
  if (err.body.code !== "VALIDATION_ERROR") return null;
  const entries = err.body.validation_errors;
  if (!Array.isArray(entries)) return null;
  return entries;
}

/**
 * One-line summary of a config validation rejection: the first blocking
 * entry's message, or a generic fallback when no entry carries one.
 */
export function summarizeValidationErrors(errors: ConfigError[]): string {
  const blocking = errors.find((e) => (e.severity ?? "error") === "error");
  return (
    (blocking ?? errors[0])?.message ?? "Config rejected by backend validation"
  );
}

/** Extract a user-friendly message from any caught error. */
export function getErrorMessage(err: unknown): string {
  if (err instanceof ApiError && isProblemDetails(err.body)) {
    return err.body.detail;
  }
  if (err instanceof ApiError && isStudioError(err.body)) {
    return err.body.error.message;
  }
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}
