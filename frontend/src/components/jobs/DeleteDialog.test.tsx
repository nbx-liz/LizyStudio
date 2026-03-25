import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DeleteDialog } from "./DeleteDialog";

vi.mock("@/api/jobs", () => ({ deleteJob: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const defaultProps = {
  open: true,
  onOpenChange: vi.fn(),
  jobId: "job-abc",
  jobNumber: 3,
  onDeleted: vi.fn(),
};

describe("DeleteDialog", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('shows dialog title "Delete Job #3?" when open=true and jobNumber=3', () => {
    render(<DeleteDialog {...defaultProps} />);
    expect(screen.getByText("Delete Job #3?")).toBeInTheDocument();
  });

  it("shows warning text about action being irreversible", () => {
    render(<DeleteDialog {...defaultProps} />);
    expect(
      screen.getByText(/this action cannot be undone/i),
    ).toBeInTheDocument();
  });

  it("shows Cancel and Delete buttons", () => {
    render(<DeleteDialog {...defaultProps} />);
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete" })).toBeInTheDocument();
  });

  it("does not render content when open=false", () => {
    render(<DeleteDialog {...defaultProps} open={false} />);
    expect(screen.queryByText("Delete Job #3?")).not.toBeInTheDocument();
  });

  it("calls deleteJob and onDeleted on successful delete", async () => {
    const { deleteJob } = await import("@/api/jobs");
    (deleteJob as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

    render(<DeleteDialog {...defaultProps} />);
    const deleteButton = screen.getByRole("button", { name: "Delete" });

    const { fireEvent, waitFor } = await import("@testing-library/react");
    fireEvent.click(deleteButton);

    await waitFor(() => {
      expect(deleteJob).toHaveBeenCalledWith("job-abc");
      expect(defaultProps.onDeleted).toHaveBeenCalled();
      expect(defaultProps.onOpenChange).toHaveBeenCalledWith(false);
    });
  });

  it("shows error toast on delete failure", async () => {
    const { deleteJob } = await import("@/api/jobs");
    (deleteJob as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("Server error"),
    );
    const { toast } = await import("sonner");

    render(<DeleteDialog {...defaultProps} />);
    const deleteButton = screen.getByRole("button", { name: "Delete" });

    const { fireEvent, waitFor } = await import("@testing-library/react");
    fireEvent.click(deleteButton);

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("Failed to delete job");
    });
    // onDeleted should NOT be called on failure
    expect(defaultProps.onDeleted).not.toHaveBeenCalled();
  });

  it("calls onOpenChange(false) when Cancel is clicked", async () => {
    render(<DeleteDialog {...defaultProps} />);
    const cancelButton = screen.getByRole("button", { name: "Cancel" });

    const { fireEvent } = await import("@testing-library/react");
    fireEvent.click(cancelButton);

    expect(defaultProps.onOpenChange).toHaveBeenCalledWith(false);
  });

  it("shows success toast with job number on successful delete", async () => {
    const { deleteJob } = await import("@/api/jobs");
    (deleteJob as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    const { toast } = await import("sonner");

    render(<DeleteDialog {...defaultProps} />);
    const deleteButton = screen.getByRole("button", { name: "Delete" });

    const { fireEvent, waitFor } = await import("@testing-library/react");
    fireEvent.click(deleteButton);

    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith("Job #3 deleted");
    });
  });
});
