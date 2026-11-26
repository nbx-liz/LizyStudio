import { toast } from "sonner";
import {
  getErrorMessage,
  getValidationErrors,
  summarizeValidationErrors,
} from "@/api/errors";
import type { WriteResult } from "./useConfigWriteFunnel";

/**
 * Show a failed config-write funnel result to the user (P-0110).
 *
 * For writers that have no failure path of their own (target select,
 * ConfigForm auto-reset). Since P-0110 a refused write is a failed
 * `WriteResult` (422 / 409), so dropping the result would hide it.
 *
 * - `ok` or `aborted` (the caller tore down): nothing.
 * - `locked` (409 WORKSPACE_LOCKED): the quiet info toast the other
 *   writers use; the disabled controls already explain the lock.
 * - anything else: one error toast naming the first blocking entry when
 *   the body is a 422 validation problem.
 *
 * The funnel does not call `onWriteCommitted` for a failed write, so the
 * config cache still holds the last saved config and needs no re-fetch.
 *
 * One toast per refused PUT: the funnel coalesces same-reason ops (e.g.
 * ConfigForm's objective and metric resets) into one PUT and resolves
 * every coalesced caller with that PUT's single `WriteResult` object, so
 * a result already shown is skipped.
 */
const surfaced = new WeakSet<WriteResult>();

export function surfaceWriteFailure(result: WriteResult): void {
  if (result.ok || result.error === "aborted") return;
  if (surfaced.has(result)) return;
  surfaced.add(result);
  if (result.error === "locked") {
    toast.info("Config is locked while a job is running");
    return;
  }
  const validationErrors = getValidationErrors(result.details);
  const reason =
    validationErrors !== null
      ? summarizeValidationErrors(validationErrors)
      : getErrorMessage(result.details ?? result.error);
  toast.error(`Config not saved: ${reason}`);
}
