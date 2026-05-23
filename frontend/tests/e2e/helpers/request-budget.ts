import { expect, type Page } from "@playwright/test";

/**
 * Request-budget helper for E2E specs (Issue #538).
 *
 * Templates the count-occurrences pattern that landed in
 * ``workspace-target-select-puts.spec.ts``. The v0.6.2 Target-select
 * bug cluster (#529 / #530 / #531) was the first regression class
 * where every assertion checked eventual *state* (resolved value, no
 * error, etc.) and every state-based assertion passed -- yet 9 PUTs
 * per click were fired across a 4-day window. The same pattern would
 * have caught #339 (polling storm) and #341 (replay loop) months
 * earlier had counts been asserted at the E2E layer.
 *
 * The helper is intentionally small. It installs request observers,
 * records every (method, URL, body) for later inspection, and exposes
 * filtered count / list views plus a single-call budget assertion.
 *
 * Usage:
 *
 *     const recorder = installFetchRecorder(page);
 *     // ...drive UI...
 *     await page.waitForTimeout(3000);  // wait for funnel quiescence
 *     expectBudget(recorder, {
 *       method: "PUT",
 *       urlPattern: "/api/workspace/config",
 *       max: 3,
 *       label: "Target-select click",
 *     });
 *
 * Why not just count via ``page.on``? You can, and the existing spec
 * does. The helper centralises (a) the post-data JSON parsing,
 * (b) "snapshot at point T" semantics, (c) the verbose diagnostic
 * payload on failure, and (d) the response-status side channel for
 * GET-returns-4xx assertions. All four are easy to forget when each
 * spec rolls its own observer.
 *
 * Per ``feedback_count_budget_assertions`` (memory): for storm/spam/
 * flood bugs, the regression test MUST count occurrences, not just
 * assert eventual correctness.
 */

export interface RequestRecord {
  method: string;
  url: string;
  /** Parsed JSON request body when ``Content-Type`` is JSON; ``null`` otherwise. */
  bodyJson: Record<string, unknown> | null;
  /** Raw post-data string length, useful for "partial body" heuristics. */
  bodySize: number;
}

export interface ResponseRecord {
  method: string;
  url: string;
  status: number;
}

export interface FetchRecorder {
  /** Every observed request, in arrival order. */
  readonly requests: RequestRecord[];
  /** Every observed response, in arrival order. */
  readonly responses: ResponseRecord[];
  /**
   * Number of requests currently recorded for the given filter. Use
   * before / after a UI action to compute a delta.
   */
  countRequests(filter: RequestFilter): number;
  /** All requests matching ``filter``, in arrival order. */
  matchingRequests(filter: RequestFilter): RequestRecord[];
  /** All responses matching ``filter`` (with optional status code). */
  matchingResponses(filter: ResponseFilter): ResponseRecord[];
  /**
   * Take a snapshot of the current request count for ``filter``. Returns
   * a closure that, on call, returns the delta since the snapshot.
   * Pattern: ``const since = recorder.snapshot({...}); ...; since()``.
   */
  snapshot(filter: RequestFilter): () => RequestRecord[];
}

export interface RequestFilter {
  method?: string;
  /** Either a string suffix-match (``endsWith``) or a RegExp. */
  urlPattern: string | RegExp;
}

export interface ResponseFilter extends RequestFilter {
  /** When set, only responses with this exact status are returned. */
  status?: number;
}

export interface BudgetAssertion {
  method: string;
  urlPattern: string | RegExp;
  /** Maximum allowed observed count (inclusive). */
  max: number;
  /** Human-readable description of the user action this budget covers. */
  label?: string;
}

function matchesUrl(actual: string, pattern: string | RegExp): boolean {
  if (typeof pattern === "string") return actual.endsWith(pattern);
  return pattern.test(actual);
}

function matchesRequest(req: RequestRecord, filter: RequestFilter): boolean {
  if (filter.method && req.method !== filter.method) return false;
  return matchesUrl(req.url, filter.urlPattern);
}

/**
 * Install request + response observers on ``page``. The returned
 * recorder accumulates everything for the lifetime of the page; it does
 * not need teardown.
 *
 * Must be called BEFORE any user interaction that should be measured.
 * Records that arrive before installation are not captured.
 */
export function installFetchRecorder(page: Page): FetchRecorder {
  const requests: RequestRecord[] = [];
  const responses: ResponseRecord[] = [];

  page.on("request", (req) => {
    let bodyJson: Record<string, unknown> | null = null;
    try {
      const parsed = req.postDataJSON() as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        bodyJson = parsed as Record<string, unknown>;
      }
    } catch {
      // Not JSON or no body -- bodyJson stays null.
    }
    requests.push({
      method: req.method(),
      url: req.url(),
      bodyJson,
      bodySize: req.postData()?.length ?? 0,
    });
  });

  page.on("response", (res) => {
    responses.push({
      method: res.request().method(),
      url: res.url(),
      status: res.status(),
    });
  });

  return {
    requests,
    responses,
    countRequests(filter) {
      return requests.filter((r) => matchesRequest(r, filter)).length;
    },
    matchingRequests(filter) {
      return requests.filter((r) => matchesRequest(r, filter));
    },
    matchingResponses(filter) {
      return responses.filter((r) => {
        if (filter.method && r.method !== filter.method) return false;
        if (!matchesUrl(r.url, filter.urlPattern)) return false;
        if (filter.status !== undefined && r.status !== filter.status)
          return false;
        return true;
      });
    },
    snapshot(filter) {
      const start = requests.length;
      return () => requests.slice(start).filter((r) => matchesRequest(r, filter));
    },
  };
}

/**
 * Assert that the recorded count for ``budget.method`` / ``urlPattern``
 * is at most ``budget.max``. Failure message includes every captured
 * URL + body-key set for the matching requests so the spec author can
 * see WHAT extra writes fired, not just THAT something fired too often.
 *
 * Use after a UI action + a quiescence wait. Combine with ``snapshot``
 * when the budget should cover only post-snapshot requests:
 *
 *     const since = recorder.snapshot({ method: "PUT", urlPattern: "/api/workspace/config" });
 *     // ...drive UI...
 *     await page.waitForTimeout(3000);
 *     const extra = since();
 *     expect(extra.length, label).toBeLessThanOrEqual(2);
 */
export function expectBudget(
  recorder: FetchRecorder,
  budget: BudgetAssertion,
): void {
  const matches = recorder.matchingRequests({
    method: budget.method,
    urlPattern: budget.urlPattern,
  });
  const labelPrefix = budget.label ? `${budget.label}: ` : "";
  const diagnostic = matches
    .map(
      (m, i) =>
        `  [${i}] ${m.method} ${m.url} keys=${
          m.bodyJson ? JSON.stringify(Object.keys(m.bodyJson).sort()) : "(no body)"
        }`,
    )
    .join("\n");
  expect(
    matches.length,
    `${labelPrefix}observed ${matches.length} ${budget.method} request(s) for ${
      budget.urlPattern
    } (budget ${budget.max}). Captured:\n${diagnostic || "  (none)"}`,
  ).toBeLessThanOrEqual(budget.max);
}
