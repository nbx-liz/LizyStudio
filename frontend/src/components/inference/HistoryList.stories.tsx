import type { Meta, StoryObj } from "@storybook/react";
import { fn } from "@storybook/test";
import type { InferenceRecord } from "@/api/inference";
import { HistoryList } from "./HistoryList";

const meta: Meta<typeof HistoryList> = {
  title: "Inference/HistoryList",
  component: HistoryList,
  parameters: { layout: "padded" },
  args: {
    onSelect: fn(),
  },
};
export default meta;

type Story = StoryObj<typeof HistoryList>;

function makeRecord(overrides: Partial<InferenceRecord>): InferenceRecord {
  return {
    inf_id: "inf-1",
    job_id: "job-1",
    data_ref: {
      source_type: "path",
      path: "/data/test.csv",
      filename: "test.csv",
      fingerprint: "abc",
      shape: [100, 5],
    },
    has_ground_truth: false,
    created_at: new Date().toISOString(),
    row_count: 100,
    warnings: [],
    ...overrides,
  };
}

export const Empty: Story = {
  args: {
    records: [],
    selectedInfId: null,
  },
};

export const WithRecords: Story = {
  args: {
    records: [
      makeRecord({ inf_id: "inf-3", row_count: 200, has_ground_truth: true }),
      makeRecord({ inf_id: "inf-2", row_count: 150, has_ground_truth: false }),
      makeRecord({ inf_id: "inf-1", row_count: 100, has_ground_truth: true }),
    ],
    selectedInfId: "inf-2",
  },
};
