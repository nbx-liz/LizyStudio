import type { Meta, StoryObj } from "@storybook/react";
import { fn } from "storybook/test";
import {
  BlockedGroupKFoldEditor,
  INITIAL_BLOCKED_STATE,
} from "./BlockedGroupKFoldEditor";
import { INITIAL_CV_STATE } from "./CvSection";

const sampleCols = [
  {
    name: "year",
    dtype: "object",
    unique_count: 5,
    suggested_type: "categorical" as const,
    suggested_excluded: false,
    exclude_reason: null,
  },
  {
    name: "user_id",
    dtype: "int64",
    unique_count: 100,
    suggested_type: "numeric" as const,
    suggested_excluded: false,
    exclude_reason: null,
  },
  {
    name: "region",
    dtype: "object",
    unique_count: 3,
    suggested_type: "categorical" as const,
    suggested_excluded: false,
    exclude_reason: null,
  },
  {
    name: "score",
    dtype: "float64",
    unique_count: 50,
    suggested_type: "numeric" as const,
    suggested_excluded: false,
    exclude_reason: null,
  },
];

const meta: Meta<typeof BlockedGroupKFoldEditor> = {
  title: "Workspace/BlockedGroupKFoldEditor",
  component: BlockedGroupKFoldEditor,
  parameters: { layout: "padded" },
  args: {
    onChange: fn(),
    onBlockedChange: fn(),
    nonExcludedCols: sampleCols,
  },
};
export default meta;

type Story = StoryObj<typeof BlockedGroupKFoldEditor>;

export const Default: Story = {
  args: {
    cv: { ...INITIAL_CV_STATE, strategy: "blocked_group_kfold" },
    blocked: INITIAL_BLOCKED_STATE,
  },
};

export const WithBlockColumn: Story = {
  args: {
    cv: {
      ...INITIAL_CV_STATE,
      strategy: "blocked_group_kfold",
      timeCol: "year",
    },
    blocked: { ...INITIAL_BLOCKED_STATE, cutoffs: ["2024"] },
  },
};

export const WithCutoffs: Story = {
  args: {
    cv: {
      ...INITIAL_CV_STATE,
      strategy: "blocked_group_kfold",
      timeCol: "year",
      groupCol: "user_id",
    },
    blocked: {
      ...INITIAL_BLOCKED_STATE,
      cutoffs: ["2022", "2024"],
    },
  },
};

export const SlidingMode: Story = {
  args: {
    cv: {
      ...INITIAL_CV_STATE,
      strategy: "blocked_group_kfold",
      timeCol: "year",
      groupCol: "region",
      folds: 3,
    },
    blocked: {
      ...INITIAL_BLOCKED_STATE,
      cutoffs: ["2021", "2023", "2024"],
      blockMode: "sliding",
      trainWindow: 2,
    },
  },
};

export const FullyConfigured: Story = {
  args: {
    cv: {
      ...INITIAL_CV_STATE,
      strategy: "blocked_group_kfold",
      timeCol: "year",
      groupCol: "user_id",
      folds: 5,
      shuffle: true,
      minTrainRows: 100,
      minValidRows: 50,
    },
    blocked: {
      cutoffs: ["2021", "2023", "2024"],
      blockMode: "expanding",
      trainWindow: 1,
      stratify: "on",
    },
  },
};
