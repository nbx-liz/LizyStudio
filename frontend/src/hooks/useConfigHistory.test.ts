import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useConfigHistory } from "./useConfigHistory";

describe("useConfigHistory", () => {
  it("starts with canUndo=false and canRedo=false", () => {
    const { result } = renderHook(() => useConfigHistory());
    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(false);
  });

  it("push enables undo after second config", () => {
    const { result } = renderHook(() => useConfigHistory());

    act(() => result.current.push({ a: 1 }));
    expect(result.current.canUndo).toBe(false);

    act(() => result.current.push({ a: 2 }));
    expect(result.current.canUndo).toBe(true);
  });

  it("undo returns previous config", () => {
    const { result } = renderHook(() => useConfigHistory());

    act(() => result.current.push({ v: 1 }));
    act(() => result.current.push({ v: 2 }));
    act(() => result.current.push({ v: 3 }));

    let prev: Record<string, unknown> | null = null;
    act(() => {
      prev = result.current.undo();
    });
    expect(prev).toEqual({ v: 2 });
    expect(result.current.canRedo).toBe(true);
  });

  it("redo returns next config", () => {
    const { result } = renderHook(() => useConfigHistory());

    act(() => result.current.push({ v: 1 }));
    act(() => result.current.push({ v: 2 }));
    act(() => result.current.undo());

    let next: Record<string, unknown> | null = null;
    act(() => {
      next = result.current.redo();
    });
    expect(next).toEqual({ v: 2 });
    expect(result.current.canRedo).toBe(false);
  });

  it("push after undo clears redo stack", () => {
    const { result } = renderHook(() => useConfigHistory());

    act(() => result.current.push({ v: 1 }));
    act(() => result.current.push({ v: 2 }));
    act(() => result.current.undo());
    act(() => result.current.push({ v: 3 }));

    expect(result.current.canRedo).toBe(false);
  });

  it("ignores duplicate pushes", () => {
    const { result } = renderHook(() => useConfigHistory());

    act(() => result.current.push({ v: 1 }));
    act(() => result.current.push({ v: 1 }));

    expect(result.current.canUndo).toBe(false);
  });

  it("undo returns null when history is empty", () => {
    const { result } = renderHook(() => useConfigHistory());

    let prev: Record<string, unknown> | null = null;
    act(() => {
      prev = result.current.undo();
    });
    expect(prev).toBeNull();
  });

  it("redo returns null when future is empty", () => {
    const { result } = renderHook(() => useConfigHistory());

    let next: Record<string, unknown> | null = null;
    act(() => {
      next = result.current.redo();
    });
    expect(next).toBeNull();
  });
});
