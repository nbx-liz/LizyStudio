import { Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

function getInitialTheme(): "dark" | "light" {
  try {
    const stored = localStorage.getItem("theme");
    if (stored === "dark" || stored === "light") return stored;
  } catch {
    // ignore
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

export function ThemeToggle({ collapsed }: { collapsed?: boolean }) {
  const [theme, setTheme] = useState(getInitialTheme);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    try {
      localStorage.setItem("theme", theme);
    } catch {
      // ignore
    }
  }, [theme]);

  const toggle = () => setTheme((t) => (t === "dark" ? "light" : "dark"));
  const Icon = theme === "dark" ? Sun : Moon;

  return (
    <Button
      variant="ghost"
      size={collapsed ? "icon-sm" : "sm"}
      onClick={toggle}
      className={
        collapsed ? "w-full justify-center" : "w-full justify-start gap-2"
      }
      aria-label={
        theme === "dark" ? "Switch to light mode" : "Switch to dark mode"
      }
    >
      <Icon className="h-4 w-4" />
      {!collapsed && (theme === "dark" ? "Light mode" : "Dark mode")}
    </Button>
  );
}
