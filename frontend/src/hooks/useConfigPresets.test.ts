import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useConfigPresets } from "./useConfigPresets";

const STORAGE_KEY = "lizystudio-config-presets";

describe("useConfigPresets", () => {
  afterEach(() => {
    localStorage.removeItem(STORAGE_KEY);
  });

  it("starts with empty presets", () => {
    const { result } = renderHook(() => useConfigPresets());
    expect(result.current.presets).toEqual([]);
  });

  it("saves and loads a preset", () => {
    const { result } = renderHook(() => useConfigPresets());
    const config = { model: { name: "lgbm" } };

    act(() => result.current.save("my-preset", config));

    expect(result.current.presets).toHaveLength(1);
    expect(result.current.presets[0].name).toBe("my-preset");
    expect(result.current.load("my-preset")).toEqual(config);
  });

  it("overwrites preset with same name", () => {
    const { result } = renderHook(() => useConfigPresets());

    act(() => result.current.save("test", { v: 1 }));
    act(() => result.current.save("test", { v: 2 }));

    expect(result.current.presets).toHaveLength(1);
    expect(result.current.load("test")).toEqual({ v: 2 });
  });

  it("removes a preset", () => {
    const { result } = renderHook(() => useConfigPresets());

    act(() => result.current.save("a", { v: 1 }));
    act(() => result.current.save("b", { v: 2 }));
    act(() => result.current.remove("a"));

    expect(result.current.presets).toHaveLength(1);
    expect(result.current.load("a")).toBeNull();
  });

  it("persists to localStorage", () => {
    const { result } = renderHook(() => useConfigPresets());

    act(() => result.current.save("persist", { ok: true }));

    const raw = localStorage.getItem(STORAGE_KEY);
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw ?? "[]");
    expect(parsed[0].name).toBe("persist");
  });

  it("loads presets from localStorage on init", () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([
        {
          name: "existing",
          config: { x: 1 },
          createdAt: "2026-01-01T00:00:00Z",
        },
      ]),
    );

    const { result } = renderHook(() => useConfigPresets());
    expect(result.current.presets).toHaveLength(1);
    expect(result.current.load("existing")).toEqual({ x: 1 });
  });
});
