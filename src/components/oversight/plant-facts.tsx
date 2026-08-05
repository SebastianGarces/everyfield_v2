// ============================================================================
// The four facts that identify a plant to its oversight org (OV-001).
//
// Shared by the directory row and the detail header so the two cannot describe
// the same plant differently — the row an admin clicked and the page they land
// on are the same sentence, rendered twice.
//
// A description list, not a grid of divs: "Planter", "Launch" and "Association"
// are labels FOR values, and `dl`/`dt`/`dd` is how a screen reader is told so.
//
// Everything here is already formatted by `@/lib/oversight/presentation` — no
// `Date` is formatted in this file, because a `Date` formatted in the visitor's
// zone and again on the server is a hydration mismatch (memory/invariants.md →
// Date & Time Rendering).
// ============================================================================

import {
  formatAssociationProvenance,
  formatLaunchCountdown,
} from "@/lib/oversight/presentation";
import type { OversightPlantSummary } from "@/lib/oversight/types";

export function PlantFacts({
  plant,
  className,
}: {
  plant: OversightPlantSummary;
  className?: string;
}) {
  return (
    <dl
      className={
        className ??
        "grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-3"
      }
    >
      <Fact
        label="Planter"
        value={plant.planterName ?? "No planter assigned yet"}
        isMuted={plant.planterName === null}
      />
      <Fact
        label="Launch"
        value={formatLaunchCountdown(plant.daysUntilLaunch)}
        isMuted={plant.daysUntilLaunch === null}
      />
      <Fact
        label="Association"
        value={formatAssociationProvenance(plant.provenance)}
      />
    </dl>
  );
}

function Fact({
  label,
  value,
  isMuted = false,
}: {
  label: string;
  value: string;
  isMuted?: boolean;
}) {
  return (
    <div className="min-w-0 space-y-0.5">
      <dt className="text-muted-foreground text-xs tracking-wide uppercase">
        {label}
      </dt>
      <dd
        className={
          isMuted ? "text-muted-foreground text-pretty" : "text-pretty"
        }
      >
        {value}
      </dd>
    </div>
  );
}
