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
