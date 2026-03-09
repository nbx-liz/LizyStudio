import { NavLink, Stack, Title, Divider } from "@mantine/core";
import { useLocation, useNavigate } from "react-router-dom";
import {
  IconDashboard,
  IconListCheck,
  IconBrain,
} from "@tabler/icons-react";

const links = [
  { label: "Workspace", path: "/", icon: IconDashboard },
  { label: "Jobs", path: "/jobs", icon: IconListCheck },
  { label: "Inference", path: "/inference", icon: IconBrain },
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
