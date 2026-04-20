import { useQuery } from "@tanstack/react-query";
import { ChevronRight, File, Folder, FolderUp } from "lucide-react";
import { useState } from "react";
import { fetchDirectory } from "@/api/files";
import { queryKeys } from "@/api/queryKeys";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";

interface FileBrowserProps {
  onSelect: (path: string) => void;
  trigger?: React.ReactNode;
}

export function FileBrowser({ onSelect, trigger }: FileBrowserProps) {
  const [open, setOpen] = useState(false);
  const [currentPath, setCurrentPath] = useState<string | undefined>(undefined);

  const { data: listing } = useQuery({
    queryKey: queryKeys.files(currentPath ?? "~"),
    queryFn: () => fetchDirectory(currentPath),
    enabled: open,
  });

  const breadcrumbs = listing?.path.split("/").filter(Boolean) ?? [];

  const handleFileClick = (name: string) => {
    const fullPath = listing ? `${listing.path}/${name}` : name;
    onSelect(fullPath);
    setOpen(false);
  };

  const handleDirClick = (name: string) => {
    const fullPath = listing ? `${listing.path}/${name}` : name;
    setCurrentPath(fullPath);
  };

  const handleBreadcrumb = (index: number) => {
    const path = `/${breadcrumbs.slice(0, index + 1).join("/")}`;
    setCurrentPath(path);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button variant="outline" size="sm">
            <Folder className="mr-1 h-3 w-3" />
            Browse
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Select Data File</DialogTitle>
        </DialogHeader>

        {/* Breadcrumbs */}
        <div className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
          <button
            type="button"
            className="hover:text-foreground"
            onClick={() => setCurrentPath("/")}
          >
            /
          </button>
          {breadcrumbs.map((segment, i) => (
            <span key={`bc-${i}`} className="flex items-center gap-1">
              <ChevronRight className="h-3 w-3" />
              <button
                type="button"
                className="hover:text-foreground"
                onClick={() => handleBreadcrumb(i)}
              >
                {segment}
              </button>
            </span>
          ))}
        </div>

        {/* File list */}
        <ScrollArea className="h-[300px] rounded border">
          <div className="divide-y">
            {/* Parent directory */}
            {listing?.parent && (
              <button
                type="button"
                className="flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-accent"
                onClick={() => setCurrentPath(listing.parent as string)}
              >
                <FolderUp className="h-4 w-4 text-muted-foreground" />
                <span>..</span>
              </button>
            )}
            {listing?.entries.map((entry) => (
              <button
                type="button"
                key={entry.name}
                className="flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-accent"
                onClick={() =>
                  entry.type === "directory"
                    ? handleDirClick(entry.name)
                    : handleFileClick(entry.name)
                }
              >
                {entry.type === "directory" ? (
                  <Folder className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <File className="h-4 w-4 text-muted-foreground" />
                )}
                <span className="flex-1 text-left">{entry.name}</span>
                {entry.size != null && (
                  <span className="text-xs text-muted-foreground">
                    {formatSize(entry.size)}
                  </span>
                )}
              </button>
            ))}
            {listing?.entries.length === 0 && !listing.parent && (
              <p className="p-4 text-center text-sm text-muted-foreground">
                No supported files found
              </p>
            )}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
