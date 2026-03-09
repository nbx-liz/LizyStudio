import { useState } from "react";
import { Group, Stack, Text, UnstyledButton } from "@mantine/core";
import { IconChevronDown, IconChevronRight } from "@tabler/icons-react";

interface ConfigTreeViewProps {
  data: Record<string, unknown>;
  defaultExpandDepth?: number;
}

export function ConfigTreeView({
  data,
  defaultExpandDepth = 1,
}: ConfigTreeViewProps) {
  return (
    <Stack gap={0}>
      {Object.entries(data).map(([key, value]) => (
        <TreeNode
          key={key}
          label={key}
          value={value}
          depth={0}
          defaultExpandDepth={defaultExpandDepth}
        />
      ))}
    </Stack>
  );
}

function TreeNode({
  label,
  value,
  depth,
  defaultExpandDepth,
}: {
  label: string;
  value: unknown;
  depth: number;
  defaultExpandDepth: number;
}) {
  const isExpandable =
    value !== null && typeof value === "object";
  const [expanded, setExpanded] = useState(depth < defaultExpandDepth);

  const indent = depth * 16;

  if (!isExpandable) {
    return (
      <Group gap={4} pl={indent} py={2} wrap="nowrap">
        <Text size="xs" fw={600} c="dimmed" style={{ minWidth: 16 }}>
          {" "}
        </Text>
        <Text size="xs" fw={500}>
          {label}:
        </Text>
        <PrimitiveValue value={value} />
      </Group>
    );
  }

  const entries = Array.isArray(value)
    ? value.map((v, i) => [String(i), v] as [string, unknown])
    : Object.entries(value as Record<string, unknown>);

  return (
    <>
      <UnstyledButton
        onClick={() => setExpanded((e) => !e)}
        pl={indent}
        py={2}
        style={{ width: "100%" }}
      >
        <Group gap={4} wrap="nowrap">
          {expanded ? (
            <IconChevronDown size={14} />
          ) : (
            <IconChevronRight size={14} />
          )}
          <Text size="xs" fw={600}>
            {label}
          </Text>
          {Array.isArray(value) && (
            <Text size="xs" c="dimmed">
              [{value.length}]
            </Text>
          )}
          {!expanded && !Array.isArray(value) && (
            <Text size="xs" c="dimmed">
              {"{...}"}
            </Text>
          )}
        </Group>
      </UnstyledButton>
      {expanded &&
        entries.map(([childKey, childValue]) => (
          <TreeNode
            key={childKey}
            label={Array.isArray(value) ? `[${childKey}]` : childKey}
            value={childValue}
            depth={depth + 1}
            defaultExpandDepth={defaultExpandDepth}
          />
        ))}
    </>
  );
}

function PrimitiveValue({ value }: { value: unknown }) {
  if (value === null || value === undefined) {
    return (
      <Text size="xs" c="dimmed" fs="italic">
        null
      </Text>
    );
  }
  if (typeof value === "boolean") {
    return (
      <Text size="xs" c="teal">
        {String(value)}
      </Text>
    );
  }
  if (typeof value === "number") {
    return (
      <Text size="xs" c="blue">
        {String(value)}
      </Text>
    );
  }
  return (
    <Text size="xs" style={{ wordBreak: "break-word" }}>
      {String(value)}
    </Text>
  );
}
