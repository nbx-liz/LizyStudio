import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useBeforeUnloadDirty } from "./useBeforeUnloadDirty";

describe("useBeforeUnloadDirty", () => {
  let listeners: Array<(event: Event) => void>;
  let originalAdd: typeof window.addEventListener;
  let originalRemove: typeof window.removeEventListener;

  beforeEach(() => {
    listeners = [];
    originalAdd = window.addEventListener;
    originalRemove = window.removeEventListener;
    window.addEventListener = vi.fn(
      (type: string, listener: EventListenerOrEventListenerObject) => {
        if (type === "beforeunload" && typeof listener === "function") {
          listeners.push(listener as (event: Event) => void);
        }
      },
    ) as typeof window.addEventListener;
    window.removeEventListener = vi.fn(
      (type: string, listener: EventListenerOrEventListenerObject) => {
        if (type === "beforeunload" && typeof listener === "function") {
          const idx = listeners.indexOf(listener as (event: Event) => void);
          if (idx >= 0) listeners.splice(idx, 1);
        }
      },
    ) as typeof window.removeEventListener;
  });

  afterEach(() => {
    window.addEventListener = originalAdd;
    window.removeEventListener = originalRemove;
  });

  function fireBeforeUnload(): {
    preventDefault: ReturnType<typeof vi.fn>;
    returnValue: string;
  } {
    const event = {
      preventDefault: vi.fn(),
      returnValue: "initial",
    };
    for (const listener of listeners) {
      listener(event as unknown as Event);
    }
    return event;
  }

  it("registers a beforeunload listener on mount", () => {
    renderHook(() => useBeforeUnloadDirty(() => false));
    expect(listeners.length).toBe(1);
  });

  it("removes the listener on unmount", () => {
    const { unmount } = renderHook(() => useBeforeUnloadDirty(() => false));
    expect(listeners.length).toBe(1);
    unmount();
    expect(listeners.length).toBe(0);
  });

  it("does NOT prompt when isDirty returns false", () => {
    renderHook(() => useBeforeUnloadDirty(() => false));
    const event = fireBeforeUnload();
    expect(event.preventDefault).not.toHaveBeenCalled();
    // Modern browsers gate the confirm dialog on a non-empty
    // returnValue assignment; if we leave the user's initial sentinel
    // in place that is also acceptable, but our handler must not
    // overwrite it on a clean form.
    expect(event.returnValue).toBe("initial");
  });

  it("prompts when isDirty returns true (preventDefault + returnValue)", () => {
    renderHook(() => useBeforeUnloadDirty(() => true));
    const event = fireBeforeUnload();
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    // Assignment is what arms the dialog on legacy Chromium/Safari.
    // The string content itself is ignored by modern browsers — the
    // assignment side-effect is the contract.
    expect(event.returnValue).toBe("");
  });

  it("re-evaluates isDirty at unload time, not registration time", () => {
    // The funnel's dirty state can change between mount and unload —
    // the handler must call the latest getter rather than capturing
    // the boolean from the first render.
    let dirty = false;
    renderHook(() => useBeforeUnloadDirty(() => dirty));
    let event = fireBeforeUnload();
    expect(event.preventDefault).not.toHaveBeenCalled();

    dirty = true;
    event = fireBeforeUnload();
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
  });
});
