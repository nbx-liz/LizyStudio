import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import { server } from "../test/mocks/server";
import { ApiError, apiClient, apiFetch } from "./client";

describe("apiFetch", () => {
  it("makes a GET request and parses JSON response", async () => {
    server.use(
      http.get("/api/test-endpoint", () =>
        HttpResponse.json({ success: true }),
      ),
    );

    const result = await apiFetch<{ success: boolean }>("/test-endpoint");
    expect(result).toEqual({ success: true });
  });

  it("makes a POST request with body", async () => {
    server.use(
      http.post("/api/test-post", async ({ request }) => {
        const body = await request.json();
        return HttpResponse.json({ received: body });
      }),
    );

    const result = await apiFetch<{ received: unknown }>("/test-post", {
      method: "POST",
      body: JSON.stringify({ key: "value" }),
    });
    expect(result).toEqual({ received: { key: "value" } });
  });

  it("throws ApiError on non-ok response", async () => {
    server.use(
      http.get("/api/test-error", () =>
        HttpResponse.json({ detail: "Bad request" }, { status: 400 }),
      ),
    );

    await expect(apiFetch("/test-error")).rejects.toThrow("API error 400");
  });

  it("throws ApiError on server error", async () => {
    server.use(
      http.get("/api/test-500", () => new HttpResponse(null, { status: 500 })),
    );

    await expect(apiFetch("/test-500")).rejects.toThrow("API error 500");
  });

  // --- Edge cases (#6) ---

  it("handles network error (fetch rejects)", async () => {
    server.use(http.get("/api/test-network", () => HttpResponse.error()));

    await expect(apiFetch("/test-network")).rejects.toThrow();
  });

  it("handles non-JSON error response body", async () => {
    server.use(
      http.get(
        "/api/test-html-error",
        () =>
          new HttpResponse("<h1>Internal Server Error</h1>", {
            status: 500,
            headers: { "Content-Type": "text/html" },
          }),
      ),
    );

    await expect(apiFetch("/test-html-error")).rejects.toThrow("API error 500");
  });

  it("handles 204 No Content response", async () => {
    server.use(
      http.delete(
        "/api/test-204",
        () => new HttpResponse(null, { status: 204 }),
      ),
    );

    // 204 is ok but has no JSON body — should throw on json parse
    await expect(apiFetch("/test-204", { method: "DELETE" })).rejects.toThrow();
  });

  it("includes body in ApiError for 400 responses", async () => {
    server.use(
      http.post("/api/test-validation", () =>
        HttpResponse.json(
          { error: { code: "INVALID", message: "bad input" } },
          { status: 400 },
        ),
      ),
    );

    try {
      await apiFetch("/test-validation", {
        method: "POST",
        body: JSON.stringify({}),
      });
      expect.fail("Should have thrown");
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(ApiError);
      const apiErr = err as ApiError;
      expect(apiErr.status).toBe(400);
      expect(apiErr.body).toEqual({
        error: { code: "INVALID", message: "bad input" },
      });
    }
  });
});

// C-6 Phase 1: ``apiClient`` is an openapi-fetch-based client that shares
// the ApiError throwing contract with ``apiFetch``. During the migration
// (Phase 1-4) both clients coexist so consumers can be moved file-by-file.
// Phase 5 retires ``apiFetch`` and this suite collapses into the
// openapi-fetch-only set.
describe("apiClient (openapi-fetch)", () => {
  it("makes a typed GET request and returns parsed data", async () => {
    server.use(
      http.get("/api/files", () =>
        HttpResponse.json({
          path: "/",
          parent: null,
          entries: [],
        }),
      ),
    );

    const { data, error } = await apiClient.GET("/api/files", {});
    expect(error).toBeUndefined();
    expect(data).toEqual({ path: "/", parent: null, entries: [] });
  });

  it("throws ApiError on non-ok response via error middleware", async () => {
    server.use(
      http.get("/api/files", () =>
        HttpResponse.json({ detail: "Bad request" }, { status: 400 }),
      ),
    );

    await expect(apiClient.GET("/api/files", {})).rejects.toThrow(
      "API error 400",
    );
  });

  it("throws ApiError with status and body on server error", async () => {
    server.use(
      http.get("/api/files", () =>
        HttpResponse.json(
          { error: { code: "SERVER", message: "boom" } },
          { status: 500 },
        ),
      ),
    );

    try {
      await apiClient.GET("/api/files", {});
      expect.fail("Should have thrown");
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(ApiError);
      const apiErr = err as ApiError;
      expect(apiErr.status).toBe(500);
      expect(apiErr.body).toEqual({
        error: { code: "SERVER", message: "boom" },
      });
    }
  });

  it("forwards query params from params.query", async () => {
    let captured: string | null = null;
    server.use(
      http.get("/api/files", ({ request }) => {
        captured = new URL(request.url).searchParams.get("path");
        return HttpResponse.json({ path: "/", parent: null, entries: [] });
      }),
    );

    await apiClient.GET("/api/files", {
      params: { query: { path: "/data/my dir" } },
    });
    expect(captured).toBe("/data/my dir");
  });

  it("propagates AbortSignal to fetch (pre-aborted signal rejects immediately)", async () => {
    const controller = new AbortController();
    controller.abort();
    server.use(
      http.get("/api/files", () =>
        HttpResponse.json({ path: "/", parent: null, entries: [] }),
      ),
    );

    await expect(
      apiClient.GET("/api/files", { signal: controller.signal }),
    ).rejects.toThrow();
  });
});
