import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ErrorBoundary } from "./ErrorBoundary";

function ThrowingComponent({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) throw new Error("Test error message");
  return <div>Normal content</div>;
}

describe("ErrorBoundary", () => {
  it("renders children when no error", () => {
    render(
      <ErrorBoundary>
        <div>Child content</div>
      </ErrorBoundary>,
    );
    expect(screen.getByText("Child content")).toBeInTheDocument();
  });

  it("renders error UI when child throws", () => {
    // Suppress console.error for expected error
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    render(
      <ErrorBoundary>
        <ThrowingComponent shouldThrow />
      </ErrorBoundary>,
    );

    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
    expect(screen.getByText("Test error message")).toBeInTheDocument();
    expect(screen.getByText("Try again")).toBeInTheDocument();

    spy.mockRestore();
  });

  it("recovers when 'Try again' is clicked", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    let shouldThrow = true;

    function ConditionalThrow() {
      if (shouldThrow) throw new Error("Boom");
      return <div>Recovered</div>;
    }

    const { rerender } = render(
      <ErrorBoundary>
        <ConditionalThrow />
      </ErrorBoundary>,
    );

    expect(screen.getByRole("alert")).toBeInTheDocument();

    // Stop throwing and click retry
    shouldThrow = false;
    fireEvent.click(screen.getByText("Try again"));

    rerender(
      <ErrorBoundary>
        <ConditionalThrow />
      </ErrorBoundary>,
    );

    expect(screen.getByText("Recovered")).toBeInTheDocument();
    spy.mockRestore();
  });

  it("shows empty message when error has no message text", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    function ThrowEmptyMessage(): never {
      throw new Error();
    }

    render(
      <ErrorBoundary>
        <ThrowEmptyMessage />
      </ErrorBoundary>,
    );

    // Error with empty message still renders the alert and heading
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
    expect(screen.getByText("Try again")).toBeInTheDocument();
    spy.mockRestore();
  });

  it("does not show error UI initially", () => {
    render(
      <ErrorBoundary>
        <div>Safe content</div>
      </ErrorBoundary>,
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByText("Something went wrong")).not.toBeInTheDocument();
  });

  it("renders error UI with alert role for accessibility", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    render(
      <ErrorBoundary>
        <ThrowingComponent shouldThrow />
      </ErrorBoundary>,
    );

    const alert = screen.getByRole("alert");
    expect(alert).toBeInTheDocument();
    // Verify the warning icon is present
    expect(alert.textContent).toContain("⚠");
    spy.mockRestore();
  });
});
