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
// THE GRID IS TWO COLUMNS, NOT THREE, AND ASSOCIATION SPANS BOTH. The three
// facts are not the same shape: "Daniel Reyes" and "21 days to launch" are
// chips of data, while provenance is a sentence that can run to eighty
// characters. Giving all three an equal third of the row left the two short
// values marooned in whitespace and still wrapped the long one — so the column
// count follows the content, and the label→value pairs stay close enough to
// read as pairs (4px inside a pair, 16px between them: the 2× separation
// grouping needs to survive).
//
// LABELS ARE LABELS, VALUES ARE DATA. The label carries the muted role token
// and the value carries ink. When both sat at `muted-foreground` the pair had
// no internal hierarchy and the row read as one gray smear — measured, that is
// 4.74:1 for both against a white card where the value now reads 17.09:1.
//
// Everything here is already formatted by `@/lib/oversight/presentation` — no
// `Date` is formatted in this file, because a `Date` formatted in the visitor's
// zone and again on the server is a hydration mismatch (memory/invariants.md →
// Date & Time Rendering).
// ============================================================================

import {
  formatAssociationProvenance,
  formatLaunchCountdown,
  formatPhase,
} from "@/lib/oversight/presentation";
import type { OversightPlantSummary } from "@/lib/oversight/types";
import { cn } from "@/lib/utils";

export function PlantFacts({
  plant,
  className,
  includePhase = false,
}: {
  plant: OversightPlantSummary;
  className?: string;
  /** The directory's narrow layout labels all five comparison facts. */
  includePhase?: boolean;
}) {
  return (
    <dl className={cn("grid gap-x-8 gap-y-4 sm:grid-cols-2", className)}>
      {includePhase ? (
        <Fact label="Phase" value={formatPhase(plant.currentPhase)} />
      ) : null}
      <Fact
        label="Planter"
        value={plant.planterName ?? "No planter assigned yet"}
        isMuted={plant.planterName === null}
      />
      <Fact
        label="Launch"
        value={formatLaunchCountdown(plant.daysUntilLaunch)}
        isMuted={plant.daysUntilLaunch === null}
        // The countdown changes every day and is compared down the list, so its
        // digits are tabular — proportional ones make the column jitter.
        isNumeric
      />
      <Fact
        label="Association"
        value={formatAssociationProvenance(plant.provenance)}
        className="sm:col-span-2"
      />
    </dl>
  );
}

function Fact({
  label,
  value,
  isMuted = false,
  isNumeric = false,
  className,
}: {
  label: string;
  value: string;
  isMuted?: boolean;
  isNumeric?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("min-w-0 space-y-1", className)}>
      <dt className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
        {label}
      </dt>
      <dd
        className={cn(
          // Capped measure: the provenance sentence ran to ~105 characters on
          // one line across a wide card, well past the 60–75 the eye can track
          // back to the next line. The cap is harmless for the short values.
          "max-w-prose text-sm text-pretty",
          isNumeric && "tabular-nums",
          // An absent value keeps the muted role — "we do not know this" is a
          // different fact from the ones we do know, and it should not compete
          // with them.
          isMuted ? "text-muted-foreground" : "text-foreground font-medium"
        )}
      >
        {value}
      </dd>
    </div>
  );
}
