import { Info } from "lucide-react";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface AutoValue {
  isAuto: boolean;
  onToggle: () => void;
}

interface FormFieldProps {
  label: string;
  description?: string;
  children: ReactNode;
  autoValue?: AutoValue;
}

export function FormField({
  label,
  description,
  children,
  autoValue,
}: FormFieldProps) {
  return (
    <div className="flex items-center justify-between gap-2">
      <div className="flex items-center gap-1 min-w-0">
        <Label className="text-xs text-muted-foreground truncate">
          {label}
        </Label>
        {description && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Info className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60 cursor-help" />
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-xs text-xs">
              {description}
            </TooltipContent>
          </Tooltip>
        )}
        {autoValue && (
          <Badge
            variant={autoValue.isAuto ? "default" : "outline"}
            className="cursor-pointer text-xs px-2 py-0.5 ml-1 shrink-0"
            onClick={autoValue.onToggle}
          >
            Auto
          </Badge>
        )}
      </div>
      <div
        className={
          autoValue?.isAuto ? "opacity-40 pointer-events-none" : undefined
        }
      >
        {children}
      </div>
    </div>
  );
}
