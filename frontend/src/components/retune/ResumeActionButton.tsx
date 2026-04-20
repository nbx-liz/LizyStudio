import { useMutation, useQueryClient } from "@tanstack/react-query";
import { PlayCircle } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { type ResumeRequestBody, resumeJob } from "@/api/jobs";
import { queryKeys } from "@/api/queryKeys";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export interface ResumeActionButtonProps {
  /** Parent Tune Job id (must be in `failed` state). */
  jobId: string;
  /**
   * When the failed job has no saved checkpoint the button renders
   * disabled with a tooltip explaining why.
   */
  hasCheckpoint?: boolean;
  /**
   * Auto-computed remaining trial count used as the dialog default.
   * The backend also computes this on its side — passing it here just
   * gives the user a sensible pre-fill.
   */
  remainingTrials: number;
  /**
   * When the job is already a child (has parent_job_id), resume is
   * blocked the same way Re-tune is — same MVP rule.
   */
  disabledReason?: string | null;
  /**
   * Called with the newly-created child job id as soon as the resume
   * POST succeeds. Used by the parent view to switch the Workspace
   * selection over to the child (H-0062).
   */
  onStarted?: (childJobId: string) => void;
}

const MAX_TRIALS = 10_000;

export function ResumeActionButton({
  jobId,
  hasCheckpoint = true,
  remainingTrials,
  disabledReason,
  onStarted,
}: ResumeActionButtonProps) {
  const [open, setOpen] = useState(false);
  const [nTrials, setNTrials] = useState<string>(String(remainingTrials));
  const queryClient = useQueryClient();

  const disabled = !hasCheckpoint || disabledReason != null;
  const tooltip =
    disabledReason ??
    (hasCheckpoint
      ? undefined
      : "This failed job has no saved checkpoint to resume from");

  const mutation = useMutation({
    mutationFn: (body: ResumeRequestBody) => resumeJob(jobId, body),
    onSuccess: (res) => {
      toast.success(`Resume started (${res.job_id})`);
      queryClient.invalidateQueries({ queryKey: queryKeys.jobs() });
      queryClient.invalidateQueries({ queryKey: queryKeys.job(jobId) });
      setOpen(false);
      onStarted?.(res.job_id);
    },
    onError: (err: Error) => {
      toast.error(`Resume failed: ${err.message}`);
    },
  });

  const parsed = Number.parseInt(nTrials, 10);
  const invalid = Number.isNaN(parsed) || parsed < 1 || parsed > MAX_TRIALS;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="default"
          size="sm"
          disabled={disabled}
          title={tooltip}
          aria-label="Resume tuning from checkpoint"
        >
          <PlayCircle className="mr-1 h-3 w-3" />
          Resume ({remainingTrials} trials remaining)
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Resume this failed tune</DialogTitle>
          <DialogDescription>
            Reloads the last saved checkpoint and continues the Optuna study for
            the requested number of trials. A new child job is created so the
            failed parent stays visible in the history.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-2 py-2">
          <Label htmlFor="resume-n-trials">Remaining trials</Label>
          <Input
            id="resume-n-trials"
            type="number"
            min={1}
            max={MAX_TRIALS}
            value={nTrials}
            onChange={(e) => setNTrials(e.target.value)}
          />
          {invalid && (
            <p className="text-xs text-destructive">
              n_trials must be between 1 and {MAX_TRIALS.toLocaleString()}.
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            disabled={invalid || mutation.isPending}
            onClick={() => mutation.mutate({ n_trials: parsed })}
          >
            {mutation.isPending ? "Starting..." : "Start Resume"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
