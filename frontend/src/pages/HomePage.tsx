import { Title, Text, Stack } from "@mantine/core";

export function HomePage() {
  return (
    <Stack>
      <Title order={2}>LizyStudio</Title>
      <Text c="dimmed">Web GUI for LizyML</Text>
    </Stack>
  );
}
