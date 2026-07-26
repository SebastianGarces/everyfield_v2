// ============================================================================
// CsfScorecard — the 8 Critical Success Factors as a scorecard (PE-023).
//
// Presentational server component. It performs NO data access and NO judgement
// of its own: it is handed a `CsfScorecard` that the assessment read layer
// projected from the persisted `plant_assessments` snapshot
// (lib/phase-engine/assessment/queries.ts, `buildCsfScorecard`). Every standing
// on this card is the severity the judge already assigned inside that
// assessment.
//
// Why it exists: the engine produces one composite verdict plus ranked prose.
// A planter reading "you're behind on leadership" cannot tell whether that is
// one weak factor or five. Eight fixed tiles turn the verdict into something
// diagnosable.
//
// ---------------------------------------------------------------------------
// The design constraints this file is written against
// ---------------------------------------------------------------------------
//
// 1. IT MUST READ AS AN ASSESSMENT, NOT A SCORE. This renders LLM-derived
//    judgement. A percentage, a 0–10, a progress bar or a filled meter would
//    all claim a precision the underlying judgement does not have — that is the
//    failure mode for this surface. So the encoding is a *status* one: a named
//    ordinal standing, with an icon and a word, and no quantity anywhere. The
//    footnote says so in plain language rather than relying on the reader to
//    infer it.
//
// 2. COLOUR IS NEVER THE ONLY CUE. Every standing carries an icon, a text
//    label, and a tint — matching the attention scale already established on
//    the oversight cards (components/phase-engine/plant-health-card.tsx) and
//    reusing its tokens. The card survives greyscale, colour-vision differences
//    and forced-colors.
//
//    What plant-health-card verified is *ink-on-tint* (the `-ink` pairs) and
//    full-foreground body text over a tint — NOT muted grey on a tint, which
//    that file explicitly rejects at plant-health-card.tsx:174-177 because it
//    measures below AA. So secondary text on a tinted tile here cannot borrow
//    `text-muted-foreground`; it gets a per-standing `meta` ink instead, and
//    every tint was re-measured in both themes (see STANDING_STYLES).
//
// 3. THE 8 TILES NEVER MOVE. They render in rubric order (CSF-1 → CSF-8), not
//    urgency order. A scorecard is a fixed reference frame the planter learns
//    the shape of; re-sorting it every cycle would destroy that, and the Focus
//    panel directly below is already ordered by urgency. The summary line does
//    the scanning work instead.
//
// 4. "NOT RAISED" IS ITS OWN STATE. A factor the assessment did not speak to is
//    not passing and not failing, and must never be shown as either.
// ============================================================================

import { CircleCheck, Eye, Info, Minus, TriangleAlert } from "lucide-react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type {
  CsfFactorStanding,
  CsfScorecard as CsfScorecardData,
  CsfStanding,
} from "@/lib/phase-engine/assessment";
import { cn } from "@/lib/utils";

// ----------------------------------------------------------------------------
// Standing presentation.
//
// A reserved status scale: these tokens mean good/attention here and nowhere
// else in the app mean "series 3". `attention-*` and its `-ink` pairs come from
// the app's attention scale; the strength step uses the same emerald the Focus
// panel already uses for a positive delta, so "good" looks the same on both
// halves of this page.
// ----------------------------------------------------------------------------

interface StandingStyle {
  /** The word the reader actually reads. Colour only reinforces it. */
  label: string;
  Icon: typeof TriangleAlert;
  /** Tile border + tint. */
  container: string;
  /** Ink for the icon + label pair. */
  ink: string;
  /**
   * Ink for the tile's secondary text (the "CSF n" eyebrow, the cited-facts
   * line, the overflow count).
   *
   * This is per-standing rather than a single shared class because a tint
   * changes what secondary text may be. `text-muted-foreground` is only legal
   * on the two untinted standings; over a tint it drops below AA:
   *
   *   muted grey on…              light   dark
   *   bg-attention-high/12         3.89    6.15   ✗ light
   *   bg-attention-medium/18       4.00    5.04   ✗ light
   *   bg-emerald-500/10            4.30    5.99   ✗ light
   *   no tint (card)               4.73    6.91   ✓
   *
   * All of this text is under 18.66px, so the large-text exemption does not
   * apply — it needs 4.5:1. The tinted standings therefore use a faded
   * foreground, which clears it with room in both themes while staying a
   * visible step below the tile's body copy:
   *
   *   text-foreground/70 on…       light   dark
   *   bg-attention-high/12         6.96    8.12   ✓
   *   bg-attention-medium/18       7.06    6.98   ✓
   *   bg-emerald-500/10            7.31    7.96   ✓
   *
   * Fading the foreground rather than dropping the tint is deliberate: the
   * tint is the standing's third redundant cue (constraint 2) and carries real
   * information, so it stays.
   */
  meta: string;
}

