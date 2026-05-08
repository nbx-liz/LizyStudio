import { PauseCircle } from "lucide-react";
import { toast } from "sonner";
import { usePauseJob } from "@/api/queries";
import { Button } from "@/components/ui/button";

export interface PauseActionButtonProps {
  /** Tune Job id (must be in `running` state to be pauseable). */
  jobId: string;
  /**
   * Called when the pause request is acknowledged by the backend. The
   * worker observes the on-disk PAUSE flag at the next cooperative
   * callback boundary and persists ``status="paused"``; the WS handler
   * will then flip the UI through ``WsPaused`` (P-0099 v3-20e).
   */
  onPauseRequested?: () => void;
}

/**
 * P-0099 v3-20f: request a running tune to pause at the next trial
 * boundary. The job stays the same (in-place resumable via
 * :class:`UnpauseActionButton`) — no child job is created here.
 */
export function PauseActionButton({
  jobId,
  onPauseRequested,
}: PauseActionButtonProps) {
  const mutation = usePauseJob();

  const handleClick = () => {
    mutation.mutate(jobId, {
      onSuccess: () => {
        toast.success(
          "Pause requested. The tune will pause at the next trial.",
        );
        onPauseRequested?.();
      },
      onError: (err: Error) => {
        toast.error(`Pause failed: ${err.message}`);
      },
    });
  };

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={handleClick}
      disabled={mutation.isPending}
      aria-label="Pause tuning at next trial"
    >
      <PauseCircle className="mr-1 h-3 w-3" />
      {mutation.isPending ? "Pausing..." : "Pause"}
    </Button>
  );
}
