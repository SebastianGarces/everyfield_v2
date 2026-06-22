// ============================================================================
// PlantHealthCard — one plant's privacy-safe oversight summary (PE-017).
//
// Presentational server component. Renders ONLY the network-audience insights
// and the coarse health classification it is handed by the read layer
// (lib/phase-engine/oversight/read.ts). It performs no data access and no
// privacy logic of its own — by the time data reaches this component it is
// already gated. Framing is deliberately conservative: an "observation, not a
// verdict", never a pass/fail score.
// ============================================================================

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { PHASES } from "@/lib/constants";
import type {
  PlantHealthClassification,
  PlantHealthSummary,
} from "@/lib/phase-engine/oversight/read";

// ----------------------------------------------------------------------------
// Classification presentation — coarse posture, intentionally non-judgmental.
// ----------------------------------------------------------------------------

const CLASSIFICATION_META: Record<
  PlantHealthClassification,
  { label: string; badgeVariant: "secondary" | "outline" | "destructive" }
> = {
  "on-track": { label: "On track", badgeVariant: "secondary" },
  watch: { label: "Worth a look", badgeVariant: "outline" },
  readiness: { label: "Readiness focus", badgeVariant: "destructive" },
};

function launchLabel(daysUntilLaunch: number | null): string | null {
  if (daysUntilLaunch === null) return null;
  if (daysUntilLaunch < 0) {
    return `Launch ${Math.abs(daysUntilLaunch)}d ago`;
  }
  if (daysUntilLaunch === 0) return "Launching today";
  return `Launch in ${daysUntilLaunch}d`;
}

export function PlantHealthCard({ plant }: { plant: PlantHealthSummary }) {
  const meta = CLASSIFICATION_META[plant.classification];
  const phaseLabel =
    PHASES[plant.currentPhase as keyof typeof PHASES] ??
    `Phase ${plant.currentPhase}`;
  const launch = launchLabel(plant.daysUntilLaunch);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="truncate">{plant.churchName}</CardTitle>
            <CardDescription className="mt-1">{phaseLabel}</CardDescription>
          </div>
          <Badge variant={meta.badgeVariant} className="shrink-0">
            {meta.label}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        {launch && <p className="text-muted-foreground text-xs">{launch}</p>}

        {!plant.hasSharedContent ? (
          <p className="text-muted-foreground text-sm">
            This plant has not shared detailed data with oversight. Only its
            current phase is visible.
          </p>
        ) : plant.insights.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No network observations from the latest assessment.
          </p>
        ) : (
          <ul className="space-y-2">
            {plant.insights.map((insight) => (
              <li key={insight.id} className="rounded-md border p-3 text-sm">
                <p className="font-medium">{insight.title}</p>
                <p className="text-muted-foreground mt-1">{insight.body}</p>
              </li>
            ))}
          </ul>
        )}

        <p className="text-muted-foreground border-t pt-3 text-xs">
          An observation from the latest assessment, not a verdict. Reflects
          only what this plant has chosen to share.
        </p>
      </CardContent>
    </Card>
  );
}
