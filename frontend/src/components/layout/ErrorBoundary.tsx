import { Component, type ReactNode } from "react";
import { Button } from "@/components/ui/button";

type FallbackRender = (error: Error, reset: () => void) => ReactNode;

interface Props {
  children: ReactNode;
  /** Custom fallback UI — a ReactNode or a render function receiving (error, reset). */
  fallback?: ReactNode | FallbackRender;
  /** Called when the boundary resets (e.g. to clear React Query cache). */
  onReset?: () => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  private handleReset = () => {
    this.props.onReset?.();
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      const { fallback } = this.props;
      const error =
        this.state.error ?? new Error("An unexpected error occurred.");

      // Render function fallback
      if (typeof fallback === "function") {
        return fallback(error, this.handleReset);
      }

      // ReactNode fallback
      if (fallback !== undefined) {
        return fallback;
      }

      // Default fallback
      return (
        <div
          className="flex h-full min-h-[400px] flex-col items-center justify-center gap-4 p-8 text-center"
          role="alert"
        >
          <div className="text-4xl">⚠</div>
          <h2 className="text-lg font-semibold">Something went wrong</h2>
          <p className="max-w-md text-sm text-muted-foreground">
            {error.message}
          </p>
          <Button variant="outline" onClick={this.handleReset}>
            Try again
          </Button>
        </div>
      );
    }

    return this.props.children;
  }
}
