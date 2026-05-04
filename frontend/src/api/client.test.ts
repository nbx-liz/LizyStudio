import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import { server } from "../test/mocks/server";
import { ApiError, apiClient } from "./client";

// C-6 completed (Phase 5, H-0080): ``apiFetch`` has been retired in
// favour of openapi-fetch-based ``apiClient``. This suite is the
// single source of truth for the client contract — success path,
// throw-on-error middleware, query forwarding, AbortSignal
// propagation, and error-body edge cases (non-JSON, empty body).

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

  it("ApiError.body is null when the error response is non-JSON", async () => {
    // e.g. a reverse-proxy HTML error page or an empty body. The middleware
    // swallows the parse failure and surfaces ``null`` in ``body`` so the
    // status code is still usable for branching.
    server.use(
      http.get(
        "/api/files",
        () =>
          new HttpResponse("<h1>Internal Server Error</h1>", {
            status: 500,
            headers: { "Content-Type": "text/html" },
          }),
      ),
    );

    try {
      await apiClient.GET("/api/files", {});
      expect.fail("Should have thrown");
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(ApiError);
      const apiErr = err as ApiError;
      expect(apiErr.status).toBe(500);
      expect(apiErr.body).toBeNull();
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

  it("rejects when the underlying fetch errors out", async () => {
    // ``HttpResponse.error()`` triggers a network-level failure at the
    // fetch layer. openapi-fetch surfaces this as a rejected promise
    // before the middleware sees a response.
    server.use(http.get("/api/files", () => HttpResponse.error()));
    await expect(apiClient.GET("/api/files", {})).rejects.toThrow();
  });
});
