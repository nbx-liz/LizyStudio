import { ChevronRight } from "lucide-react";
import { useState } from "react";
import type { LineageNode } from "@/api/jobs";
import { Badge } from "@/components/ui/badge";

export interface JobLineageTreeProps {
  /** Root of the lineage subtree returned by GET /jobs/{id}/lineage. */
  root: LineageNode;
  /** Optional click handler — selects a node (e.g. to show its details). */
  onSelect?: (jobId: string) => void;
}

type StatusTone = "default" | "secondary" | "destructive" | "outline";

function toneFor(status: string): StatusTone {
  if (status === "completed") return "default";
  if (status === "failed" || status === "cancelled") return "destructive";
  if (status === "running" || status === "pending") return "secondary";
  return "outline";
}

interface NodeRowProps {
  node: LineageNode;
  depth: number;
  onSelect?: (jobId: string) => void;
}

function NodeRow({ node, depth, onSelect }: NodeRowProps) {
  const [expanded, setExpanded] = useState(true);
  const hasChildren = node.children.length > 0;

  return (
    <li>
      <div
        className="flex items-center gap-2 py-1 text-xs"
        style={{ paddingLeft: `${depth * 16}px` }}
      >
        {hasChildren ? (
          <button
            type="button"
            className="rounded p-0.5 hover:bg-muted/50"
            onClick={() => setExpanded(!expanded)}
            aria-label={expanded ? "Collapse" : "Expand"}
          >
            <ChevronRight
              className={`h-3 w-3 transition-transform ${
                expanded ? "rotate-90" : ""
              }`}
            />
          </button>
        ) : (
          <span className="w-4" />
        )}
        <button
          type="button"
          className="font-mono text-xs hover:underline"
          onClick={() => onSelect?.(node.job_id)}
        >
          {node.job_id}
        </button>
        <Badge variant={toneFor(node.status)} className="text-[10px]">
          {node.status}
        </Badge>
        <span className="text-[10px] text-muted-foreground">
          {node.job_type}
        </span>
      </div>
      {expanded && hasChildren && (
        <ul className="list-none">
          {node.children.map((child) => (
            <NodeRow
              key={child.job_id}
              node={child}
              depth={depth + 1}
              onSelect={onSelect}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

export function JobLineageTree({ root, onSelect }: JobLineageTreeProps) {
  return (
    <section className="rounded-md border bg-card p-2">
      <h3 className="text-sm font-medium mb-1 px-1">Lineage</h3>
      <ul className="list-none">
        <NodeRow node={root} depth={0} onSelect={onSelect} />
      </ul>
    </section>
  );
}
