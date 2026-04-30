import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { renderWithQuery as render } from "@/test/helpers";

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
const mockFetchColumnStats = vi.fn().mockResolvedValue({
  name: "age",
  dtype: "int64",
  unique_count: 10,
  total_count: 100,
  null_count: 0,
  value_counts: [
    { value: "25", count: 30 },
    { value: "30", count: 20 },
  ],
});

vi.mock("@/api/workspace", () => ({
  fetchColumns: (...args: unknown[]) => mockFetchColumns(...args),
  fetchPreview: (...args: unknown[]) => mockFetchPreview(...args),
  fetchConfig: (...args: unknown[]) => mockFetchConfig(...args),
  fetchConfigDefaults: (...args: unknown[]) => mockFetchConfigDefaults(...args),
  loadDataFromPath: (...args: unknown[]) => mockLoadDataFromPath(...args),
  uploadData: (...args: unknown[]) => mockUploadData(...args),
  updateConfig: (...args: unknown[]) => mockUpdateConfig(...args),
  fetchColumnStats: (...args: unknown[]) => mockFetchColumnStats(...args),
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
      expect(screen.getByText("100 rows × 5 columns")).toBeInTheDocument();
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

  it("calls loadDataFromPath when Enter is pressed in path input", async () => {
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
    await userEvent.type(input, "/data.csv{Enter}");

    await waitFor(() => {
      expect(mockLoadDataFromPath).toHaveBeenCalledWith("/data.csv");
    });
  });

  it("does not call loadDataFromPath when path is empty whitespace", async () => {
    render(<DataPanel onDataChanged={vi.fn()} />);
    await userEvent.click(screen.getByText("Path"));
    const input = screen.getByPlaceholderText("/path/to/data.csv");
    await userEvent.type(input, "   {Enter}");

    expect(mockLoadDataFromPath).not.toHaveBeenCalled();
  });

  it("shows error toast when upload fails", async () => {
    mockUploadData.mockRejectedValue(new Error("Network error"));
    const { toast } = await import("sonner");

    render(<DataPanel onDataChanged={vi.fn()} />);
    const fileInput = document.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;
    const file = new File(["a,b\n1,2"], "test.csv", { type: "text/csv" });
    fireEvent.change(fileInput, { target: { files: [file] } });

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("Upload failed: Network error");
    });
  });

  it("does not upload when no file is selected", async () => {
    render(<DataPanel onDataChanged={vi.fn()} />);
    const fileInput = document.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;
    fireEvent.change(fileInput, { target: { files: [] } });

    expect(mockUploadData).not.toHaveBeenCalled();
  });

  it("calls onDataChanged after successful upload", async () => {
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
      expect(onDataChanged).toHaveBeenCalled();
    });
  });

  it("calls onTaskChanged with null after data load resets target", async () => {
    mockLoadDataFromPath.mockResolvedValue({
      data_ref: { shape: [10, 2], path: "/data.csv" },
    });
    mockFetchPreview.mockResolvedValue({ columns: [], data: [] });
    mockFetchColumns.mockResolvedValue({
      columns: [],
      suggested_task: null,
      target: null,
    });

    const onTaskChanged = vi.fn();
    render(<DataPanel onDataChanged={vi.fn()} onTaskChanged={onTaskChanged} />);
    await userEvent.click(screen.getByText("Path"));
    const input = screen.getByPlaceholderText("/path/to/data.csv");
    await userEvent.type(input, "/data.csv");
    await userEvent.click(screen.getByText("Load"));

    await waitFor(() => {
      expect(onTaskChanged).toHaveBeenCalledWith(null);
    });
  });

  it("renders loading skeleton while data is loading", async () => {
    // Make the load hang
    mockLoadDataFromPath.mockReturnValue(new Promise(() => {}));

    render(<DataPanel onDataChanged={vi.fn()} />);
    await userEvent.click(screen.getByText("Path"));
    const input = screen.getByPlaceholderText("/path/to/data.csv");
    await userEvent.type(input, "/data.csv");
    await userEvent.click(screen.getByText("Load"));

    // Loading state should show skeleton
    await waitFor(() => {
      // The load button should be disabled while loading
      expect(screen.getByText("Load")).toBeDisabled();
    });
  });

  it("shows success toast after loading data via path", async () => {
    mockLoadDataFromPath.mockResolvedValue({
      data_ref: { shape: [100, 5], path: "/data.csv" },
    });
    mockFetchPreview.mockResolvedValue({ columns: [], data: [] });
    mockFetchColumns.mockResolvedValue({
      columns: [],
      suggested_task: null,
      target: null,
    });
    const { toast } = await import("sonner");

    render(<DataPanel onDataChanged={vi.fn()} />);
    await userEvent.click(screen.getByText("Path"));
    const input = screen.getByPlaceholderText("/path/to/data.csv");
    await userEvent.type(input, "/data.csv");
    await userEvent.click(screen.getByText("Load"));

    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith(
        "Data loaded: 100 rows x 5 columns",
      );
    });
  });

  it("shows success toast after file upload", async () => {
    mockUploadData.mockResolvedValue({
      data_ref: { shape: [50, 3], path: "/uploaded.csv" },
    });
    mockFetchPreview.mockResolvedValue({ columns: [], data: [] });
    mockFetchColumns.mockResolvedValue({
      columns: [],
      suggested_task: null,
      target: null,
    });
    const { toast } = await import("sonner");

    render(<DataPanel onDataChanged={vi.fn()} />);
    const fileInput = document.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;
    const file = new File(["a,b\n1,2"], "test.csv", { type: "text/csv" });
    fireEvent.change(fileInput, { target: { files: [file] } });

    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith("Uploaded: test.csv");
    });
  });

  // Note: Radix Select interactions don't work reliably in headless DOM
  // environments, so we skip tests that require Select option clicking.

  // Column grid rendering requires a complex async chain (load → fetchColumns
  // → fetchConfigDefaults → updateConfig) that is unreliable in headless DOM.
  // These paths are covered by E2E visual regression tests instead.
  // Tracked under Issue #304 — restore as a passing component test or delete
  // and lean on the E2E coverage explicitly.
  it.skip("renders column settings grid when data is loaded with target", async () => {
    mockLoadDataFromPath.mockResolvedValue({
      data_ref: { shape: [100, 5], path: "/data.csv" },
    });
    mockFetchColumns.mockResolvedValue({
      columns: [
        {
          name: "age",
          dtype: "int64",
          unique_count: 50,
          suggested_type: "numeric",
          suggested_excluded: false,
          exclude_reason: null,
        },
        {
          name: "gender",
          dtype: "object",
          unique_count: 2,
          suggested_type: "categorical",
          suggested_excluded: false,
          exclude_reason: null,
        },
        {
          name: "id_col",
          dtype: "int64",
          unique_count: 100,
          suggested_type: "numeric",
          suggested_excluded: true,
          exclude_reason: "id",
        },
        {
          name: "target",
          dtype: "int64",
          unique_count: 2,
          suggested_type: "numeric",
          suggested_excluded: false,
          exclude_reason: null,
        },
      ],
      suggested_task: "binary",
      target: "target",
    });
    mockFetchPreview.mockResolvedValue({
      columns: ["age", "gender", "id_col", "target"],
      data: [],
    });
    mockFetchConfigDefaults.mockResolvedValue({
      task: "binary",
      data: { target: "target" },
    });
    mockUpdateConfig.mockResolvedValue({});

    const user = userEvent.setup();
    render(<DataPanel onDataChanged={vi.fn()} onTaskChanged={vi.fn()} />);

    // Switch to Path mode and load data
    await user.click(screen.getByText("Path"));
    const input = screen.getByPlaceholderText("/path/to/data.csv");
    await user.type(input, "/data.csv");
    await user.click(screen.getByRole("button", { name: "Load" }));

    // Wait for columns to render
    await waitFor(() => {
      expect(screen.getByText("age")).toBeInTheDocument();
    });

    // Column grid headers should be visible
    expect(screen.getByText("Name")).toBeInTheDocument();
    expect(screen.getByText("Unique")).toBeInTheDocument();
    expect(screen.getByText("Exclude")).toBeInTheDocument();
    expect(screen.getByText("Type")).toBeInTheDocument();

    // Columns should be displayed (excluding target)
    expect(screen.getByText("age")).toBeInTheDocument();
    expect(screen.getByText("gender")).toBeInTheDocument();
    expect(screen.getByText("id_col")).toBeInTheDocument();

    // ID badge should appear
    expect(screen.getByText("ID")).toBeInTheDocument();

    // Type toggle buttons (Num/Cat) should be present
    const numButtons = screen.getAllByRole("button", { name: "Num" });
    const catButtons = screen.getAllByRole("button", { name: "Cat" });
    expect(numButtons.length).toBeGreaterThan(0);
    expect(catButtons.length).toBeGreaterThan(0);
  });

  // Tracked under Issue #304 — same async-chain reliability problem
  // as the column-grid test above; covered by E2E visual regression
  // until restored or removed.
  it.skip("shows summary stats after data is loaded", async () => {
    mockLoadDataFromPath.mockResolvedValue({
      data_ref: { shape: [100, 4], path: "/data.csv" },
    });
    mockFetchColumns.mockResolvedValue({
      columns: [
        {
          name: "age",
          dtype: "int64",
          unique_count: 50,
          suggested_type: "numeric",
          suggested_excluded: false,
          exclude_reason: null,
        },
        {
          name: "gender",
          dtype: "object",
          unique_count: 2,
          suggested_type: "categorical",
          suggested_excluded: false,
          exclude_reason: null,
        },
        {
          name: "target",
          dtype: "int64",
          unique_count: 2,
          suggested_type: "numeric",
          suggested_excluded: false,
          exclude_reason: null,
        },
      ],
      suggested_task: "binary",
      target: "target",
    });
    mockFetchPreview.mockResolvedValue({ columns: [], data: [] });
    mockFetchConfigDefaults.mockResolvedValue({
      task: "binary",
      data: { target: "target" },
    });
    mockUpdateConfig.mockResolvedValue({});

    const user = userEvent.setup();
    render(<DataPanel onDataChanged={vi.fn()} onTaskChanged={vi.fn()} />);

    await user.click(screen.getByText("Path"));
    const input = screen.getByPlaceholderText("/path/to/data.csv");
    await user.type(input, "/data.csv");
    await user.click(screen.getByRole("button", { name: "Load" }));

    // Summary should show numeric/categorical counts
    await waitFor(() => {
      expect(screen.getByText(/numeric/i)).toBeInTheDocument();
    });
  });
});

