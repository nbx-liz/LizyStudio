import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Format a numeric value to 4 decimal places, or "—" for non-numbers/NaN. */
export function formatNum(v: unknown): string {
  if (typeof v !== "number" || Number.isNaN(v)) return "—";
  return v.toFixed(4);
}
