import { useState } from "react";
import { toast } from "sonner";
import { deleteJob } from "@/api/jobs";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";

interface DeleteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  jobId: string;
  jobNumber: number;
  onDeleted: () => void;
  /**
   * H-0067: number of descendants in this job's lineage. When > 0,
   * the dialog surfaces a cascade checkbox so the user can choose
   * to delete the full subtree. When 0, the checkbox is hidden and
   * delete acts as a plain single-job delete.
   */
  descendantCount?: number;
}

export function DeleteDialog({
  open,
  onOpenChange,
  jobId,
  jobNumber,
  onDeleted,
  descendantCount = 0,
}: DeleteDialogProps) {
  const [deleting, setDeleting] = useState(false);
  const [cascade, setCascade] = useState(false);

  // Reset the cascade choice whenever the dialog closes so reopening
  // on a different job does not carry the previous selection.
  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      setCascade(false);
    }
    onOpenChange(nextOpen);
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      const shouldCascade = descendantCount > 0 && cascade;
      const response = shouldCascade
        ? await deleteJob(jobId, { cascade: true })
        : await deleteJob(jobId);
      const removedCount = response?.removed_job_ids?.length ?? 1;
      if (shouldCascade && removedCount > 1) {
        toast.success(
          `Job #${jobNumber} and ${removedCount - 1} descendant(s) deleted`,
        );
      } else {
        toast.success(`Job #${jobNumber} deleted`);
      }
      handleOpenChange(false);
      onDeleted();
    } catch {
      toast.error("Failed to delete job");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete Job #{jobNumber}?</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            This action cannot be undone. The trained model file will also be
            deleted.
          </p>
          {descendantCount > 0 && (
            <div className="flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950">
              <Checkbox
                id="delete-cascade"
                checked={cascade}
                onCheckedChange={(v) => setCascade(v === true)}
              />
              <Label
                htmlFor="delete-cascade"
                className="text-sm font-normal text-amber-900 dark:text-amber-100"
              >
                Also delete {descendantCount} descendant job
                {descendantCount === 1 ? "" : "s"} (cascade)
              </Label>
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => handleOpenChange(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deleting}
            >
              {deleting ? "Deleting..." : "Delete"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
