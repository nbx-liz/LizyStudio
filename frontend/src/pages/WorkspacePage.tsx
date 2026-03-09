import { useState, useCallback } from "react";
import { Grid } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { DataPanel } from "../components/DataPanel";
import { ModelPanel } from "../components/ModelPanel";
import { ResultsPanel } from "../components/ResultsPanel";
import { runFit, runTune } from "../api/jobs";
import { fetchStatus } from "../api/workspace";

export function WorkspacePage() {
  const queryClient = useQueryClient();
  const [currentJobId, setCurrentJobId] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  const statusQuery = useQuery({
    queryKey: ["workspace-status"],
    queryFn: fetchStatus,
  });
  const hasData = statusQuery.data?.has_data ?? false;

  const onJobCreated = useCallback((jobId: string) => {
    setCurrentJobId(jobId);
  }, []);

  const onFit = useCallback(async () => {
    setRunning(true);
    try {
      const res = await runFit();
      setCurrentJobId(res.job_id);
      queryClient.invalidateQueries({ queryKey: ["job"] });
      queryClient.invalidateQueries({ queryKey: ["workspace-status"] });
    } catch (e) {
      notifications.show({ title: "Fit failed", message: String(e), color: "red" });
    } finally {
      setRunning(false);
    }
  }, [queryClient]);

  const onTune = useCallback(async () => {
    setRunning(true);
    try {
      const res = await runTune();
      setCurrentJobId(res.job_id);
      queryClient.invalidateQueries({ queryKey: ["job"] });
      queryClient.invalidateQueries({ queryKey: ["workspace-status"] });
    } catch (e) {
      notifications.show({ title: "Tune failed", message: String(e), color: "red" });
    } finally {
      setRunning(false);
    }
  }, [queryClient]);

  return (
    <Grid gutter="md">
      {/* Left: Data Panel */}
      <Grid.Col span={4}>
        <DataPanel />
      </Grid.Col>

      {/* Center: Model Panel */}
      <Grid.Col span={4}>
        <ModelPanel onFit={onFit} onTune={onTune} running={running} hasData={hasData} />
      </Grid.Col>

      {/* Right: Results Panel */}
      <Grid.Col span={4}>
        <ResultsPanel jobId={currentJobId} onJobCreated={onJobCreated} />
      </Grid.Col>
    </Grid>
  );
}
