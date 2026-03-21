import type { InferenceRecord } from "@/api/inference";
import { Badge } from "@/components/ui/badge";

interface HistoryListProps {
  records: InferenceRecord[];
  selectedInfId: string | null;
  onSelect: (infId: string) => void;
}

export function HistoryList({
  records,
  selectedInfId,
  onSelect,
}: HistoryListProps) {
  if (records.length === 0) return null;

  return (
    <div className="space-y-1">
      <h4 className="text-sm font-medium text-muted-foreground px-1">
        History
      </h4>
      {records.map((rec, idx) => {
        const number = records.length - idx;
        const isSelected = rec.inf_id === selectedInfId;
        return (
          <button
            key={rec.inf_id}
            type="button"
            className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm ${
              isSelected
                ? "bg-accent text-accent-foreground"
                : "hover:bg-accent/50"
            }`}
            onClick={() => onSelect(rec.inf_id)}
          >
            <span className="font-mono text-xs">#{number}</span>
            <span className="text-xs text-muted-foreground">
              {rec.row_count} rows
            </span>
            {rec.has_ground_truth && (
              <Badge variant="outline" className="text-[10px] px-1 py-0">
                GT
              </Badge>
            )}
            <span className="ml-auto text-xs text-muted-foreground">
              {formatRelativeTime(rec.created_at)}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function formatRelativeTime(iso: string): string {
  const now = Date.now();
  const then = new Date(iso).getTime();
  const diffMs = now - then;
  const diffSec = Math.floor(diffMs / 1000);

  if (diffSec < 60) return "now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour}h`;
  const diffDay = Math.floor(diffHour / 24);
  return `${diffDay}d`;
}
