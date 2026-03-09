import { useState, useCallback } from "react";
import {
  Button,
  Group,
  Modal,
  SegmentedControl,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";

import { exportJob } from "../api/jobs";

interface ExportDialogProps {
  opened: boolean;
  onClose: () => void;
  jobId: string;
}

export function ExportDialog({ opened, onClose, jobId }: ExportDialogProps) {
  const [exportType, setExportType] = useState<"model" | "report">("model");
  const [outputPath, setOutputPath] = useState(
    `./exports/${jobId}_${exportType}`,
  );
  const [loading, setLoading] = useState(false);

  const onExportTypeChange = useCallback(
    (val: string) => {
      const t = val as "model" | "report";
      setExportType(t);
      setOutputPath(`./exports/${jobId}_${t}`);
    },
    [jobId],
  );

  const onExport = useCallback(async () => {
    setLoading(true);
    try {
      const res = await exportJob(jobId, exportType, outputPath);
      notifications.show({
        title: "Export complete",
        message: `Exported to ${res.exported_path}`,
        color: "green",
      });
      onClose();
    } catch (e) {
      notifications.show({
        title: "Export failed",
        message: String(e),
        color: "red",
      });
    } finally {
      setLoading(false);
    }
  }, [jobId, exportType, outputPath, onClose]);

  return (
    <Modal opened={opened} onClose={onClose} title="Export Job" centered>
      <Stack gap="md">
        <SegmentedControl
          value={exportType}
          onChange={onExportTypeChange}
          data={[
            { label: "Model", value: "model" },
            { label: "Report", value: "report" },
          ]}
          fullWidth
        />
        <Text size="xs" c="dimmed">
          {exportType === "model"
            ? "Includes: pkl + metadata JSON"
            : "HTML — metrics/plots"}
        </Text>

        <TextInput
          label="Output Path"
          value={outputPath}
          onChange={(e) => setOutputPath(e.currentTarget.value)}
        />

        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={onExport} loading={loading}>
            Export
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