// ---------------------------------------------------------------------------
// Extended coverage suite — handleTargetChange, handleColumnExpand,
// syncConfig abort, Feature Summary, column type/exclude toggles
// ---------------------------------------------------------------------------

// Polyfill Radix UI pointer events that headless DOM does not implement
beforeAll(() => {
  window.HTMLElement.prototype.hasPointerCapture = vi
    .fn()
    .mockReturnValue(false);
  window.HTMLElement.prototype.setPointerCapture = vi.fn();
  window.HTMLElement.prototype.releasePointerCapture = vi.fn();
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
});

/** Shared column fixture used across extended tests */
const COLUMNS_BINARY = [
  {
    name: "age",
    dtype: "int64",
    unique_count: 50,
    suggested_type: "numeric" as const,
    suggested_excluded: false,
    exclude_reason: null,
  },
  {
    name: "gender",
    dtype: "object",
    unique_count: 2,
    suggested_type: "categorical" as const,
    suggested_excluded: false,
    exclude_reason: null,
  },
  {
    name: "id_col",
    dtype: "int64",
    unique_count: 100,
    suggested_type: "numeric" as const,
    suggested_excluded: true,
    exclude_reason: "id" as const,
  },
  {
    name: "target",
    dtype: "int64",
    unique_count: 2,
    suggested_type: "numeric" as const,
    suggested_excluded: false,
    exclude_reason: null,
  },
];

