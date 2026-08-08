"use client";

// ============================================================================
// The launch date, and the controls that change it (LS-001/002/004/009).
//
// WHY THE DATE CONTROL IS BEHIND A DISCLOSURE. A launch date is named once and
// moved almost never. Standing the change-date form permanently open under the
// countdown gave a rare administrative act the same standing as the plant's
// actual work — a full-width card with a date input, two buttons and an
// always-open "why is it changing?" textarea, sitting between the countdown and
// the readiness list every single visit. It now opens from the card it belongs
// to, and the date journal opens with it: "who moved this day, and from what"
// is the question you are already asking when you open the date control, and it
// is the only question that journal answers.
//
// The ONE exception is the empty state. With no date yet, naming the day is the
// entire job of the page, so the form starts open rather than hidden behind a
// button (`defaultOpen`).
//
// THIS COMPONENT READS NO CLOCK AND SUBTRACTS NO DATES. `daysUntil` arrives
// already computed by `daysUntilTarget` — the same helper the phase-engine
// snapshot and the oversight listing use — and every word here is derived from
// that one number by `countdownHeadline`. A second day-diff in a client
// component would be bug #338 again, and would also render one string on the
// server and another after hydration (React #418).
//
// The forms it discloses are the page's, passed down as slots: the server owns
// what a viewer is offered, and a team member is passed no form at all
// (LS-007). The server refuses the write regardless of what was rendered.
// ============================================================================

import { CalendarPlus, ChevronDown, History, Pencil } from "lucide-react";
import type { ReactNode } from "react";

import {
  countdownHeadline,
  formatLaunchDay,
  launchStatusMeta,
} from "@/components/launch/presentation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import type { LaunchStatus } from "@/db/schema/launch";

export interface LaunchDateCardProps {
  targetDate: string | null;
  status: LaunchStatus;
  /** `daysUntilTarget`'s answer. `null` when there is no date. */
  daysUntil: number | null;
  /** Whether this viewer may change the date — planter, launch not yet recorded. */
  canChangeDate: boolean;
  /**
   * Whether the date journal has anything in it. A separate boolean rather than
   * a check on the slot: `LaunchJournal` renders `null` when it is empty, and a
   * non-null ReactNode that renders nothing would still open an empty panel.
   */
  hasDateHistory: boolean;
  /** The schedule/move/postpone form. Absent for anyone who may not write. */
  scheduleForm?: ReactNode;
  /** The date journal, read-only for everyone. */
  dateHistory?: ReactNode;
}

export function LaunchDateCard({
  targetDate,
  status,
  daysUntil,
  canChangeDate,
  hasDateHistory,
  scheduleForm,
  dateHistory,
}: LaunchDateCardProps) {
  const meta = launchStatusMeta(status);
  const headline = countdownHeadline(daysUntil);
  const isUnscheduled = !targetDate;

  // Nothing to disclose: a team member on a launch whose date has never moved
  // gets no control at all, rather than a button onto an empty panel.
  const hasDisclosure = canChangeDate || hasDateHistory;

  return (
    <Collapsible
      defaultOpen={canChangeDate && isUnscheduled}
      className="bg-card rounded-xl border shadow-sm"
    >
      <div className="p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Launch Sunday</h1>
            <p className="text-muted-foreground mt-1">{meta.description}</p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={meta.badgeVariant}>{meta.label}</Badge>
            {hasDisclosure && (
              <CollapsibleTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="group cursor-pointer"
                >
                  {isUnscheduled ? (
                    <CalendarPlus className="mr-1.5 h-3.5 w-3.5" />
                  ) : canChangeDate ? (
                    <Pencil className="mr-1.5 h-3.5 w-3.5" />
                  ) : (
                    <History className="mr-1.5 h-3.5 w-3.5" />
                  )}
                  {isUnscheduled
                    ? "Name the day"
                    : canChangeDate
                      ? "Change the date"
                      : "Date history"}
                  <ChevronDown
                    className="ml-1.5 h-3.5 w-3.5 transition-transform group-data-[state=open]:rotate-180"
                    aria-hidden="true"
                  />
                </Button>
              </CollapsibleTrigger>
            )}
          </div>
        </div>

        {targetDate ? (
          <div className="mt-6 flex flex-wrap items-baseline gap-x-4 gap-y-1">
            {headline &&
              (headline.kind === "word" ? (
                <p className="text-5xl font-bold tracking-tight">
                  {headline.word}
                </p>
              ) : (
                <p className="text-5xl font-bold tracking-tight tabular-nums">
                  {headline.value}
                  <span className="text-muted-foreground ml-2 text-lg font-normal">
                    {/* ONE string: the space between the unit and its direction
                        is content, and JSX text nodes between expression
                        containers are at the mercy of the compiler's whitespace
                        trimming — which is how "0 of 9milestones" shipped. */}
                    {`${headline.unit} ${headline.direction}`}
                  </span>
                </p>
              ))}
            <p className="text-lg">{formatLaunchDay(targetDate)}</p>
          </div>
        ) : (
          <p className="text-muted-foreground mt-6">
            {canChangeDate
              ? "No date is set yet. Name the day and your readiness list is created from the Launch Playbook."
              : "No date is set yet. Your planter names the day."}
          </p>
        )}
      </div>

      {hasDisclosure && (
        <CollapsibleContent>
          <div className="space-y-6 border-t p-6">
            {scheduleForm}
            {dateHistory}
          </div>
        </CollapsibleContent>
      )}
    </Collapsible>
  );
}
