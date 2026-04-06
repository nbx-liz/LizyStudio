import { useEffect } from "react";

const DEFAULT_TITLE = "LizyStudio";

/**
 * Sets the browser tab title. Restores default on unmount.
 */
export function useDocumentTitle(title: string | null) {
  useEffect(() => {
    document.title = title ? `${title} — ${DEFAULT_TITLE}` : DEFAULT_TITLE;
    return () => {
      document.title = DEFAULT_TITLE;
    };
  }, [title]);
}
