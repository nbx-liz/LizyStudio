import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { NotFoundPage } from "./NotFoundPage";

describe("NotFoundPage", () => {
  it('renders "404" heading', () => {
    render(
      <MemoryRouter>
        <NotFoundPage />
      </MemoryRouter>,
    );
    expect(screen.getByText("404")).toBeInTheDocument();
  });

  it('renders "Page not found" text', () => {
    render(
      <MemoryRouter>
        <NotFoundPage />
      </MemoryRouter>,
    );
    expect(screen.getByText(/page not found/i)).toBeInTheDocument();
  });

  it("renders a link back to workspace", () => {
    render(
      <MemoryRouter>
        <NotFoundPage />
      </MemoryRouter>,
    );
    const link = screen.getByRole("link");
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute("href", "/");
  });
});
