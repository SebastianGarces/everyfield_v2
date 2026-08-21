// ============================================================================
// ExitCriteria — the current phase's gates, one row each, openable onto the
// facts underneath them (PE-022 + PE-025).
//
// Presentational server component. It performs NO data access and NO judgement
// of its own: it is handed an `ExitCriteriaProgress` that the assessment read
// layer projected from the persisted `plant_assessments` snapshot
// (lib/phase-engine/assessment/exit-criteria.ts, `buildExitCriteriaProgress`).
// Every number on this card was read out of that snapshot by path; every
// standing is a severity the judge already assigned.
//
// Why it exists: the CSF scorecard above it answers "where does the plant
// stand"; this answers the other question a planter asks — "what is left before
// I can move on?" The rubric already names the gates per phase; until now they
// only reached the planter folded into prose.
//
// ---------------------------------------------------------------------------
// The design constraints this file is written against
// ---------------------------------------------------------------------------
//
// 1. TWO COLUMNS OF TRUTH, NEVER BLENDED. Each row carries a MEASUREMENT (what
//    the deterministic snapshot says: met / not met / no reading / not tracked)
//    and a STANDING (what the judge said about it, or "not addressed"). They are
//    rendered as two separate marks because they are two separate claims with
//    two different warrants. A single blended verdict would let a model opinion
//    masquerade as a measurement, which is the failure mode this whole surface
//    exists to avoid.
//
// 2. SILENCE IS NOT FAILURE. A criterion the assessment did not speak to reads
//    "Not addressed", in the neutral placeholder treatment — never the failed
//    one — and the drill-down says so in a sentence. Same for a gate EveryField
//    holds no signal for ("Not tracked"): the product not measuring something is
//    a fact about the product, not about the plant.
//
// 3. "NOT MET" IS NOT AN ALARM. A gate not yet cleared is the ordinary state of
//    a plant mid-phase. It gets a plain, uncoloured mark; the attention palette
//    is reserved for what the judge actually escalated.
//
// 4. THE DRILL-DOWN SHOWS THE SNAPSHOT, NOT THE MODEL. The judge chooses which
//    fact backs a finding; the VALUE always comes back out of the stored
//    snapshot (`snapshotValue`). Where the two disagree, the snapshot is what is
//    presented and the disagreement is said out loud. A citation whose path is
//    not in the snapshot is labelled as unverifiable rather than shown as
//    evidence.
//
// 5. THE DISCLOSURE IS A NATIVE <details>. Affordance, keyboard support, and
//    Ctrl+F-into-collapsed-content come free, and the card needs no client
//    bundle — the same choice, and the same summary treatment, as the oversight
//    compact row (components/phase-engine/plant-health-card.tsx).
//
// Server-safe on purpose: no "use client", no event handlers, no value-level
// import of anything server-only.
// ============================================================================

import {
  ChevronRight,
  CircleCheck,
  CircleDashed,
  CircleHelp,
  Eye,
  Info,
  Minus,
  MinusCircle,
  TriangleAlert,
} from "lucide-react";
import type { ComponentProps } from "react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { PHASES, type PhaseNumber } from "@/lib/constants";
import { formatDate } from "@/lib/datetime";
import type {
  CitedFactEvidence,
  ExitCriteriaProgress,
  ExitCriterionMeasureStatus,
  ExitCriterionProgress,
  ExitCriterionStanding,
  SnapshotFact,
} from "@/lib/phase-engine/assessment";
// The one humanising formatter, shared with the CSF scorecard and the Focus
// insight cards: a planter reads a fact in English, never in the judge's
// fact-ledger syntax.
import { formatCitedFact } from "@/lib/phase-engine/fact-format";
import { cn } from "@/lib/utils";

// ----------------------------------------------------------------------------
// The two marks.
// ----------------------------------------------------------------------------

interface MarkStyle {
  /** The word the reader actually reads. Colour only reinforces it. */
  label: string;
  Icon: typeof TriangleAlert;
  ink: string;
}

