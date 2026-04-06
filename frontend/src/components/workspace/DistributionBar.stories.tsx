import type { Meta, StoryObj } from "@storybook/react";
import { DistributionBar } from "./DistributionBar";

const meta: Meta<typeof DistributionBar> = {
  title: "Workspace/DistributionBar",
  component: DistributionBar,
  parameters: { layout: "padded" },
};
export default meta;

type Story = StoryObj<typeof DistributionBar>;

export const Categorical: Story = {
  args: {
    totalCount: 1000,
    valueCounts: [
      { value: "Tokyo", count: 400 },
      { value: "Osaka", count: 300 },
      { value: "Nagoya", count: 200 },
      { value: "Fukuoka", count: 100 },
    ],
  },
};

export const CategoricalWithOther: Story = {
  args: {
    totalCount: 1000,
    valueCounts: [
      { value: "A", count: 300 },
      { value: "B", count: 250 },
      { value: "C", count: 150 },
      { value: "__other__", count: 300 },
    ],
  },
};

export const Numeric: Story = {
  args: {
    totalCount: 500,
    valueCounts: [
      { value: "0-10", count: 50 },
      { value: "10-20", count: 80 },
      { value: "20-30", count: 120 },
      { value: "30-40", count: 100 },
      { value: "40-50", count: 90 },
      { value: "50-60", count: 60 },
    ],
  },
};

export const SingleValue: Story = {
  args: {
    totalCount: 100,
    valueCounts: [{ value: "constant", count: 100 }],
  },
};

export const Empty: Story = {
  args: {
    totalCount: 0,
    valueCounts: [],
  },
};

export const TallBar: Story = {
  args: {
    totalCount: 1000,
    height: 16,
    valueCounts: [
      { value: "Male", count: 520 },
      { value: "Female", count: 480 },
    ],
  },
};
