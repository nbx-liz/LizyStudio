import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const STORAGE_KEY = "lizystudio-onboarding-completed";

const STEPS = [
  {
    title: "Welcome to LizyStudio",
    description:
      "LizyStudio is a web GUI for ML analysis workflows. Let's walk through the basics.",
  },
  {
    title: "1. Load Your Data",
    description:
      "Start in the Data Panel (left). Upload a CSV or enter a file path, then select your target column.",
  },
  {
    title: "2. Configure Your Model",
    description:
      "In the Model Panel (center), adjust parameters. Essential params are shown first — click 'Show advanced' for more options.",
  },
  {
    title: "3. Run & Analyze",
    description:
      "Click Fit to train, or Tune to optimize hyperparameters. Results appear in the right panel with metrics, plots, and feature importance.",
  },
];

export function Onboarding() {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);

  useEffect(() => {
    try {
      if (!localStorage.getItem(STORAGE_KEY)) {
        setOpen(true);
      }
    } catch {
      // localStorage unavailable
    }
  }, []);

  const handleClose = () => {
    setOpen(false);
    try {
      localStorage.setItem(STORAGE_KEY, "true");
    } catch {
      // localStorage unavailable
    }
  };

  const isLast = step === STEPS.length - 1;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{STEPS[step].title}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          {STEPS[step].description}
        </p>
        <div className="flex justify-center gap-1 py-2">
          {STEPS.map((_, i) => (
            <div
              key={`step-${i}`}
              className={`h-1.5 w-6 rounded-full ${i === step ? "bg-primary" : "bg-muted"}`}
            />
          ))}
        </div>
        <DialogFooter className="flex gap-2 sm:justify-between">
          <Button variant="ghost" size="sm" onClick={handleClose}>
            Skip
          </Button>
          <div className="flex gap-2">
            {step > 0 && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setStep((s) => s - 1)}
              >
                Back
              </Button>
            )}
            {isLast ? (
              <Button size="sm" onClick={handleClose}>
                Get Started
              </Button>
            ) : (
              <Button size="sm" onClick={() => setStep((s) => s + 1)}>
                Next
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
