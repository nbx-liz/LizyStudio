import { fireEvent, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useKeyboardShortcuts } from "./useKeyboardShortcuts";

describe("useKeyboardShortcuts", () => {
  it("fires action on matching key press", () => {
    const action = vi.fn();
    renderHook(() => useKeyboardShortcuts([{ key: "k", action }]));

    fireEvent.keyDown(window, { key: "k" });
    expect(action).toHaveBeenCalledOnce();
  });

  it("does not fire action for non-matching key", () => {
    const action = vi.fn();
    renderHook(() => useKeyboardShortcuts([{ key: "k", action }]));

    fireEvent.keyDown(window, { key: "j" });
    expect(action).not.toHaveBeenCalled();
  });

  it("fires action with ctrl modifier", () => {
    const action = vi.fn();
    renderHook(() => useKeyboardShortcuts([{ key: "s", ctrl: true, action }]));

    // Without ctrl — should NOT fire
    fireEvent.keyDown(window, { key: "s" });
    expect(action).not.toHaveBeenCalled();

    // With ctrl — should fire
    fireEvent.keyDown(window, { key: "s", ctrlKey: true });
    expect(action).toHaveBeenCalledOnce();
  });

  it("fires action with meta key (macOS cmd)", () => {
    const action = vi.fn();
    renderHook(() => useKeyboardShortcuts([{ key: "s", ctrl: true, action }]));

    fireEvent.keyDown(window, { key: "s", metaKey: true });
    expect(action).toHaveBeenCalledOnce();
  });

  it("fires action with shift modifier", () => {
    const action = vi.fn();
    renderHook(() => useKeyboardShortcuts([{ key: "p", shift: true, action }]));

    // Without shift — should NOT fire
    fireEvent.keyDown(window, { key: "p" });
    expect(action).not.toHaveBeenCalled();

    // With shift — should fire
    fireEvent.keyDown(window, { key: "p", shiftKey: true });
    expect(action).toHaveBeenCalledOnce();
  });

  it("fires action with ctrl+shift combination", () => {
    const action = vi.fn();
    renderHook(() =>
      useKeyboardShortcuts([{ key: "z", ctrl: true, shift: true, action }]),
    );

    // Only ctrl — should NOT fire
    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    expect(action).not.toHaveBeenCalled();

    // ctrl+shift — should fire
    fireEvent.keyDown(window, {
      key: "z",
      ctrlKey: true,
      shiftKey: true,
    });
    expect(action).toHaveBeenCalledOnce();
  });

  it("skips shortcuts when input element is focused", () => {
    const action = vi.fn();
    renderHook(() => useKeyboardShortcuts([{ key: "k", action }]));

    const input = document.createElement("input");
    document.body.appendChild(input);
    try {
      fireEvent.keyDown(input, { key: "k" });
      expect(action).not.toHaveBeenCalled();
    } finally {
      document.body.removeChild(input);
    }
  });

  it("skips shortcuts when textarea is focused", () => {
    const action = vi.fn();
    renderHook(() => useKeyboardShortcuts([{ key: "k", action }]));

    const textarea = document.createElement("textarea");
    document.body.appendChild(textarea);
    try {
      fireEvent.keyDown(textarea, { key: "k" });
      expect(action).not.toHaveBeenCalled();
    } finally {
      document.body.removeChild(textarea);
    }
  });

  it("skips shortcuts when select is focused", () => {
    const action = vi.fn();
    renderHook(() => useKeyboardShortcuts([{ key: "k", action }]));

    const select = document.createElement("select");
    document.body.appendChild(select);
    try {
      fireEvent.keyDown(select, { key: "k" });
      expect(action).not.toHaveBeenCalled();
    } finally {
      document.body.removeChild(select);
    }
  });

  it("prevents default on matching shortcut", () => {
    const action = vi.fn();
    renderHook(() => useKeyboardShortcuts([{ key: "k", action }]));

    const event = new KeyboardEvent("keydown", {
      key: "k",
      bubbles: true,
      cancelable: true,
    });
    const preventSpy = vi.spyOn(event, "preventDefault");
    window.dispatchEvent(event);
    expect(preventSpy).toHaveBeenCalledTimes(1);
  });

  it("matches first shortcut and stops", () => {
    const action1 = vi.fn();
    const action2 = vi.fn();
    renderHook(() =>
      useKeyboardShortcuts([
        { key: "k", action: action1 },
        { key: "k", action: action2 },
      ]),
    );

    fireEvent.keyDown(window, { key: "k" });
    expect(action1).toHaveBeenCalledOnce();
    expect(action2).not.toHaveBeenCalled();
  });

  it("cleans up event listener on unmount", () => {
    const action = vi.fn();
    const { unmount } = renderHook(() =>
      useKeyboardShortcuts([{ key: "k", action }]),
    );

    unmount();
    fireEvent.keyDown(window, { key: "k" });
    expect(action).not.toHaveBeenCalled();
  });

  it("uses latest shortcuts via ref (no stale closure)", () => {
    const action1 = vi.fn();
    const action2 = vi.fn();

    const { rerender } = renderHook(
      ({ shortcuts }) => useKeyboardShortcuts(shortcuts),
      {
        initialProps: {
          shortcuts: [{ key: "k", action: action1 }],
        },
      },
    );

    rerender({ shortcuts: [{ key: "k", action: action2 }] });

    fireEvent.keyDown(window, { key: "k" });
    expect(action1).not.toHaveBeenCalled();
    expect(action2).toHaveBeenCalledOnce();
  });
});