/** Helper: load data via path and wait for shape to appear */
async function loadDataViaPath(path = "/data.csv", columns = COLUMNS_BINARY) {
  mockLoadDataFromPath.mockResolvedValue({
    data_ref: { shape: [100, columns.length], path },
  });
  mockFetchPreview.mockResolvedValue({ columns: [], data: [] });
  mockFetchColumns.mockResolvedValue({
    columns,
    suggested_task: null,
    target: null,
  });

  await userEvent.click(screen.getByText("Path"));
  const input = screen.getByPlaceholderText("/path/to/data.csv");
  await userEvent.type(input, path);
  await userEvent.click(screen.getByText("Load"));

  await waitFor(() => {
    expect(
      screen.getByText(`100 rows × ${columns.length} columns`),
    ).toBeInTheDocument();
  });
}

/** Helper: select a target column via the Radix Select */
async function selectTarget(targetName: string) {
  const trigger = screen.getByRole("combobox");
  await userEvent.click(trigger);
  await waitFor(() => {
    // Options appear in a portal — find by text inside the open listbox
    expect(screen.getAllByText(targetName).length).toBeGreaterThan(0);
  });
  const options = screen.getAllByText(targetName);
  // Click the last occurrence (the one inside the dropdown portal)
  await userEvent.click(options[options.length - 1]);
}

