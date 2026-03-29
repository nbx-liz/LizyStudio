import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster } from "sonner";
import { AppLayout } from "./components/layout/AppLayout";
import { CommandPalette } from "./components/layout/CommandPalette";
import { ErrorBoundary } from "./components/layout/ErrorBoundary";
import { Onboarding } from "./components/layout/Onboarding";
import { TooltipProvider } from "./components/ui/tooltip";
import { InferencePage } from "./pages/InferencePage";
import { JobsPage } from "./pages/JobsPage";
import { NotFoundPage } from "./pages/NotFoundPage";
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
          <ErrorBoundary>
            <AppLayout>
              <Routes>
                <Route path="/" element={<WorkspacePage />} />
                <Route path="/jobs" element={<JobsPage />} />
                <Route path="/inference" element={<InferencePage />} />
                <Route path="*" element={<NotFoundPage />} />
              </Routes>
            </AppLayout>
          </ErrorBoundary>
          <CommandPalette />
          <Onboarding />
          <Toaster richColors position="bottom-right" />
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
  );
}
