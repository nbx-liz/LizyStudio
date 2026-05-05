/**
 * Integration test (Issue #405): validate-debounce → ConfigEditorBody
 * warning banner.
 *
 * Unit-level coverage already exists on both ends:
 *
 * - {@link ../../hooks/useModelPanelData.test.ts} verifies that
 *   handleConfigChange enqueues a debounced validate call.
 * - {@link ./ConfigEditorBody.test.tsx} verifies that the banner
 *   renders correctly when given an `errors` prop containing a
 *   severity=warning entry.
 *
 * What was missing pre-#405: an end-to-end integration test proving
 * that a warning returned by `validateConfig` actually flows through
 * the hook's `setErrors` call (after the 500ms debounce) into a
 * ConfigEditorBody render with the suggested_fix copy intact. A
 * regression in either edge — severity dropped during cache hydration,
 * suggested_fix lost on the wire, banner inadvertently hidden by a
 * filter — would slip past the unit suites.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { useEffect, useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useModelPanelData } from "@/hooks/useModelPanelData";
import { ConfigEditorBody } from "./ConfigEditorBody";

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  },
}));

vi.mock("@/api/workspace", () => ({
  fetchBackends: vi
    .fn()
    .mockResolvedValue([{ name: "lizyml", version: "0.1" }]),
  fetchColumns: vi.fn().mockResolvedValue({
    columns: [{ name: "y", suggested_excluded: false }],
  }),
  fetchConfig: vi.fn().mockResolvedValue({
    task: "regression",
    data: { target: "y" },
    evaluation: { metrics: ["mae"] },
  }),
  fetchConfigSchema: vi.fn().mockResolvedValue({ type: "object" }),
  fetchUiSchema: vi.fn().mockResolvedValue({}),
  getConfigDownloadUrl: vi.fn().mockReturnValue("/api/config/download"),
  updateConfig: vi
    .fn()
    .mockResolvedValue({ config: {}, errors: [], saved: true }),
  uploadConfig: vi.fn().mockResolvedValue({ errors: [] }),
  validateConfig: vi.fn().mockResolvedValue({ errors: [] }),
}));

import { validateConfig } from "@/api/workspace";

vi.mock("./ConfigForm", () => ({
  ConfigForm: () => <div data-testid="config-form-stub" />,
}));
vi.mock("./TuneTab", () => ({
  TuneTab: () => <div data-testid="tune-tab-stub" />,
}));

function makeWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

/**
 * Bridge harness: drives useModelPanelData and renders
 * ConfigEditorBody with the hook's `errors` output. Exposes
 * handleConfigChange via a ref-bound trigger button so the test does
 * not need to drive through a full ConfigForm render.
 */
function Harness({ nextConfig }: { nextConfig: Record<string, unknown> }) {
  const data = useModelPanelData({ hasData: true, running: false });
  const nextConfigRef = useRef(nextConfig);
  useEffect(() => {
    nextConfigRef.current = nextConfig;
  }, [nextConfig]);
  return (
    <>
      <button
        type="button"
        data-testid="trigger-edit"
        onClick={() => {
          void data.handleConfigChange(nextConfigRef.current);
        }}
      />
      <ConfigEditorBody
        activeTab="tune"
        hasData
        running={false}
        errors={data.errors}
        schema={data.schema}
        config={data.config}
        onChange={data.handleConfigChange}
        task="regression"
        uiSchema={data.uiSchema}
        columns={data.nonExcludedColumns}
      />
    </>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

describe("validate-debounce → ConfigEditorBody warning banner (Issue #405)", () => {
  it("shows the warning banner with suggested_fix after the debounce window", async () => {
    vi.mocked(validateConfig).mockResolvedValue({
      errors: [
        {
          path: "evaluation.metrics",
          message: "MAPE is undefined when target column 'y' contains zeros.",
          severity: "warning",
          suggested_fix:
            "Remove 'mape' from evaluation.metrics — or replace it with 'smape' / 'wape' which tolerate zero targets (lizyml >= 0.11.0).",
        },
      ],
      // biome-ignore lint/suspicious/noExplicitAny: test fixture shape
    } as any);

    const Wrapper = makeWrapper();
    render(
      <Wrapper>
        <Harness
          nextConfig={{
            task: "regression",
            data: { target: "y" },
            evaluation: { metrics: ["mae", "mape"] },
          }}
        />
      </Wrapper>,
    );

    // Wait for the trigger button to appear (initial render done).
    const trigger = await screen.findByTestId("trigger-edit");

    // Trigger an edit — the PUT /config mock returns saved=true with no
    // errors, then the hook starts the 500ms debounced validate.
    await act(async () => {
      fireEvent.click(trigger);
    });

    // The hook's setErrors fires with the warning after the debounce
    // window. We wait via real timers so React's scheduler, fetch
    // microtasks, and the radix tooltip's RAF cycle all stay in their
    // production-equivalent path. The default findBy timeout (1s) is
    // plenty to bridge the 500ms VALIDATION_DEBOUNCE_MS.
    const banner = await screen.findByTestId(
      "config-warning-banner",
      undefined,
      { timeout: 2000 },
    );
    expect(banner).toBeInTheDocument();
    // a11y: SR notification (non-blocking, not an alert)
    expect(banner).toHaveAttribute("role", "status");
    expect(validateConfig).toHaveBeenCalledTimes(1);
    expect(validateConfig).toHaveBeenCalledWith({
      task: "regression",
      data: { target: "y" },
      evaluation: { metrics: ["mae", "mape"] },
    });
    // Severity envelope made it through the wire: banner shows the
    // suggested_fix beneath the message.
    expect(banner.textContent).toContain("MAPE is undefined");
    expect(banner.textContent).toContain("Suggestion:");
    expect(banner.textContent).toContain("smape");
    // No blocking-error banner — severity=warning must not surface as
    // a destructive role="alert" overlay.
    expect(screen.queryByTestId("config-error-banner")).toBeNull();
  });

  it("clears the banner when the next validate returns no warnings", async () => {
    vi.mocked(validateConfig)
      .mockResolvedValueOnce({
        errors: [
          {
            path: "evaluation.metrics",
            message: "MAPE undefined when target contains zeros.",
            severity: "warning",
            suggested_fix: "Use 'smape' instead.",
          },
        ],
        // biome-ignore lint/suspicious/noExplicitAny: test fixture shape
      } as any)
      .mockResolvedValueOnce({
        errors: [],
        // biome-ignore lint/suspicious/noExplicitAny: test fixture shape
      } as any);

    const Wrapper = makeWrapper();
    const { rerender } = render(
      <Wrapper>
        <Harness
          nextConfig={{
            task: "regression",
            data: { target: "y" },
            evaluation: { metrics: ["mae", "mape"] },
          }}
        />
      </Wrapper>,
    );
    const trigger = await screen.findByTestId("trigger-edit");

    // First edit — banner appears after the debounced validate fires
    await act(async () => {
      fireEvent.click(trigger);
    });
    expect(
      await screen.findByTestId("config-warning-banner", undefined, {
        timeout: 2000,
      }),
    ).toBeInTheDocument();

    // Update the config the harness will send next, then click again.
    rerender(
      <Wrapper>
        <Harness
          nextConfig={{
            task: "regression",
            data: { target: "y" },
            evaluation: { metrics: ["mae"] },
          }}
        />
      </Wrapper>,
    );
    await act(async () => {
      fireEvent.click(screen.getByTestId("trigger-edit"));
    });
    await waitFor(
      () => {
        expect(screen.queryByTestId("config-warning-banner")).toBeNull();
      },
      { timeout: 2000 },
    );
  });
});
