import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./client", () => ({
  apiFetch: vi.fn(),
}));

import { apiFetch } from "./client";
import { fetchDirectory } from "./files";

const mockApiFetch = vi.mocked(apiFetch);

afterEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// fetchDirectory
// ---------------------------------------------------------------------------
describe("fetchDirectory", () => {
  it("calls /files without params when no path", async () => {
    mockApiFetch.mockResolvedValue({
      path: "/",
      parent: null,
      entries: [],
    });
    await fetchDirectory();
    expect(mockApiFetch).toHaveBeenCalledWith("/files");
  });

  it("encodes path query param", async () => {
    mockApiFetch.mockResolvedValue({
      path: "/data/my dir",
      parent: "/data",
      entries: [],
    });
    await fetchDirectory("/data/my dir");
    expect(mockApiFetch).toHaveBeenCalledWith("/files?path=%2Fdata%2Fmy%20dir");
  });

  it("returns directory listing", async () => {
    const listing = {
      path: "/data",
      parent: "/",
      entries: [
        { name: "train.csv", type: "file", size: 1024, extension: ".csv" },
        { name: "models", type: "directory", size: null, extension: null },
      ],
    };
    mockApiFetch.mockResolvedValue(listing);
    const result = await fetchDirectory("/data");
    expect(result).toEqual(listing);
  });
});