describe("DataPanel — handleTargetChange", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("calls fetchColumns with the selected target name", async () => {
    mockFetchConfig.mockResolvedValue({
      task: null,
      data: {},
      features: {},
      training: {},
    });
    mockFetchConfigDefaults.mockResolvedValue({});
    mockUpdateConfig.mockResolvedValue({ config: {}, errors: [] });

    render(<DataPanel onDataChanged={vi.fn()} onTaskChanged={vi.fn()} />);
    await loadDataViaPath();

    // Reset call count so we only track post-load calls
    mockFetchColumns.mockClear();
    mockFetchColumns.mockResolvedValue({
      columns: COLUMNS_BINARY,
      suggested_task: "binary",
      target: "target",
    });
    mockFetchConfigDefaults.mockResolvedValue({
      task: "binary",
      data: {},
      features: {},
      split: {},
    });

    await selectTarget("target");

    await waitFor(() => {
      expect(mockFetchColumns).toHaveBeenCalledWith("target");
    });
  });

  it("auto-detects task type from suggested_task and calls onTaskChanged", async () => {
    mockFetchConfig.mockResolvedValue({
      task: null,
      data: {},
      features: {},
      training: {},
    });
    mockFetchConfigDefaults.mockResolvedValue({
      task: "binary",
      data: {},
      features: {},
      split: {},
    });
    mockUpdateConfig.mockResolvedValue({ config: {}, errors: [] });

    const onTaskChanged = vi.fn();
    render(<DataPanel onDataChanged={vi.fn()} onTaskChanged={onTaskChanged} />);
    await loadDataViaPath();

    mockFetchColumns.mockClear();
    mockFetchColumns.mockResolvedValue({
      columns: COLUMNS_BINARY,
      suggested_task: "binary",
      target: "target",
    });

    await selectTarget("target");

    await waitFor(() => {
      expect(onTaskChanged).toHaveBeenCalledWith("binary");
    });
  });

  it("calls fetchConfigDefaults when task is detected and calls updateConfig", async () => {
    mockFetchConfig.mockResolvedValue({
      task: null,
      data: {},
      features: {},
      training: {},
    });
    mockFetchConfigDefaults.mockResolvedValue({
      task: "binary",
      data: {},
      features: {},
      split: {},
    });
    mockUpdateConfig.mockResolvedValue({ config: {}, errors: [] });

    render(<DataPanel onDataChanged={vi.fn()} />);
    await loadDataViaPath();

    mockFetchColumns.mockClear();
    mockFetchColumns.mockResolvedValue({
      columns: COLUMNS_BINARY,
      suggested_task: "binary",
      target: "target",
    });

    await selectTarget("target");

    await waitFor(() => {
      expect(mockFetchConfigDefaults).toHaveBeenCalledWith("binary", "target");
    });
    await waitFor(() => {
      expect(mockUpdateConfig).toHaveBeenCalled();
    });
  });

  it("sets column overrides from suggested_excluded and suggested_type", async () => {
    mockFetchConfig.mockResolvedValue({
      task: null,
      data: {},
      features: {},
      training: {},
    });
    mockFetchConfigDefaults.mockResolvedValue({
      task: "binary",
      data: {},
      features: {},
      split: {},
    });
    mockUpdateConfig.mockResolvedValue({ config: {}, errors: [] });

    render(<DataPanel onDataChanged={vi.fn()} />);
    await loadDataViaPath();

    mockFetchColumns.mockClear();
    mockFetchColumns.mockResolvedValue({
      columns: COLUMNS_BINARY,
      suggested_task: "binary",
      target: "target",
    });

    await selectTarget("target");

    // Column settings grid should appear with the non-target columns
    await waitFor(() => {
      expect(screen.getByTestId("column-row-age")).toBeInTheDocument();
    });
    expect(screen.getByTestId("column-row-gender")).toBeInTheDocument();
    expect(screen.getByTestId("column-row-id_col")).toBeInTheDocument();
  });

  it("shows ID badge for id-excluded columns", async () => {
    mockFetchConfig.mockResolvedValue({
      task: null,
      data: {},
      features: {},
      training: {},
    });
    mockFetchConfigDefaults.mockResolvedValue({
      task: "binary",
      data: {},
      features: {},
      split: {},
    });
    mockUpdateConfig.mockResolvedValue({ config: {}, errors: [] });

    render(<DataPanel onDataChanged={vi.fn()} />);
    await loadDataViaPath();

    mockFetchColumns.mockClear();
    mockFetchColumns.mockResolvedValue({
      columns: COLUMNS_BINARY,
      suggested_task: "binary",
      target: "target",
    });

    await selectTarget("target");

    await waitFor(() => {
      expect(screen.getByText("ID")).toBeInTheDocument();
    });
  });

  it("shows error toast when fetchColumns fails during target change", async () => {
    mockFetchConfig.mockResolvedValue({});
    const { toast } = await import("sonner");

    render(<DataPanel onDataChanged={vi.fn()} />);
    await loadDataViaPath();

    mockFetchColumns.mockClear();
    mockFetchColumns.mockRejectedValue(new Error("columns API down"));

    await selectTarget("target");

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(
        expect.stringContaining("Column detection failed"),
      );
    });
  });

  // Regression for H-0063: data load + target select caused a race between
  // syncConfig (fired by useEffect on target change) and handleTargetChange's
  // fetchConfigDefaults flow. The earlier syncConfig PUT shipped a partial
  // config (fetchConfig returned {}) and the backend responded with
  // "config_version: Field required" etc. After the fix, updateConfig must be
  // called exactly once per target selection and the payload must come from
  // fetchConfigDefaults (i.e. contain config_version).
  it("does not emit a partial updateConfig PUT during target selection", async () => {
    mockFetchConfig.mockResolvedValue({});
    mockFetchConfigDefaults.mockResolvedValue({
      config_version: 1,
      task: "binary",
      data: { target: "target" },
      features: {},
      split: { method: "kfold", n_splits: 5 },
      model: { name: "lgbm", params: {} },
      training: {},
    });
    mockUpdateConfig.mockResolvedValue({
      config: {},
      errors: [],
      saved: true,
    });

    render(<DataPanel onDataChanged={vi.fn()} />);
    await loadDataViaPath();

    mockFetchColumns.mockClear();
    mockFetchColumns.mockResolvedValue({
      columns: COLUMNS_BINARY,
      suggested_task: "binary",
      target: "target",
    });
    mockUpdateConfig.mockClear();

    await selectTarget("target");

    await waitFor(() => {
      expect(mockFetchConfigDefaults).toHaveBeenCalledWith("binary", "target");
    });
    await waitFor(() => {
      expect(mockUpdateConfig).toHaveBeenCalled();
    });

    // No partial PUT: every updateConfig call during target selection must
    // carry config_version (i.e. be based on fetchConfigDefaults output).
    for (const call of mockUpdateConfig.mock.calls) {
      const payload = call[0] as Record<string, unknown>;
      expect(payload.config_version).toBe(1);
    }
  });

  it("does not call fetchConfigDefaults when suggested_task is null", async () => {
    mockFetchConfig.mockResolvedValue({});
    mockFetchConfigDefaults.mockResolvedValue({});
    mockUpdateConfig.mockResolvedValue({ config: {}, errors: [] });

    render(<DataPanel onDataChanged={vi.fn()} />);
    await loadDataViaPath();

    mockFetchColumns.mockClear();
    mockFetchConfigDefaults.mockClear();
    mockFetchColumns.mockResolvedValue({
      columns: COLUMNS_BINARY,
      suggested_task: null,
      target: "target",
    });

    await selectTarget("target");

    await waitFor(() => {
      expect(mockFetchColumns).toHaveBeenCalledWith("target");
    });
    // Without a detected task, fetchConfigDefaults must not be called
    expect(mockFetchConfigDefaults).not.toHaveBeenCalled();
  });
});

