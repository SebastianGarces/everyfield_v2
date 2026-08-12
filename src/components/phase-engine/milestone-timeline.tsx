// ============================================================================
// MilestoneTimeline — the plant's key dates in order, Launch Sunday included
// (PE-027).
//
// Presentational server component. It performs NO data access and NO judgement:
// it is handed a `MilestoneTimeline` that the signal read layer assembled from
// dated rows — phase history, the first vision meeting, completed launch
// readiness milestones, and the launch entity itself
// (lib/phase-engine/signals/queries.ts, `buildMilestoneTimeline`).
//
// ---------------------------------------------------------------------------
// The design constraints this file is written against
// ---------------------------------------------------------------------------
//
// 1. EVERY ROW IS A DATE SOMETHING HAPPENED ON. No estimates, no projections,
//    no "you should be here by now" markers. The only row that is not in the
//    past is Launch Sunday, which is labelled as planned and separated from the
//    rest by that label, not merely by its position.
//
// 2. THE BADGES ARE THE ENGINE'S. A row's mark is `event.alert` — the severity
//    the judge assigned to an insight in that row's area, relabelled once by
//    the read layer. This file compares no date against any threshold and has
//    no notion of a milestone being "late". A component that decided lateness
//    for itself would be the second urgency system PE-027 forbids.
//
// 3. NO LAUNCH DATE IS A STATE, NOT A BLANK. A plant that has not named a day
//    is told so, and pointed at the one place the date is set. The date lives on
//    the launch entity (`launches.target_date`), never on the church row —
//    `churches.launch_date` was dropped by migration 0032 (invariants.md →
//    Phase History), and `/launch` is the single write path.
//
// 4. THE RAIL IS DECORATION. The vertical line and the markers are
//    `aria-hidden`; the list is an ordered list of dated rows, and every fact
//    the rail encodes (order, past vs planned) is also in the text.
//
// Server-safe on purpose: no "use client", no event handlers, no value-level
// import of anything server-only.
// ============================================================================

import { CircleCheck, Eye, Info, Minus, TriangleAlert } from "lucide-react";
import Link from "next/link";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { formatDate } from "@/lib/datetime";
import { parseTargetDate } from "@/lib/launch/countdown";
import type { CsfStanding } from "@/lib/phase-engine/assessment";
import type {
  MilestoneEvent,
  MilestoneTimeline as MilestoneTimelineData,
} from "@/lib/phase-engine/signals/milestones";
import type { EngineAlert } from "@/lib/phase-engine/signals/trends";
import { cn } from "@/lib/utils";

// ----------------------------------------------------------------------------
// The alert badge — the same scale, words and inks as the CSF scorecard and the
// exit criteria. One attention vocabulary for the whole page.
// ----------------------------------------------------------------------------

interface StandingStyle {
  label: string;
  Icon: typeof TriangleAlert;
  ink: string;
}

const STANDING_STYLES: Record<CsfStanding, StandingStyle> = {
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
  not_raised: {
    label: "Not raised",
    Icon: Minus,
    ink: "text-muted-foreground",
  },
};

/**
 * A row only wears a badge when the assessment actually spoke to its area.
 * `not_raised` renders nothing at all: a "not raised" mark on every one of a
 * dozen dated rows is noise, and silence about a milestone is not a finding
 * about it.
 */
function AlertBadge({ alert }: { alert: EngineAlert }) {
  if (alert.standing === "not_raised") return null;
  const style = STANDING_STYLES[alert.standing];

  return (
    <span
      data-slot="milestone-alert"
      data-standing={alert.standing}
      data-severity={alert.severity ?? ""}
      data-insight-id={alert.insightId ?? ""}
      className={cn(
        "inline-flex shrink-0 items-center gap-1 text-[0.6875rem] font-semibold tracking-wide uppercase",
        style.ink
      )}
    >
      <style.Icon className="size-3.5" aria-hidden="true" />
      {style.label}
    </span>
  );
}

// ----------------------------------------------------------------------------
// One event.
// ----------------------------------------------------------------------------

/**
 * The UTC day the event sits on, as `yyyy-mm-dd`.
 *
 * A machine hook, not display text — `toISOString` is explicitly UTC, which IS
 * `APP_TIME_ZONE`, so it names the same day the rendered date does (invariants.md
 * → Date & Time Rendering). Everything a reader sees goes through `formatDate`.
 */
