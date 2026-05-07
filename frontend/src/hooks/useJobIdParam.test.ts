import { act, renderHook } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { useJobIdParam } from "./useJobIdParam";

function wrapperWith(initialUrl: string) {
  return ({ children }: { children: ReactNode }) =>
    createElement(MemoryRouter, { initialEntries: [initialUrl] }, children);
}

describe("useJobIdParam", () => {
  it("hydrates jobId from ?job_id= on mount", () => {
    const { result } = renderHook(() => useJobIdParam(), {
      wrapper: wrapperWith("/?job_id=job_abc"),
    });
    expect(result.current.jobId).toBe("job_abc");
  });

  it("normalizes empty ?job_id= to null", () => {
    const { result } = renderHook(() => useJobIdParam(), {
      wrapper: wrapperWith("/?job_id="),
    });
    expect(result.current.jobId).toBeNull();
  });

  it("returns null when no ?job_id= param is present", () => {
    const { result } = renderHook(() => useJobIdParam(), {
      wrapper: wrapperWith("/"),
    });
    expect(result.current.jobId).toBeNull();
  });

  it("setJobId without writeUrl updates state only", () => {
    const { result } = renderHook(() => useJobIdParam(), {
      wrapper: wrapperWith("/"),
    });
    act(() => result.current.setJobId("job_new"));
    expect(result.current.jobId).toBe("job_new");
  });

  it("setJobId with writeUrl=true updates state", () => {
    // MemoryRouter does not expose `location.search` directly through
    // renderHook; the integration effect (URL write triggers a re-read
    // on the next mount) is covered by the pages that consume this
    // hook. Here we verify the state side of the contract.
    const { result } = renderHook(() => useJobIdParam(), {
      wrapper: wrapperWith("/"),
    });
    act(() => result.current.setJobId("job_new", { writeUrl: true }));
    expect(result.current.jobId).toBe("job_new");
  });

  it("setJobId(null, { writeUrl: true }) clears the state", () => {
    const { result } = renderHook(() => useJobIdParam(), {
      wrapper: wrapperWith("/?job_id=job_abc"),
    });
    expect(result.current.jobId).toBe("job_abc");
    act(() => result.current.setJobId(null, { writeUrl: true }));
    expect(result.current.jobId).toBeNull();
  });

  it("suppress=true blocks URL→state re-sync after local override", () => {
    const { result, rerender } = renderHook(
      ({ suppress }: { suppress: boolean }) => useJobIdParam({ suppress }),
      {
        wrapper: wrapperWith("/?job_id=job_abc"),
        initialProps: { suppress: false },
      },
    );
    expect(result.current.jobId).toBe("job_abc");
    act(() => result.current.setJobId("job_local"));
    expect(result.current.jobId).toBe("job_local");
    // Re-running with suppress=true must not pull state back to the
    // URL value when the effect re-fires.
    rerender({ suppress: true });
    expect(result.current.jobId).toBe("job_local");
  });

  it("fallbackJobId hydrates state when the URL has no ?job_id=", () => {
    // P-0102 v3-24a: a server-derived fallback (workspaceStatus.current_job_id)
    // takes over when the URL is empty, so a browser reload re-attaches
    // the Workspace to the previously-running job without a deep link.
    const { result } = renderHook(
      ({ fallback }: { fallback: string | null }) =>
        useJobIdParam({ fallbackJobId: fallback }),
      {
        wrapper: wrapperWith("/"),
        initialProps: { fallback: null as string | null },
      },
    );
    expect(result.current.jobId).toBeNull();
  });

  it("fallbackJobId arriving asynchronously is consumed once the value flips", () => {
    // workspaceStatus is fetched async on mount, so the fallback is
    // null at first render and becomes non-null on the next render.
    type Props = { fallback: string | null };
    const { result, rerender } = renderHook(
      ({ fallback }: Props) => useJobIdParam({ fallbackJobId: fallback }),
      {
        wrapper: wrapperWith("/"),
        initialProps: { fallback: null as string | null },
      },
    );
    expect(result.current.jobId).toBeNull();
    rerender({ fallback: "job_xyz" });
    expect(result.current.jobId).toBe("job_xyz");
  });

  it("URL ?job_id= takes precedence over fallbackJobId", () => {
    const { result } = renderHook(
      () => useJobIdParam({ fallbackJobId: "job_fallback" }),
      { wrapper: wrapperWith("/?job_id=job_url") },
    );
    expect(result.current.jobId).toBe("job_url");
  });

  it("fallbackJobId is consumed at most once — explicit clear sticks", () => {
    // INV-reload-3: after the user clears the id (or a fresh fit
    // writes a new one) a later workspaceStatus refetch must not
    // re-pull the stale fallback.
    type Props = { fallback: string | null };
    const { result, rerender } = renderHook(
      ({ fallback }: Props) => useJobIdParam({ fallbackJobId: fallback }),
      {
        wrapper: wrapperWith("/"),
        initialProps: { fallback: "job_first" as string | null },
      },
    );
    expect(result.current.jobId).toBe("job_first");
    act(() => result.current.setJobId(null));
    expect(result.current.jobId).toBeNull();
    rerender({ fallback: "job_second" });
    // Latch is locked — the new fallback is ignored.
    expect(result.current.jobId).toBeNull();
  });

  it("suppress=true blocks fallbackJobId hydration", () => {
    // A freshly-started fit/tune sets running=true (= suppress) before
    // setCurrentJobId fires. A stale workspaceStatus fallback arriving
    // mid-window must not back-fill the slot before the new id lands.
    type Props = { suppress: boolean; fallback: string | null };
    const { result, rerender } = renderHook(
      ({ suppress, fallback }: Props) =>
        useJobIdParam({ suppress, fallbackJobId: fallback }),
      {
        wrapper: wrapperWith("/"),
        initialProps: {
          suppress: true,
          fallback: "job_stale" as string | null,
        },
      },
    );
    expect(result.current.jobId).toBeNull();
    rerender({ suppress: false, fallback: "job_stale" });
    expect(result.current.jobId).toBe("job_stale");
  });

  it("filter change re-evaluates and promotes a previously-rejected id", () => {
    // Simulates the InferencePage flow: the URL already carries a
    // job_id on mount, but `completedJobs` is initially empty so the
    // id cannot be validated. When `completedJobs` arrives (filter
    // identity changes), the effect re-runs and promotes the id.
    type FilterProps = { filter: (id: string) => boolean };
    const { result, rerender } = renderHook(
      ({ filter }: FilterProps) => useJobIdParam({ filter }),
      {
        wrapper: wrapperWith("/?job_id=job_abc"),
        initialProps: { filter: (_id: string) => false } as FilterProps,
      },
    );
    // Initial value comes from the URL before the first effect runs;
    // the effect then sees `filter(...) === false` and leaves the
    // state alone — which is still the initializer value. We clear
    // local state via setJobId to prove subsequent URL→state sync
    // honours the new filter.
    act(() => result.current.setJobId(null));
    expect(result.current.jobId).toBeNull();

    rerender({ filter: (id: string) => id === "job_abc" });
    expect(result.current.jobId).toBe("job_abc");
  });
});
