import { createContext, type ReactNode, useContext } from "react";
import type { ConfigWriteFunnel } from "./useConfigWriteFunnel";

/**
 * Context wrapper for the P-0092 Q-1 write funnel.
 *
 * Mounted once by `WorkspacePage`, which owns the lifecycle of the
 * underlying funnel via `useConfigWriteFunnel(...)`. Every writer-
 * bearing hook in the Workspace tree (useConfigSync, useTargetSelection,
 * useModelPanelData, useDataPanel, ConfigForm) reads the same
 * `enqueueWrite` instance through `useConfigWriteFunnelOptional`
 * without prop-drilling.
 *
 * `useConfigWriteFunnelOptional` returns `null` when no provider is
 * present (Storybook stories, unit tests that render a single hook
 * in isolation). This is intentional: such call sites either inject
 * their own writer through props or rely on the legacy `updateConfig`
 * fallback. Returning `null` lets the consumer fall back instead of
 * crashing.
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
 * Optional hook — returns `null` if no provider is mounted. The only
 * production reader is `WorkspacePage`'s subtree, which always mounts
 * the provider. Isolated test/story renders fall back to the legacy
 * writer or the injected stub.
 */
export function useConfigWriteFunnelOptional(): ConfigWriteFunnel | null {
  return useContext(FunnelContext);
}
