import type { Meta, StoryObj } from "@storybook/react";
import { HttpResponse, http } from "msw";
import { FoldPreview } from "./FoldPreview";

const meta: Meta<typeof FoldPreview> = {
  title: "Workspace/FoldPreview",
  component: FoldPreview,
  parameters: { layout: "padded" },
};
export default meta;

type Story = StoryObj<typeof FoldPreview>;

const kfoldFolds = [
  { fold: 0, train_size: 800, valid_size: 200 },
  { fold: 1, train_size: 800, valid_size: 200 },
  { fold: 2, train_size: 800, valid_size: 200 },
  { fold: 3, train_size: 800, valid_size: 200 },
  { fold: 4, train_size: 800, valid_size: 200 },
];

const timeSeriesFolds = [
  { fold: 0, train_size: 200, valid_size: 200 },
  { fold: 1, train_size: 400, valid_size: 200 },
  { fold: 2, train_size: 600, valid_size: 200 },
  { fold: 3, train_size: 800, valid_size: 200 },
  { fold: 4, train_size: 1000, valid_size: 200 },
];

export const KFold5: Story = {
  args: { enabled: true, cvKey: "kfold-5" },
  parameters: {
    msw: {
      handlers: [
        http.get("/api/workspace/data/split-preview", () =>
          HttpResponse.json({
            strategy: "kfold",
            n_splits: 5,
            folds: kfoldFolds,
          }),
        ),
      ],
    },
  },
};

export const TimeSeries: Story = {
  args: { enabled: true, cvKey: "time_series-5" },
  parameters: {
    msw: {
      handlers: [
        http.get("/api/workspace/data/split-preview", () =>
          HttpResponse.json({
            strategy: "time_series",
            n_splits: 5,
            folds: timeSeriesFolds,
          }),
        ),
      ],
    },
  },
};

export const Disabled: Story = {
  args: { enabled: false, cvKey: "" },
};

export const Empty: Story = {
  args: { enabled: true, cvKey: "empty" },
  parameters: {
    msw: {
      handlers: [
        http.get("/api/workspace/data/split-preview", () =>
          HttpResponse.json({
            strategy: "blocked_group_kfold",
            n_splits: 5,
            folds: [],
          }),
        ),
      ],
    },
  },
};
