import { ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";

export function ConfigTreeView({ data }: { data: unknown }) {
  if (data == null) {
    return <span className="text-muted-foreground italic">null</span>;
  }

  if (typeof data !== "object") {
    return <span className="font-mono">{String(data)}</span>;
  }

  if (Array.isArray(data)) {
    if (data.length === 0) {
      return <span className="font-mono text-muted-foreground">[]</span>;
    }
    return (
      <ul className="space-y-0.5">
        {data.map((item, idx) => (
          <li key={`${idx}`} className="flex items-start gap-1">
            <span className="text-muted-foreground select-none">-</span>
            <ConfigTreeView data={item} />
          </li>
        ))}
      </ul>
    );
  }

  const entries = Object.entries(data as Record<string, unknown>);
  if (entries.length === 0) {
    return <span className="font-mono text-muted-foreground">{"{}"}</span>;
  }

  return (
    <ul className="space-y-0.5">
      {entries.map(([key, value]) => (
        <ConfigTreeNode key={key} label={key} value={value} />
      ))}
    </ul>
  );
}

function ConfigTreeNode({ label, value }: { label: string; value: unknown }) {
  const isExpandable =
    value != null && typeof value === "object" && Object.keys(value).length > 0;
  const [expanded, setExpanded] = useState(false);

  if (!isExpandable) {
    return (
      <li className="flex items-start gap-1">
        <span className="w-3.5 shrink-0" />
        <span className="font-semibold">{label}:</span>{" "}
        <ConfigTreeView data={value} />
      </li>
    );
  }

  return (
    <li>
      <button
        type="button"
        className="flex items-start gap-0.5 hover:bg-accent/50 rounded px-0.5 -ml-0.5"
        onClick={() => setExpanded((prev) => !prev)}
      >
        {expanded ? (
          <ChevronDown className="mt-0.5 h-3 w-3 shrink-0" />
        ) : (
          <ChevronRight className="mt-0.5 h-3 w-3 shrink-0" />
        )}
        <span className="font-semibold">{label}</span>
      </button>
      {expanded && (
        <div className="ml-4 border-l pl-2">
          <ConfigTreeView data={value} />
        </div>
      )}
    </li>
  );
}
