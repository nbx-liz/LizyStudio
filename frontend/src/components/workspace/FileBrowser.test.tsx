import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FileBrowser } from "./FileBrowser";

vi.mock("@/api/files", () => ({
  fetchDirectory: vi.fn(),
}));

afterEach(cleanup);

function renderWithQuery(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>,
  );
}

describe("FileBrowser", () => {
  it('renders default "Browse" button when no trigger provided', () => {
    renderWithQuery(<FileBrowser onSelect={vi.fn()} />);
    expect(screen.getByRole("button", { name: /browse/i })).toBeInTheDocument();
  });

  it("renders custom trigger when provided", () => {
    renderWithQuery(
      <FileBrowser
        onSelect={vi.fn()}
        trigger={<button type="button">Open Files</button>}
      />,
    );
    expect(
      screen.getByRole("button", { name: /open files/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /browse/i }),
    ).not.toBeInTheDocument();
  });

  it("opens dialog on click and shows title", () => {
    renderWithQuery(<FileBrowser onSelect={vi.fn()} />);
    const browseBtn = screen.getByRole("button", { name: /browse/i });
    fireEvent.click(browseBtn);
    expect(screen.getByText("Select Data File")).toBeInTheDocument();
  });
});
