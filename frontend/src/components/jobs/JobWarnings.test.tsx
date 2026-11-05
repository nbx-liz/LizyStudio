import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { JobWarnings, MAX_JOB_WARNINGS, mergeJobWarnings } from "./JobWarnings";

afterEach(cleanup);

describe("mergeJobWarnings", () => {
  it("puts fetched first and appends only absent live messages", () => {
    expect(mergeJobWarnings(["a"], ["a", "b"])).toEqual(["a", "b"]);
  });

  it("keeps server order and drops duplicates inside the live list", () => {
    expect(mergeJobWarnings(["x", "y"], ["z", "y", "z"])).toEqual([
      "x",
      "y",
      "z",
    ]);
  });

  it("matches exact strings only (no trimming or case folding)", () => {
    expect(mergeJobWarnings(["a"], ["a ", "A"])).toEqual(["a", "a ", "A"]);
  });

  it("returns an empty list for empty inputs", () => {
    expect(mergeJobWarnings([], [])).toEqual([]);
  });

  it("caps the result at 50 without truncating any message", () => {
    const long = "m".repeat(500);
    const fetched = Array.from({ length: 40 }, (_, i) => `${long}-${i}`);
    const live = Array.from({ length: 40 }, (_, i) => `live-${i}`);
    const merged = mergeJobWarnings(fetched, live);
    expect(MAX_JOB_WARNINGS).toBe(50);
    expect(merged).toHaveLength(50);
    expect(merged[0]).toBe(`${long}-0`);
    expect(merged[49]).toBe("live-9");
  });
});

describe("JobWarnings", () => {
  it("renders nothing for an empty list on a completed job", () => {
    const { container } = render(
      <JobWarnings warnings={[]} status="completed" />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders only the empty announcer for an empty list while running", () => {
    render(<JobWarnings warnings={[]} status="running" />);
    expect(screen.queryByTestId("job-warnings")).toBeNull();
    expect(screen.getByTestId("job-warnings-announcer")).toBeEmptyDOMElement();
  });

  it("shows a singular heading and the verbatim message", () => {
    render(<JobWarnings warnings={["<b>big</b> memory"]} status="completed" />);
    expect(screen.getByRole("heading", { name: "Warning" })).toBeTruthy();
    const items = screen.getAllByTestId("job-warning-item");
    expect(items).toHaveLength(1);
    // Plain text only: the markup is shown literally, not parsed.
    expect(items[0]?.textContent).toBe("<b>big</b> memory");
    expect(items[0]?.querySelector("b")).toBeNull();
    expect(screen.queryByTestId("job-warnings-toggle")).toBeNull();
  });

  it("shows a counted heading for several messages", () => {
    render(<JobWarnings warnings={["a", "b"]} status="completed" />);
    expect(screen.getByRole("heading", { name: "Warnings (2)" })).toBeTruthy();
    expect(screen.getAllByTestId("job-warning-item")).toHaveLength(2);
    expect(screen.queryByTestId("job-warnings-toggle")).toBeNull();
  });

  it("uses the not-stopped helper for running, paused and completed", () => {
    for (const status of ["running", "paused", "completed"]) {
      const { unmount } = render(
        <JobWarnings warnings={["a"]} status={status} />,
      );
      expect(
        screen.getByText(/The job was not stopped\. If memory use/),
      ).toBeTruthy();
      unmount();
    }
  });

  it("omits the not-stopped sentence for failed and cancelled", () => {
    for (const status of ["failed", "cancelled"]) {
      const { unmount } = render(
        <JobWarnings warnings={["a"]} status={status} />,
      );
      expect(
        screen.getByText(
          "If memory use is a concern, review max_depth and num_leaves in the config.",
        ),
      ).toBeTruthy();
      expect(screen.queryByText(/not stopped/)).toBeNull();
      unmount();
    }
  });

  it("collapses to 2 of 3 messages and expands via the toggle", async () => {
    const user = userEvent.setup();
    render(<JobWarnings warnings={["a", "b", "c"]} status="completed" />);

    expect(screen.getAllByTestId("job-warning-item")).toHaveLength(2);
    const toggle = screen.getByTestId("job-warnings-toggle");
    expect(toggle.textContent).toBe("Show 1 more");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(toggle.getAttribute("aria-controls")).toBe(
      screen.getByLabelText("Warning messages").id,
    );

    await user.click(toggle);
    expect(screen.getAllByTestId("job-warning-item")).toHaveLength(3);
    expect(toggle.textContent).toBe("Show less");
    expect(toggle.getAttribute("aria-expanded")).toBe("true");

    await user.click(toggle);
    expect(screen.getAllByTestId("job-warning-item")).toHaveLength(2);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
  });

  it("toggles with the keyboard (Enter and Space)", async () => {
    const user = userEvent.setup();
    render(<JobWarnings warnings={["a", "b", "c"]} status="completed" />);
    const toggle = screen.getByTestId("job-warnings-toggle");

    toggle.focus();
    await user.keyboard("{Enter}");
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    await user.keyboard(" ");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
  });

  it("makes the scrollable list focusable and the banner non-live", () => {
    render(<JobWarnings warnings={["a"]} status="completed" />);
    const list = screen.getByLabelText("Warning messages");
    expect(list.getAttribute("tabindex")).toBe("0");
    const banner = screen.getByTestId("job-warnings");
    expect(banner.getAttribute("role")).toBeNull();
    expect(banner.getAttribute("aria-live")).toBeNull();
  });
});

describe("JobWarnings announcer", () => {
  it("is silent on first render with existing warnings", () => {
    render(<JobWarnings warnings={["a"]} status="running" />);
    expect(screen.getByTestId("job-warnings-announcer")).toBeEmptyDOMElement();
  });

  it("announces a warning added while running", () => {
    const { rerender } = render(<JobWarnings warnings={[]} status="running" />);
    expect(screen.getByTestId("job-warnings-announcer")).toBeEmptyDOMElement();

    rerender(<JobWarnings warnings={["a"]} status="running" />);
    expect(screen.getByTestId("job-warnings-announcer").textContent).toBe(
      "New job warning.",
    );

    rerender(<JobWarnings warnings={["a", "b", "c"]} status="running" />);
    expect(screen.getByTestId("job-warnings-announcer").textContent).toBe(
      "New job warnings.",
    );
  });

  it("stays silent when the count increases while paused", () => {
    const { rerender } = render(<JobWarnings warnings={[]} status="paused" />);
    rerender(<JobWarnings warnings={["a"]} status="paused" />);
    expect(screen.getByTestId("job-warnings-announcer")).toBeEmptyDOMElement();
  });

  it("is not mounted for a completed job, and the change to completed is silent", () => {
    const { rerender } = render(
      <JobWarnings warnings={["a"]} status="running" />,
    );
    rerender(<JobWarnings warnings={["a", "b"]} status="completed" />);
    expect(screen.queryByTestId("job-warnings-announcer")).toBeNull();
  });
});
