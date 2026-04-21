import { apiClient } from "./client";
import type { components } from "./generated/schema";

// SSOT: generated schema is the source of truth for the wire type.
// Re-exported so consumers can keep the original import shape.
export type DirectoryListing = components["schemas"]["DirectoryListing"];

export async function fetchDirectory(path?: string): Promise<DirectoryListing> {
  const { data } = await apiClient.GET("/api/files", {
    params: { query: path ? { path } : {} },
  });
  // The throwOnError middleware in client.ts throws ApiError on non-2xx
  // responses, so ``data`` is always defined here. The explicit guard
  // satisfies TypeScript's narrowing without relying on a non-null assertion.
  if (!data) {
    throw new Error("apiClient returned no data despite 2xx response");
  }
  return data;
}
