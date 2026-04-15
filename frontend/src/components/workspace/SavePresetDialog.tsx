import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface SavePresetDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (name: string) => void;
  existingNames?: readonly string[];
}

/**
 * Modal used to ask the user for a new preset name.
 *
 * Replaces the previous `window.prompt()` call which was not themed,
 * not accessible, and blocked by some iframe embeddings.
 */
export function SavePresetDialog({
  open,
  onOpenChange,
  onSave,
  existingNames = [],
}: SavePresetDialogProps) {
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // Reset the input whenever the dialog is (re)opened.
  useEffect(() => {
    if (open) {
      setValue("");
      // Focus on next tick so the dialog mount finishes first.
      const id = window.setTimeout(() => inputRef.current?.focus(), 0);
      return () => window.clearTimeout(id);
    }
  }, [open]);

  const trimmed = value.trim();
  const isDuplicate = trimmed.length > 0 && existingNames.includes(trimmed);
  const isValid = trimmed.length > 0 && !isDuplicate;

  const handleSubmit = (event?: React.FormEvent) => {
    event?.preventDefault();
    if (!isValid) return;
    onSave(trimmed);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Save preset</DialogTitle>
          <DialogDescription>
            Preset name is stored locally. Data paths and feature selections are
            not saved.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <div className="flex flex-col gap-2">
            <Label htmlFor="preset-name">Name</Label>
            <Input
              ref={inputRef}
              id="preset-name"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="e.g. lgbm-tuned"
              aria-invalid={isDuplicate}
              aria-describedby={isDuplicate ? "preset-name-error" : undefined}
            />
            {isDuplicate && (
              <p
                id="preset-name-error"
                className="text-sm text-destructive"
                role="alert"
              >
                A preset with this name already exists.
              </p>
            )}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!isValid}>
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
