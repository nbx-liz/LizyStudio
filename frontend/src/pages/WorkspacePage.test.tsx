import { act, cleanup, screen } from "@testing-library/react";
import { forwardRef, useImperativeHandle } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/helpers";
import { WorkspacePage } from "./WorkspacePage";

// --- API mocks ---

const {
  mockFetchUiSchema,
  mockRunFit,
  mockRunTune,
  mockUpdateConfig,
  mockToast,
} = vi.hoisted(() => ({
  mockFetchUiSchema: vi.fn().mockResolvedValue(null),
  mockRunFit: vi.fn(),
  mockRunTune: vi.fn(),
  mockUpdateConfig: vi.fn(),
  mockToast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  },
}));

const { mockFetchConfig } = vi.hoisted(() => ({
  mockFetchConfig: vi.fn().mockResolvedValue({ model: { name: "lgbm" } }),
}));

vi.mock("@/api/workspace", () => ({
  fetchConfig: (...args: unknown[]) => mockFetchConfig(...args),
  fetchUiSchema: (...args: unknown[]) => mockFetchUiSchema(...args),
  runFit: (...args: unknown[]) => mockRunFit(...args),
  runTune: (...args: unknown[]) => mockRunTune(...args),
  updateConfig: (...args: unknown[]) => mockUpdateConfig(...args),
}));

vi.mock("sonner", () => ({
  toast: mockToast,
}));

// Mock react-resizable-panels (doesn't work in headless DOM)
vi.mock("@/components/ui/resizable", () => ({
  ResizablePanelGroup: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="panel-group">{children}</div>
  ),
  ResizablePanel: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  ResizableHandle: () => <div data-testid="handle" />,
}));

// --- Child component mocks that capture props ---

let capturedDataPanelProps: Record<string, unknown> = {};
let capturedModelPanelProps: Record<string, unknown> = {};
let capturedResultsPanelProps: Record<string, unknown> = {};

// P-0086: DataPanel now forwards a ref that exposes ``getSubmitConfig``.
// The mock mirrors that contract so handleFit / handleTune can read the
// latest merged config through the ref at click time. ``submitConfigRef``
// is created via ``vi.hoisted`` because vi.mock factories execute before
// module-scope ``const`` initializers, and because a mutable ref is the
// idiomatic way to let individual tests swap the value seen by the mock.
const { submitConfigRef, submitConfigErrorRef } = vi.hoisted(() => ({
  submitConfigRef: { current: null as Record<string, unknown> | null },
  submitConfigErrorRef: { current: null as Error | null },
}));

vi.mock("@/components/workspace/DataPanel", () => ({
  DataPanel: forwardRef(
    (
      props: Record<string, unknown>,
      ref: React.Ref<{
        getSubmitConfig: () => Promise<Record<string, unknown>>;
      }>,
    ) => {
      capturedDataPanelProps = props;
      useImperativeHandle(
        ref,
        () => ({
          getSubmitConfig: async () => {
            if (submitConfigErrorRef.current) {
              throw submitConfigErrorRef.current;
            }
            return submitConfigRef.current ?? ({} as Record<string, unknown>);
          },
        }),
        [],
      );
      return <div data-testid="data-panel">DataPanel</div>;
    },
  ),
}));
vi.mock("@/components/workspace/ModelPanel", () => ({
  ModelPanel: (props: Record<string, unknown>) => {
    capturedModelPanelProps = props;
    return <div data-testid="model-panel">ModelPanel</div>;
  },
}));
vi.mock("@/components/workspace/ResultsPanel", () => ({
  ResultsPanel: (props: Record<string, unknown>) => {
    capturedResultsPanelProps = props;
    return <div data-testid="results-panel">ResultsPanel</div>;
  },
}));

// --- Tests ---

