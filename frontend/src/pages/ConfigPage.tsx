import { Title, Text, Stack } from "@mantine/core";

export function ConfigPage() {
  return (
    <Stack>
      <Title order={2}>Config Editor</Title>
      <Text c="dimmed">Build and validate LizyML configurations.</Text>
    </Stack>
  );
}
