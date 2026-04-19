import { X } from "lucide-react";
import type { ProgressMessage } from "@/api/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { FoldProgressList } from "./FoldProgressList";
import { LiveTrialChart } from "./LiveTrialChart";

export interface ResultsRunningViewProps {
  headerLabel: string;
  modelName?: string;
  progress: ProgressMessage | null;
  foldLog: string[];
  cancelConfirm: boolean;
  onCancelConfirmChange: (open: boolean) => void;
  onCancel: () => void;
}

export function ResultsRunningView({
  headerLabel,
  modelName,
  progress,
  foldLog,
  cancelConfirm,
  onCancelConfirmChange,
  onCancel,
}: ResultsRunningViewProps) {
  const indeterminate = progress != null && progress.total === 0;
  const pct =
    progress && progress.total > 0
      ? (progress.current / progress.total) * 100
      : 0;

  return (
    <div className="flex h-full flex-col p-6">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h3 className="text-lg font-medium">
            {headerLabel} {modelName && `\u2014 ${modelName}`}
          </h3>
        </div>
        <Badge
          variant="secondary"
          className="bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200"
        >
          Running
        </Badge>
      </div>

      <Progress
        value={indeterminate ? undefined : pct}
        className={`mb-2${indeterminate ? " animate-pulse" : ""}`}
      />
      {progress && (
        <p className="mb-1 text-sm">
          {progress.message ?? `${progress.current} / ${progress.total}`}
        </p>
      )}
      {/* H-0069: `progress.elapsed` was a dead branch on a field the
          backend never emits — removed together with the WsMessage
          SSOT switch. */}

      {progress?.fold_results && progress.fold_results.length > 0 && (
        <FoldProgressList
          currentFold={progress.current}
          totalFolds={progress.total}
          foldResults={progress.fold_results}
        />
      )}

      {progress?.trial_results && progress.trial_results.length > 1 && (
        <LiveTrialChart trials={progress.trial_results} />
      )}

      {progress?.trial_results && progress.trial_results.length > 0 && (
        <div className="mt-3 max-h-48 overflow-auto rounded border bg-muted/30">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-muted">
              <tr>
                <th className="px-2 py-1 text-left font-medium">#</th>
                <th className="px-2 py-1 text-left font-medium">Score</th>
                <th className="px-2 py-1 text-left font-medium">Best</th>
                <th className="px-2 py-1 text-left font-medium">State</th>
              </tr>
            </thead>
            <tbody>
              {[...progress.trial_results].reverse().map((t) => (
                <tr
                  key={t.number}
                  className="border-t border-muted hover:bg-muted/50"
                >
                  <td className="px-2 py-0.5 font-mono">{t.number}</td>
                  <td className="px-2 py-0.5 font-mono">
                    {t.score != null ? t.score.toFixed(4) : "\u2014"}
                  </td>
                  <td className="px-2 py-0.5 font-mono">
                    {t.best_score?.toFixed(4) ?? "\u2014"}
                  </td>
                  <td className="px-2 py-0.5">{t.state}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {foldLog.length > 0 && (
        <div
          className="mt-3 min-h-16 max-h-[50vh] overflow-auto rounded border bg-muted/30 p-2 resize-y"
          style={{ height: "8rem" }}
        >
          {foldLog.map((msg, i) => (
            <p
              key={`log-${i}`}
              className="font-mono text-xs text-muted-foreground"
            >
              {msg}
            </p>
          ))}
        </div>
      )}

      <div className="mt-4">
        <Button
          variant="outline"
          size="sm"
          onClick={() => onCancelConfirmChange(true)}
        >
          <X className="mr-1 h-3 w-3" />
          Cancel
        </Button>
      </div>

      <Dialog open={cancelConfirm} onOpenChange={onCancelConfirmChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancel job?</DialogTitle>
          </DialogHeader>
          <p className="text-sm">
            Are you sure you want to cancel this running job?
          </p>
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => onCancelConfirmChange(false)}
            >
              No
            </Button>
            <Button variant="destructive" onClick={onCancel}>
              Yes, Cancel
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
