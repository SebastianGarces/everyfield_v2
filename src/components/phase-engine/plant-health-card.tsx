// ============================================================================
// PlantHealthCard — one plant's privacy-safe oversight summary (PE-017).
//
// Presentational server component. Renders ONLY the network-audience insights
// and the coarse health classification it is handed by the read layer
// (lib/phase-engine/oversight/read.ts). It performs no data access and no
// privacy logic of its own — by the time data reaches this component it is
// already gated. Framing is deliberately conservative: an "observation, not a
// verdict", never a pass/fail score.
//
// Two densities, because a portfolio is scanned rather than read:
//   - `PlantHealthCard`  full card, for plants that warrant a conversation.
//   - `PlantHealthRow`   one line, for plants that don't. Their observations
//                        stay reachable behind a disclosure rather than
//                        spending the operator's attention up front.
//
// Neither renders the classification badge: both are rendered inside a labelled
// section (see the health page) and repeating the label on every card would be
// noise the operator has to read past to reach the observations.
// ============================================================================

import type { PlantInsight } from "@/db/schema";
import { PHASES } from "@/lib/constants";
import {
  assessedAgoLabel,
  emphasisForSeverity,
  launchLabel,
  sortInsightsByUrgency,
  type InsightEmphasis,
} from "@/lib/phase-engine/oversight/health-presentation";
import {
  READINESS_LAUNCH_WINDOW_DAYS,
  type PlantHealthSummary,
} from "@/lib/phase-engine/oversight/read";
import { cn } from "@/lib/utils";

// ----------------------------------------------------------------------------
// Insight emphasis presentation.
//
// Colour is never the only cue: every level also carries its own text label and
// a left rule, so the scale survives greyscale and colour-vision differences.
// ----------------------------------------------------------------------------

const EMPHASIS_STYLES: Record<
  InsightEmphasis,
  { container: string; label: string; text: string }
> = {
  high: {
    container: "border-attention-high/45 bg-attention-high/12",
    label: "text-attention-high-ink",
    text: "High",
  },
  medium: {
    container: "border-attention-medium/45 bg-attention-medium/18",
    label: "text-attention-medium-ink",
    text: "Medium",
  },
  low: {
    // No tint: the absence of colour is the third step of the ramp.
    container: "border-border",
    label: "text-foreground/80",
    text: "Low",
  },
};

function phaseLabel(currentPhase: number): string {
  return PHASES[currentPhase as keyof typeof PHASES] ?? `Phase ${currentPhase}`;
}

// ----------------------------------------------------------------------------
// Shared pieces.
// ----------------------------------------------------------------------------

/**
 * Phase, launch countdown and snapshot age on one line. Freshness sits next to
 * the claim it qualifies: a portfolio read is only actionable if the operator
 * can see how old it is.
 */
function PlantMeta({
  plant,
  trailing,
  className,
}: {
  plant: PlantHealthSummary;
  /** Extra fact to sit on the same line, e.g. why a row has nothing to open. */
  trailing?: React.ReactNode;
  className?: string;
}) {
  const launch = launchLabel(
    plant.daysUntilLaunch,
    READINESS_LAUNCH_WINDOW_DAYS
  );
  const assessed = assessedAgoLabel(plant.generatedAt);

  return (
    <p
      className={cn(
        "text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-1 text-xs tabular-nums",
        className
      )}
    >
      <span>{phaseLabel(plant.currentPhase)}</span>
      {launch && (
        <>
          <span aria-hidden="true">&middot;</span>
          <span
            className={cn(
              launch.imminent && "text-attention-high-ink font-semibold"
            )}
          >
            {launch.text}
          </span>
        </>
      )}
      {assessed && (
        <>
          <span aria-hidden="true">&middot;</span>
          <span>{assessed}</span>
        </>
      )}
      {trailing && (
        <>
          <span aria-hidden="true">&middot;</span>
          <span>{trailing}</span>
        </>
      )}
    </p>
  );
}

/**
 * Why a card has no observations. The three reasons are materially different
 * to an operator and must never collapse into one message: a plant that has
 * never been assessed has withheld nothing, and saying otherwise misrepresents
 * the planter.
 */
function emptyStateMessage(plant: PlantHealthSummary): string | null {
  if (plant.generatedAt === null) {
    return "Not assessed yet. Observations appear after this plant's first assessment.";
  }
  if (!plant.hasSharedContent) {
    return "This plant shares only its phase with oversight. Nothing else is visible here.";
  }
  if (plant.insights.length === 0) {
    return "Nothing raised for the network in the latest assessment.";
  }
  return null;
}

