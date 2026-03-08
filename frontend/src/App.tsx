import { Routes, Route } from "react-router-dom";
import { AppShell } from "@mantine/core";

import { Sidebar } from "./components/Sidebar";
import { HomePage } from "./pages/HomePage";
import { ConfigPage } from "./pages/ConfigPage";
import { DataPage } from "./pages/DataPage";
import { TrainingPage } from "./pages/TrainingPage";
import { EvaluationPage } from "./pages/EvaluationPage";
import { PredictionPage } from "./pages/PredictionPage";
import { ArtifactsPage } from "./pages/ArtifactsPage";

export function App() {
  return (
    <AppShell navbar={{ width: 220, breakpoint: "sm" }} padding="md">
      <AppShell.Navbar>
        <Sidebar />
      </AppShell.Navbar>
      <AppShell.Main>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/config" element={<ConfigPage />} />
          <Route path="/data" element={<DataPage />} />
          <Route path="/training" element={<TrainingPage />} />
          <Route path="/evaluation" element={<EvaluationPage />} />
          <Route path="/prediction" element={<PredictionPage />} />
          <Route path="/artifacts" element={<ArtifactsPage />} />
        </Routes>
      </AppShell.Main>
    </AppShell>
  );
}
