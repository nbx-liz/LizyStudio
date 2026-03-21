import { useState } from "react";
import { toast } from "sonner";
import { exportJob } from "@/api/jobs";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface ExportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  jobId: string;
  jobNumber: number;
}

export function ExportDialog({
  open,
  onOpenChange,
  jobId,
  jobNumber,
}: ExportDialogProps) {
  const [exportType, setExportType] = useState<"model" | "report">("model");
  const [outputPath, setOutputPath] = useState(
    `./exports/job_${jobNumber}_model`,
  );
  const [exporting, setExporting] = useState(false);

  const handleTypeChange = (type: "model" | "report") => {
    setExportType(type);
    setOutputPath(`./exports/job_${jobNumber}_${type}`);
  };

  const isPathValid =
    outputPath.trim().length > 0 &&
    !outputPath.includes("..") &&
    !outputPath.startsWith("/etc") &&
    !outputPath.startsWith("/usr");

  const handleExport = async () => {
    if (!isPathValid) {
      toast.error("Invalid output path");
      return;
    }
    setExporting(true);
    try {
      const result = await exportJob(jobId, exportType, outputPath.trim());
      toast.success(`Exported to ${result.exported_path}`);
      onOpenChange(false);
    } catch {
      toast.error("Export failed");
    } finally {
      setExporting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Export Job #{jobNumber}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Format selection */}
          <div className="space-y-2">
            <Label>Format</Label>
            <div className="flex gap-1">
              <Button
                variant={exportType === "model" ? "default" : "outline"}
                size="sm"
                className="flex-1"
                onClick={() => handleTypeChange("model")}
              >
                Model
              </Button>
              <Button
                variant={exportType === "report" ? "default" : "outline"}
                size="sm"
                className="flex-1"
                onClick={() => handleTypeChange("report")}
              >
                Report
              </Button>
            </div>
          </div>

          {/* Description */}
          <div className="rounded-md border bg-muted/30 p-3">
            <p className="text-sm font-medium">
              {exportType === "model" ? "Model" : "Report"}
            </p>
            <p className="text-xs text-muted-foreground">
              {exportType === "model"
                ? "Includes: pkl + metadata JSON"
                : "Includes: HTML evaluation report with metrics and plots"}
            </p>
          </div>

          {/* Output path */}
          <div className="space-y-2">
            <Label>Output Path</Label>
            <Input
              value={outputPath}
              onChange={(e) => setOutputPath(e.target.value)}
              className="text-sm"
            />
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button onClick={handleExport} disabled={exporting || !isPathValid}>
              {exporting ? "Exporting..." : "Export"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
