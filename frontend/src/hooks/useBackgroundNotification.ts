/**
 * Send a browser notification when the tab is not focused.
 * Requests permission on first call if not yet granted.
 */
export function useBackgroundNotification() {
  return (title: string, body?: string) => {
    if (typeof Notification === "undefined") return;
    if (document.hasFocus()) return;

    if (Notification.permission === "granted") {
      new Notification(title, { body, icon: "/favicon.ico" });
    } else if (Notification.permission !== "denied") {
      Notification.requestPermission().then((permission) => {
        if (permission === "granted") {
          new Notification(title, { body, icon: "/favicon.ico" });
        }
      });
    }
  };
}
