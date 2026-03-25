import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

const mockLoadDataFromPath = vi.fn();
const mockUploadData = vi.fn();
const mockFetchColumns = vi.fn().mockResolvedValue({
  columns: [],
  suggested_task: null,
  target: null,
});
const mockFetchPreview = vi.fn().mockResolvedValue({ columns: [], data: [] });
const mockFetchConfig = vi.fn().mockResolvedValue({});
const mockFetchConfigDefaults = vi.fn().mockResolvedValue({});
const mockUpdateConfig = vi.fn();

vi.mock("@/api/workspace", () => ({
  fetchColumns: (...args: unknown[]) => mockFetchColumns(...args),
  fetchPreview: (...args: unknown[]) => mockFetchPreview(...args),
  fetchConfig: (...args: unknown[]) => mockFetchConfig(...args),
  fetchConfigDefaults: (...args: unknown[]) => mockFetchConfigDefaults(...args),
  loadDataFromPath: (...args: unknown[]) => mockLoadDataFromPath(...args),
  uploadData: (...args: unknown[]) => mockUploadData(...args),
  updateConfig: (...args: unknown[]) => mockUpdateConfig(...args),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("./FileBrowser", () => ({
  FileBrowser: () => <div data-testid="file-browser" />,
}));

import { DataPanel } from "./DataPanel";

describe("DataPanel", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders Data Source accordion section", () => {
    render(<DataPanel onDataChanged={vi.fn()} />);
    expect(screen.getByText("Data Source")).toBeInTheDocument();
  });

  it("renders Target / Task accordion section", () => {
    render(<DataPanel onDataChanged={vi.fn()} />);
    expect(screen.getByText("Target / Task")).toBeInTheDocument();
  });

  it("renders Column Settings accordion section", () => {
    render(<DataPanel onDataChanged={vi.fn()} />);
    expect(screen.getByText("Column Settings")).toBeInTheDocument();
  });

  it("renders Cross Validation accordion section", () => {
    render(<DataPanel onDataChanged={vi.fn()} />);
    expect(screen.getByText("Cross Validation")).toBeInTheDocument();
  });

  it("shows upload/path toggle (SegmentGroup)", () => {
    render(<DataPanel onDataChanged={vi.fn()} />);
    expect(screen.getByText("Path")).toBeInTheDocument();
    expect(screen.getByText("Upload")).toBeInTheDocument();
  });

  it("shows placeholder when no target selected in Column Settings", () => {
    render(<DataPanel onDataChanged={vi.fn()} />);
    expect(
      screen.getByText("Load data and select a target first"),
    ).toBeInTheDocument();
  });

  it("shows upload area by default", () => {
    render(<DataPanel onDataChanged={vi.fn()} />);
    expect(
      screen.getByText("Drop CSV/Parquet or click to upload"),
    ).toBeInTheDocument();
  });

  it("renders path input and Load button when Path source is selected", async () => {
    render(<DataPanel onDataChanged={vi.fn()} />);
    // Click the "Path" segment to switch source type
    await userEvent.click(screen.getByText("Path"));
    expect(
      screen.getByPlaceholderText("/path/to/data.csv"),
    ).toBeInTheDocument();
    expect(screen.getByText("Load")).toBeInTheDocument();
  });

  it("Load button is disabled when path input is empty", async () => {
    render(<DataPanel onDataChanged={vi.fn()} />);
    await userEvent.click(screen.getByText("Path"));
    const loadButton = screen.getByText("Load");
    expect(loadButton).toBeDisabled();
  });

  it("calls loadDataFromPath when Load button is clicked with a path", async () => {
    mockLoadDataFromPath.mockResolvedValue({
      data_ref: { shape: [100, 5], path: "/data.csv" },
    });
    mockFetchPreview.mockResolvedValue({
      columns: ["a", "b"],
      data: [{ a: 1, b: 2 }],
    });
    mockFetchColumns.mockResolvedValue({
      columns: [
        {
          name: "a",
          dtype: "int64",
          unique_count: 10,
          suggested_type: "numeric",
          suggested_excluded: false,
          exclude_reason: null,
        },
        {
          name: "b",
          dtype: "int64",
          unique_count: 5,
          suggested_type: "numeric",
          suggested_excluded: false,
          exclude_reason: null,
        },
      ],
      suggested_task: null,
      target: null,
    });

    const onDataChanged = vi.fn();
    render(<DataPanel onDataChanged={onDataChanged} />);
    await userEvent.click(screen.getByText("Path"));

    const input = screen.getByPlaceholderText("/path/to/data.csv");
    await userEvent.type(input, "/data.csv");

    const loadButton = screen.getByText("Load");
    await userEvent.click(loadButton);

    await waitFor(() => {
      expect(mockLoadDataFromPath).toHaveBeenCalledWith("/data.csv");
    });
  });

  it("shows shape info after data is loaded via path", async () => {
    mockLoadDataFromPath.mockResolvedValue({
      data_ref: { shape: [100, 5], path: "/data.csv" },
    });
    mockFetchPreview.mockResolvedValue({ columns: [], data: [] });
    mockFetchColumns.mockResolvedValue({
      columns: [],
      suggested_task: null,
      target: null,
    });

    render(<DataPanel onDataChanged={vi.fn()} />);
    await userEvent.click(screen.getByText("Path"));

    const input = screen.getByPlaceholderText("/path/to/data.csv");
    await userEvent.type(input, "/data.csv");
    await userEvent.click(screen.getByText("Load"));

    await waitFor(() => {
      expect(screen.getByText("100 rows x 5 columns")).toBeInTheDocument();
    });
  });

  it("shows error toast when loadDataFromPath fails", async () => {
    mockLoadDataFromPath.mockRejectedValue(new Error("File not found"));
    const { toast } = await import("sonner");

    render(<DataPanel onDataChanged={vi.fn()} />);
    await userEvent.click(screen.getByText("Path"));

    const input = screen.getByPlaceholderText("/path/to/data.csv");
    await userEvent.type(input, "/bad.csv");
    await userEvent.click(screen.getByText("Load"));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(
        "Failed to load data: File not found",
      );
    });
  });

  it("calls uploadData when a file is selected", async () => {
    mockUploadData.mockResolvedValue({
      data_ref: { shape: [50, 3], path: "/uploaded.csv" },
    });
    mockFetchPreview.mockResolvedValue({ columns: [], data: [] });
    mockFetchColumns.mockResolvedValue({
      columns: [],
      suggested_task: null,
      target: null,
    });

    const onDataChanged = vi.fn();
    render(<DataPanel onDataChanged={onDataChanged} />);

    const fileInput = document.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;
    const file = new File(["a,b\n1,2"], "test.csv", { type: "text/csv" });

    fireEvent.change(fileInput, { target: { files: [file] } });

    await waitFor(() => {
      expect(mockUploadData).toHaveBeenCalledWith(file);
    });
  });

  it("shows preview table after data is loaded", async () => {
    mockLoadDataFromPath.mockResolvedValue({
      data_ref: { shape: [10, 2], path: "/data.csv" },
    });
    mockFetchPreview.mockResolvedValue({
      columns: ["col_a", "col_b"],
      data: [
        { col_a: 1, col_b: "x" },
        { col_a: 2, col_b: "y" },
      ],
    });
    mockFetchColumns.mockResolvedValue({
      columns: [],
      suggested_task: null,
      target: null,
    });

    render(<DataPanel onDataChanged={vi.fn()} />);
    await userEvent.click(screen.getByText("Path"));
    const input = screen.getByPlaceholderText("/path/to/data.csv");
    await userEvent.type(input, "/data.csv");
    await userEvent.click(screen.getByText("Load"));

    await waitFor(() => {
      expect(screen.getByText("col_a")).toBeInTheDocument();
      expect(screen.getByText("col_b")).toBeInTheDocument();
      expect(screen.getByText("x")).toBeInTheDocument();
      expect(screen.getByText("y")).toBeInTheDocument();
    });
  });

  it("shows auto-detection hint when target is not selected", () => {
    render(<DataPanel onDataChanged={vi.fn()} />);
    expect(
      screen.getByText("Auto-detected after target selection"),
    ).toBeInTheDocument();
  });

  // Note: Radix Select interactions don't work reliably in jsdom,
  // so we skip tests that require Select option clicking.
});
