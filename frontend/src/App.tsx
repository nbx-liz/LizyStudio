import { Routes, Route } from "react-router-dom";
import { AppShell } from "@mantine/core";

import { Sidebar } from "./components/Sidebar";
import { WorkspacePage } from "./pages/WorkspacePage";
import { JobsPage } from "./pages/JobsPage";
import { InferencePage } from "./pages/InferencePage";

export function App() {
  return (
    <AppShell navbar={{ width: 220, breakpoint: "sm" }} padding="md">
      <AppShell.Navbar>
        <Sidebar />
      </AppShell.Navbar>
      <AppShell.Main>
        <Routes>
          <Route path="/" element={<WorkspacePage />} />
          <Route path="/jobs" element={<JobsPage />} />
          <Route path="/inference" element={<InferencePage />} />
        </Routes>
      </AppShell.Main>
    </AppShell>
  );
}
