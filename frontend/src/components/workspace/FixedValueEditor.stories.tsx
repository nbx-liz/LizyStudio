import type { Meta, StoryObj } from "@storybook/react";
import { fn } from "storybook/test";
import { FixedValueEditor } from "./FixedValueEditor";

const meta: Meta<typeof FixedValueEditor> = {
  title: "Workspace/FixedValueEditor",
  component: FixedValueEditor,
  parameters: { layout: "padded" },
  args: {
    onChange: fn(),
  },
};
export default meta;

type Story = StoryObj<typeof FixedValueEditor>;

export const NumberType: Story = {
  args: {
    paramType: "number",
    value: 0.1,
    step: 0.01,
  },
};

export const IntegerType: Story = {
  args: {
    paramType: "integer",
    value: 6,
    step: 1,
  },
};

export const BooleanTrue: Story = {
  args: {
    paramType: "boolean",
    value: true,
  },
};

export const BooleanFalse: Story = {
  args: {
    paramType: "boolean",
    value: false,
  },
};

/** Enum with 3 options renders as SegmentGroup buttons. */
export const StringSegment: Story = {
  name: "String (≤4 options → Segment)",
  args: {
    paramType: "string",
    value: "binary",
    options: ["binary", "multiclass", "regression"],
  },
};

/** Enum with 4 options still renders as SegmentGroup (boundary). */
export const StringSegmentBoundary: Story = {
  name: "String (4 options → Segment boundary)",
  args: {
    paramType: "string",
    value: "cpu",
    options: ["cpu", "gpu", "tpu", "auto"],
  },
};

/** Enum with 5+ options renders as Select dropdown. */
export const StringSelect: Story = {
  name: "String (5+ options → Select)",
  args: {
    paramType: "string",
    value: "auc",
    options: ["auc", "f1", "accuracy", "logloss", "mse"],
  },
};

export const StringNoOptions: Story = {
  name: "String (no options → Text Input)",
  args: {
    paramType: "string",
    value: "custom_value",
  },
};
