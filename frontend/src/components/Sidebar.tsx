import { NavLink, Stack, Title, Divider } from "@mantine/core";
import { useLocation, useNavigate } from "react-router-dom";
import {
  IconHome,
  IconSettings,
  IconTable,
  IconPlayerPlay,
  IconChartBar,
  IconBrain,
  IconPackage,
} from "@tabler/icons-react";

const links = [
  { label: "Home", path: "/", icon: IconHome },
  { label: "Config", path: "/config", icon: IconSettings },
  { label: "Data", path: "/data", icon: IconTable },
  { label: "Training", path: "/training", icon: IconPlayerPlay },
  { label: "Evaluation", path: "/evaluation", icon: IconChartBar },
  { label: "Prediction", path: "/prediction", icon: IconBrain },
  { label: "Artifacts", path: "/artifacts", icon: IconPackage },
] as const;

export function Sidebar() {
  const location = useLocation();
  const navigate = useNavigate();

  return (
    <Stack gap={0} p="sm">
      <Title order={4} mb="sm">
        LizyStudio
      </Title>
      <Divider mb="sm" />
      {links.map(({ label, path, icon: Icon }) => (
        <NavLink
          key={path}
          label={label}
          leftSection={<Icon size={18} />}
          active={location.pathname === path}
          onClick={() => navigate(path)}
        />
      ))}
    </Stack>
  );
}