describe("DataPanel — Feature Summary", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("shows Feature Summary with correct numeric/categorical counts", async () => {
    mockFetchConfig.mockResolvedValue({
      task: null,
      data: {},
      features: {},
      training: {},
    });
    mockFetchConfigDefaults.mockResolvedValue({
      task: "binary",
      data: {},
      features: {},
      split: {},
    });
    mockUpdateConfig.mockResolvedValue({ config: {}, errors: [] });

    render(<DataPanel onDataChanged={vi.fn()} />);
    await loadDataViaPath();

    mockFetchColumns.mockClear();
    mockFetchColumns.mockResolvedValue({
      columns: COLUMNS_BINARY,
      suggested_task: "binary",
      target: "target",
    });

    await selectTarget("target");

    // Summary: age=numeric(1), gender=categorical(1), id_col=excluded
    await waitFor(() => {
      expect(
        screen.getByText(/Numeric: 1, Categorical: 1/),
      ).toBeInTheDocument();
    });
  });

  it("shows excluded count breakdown (ID/Const/Manual) in Feature Summary", async () => {
    mockFetchConfig.mockResolvedValue({
      task: null,
      data: {},
      features: {},
      training: {},
    });
    mockFetchConfigDefaults.mockResolvedValue({
      task: "binary",
      data: {},
      features: {},
      split: {},
    });
    mockUpdateConfig.mockResolvedValue({ config: {}, errors: [] });

    render(<DataPanel onDataChanged={vi.fn()} />);
    await loadDataViaPath();

    mockFetchColumns.mockClear();
    mockFetchColumns.mockResolvedValue({
      columns: COLUMNS_BINARY,
      suggested_task: "binary",
      target: "target",
    });

    await selectTarget("target");

    await waitFor(() => {
      // id_col is excluded with reason "id", so ID: 1
      expect(screen.getByText(/ID: 1/)).toBeInTheDocument();
    });
  });

  it("does not show Feature Summary before target is selected", () => {
    render(<DataPanel onDataChanged={vi.fn()} />);
    expect(screen.queryByText(/Features:/)).not.toBeInTheDocument();
  });
});

