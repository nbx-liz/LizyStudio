import type { Meta, StoryObj } from "@storybook/react";
import { fn } from "storybook/test";
import type { JobSummary } from "@/api/types";
import { JobList } from "./JobList";

const meta: Meta<typeof JobList> = {
  title: "Jobs/JobList",
  component: JobList,
  parameters: { layout: "padded" },
  args: {
    onSelectJob: fn(),
  },
};
export default meta;

type Story = StoryObj<typeof JobList>;

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
    parent_job_id: null,
    ...overrides,
  };
}

export const Empty: Story = {
  args: {
    jobs: [],
    selectedJobId: null,
  },
};

export const WithMixedJobs: Story = {
  args: {
    jobs: [
      makeJob({
        job_id: "job-1",
        status: "completed",
        job_type: "fit",
        primary_score: 0.952,
      }),
      makeJob({
        job_id: "job-2",
        status: "running",
        job_type: "tune",
        primary_score: null,
      }),
      makeJob({
        job_id: "job-3",
        status: "failed",
        job_type: "fit",
        error: "Out of memory",
        primary_score: null,
      }),
      makeJob({
        job_id: "job-4",
        status: "completed",
        job_type: "tune",
        primary_score: 0.971,
      }),
    ],
    selectedJobId: "job-1",
  },
};

export const SingleJob: Story = {
  args: {
    jobs: [makeJob({ job_id: "job-1" })],
    selectedJobId: "job-1",
  },
};
