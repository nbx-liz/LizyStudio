import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { UnpauseActionButton } from "./UnpauseActionButton";

const mockUnpauseJob = vi.fn();

vi.mock("@/api/jobs", () => ({
  unpauseJob: (...args: unknown[]) => mockUnpauseJob(...args),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

function renderButton(
  props: Partial<Parameters<typeof UnpauseActionButton>[0]> = {},
) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <UnpauseActionButton jobId="job_paused_target" {...props} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mockUnpauseJob.mockReset();
});

describe("UnpauseActionButton", () => {
  it("renders the Resume label with accessible name", () => {
    renderButton();
    const trigger = screen.getByRole("button", {
      name: /Resume paused tuning/i,
    });
    expect(trigger.textContent ?? "").toContain("Resume");
  });

  it("calls unpauseJob with the supplied jobId on click", async () => {
    mockUnpauseJob.mockResolvedValue({
      status: "unpause_started",
      job_id: "job_paused_target",
    });

    renderButton();
    await userEvent.click(
      screen.getByRole("button", { name: /Resume paused tuning/i }),
    );

    await waitFor(() => {
      expect(mockUnpauseJob).toHaveBeenCalledWith("job_paused_target");
    });
  });

  it("disables the trigger when disabledReason is provided", () => {
    renderButton({ disabledReason: "Workspace data not loaded" });
    const trigger = screen.getByRole("button", {
      name: /Resume paused tuning/i,
    });
    expect(trigger).toBeDisabled();
    expect(trigger).toHaveAttribute("title", "Workspace data not loaded");
  });

  it("invokes onUnpauseStarted after a successful resume", async () => {
    mockUnpauseJob.mockResolvedValue({
      status: "unpause_started",
      job_id: "job_paused_target",
    });
    const onUnpauseStarted = vi.fn();

    renderButton({ onUnpauseStarted });
    await userEvent.click(
      screen.getByRole("button", { name: /Resume paused tuning/i }),
    );

    await waitFor(() => {
      expect(onUnpauseStarted).toHaveBeenCalledTimes(1);
    });
  });

  it("does not call onUnpauseStarted when the request fails", async () => {
    mockUnpauseJob.mockRejectedValue(new Error("400: WORKSPACE_NO_DATA"));
    const onUnpauseStarted = vi.fn();

    renderButton({ onUnpauseStarted });
    await userEvent.click(
      screen.getByRole("button", { name: /Resume paused tuning/i }),
    );

    await waitFor(() => {
      expect(mockUnpauseJob).toHaveBeenCalled();
    });
    expect(onUnpauseStarted).not.toHaveBeenCalled();
  });
});
