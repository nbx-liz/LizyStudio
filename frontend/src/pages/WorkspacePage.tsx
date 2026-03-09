import { Grid, Title, Text, Paper, Stack } from "@mantine/core";

import { DataPanel } from "../components/DataPanel";

export function WorkspacePage() {
  return (
    <Grid gutter="md">
      {/* Left: Data Panel */}
      <Grid.Col span={4}>
        <DataPanel />
      </Grid.Col>

      {/* Center: Model Panel (stub) */}
      <Grid.Col span={4}>
        <Paper p="md" withBorder>
          <Stack>
            <Title order={5}>Model</Title>
            <Text c="dimmed" size="sm">
              Configure model settings and run fit/tune.
            </Text>
          </Stack>
        </Paper>
      </Grid.Col>

      {/* Right: Results Panel (stub) */}
      <Grid.Col span={4}>
        <Paper p="md" withBorder>
          <Stack>
            <Title order={5}>Results</Title>
            <Text c="dimmed" size="sm">
              Results will appear here after fitting.
            </Text>
          </Stack>
        </Paper>
      </Grid.Col>
    </Grid>
  );
}
