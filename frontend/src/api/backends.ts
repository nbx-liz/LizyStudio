/**
 * Backends API client.
 */

import { apiFetch } from "./client";

export interface BackendInfo {
  name: string;
  version: string;
}

export function fetchBackends(): Promise<BackendInfo[]> {
  return apiFetch<BackendInfo[]>("/backends");
}
