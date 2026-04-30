import {
  type APIRequestContext,
  type Locator,
  type Page,
  type Request,
  expect,
} from "@playwright/test";
import { API } from "./api";

/**
 * Config-reflection helper for E2E specs.
 *
 * Phase A scope (gui-e2e-plan.md): each UI control that maps to a
 * field in the LizyML Config must drive a PUT /api/workspace/config
 * with the correct wire field name and value, and the saved config
 * (next GET /config) must reflect that value.
 *
 * Each spec line in `fixtures/config-fields.ts` declares the smallest
 * unit needed to assert the four-step invariant:
 *
 *   1. baseline: GET /config -> defaultValue is observed at configPath
 *   2. drive: invoke `uiAction(uiLocator, testValue)` from the spec
 *   3. observe: the next PUT /config carries `testValue` at configPath
 *   4. confirm: GET /config returns `testValue` at configPath
 *
 * The helper does not own the UI seeding step — callers are expected
 * to drive `seedUiWorkspace(...)` (or an equivalent) before invoking
 * `assertConfigReflection`, because the precondition surface (which
 * accordion is open, which Strategy is active) is spec-specific.
 */

export interface ConfigFieldSpec<TValue> {
  /** Human-readable name shown in the test title. */
  name: string;
  /** Dotted path on the saved config (e.g. "split.n_splits"). */
  configPath: string;
  /** Value expected at `configPath` BEFORE the UI action runs. */
  defaultValue: TValue;
  /** Value to drive into the UI control. */
  testValue: TValue;
  /** Locator factory resolved against the page once preconditions hold. */
  uiLocator: (page: Page) => Locator;
  /** Action that writes `testValue` into the UI control. */
  uiAction: (locator: Locator, value: TValue) => Promise<void>;
}

/**
 * Read the current saved config and pluck the value at `configPath`.
 * Throws if the GET fails, since callers always expect a 200 here.
 */
export async function readSavedConfig(
  request: APIRequestContext,
): Promise<Record<string, unknown>> {
  const res = await request.get(`${API}/workspace/config`);
  expect(res.status()).toBe(200);
  return (await res.json()) as Record<string, unknown>;
}

/**
 * Poll GET /config until `predicate(config)` returns true, or throw a
 * clear timeout error. Used to wait for `useConfigSync`'s cascading
 * PUTs to settle after a UI seed step or a strategy switch — the hook
 * re-runs on multiple state dependencies (target, task, cv, blocked)
 * so a single click can produce a short burst of PUTs over ~150–500ms
 * before reaching steady state. Polling the saved config directly
 * sidesteps the brittleness of `page.waitForRequest` race-matching the
 * "right" PUT in a burst.
 *
 * Returns the final config so callers can immediately assert against
 * it without an extra round-trip.
 */
