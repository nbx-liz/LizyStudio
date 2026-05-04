import { HttpResponse, http } from "msw";
import { afterEach, describe, expect, it, vi } from "vitest";
import { server } from "../test/mocks/server";
import { fetchDirectory } from "./files";

afterEach(() => {
  vi.clearAllMocks();
});

// C-6 Phase 1: ``fetchDirectory`` now uses ``apiClient`` (openapi-fetch)
// instead of the hand-rolled ``apiFetch``. Because the new client is a
// thin wrapper around ``fetch`` with type-level guards, we test through
// MSW rather than mocking the client module — the goal is to verify
// that the typed call site produces the same wire-level request and
// response shape that consumers observed before the migration.
describe("fetchDirectory", () => {
  it("calls /files without query params when no path is given", async () => {
    let capturedUrl = "";
    server.use(
      http.get("/api/files", ({ request }) => {
        capturedUrl = request.url;
        return HttpResponse.json({ path: "/", parent: null, entries: [] });
      }),
    );

    await fetchDirectory();
    const url = new URL(capturedUrl);
    expect(url.pathname).toBe("/api/files");
    expect(url.searchParams.has("path")).toBe(false);
  });

  it("encodes path query param and hits /api/files", async () => {
    let capturedPath: string | null = null;
    server.use(
      http.get("/api/files", ({ request }) => {
        capturedPath = new URL(request.url).searchParams.get("path");
        return HttpResponse.json({
          path: "/data/my dir",
          parent: "/data",
          entries: [],
        });
      }),
    );

    await fetchDirectory("/data/my dir");
    expect(capturedPath).toBe("/data/my dir");
  });

  it("returns the directory listing verbatim", async () => {
    const listing = {
      path: "/data",
      parent: "/",
      entries: [
        { name: "train.csv", type: "file", size: 1024, extension: ".csv" },
        { name: "models", type: "directory", size: null, extension: null },
      ],
    };
    server.use(http.get("/api/files", () => HttpResponse.json(listing)));

    const result = await fetchDirectory("/data");
    expect(result).toEqual(listing);
  });

  it("throws ApiError on non-2xx response", async () => {
    server.use(
      http.get("/api/files", () =>
        HttpResponse.json({ detail: "permission denied" }, { status: 403 }),
      ),
    );

    await expect(fetchDirectory("/forbidden")).rejects.toThrow("API error 403");
  });
});
