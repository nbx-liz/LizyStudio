import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FoldPreview } from "./FoldPreview";

const mockFetchSplitPreview = vi.fn();

vi.mock("@/api/workspace", () => ({
  fetchSplitPreview: (...args: unknown[]) => mockFetchSplitPreview(...args),
}));

const kfoldPreview = {
  strategy: "kfold",
  n_splits: 5,
  folds: [
    { fold: 0, train_size: 800, valid_size: 200 },
    { fold: 1, train_size: 800, valid_size: 200 },
    { fold: 2, train_size: 800, valid_size: 200 },
    { fold: 3, train_size: 800, valid_size: 200 },
    { fold: 4, train_size: 800, valid_size: 200 },
  ],
};

describe("FoldPreview", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders nothing when disabled", () => {
    const { container } = render(
      <FoldPreview enabled={false} cvKey="kfold-5" debounceMs={0} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders fold preview with summary badge and table after fetch", async () => {
    mockFetchSplitPreview.mockResolvedValue(kfoldPreview);
    render(<FoldPreview enabled={true} cvKey="kfold-5" debounceMs={0} />);

    await waitFor(() => {
      expect(screen.getByTestId("fold-preview")).toBeInTheDocument();
    });

    // Summary badge
    expect(screen.getByTestId("fold-summary")).toHaveTextContent(
      "Total: 5 folds (kfold)",
    );

    // Flow diagram
    expect(screen.getByTestId("fold-flow")).toBeInTheDocument();

    // Table rows — 5 folds
    const rows = screen.getAllByRole("row");
    // 1 header row + 5 data rows
    expect(rows).toHaveLength(6);
  });

  it("shows empty message when folds array is empty", async () => {
    mockFetchSplitPreview.mockResolvedValue({
      strategy: "blocked_group_kfold",
      n_splits: 5,
      folds: [],
    });
    render(<FoldPreview enabled={true} cvKey="blocked" debounceMs={0} />);

    await waitFor(() => {
      expect(screen.getByTestId("fold-preview-empty")).toBeInTheDocument();
    });
  });

  it("shows error message on fetch failure", async () => {
    mockFetchSplitPreview.mockRejectedValue(new Error("No config"));
    render(<FoldPreview enabled={true} cvKey="error" debounceMs={0} />);

    await waitFor(() => {
      expect(screen.getByTestId("fold-preview-error")).toHaveTextContent(
        "No config",
      );
    });
  });

  it("debounces fetch by configured delay", async () => {
    mockFetchSplitPreview.mockResolvedValue(kfoldPreview);
    // Use a 100ms debounce to test the delay behaviour with real timers
    render(<FoldPreview enabled={true} cvKey="kfold-5" debounceMs={100} />);

    // Immediately after render, fetch should not have been called yet
    expect(mockFetchSplitPreview).not.toHaveBeenCalled();

    // After the debounce, it should be called
    await waitFor(() => {
      expect(mockFetchSplitPreview).toHaveBeenCalledTimes(1);
    });
  });

  it("refetches when cvKey changes", async () => {
    mockFetchSplitPreview.mockResolvedValue(kfoldPreview);
    const { rerender } = render(
      <FoldPreview enabled={true} cvKey="kfold-5" debounceMs={0} />,
    );

    await waitFor(() => {
      expect(mockFetchSplitPreview).toHaveBeenCalledTimes(1);
    });

    rerender(<FoldPreview enabled={true} cvKey="kfold-10" debounceMs={0} />);

    await waitFor(() => {
      expect(mockFetchSplitPreview).toHaveBeenCalledTimes(2);
    });
  });
});
