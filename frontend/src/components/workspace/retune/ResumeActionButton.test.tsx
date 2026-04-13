import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ResumeActionButton } from "./ResumeActionButton";

const mockResumeJob = vi.fn();

vi.mock("@/api/jobs", () => ({
  resumeJob: (...args: unknown[]) => mockResumeJob(...args),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

function renderButton(
  props: Partial<Parameters<typeof ResumeActionButton>[0]> = {},
) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <ResumeActionButton jobId="job_parent" remainingTrials={30} {...props} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mockResumeJob.mockReset();
});

describe("ResumeActionButton", () => {
  it("prefills the remaining trials value and submits it", async () => {
    mockResumeJob.mockResolvedValue({
      job_id: "job_child",
      parent_job_id: "job_parent",
    });

    renderButton();

    const trigger = screen.getByRole("button", {
      name: /Resume tuning from checkpoint/i,
    });
    expect(trigger.textContent ?? "").toContain("30 trials remaining");

    await userEvent.click(trigger);
    const input = await screen.findByLabelText(/Remaining trials/i);
    expect(input).toHaveValue(30);

    await userEvent.click(
      screen.getByRole("button", { name: /Start Resume/i }),
    );

    await waitFor(() => {
      expect(mockResumeJob).toHaveBeenCalledWith("job_parent", {
        n_trials: 30,
      });
    });
  });

  it("disables the trigger when disabledReason is provided", () => {
    renderButton({
      disabledReason: "Resume of a re-tune child is not supported",
    });
    expect(
      screen.getByRole("button", { name: /Resume tuning from checkpoint/i }),
    ).toBeDisabled();
  });

  it("disables the trigger when hasCheckpoint is false", () => {
    renderButton({ hasCheckpoint: false });
    expect(
      screen.getByRole("button", { name: /Resume tuning from checkpoint/i }),
    ).toBeDisabled();
  });

  it("fires onStarted with the new child job id on success", async () => {
    mockResumeJob.mockResolvedValue({
      job_id: "job_child_resume",
      parent_job_id: "job_parent",
    });
    const onStarted = vi.fn();
    renderButton({ onStarted });

    await userEvent.click(
      screen.getByRole("button", { name: /Resume tuning from checkpoint/i }),
    );
    await screen.findByRole("spinbutton");
    await userEvent.click(
      screen.getByRole("button", { name: /Start Resume/i }),
    );

    await waitFor(() => {
      expect(onStarted).toHaveBeenCalledWith("job_child_resume");
    });
  });

  it("shows a destructive toast when resumeJob rejects", async () => {
    const { toast } = await import("sonner");
    mockResumeJob.mockRejectedValueOnce(new Error("server exploded"));

    renderButton();
    await userEvent.click(
      screen.getByRole("button", { name: /Resume tuning from checkpoint/i }),
    );
    await screen.findByRole("spinbutton");
    await userEvent.click(
      screen.getByRole("button", { name: /Start Resume/i }),
    );

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(
        expect.stringContaining("server exploded"),
      );
    });
  });

  it("blocks submission when n_trials is 0", async () => {
    renderButton();
    await userEvent.click(
      screen.getByRole("button", { name: /Resume tuning from checkpoint/i }),
    );
    const input = await screen.findByRole("spinbutton");
    await userEvent.clear(input);
    await userEvent.type(input, "0");

    const submit = screen.getByRole("button", { name: /Start Resume/i });
    expect(submit).toBeDisabled();
  });
});
