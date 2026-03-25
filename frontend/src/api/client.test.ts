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
});
