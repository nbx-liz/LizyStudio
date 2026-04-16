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
  };
}
