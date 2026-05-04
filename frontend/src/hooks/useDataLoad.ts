import { useState } from "react";
import { toast } from "sonner";
import { getErrorMessage } from "@/api/errors";
import type { ColumnInfo } from "@/api/types";
import {
  fetchColumns,
  fetchPreview,
  loadDataFromPath,
  uploadData,
} from "@/api/workspace";
import type { SourceType } from "./useDataPanel.types";

interface UseDataLoadParams {
  onDataChanged: () => void;
  onTaskChanged?: (task: string | null) => void;
  onColumnsLoaded: (columns: ColumnInfo[], allNames: string[]) => void;
  onReset: () => void;
}

export function useDataLoad({
  onDataChanged,
  onTaskChanged,
  onColumnsLoaded,
  onReset,
}: UseDataLoadParams) {
  const [sourceType, setSourceType] = useState<SourceType>("upload");
  const [dataPath, setDataPath] = useState("");
  const [shape, setShape] = useState<[number, number] | null>(null);
  const [preview, setPreview] = useState<{
    columns: string[];
    data: Record<string, unknown>[];
  } | null>(null);
  const [loading, setLoading] = useState(false);

  const handleLoadPathByValue = async (path: string) => {
    if (!path.trim()) return;
    setLoading(true);
    try {
      const res = await loadDataFromPath(path);
      setShape(res.data_ref.shape);
      const prev = await fetchPreview(5);
      setPreview(prev);
      const cols = await fetchColumns();
      onColumnsLoaded(
        cols.columns,
        cols.columns.map((c) => c.name),
      );
      onReset();
      onTaskChanged?.(null);
      onDataChanged();
      toast.success(
        `Data loaded: ${res.data_ref.shape[0]} rows x ${res.data_ref.shape[1]} columns`,
      );
    } catch (err) {
      toast.error(`Failed to load data: ${getErrorMessage(err)}`);
    } finally {
      setLoading(false);
    }
  };

  /**
   * Issue #363: hydrate the local UI from server-side persisted state
   * after a page reload. Differs from ``handleLoadPathByValue`` in
   * that it skips the POST /api/workspace/data/path round-trip — the
   * server already knows the data, we just want to mirror its state
   * into local React state. Falls back to a normal load if the
   * preview/columns calls fail (e.g. a stale path no longer
   * accessible after a server restart).
   */
  const hydrateFromServer = async (
    path: string,
    initialShape: [number, number],
    // ``target`` is accepted for symmetry with ``handleLoadPathByValue``
    // but intentionally NOT forwarded to ``fetchColumns`` — see the
    // inline comment below.
    _target: string | null,
  ) => {
    if (!path.trim()) return;
    setSourceType("path");
    setDataPath(path);
    setShape(initialShape);
    try {
      const prev = await fetchPreview(5);
      setPreview(prev);
      // Issue #363: fetch ALL columns (no ``target`` arg) so the
      // Target combobox can render the previously-selected target as
      // a selectable option. Passing ``target`` here would have the
      // server exclude it from the response, leaving the Select
      // bound to a value that isn't present in its options.
      const cols = await fetchColumns();
      onColumnsLoaded(
        cols.columns,
        cols.columns.map((c) => c.name),
      );
      // ``onDataChanged`` flips ``hasData=true`` in WorkspacePage so
      // the rest of the panels (CV, model params) start consuming
      // the cached config. ``onReset`` is intentionally NOT called
      // here — that would clear target/task which we want to keep.
      onDataChanged();
    } catch (err) {
      // If hydration fetches fail (e.g. CSV moved on disk between
      // sessions), surface the error but do NOT toast — the user
      // hasn't taken any action and a noisy toast would be confusing.
      // The Workspace ends up in its empty default state, which is
      // correct fallback behaviour.
      console.warn("Workspace hydration failed:", err);
    }
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setLoading(true);
    try {
      const res = await uploadData(file);
      setShape(res.data_ref.shape);
      setDataPath(res.data_ref.path);
      const prev = await fetchPreview(5);
      setPreview(prev);
      const cols = await fetchColumns();
      onColumnsLoaded(
        cols.columns,
        cols.columns.map((c) => c.name),
      );
      onReset();
      onTaskChanged?.(null);
      onDataChanged();
      toast.success(`Uploaded: ${file.name}`);
    } catch (err) {
      toast.error(`Upload failed: ${getErrorMessage(err)}`);
    } finally {
      setLoading(false);
    }
  };

  return {
    sourceType,
    setSourceType,
    dataPath,
    setDataPath,
    shape,
    preview,
    loading,
    handleLoadPathByValue,
    handleUpload,
    hydrateFromServer,
  };
}
