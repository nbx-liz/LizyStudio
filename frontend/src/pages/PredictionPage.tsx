import { Title, Text, Stack } from "@mantine/core";

export function PredictionPage() {
  return (
    <Stack>
      <Title order={2}>Prediction</Title>
      <Text c="dimmed">Run inference on new data.</Text>
    </Stack>
  );
}
