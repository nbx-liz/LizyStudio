import { useEffect } from "react";
import type { JobDetail } from "@/api/types";
import { JobResultsBody } from "@/components/shared/JobResultsBody";
import { useJobResultData } from "@/hooks/useJobResultData";

interface CompletedContentProps {
  job: JobDetail;
  selectedPlot: string;
  onSelectPlot: (p: string) => void;
}

export function CompletedContent({
  job,
  selectedPlot,
  onSelectPlot,
}: CompletedContentProps) {
  const data = useJobResultData({ job, selectedPlot });
  const { plots } = data;

  useEffect(() => {
    if (plots && plots.length > 0 && !selectedPlot) {
      const first = plots.find((p) => p !== "tuning");
      if (first) onSelectPlot(first);
    }
  }, [plots, selectedPlot, onSelectPlot]);

  return (
    <JobResultsBody
      job={job}
      selectedPlot={selectedPlot}
      onSelectPlot={onSelectPlot}
      data={data}
      showScoreAccordion
    />
  );
}
