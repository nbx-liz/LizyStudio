import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import { server } from "../test/mocks/server";
import { ApiError, apiFetch } from "./client";

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
