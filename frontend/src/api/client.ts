import createClient, { type Middleware } from "openapi-fetch";
import type { paths } from "./generated/schema";

const BASE_URL = "/api";

export class ApiError extends Error {
  constructor(
    public status: number,
    public body: unknown,
  ) {
    super(`API error ${status}`);
    this.name = "ApiError";
  }
}

export async function apiFetch<T>(
  path: string,
  options?: RequestInit,
): Promise<T> {
  const url = `${BASE_URL}${path}`;
  const headers: Record<string, string> = {};

  const existingHeaders = (options?.headers as Record<string, string>) ?? {};
  if (
    options?.body &&
    typeof options.body === "string" &&
    !existingHeaders["Content-Type"]
  ) {
    headers["Content-Type"] = "application/json";
  }

  const res = await fetch(url, {
    ...options,
    headers: { ...headers, ...(options?.headers as Record<string, string>) },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new ApiError(res.status, body);
  }

  return res.json() as Promise<T>;
}

// C-6 Phase 1: openapi-fetch-based typed client. Paths in generated
// ``schema.d.ts`` already include the ``/api`` prefix, so ``baseUrl`` is
// empty and consumers call ``apiClient.GET("/api/files", ...)``. A
// ``throwOnError`` middleware converts non-2xx responses into the same
// ``ApiError`` that ``apiFetch`` throws, so the 51 existing consumers that
// catch ``ApiError`` keep working unchanged during the migration.
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
