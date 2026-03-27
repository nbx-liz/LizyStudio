import type { Meta, StoryObj } from "@storybook/react";
import { PlotlyChart } from "./PlotlyChart";

const meta: Meta<typeof PlotlyChart> = {
  title: "Workspace/PlotlyChart",
  component: PlotlyChart,
  parameters: { layout: "padded" },
};
export default meta;

type Story = StoryObj<typeof PlotlyChart>;

const barChartJson = JSON.stringify({
  data: [
    {
      type: "bar",
      x: ["Feature A", "Feature B", "Feature C", "Feature D", "Feature E"],
      y: [0.35, 0.28, 0.2, 0.12, 0.05],
      marker: {
        color: ["#3b82f6", "#60a5fa", "#93bbfd", "#bfdbfe", "#dbeafe"],
      },
    },
  ],
  layout: {
    title: "Feature Importance",
    xaxis: { title: "Feature" },
    yaxis: { title: "Importance" },
  },
});

const lineChartJson = JSON.stringify({
  data: [
    {
      type: "scatter",
      mode: "lines+markers",
      x: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
      y: [0.6, 0.7, 0.75, 0.78, 0.82, 0.85, 0.87, 0.88, 0.885, 0.89],
      name: "Train AUC",
    },
    {
      type: "scatter",
      mode: "lines+markers",
      x: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
      y: [0.55, 0.62, 0.68, 0.71, 0.73, 0.74, 0.745, 0.75, 0.75, 0.74],
      name: "Valid AUC",
    },
  ],
  layout: {
    title: "Learning Curve",
    xaxis: { title: "Fold" },
    yaxis: { title: "AUC" },
  },
});

const confusionMatrixJson = JSON.stringify({
  data: [
    {
      type: "heatmap",
      z: [
        [42, 8],
        [5, 45],
      ],
      x: ["Predicted 0", "Predicted 1"],
      y: ["Actual 0", "Actual 1"],
      colorscale: "Blues",
      text: [
        ["42", "8"],
        ["5", "45"],
      ],
      texttemplate: "%{text}",
    },
  ],
  layout: { title: "Confusion Matrix" },
});

export const BarChart: Story = {
  args: { plotlyJson: barChartJson, height: 350 },
};

export const LineChart: Story = {
  args: { plotlyJson: lineChartJson, height: 350 },
};

export const ConfusionMatrix: Story = {
  args: { plotlyJson: confusionMatrixJson, height: 400 },
};

export const EmptyData: Story = {
  args: { plotlyJson: "{}", height: 300 },
};

export const InvalidJson: Story = {
  args: { plotlyJson: "not valid json", height: 300 },
};
