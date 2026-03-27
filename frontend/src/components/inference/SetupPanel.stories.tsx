import type { Meta, StoryObj } from "@storybook/react";
import { fn } from "@storybook/test";
import type { JobSummary } from "@/api/types";
import { SetupPanel } from "./SetupPanel";

const meta: Meta<typeof SetupPanel> = {
  title: "Inference/SetupPanel",
  component: SetupPanel,
  parameters: { layout: "padded" },
  args: {
    onSelectJob: fn(),
    onSelectInf: fn(),
    onRunInference: fn(),
  },
};
export default meta;

type Story = StoryObj<typeof SetupPanel>;

function makeJob(overrides: Partial<JobSummary>): JobSummary {
  return {
    job_id: "job-1",
    job_type: "fit",
    status: "completed",
    backend_name: "lizyml",
    model_name: "LGBMClassifier",
    created_at: new Date().toISOString(),
    completed_at: new Date().toISOString(),
    error: null,
    primary_score: 0.95,
    ...overrides,
  };
}

export const NoModels: Story = {
  args: {
    completedJobs: [],
    selectedJobId: null,
    history: [],
    selectedInfId: null,
    isRunning: false,
  },
};

export const ModelSelected: Story = {
  args: {
    completedJobs: [
      makeJob({ job_id: "job-1", model_name: "LGBMClassifier" }),
      makeJob({ job_id: "job-2", model_name: "LGBMRegressor" }),
    ],
    selectedJobId: "job-1",
    history: [],
    selectedInfId: null,
    isRunning: false,
  },
};

export const Running: Story = {
  args: {
    completedJobs: [makeJob({ job_id: "job-1" })],
    selectedJobId: "job-1",
    history: [],
    selectedInfId: null,
    isRunning: true,
  },
};
