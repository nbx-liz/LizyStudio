import { useCallback, useEffect, useRef, useState } from "react";
import type { FoldInfo, SplitPreviewResponse } from "@/api/types";
import { fetchSplitPreview } from "@/api/workspace";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

/** Debounce delay in ms before fetching a new preview. */
const DEBOUNCE_MS = 500;

export interface FoldPreviewProps {
  /** Whether data and config are ready for preview. */
  enabled: boolean;
  /** Serialized CV config key — changes trigger a refetch. */
  cvKey: string;
  /** Debounce delay in ms (default 500). Override in tests. */
  debounceMs?: number;
}

/**
 * Displays a visual preview of CV fold splits.
 *
 * - Summary badge: total folds count
 * - Color-coded flow: Train (blue) / Valid (orange)
 * - Detail table: fold #, train size, valid size
 *
 * Fetches from GET /api/workspace/data/split-preview with 500ms debounce.
 */
export function FoldPreview({
  enabled,
  cvKey,
  debounceMs = DEBOUNCE_MS,
}: FoldPreviewProps) {
  const [preview, setPreview] = useState<SplitPreviewResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchPreview = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchSplitPreview();
      setPreview(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPreview(null);
    } finally {
      setLoading(false);
    }
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: cvKey triggers refetch on CV config change
  useEffect(() => {
    if (!enabled) {
      setPreview(null);
      return;
    }
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(fetchPreview, debounceMs);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
    // cvKey is included to re-fetch when CV config changes
  }, [enabled, debounceMs, fetchPreview, cvKey]);

  if (!enabled) return null;

  if (loading) {
    return (
      <p
        className="text-xs text-muted-foreground animate-pulse"
        data-testid="fold-preview-loading"
      >
        Loading fold preview...
      </p>
    );
  }

  if (error) {
    return (
      <p className="text-xs text-destructive" data-testid="fold-preview-error">
        {error}
      </p>
    );
  }

  if (!preview || preview.folds.length === 0) {
    return (
      <p
        className="text-xs text-muted-foreground"
        data-testid="fold-preview-empty"
      >
        No fold preview available
      </p>
    );
  }

  const maxSize = Math.max(
    ...preview.folds.map((f) => f.train_size + f.valid_size),
  );

  return (
    <div className="space-y-2" data-testid="fold-preview">
      {/* Summary badge */}
      <Badge variant="secondary" className="text-xs" data-testid="fold-summary">
        Total: {preview.n_splits} folds ({preview.strategy})
      </Badge>

      {/* Visual flow diagram */}
      <div className="space-y-1" data-testid="fold-flow">
        {preview.folds.map((fold) => (
          <FoldBar key={fold.fold} fold={fold} maxSize={maxSize} />
        ))}
      </div>

      {/* Detail table */}
      <div className="rounded border text-xs">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="px-2 py-1 text-xs">Fold</TableHead>
              <TableHead className="px-2 py-1 text-xs text-right">
                Train
              </TableHead>
              <TableHead className="px-2 py-1 text-xs text-right">
                Valid
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {preview.folds.map((fold) => (
              <TableRow key={fold.fold}>
                <TableCell className="px-2 py-1">{fold.fold + 1}</TableCell>
                <TableCell className="px-2 py-1 text-right">
                  {fold.train_size.toLocaleString()}
                </TableCell>
                <TableCell className="px-2 py-1 text-right">
                  {fold.valid_size.toLocaleString()}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Internal: single fold bar
// ---------------------------------------------------------------------------

function FoldBar({ fold, maxSize }: { fold: FoldInfo; maxSize: number }) {
  const total = fold.train_size + fold.valid_size;
  const trainPct = maxSize > 0 ? (fold.train_size / maxSize) * 100 : 0;
  const validPct = maxSize > 0 ? (fold.valid_size / maxSize) * 100 : 0;

  return (
    <div className="flex items-center gap-1.5">
      <span className="w-6 text-right text-[10px] text-muted-foreground shrink-0">
        {fold.fold + 1}
      </span>
      <div className="flex flex-1 h-4 rounded-sm overflow-hidden bg-muted/30">
        <div
          className="bg-blue-500/30 border-r border-blue-500/50"
          style={{ width: `${trainPct}%` }}
          title={`Train: ${fold.train_size.toLocaleString()}`}
        />
        <div
          className="bg-orange-500/30"
          style={{ width: `${validPct}%` }}
          title={`Valid: ${fold.valid_size.toLocaleString()}`}
        />
      </div>
      <span className="text-[10px] text-muted-foreground shrink-0 w-16 text-right">
        {total.toLocaleString()}
      </span>
    </div>
  );
}
