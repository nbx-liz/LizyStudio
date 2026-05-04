import createClient, { type Middleware } from "openapi-fetch";
import type { paths } from "./generated/schema";

/**
 * Thrown by ``apiClient`` when the backend responds with a non-2xx status.
 *
 * Consumers that need to inspect the response body (for field-level
 * validation errors, for example) can read the ``body`` field. The
 * ``status`` field is the numeric HTTP status.
 */
export class ApiError extends Error {
  constructor(
    public status: number,
    public body: unknown,
  ) {
    super(`API error ${status}`);
    this.name = "ApiError";
  }
}

/**
 * openapi-fetch-based typed API client for the LizyStudio backend.
 *
 * Paths in the generated ``schema.d.ts`` already include the ``/api``
 * prefix (e.g. ``"/api/files"``), so ``baseUrl`` is an empty string —
 * NOT ``"/api"`` — and consumers call ``apiClient.GET("/api/files", ...)``.
 *
 * A ``throwOnError`` middleware converts non-2xx responses into
 * ``ApiError`` so consumers can keep a single ``catch`` path regardless
 * of HTTP status code.
 */
const rawClient = createClient<paths>({ baseUrl: "" });

const throwOnErrorMiddleware: Middleware = {
  async onResponse({ response }) {
    if (!response.ok) {
      const body = await response
        .clone()
        .json()
        .catch(() => null);
      throw new ApiError(response.status, body);
    }
    return response;
  },
};

rawClient.use(throwOnErrorMiddleware);

export const apiClient = rawClient;
