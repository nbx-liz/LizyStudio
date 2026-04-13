import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Repeat } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { type RetuneRequestBody, retuneJob } from "@/api/jobs";
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

export interface RetuneActionButtonProps {
  /** Parent Tune Job id. */
  jobId: string;
  /**
   * When the parent has a `parent_job_id` (grandchild scenario),
   * the button renders disabled with a tooltip. MVP keeps the rule
   * surfaced so users understand why.
   */
  disabledReason?: string | null;
  /**
   * model.pkl presence proxy — when the backend knows the parent has
   * no checkpoint the button is disabled with a different reason.
   * The actual check still lives server-side; this only saves a round
   * trip when we already know it is doomed.
   */
  hasCheckpoint?: boolean;
  /**
   * Default n_trials to pre-fill. Phase B spec: same as the previous
   * round's n_trials (so an "all rounds" resume naturally picks up
   * where tuning left off).
   */
  defaultNTrials: number;
}

const MAX_TRIALS = 10_000;

export function RetuneActionButton({
  jobId,
  disabledReason,
  hasCheckpoint = true,
  defaultNTrials,
}: RetuneActionButtonProps) {
  const [open, setOpen] = useState(false);
  const [nTrials, setNTrials] = useState<string>(String(defaultNTrials));
  const queryClient = useQueryClient();

  const disabled = !hasCheckpoint || disabledReason != null;
  const tooltip =
    disabledReason ??
    (hasCheckpoint
      ? undefined
      : "This job has no saved checkpoint and cannot be re-tuned");

  const mutation = useMutation({
    mutationFn: (body: RetuneRequestBody) => retuneJob(jobId, body),
    onSuccess: (res) => {
      toast.success(`Re-tune started (${res.job_id})`);
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
      queryClient.invalidateQueries({ queryKey: ["job", jobId] });
      setOpen(false);
    },
    onError: (err: Error) => {
      toast.error(`Re-tune failed: ${err.message}`);
    },
  });

  const parsed = Number.parseInt(nTrials, 10);
  const invalid = Number.isNaN(parsed) || parsed < 1 || parsed > MAX_TRIALS;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          disabled={disabled}
          title={tooltip}
          aria-label="Re-tune with additional trials"
        >
          <Repeat className="mr-1 h-3 w-3" />
          Re-tune (+N trials)
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Re-tune this job</DialogTitle>
          <DialogDescription>
            Continues the Optuna study from where it left off. A new child job
            is created; this job stays intact.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-2 py-2">
          <Label htmlFor="retune-n-trials">Additional trials</Label>
          <Input
            id="retune-n-trials"
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
            {mutation.isPending ? "Starting..." : "Start Re-tune"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
