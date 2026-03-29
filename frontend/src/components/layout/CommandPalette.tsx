import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

interface CommandItem {
  id: string;
  label: string;
  shortcut?: string;
  action: () => void;
}

interface CommandPaletteProps {
  onFit?: () => void;
  onTune?: () => void;
}

export function CommandPalette({ onFit, onTune }: CommandPaletteProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const navigate = useNavigate();

  const commands: CommandItem[] = useMemo(
    () => [
      {
        id: "go-workspace",
        label: "Go to Workspace",
        shortcut: "G W",
        action: () => navigate("/"),
      },
      {
        id: "go-jobs",
        label: "Go to Jobs",
        shortcut: "G J",
        action: () => navigate("/jobs"),
      },
      {
        id: "go-inference",
        label: "Go to Inference",
        shortcut: "G I",
        action: () => navigate("/inference"),
      },
      ...(onFit
        ? [
            {
              id: "run-fit",
              label: "Run Fit",
              shortcut: "Ctrl+Enter",
              action: () => onFit(),
            },
          ]
        : []),
      ...(onTune
        ? [
            {
              id: "run-tune",
              label: "Run Tune",
              shortcut: "Ctrl+Shift+Enter",
              action: () => onTune(),
            },
          ]
        : []),
      {
        id: "toggle-theme",
        label: "Toggle Dark Mode",
        action: () => {
          const isDark = document.documentElement.classList.toggle("dark");
          try {
            localStorage.setItem("theme", isDark ? "dark" : "light");
          } catch {
            // localStorage unavailable
          }
        },
      },
    ],
    [navigate, onFit, onTune],
  );

  const filtered = useMemo(() => {
    if (!query) return commands;
    const q = query.toLowerCase();
    return commands.filter((c) => c.label.toLowerCase().includes(q));
  }, [commands, query]);

  // Ctrl+K to open
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const handleSelect = (cmd: CommandItem) => {
    setOpen(false);
    setQuery("");
    cmd.action();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) setQuery("");
      }}
    >
      <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-lg">
        <DialogTitle className="sr-only">Command Palette</DialogTitle>
        <div className="border-b px-3 py-2">
          <Input
            className="h-9 border-0 p-0 shadow-none focus-visible:ring-0"
            placeholder="Type a command..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
          />
        </div>
        <div className="max-h-64 overflow-auto p-1">
          {filtered.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">
              No commands found
            </p>
          ) : (
            filtered.map((cmd) => (
              <button
                key={cmd.id}
                type="button"
                className="flex w-full items-center justify-between rounded-sm px-3 py-2 text-sm hover:bg-accent"
                onClick={() => handleSelect(cmd)}
              >
                <span>{cmd.label}</span>
                {cmd.shortcut && (
                  <kbd className="text-xs text-muted-foreground">
                    {cmd.shortcut}
                  </kbd>
                )}
              </button>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
