import type { PipelineMetrics as PipelineMetricsType } from "@/lib/people/types";
import { ArrowRight } from "lucide-react";

interface PipelineMetricsProps {
  metrics: PipelineMetricsType;
}

/**
 * Format a status name for display
 */
function formatStatus(status: string): string {
  return status
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/**
 * Format a conversion rate as a percentage
 */
function formatRate(rate: number): string {
  if (rate === 0) return "0%";
  const pct = Math.round(rate * 100);
  return `${pct}%`;
}

export function PipelineMetrics({ metrics }: PipelineMetricsProps) {
  const { conversions } = metrics;

  // Only show conversions that have data (total > 0)
  const activeConversions = conversions.filter((c) => c.total > 0);

  if (activeConversions.length === 0) {
    return null;
  }

  return (
    <div className="border-t px-4 py-3">
      <p className="text-muted-foreground mb-2 text-xs font-medium tracking-wide uppercase">
        Conversion Rates
      </p>
      <div className="flex flex-wrap gap-x-6 gap-y-1">
        {activeConversions.map((conversion) => (
          <div
            key={`${conversion.from}-${conversion.to}`}
            className="flex items-center gap-1.5 text-sm"
          >
            <span className="text-muted-foreground">
              {formatStatus(conversion.from)}
            </span>
            <ArrowRight className="text-muted-foreground/50 h-3 w-3" />
            <span className="text-muted-foreground">
              {formatStatus(conversion.to)}:
            </span>
            <span className="font-semibold">{formatRate(conversion.rate)}</span>
            <span className="text-muted-foreground text-xs">
              ({conversion.count}/{conversion.total})
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
