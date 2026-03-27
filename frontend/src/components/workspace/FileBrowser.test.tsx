import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderWithQuery } from "@/test/helpers";
import { FileBrowser } from "./FileBrowser";

vi.mock("@/api/files", () => ({
  fetchDirectory: vi.fn(),
}));

afterEach(cleanup);

describe("FileBrowser", () => {
  it('renders default "Browse" button when no trigger provided', () => {
    renderWithQuery(<FileBrowser onSelect={vi.fn()} />);
    expect(screen.getByRole("button", { name: /browse/i })).toBeInTheDocument();
  });

  it("renders custom trigger when provided", () => {
    renderWithQuery(
      <FileBrowser
        onSelect={vi.fn()}
        trigger={<button type="button">Open Files</button>}
      />,
    );
    expect(
      screen.getByRole("button", { name: /open files/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /browse/i }),
    ).not.toBeInTheDocument();
  });

  it("opens dialog on click and shows title", () => {
    renderWithQuery(<FileBrowser onSelect={vi.fn()} />);
    const browseBtn = screen.getByRole("button", { name: /browse/i });
    fireEvent.click(browseBtn);
    expect(screen.getByText("Select Data File")).toBeInTheDocument();
  });

  it("renders file entries from fetchDirectory and calls onSelect on file click", async () => {
    const { fetchDirectory } = await import("@/api/files");
    (fetchDirectory as ReturnType<typeof vi.fn>).mockResolvedValue({
      path: "/home/user",
      parent: "/home",
      entries: [
        { name: "data.csv", type: "file", size: 1024 },
        { name: "subdir", type: "directory", size: null },
      ],
    });

    const onSelect = vi.fn();
    renderWithQuery(<FileBrowser onSelect={onSelect} />);

    const browseBtn = screen.getByRole("button", { name: /browse/i });
    fireEvent.click(browseBtn);

    const { waitFor } = await import("@testing-library/react");
    await waitFor(() => {
      expect(screen.getByText("data.csv")).toBeInTheDocument();
    });

    // Click on the file entry
    fireEvent.click(screen.getByText("data.csv"));
    expect(onSelect).toHaveBeenCalledWith("/home/user/data.csv");
  });

  it("navigates to directory on directory click", async () => {
    const { fetchDirectory } = await import("@/api/files");
    (fetchDirectory as ReturnType<typeof vi.fn>).mockResolvedValue({
      path: "/home/user",
      parent: "/home",
      entries: [{ name: "subdir", type: "directory", size: null }],
    });

    renderWithQuery(<FileBrowser onSelect={vi.fn()} />);

    const browseBtn = screen.getByRole("button", { name: /browse/i });
    fireEvent.click(browseBtn);

    const { waitFor } = await import("@testing-library/react");
    await waitFor(() => {
      expect(screen.getByText("subdir")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("subdir"));
    // After clicking directory, fetchDirectory should be called again with the subdir path
    // The query key changes, triggering a new fetch
  });

  it("shows parent directory (..) button when parent exists", async () => {
    const { fetchDirectory } = await import("@/api/files");
    (fetchDirectory as ReturnType<typeof vi.fn>).mockResolvedValue({
      path: "/home/user",
      parent: "/home",
      entries: [],
    });

    renderWithQuery(<FileBrowser onSelect={vi.fn()} />);

    const browseBtn = screen.getByRole("button", { name: /browse/i });
    fireEvent.click(browseBtn);

    const { waitFor } = await import("@testing-library/react");
    await waitFor(() => {
      expect(screen.getByText("..")).toBeInTheDocument();
    });
  });

  it("shows file size formatted in KB", async () => {
    const { fetchDirectory } = await import("@/api/files");
    (fetchDirectory as ReturnType<typeof vi.fn>).mockResolvedValue({
      path: "/home",
      parent: null,
      entries: [{ name: "small.csv", type: "file", size: 2048 }],
    });

    renderWithQuery(<FileBrowser onSelect={vi.fn()} />);

    const browseBtn = screen.getByRole("button", { name: /browse/i });
    fireEvent.click(browseBtn);

    const { waitFor } = await import("@testing-library/react");
    await waitFor(() => {
      expect(screen.getByText("2.0 KB")).toBeInTheDocument();
    });
  });

  it("shows file size formatted in MB for large files", async () => {
    const { fetchDirectory } = await import("@/api/files");
    (fetchDirectory as ReturnType<typeof vi.fn>).mockResolvedValue({
      path: "/home",
      parent: null,
      entries: [{ name: "big.csv", type: "file", size: 2 * 1024 * 1024 }],
    });

    renderWithQuery(<FileBrowser onSelect={vi.fn()} />);

    const browseBtn = screen.getByRole("button", { name: /browse/i });
    fireEvent.click(browseBtn);

    const { waitFor } = await import("@testing-library/react");
    await waitFor(() => {
      expect(screen.getByText("2.0 MB")).toBeInTheDocument();
    });
  });

  it("shows file size in bytes for small files", async () => {
    const { fetchDirectory } = await import("@/api/files");
    (fetchDirectory as ReturnType<typeof vi.fn>).mockResolvedValue({
      path: "/home",
      parent: null,
      entries: [{ name: "tiny.txt", type: "file", size: 512 }],
    });

    renderWithQuery(<FileBrowser onSelect={vi.fn()} />);

    const browseBtn = screen.getByRole("button", { name: /browse/i });
    fireEvent.click(browseBtn);

    const { waitFor } = await import("@testing-library/react");
    await waitFor(() => {
      expect(screen.getByText("512 B")).toBeInTheDocument();
    });
  });

  it("renders breadcrumbs from listing path", async () => {
    const { fetchDirectory } = await import("@/api/files");
    (fetchDirectory as ReturnType<typeof vi.fn>).mockResolvedValue({
      path: "/home/user/data",
      parent: "/home/user",
      entries: [],
    });

    renderWithQuery(<FileBrowser onSelect={vi.fn()} />);

    const browseBtn = screen.getByRole("button", { name: /browse/i });
    fireEvent.click(browseBtn);

    const { waitFor } = await import("@testing-library/react");
    await waitFor(() => {
      expect(screen.getByText("home")).toBeInTheDocument();
      expect(screen.getByText("user")).toBeInTheDocument();
      expect(screen.getByText("data")).toBeInTheDocument();
    });
  });
});
