import { Upload } from "lucide-react";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import type { InferenceRecord } from "@/api/inference";
import { uploadInferenceData } from "@/api/inference";
import type { JobSummary } from "@/api/types";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FileBrowser } from "@/components/workspace/FileBrowser";
import { HistoryList } from "./HistoryList";

type SourceType = "path" | "upload";

interface SetupPanelProps {
  completedJobs: JobSummary[];
  selectedJobId: string | null;
  onSelectJob: (jobId: string) => void;
  history: InferenceRecord[];
  selectedInfId: string | null;
  onSelectInf: (infId: string) => void;
  onRunInference: (params: {
    dataPath: string;
    evaluate: boolean;
    returnShap: boolean;
  }) => void;
  isRunning: boolean;
}

export function SetupPanel({
  completedJobs,
  selectedJobId,
  onSelectJob,
  history,
  selectedInfId,
  onSelectInf,
  onRunInference,
  isRunning,
}: SetupPanelProps) {
  const [sourceType, setSourceType] = useState<SourceType>("path");
  const [dataPath, setDataPath] = useState("");
  const [evaluate, setEvaluate] = useState(true);
  const [returnShap, setReturnShap] = useState(false);
  const [uploading, setUploading] = useState(false);

  const selectedJob = completedJobs.find((j) => j.job_id === selectedJobId);
  // TODO: config is not in JobSummary type. GET /jobs list does not return config.
  // Either add config to the list endpoint or fetch job detail separately.
  const targetCol = selectedJob?.config?.data
    ? (selectedJob.config.data as Record<string, unknown>).target
    : null;

  const canRun = selectedJobId != null && dataPath.trim() !== "" && !isRunning;

  const handleUpload = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      setUploading(true);
      try {
        const result = await uploadInferenceData(file);
        setDataPath(result.upload_path);
        toast.success(`Uploaded: ${result.filename}`);
      } catch (err) {
        toast.error(
          `Upload failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      } finally {
        setUploading(false);
      }
    },
    [],
  );

  const handleRun = () => {
    onRunInference({
      dataPath,
      evaluate,
      returnShap,
    });
  };

  return (
    <div className="flex h-full flex-col overflow-auto p-4">
      <h2 className="mb-4 text-lg font-semibold">Inference</h2>

      {/* Model Selection */}
      <section className="mb-4">
        <Label className="mb-1.5 block text-sm font-medium">Model</Label>
        <Select
          value={selectedJobId ?? ""}
          onValueChange={onSelectJob}
          disabled={completedJobs.length === 0}
        >
          <SelectTrigger>
            <SelectValue placeholder="Select a completed job" />
          </SelectTrigger>
          <SelectContent>
            {completedJobs.map((job, idx) => {
              const num = completedJobs.length - idx;
              const modelName = extractModelName(job);
              return (
                <SelectItem key={job.job_id} value={job.job_id}>
                  #{num} {job.job_type} {modelName}
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>
        {selectedJob && (
          <div className="mt-1 text-xs text-muted-foreground">
            <span>
              {selectedJob.job_type} {extractModelName(selectedJob)}
            </span>
            {selectedJob.primary_score != null && (
              <span className="ml-2">
                Score {selectedJob.primary_score.toFixed(4)}
              </span>
            )}
          </div>
        )}
      </section>

      {/* Data Source */}
      <section className="mb-4">
        <Label className="mb-1.5 block text-sm font-medium">Data</Label>
        <div className="mb-2 flex gap-2">
          <Button
            size="sm"
            variant={sourceType === "path" ? "default" : "outline"}
            onClick={() => setSourceType("path")}
          >
            Path
          </Button>
          <Button
            size="sm"
            variant={sourceType === "upload" ? "default" : "outline"}
            onClick={() => setSourceType("upload")}
          >
            Upload
          </Button>
        </div>

        {sourceType === "path" ? (
          <div className="flex gap-2">
            <Input
              placeholder="/path/to/data.csv"
              value={dataPath}
              onChange={(e) => setDataPath(e.target.value)}
              className="h-8 text-sm"
            />
            <FileBrowser onSelect={(path) => setDataPath(path)} />
          </div>
        ) : (
          <label className="flex cursor-pointer flex-col items-center gap-2 rounded-md border-2 border-dashed p-4 text-sm text-muted-foreground hover:border-primary/50">
            <Upload className="h-6 w-6" />
            <span>
              {uploading
                ? "Uploading..."
                : dataPath
                  ? "File uploaded"
                  : "Drop CSV/Parquet or click"}
            </span>
            <input
              type="file"
              accept=".csv,.parquet"
              className="hidden"
              onChange={handleUpload}
            />
          </label>
        )}
        {dataPath && (
          <p className="mt-1 truncate text-xs text-muted-foreground">
            {dataPath}
          </p>
        )}
      </section>

      {/* Evaluation Settings */}
      <section className="mb-4">
        <Label className="mb-1.5 block text-sm font-medium">Evaluation</Label>
        {targetCol ? (
          <div className="space-y-2">
            <p className="text-xs text-green-600">
              ✓ Target &apos;{String(targetCol)}&apos; detected
            </p>
            <div className="flex items-center gap-2">
              <Checkbox
                id="evaluate"
                checked={evaluate}
                onCheckedChange={(checked) => setEvaluate(checked === true)}
              />
              <label htmlFor="evaluate" className="text-sm">
                Evaluate
              </label>
            </div>
          </div>
        ) : (
          <div className="space-y-0.5">
            <p className="text-xs text-muted-foreground">
              Target not found in data
            </p>
            <p className="text-xs text-muted-foreground">Prediction only</p>
          </div>
        )}
      </section>

      {/* Options */}
      <section className="mb-4">
        <Label className="mb-1.5 block text-sm font-medium">Options</Label>
        <div className="flex items-center gap-2">
          <Checkbox
            id="shap"
            checked={returnShap}
            onCheckedChange={(checked) => setReturnShap(checked === true)}
          />
          <label htmlFor="shap" className="text-sm">
            SHAP values
          </label>
        </div>
      </section>

      {/* Run Button */}
      <Button className="mb-4 w-full" disabled={!canRun} onClick={handleRun}>
        {isRunning ? "Running..." : "Run Inference"}
      </Button>

      {/* Divider + History */}
      {history.length > 0 && (
        <>
          <div className="my-2 border-t" />
          <HistoryList
            records={history}
            selectedInfId={selectedInfId}
            onSelect={onSelectInf}
          />
        </>
      )}
    </div>
  );
}

function extractModelName(job: JobSummary): string {
  const config = job.config;
  if (!config) return "";
  const model = config.model as Record<string, unknown> | undefined;
  return String(model?.name ?? model?.type ?? "");
}
