import { useState, useCallback } from "react";
import { Grid } from "@mantine/core";

import { DataPanel } from "../components/DataPanel";
import { ModelPanel } from "../components/ModelPanel";
import { ResultsPanel } from "../components/ResultsPanel";

export function WorkspacePage() {
  const [currentJobId, setCurrentJobId] = useState<string | null>(null);

  const onJobCreated = useCallback((jobId: string) => {
    setCurrentJobId(jobId);
  }, []);

  return (
    <Grid gutter="md">
      {/* Left: Data Panel */}
      <Grid.Col span={4}>
        <DataPanel />
      </Grid.Col>

      {/* Center: Model Panel */}
      <Grid.Col span={4}>
        <ModelPanel />
      </Grid.Col>

      {/* Right: Results Panel */}
      <Grid.Col span={4}>
        <ResultsPanel jobId={currentJobId} onJobCreated={onJobCreated} />
      </Grid.Col>
    </Grid>
  );
}