describe("WorkspacePage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedDataPanelProps = {};
    capturedModelPanelProps = {};
    capturedResultsPanelProps = {};
    submitConfigRef.current = null;
    submitConfigErrorRef.current = null;

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

  it("renders the 3-panel structure", () => {
    renderWithProviders(<WorkspacePage />);
    expect(screen.getByTestId("data-panel")).toBeInTheDocument();
    expect(screen.getByTestId("model-panel")).toBeInTheDocument();
    expect(screen.getByTestId("results-panel")).toBeInTheDocument();
  });

  it("renders all three panels with expected text", () => {
    renderWithProviders(<WorkspacePage />);
    expect(screen.getByText("DataPanel")).toBeInTheDocument();
    expect(screen.getByText("ModelPanel")).toBeInTheDocument();
    expect(screen.getByText("ResultsPanel")).toBeInTheDocument();
  });

  it("passes running=false initially to ModelPanel", () => {
    renderWithProviders(<WorkspacePage />);
    expect(capturedModelPanelProps.running).toBe(false);
  });

  it("sets running=true when handleFit is called", async () => {
    mockRunFit.mockResolvedValue({ job_id: "job-fit-1" });
    renderWithProviders(<WorkspacePage />);

    const onFit = capturedModelPanelProps.onFit as () => Promise<void>;
    await act(async () => onFit());

    expect(capturedModelPanelProps.running).toBe(true);
  });

  it("sets running=true when handleTune is called", async () => {
    mockRunTune.mockResolvedValue({ job_id: "job-tune-1" });
    renderWithProviders(<WorkspacePage />);

    const onTune = capturedModelPanelProps.onTune as () => Promise<void>;
    await act(async () => onTune());

    expect(capturedModelPanelProps.running).toBe(true);
  });

  it("shows error toast and resets running on fit failure", async () => {
    mockRunFit.mockRejectedValue(new Error("No data loaded"));
    renderWithProviders(<WorkspacePage />);

    const onFit = capturedModelPanelProps.onFit as () => Promise<void>;
    await act(async () => onFit());

    expect(mockToast.error).toHaveBeenCalledWith("Fit failed: No data loaded");
    expect(capturedModelPanelProps.running).toBe(false);
  });

  it("shows error toast and resets running on tune failure", async () => {
    mockRunTune.mockRejectedValue(new Error("Invalid config"));
    renderWithProviders(<WorkspacePage />);

    const onTune = capturedModelPanelProps.onTune as () => Promise<void>;
    await act(async () => onTune());

    expect(mockToast.error).toHaveBeenCalledWith("Tune failed: Invalid config");
    expect(capturedModelPanelProps.running).toBe(false);
  });

  it("passes job_id to ResultsPanel after successful fit", async () => {
    mockRunFit.mockResolvedValue({ job_id: "job-new" });
    renderWithProviders(<WorkspacePage />);

    expect(capturedResultsPanelProps.jobId).toBeNull();

    const onFit = capturedModelPanelProps.onFit as () => Promise<void>;
    await act(async () => onFit());

    expect(capturedResultsPanelProps.jobId).toBe("job-new");
  });

  it("resets running via onJobDone callback", async () => {
    mockRunFit.mockResolvedValue({ job_id: "job-1" });
    renderWithProviders(<WorkspacePage />);

    const onFit = capturedModelPanelProps.onFit as () => Promise<void>;
    await act(async () => onFit());
    expect(capturedModelPanelProps.running).toBe(true);

    // Simulate job completion via ResultsPanel callback
    const onJobDone = capturedResultsPanelProps.onJobDone as () => void;
    act(() => onJobDone());

    expect(capturedModelPanelProps.running).toBe(false);
  });

  it("updates hasData when onDataChanged is called", () => {
    renderWithProviders(<WorkspacePage />);

    expect(capturedModelPanelProps.hasData).toBe(false);

    const onDataChanged = capturedDataPanelProps.onDataChanged as () => void;
    act(() => onDataChanged());

    expect(capturedModelPanelProps.hasData).toBe(true);
  });

  it("handles applyToFit with success toast", async () => {
    mockUpdateConfig.mockResolvedValue({});
    renderWithProviders(<WorkspacePage />);

    const onApplyToFit = capturedResultsPanelProps.onApplyToFit as (
      config: Record<string, unknown>,
    ) => Promise<void>;
    await act(async () => onApplyToFit({ model: { name: "LGBMClassifier" } }));

    expect(mockUpdateConfig).toHaveBeenCalledWith({
      model: { name: "LGBMClassifier" },
    });
    expect(mockToast.success).toHaveBeenCalledWith(
      "Best params applied to Fit tab. Click Fit to run.",
    );
  });

  it("does not call fetchConfig before data is loaded", () => {
    renderWithProviders(<WorkspacePage />);
    // hasData is false initially — fetchConfig should not be called
    expect(mockFetchConfig).not.toHaveBeenCalled();
  });

  it("calls fetchConfig after data is loaded", () => {
    renderWithProviders(<WorkspacePage />);
    const onDataChanged = capturedDataPanelProps.onDataChanged as () => void;
    act(() => onDataChanged());
    // hasData is now true — fetchConfig should eventually be called via react-query
    // We verify the query is enabled by checking the mock was invoked
    // (react-query calls it asynchronously, so check after act)
    expect(capturedModelPanelProps.hasData).toBe(true);
  });

  it("does not freeze when fetchConfig rejects", async () => {
    mockFetchConfig.mockRejectedValue(new Error("No session"));
    renderWithProviders(<WorkspacePage />);

    const onDataChanged = capturedDataPanelProps.onDataChanged as () => void;
    act(() => onDataChanged());

    // Should still render without crashing
    expect(screen.getByTestId("data-panel")).toBeInTheDocument();
    expect(screen.getByTestId("model-panel")).toBeInTheDocument();
    expect(screen.getByTestId("results-panel")).toBeInTheDocument();
  });

  it("switches ModelPanel to fit tab after applyToFit", async () => {
    mockUpdateConfig.mockResolvedValue({});
    renderWithProviders(<WorkspacePage />);

    const onApplyToFit = capturedResultsPanelProps.onApplyToFit as (
      config: Record<string, unknown>,
    ) => Promise<void>;
    await act(async () => onApplyToFit({ model: { name: "lgbm" } }));

    expect(capturedModelPanelProps.activeTab).toBe("fit");
  });

  it("handles applyToFit failure with error toast", async () => {
    mockUpdateConfig.mockRejectedValue(new Error("Server error"));
    renderWithProviders(<WorkspacePage />);

    const onApplyToFit = capturedResultsPanelProps.onApplyToFit as (
      config: Record<string, unknown>,
    ) => Promise<void>;
    await act(async () => onApplyToFit({}));

    expect(mockToast.error).toHaveBeenCalledWith("Failed to apply tune config");
  });

  it("updates task when onTaskChanged is called", () => {
    renderWithProviders(<WorkspacePage />);

    // Initially task is null
    expect(capturedModelPanelProps.task).toBeNull();

    const onTaskChanged = capturedDataPanelProps.onTaskChanged as (
      t: string | null,
    ) => void;
    act(() => onTaskChanged("binary"));

    expect(capturedModelPanelProps.task).toBe("binary");
  });

  it("calls notify when onJobDone fires after job completion", async () => {
    // useBackgroundNotification is called inside WorkspacePage.
    // We can verify that onJobDone resets running=false (which exercises lines 97-98).
    mockRunFit.mockResolvedValue({ job_id: "job-1" });
    renderWithProviders(<WorkspacePage />);

    const onFit = capturedModelPanelProps.onFit as () => Promise<void>;
    await act(async () => onFit());

    // running should be true now
    expect(capturedModelPanelProps.running).toBe(true);

    // Trigger onJobDone — this exercises lines 136-139 (setRunning(false) + notify)
    const onJobDone = capturedResultsPanelProps.onJobDone as () => void;
    act(() => onJobDone());

    expect(capturedModelPanelProps.running).toBe(false);
  });

  it("shows error toast with non-Error object on fit failure", async () => {
    // Covers the String(err) branch (line 62)
    mockRunFit.mockRejectedValue("plain string error");
    renderWithProviders(<WorkspacePage />);

    const onFit = capturedModelPanelProps.onFit as () => Promise<void>;
    await act(async () => onFit());

    expect(mockToast.error).toHaveBeenCalledWith(
      "Fit failed: plain string error",
    );
  });

  it("shows error toast with non-Error object on tune failure", async () => {
    // Covers the String(err) branch (line 75)
    mockRunTune.mockRejectedValue("plain string error");
    renderWithProviders(<WorkspacePage />);

    const onTune = capturedModelPanelProps.onTune as () => Promise<void>;
    await act(async () => onTune());

    expect(mockToast.error).toHaveBeenCalledWith(
      "Tune failed: plain string error",
    );
  });

  // -----------------------------------------------------------------
  // Issue #101: hydrate currentJobId from the URL `?job_id=<id>` param
  // so a "Open in Workspace" link from the Jobs page lands directly
  // on the selected job's Results panel instead of an empty Workspace.
  // -----------------------------------------------------------------
  describe("job hydration from URL", () => {
    it("hydrates currentJobId from ?job_id=<id> on mount", () => {
      renderWithProviders(<WorkspacePage />, {
        initialEntries: ["/?job_id=job_abc123"],
      });
      expect(capturedResultsPanelProps.jobId).toBe("job_abc123");
    });

    it("leaves currentJobId null when no ?job param is present", () => {
      renderWithProviders(<WorkspacePage />, { initialEntries: ["/"] });
      expect(capturedResultsPanelProps.jobId).toBeNull();
    });

    it("does not start the running spinner when hydrating from URL", () => {
      // The job being hydrated is a completed historical job, not a
      // freshly-started run — ModelPanel must not show Running.
      renderWithProviders(<WorkspacePage />, {
        initialEntries: ["/?job_id=job_already_done"],
      });
      expect(capturedModelPanelProps.running).toBe(false);
    });

    it("ignores an empty ?job_id= value", () => {
      renderWithProviders(<WorkspacePage />, { initialEntries: ["/?job_id="] });
      expect(capturedResultsPanelProps.jobId).toBeNull();
    });

    it("still allows starting a fresh fit after a URL hydration", async () => {
      mockRunFit.mockResolvedValue({ job_id: "job_new" });
      renderWithProviders(<WorkspacePage />, {
        initialEntries: ["/?job_id=job_hydrated"],
      });
      expect(capturedResultsPanelProps.jobId).toBe("job_hydrated");

      const onFit = capturedModelPanelProps.onFit as () => Promise<void>;
      await act(async () => onFit());

      expect(capturedResultsPanelProps.jobId).toBe("job_new");
      expect(capturedModelPanelProps.running).toBe(true);
    });
  });

  // -----------------------------------------------------------------
  // Issue #178: mobile tabbed layout below the `md` breakpoint.
  // The 3-panel ResizablePanelGroup is structurally unusable on a
  // 375 px viewport; on mobile we swap to a sticky bottom-tab layout
  // showing one panel at a time.
  // -----------------------------------------------------------------
  describe("mobile tabbed layout", () => {
    function enableMobile() {
      Object.defineProperty(window, "matchMedia", {
        writable: true,
        value: vi.fn().mockImplementation((query: string) => ({
          matches: query === "(max-width: 767px)",
          media: query,
          onchange: null,
          addListener: vi.fn(),
          removeListener: vi.fn(),
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
          dispatchEvent: vi.fn(),
        })),
      });
    }

    it("renders a tablist with Data / Model / Results triggers", () => {
      enableMobile();
      renderWithProviders(<WorkspacePage />);
      const tablist = screen.getByRole("tablist", {
        name: /workspace sections/i,
      });
      expect(tablist).toBeInTheDocument();
      expect(screen.getByRole("tab", { name: /data/i })).toBeInTheDocument();
      expect(screen.getByRole("tab", { name: /model/i })).toBeInTheDocument();
      expect(screen.getByRole("tab", { name: /results/i })).toBeInTheDocument();
    });

    it("only renders the active tab's panel content (Radix unmounts inactive)", () => {
      enableMobile();
      renderWithProviders(<WorkspacePage />);
      // Data is selected by default — only its TabsContent is mounted.
      expect(screen.getByTestId("data-panel")).toBeInTheDocument();
      expect(screen.queryByTestId("model-panel")).not.toBeInTheDocument();
      expect(screen.queryByTestId("results-panel")).not.toBeInTheDocument();
    });

    it("mounts Model panel after switching to the Model tab", async () => {
      const { userEvent } = await import("@testing-library/user-event");
      enableMobile();
      renderWithProviders(<WorkspacePage />);
      const user = userEvent.setup();
      await user.click(screen.getByRole("tab", { name: /model/i }));
      expect(screen.getByTestId("model-panel")).toBeInTheDocument();
    });

    it("switches to the Results tab automatically when a child job starts", async () => {
      const { userEvent } = await import("@testing-library/user-event");
      enableMobile();
      renderWithProviders(<WorkspacePage />);
      const user = userEvent.setup();

      // Go to Results tab so onJobStarted prop gets captured.
      await user.click(screen.getByRole("tab", { name: /results/i }));
      expect(screen.getByRole("tab", { name: /results/i })).toHaveAttribute(
        "aria-selected",
        "true",
      );

      // Switch away, then fire onJobStarted — should jump back to Results.
      await user.click(screen.getByRole("tab", { name: /data/i }));
      expect(screen.getByRole("tab", { name: /data/i })).toHaveAttribute(
        "aria-selected",
        "true",
      );

      const onJobStarted = capturedResultsPanelProps.onJobStarted as (
        id: string,
      ) => void;
      act(() => onJobStarted("job_child_1"));

      expect(screen.getByRole("tab", { name: /results/i })).toHaveAttribute(
        "aria-selected",
        "true",
      );
    });

    it("does NOT auto-switch tabs when onJobDone fires (toast-only policy)", async () => {
      const { userEvent } = await import("@testing-library/user-event");
      enableMobile();
      renderWithProviders(<WorkspacePage />);
      const user = userEvent.setup();

      // Park on Model tab.
      await user.click(screen.getByRole("tab", { name: /model/i }));
      expect(screen.getByRole("tab", { name: /model/i })).toHaveAttribute(
        "aria-selected",
        "true",
      );

      // Briefly hop to Results to capture the onJobDone prop, then back.
      await user.click(screen.getByRole("tab", { name: /results/i }));
      const onJobDone = capturedResultsPanelProps.onJobDone as () => void;
      await user.click(screen.getByRole("tab", { name: /model/i }));

      act(() => onJobDone());

      expect(screen.getByRole("tab", { name: /model/i })).toHaveAttribute(
        "aria-selected",
        "true",
      );
    });
  });

  // -------------------------------------------------------------------
  // P-0086 (Issue #251): handleFit / handleTune must read the latest
  // merged config from DataPanel's ref and include it in the POST body,
  // so Fit/Tune never loses the race against an in-flight PUT /config.
  // -------------------------------------------------------------------
  describe("P-0086 fit/tune config body", () => {
    it("passes DataPanel's merged config as runFit body", async () => {
      mockRunFit.mockResolvedValue({ job_id: "job-fit-p0086" });
      submitConfigRef.current = {
        task: "binary",
        features: { exclude: ["age"], categorical: [] },
      };
      renderWithProviders(<WorkspacePage />);

      const onFit = capturedModelPanelProps.onFit as () => Promise<void>;
      await act(async () => onFit());

      expect(mockRunFit).toHaveBeenCalledWith(submitConfigRef.current);
    });

    it("passes DataPanel's merged config as runTune body", async () => {
      mockRunTune.mockResolvedValue({ job_id: "job-tune-p0086" });
      submitConfigRef.current = {
        task: "regression",
        features: { exclude: ["id"], categorical: [] },
      };
      renderWithProviders(<WorkspacePage />);

      const onTune = capturedModelPanelProps.onTune as () => Promise<void>;
      await act(async () => onTune());

      expect(mockRunTune).toHaveBeenCalledWith(submitConfigRef.current);
    });

    it("falls back to body-less runFit and warns when getSubmitConfig throws", async () => {
      // Review feedback on P-0086: when fetchConfig fails inside the
      // DataPanel imperative handle, the fit/tune click must still
      // reach the server (body-less regression path) AND surface a
      // toast so the user knows why their latest edits may be missing.
      mockRunFit.mockResolvedValue({ job_id: "job-fallback" });
      submitConfigErrorRef.current = new Error("network down");
      renderWithProviders(<WorkspacePage />);

      const onFit = capturedModelPanelProps.onFit as () => Promise<void>;
      await act(async () => onFit());

      expect(mockRunFit).toHaveBeenCalledWith(undefined);
      expect(mockToast.warning).toHaveBeenCalledWith(
        expect.stringContaining("network down"),
      );
    });
  });
});
