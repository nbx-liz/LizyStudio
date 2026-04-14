import type { Meta, StoryObj } from "@storybook/react";
import { fn } from "storybook/test";
import { CvSection, type CvState, INITIAL_CV_STATE } from "./CvSection";

const meta: Meta<typeof CvSection> = {
  title: "Workspace/CvSection",
  component: CvSection,
  parameters: { layout: "padded" },
  args: {
    onChange: fn(),
    nonExcludedCols: [
      {
        name: "age",
        dtype: "int64",
        unique_count: 50,
        suggested_type: "numeric",
        suggested_excluded: false,
        exclude_reason: null,
      },
      {
        name: "gender",
        dtype: "object",
        unique_count: 2,
        suggested_type: "categorical",
        suggested_excluded: false,
        exclude_reason: null,
      },
      {
        name: "city",
        dtype: "object",
        unique_count: 3,
        suggested_type: "categorical",
        suggested_excluded: false,
        exclude_reason: null,
      },
    ],
    uiSchema: {
      capabilities: {
        cv_strategies: [
          "kfold",
          "stratified_kfold",
          "group_kfold",
          "stratified_group_kfold",
          "time_series",
        ],
      },
    } as never,
  },
};
export default meta;

type Story = StoryObj<typeof CvSection>;

export const KFold: Story = {
  args: {
    cv: { ...INITIAL_CV_STATE, strategy: "kfold" },
  },
};

export const StratifiedKFold: Story = {
  args: {
    cv: { ...INITIAL_CV_STATE, strategy: "stratified_kfold" },
  },
};

export const GroupKFold: Story = {
  args: {
    cv: { ...INITIAL_CV_STATE, strategy: "group_kfold" },
  },
};

export const TimeSeries: Story = {
  args: {
    cv: {
      ...INITIAL_CV_STATE,
      strategy: "time_series",
      gap: 0,
      trainSizeMax: undefined,
      testSizeMax: undefined,
    } satisfies CvState,
  },
};
