import { createContext, type ReactNode, useContext } from "react";
import type { ConfigWriteFunnel } from "./useConfigWriteFunnel";

/**
 * Context wrapper for the P-0092 Q-1 write funnel.
 *
 * Phase 2 introduces this so ConfigForm — and, in later phases, every
 * other writer-bearing hook in the Workspace tree — can reach the
 * same `enqueueWrite` instance without prop-drilling. The provider
 * is mounted once by `WorkspacePage`, which owns the lifecycle of
 * the underlying funnel via `useConfigWriteFunnel(...)`.
 *
 * Calling `useConfigWriteFunnelOptional()` returns `null` when no
 * provider is present (e.g. Storybook stories or unit tests that
 * render ConfigForm in isolation). This is intentional: such call
 * sites either provide their own writer through props or rely on
 * the legacy `onChange` path that Phase 2 leaves untouched. Returning
 * `null` lets the consumer fall back instead of crashing.
 */

const FunnelContext = createContext<ConfigWriteFunnel | null>(null);

interface ProviderProps {
  funnel: ConfigWriteFunnel;
  children: ReactNode;
}

export function ConfigWriteFunnelProvider({ funnel, children }: ProviderProps) {
  return (
    <FunnelContext.Provider value={funnel}>{children}</FunnelContext.Provider>
  );
}

/**
 * Strict hook — throws when no provider is mounted. Use this from
 * places that *must* go through the funnel (Phases 4..6 entry points).
 */
export function useConfigWriteFunnelContext(): ConfigWriteFunnel {
  const ctx = useContext(FunnelContext);
  if (ctx === null) {
    throw new Error(
      "useConfigWriteFunnelContext must be used within a ConfigWriteFunnelProvider",
    );
  }
  return ctx;
}

/**
 * Optional hook — returns `null` if no provider is mounted. Phase 2's
 * ConfigForm uses this so isolated rendering paths (Storybook, unit
 * tests) keep working without a provider.
 */
export function useConfigWriteFunnelOptional(): ConfigWriteFunnel | null {
  return useContext(FunnelContext);
}
