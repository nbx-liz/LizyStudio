import { PlayCircle } from "lucide-react";
import { toast } from "sonner";
import { useUnpauseJob } from "@/api/queries";
import { Button } from "@/components/ui/button";

export interface UnpauseActionButtonProps {
  /** Tune Job id (must be in `paused` state). */
  jobId: string;
  /**
   * Optional reason to disable the button (e.g. workspace data was
   * cleared since pause; the backend would 400 with WORKSPACE_NO_DATA).
   * When provided the button renders disabled with a tooltip.
   */
  disabledReason?: string | null;
  /**
   * Called when the unpause request is acknowledged by the backend.
   * The same ``job_id`` is preserved (in-place resume — NOT a child
   * job like /resume), so the parent view does not need to switch
   * its selection.
   */
  onUnpauseStarted?: () => void;
}

/**
 * P-0099 v3-20f: re-launch a paused tune in place. The Optuna study
 * re-attaches via ``load_if_exists=True`` and continues from the next
 * trial — same ``job_id`` is preserved.
 *
 * Distinct from ``ResumeActionButton`` (failed→child-job lineage,
 * H-0062 Phase B): unpause is the v3-20 "in-place" path for jobs the
 * user paused on purpose mid-run.
 */
export function UnpauseActionButton({
  jobId,
  disabledReason,
  onUnpauseStarted,
}: UnpauseActionButtonProps) {
  const mutation = useUnpauseJob();
  const disabled = disabledReason != null || mutation.isPending;

  const handleClick = () => {
    mutation.mutate(jobId, {
      onSuccess: () => {
        toast.success("Tune resumed.");
        onUnpauseStarted?.();
      },
      onError: (err: Error) => {
        toast.error(`Resume failed: ${err.message}`);
      },
    });
  };

  return (
    <Button
      variant="default"
      size="sm"
      onClick={handleClick}
      disabled={disabled}
      title={disabledReason ?? undefined}
      aria-label="Resume paused tuning"
    >
      <PlayCircle className="mr-1 h-3 w-3" />
      {mutation.isPending ? "Resuming..." : "Resume"}
    </Button>
  );
}
