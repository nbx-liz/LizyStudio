import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ExportDialog } from "./ExportDialog";

vi.mock("@/api/jobs", () => ({ exportJob: vi.fn() }));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));
vi.mock("@/components/workspace/FileBrowser", () => ({
  FileBrowser: ({
    onSelect,
    trigger,
  }: {
    onSelect: (p: string) => void;
    trigger?: React.ReactNode;
  }) =>
    trigger ? (
      <button type="button" onClick={() => onSelect("/browse/dir")}>
        {trigger}
      </button>
    ) : (
      <button type="button" onClick={() => onSelect("/browse/dir")}>
        Browse
      </button>
    ),
}));

const defaultProps = {
  open: true,
  onOpenChange: vi.fn(),
  jobId: "job-xyz",
  jobNumber: 5,
};

describe("ExportDialog", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('shows dialog title "Export Job #5" when open=true and jobNumber=5', () => {
    render(<ExportDialog {...defaultProps} />);
    expect(screen.getByText("Export Job #5")).toBeInTheDocument();
  });

  it("shows Model and Report format buttons", () => {
    render(<ExportDialog {...defaultProps} />);
    expect(screen.getByRole("button", { name: "Model" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Report" })).toBeInTheDocument();
  });

  it("shows Output Path input with default value", () => {
    render(<ExportDialog {...defaultProps} />);
    const input = screen.getByDisplayValue("./exports/job_5_model");
    expect(input).toBeInTheDocument();
  });

  it("shows Cancel and Export buttons", () => {
    render(<ExportDialog {...defaultProps} />);
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Export" })).toBeInTheDocument();
  });

  it("does not render content when open=false", () => {
    render(<ExportDialog {...defaultProps} open={false} />);
    expect(screen.queryByText("Export Job #5")).not.toBeInTheDocument();
  });

  it("switches to Report format when Report button is clicked", async () => {
    const { fireEvent } = await import("@testing-library/react");
    render(<ExportDialog {...defaultProps} />);

    const reportButton = screen.getByRole("button", { name: "Report" });
    fireEvent.click(reportButton);

    // Path should update to include _report
    expect(
      screen.getByDisplayValue("./exports/job_5_report"),
    ).toBeInTheDocument();
    // Description should change
    expect(
      screen.getByText(
        "Includes: HTML evaluation report with metrics and plots",
      ),
    ).toBeInTheDocument();
  });

  it("shows Model description when Model format is active", () => {
    render(<ExportDialog {...defaultProps} />);
    expect(
      screen.getByText("Includes: pkl + metadata JSON"),
    ).toBeInTheDocument();
  });

  it("calls exportJob and shows success toast on successful export", async () => {
    const { exportJob } = await import("@/api/jobs");
    (exportJob as ReturnType<typeof vi.fn>).mockResolvedValue({
      exported_path: "/output/model",
    });
    const { toast } = await import("sonner");

    render(<ExportDialog {...defaultProps} />);
    const { fireEvent, waitFor } = await import("@testing-library/react");

    const exportButton = screen.getByRole("button", { name: "Export" });
    fireEvent.click(exportButton);

    await waitFor(() => {
      expect(exportJob).toHaveBeenCalledWith(
        "job-xyz",
        "model",
        "./exports/job_5_model",
      );
      expect(toast.success).toHaveBeenCalledWith("Exported to /output/model");
      expect(defaultProps.onOpenChange).toHaveBeenCalledWith(false);
    });
  });

  it("shows error toast on export failure", async () => {
    const { exportJob } = await import("@/api/jobs");
    (exportJob as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("Network error"),
    );
    const { toast } = await import("sonner");

    render(<ExportDialog {...defaultProps} />);
    const { fireEvent, waitFor } = await import("@testing-library/react");

    const exportButton = screen.getByRole("button", { name: "Export" });
    fireEvent.click(exportButton);

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("Export failed");
    });
  });

  it("disables Export button when path is empty", async () => {
    const { fireEvent } = await import("@testing-library/react");
    render(<ExportDialog {...defaultProps} />);

    const pathInput = screen.getByDisplayValue("./exports/job_5_model");
    fireEvent.change(pathInput, { target: { value: "" } });

    const exportButton = screen.getByRole("button", { name: "Export" });
    expect(exportButton).toBeDisabled();
  });

  it("allows paths with '..' (server validates)", async () => {
    const { fireEvent } = await import("@testing-library/react");
    render(<ExportDialog {...defaultProps} />);

    const pathInput = screen.getByDisplayValue("./exports/job_5_model");
    fireEvent.change(pathInput, { target: { value: "../output" } });

    const exportButton = screen.getByRole("button", { name: "Export" });
    // Non-empty path is valid on client; server enforces path safety
    expect(exportButton).not.toBeDisabled();
  });

  it("disables Export button only when path is whitespace", async () => {
    const { fireEvent } = await import("@testing-library/react");
    render(<ExportDialog {...defaultProps} />);

    const pathInput = screen.getByDisplayValue("./exports/job_5_model");
    fireEvent.change(pathInput, { target: { value: "   " } });

    const exportButton = screen.getByRole("button", { name: "Export" });
    expect(exportButton).toBeDisabled();
  });

  it("calls onOpenChange(false) when Cancel is clicked", async () => {
    const { fireEvent } = await import("@testing-library/react");
    render(<ExportDialog {...defaultProps} />);

    const cancelButton = screen.getByRole("button", { name: "Cancel" });
    fireEvent.click(cancelButton);

    expect(defaultProps.onOpenChange).toHaveBeenCalledWith(false);
  });
});
