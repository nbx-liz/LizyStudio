import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useDocumentTitle } from "./useDocumentTitle";

describe("useDocumentTitle", () => {
  afterEach(() => {
    document.title = "";
  });

  it("sets title with suffix when value is non-null", () => {
    renderHook(() => useDocumentTitle("Running..."));
    expect(document.title).toBe("Running... — LizyStudio");
  });

  it("sets default title when value is null", () => {
    renderHook(() => useDocumentTitle(null));
    expect(document.title).toBe("LizyStudio");
  });

  it("restores default title on unmount", () => {
    const { unmount } = renderHook(() => useDocumentTitle("Fitting"));
    expect(document.title).toBe("Fitting — LizyStudio");

    unmount();
    expect(document.title).toBe("LizyStudio");
  });

  it("updates title when value changes", () => {
    const { rerender } = renderHook(
      ({ title }: { title: string | null }) => useDocumentTitle(title),
      { initialProps: { title: "Step 1" } },
    );
    expect(document.title).toBe("Step 1 — LizyStudio");

    rerender({ title: "Step 2" });
    expect(document.title).toBe("Step 2 — LizyStudio");

    rerender({ title: null });
    expect(document.title).toBe("LizyStudio");
  });
});