describe("DataPanel — handleColumnExpand (column statistics)", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  async function renderWithColumns() {
    mockFetchConfig.mockResolvedValue({
      task: null,
      data: {},
      features: {},
      training: {},
    });
    mockFetchConfigDefaults.mockResolvedValue({
      task: "binary",
      data: {},
      features: {},
      split: {},
    });
    mockUpdateConfig.mockResolvedValue({ config: {}, errors: [] });

    render(<DataPanel onDataChanged={vi.fn()} />);
    await loadDataViaPath();

    mockFetchColumns.mockClear();
    mockFetchColumns.mockResolvedValue({
      columns: COLUMNS_BINARY,
      suggested_task: "binary",
      target: "target",
    });

    await selectTarget("target");

    await waitFor(() => {
      expect(screen.getByTestId("column-row-age")).toBeInTheDocument();
    });
  }

  it("fetches column stats when a column row is expanded", async () => {
    mockFetchColumnStats.mockResolvedValue({
      name: "age",
      dtype: "int64",
      unique_count: 50,
      total_count: 100,
      null_count: 0,
      value_counts: [{ value: "25", count: 30 }],
    });

    await renderWithColumns();

    await userEvent.click(screen.getByTestId("column-row-age"));

    await waitFor(() => {
      expect(mockFetchColumnStats).toHaveBeenCalledWith("age");
    });
  });

  it("shows distribution stats after column is expanded", async () => {
    mockFetchColumnStats.mockResolvedValue({
      name: "age",
      dtype: "int64",
      unique_count: 50,
      total_count: 100,
      null_count: 2,
      value_counts: [{ value: "25", count: 30 }],
    });

    await renderWithColumns();

    await userEvent.click(screen.getByTestId("column-row-age"));

    await waitFor(() => {
      expect(screen.getByTestId("column-dist-age")).toBeInTheDocument();
    });
    expect(screen.getByText(/50 unique, 2 null/)).toBeInTheDocument();
  });

  it("collapses a column when clicked a second time", async () => {
    mockFetchColumnStats.mockResolvedValue({
      name: "age",
      dtype: "int64",
      unique_count: 50,
      total_count: 100,
      null_count: 0,
      value_counts: [],
    });

    await renderWithColumns();

    // Expand
    await userEvent.click(screen.getByTestId("column-row-age"));
    await waitFor(() => {
      expect(screen.getByTestId("column-dist-age")).toBeInTheDocument();
    });

    // Collapse
    await userEvent.click(screen.getByTestId("column-row-age"));
    await waitFor(() => {
      expect(screen.queryByTestId("column-dist-age")).not.toBeInTheDocument();
    });
  });

  it("does not re-fetch stats when already loaded for the same column", async () => {
    mockFetchColumnStats.mockResolvedValue({
      name: "age",
      dtype: "int64",
      unique_count: 50,
      total_count: 100,
      null_count: 0,
      value_counts: [],
    });

    await renderWithColumns();

    // Expand then collapse then expand again
    await userEvent.click(screen.getByTestId("column-row-age"));
    await waitFor(() => {
      expect(mockFetchColumnStats).toHaveBeenCalledTimes(1);
    });

    await userEvent.click(screen.getByTestId("column-row-age")); // collapse
    await userEvent.click(screen.getByTestId("column-row-age")); // re-expand

    // Stats should still only have been fetched once
    expect(mockFetchColumnStats).toHaveBeenCalledTimes(1);
  });

  it("surfaces fetchColumnStats errors via toast (HIGH-1)", async () => {
    // Before the fix, fetchColumnStats failures were silently dropped
    // and users only saw "the bar never renders" with no explanation.
    // The contract now is: a toast is shown so the failure is visible,
    // and the distribution bar remains hidden so UI state is still
    // consistent with the missing stats.
    mockFetchColumnStats.mockRejectedValue(new Error("stats API down"));
    const { toast } = await import("sonner");

    await renderWithColumns();

    await userEvent.click(screen.getByTestId("column-row-age"));

    await waitFor(() => {
      expect(mockFetchColumnStats).toHaveBeenCalled();
    });

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(
        expect.stringContaining("Failed to load column stats"),
      );
    });
    expect(screen.queryByTestId("column-dist-age")).not.toBeInTheDocument();
  });
});

describe("DataPanel — column type and exclude toggles", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  async function renderWithColumnsAndTarget() {
    mockFetchConfig.mockResolvedValue({
      task: null,
      data: {},
      features: {},
      training: {},
    });
    mockFetchConfigDefaults.mockResolvedValue({
      task: "binary",
      data: {},
      features: {},
      split: {},
    });
    mockUpdateConfig.mockResolvedValue({ config: {}, errors: [] });

    render(<DataPanel onDataChanged={vi.fn()} />);
    await loadDataViaPath();

    mockFetchColumns.mockClear();
    mockFetchColumns.mockResolvedValue({
      columns: COLUMNS_BINARY,
      suggested_task: "binary",
      target: "target",
    });

    await selectTarget("target");

    await waitFor(() => {
      expect(screen.getByTestId("column-row-age")).toBeInTheDocument();
    });
  }

  it("column filter hides non-matching columns", async () => {
    await renderWithColumnsAndTarget();

    const searchInput = screen.getByTestId("column-search");
    await userEvent.type(searchInput, "gen");

    await waitFor(() => {
      expect(screen.getByText("gender")).toBeInTheDocument();
      expect(screen.queryByTestId("column-row-age")).not.toBeInTheDocument();
    });
  });

  it("clears column filter shows all columns again", async () => {
    await renderWithColumnsAndTarget();

    const searchInput = screen.getByTestId("column-search");
    await userEvent.type(searchInput, "gen");

    await waitFor(() => {
      expect(screen.queryByTestId("column-row-age")).not.toBeInTheDocument();
    });

    await userEvent.clear(searchInput);

    await waitFor(() => {
      expect(screen.getByTestId("column-row-age")).toBeInTheDocument();
      expect(screen.getByTestId("column-row-gender")).toBeInTheDocument();
    });
  });

  it("Cat type button sets column to categorical when clicked", async () => {
    await renderWithColumnsAndTarget();

    // age is suggested as numeric; click Cat button inside age row
    const ageRow = screen.getByTestId("column-row-age");
    const catButtons = ageRow.querySelectorAll("button");
    // The Cat button is the second button in the type toggle group
    const catButton = Array.from(catButtons).find(
      (b) => b.textContent === "Cat",
    );
    expect(catButton).toBeTruthy();
    await userEvent.click(catButton!);

    // After clicking Cat, syncConfig runs and updateConfig is called
    await waitFor(() => {
      expect(mockUpdateConfig).toHaveBeenCalled();
    });
  });

  it("Num type button sets column to numeric when clicked", async () => {
    await renderWithColumnsAndTarget();

    // gender is categorical; click Num button to change it
    const genderRow = screen.getByTestId("column-row-gender");
    const numButton = Array.from(genderRow.querySelectorAll("button")).find(
      (b) => b.textContent === "Num",
    );
    expect(numButton).toBeTruthy();
    await userEvent.click(numButton!);

    await waitFor(() => {
      expect(mockUpdateConfig).toHaveBeenCalled();
    });
  });
});

