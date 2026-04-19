import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
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

  // --- localStorage edge cases (#16) ---

  it("save gracefully handles QuotaExceededError", () => {
    const spy = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new DOMException("quota exceeded", "QuotaExceededError");
      });

    const { result } = renderHook(() => useConfigPresets());
    // Should not throw
    act(() => result.current.save("test", { v: 1 }));
    // State should still be updated in memory
    expect(result.current.presets).toHaveLength(1);

    spy.mockRestore();
  });

  it("load gracefully handles getItem throwing", () => {
    const spy = vi
      .spyOn(Storage.prototype, "getItem")
      .mockImplementation(() => {
        throw new DOMException("storage unavailable");
      });

    const { result } = renderHook(() => useConfigPresets());
    expect(result.current.presets).toEqual([]);

    spy.mockRestore();
  });

  it("load gracefully handles invalid JSON in storage", () => {
    localStorage.setItem(STORAGE_KEY, "not valid json {{{");

    const { result } = renderHook(() => useConfigPresets());
    expect(result.current.presets).toEqual([]);
  });

  // --- CRITICAL-5: sanitize before localStorage persistence ---

  it("strips data source and column selection from persisted presets", () => {
    const { result } = renderHook(() => useConfigPresets());
    const fullConfig = {
      task: "binary",
      data: {
        target: "y",
        path: "/home/user/secret/project/data.csv",
        source_type: "path",
      },
      features: { exclude: ["col_a", "col_b"] },
      model: { name: "lgbm" },
    };

    act(() => result.current.save("with-secrets", fullConfig));

    const raw = localStorage.getItem(STORAGE_KEY);
    expect(raw).toBeTruthy();
    const stored = JSON.parse(raw ?? "[]");
    const storedConfig = stored[0].config as Record<string, unknown>;

    // The sensitive keys must not appear in localStorage at all.
    expect(storedConfig.data).toBeUndefined();
    expect(storedConfig.features).toBeUndefined();
    // Model config is still preserved for legitimate reuse.
    expect(storedConfig.model).toEqual({ name: "lgbm" });
    expect(storedConfig.task).toBe("binary");
  });

  it("in-memory presets also omit sensitive fields so load() cannot return them", () => {
    const { result } = renderHook(() => useConfigPresets());
    const fullConfig = {
      task: "regression",
      data: { target: "y", path: "/leak/here.csv" },
      features: { exclude: ["pii"] },
      model: { name: "lgbm" },
    };

    act(() => result.current.save("in-mem", fullConfig));

    const loaded = result.current.load("in-mem");
    expect(loaded).not.toBeNull();
    expect((loaded as Record<string, unknown>).data).toBeUndefined();
    expect((loaded as Record<string, unknown>).features).toBeUndefined();
  });

  it("migrates legacy presets by stripping sensitive keys on read", () => {
    // A preset written by an older version still has data + features.
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([
        {
          name: "legacy",
          config: {
            task: "binary",
            data: { target: "y", path: "/leak.csv" },
            features: { exclude: ["ssn"] },
            model: { name: "lgbm" },
          },
          createdAt: "2026-01-01T00:00:00Z",
        },
      ]),
    );

    const { result } = renderHook(() => useConfigPresets());
    const loaded = result.current.load("legacy");

    expect(loaded).not.toBeNull();
    expect((loaded as Record<string, unknown>).data).toBeUndefined();
    expect((loaded as Record<string, unknown>).features).toBeUndefined();
    // model and task are preserved so the rest of the config still loads.
    expect((loaded as Record<string, unknown>).model).toEqual({ name: "lgbm" });
  });
});
