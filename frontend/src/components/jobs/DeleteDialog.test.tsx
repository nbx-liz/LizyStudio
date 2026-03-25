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
});
