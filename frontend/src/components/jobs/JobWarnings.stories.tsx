import type { Meta, StoryObj } from "@storybook/react";
import { expect, userEvent, within } from "storybook/test";
import { JobWarnings } from "./JobWarnings";

const MEMORY_WARNING =
  "Estimated peak memory for this fit is about 12 GB (max_depth=-1, num_leaves=4096).";

const meta: Meta<typeof JobWarnings> = {
  title: "Jobs/JobWarnings",
  component: JobWarnings,
  parameters: { layout: "padded" },
  args: {
    warnings: [MEMORY_WARNING],
    status: "completed",
  },
};
export default meta;

type Story = StoryObj<typeof JobWarnings>;

export const SingleCompleted: Story = {};

export const RunningLive: Story = {
  args: { status: "running" },
};

export const TwoTuneMessages: Story = {
  args: {
    warnings: [
      MEMORY_WARNING,
      "Trial 3 estimated peak memory is about 18 GB (max_depth=-1, num_leaves=8192).",
    ],
  },
};

export const Failed: Story = {
  args: { status: "failed" },
};

export const Empty: Story = {
  args: { warnings: [] },
};

export const ManyExpanded: Story = {
  args: {
    warnings: [
      MEMORY_WARNING,
      "Trial 3 estimated peak memory is about 18 GB.",
      "Trial 7 estimated peak memory is about 22 GB.",
      "Trial 9 estimated peak memory is about 25 GB.",
    ],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByTestId("job-warnings-toggle"));
    await expect(canvas.getAllByTestId("job-warning-item")).toHaveLength(4);
  },
};
