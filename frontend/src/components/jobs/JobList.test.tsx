import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { JobSummary } from "@/api/types";
import { makeJobSummary, renderWithProviders } from "@/test/helpers";
import { JobList } from "./JobList";

// --- Tests ---

describe("JobList", () => {
  beforeEach(() => {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("renders the Jobs heading", () => {
    renderWithProviders(
      <JobList jobs={[]} selectedJobId={null} onSelectJob={vi.fn()} />,
    );
    expect(screen.getByText("Jobs")).toBeInTheDocument();
  });

  it("shows empty message when no jobs", () => {
    renderWithProviders(
      <JobList jobs={[]} selectedJobId={null} onSelectJob={vi.fn()} />,
    );
    expect(
      screen.getByText("No jobs yet. Run Fit or Tune from the Workspace."),
    ).toBeInTheDocument();
  });

  it("renders status filter buttons", () => {
    renderWithProviders(
      <JobList jobs={[]} selectedJobId={null} onSelectJob={vi.fn()} />,
    );
    expect(screen.getByText("All")).toBeInTheDocument();
    expect(screen.getByText("Done")).toBeInTheDocument();
    expect(screen.getByText("Run")).toBeInTheDocument();
    expect(screen.getByText("Fail")).toBeInTheDocument();
  });

  it("renders job items with model abbreviation and score", () => {
    const jobs: JobSummary[] = [
      makeJobSummary({
        job_id: "j1",
        model_name: "LightGBM",
        primary_score: 0.912,
      }),
      makeJobSummary({
        job_id: "j2",
        job_type: "tune",
        model_name: "XGBoost",
        primary_score: 0.888,
        status: "completed",
      }),
    ];

    renderWithProviders(
      <JobList jobs={jobs} selectedJobId={null} onSelectJob={vi.fn()} />,
    );

    // Abbreviated model names
    expect(screen.getByText("LGB")).toBeInTheDocument();
    expect(screen.getByText("XGB")).toBeInTheDocument();

    // Scores formatted to 3 decimal places
    expect(screen.getByText("0.912")).toBeInTheDocument();
    expect(screen.getByText("0.888")).toBeInTheDocument();
  });

  it("renders job numbers based on position", () => {
    const jobs: JobSummary[] = [
      makeJobSummary({ job_id: "j1" }),
      makeJobSummary({ job_id: "j2" }),
    ];

    renderWithProviders(
      <JobList jobs={jobs} selectedJobId={null} onSelectJob={vi.fn()} />,
    );

    // Newest first: #2, #1
    expect(screen.getByText("#2")).toBeInTheDocument();
    expect(screen.getByText("#1")).toBeInTheDocument();
  });

  it("renders badge for fit and tune types", () => {
    const jobs: JobSummary[] = [
      makeJobSummary({ job_id: "j1", job_type: "fit" }),
      makeJobSummary({ job_id: "j2", job_type: "tune" }),
    ];

    renderWithProviders(
      <JobList jobs={jobs} selectedJobId={null} onSelectJob={vi.fn()} />,
    );

    expect(screen.getByText("fit")).toBeInTheDocument();
    expect(screen.getByText("tun")).toBeInTheDocument();
  });

  it("shows dash for failed job score", () => {
    const jobs: JobSummary[] = [
      makeJobSummary({ job_id: "j1", status: "failed", primary_score: null }),
    ];

    renderWithProviders(
      <JobList jobs={jobs} selectedJobId={null} onSelectJob={vi.fn()} />,
    );

    // The em dash character for failed jobs
    expect(screen.getByText("\u2014")).toBeInTheDocument();
  });

  it("shows ellipsis for running job score", () => {
    const jobs: JobSummary[] = [
      makeJobSummary({ job_id: "j1", status: "running", primary_score: null }),
    ];

    renderWithProviders(
      <JobList jobs={jobs} selectedJobId={null} onSelectJob={vi.fn()} />,
    );

    expect(screen.getByText("...")).toBeInTheDocument();
  });

  it("shows dash for cancelled job score", () => {
    const jobs: JobSummary[] = [
      makeJobSummary({
        job_id: "j1",
        status: "cancelled",
        primary_score: null,
      }),
    ];

    renderWithProviders(
      <JobList jobs={jobs} selectedJobId={null} onSelectJob={vi.fn()} />,
    );

    expect(screen.getByText("\u2014")).toBeInTheDocument();
  });

  it("shows dash when primary_score is null and not running/failed/cancelled", () => {
    const jobs: JobSummary[] = [
      makeJobSummary({
        job_id: "j1",
        status: "completed",
        primary_score: null,
      }),
    ];

    renderWithProviders(
      <JobList jobs={jobs} selectedJobId={null} onSelectJob={vi.fn()} />,
    );

    expect(screen.getByText("\u2014")).toBeInTheDocument();
  });

  it("filters jobs when status filter button is clicked", () => {
    const jobs: JobSummary[] = [
      makeJobSummary({ job_id: "j1", status: "completed" }),
      makeJobSummary({ job_id: "j2", status: "failed" }),
    ];

    renderWithProviders(
      <JobList jobs={jobs} selectedJobId={null} onSelectJob={vi.fn()} />,
    );

    // Click "Fail" filter
    fireEvent.click(screen.getByText("Fail"));

    expect(screen.queryByText("No jobs match the current filters.")).toBeNull();
  });

  it("shows 'No jobs match' when filter removes all jobs", () => {
    const jobs: JobSummary[] = [
      makeJobSummary({ job_id: "j1", status: "completed" }),
    ];

    renderWithProviders(
      <JobList jobs={jobs} selectedJobId={null} onSelectJob={vi.fn()} />,
    );

    // Click "Fail" filter — no failed jobs exist
    fireEvent.click(screen.getByText("Fail"));

    expect(
      screen.getByText("No jobs match the current filters."),
    ).toBeInTheDocument();
  });

  it("calls onSelectJob when a job button is clicked", () => {
    const onSelectJob = vi.fn();
    const jobs: JobSummary[] = [
      makeJobSummary({ job_id: "j1", model_name: "LightGBM" }),
    ];

    renderWithProviders(
      <JobList jobs={jobs} selectedJobId={null} onSelectJob={onSelectJob} />,
    );

    fireEvent.click(screen.getByText("LGB"));
    expect(onSelectJob).toHaveBeenCalledWith("j1");
  });

  it("shows undefined model name as '???' abbreviation", () => {
    const jobs: JobSummary[] = [
      makeJobSummary({ job_id: "j1", model_name: "" }),
    ];

    renderWithProviders(
      <JobList jobs={jobs} selectedJobId={null} onSelectJob={vi.fn()} />,
    );

    expect(screen.getByText("???")).toBeInTheDocument();
  });
});
