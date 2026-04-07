import { ApiError } from "./client";

/** Backend StudioError JSON envelope shape. */
export interface StudioErrorBody {
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}

/** Runtime type guard for the backend StudioError envelope. */
export function isStudioError(body: unknown): body is StudioErrorBody {
  if (typeof body !== "object" || body === null) return false;
  const obj = body as Record<string, unknown>;
  if (typeof obj.error !== "object" || obj.error === null) return false;
  const err = obj.error as Record<string, unknown>;
  return typeof err.code === "string" && typeof err.message === "string";
}

/** Extract a user-friendly message from any caught error. */
export function getErrorMessage(err: unknown): string {
  if (err instanceof ApiError && isStudioError(err.body)) {
    return err.body.error.message;
  }
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}