function InsightItem({ insight }: { insight: PlantInsight }) {
  const emphasis = EMPHASIS_STYLES[emphasisForSeverity(insight.severity)];

  return (
    <li className={cn("rounded-md border p-3", emphasis.container)}>
      {/* The level rides on the title's line rather than above it: at ~20
          observations a page, a dedicated line per level is a screenful of
          labels the operator has to read past to reach the observations.

          Plain coloured text, not a filled pill. Reversing 10px type out of a
          saturated fill measured fine on contrast (APCA Lc -80) and was still
          unreadable — at that size the letterforms are the constraint, not the
          contrast. Dark-on-light at 11px fixes what more contrast could not. */}
      <p className="text-sm font-medium text-pretty">
        <span
          className={cn(
            "me-1.5 align-[0.02em] text-[0.6875rem] font-semibold tracking-wide uppercase",
            emphasis.label
          )}
        >
          {emphasis.text}
        </span>
        {insight.title}
      </p>
      {/* Full foreground, not `muted-foreground`: this is the content of the
          page, not chrome. Muted grey measures 4.32:1 once the tint is under
          it — below AA — and the hierarchy the grey was buying is already
          carried by the title's weight. */}
      <p className="mt-1 max-w-[65ch] text-sm leading-relaxed text-pretty">
        {insight.body}
      </p>
    </li>
  );
}

function InsightList({
  plant,
  className,
}: {
  plant: PlantHealthSummary;
  className?: string;
}) {
  const emptyMessage = emptyStateMessage(plant);

  if (emptyMessage) {
    return (
      <p
        className={cn(
          "text-muted-foreground max-w-[65ch] text-sm text-pretty",
          className
        )}
      >
        {emptyMessage}
      </p>
    );
  }

  return (
    <ul className={cn("space-y-2", className)}>
      {sortInsightsByUrgency(plant.insights).map((insight) => (
        <InsightItem key={insight.id} insight={insight} />
      ))}
    </ul>
  );
}

// ----------------------------------------------------------------------------
// Full card — plants that warrant a conversation.
// ----------------------------------------------------------------------------

export function PlantHealthCard({ plant }: { plant: PlantHealthSummary }) {
  return (
    <article className="bg-card text-card-foreground rounded-xl border p-5">
      <h3
        className="leading-snug font-semibold text-pretty"
        title={plant.churchName}
      >
        {plant.churchName}
      </h3>
      <PlantMeta plant={plant} className="mt-1.5" />
      <InsightList plant={plant} className="mt-4" />
    </article>
  );
}

// ----------------------------------------------------------------------------
// Compact row — plants that don't need attention this cycle.
//
// Phase, launch and freshness stay visible; only the (low-severity by
// definition) observations are disclosed, via a native <details> so the
// affordance, keyboard support and Ctrl+F behaviour come for free.
// ----------------------------------------------------------------------------

export function PlantHealthRow({ plant }: { plant: PlantHealthSummary }) {
  const count = plant.insights.length;

  return (
    <li className="bg-card text-card-foreground rounded-xl border px-5 py-4">
      <h3 className="font-medium text-pretty" title={plant.churchName}>
        {plant.churchName}
      </h3>
      {/* Every fact about the plant stays on one left-aligned line. Pushing the
          status to the far edge of a full-width row separates it from the name
          it describes by most of the viewport. */}
      <PlantMeta
        plant={plant}
        className="mt-1"
        trailing={count === 0 ? emptyStateHint(plant) : undefined}
      />

      {count > 0 && (
        <details className="group mt-2">
          <summary className="focus-visible:ring-ring text-muted-foreground hover:text-foreground -mx-1 inline-flex cursor-pointer list-none items-center gap-1 rounded-sm px-1 py-1 text-xs transition-colors focus-visible:ring-2 focus-visible:outline-none">
            {count === 1 ? "1 observation" : `${count} observations`}
            <span
              className="inline-block transition-transform duration-150 ease-out group-open:rotate-90 motion-reduce:transition-none"
              aria-hidden="true"
            >
              &rsaquo;
            </span>
          </summary>
          <InsightList plant={plant} className="mt-2" />
        </details>
      )}
    </li>
  );
}

/** Short reason a compact row has nothing to disclose. */
function emptyStateHint(plant: PlantHealthSummary): string {
  if (plant.generatedAt === null) return "Not assessed yet";
  if (!plant.hasSharedContent) return "Phase only";
  return "No observations";
}