/** Secondary-text ink for tinted tiles. See `StandingStyle.meta`. */
const META_ON_TINT = "text-foreground/70";

const STANDING_STYLES: Record<CsfStanding, StandingStyle> = {
  attention: {
    label: "Needs attention",
    Icon: TriangleAlert,
    container: "border-attention-high/45 bg-attention-high/12",
    ink: "text-attention-high-ink",
    meta: META_ON_TINT,
  },
  watch: {
    label: "Worth a look",
    Icon: Eye,
    container: "border-attention-medium/45 bg-attention-medium/18",
    ink: "text-attention-medium-ink",
    meta: META_ON_TINT,
  },
  noted: {
    // No tint: the absence of colour is a real step on the ramp, not a gap.
    label: "Noted",
    Icon: Info,
    container: "border-border",
    ink: "text-foreground/80",
    meta: "text-muted-foreground",
  },
  strength: {
    label: "Going well",
    Icon: CircleCheck,
    container: "border-emerald-600/40 bg-emerald-500/10",
    ink: "text-emerald-700 dark:text-emerald-400",
    meta: META_ON_TINT,
  },
  not_raised: {
    // Dashed border, no tint: visibly a placeholder rather than a verdict.
    label: "Not raised",
    Icon: Minus,
    container: "border-border border-dashed",
    ink: "text-muted-foreground",
    meta: "text-muted-foreground",
  },
};

const AS_OF_FORMAT = new Intl.DateTimeFormat("en-US", {
  month: "long",
  day: "numeric",
  year: "numeric",
});

/** How many cited facts a tile shows before it stops. */
const MAX_TILE_FACTS = 2;

// ----------------------------------------------------------------------------
// One factor.
// ----------------------------------------------------------------------------

function FactorTile({ factor }: { factor: CsfFactorStanding }) {
  const style = STANDING_STYLES[factor.standing];
  const [lead, ...rest] = factor.insights;
  const citedFacts = ((lead?.citedFacts as string[] | null) ?? []).filter(
    Boolean
  );
  const shownFacts = citedFacts.slice(0, MAX_TILE_FACTS);
  const hiddenFactCount = citedFacts.length - shownFacts.length;

  return (
    <li className={cn("rounded-lg border p-3.5", style.container)}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p
            className={cn(
              "text-[0.6875rem] font-medium tracking-wide tabular-nums",
              style.meta
            )}
          >
            CSF {factor.number}
          </p>
          <h3 className="mt-0.5 text-sm leading-snug font-semibold text-pretty">
            {factor.name}
          </h3>
        </div>
        {/* Icon + word + colour. Any two of the three can be lost and the
            standing still reads. */}
        <p
          className={cn(
            "inline-flex shrink-0 items-center gap-1 text-[0.6875rem] font-semibold tracking-wide uppercase",
            style.ink
          )}
        >
          <style.Icon className="size-3.5" aria-hidden="true" />
          {style.label}
        </p>
      </div>

      {lead ? (
        <>
          {/* Full foreground, not muted: this is the content of the tile. */}
          <p className="mt-2 max-w-[60ch] text-sm leading-relaxed text-pretty">
            {lead.title}
          </p>
          {shownFacts.length > 0 && (
            <p className={cn("mt-1.5 text-xs tabular-nums", style.meta)}>
              Based on {shownFacts.join(", ")}
              {hiddenFactCount > 0 && ` +${hiddenFactCount} more`}
            </p>
          )}
          {rest.length > 0 && (
            <p className={cn("mt-1 text-xs", style.meta)}>
              {rest.length === 1
                ? "1 more observation"
                : `${rest.length} more observations`}{" "}
              on this factor in your focus list.
            </p>
          )}
        </>
      ) : (
        <p className="text-muted-foreground mt-2 max-w-[60ch] text-sm leading-relaxed text-pretty">
          {factor.summary}
        </p>
      )}
    </li>
  );
}