/**
 * The deterministic column. `met` is the only coloured step: it is the one
 * state that is unambiguously good news, and it is a measurement rather than an
 * opinion. `not_met` stays plain on purpose (constraint 3), and the two
 * "we cannot say" states are muted so they never read as a verdict.
 */
const MEASURE_STYLES: Record<ExitCriterionMeasureStatus, MarkStyle> = {
  met: {
    label: "Met",
    Icon: CircleCheck,
    ink: "text-emerald-700 dark:text-emerald-400",
  },
  not_met: {
    label: "Not met",
    Icon: CircleDashed,
    ink: "text-foreground/80",
  },
  unknown: {
    label: "No reading yet",
    Icon: CircleHelp,
    ink: "text-muted-foreground",
  },
  not_tracked: {
    label: "Not tracked",
    Icon: MinusCircle,
    ink: "text-muted-foreground",
  },
};

/**
 * The judge's column. The first four reuse the CSF scorecard's attention scale
 * verbatim, so "needs attention" looks the same on both halves of the page.
 */
const STANDING_STYLES: Record<ExitCriterionStanding, MarkStyle> = {
  attention: {
    label: "Needs attention",
    Icon: TriangleAlert,
    ink: "text-attention-high-ink",
  },
  watch: { label: "Worth a look", Icon: Eye, ink: "text-attention-medium-ink" },
  noted: { label: "Noted", Icon: Info, ink: "text-foreground/80" },
  strength: {
    label: "Going well",
    Icon: CircleCheck,
    ink: "text-emerald-700 dark:text-emerald-400",
  },
  not_addressed: {
    label: "Not addressed",
    Icon: Minus,
    ink: "text-muted-foreground",
  },
};

/** Icon + word + colour. Any two of the three can be lost and it still reads. */
function Mark({
  style,
  className,
  ...rest
}: { style: MarkStyle } & ComponentProps<"span">) {
  return (
    <span
      {...rest}
      className={cn(
        "inline-flex shrink-0 items-center gap-1 text-[0.6875rem] font-semibold tracking-wide uppercase",
        style.ink,
        className
      )}
    >
      <style.Icon className="size-3.5" aria-hidden="true" />
      {style.label}
    </span>
  );
}

// ----------------------------------------------------------------------------
// Facts, humanised.
// ----------------------------------------------------------------------------

/**
 * The two ways a fact can be empty are two different claims, and the drill-down
 * must never collapse them into one. Which of these two helpers a call site
 * reaches for IS that distinction, so it is made once, by name, here.
 *
 * A path that did NOT resolve has no value behind it: the de-camelised label
 * alone, asserting nothing.
 *
 * `signalKey` is the read layer's resolution of an `manual.attestations.N.…`
 * citation (`CitedFactEvidence.signalKey`). Passing it is what makes the two
 * legal spellings of one attestation read as one sentence instead of a specific
 * claim beside a vague one (ruled 2026-08-10 on #319). It changes the WORDS
 * only — `data-path` below is still the citation as the judge wrote it.
 */
function humaniseBarePath(path: string, signalKey?: string | null): string {
  const phrase = formatCitedFact(path, { signalKey });
  return phrase === "" ? path : phrase;
}

/**
 * A path that DID resolve, rendered with its value — a stored `null` included.
 * Stringifying the value instead of dropping the `=` is the whole point: it
 * reaches the formatter's "…: not recorded" wording, where the bare path would
 * degrade to a label that reads like a fact with its value lost.
 */
function humaniseReading(
  path: string,
  value: string | null,
  signalKey?: string | null
): string {
  const phrase = formatCitedFact(`${path}=${String(value)}`, { signalKey });
  return phrase === "" ? path : phrase;
}

