import { Info } from "lucide-react";
import type { ReactNode } from "react";
import { Label } from "@/components/ui/label";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface FormFieldProps {
  label: string;
  description?: string;
  children: ReactNode;
}

export function FormField({ label, description, children }: FormFieldProps) {
  return (
    <div className="flex items-center justify-between gap-2">
      <div className="flex items-center gap-1 min-w-0">
        <Label className="text-xs text-foreground truncate">{label}</Label>
        {description && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Info
                className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60 cursor-help"
                aria-label={`Help: ${label}`}
              />
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-xs text-xs">
              {description}
            </TooltipContent>
          </Tooltip>
        )}
      </div>
      <div>{children}</div>
    </div>
  );
}