// ----------------------------------------------------------------------------
// The scorecard.
// ----------------------------------------------------------------------------

/**
 * Summarise the eight standings in one sentence, so the card can be scanned
 * without re-sorting the tiles. Deliberately counts rather than ranks — it
 * points at the tiles, it does not replace them.
 */
function summaryLine(scorecard: CsfScorecardData): string {
  const attention = scorecard.factors.filter(
    (f) => f.standing === "attention"
  ).length;
  const watch = scorecard.factors.filter((f) => f.standing === "watch").length;

  if (attention > 0 && watch > 0) {
    return `${attention} of 8 need attention, ${watch} worth a look.`;
  }
  if (attention > 0) {
    return attention === 1
      ? "1 of 8 needs attention."
      : `${attention} of 8 need attention.`;
  }
  if (watch > 0) {
    return watch === 1
      ? "1 of 8 is worth a look."
      : `${watch} of 8 are worth a look.`;
  }
  if (scorecard.raisedCount === 0) {
    return "The latest assessment raised nothing against any of the eight.";
  }
  return "Nothing needs attention across the eight this cycle.";
}

interface CsfScorecardProps {
  /**
   * The scorecard projected from the latest persisted assessment, or null when
   * the plant has never completed one (cold start).
   */
  scorecard: CsfScorecardData | null;
}

export function CsfScorecard({ scorecard }: CsfScorecardProps) {
  // Cold start. Eight "not raised" tiles would say the engine looked at each
  // factor and found nothing to say — it has not looked at all. That is a
  // materially different claim, so this state renders no tiles.
  if (!scorecard) {
    return (
      <Card>
        <CardHeader>
          {/* h2 for the same reason as the populated card below. */}
          <CardTitle>
            <h2>Critical success factors</h2>
          </CardTitle>
          <CardDescription>
            Your plant hasn&apos;t been assessed yet. Once the first assessment
            runs, the eight critical success factors appear here with how each
            one reads — so you can see which factor a verdict is coming from.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground max-w-[65ch] text-sm text-pretty">
            Assessments run automatically as your plant records activity. Adding
            core-group members, holding vision meetings and attesting your
            progress all bring the first one forward.
          </p>
        </CardContent>
      </Card>
    );
  }

  const asOf = AS_OF_FORMAT.format(new Date(scorecard.generatedAt));

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            {/* An h2, so the page reads h1 → h2 → h3 (the tiles). CardTitle is
                a plain div; Tailwind's preflight resets heading size, weight
                and margin, so nesting the real heading inside it changes the
                outline without changing a pixel. */}
            <CardTitle>
              <h2>Critical success factors</h2>
            </CardTitle>
            <CardDescription>
              How the latest assessment reads each of the eight.{" "}
              {summaryLine(scorecard)}
            </CardDescription>
          </div>
          {/* Freshness and provenance sit next to the claim they qualify. */}
          <p className="text-muted-foreground text-xs whitespace-nowrap tabular-nums">
            As of {asOf} &middot; rubric {scorecard.rubricVersion}
          </p>
        </div>
      </CardHeader>

      <CardContent>
        <ul
          aria-label="Critical success factors"
          className="grid gap-3 sm:grid-cols-2"
        >
          {scorecard.factors.map((factor) => (
            <FactorTile key={factor.category} factor={factor} />
          ))}
        </ul>

        {/* Says the quiet part out loud. The whole card is a judgement, and a
            reader who mistakes it for measurement will over-trust it. */}
        <p className="text-muted-foreground mt-4 max-w-[75ch] text-xs text-pretty">
          These are readings from your latest assessment, not measured scores.
          &ldquo;Not raised&rdquo; means the assessment had nothing to say about
          that factor this time — not that it is failing.
        </p>
      </CardContent>
    </Card>
  );
}
