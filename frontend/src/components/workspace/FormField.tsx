import { Info } from "lucide-react";
import { cloneElement, isValidElement, type ReactNode, useId } from "react";
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
  // Issue #90: wire <Label htmlFor> to the rendered control so axe's
  // `label` rule passes and screen readers announce the field name.
  // Most field children (NumberInput, Input, SelectTrigger) accept an
  // `id` prop and forward it onto their underlying <input> / button.
  // If the caller has already supplied an explicit id we respect it
  // instead of overwriting.
  //
  // Caveat: when `children` is not a single React element (string,
  // fragment, array), we cannot inject an id and the <Label htmlFor>
  // points at nothing. All current callers pass a single element; in
  // dev we surface a console warning so a future regression is loud
  // rather than silently invisible to screen readers.
  const generatedId = useId();
  let resolvedId = generatedId;
  let labelledChildren: ReactNode = children;
  if (isValidElement<{ id?: string }>(children)) {
    const existingId = children.props.id;
    if (existingId) {
      resolvedId = existingId;
    } else {
      labelledChildren = cloneElement(children, { id: generatedId });
    }
  } else if (process.env.NODE_ENV !== "production") {
    console.warn(
      `FormField "${label}" received non-element children; <Label htmlFor> will not connect to any input.`,
    );
  }

  return (
    <div className="flex items-center justify-between gap-2">
      <div className="flex items-center gap-1 min-w-0">
        <Label
          htmlFor={resolvedId}
          className="text-xs text-foreground truncate"
        >
          {label}
        </Label>
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
      <div>{labelledChildren}</div>
    </div>
  );
}
