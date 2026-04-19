import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { LineageNode } from "@/api/jobs";
import { JobLineageTree } from "./JobLineageTree";

function makeTree(): LineageNode {
  return {
    job_id: "job_root",
    status: "completed",
    job_type: "tune",
    children: [
      {
        job_id: "job_child_a",
        status: "failed",
        job_type: "tune",
        children: [
          {
            job_id: "job_grandchild",
            status: "running",
            job_type: "tune",
            children: [],
          },
        ],
      },
      {
        job_id: "job_child_b",
        status: "completed",
        job_type: "tune",
        children: [],
      },
    ],
  };
}

describe("JobLineageTree", () => {
  it("renders every node in the tree", () => {
    render(<JobLineageTree root={makeTree()} />);
    expect(screen.getByText("job_root")).toBeInTheDocument();
    expect(screen.getByText("job_child_a")).toBeInTheDocument();
    expect(screen.getByText("job_child_b")).toBeInTheDocument();
    expect(screen.getByText("job_grandchild")).toBeInTheDocument();
  });

  it("surfaces each node's status as a badge", () => {
    render(<JobLineageTree root={makeTree()} />);
    expect(screen.getByText("failed")).toBeInTheDocument();
    expect(screen.getByText("running")).toBeInTheDocument();
    // completed appears for root + child_b
    expect(screen.getAllByText("completed")).toHaveLength(2);
  });

  it("fires onSelect with the clicked job id", async () => {
    const onSelect = vi.fn();
    render(<JobLineageTree root={makeTree()} onSelect={onSelect} />);
    await userEvent.click(screen.getByText("job_grandchild"));
    expect(onSelect).toHaveBeenCalledWith("job_grandchild");
  });

  it("collapses a subtree when the toggle is clicked", async () => {
    render(<JobLineageTree root={makeTree()} />);
    // job_child_a's subtree contains job_grandchild — collapsing hides it.
    const toggles = screen.getAllByRole("button", { name: /Collapse/i });
    // First toggle is the root, second is job_child_a.
    await userEvent.click(toggles[1]);
    expect(screen.queryByText("job_grandchild")).not.toBeInTheDocument();
  });
});
