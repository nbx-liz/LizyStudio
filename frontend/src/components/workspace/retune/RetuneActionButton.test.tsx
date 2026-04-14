import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RetuneActionButton } from "./RetuneActionButton";

const mockRetuneJob = vi.fn();

vi.mock("@/api/jobs", () => ({
  retuneJob: (...args: unknown[]) => mockRetuneJob(...args),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

function renderButton(
  props: Partial<Parameters<typeof RetuneActionButton>[0]> = {},
) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <RetuneActionButton jobId="job_parent" defaultNTrials={50} {...props} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mockRetuneJob.mockReset();
});

describe("RetuneActionButton", () => {
  it("opens the dialog and calls retuneJob with the parsed n_trials", async () => {
    mockRetuneJob.mockResolvedValue({
      job_id: "job_child",
      parent_job_id: "job_parent",
    });

    renderButton();

    await userEvent.click(
      screen.getByRole("button", { name: /Re-tune with additional trials/i }),
    );
    // Dialog open
    const input = await screen.findByRole("spinbutton");
    expect(input).toHaveValue(50);

    await userEvent.clear(input);
    await userEvent.type(input, "25");
    await userEvent.click(
      screen.getByRole("button", { name: /Start Re-tune/i }),
    );

    await waitFor(() => {
      expect(mockRetuneJob).toHaveBeenCalledWith("job_parent", {
        n_trials: 25,
      });
    });
  });

  it("fires onStarted with the new child job id on success", async () => {
    mockRetuneJob.mockResolvedValue({
      job_id: "job_child_xyz",
      parent_job_id: "job_parent",
    });
    const onStarted = vi.fn();

    renderButton({ onStarted });

    await userEvent.click(
      screen.getByRole("button", { name: /Re-tune with additional trials/i }),
    );
    await screen.findByRole("spinbutton");
    await userEvent.click(
      screen.getByRole("button", { name: /Start Re-tune/i }),
    );

    await waitFor(() => {
      expect(onStarted).toHaveBeenCalledWith("job_child_xyz");
    });
  });

  it("disables the trigger when disabledReason is provided", async () => {
    renderButton({
      disabledReason: "Re-tune of a re-tune child is not supported",
    });
    const trigger = screen.getByRole("button", {
      name: /Re-tune with additional trials/i,
    });
    expect(trigger).toBeDisabled();
    expect(trigger).toHaveAttribute(
      "title",
      "Re-tune of a re-tune child is not supported",
    );
  });

  it("disables the trigger when hasCheckpoint is false", () => {
    renderButton({ hasCheckpoint: false });
    const trigger = screen.getByRole("button", {
      name: /Re-tune with additional trials/i,
    });
    expect(trigger).toBeDisabled();
    expect(trigger.getAttribute("title")).toMatch(/no saved checkpoint/i);
  });

  it("blocks submission when n_trials is outside the allowed range", async () => {
    renderButton();
    await userEvent.click(
      screen.getByRole("button", { name: /Re-tune with additional trials/i }),
    );
    const input = await screen.findByRole("spinbutton");
    await userEvent.clear(input);
    await userEvent.type(input, "0");

    const submit = screen.getByRole("button", { name: /Start Re-tune/i });
    expect(submit).toBeDisabled();
    expect(screen.getByText(/must be between 1/i)).toBeInTheDocument();
  });

  it("shows a destructive toast when retuneJob rejects", async () => {
    const { toast } = await import("sonner");
    mockRetuneJob.mockRejectedValueOnce(new Error("server exploded"));
    const onStarted = vi.fn();

    renderButton({ onStarted });
    await userEvent.click(
      screen.getByRole("button", { name: /Re-tune with additional trials/i }),
    );
    await screen.findByRole("spinbutton");
    await userEvent.click(
      screen.getByRole("button", { name: /Start Re-tune/i }),
    );

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(
        expect.stringContaining("server exploded"),
      );
    });
    expect(onStarted).not.toHaveBeenCalled();
  });

  it("rejects n_trials above the MAX_TRIALS cap", async () => {
    renderButton();
    await userEvent.click(
      screen.getByRole("button", { name: /Re-tune with additional trials/i }),
    );
    const input = await screen.findByRole("spinbutton");
    await userEvent.clear(input);
    await userEvent.type(input, "20000");

    const submit = screen.getByRole("button", { name: /Start Re-tune/i });
    expect(submit).toBeDisabled();
    expect(screen.getByText(/must be between 1/i)).toBeInTheDocument();
  });

  it("rejects non-numeric n_trials", async () => {
    renderButton();
    await userEvent.click(
      screen.getByRole("button", { name: /Re-tune with additional trials/i }),
    );
    const input = await screen.findByRole("spinbutton");
    await userEvent.clear(input);
    // Cannot type letters into a number input; simulate programmatically.
    await userEvent.type(input, "-5");

    const submit = screen.getByRole("button", { name: /Start Re-tune/i });
    expect(submit).toBeDisabled();
  });

  it("cancel button closes the dialog without sending a request", async () => {
    renderButton();
    await userEvent.click(
      screen.getByRole("button", { name: /Re-tune with additional trials/i }),
    );
    await screen.findByRole("spinbutton");
    const cancelBtn = screen.getAllByRole("button", { name: /^Cancel$/ })[0];
    await userEvent.click(cancelBtn);

    expect(mockRetuneJob).not.toHaveBeenCalled();
  });
});
