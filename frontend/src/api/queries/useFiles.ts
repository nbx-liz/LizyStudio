import { useQuery } from "@tanstack/react-query";
import { fetchDirectory } from "@/api/files";
import { queryKeys } from "../queryKeys";

/** Directory listing for the file browser dialog. The caller passes
 * ``enabled: open`` so the query only fires while the dialog is open.
 */
export function useFiles(path: string, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: queryKeys.files(path),
    queryFn: () => fetchDirectory(path === "~" ? undefined : path),
    enabled: options?.enabled !== false,
  });
}
