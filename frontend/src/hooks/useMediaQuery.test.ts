import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useMediaQuery } from "./useMediaQuery";

type Listener = (event: MediaQueryListEvent) => void;

function createMatchMediaMock(initialMatches: boolean) {
  const listeners = new Set<Listener>();
  let matches = initialMatches;

  const mql = {
    get matches() {
      return matches;
    },
    media: "",
    onchange: null,
    addEventListener: vi.fn((_: string, listener: Listener) => {
      listeners.add(listener);
    }),
    removeEventListener: vi.fn((_: string, listener: Listener) => {
      listeners.delete(listener);
    }),
    dispatchEvent: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
  };

  return {
    mql,
    setMatches(next: boolean) {
      matches = next;
      for (const listener of listeners) {
        listener({ matches: next } as MediaQueryListEvent);
      }
    },
  };
}

describe("useMediaQuery", () => {
  let originalMatchMedia: typeof window.matchMedia | undefined;

  beforeEach(() => {
    originalMatchMedia = window.matchMedia;
  });

  afterEach(() => {
    if (originalMatchMedia) {
      Object.defineProperty(window, "matchMedia", {
        writable: true,
        configurable: true,
        value: originalMatchMedia,
      });
    }
  });

  it("returns the initial match state synchronously on mount", () => {
    const { mql } = createMatchMediaMock(true);
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      configurable: true,
      value: vi.fn().mockReturnValue(mql),
    });

    const { result } = renderHook(() => useMediaQuery("(max-width: 767px)"));
    expect(result.current).toBe(true);
  });

  it("reflects media query changes", () => {
    const { mql, setMatches } = createMatchMediaMock(false);
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      configurable: true,
      value: vi.fn().mockReturnValue(mql),
    });

    const { result } = renderHook(() => useMediaQuery("(max-width: 767px)"));
    expect(result.current).toBe(false);

    act(() => {
      setMatches(true);
    });
    expect(result.current).toBe(true);
  });

  it("unsubscribes on unmount", () => {
    const { mql } = createMatchMediaMock(false);
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      configurable: true,
      value: vi.fn().mockReturnValue(mql),
    });

    const { unmount } = renderHook(() => useMediaQuery("(max-width: 767px)"));
    unmount();
    expect(mql.removeEventListener).toHaveBeenCalledTimes(1);
  });

  it("returns false when matchMedia is unavailable (SSR / jsdom edge case)", () => {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      configurable: true,
      value: undefined,
    });

    const { result } = renderHook(() => useMediaQuery("(max-width: 767px)"));
    expect(result.current).toBe(false);
  });
});
