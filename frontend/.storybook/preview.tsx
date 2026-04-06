import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Preview } from "@storybook/react";
import { MemoryRouter } from "react-router-dom";
import "../src/index.css";

const preview: Preview = {
  parameters: {
    controls: { matchers: { color: /(background|color)$/i, date: /Date$/i } },
  },
  decorators: [
    (Story) => {
      const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false } },
      });
      return (
        <QueryClientProvider client={queryClient}>
          <MemoryRouter>
            <Story />
          </MemoryRouter>
        </QueryClientProvider>
      );
    },
  ],
};
export default preview;
