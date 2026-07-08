import { dump } from "js-yaml";
import { Copy } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

interface RawConfigDialogProps {
  config: Record<string, unknown> | undefined;
  trigger: React.ReactNode;
}

export function RawConfigDialog({ config, trigger }: RawConfigDialogProps) {
  const yamlText = config
    ? dump(config, { flowLevel: 3, lineWidth: 80 })
    : "No config";

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(yamlText);
      toast.success("Copied");
    } catch {
      toast.error("Failed to copy");
    }
  };

  return (
    <Dialog>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-h-[80vh] max-w-2xl overflow-auto">
        <DialogHeader>
          <DialogTitle>Raw Config (read-only)</DialogTitle>
        </DialogHeader>
        <div className="relative">
          <Button
            variant="outline"
            size="sm"
            className="absolute top-2 right-2"
            onClick={handleCopy}
            type="button"
          >
            <Copy className="h-3 w-3" />
          </Button>
          <pre className="max-h-[60vh] overflow-auto rounded bg-muted p-4 pr-16 text-xs font-mono">
            {yamlText}
          </pre>
        </div>
      </DialogContent>
    </Dialog>
  );
}