/**
 * One deterministic reading, as a sentence fragment.
 *
 *   - `present: false` — the path did NOT resolve (this snapshot predates the
 *     field, or the path is not a fact). "core group committed count" on its
 *     own reads as a fact with the number lost, so the row says out loud why it
 *     is empty instead.
 *   - `present: true, value: null` — the path resolved and the plant has
 *     nothing there (every pre-launch plant's `launch.launchDate`). That IS a
 *     reading, and it keeps the ordinary phrasing.
 */
function factPhrase(fact: SnapshotFact): string {
  if (!fact.present) {
    return `${humaniseBarePath(fact.path)} — not in this snapshot yet`;
  }
  return humaniseReading(fact.path, fact.value);
}

// ----------------------------------------------------------------------------
// One criterion.
// ----------------------------------------------------------------------------

const EYEBROW_CLASS =
  "text-muted-foreground text-xs font-medium tracking-wide uppercase";

/**
 * `data-standing`, `data-measurement` and the `data-testid`s are stable hooks in
 * the same spirit as shadcn's `data-slot`s: they name the row's two marks for
 * anything asserting on or styling it from outside, without adding a class the
 * row would then have to keep. None of them changes what this renders.
 */
export function ExitCriterionRow({
  criterion,
}: {
  criterion: ExitCriterionProgress;
}) {
  const measure = MEASURE_STYLES[criterion.measurement];
  const standing = STANDING_STYLES[criterion.standing];

  return (
    <li
      data-testid="exit-criterion"
      data-criterion={criterion.key}
      data-measurement={criterion.measurement}
      data-standing={criterion.standing}
      className="rounded-lg border"
    >
      <details className="group">
        <summary
          data-testid="exit-criterion-toggle"
          className="focus-visible:ring-ring hover:bg-muted/40 grid cursor-pointer list-none grid-cols-[auto_1fr] items-start gap-3 rounded-lg p-3.5 transition-colors focus-visible:ring-2 focus-visible:outline-none [&::-webkit-details-marker]:hidden"
        >
          <ChevronRight
            className="text-muted-foreground mt-0.5 size-4 shrink-0 transition-transform duration-150 ease-out group-open:rotate-90 motion-reduce:transition-none"
            aria-hidden="true"
          />
          <div className="min-w-0">
            {/* Both marks ride the same wrapping row as the label, so a narrow
                screen stacks them under it instead of crushing the name into a
                column. `ml-auto` only kicks in once there is room to separate
                the judge's mark from the measured one. */}
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
              <h3 className="text-sm leading-snug font-semibold text-pretty">
                {criterion.label}
              </h3>
              <Mark data-slot="exit-criterion-measure" style={measure} />
              <Mark
                data-slot="exit-criterion-standing"
                style={standing}
                className="sm:ml-auto"
              />
            </div>
            {/* The deterministic reading is the row's content — the rubric's
                own description of the gate only stands in when there is no
                reading to show. */}
            <p className="text-muted-foreground mt-1 max-w-[60ch] text-sm leading-relaxed text-pretty">
              {criterion.reading ?? criterion.detail}
            </p>
          </div>
        </summary>

        <div className="space-y-4 border-t px-3.5 py-3.5">
          <section>
            <h4 className={EYEBROW_CLASS}>From your data</h4>
            {criterion.facts.length > 0 ? (
              <ul className="mt-1.5 space-y-1">
                {criterion.facts.map((fact) => (
                  <li
                    key={fact.path}
                    data-testid="exit-criterion-fact"
                    data-path={fact.path}
                    data-present={String(fact.present)}
                    className="text-sm leading-relaxed text-pretty"
                  >
                    {factPhrase(fact)}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-muted-foreground mt-1.5 max-w-[60ch] text-sm leading-relaxed text-pretty">
                EveryField holds no measurement for this one yet, so nothing
                here is derived from your records. Track it with your coach.
              </p>
            )}
          </section>

          <section>
            <h4 className={EYEBROW_CLASS}>The engine&apos;s read</h4>
            {criterion.insights.length > 0 ? (
              <ul className="mt-1.5 space-y-2.5">
                {criterion.insights.map((insight) => (
                  <li key={insight.id}>
                    <p className="text-sm leading-snug font-medium text-pretty">
                      {insight.title}
                    </p>
                    <p className="text-muted-foreground mt-0.5 max-w-[65ch] text-sm leading-relaxed text-pretty">
                      {insight.body}
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              <p
                data-testid="exit-criterion-not-addressed"
                className="text-muted-foreground mt-1.5 max-w-[65ch] text-sm leading-relaxed text-pretty"
              >
                The latest assessment did not speak to this criterion. That is
                not the same as failing it — it means the engine had nothing to
                add here this cycle.
              </p>
            )}
          </section>

          {criterion.evidence.length > 0 && (
            <section>
              <h4 className={EYEBROW_CLASS}>Facts the assessment cited</h4>
              <ul className="mt-1.5 space-y-1">
                {criterion.evidence.map((item) => (
                  <li
                    key={`${item.path}=${item.citedValue ?? ""}`}
                    data-testid="exit-criterion-cited-fact"
                    data-path={item.path}
                    data-in-snapshot={String(item.inSnapshot)}
                    className="text-sm leading-relaxed text-pretty"
                  >
                    <CitedFact item={item} />
                  </li>
                ))}
              </ul>
              <p className="text-muted-foreground mt-2 max-w-[70ch] text-xs text-pretty">
                Each value above is read back out of your fact snapshot, not
                from the assessment&apos;s own words.
              </p>
            </section>
          )}
        </div>
      </details>
    </li>
  );
}

/**
 * One citation. The snapshot's value is what is shown; the quoted value only
 * ever appears as a correction beside it, never on its own.
 */
function CitedFact({ item }: { item: CitedFactEvidence }) {
  if (!item.inSnapshot) {
    return (
      <>
        {humaniseBarePath(item.path, item.signalKey)}{" "}
        <span className="text-muted-foreground">
          — cited, but not in this snapshot, so it is not shown as a fact.
        </span>
      </>
    );
  }

  return (
    <>
      {humaniseReading(item.path, item.snapshotValue, item.signalKey)}
      {!item.agrees && item.citedValue !== null && (
        <span className="text-muted-foreground">
          {" "}
          — the assessment quoted {item.citedValue}; your snapshot is what is
          shown.
        </span>
      )}
    </>
  );
}

// ----------------------------------------------------------------------------
// The card.
// ----------------------------------------------------------------------------

/** The methodology's own name for a phase, or a plain fallback. */
function phaseName(phase: number): string {
  return PHASES[phase as PhaseNumber] ?? `Phase ${phase}`;
}

/**
 * One line of progress across the gates. Counts only what is MEASURED — a
 * headline that folded in the untracked and unaddressed ones would be a number
 * with two different warrants behind it.
 */
function summaryLine(progress: ExitCriteriaProgress): string {
  if (progress.criteria.length === 0) return "";
  if (progress.measuredCount === 0) {
    return "None of these are measured from your records yet.";
  }
  return progress.measuredCount === 1
    ? `${progress.metCount} of 1 measured criterion is met.`
    : `${progress.metCount} of ${progress.measuredCount} measured criteria are met.`;
}

/**
 * THE CLUSTER READOUT (#477, C08/C23) — the gates read TOGETHER.
 *
 * The rows above it are each a single indicator, and a planter at 38 committed
 * adults with no worship leader could read the green one and stop. This line
 * says the combination out loud, and it only says "ready" at 5 of 5, because
 * the gate is a conjunction with no weights: a big number in one column may not
 * buy off an empty one.
 *
 * Unknowns are named separately rather than folded into either column — an
 * unanswered attestation is not a failed one.
 */
function clusterLine(
  progress: ExitCriteriaProgress,
  nextPhaseName: string
): string {
  const { holding, total, unknown, ready } = progress.cluster;

  if (ready) return `All ${total} hold — ready to begin ${nextPhaseName}.`;

  const held = `${holding} of ${total} indicators hold`;
  if (unknown > 0) {
    return `${held}; ${unknown} ${unknown === 1 ? "is" : "are"} unanswered. No single mark clears the gate — the combination does.`;
  }
  return `${held}. No single mark clears the gate — the combination does.`;
}

interface ExitCriteriaProps {
  /**
   * The gates projected from the latest persisted assessment, or null when the
   * plant has never completed one (cold start).
   */
  progress: ExitCriteriaProgress | null;
}

export function ExitCriteria({ progress }: ExitCriteriaProps) {
  // Cold start. A list of unmet gates would say the engine looked at each one —
  // it has not looked at all. A materially different claim, so no rows render.
  if (!progress) {
    return (
      <Card data-testid="exit-criteria">
        <CardHeader>
          <CardTitle>
            <h2>Exit criteria</h2>
          </CardTitle>
          <CardDescription className="max-w-[65ch] text-pretty">
            Your plant hasn&apos;t been assessed yet. Once the first assessment
            runs, the gates for leaving your current phase appear here one at a
            time — each with what your own records say, and what the engine made
            of it.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const asOf = formatDate(progress.generatedAt, "long");

  return (
    <Card data-testid="exit-criteria" data-phase={progress.phase}>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            {/* An h2, so the page reads h1 → h2 → h3 (the rows) → h4 (the
                drill-down sections). CardTitle is a plain div; Tailwind's
                preflight resets heading size, weight and margin, so nesting the
                real heading inside it changes the outline, not a pixel. */}
            <CardTitle>
              <h2>Exit criteria</h2>
            </CardTitle>
            <CardDescription className="max-w-[70ch] text-pretty">
              {progress.isTerminalPhase
                ? `${phaseName(progress.phase)} is the last phase — there is no gate past it.`
                : `What it takes to leave ${phaseName(progress.phase)}. ${summaryLine(progress)}`}
            </CardDescription>
            {!progress.isTerminalPhase && progress.criteria.length > 0 && (
              <p
                data-testid="cluster-verdict"
                className={`mt-1.5 max-w-[70ch] text-sm text-pretty ${
                  progress.cluster.ready
                    ? "font-medium text-green-700 dark:text-green-500"
                    : "text-muted-foreground"
                }`}
              >
                {clusterLine(
                  progress,
                  progress.nextPhase === null
                    ? "the next phase"
                    : phaseName(progress.nextPhase)
                )}
              </p>
            )}
          </div>
          {/* Freshness and provenance sit next to the claim they qualify. */}
          <p className="text-muted-foreground text-xs whitespace-nowrap tabular-nums">
            As of {asOf} &middot; rubric {progress.rubricVersion}
          </p>
        </div>
      </CardHeader>

      <CardContent>
        {progress.criteria.length > 0 ? (
          <>
            <ul aria-label="Exit criteria" className="space-y-2.5">
              {progress.criteria.map((criterion) => (
                <ExitCriterionRow key={criterion.key} criterion={criterion} />
              ))}
            </ul>

            {/* Says the quiet part out loud. Two marks with two different
                warrants sit on every row, and a reader who reads them as one
                verdict will over-trust the softer half. */}
            <p className="text-muted-foreground mt-4 max-w-[75ch] text-xs text-pretty">
              The mark beside each criterion is measured from your own records.
              The mark on the right is the latest assessment&apos;s reading — a
              judgement, not a measurement. &ldquo;Not addressed&rdquo; means
              the assessment had nothing to say about that criterion this time,
              not that it is failing. Open a criterion to see the facts behind
              both.
            </p>
          </>
        ) : (
          <p className="text-muted-foreground max-w-[65ch] text-sm text-pretty">
            The work here is sustaining what you launched, not reaching the next
            gate, so the engine watches health instead. Your focus list and the
            critical success factors above carry on.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