export async function waitForConfigSettle(
  request: APIRequestContext,
  predicate: (config: Record<string, unknown>) => boolean,
  {
    timeoutMs = 5000,
    intervalMs = 100,
  }: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<Record<string, unknown>> {
  const start = Date.now();
  let last: Record<string, unknown> = {};
  while (Date.now() - start < timeoutMs) {
    last = await readSavedConfig(request);
    if (predicate(last)) return last;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(
    `waitForConfigSettle timed out after ${timeoutMs}ms; last=${JSON.stringify(last).slice(0, 400)}`,
  );
}

/**
 * Walk a dotted path through a JSON object. Returns `undefined` if any
 * segment is missing — callers compare against the expected value
 * directly, so a missing field surfaces as a clear `undefined !==
 * <expected>` failure instead of throwing.
 */
export function deepGet(
  obj: unknown,
  path: string,
): unknown {
  const parts = path.split(".");
  let cursor: unknown = obj;
  for (const key of parts) {
    if (cursor === null || cursor === undefined) return undefined;
    if (typeof cursor !== "object") return undefined;
    cursor = (cursor as Record<string, unknown>)[key];
  }
  return cursor;
}

/**
 * Wait for the next PUT /api/workspace/config whose body satisfies
 * `bodyPredicate`. The matcher anchors on the exact URL + HTTP
 * method, then filters bodies — this skips the partial-only PUTs
 * that P-0092 Phase 2 introduced (e.g. an `auto-reset` patch that
 * carries only `{evaluation: {...}}` and no `split` block). Without
 * the body filter, those partial PUTs land in the queue ahead of
 * the field-edit PUT we are actually trying to lock and the spec
 * fails with `Received: undefined` at the configPath we asked for.
 *
 * Caller is responsible for invoking the UI action AFTER this promise
 * is created — Playwright's `waitForRequest` is a one-shot
 * subscription, so racing the action before subscribing drops the
 * event.
 *
 * If `bodyPredicate` is omitted the function preserves the original
 * behaviour (any PUT to /workspace/config) for callers that haven't
 * been migrated yet.
 */
export async function nextPutConfigBody(
  page: Page,
  bodyPredicate?: (body: Record<string, unknown>) => boolean,
): Promise<Record<string, unknown>> {
  const req = await page.waitForRequest((r: Request) => {
    if (r.method() !== "PUT") return false;
    if (!r.url().endsWith("/api/workspace/config")) return false;
    if (bodyPredicate === undefined) return true;
    let parsed: Record<string, unknown>;
    try {
      parsed = r.postDataJSON() as Record<string, unknown>;
    } catch {
      return false;
    }
    return bodyPredicate(parsed);
  });
  const body = req.postDataJSON();
  return body as Record<string, unknown>;
}

/**
 * Assert the four-step config-reflection invariant for a single field.
 *
 * Preconditions: the caller has driven the workspace UI to a state
 * where `spec.uiLocator(page)` resolves and `spec.uiAction` can write
 * `spec.testValue`. The function is intentionally agnostic to Section
 * (Data Source / CV / Model / etc.) because the precondition surface
 * differs per field.
 */
export async function assertConfigReflection<TValue>(
  page: Page,
  request: APIRequestContext,
  spec: ConfigFieldSpec<TValue>,
): Promise<void> {
  // (1) baseline: confirm the saved config currently holds the
  //     declared default. If this fails the spec data is wrong (or
  //     the precondition seeding leaked state) — fail fast with a
  //     specific message rather than a generic deep-equal mismatch.
  const before = await readSavedConfig(request);
  expect(
    deepGet(before, spec.configPath),
    `baseline mismatch at ${spec.configPath}`,
  ).toEqual(spec.defaultValue);

  // (2)+(3) drive the UI and observe the immediate PUT body. The
  // promise is created BEFORE the UI action so we don't drop the
  // request — Playwright's waitForRequest is a one-shot subscription.
  // We filter the body so partial PUTs that don't carry `configPath`
  // (e.g. P-0092 Phase 2 `auto-reset` patches that only flush the
  // evaluation/objective fields) are skipped — the spec asserts a
  // specific field, so the relevant PUT is the one whose body
  // contains a value at that path.
  const locator = spec.uiLocator(page);
  await expect(locator).toBeVisible();
  const putPromise = nextPutConfigBody(
    page,
    (body) => deepGet(body, spec.configPath) !== undefined,
  );
  await spec.uiAction(locator, spec.testValue);
  const putBody = await putPromise;
  expect(
    deepGet(putBody, spec.configPath),
    `PUT body mismatch at ${spec.configPath}`,
  ).toEqual(spec.testValue);

  // (4) confirm the saved config reflects the new value. useConfigSync
  //     calls setQueryData on success so a subsequent GET returns the
  //     server view; we assert the server view directly to avoid any
  //     client-cache illusion.
  const after = await readSavedConfig(request);
  expect(
    deepGet(after, spec.configPath),
    `saved config mismatch at ${spec.configPath}`,
  ).toEqual(spec.testValue);
}