describe("DataPanel — syncConfig AbortController", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  // Issue #107: after handleTargetChange completes, useDataPanel now
  // pre-seeds prevSyncKey with the post-change state so the
  // target/task/overrides/cv effect does not re-fire syncConfig for an
  // identical body. These tests therefore trigger syncConfig via a
  // subsequent column exclude toggle (which legitimately changes
  // overrides) instead of the target selection itself.

  it("does not call onDataChanged when request is aborted mid-flight", async () => {
    // handleTargetChange's inlined updateConfig should succeed so we reach
    // the post-target state where the column grid is mounted. The slow
    // fetchConfig mock governs the *follow-up* syncConfig triggered by
    // toggling a column exclude.
    mockFetchConfigDefaults.mockResolvedValue({
      task: "binary",
      data: {},
      features: {},
      split: {},
    });
    mockUpdateConfig.mockResolvedValue({ config: {}, errors: [] });
    mockFetchColumns.mockResolvedValue({
      columns: COLUMNS_BINARY,
      suggested_task: "binary",
      target: "target",
    });

    const onDataChanged = vi.fn();
    render(<DataPanel onDataChanged={onDataChanged} />);
    await loadDataViaPath();

    await selectTarget("target");

    // Let handleTargetChange complete and the column grid render.
    await waitFor(() => {
      expect(screen.getByTestId("column-row-age")).toBeInTheDocument();
    });

    // Now arm fetchConfig as a slow, abortable request that will govern
    // the follow-up syncConfig triggered by the exclude toggle below.
    let rejectFn!: (reason: unknown) => void;
    mockFetchConfig.mockImplementation(
      ({ signal }: { signal?: AbortSignal } = {}) =>
        new Promise((_, reject) => {
          rejectFn = reject;
          signal?.addEventListener("abort", () => {
            reject(new DOMException("Aborted", "AbortError"));
          });
        }),
    );
    const callsBeforeToggle = onDataChanged.mock.calls.length;

    // Toggle an exclude checkbox — this changes overrides, which the
    // target/task/overrides/cv effect observes and dispatches syncConfig.
    const ageRow = screen.getByTestId("column-row-age");
    const checkbox = ageRow.querySelector('[role="checkbox"]') as HTMLElement;
    await userEvent.click(checkbox);

    // Wait for syncConfig to start
    await waitFor(() => {
      expect(mockFetchConfig).toHaveBeenCalled();
    });

    // Abort the in-flight request
    rejectFn(new DOMException("Aborted", "AbortError"));

    // onDataChanged should not be called from the aborted sync.
    await new Promise((r) => setTimeout(r, 50));
    expect(onDataChanged.mock.calls.length).toBe(callsBeforeToggle);
  });

  it("shows error toast when syncConfig encounters a non-abort error", async () => {
    // Same rationale: trigger syncConfig via a column exclude toggle so
    // the post-Issue-#107 prevSyncKey pre-seed does not prevent it.
    mockFetchConfigDefaults.mockResolvedValue({
      task: "binary",
      data: {},
      features: {},
      split: {},
    });
    mockUpdateConfig.mockResolvedValue({ config: {}, errors: [] });
    mockFetchColumns.mockResolvedValue({
      columns: COLUMNS_BINARY,
      suggested_task: "binary",
      target: "target",
    });
    const { toast } = await import("sonner");

    render(<DataPanel onDataChanged={vi.fn()} />);
    await loadDataViaPath();

    await selectTarget("target");

    await waitFor(() => {
      expect(screen.getByTestId("column-row-age")).toBeInTheDocument();
    });

    // Now arm fetchConfig to reject with a non-abort error for the
    // follow-up syncConfig.
    mockFetchConfig.mockRejectedValue(new Error("network error"));

    const ageRow = screen.getByTestId("column-row-age");
    const checkbox = ageRow.querySelector('[role="checkbox"]') as HTMLElement;
    await userEvent.click(checkbox);

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(
        "Config sync failed — changes may not be saved",
      );
    });
  });
});

