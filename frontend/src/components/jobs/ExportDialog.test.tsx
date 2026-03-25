import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ExportDialog } from "./ExportDialog";

vi.mock("@/api/jobs", () => ({ exportJob: vi.fn() }));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
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
});
