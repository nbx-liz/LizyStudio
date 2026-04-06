import { cleanup, render, screen } from "@testing-library/react";
import type React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PlotlyChart } from "./PlotlyChart";

vi.mock("react-plotly.js", () => ({
  default: (props: Record<string, unknown>) => (
    <div
      data-testid="plot"
      data-data={JSON.stringify(props.data)}
      data-layout={JSON.stringify(props.layout)}
      style={props.style as React.CSSProperties}
    />
  ),
}));

function getPlotProps() {
  const el = screen.getByTestId("plot");
  return {
    data: JSON.parse(el.getAttribute("data-data") ?? "[]"),
    layout: JSON.parse(el.getAttribute("data-layout") ?? "{}"),
    style: el.style,
  };
}

describe("PlotlyChart", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders with valid plotly JSON", () => {
    const json = JSON.stringify({
      data: [{ x: [1, 2], y: [3, 4], type: "scatter" }],
      layout: { title: "Test" },
    });
    render(<PlotlyChart plotlyJson={json} />);
    const { data, layout } = getPlotProps();
    expect(data).toHaveLength(1);
    expect(data[0].type).toBe("scatter");
    expect(layout.title).toBe("Test");
    expect(layout.autosize).toBe(true);
  });

  it("handles invalid JSON gracefully", () => {
    render(<PlotlyChart plotlyJson="not valid json{" />);
    const { data, layout } = getPlotProps();
    expect(data).toEqual([]);
    expect(layout).toEqual({ autosize: true });
  });

  it("handles non-object JSON (null)", () => {
    render(<PlotlyChart plotlyJson="null" />);
    const { data, layout } = getPlotProps();
    expect(data).toEqual([]);
    expect(layout).toEqual({ autosize: true });
  });

  it("handles non-object JSON (number)", () => {
    render(<PlotlyChart plotlyJson="123" />);
    const { data, layout } = getPlotProps();
    expect(data).toEqual([]);
    expect(layout).toEqual({ autosize: true });
  });

  it("strips width and height from backend layout", () => {
    const json = JSON.stringify({
      data: [],
      layout: { width: 800, height: 600, title: "Stripped" },
    });
    render(<PlotlyChart plotlyJson={json} />);
    const { layout } = getPlotProps();
    expect(layout.width).toBeUndefined();
    expect(layout.height).toBeUndefined();
    expect(layout.title).toBe("Stripped");
  });

  it("preserves backend margin if present", () => {
    const backendMargin = { l: 80, r: 30, t: 50, b: 60 };
    const json = JSON.stringify({
      data: [],
      layout: { margin: backendMargin },
    });
    render(<PlotlyChart plotlyJson={json} />);
    const { layout } = getPlotProps();
    expect(layout.margin).toEqual(backendMargin);
  });

  it("uses default margin when backend has none", () => {
    const json = JSON.stringify({ data: [], layout: {} });
    render(<PlotlyChart plotlyJson={json} />);
    const { layout } = getPlotProps();
    expect(layout.margin).toEqual({ l: 60, r: 20, t: 40, b: 50 });
  });

  it("applies default height of 350px", () => {
    const json = JSON.stringify({ data: [], layout: {} });
    render(<PlotlyChart plotlyJson={json} />);
    const { style } = getPlotProps();
    expect(style.height).toBe("350px");
  });

  it("applies custom height when provided", () => {
    const json = JSON.stringify({ data: [], layout: {} });
    render(<PlotlyChart plotlyJson={json} height={500} />);
    const { style } = getPlotProps();
    expect(style.height).toBe("500px");
  });

  it("applies className when provided", () => {
    const json = JSON.stringify({ data: [], layout: {} });
    const { container } = render(
      <PlotlyChart plotlyJson={json} className="custom-class" />,
    );
    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.className).toContain("custom-class");
    expect(wrapper.className).toContain("overflow-hidden");
  });

  it("patches yaxis title with standoff: 15", () => {
    const json = JSON.stringify({
      data: [],
      layout: {
        yaxis: { title: { text: "Y Label" } },
        yaxis2: { title: { text: "Y2 Label" } },
      },
    });
    render(<PlotlyChart plotlyJson={json} />);
    const { layout } = getPlotProps();
    expect(layout.yaxis.title).toEqual({ text: "Y Label", standoff: 15 });
    expect(layout.yaxis2.title).toEqual({ text: "Y2 Label", standoff: 15 });
  });

  it("applies transparent background in light mode", () => {
    document.documentElement.classList.remove("dark");
    const json = JSON.stringify({ data: [], layout: {} });
    render(<PlotlyChart plotlyJson={json} />);
    const { layout } = getPlotProps();
    expect(layout.paper_bgcolor).toBe("transparent");
    expect(layout.plot_bgcolor).toBe("transparent");
  });

  it("applies dark theme colors when dark class is present", () => {
    document.documentElement.classList.add("dark");
    const json = JSON.stringify({ data: [], layout: {} });
    render(<PlotlyChart plotlyJson={json} />);
    const { layout } = getPlotProps();
    expect(layout.paper_bgcolor).toBe("transparent");
    expect(layout.plot_bgcolor).toBe("transparent");
    expect(layout.font.color).toContain("210");
    document.documentElement.classList.remove("dark");
  });

  it("applies theme gridcolor to subplot axes", () => {
    document.documentElement.classList.remove("dark");
    const json = JSON.stringify({
      data: [],
      layout: { xaxis2: { anchor: "y2" }, yaxis2: { anchor: "x2" } },
    });
    render(<PlotlyChart plotlyJson={json} />);
    const { layout } = getPlotProps();
    expect(layout.xaxis2.gridcolor).toBeDefined();
    expect(layout.yaxis2.gridcolor).toBeDefined();
  });
});