describe("DataPanel — handleUpload additional paths", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("shows shape from upload response after successful upload", async () => {
    mockUploadData.mockResolvedValue({
      data_ref: { shape: [200, 8], path: "/uploads/train.csv" },
    });
    mockFetchPreview.mockResolvedValue({ columns: [], data: [] });
    mockFetchColumns.mockResolvedValue({
      columns: [],
      suggested_task: null,
      target: null,
    });

    render(<DataPanel onDataChanged={vi.fn()} />);
    const fileInput = document.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;
    const file = new File(["a,b\n1,2"], "train.csv", { type: "text/csv" });
    fireEvent.change(fileInput, { target: { files: [file] } });

    await waitFor(() => {
      expect(screen.getByText("200 rows × 8 columns")).toBeInTheDocument();
    });
  });

  it("calls onTaskChanged with null after successful upload", async () => {
    mockUploadData.mockResolvedValue({
      data_ref: { shape: [50, 3], path: "/uploaded.csv" },
    });
    mockFetchPreview.mockResolvedValue({ columns: [], data: [] });
    mockFetchColumns.mockResolvedValue({
      columns: [],
      suggested_task: null,
      target: null,
    });

    const onTaskChanged = vi.fn();
    render(<DataPanel onDataChanged={vi.fn()} onTaskChanged={onTaskChanged} />);
    const fileInput = document.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;
    const file = new File(["a,b\n1,2"], "test.csv", { type: "text/csv" });
    fireEvent.change(fileInput, { target: { files: [file] } });

    await waitFor(() => {
      expect(onTaskChanged).toHaveBeenCalledWith(null);
    });
  });
});

describe("DataPanel — handleLoadPathByValue additional paths", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("shows error toast with error message on load failure", async () => {
    mockLoadDataFromPath.mockRejectedValue(new Error("permission denied"));
    const { toast } = await import("sonner");

    render(<DataPanel onDataChanged={vi.fn()} />);
    await userEvent.click(screen.getByText("Path"));
    const input = screen.getByPlaceholderText("/path/to/data.csv");
    await userEvent.type(input, "/secret.csv");
    await userEvent.click(screen.getByText("Load"));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(
        "Failed to load data: permission denied",
      );
    });
  });

  it("resets loading state after failed load", async () => {
    mockLoadDataFromPath.mockRejectedValue(new Error("not found"));

    render(<DataPanel onDataChanged={vi.fn()} />);
    await userEvent.click(screen.getByText("Path"));
    const input = screen.getByPlaceholderText("/path/to/data.csv");
    await userEvent.type(input, "/bad.csv");
    await userEvent.click(screen.getByText("Load"));

    await waitFor(() => {
      // After error, loading finishes so Load button should be re-enabled
      expect(screen.getByText("Load")).not.toBeDisabled();
    });
  });
});

describe("DataPanel — handleTaskChange and handleExcludeToggle", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  async function renderWithTarget() {
    mockFetchConfig.mockResolvedValue({
      task: null,
      data: {},
      features: {},
      training: {},
    });
    mockFetchConfigDefaults.mockResolvedValue({
      task: "binary",
      data: {},
      features: {},
      split: {},
    });
    mockUpdateConfig.mockResolvedValue({ config: {}, errors: [] });

    render(<DataPanel onDataChanged={vi.fn()} onTaskChanged={vi.fn()} />);
    await loadDataViaPath();

    mockFetchColumns.mockClear();
    mockFetchColumns.mockResolvedValue({
      columns: COLUMNS_BINARY,
      suggested_task: "binary",
      target: "target",
    });

    await selectTarget("target");

    await waitFor(() => {
      expect(screen.getByTestId("column-row-age")).toBeInTheDocument();
    });
  }

  it("handleTaskChange calls onTaskChanged with the new task value", async () => {
    const onTaskChanged = vi.fn();
    mockFetchConfig.mockResolvedValue({
      task: null,
      data: {},
      features: {},
      training: {},
    });
    mockFetchConfigDefaults.mockResolvedValue({
      task: "binary",
      data: {},
      features: {},
      split: {},
    });
    mockUpdateConfig.mockResolvedValue({ config: {}, errors: [] });

    render(<DataPanel onDataChanged={vi.fn()} onTaskChanged={onTaskChanged} />);
    await loadDataViaPath();

    mockFetchColumns.mockClear();
    mockFetchColumns.mockResolvedValue({
      columns: COLUMNS_BINARY,
      suggested_task: "binary",
      target: "target",
    });

    await selectTarget("target");

    // After target selection, task is auto-set to "binary".
    // Now click "regression" in the Task SegmentGroup to invoke handleTaskChange
    await waitFor(() => {
      expect(screen.getByText("regression")).toBeInTheDocument();
    });

    onTaskChanged.mockClear();
    await userEvent.click(screen.getByText("regression"));

    await waitFor(() => {
      expect(onTaskChanged).toHaveBeenCalledWith("regression");
    });
  });

  it("handleExcludeToggle updates column excluded state via Checkbox", async () => {
    await renderWithTarget();

    // age is not excluded by default — find its Checkbox and check it
    const ageRow = screen.getByTestId("column-row-age");
    const checkbox = ageRow.querySelector('[role="checkbox"]') as HTMLElement;
    expect(checkbox).toBeTruthy();

    // Click the checkbox (stopPropagation prevents row expand)
    await userEvent.click(checkbox);

    // After toggling, syncConfig should run and updateConfig should be called
    await waitFor(() => {
      expect(mockUpdateConfig).toHaveBeenCalled();
    });
  });
});
