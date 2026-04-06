import { HttpResponse, http } from "msw";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { server } from "../test/mocks/server";
import { apiFetch } from "./client";

describe("apiFetch", () => {
  beforeAll(() => server.listen({ onUnhandledRequest: "bypass" }));
  afterEach(() => server.resetHandlers());
  afterAll(() => server.close());

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

  it("ApiError contains status and body", async () => {
    const errorBody = {
      error: { code: "JOB_NOT_FOUND", message: "not found" },
    };
    server.use(
      http.get("/api/test-404", () =>
        HttpResponse.json(errorBody, { status: 404 }),
      ),
    );

    try {
      await apiFetch("/test-404");
      expect.unreachable("should have thrown");
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(Error);
      const apiErr = err as { status: number; body: unknown };
      expect(apiErr.status).toBe(404);
      expect(apiErr.body).toEqual(errorBody);
    }
  });

  it("sets Content-Type for string body", async () => {
    let receivedContentType: string | null = null;
    server.use(
      http.put("/api/test-ct", async ({ request }) => {
        receivedContentType = request.headers.get("Content-Type");
        return HttpResponse.json({ ok: true });
      }),
    );

    await apiFetch("/test-ct", {
      method: "PUT",
      body: JSON.stringify({ key: "val" }),
    });
    expect(receivedContentType).toBe("application/json");
  });

  it("does not set Content-Type for FormData body", async () => {
    let receivedContentType: string | null = null;
    server.use(
      http.post("/api/test-form", async ({ request }) => {
        receivedContentType = request.headers.get("Content-Type");
        return HttpResponse.json({ ok: true });
      }),
    );

    const formData = new FormData();
    formData.append("file", new Blob(["data"]), "test.csv");
    await apiFetch("/test-form", {
      method: "POST",
      body: formData,
      headers: {},
    });
    // FormData should have multipart boundary, not application/json
    expect(receivedContentType).not.toContain("application/json");
  });

  it("forwards abort signal", async () => {
    const controller = new AbortController();
    controller.abort();
    server.use(
      http.get("/api/test-abort", () => HttpResponse.json({ ok: true })),
    );

    await expect(
      apiFetch("/test-abort", { signal: controller.signal }),
    ).rejects.toThrow();
  });
});
