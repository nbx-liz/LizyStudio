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

/** Format elapsed seconds as MM:SS, or "--:--" for invalid input. */
export function formatElapsed(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "--:--";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
