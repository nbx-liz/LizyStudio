import { Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { SourceType } from "@/hooks/useDataPanel";
import { FileBrowser } from "./FileBrowser";
import { SegmentGroup } from "./SegmentGroup";

interface DataSourceSectionProps {
  sourceType: SourceType;
  onSourceTypeChange: (v: SourceType) => void;
  dataPath: string;
  onDataPathChange: (v: string) => void;
  loading: boolean;
  shape: [number, number] | null;
  preview: {
    columns: string[];
    data: Record<string, unknown>[];
  } | null;
  onLoadPath: (path: string) => void;
  onUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

export function DataSourceSection({
  sourceType,
  onSourceTypeChange,
  dataPath,
  onDataPathChange,
  loading,
  shape,
  preview,
  onLoadPath,
  onUpload,
}: DataSourceSectionProps) {
  return (
    <div className="lzs-form space-y-1.5 pl-4">
      <SegmentGroup
        options={["path", "upload"] as const as string[]}
        value={sourceType}
        onChange={(v) => onSourceTypeChange(v as SourceType)}
        labels={{ path: "Path", upload: "Upload" }}
      />
      {sourceType === "path" ? (
        <div className="space-y-2">
          <div className="flex gap-2">
            <Input
              placeholder="/path/to/data.csv"
              value={dataPath}
              onChange={(e) => onDataPathChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  onLoadPath(dataPath);
                }
              }}
              className="h-8 text-sm"
            />
            <FileBrowser
              onSelect={(path) => {
                onDataPathChange(path);
                onLoadPath(path);
              }}
            />
          </div>
          <Button
            size="sm"
            variant="outline"
            disabled={!dataPath.trim() || loading}
            onClick={() => onLoadPath(dataPath)}
          >
            Load
          </Button>
        </div>
      ) : (
        <label className="flex cursor-pointer flex-col items-center gap-2 rounded-md border-2 border-dashed p-6 text-sm text-muted-foreground hover:border-primary/50">
          <Upload className="h-8 w-8" />
          <span>Drop CSV/Parquet or click to upload</span>
          <input
            type="file"
            accept=".csv,.parquet"
            className="hidden"
            onChange={onUpload}
          />
        </label>
      )}
      {loading && (
        <div className="space-y-2">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      )}
      {shape && !loading && (
        <p className="text-xs text-muted-foreground">
          {shape[0]} rows × {shape[1]} columns
        </p>
      )}
      {preview && preview.data.length > 0 && (
        <div className="lzs-scrollable max-h-48 overflow-y-scroll rounded border text-sm">
          <div className="overflow-x-scroll p-1">
            <Table className="min-w-max">
              <TableHeader>
                <TableRow>
                  {preview.columns.map((col) => (
                    <TableHead
                      key={col}
                      className="whitespace-nowrap px-3 text-xs"
                    >
                      {col}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {preview.data.map((row, i) => (
                  <TableRow key={`row-${i}`}>
                    {preview.columns.map((col) => (
                      <TableCell
                        key={col}
                        className="whitespace-nowrap px-3 text-xs"
                      >
                        {String(row[col] ?? "")}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}
    </div>
  );
}
