import type { Meta, StoryObj } from "@storybook/react";
import { fn } from "storybook/test";
import { SearchSpaceTable } from "./SearchSpaceTable";

const meta: Meta<typeof SearchSpaceTable> = {
  title: "Workspace/SearchSpaceTable",
  component: SearchSpaceTable,
  parameters: { layout: "padded" },
  args: {
    onChange: fn(),
    stepMap: { learning_rate: 0.01, n_estimators: 1 },
    task: "binary",
  },
};
export default meta;

type Story = StoryObj<typeof SearchSpaceTable>;

export const Empty: Story = {
  args: {
    space: {},
    modelParams: {},
  },
};

export const WithHyperparameters: Story = {
  args: {
    space: {
      learning_rate: { mode: "range", low: 0.01, high: 0.3, log: true },
      n_estimators: { mode: "fixed", value: 1000 },
      max_depth: { mode: "range", low: 3, high: 12 },
      subsample: { mode: "range", low: 0.5, high: 1.0 },
    },
    modelParams: {
      learning_rate: 0.1,
      n_estimators: 1000,
      max_depth: -1,
      subsample: 1.0,
    },
    catalog: [
      {
        key: "learning_rate",
        type: "float",
        default_mode: "range",
        low: 0.001,
        high: 0.3,
        log: true,
        description: "Learning rate",
      },
      {
        key: "n_estimators",
        type: "integer",
        default_mode: "fixed",
        description: "Number of boosting rounds",
      },
      {
        key: "max_depth",
        type: "integer",
        default_mode: "range",
        low: 3,
        high: 12,
        description: "Max tree depth",
      },
      {
        key: "subsample",
        type: "float",
        default_mode: "range",
        low: 0.5,
        high: 1.0,
        description: "Row sampling ratio",
      },
    ] as never[],
  },
};
