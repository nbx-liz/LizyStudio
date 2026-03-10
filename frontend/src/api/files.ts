import { apiFetch } from "./client";

export interface FileEntry {
  name: string;
  type: "file" | "directory";
  size: number | null;
  extension: string | null;
}

export interface DirectoryListing {
  path: string;
  parent: string | null;
  entries: FileEntry[];
}

export function fetchDirectory(path?: string): Promise<DirectoryListing> {
  const params = path ? `?path=${encodeURIComponent(path)}` : "";
  return apiFetch(`/files${params}`);
}
