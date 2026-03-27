import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster } from "sonner";
import { AppLayout } from "./components/layout/AppLayout";
import { TooltipProvider } from "./components/ui/tooltip";
import { InferencePage } from "./pages/InferencePage";
import { JobsPage } from "./pages/JobsPage";
import { WorkspacePage } from "./pages/WorkspacePage";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider delayDuration={300}>
        <BrowserRouter>
          <AppLayout>
            <Routes>
              <Route path="/" element={<WorkspacePage />} />
              <Route path="/jobs" element={<JobsPage />} />
              <Route path="/inference" element={<InferencePage />} />
            </Routes>
          </AppLayout>
          <Toaster richColors position="bottom-right" />
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
  );
}
