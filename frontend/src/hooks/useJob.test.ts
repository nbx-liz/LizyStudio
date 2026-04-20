import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useJob } from "./useJob";

vi.mock("@/api/jobs", () => ({
  fetchJob: vi.fn(),
}));

import { fetchJob } from "@/api/jobs";

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return createElement(QueryClientProvider, { client: qc }, children);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("useJob", () => {
  it("does not fetch when jobId is null", async () => {
    renderHook(() => useJob(null), { wrapper });
    await new Promise((r) => setTimeout(r, 30));
    expect(fetchJob).not.toHaveBeenCalled();
  });

  it("fetches and returns job detail", async () => {
    vi.mocked(fetchJob).mockResolvedValueOnce({
      job_id: "j1",
      status: "completed",
      // biome-ignore lint/suspicious/noExplicitAny: test fixture shape
    } as any);
    const { result } = renderHook(() => useJob("j1"), { wrapper });
    await waitFor(() => expect(result.current.data?.status).toBe("completed"));
  });
});
