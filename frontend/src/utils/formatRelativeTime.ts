/**
 * Format a timestamp as relative time (e.g. "3m ago") with fallback to
 * absolute display for older dates.
 *
 * Returns { relative, absolute } so callers can show relative text with
 * absolute time as a tooltip.
 */
export function formatRelativeTime(isoString: string): {
  relative: string;
  absolute: string;
} {
  const date = new Date(isoString);
  const absolute = date.toLocaleString();

  const now = Date.now();
  const diffMs = now - date.getTime();

  if (diffMs < 0) {
    return { relative: "just now", absolute };
  }

  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) {
    return { relative: `${seconds}s ago`, absolute };
  }

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return { relative: `${minutes}m ago`, absolute };
  }

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return { relative: `${hours}h ago`, absolute };
  }

  const days = Math.floor(hours / 24);
  if (days < 30) {
    return { relative: `${days}d ago`, absolute };
  }

  // Older than 30 days: just show the date
  return { relative: date.toLocaleDateString(), absolute };
}
