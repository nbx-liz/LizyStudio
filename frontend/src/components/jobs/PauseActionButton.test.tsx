import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PauseActionButton } from "./PauseActionButton";

const mockPauseJob = vi.fn();

vi.mock("@/api/jobs", () => ({
  pauseJob: (...args: unknown[]) => mockPauseJob(...args),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

function renderButton(
  props: Partial<Parameters<typeof PauseActionButton>[0]> = {},
) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <PauseActionButton jobId="job_paused_target" {...props} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mockPauseJob.mockReset();
});

describe("PauseActionButton", () => {
  it("renders the Pause label with accessible name", () => {
    renderButton();
    const trigger = screen.getByRole("button", {
      name: /Pause tuning at next trial/i,
    });
    expect(trigger.textContent ?? "").toContain("Pause");
  });

  it("calls pauseJob with the supplied jobId on click", async () => {
    mockPauseJob.mockResolvedValue({ status: "pause_requested" });

    renderButton();
    await userEvent.click(
      screen.getByRole("button", { name: /Pause tuning at next trial/i }),
    );

    await waitFor(() => {
      expect(mockPauseJob).toHaveBeenCalledWith("job_paused_target");
    });
  });

  it("invokes onPauseRequested after a successful pause", async () => {
    mockPauseJob.mockResolvedValue({ status: "pause_requested" });
    const onPauseRequested = vi.fn();

    renderButton({ onPauseRequested });
    await userEvent.click(
      screen.getByRole("button", { name: /Pause tuning at next trial/i }),
    );

    await waitFor(() => {
      expect(onPauseRequested).toHaveBeenCalledTimes(1);
    });
  });

  it("does not call onPauseRequested when the request fails", async () => {
    mockPauseJob.mockRejectedValue(new Error("400: JOB_NOT_RUNNING"));
    const onPauseRequested = vi.fn();

    renderButton({ onPauseRequested });
    await userEvent.click(
      screen.getByRole("button", { name: /Pause tuning at next trial/i }),
    );

    await waitFor(() => {
      expect(mockPauseJob).toHaveBeenCalledTimes(1);
    });
    expect(onPauseRequested).not.toHaveBeenCalled();
  });
});
