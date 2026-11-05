/**
 * P-0117 D4: JobDetailPanel renders ``JobWarnings`` once for every status,
 * merging ``job.warnings`` (fetched) with WebSocket ``warning`` messages.
 */
import { act, cleanup, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { connectJobProgress } from "@/api/websocket";
import { makeJob, renderWithProviders } from "@/test/helpers";

const mockFetchJob = vi.fn();
let wsCallbacks: Parameters<typeof connectJobProgress>[1] | null = null;

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  return { ...actual, useNavigate: () => vi.fn() };
});
vi.mock("@/api/jobs", () => ({
  fetchJob: (...args: unknown[]) => mockFetchJob(...args),
  fetchJobLog: vi.fn().mockResolvedValue({ log: "" }),
  cancelJob: vi.fn(),
  pauseJob: vi.fn(),
  unpauseJob: vi.fn(),
  retuneJob: vi.fn(),
  resumeJob: vi.fn(),
  fetchJobLineage: vi.fn().mockResolvedValue({
    tree: { job_id: "test-job-1", status: "completed", children: [] },
  }),
}));
vi.mock("@/api/websocket", () => ({
  connectJobProgress: vi.fn(
    (_id: string, callbacks: Parameters<typeof connectJobProgress>[1]) => {
      wsCallbacks = callbacks;
      return () => {};
    },
  ),
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));
vi.mock("./CompletedContent", () => ({
  CompletedContent: () => <div>CompletedContent</div>,
}));
vi.mock("./DeleteDialog", () => ({ DeleteDialog: () => null }));
vi.mock("./ExportDialog", () => ({ ExportDialog: () => null }));

import { JobDetailPanel } from "./JobDetail";

function renderPanel() {
  return renderWithProviders(
    <JobDetailPanel
      jobId="test-job-1"
      jobNumber={1}
      onJobDeleted={vi.fn()}
      onJobChanged={vi.fn()}
    />,
  );
}

afterEach(() => {
  cleanup();
  wsCallbacks = null;
  vi.clearAllMocks();
});

describe("JobDetailPanel warnings", () => {
  it.each(["completed", "failed", "cancelled"] as const)(
    "shows the fetched warning for a %s job",
    async (status) => {
      mockFetchJob.mockResolvedValue(
        makeJob({ status, warnings: ["Estimated memory is high."] }),
      );
      renderPanel();

      expect(await screen.findByTestId("job-warnings")).toBeInTheDocument();
      const items = screen.getAllByTestId("job-warning-item");
      expect(items).toHaveLength(1);
      expect(items[0]).toHaveTextContent("Estimated memory is high.");
    },
  );

  it("renders no banner when the job has no warnings", async () => {
    mockFetchJob.mockResolvedValue(makeJob({ status: "completed" }));
    renderPanel();

    await screen.findByText("CompletedContent");
    expect(screen.queryByTestId("job-warnings")).toBeNull();
  });

  it("merges a live WebSocket warning into a running job", async () => {
    mockFetchJob.mockResolvedValue(
      makeJob({ status: "running", completed_at: null }),
    );
    renderPanel();

    await waitFor(() => expect(wsCallbacks).not.toBeNull());
    await screen.findByTestId("job-warnings-announcer");
    expect(screen.queryByTestId("job-warnings")).toBeNull();

    act(() => {
      wsCallbacks?.onWarning?.({
        type: "warning",
        job_id: "test-job-1",
        message: "Live memory estimate.",
      });
    });

    expect(await screen.findByTestId("job-warnings")).toBeInTheDocument();
    expect(screen.getAllByTestId("job-warning-item")).toHaveLength(1);
    expect(screen.getByTestId("job-warnings-announcer")).toHaveTextContent(
      "New job warning.",
    );
  });

  it("shows a message once when it is both fetched and live", async () => {
    mockFetchJob.mockResolvedValue(
      makeJob({
        status: "running",
        completed_at: null,
        warnings: ["Same message."],
      }),
    );
    renderPanel();

    await screen.findByTestId("job-warnings");
    await waitFor(() => expect(wsCallbacks).not.toBeNull());
    act(() => {
      wsCallbacks?.onWarning?.({
        type: "warning",
        job_id: "test-job-1",
        message: "Same message.",
      });
    });

    expect(screen.getAllByTestId("job-warning-item")).toHaveLength(1);
  });
});