function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function MilestoneRow({ event }: { event: MilestoneEvent }) {
  const planned = event.state === "upcoming";
  const isLaunch = event.kind === "launch_day";

  return (
    <li
      data-testid="milestone-event"
      data-kind={event.kind}
      data-state={event.state}
      data-date={isoDay(event.at)}
      data-standing={event.alert.standing}
      className="group grid grid-cols-[1.25rem_1fr] gap-3"
    >
      {/* The rail. Two segments rather than one so the line starts and stops at
          the first and last markers instead of running past them. */}
      <div className="relative flex justify-center" aria-hidden="true">
        <span className="bg-border absolute top-0 h-1.5 w-px group-first:hidden" />
        <span className="bg-border absolute top-3.5 bottom-0 w-px group-last:hidden" />
        <span
          className={cn(
            "absolute top-1.5 size-2",
            planned
              ? "border-foreground/60 bg-card border"
              : isLaunch
                ? "bg-foreground"
                : "bg-foreground/60"
          )}
        />
      </div>

      <div className="min-w-0 pb-5 group-last:pb-0">
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
          <h3
            className={cn(
              "text-sm leading-snug text-pretty",
              isLaunch ? "font-semibold" : "font-medium"
            )}
          >
            {event.label}
          </h3>
          {planned && (
            <span className="text-muted-foreground text-[0.6875rem] font-semibold tracking-wide uppercase">
              Planned
            </span>
          )}
          <AlertBadge alert={event.alert} />
        </div>
        <p className="text-muted-foreground mt-0.5 text-xs">
          {formatDate(event.at, "short")}
        </p>
        {event.detail && (
          <p className="text-muted-foreground mt-1 max-w-[60ch] text-sm leading-relaxed text-pretty">
            {event.detail}
          </p>
        )}
      </div>
    </li>
  );
}

// ----------------------------------------------------------------------------
// The launch line.
// ----------------------------------------------------------------------------

/** "in 42 days" / "today" / "42 days ago". Never a second countdown sum — the
 *  number was computed once, by `daysUntilTarget`, in the read layer. */
function countdownPhrase(days: number): string {
  if (days === 0) return "today";
  const magnitude = Math.abs(days);
  const unit = magnitude === 1 ? "day" : "days";
  return days > 0 ? `in ${magnitude} ${unit}` : `${magnitude} ${unit} ago`;
}

function LaunchLine({ timeline }: { timeline: MilestoneTimelineData }) {
  if (!timeline.launchDate) {
    return (
      <p
        data-testid="milestone-no-launch-date"
        className="text-muted-foreground max-w-[65ch] text-sm text-pretty"
      >
        No launch date yet.{" "}
        <Link
          href="/launch"
          className="text-foreground underline underline-offset-4"
        >
          Set your launch date
        </Link>{" "}
        and it appears here with the readiness milestones behind it.
      </p>
    );
  }

  const day = formatDate(parseTargetDate(timeline.launchDate), "long");
  const countdown =
    timeline.daysUntilLaunch === null
      ? null
      : countdownPhrase(timeline.daysUntilLaunch);

  return (
    <p
      data-testid="milestone-launch-date"
      data-launch-date={timeline.launchDate}
      data-launch-status={timeline.launchStatus ?? ""}
      className="text-sm text-pretty"
    >
      <span className="font-semibold">Launch Sunday</span>{" "}
      <span className="text-muted-foreground">
        {day}
        {countdown && ` · ${countdown}`}
        {timeline.launchStatus === "postponed" && " · postponed once"}
      </span>
    </p>
  );
}

// ----------------------------------------------------------------------------
// The card.
// ----------------------------------------------------------------------------

interface MilestoneTimelineProps {
  /**
   * The dated events assembled by the read layer. Never null in practice — a
   * timeline needs no assessment — but a caller that has not loaded one yet may
   * pass null rather than fabricating an empty one.
   */
  timeline: MilestoneTimelineData | null;
}

export function MilestoneTimeline({ timeline }: MilestoneTimelineProps) {
  if (!timeline) return null;

  return (
    <Card data-testid="milestone-timeline">
      <CardHeader>
        {/* An h2, so the page reads h1 → h2 → h3 (the rows), matching the
            scorecard, the exit criteria and the trends. */}
        <CardTitle>
          <h2>Milestones</h2>
        </CardTitle>
        <CardDescription className="max-w-[70ch] text-pretty">
          The dates behind your plant, in order — where it started, what it has
          cleared, and the day it is heading for.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        <LaunchLine timeline={timeline} />

        {timeline.events.length > 0 ? (
          <ol aria-label="Milestones">
            {timeline.events.map((event) => (
              <MilestoneRow key={`${event.kind}:${event.id}`} event={event} />
            ))}
          </ol>
        ) : (
          <p
            data-testid="milestone-timeline-empty"
            className="text-muted-foreground max-w-[65ch] text-sm text-pretty"
          >
            Nothing is dated yet. Declaring your stage, holding your first
            vision meeting and scheduling launch all put a date on this list.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
