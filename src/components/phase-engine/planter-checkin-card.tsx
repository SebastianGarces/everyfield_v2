"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { saveCheckinAction } from "@/app/(dashboard)/phase/checkin-actions";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { PlanterCheckinLevel } from "@/db/schema";
import {
  CHECKIN_DIMENSIONS,
  CHECKIN_LEVELS,
  type CheckinAnswer,
  type CheckinDimension,
  type CheckinNudge,
} from "@/lib/phase-engine/planter-checkin";
import { cn } from "@/lib/utils";

// ============================================================================
// THE WEEKLY CHECK-IN, AND THE STRIP BESIDE IT (#484, C19).
//
// Bryan: "a plant can hit every launch metric while the planter himself is
// falling apart." So this card sits on the same page as the assessment,
// deliberately: a green scorecard is never shown without the care state next to
// it. Launch-green may not wash planter-red.
//
// PRIVATE, AND THE CARD SAYS SO. The one thing a planter needs to believe
// before answering "is your marriage surviving this?" is that nobody else will
// read it. The line is not a footnote.
//
// THREE LEVELS, ONE TAP (#484 D1). A five-point scale invites deliberation, and
// this is a question somebody answers honestly in four seconds or not at all.
// The note is optional and stays optional.
//
// AND THE ANSWER CAN BE CHANGED (#634). "Spiritually: steady" typed on Monday
// morning is a different sentence by Thursday, and a card that takes one
// answer per week and then locks teaches a planter to answer carefully rather
// than honestly — which is the one thing this card cannot afford. The write
// was an upsert on `(church_id, week_start)` from the first commit, so the
// capability was never missing; the card promised the change in prose and then
// rendered no control that could make it.
//
// EVERY READING HERE IS DETERMINISTIC. The nudge is computed in TypeScript from
// the planter's own answers (`checkinNudges`). No model reads these answers,
// writes about them, or paraphrases them back to anybody.
// ============================================================================

/** How the strip draws one week's dot per dimension. */
const LEVEL_DOT: Record<PlanterCheckinLevel, string> = {
  steady: "bg-emerald-500/70",
  strained: "bg-amber-500/80",
  struggling: "bg-red-500/80",
};

const LEVEL_BUTTON: Record<PlanterCheckinLevel, string> = {
  steady:
    "data-[selected=true]:border-emerald-600/50 data-[selected=true]:bg-emerald-500/10 data-[selected=true]:text-emerald-700 dark:data-[selected=true]:text-emerald-400",
  strained:
    "data-[selected=true]:border-amber-600/50 data-[selected=true]:bg-amber-500/10 data-[selected=true]:text-amber-700 dark:data-[selected=true]:text-amber-400",
  struggling:
    "data-[selected=true]:border-red-600/50 data-[selected=true]:bg-red-500/10 data-[selected=true]:text-red-700 dark:data-[selected=true]:text-red-400",
};

/** One week of the strip: four dots, or an empty slot for a week never answered. */
export interface CheckinWeek {
  weekStart: string;
  levels: Record<CheckinDimension, PlanterCheckinLevel> | null;
}

interface PlanterCheckinCardProps {
  /** This week's answer, or `null` when the week is unanswered — the card asks. */
  thisWeek: CheckinAnswer | null;
  /** Oldest first. Weeks with no answer carry `levels: null`. */
  weeks: CheckinWeek[];
  /** Deterministic runs of three or more strained weeks. */
  nudges: CheckinNudge[];
}

/** What the form holds while it is open: four taps in progress, and the note. */
export interface CheckinDraft {
  answers: Partial<Record<CheckinDimension, PlanterCheckinLevel>>;
  note: string;
}

/**
 * The draft a form opens on: empty for a new week, this week's answer for a
 * change.
 *
 * SEEDED WITH THE NOTE, not just the four taps. The write is a whole-row
 * upsert, so a change saved from a form that dropped the note would silently
 * erase it. `checkinDraftFrom` and {@link completeAnswer} are each other's
 * inverse, and `planter-checkin-card.test.ts` holds them to it.
 */
export function checkinDraftFrom(answer: CheckinAnswer | null): CheckinDraft {
  if (!answer) return { answers: {}, note: "" };

  return {
    answers: {
      spiritually: answer.spiritually,
      marriageFamily: answer.marriageFamily,
      financially: answer.financially,
      pace: answer.pace,
    },
    note: answer.note ?? "",
  };
}

/** The draft as a saveable answer, or `null` while a dimension is untapped. */
export function completeAnswer(draft: CheckinDraft): CheckinAnswer | null {
  const { spiritually, marriageFamily, financially, pace } = draft.answers;
  if (!spiritually || !marriageFamily || !financially || !pace) return null;

  return {
    spiritually,
    marriageFamily,
    financially,
    pace,
    note: draft.note.trim() || null,
  };
}

export function PlanterCheckinCard({
  thisWeek,
  weeks,
  nudges,
}: PlanterCheckinCardProps) {
  // ONE PIECE OF STATE, AND IT IS THE FORM. `null` is the closed card; anything
  // else is the form open on a draft. The shape before #634 kept an `answered`
  // flag beside the draft — server data in `useState` (invariants →
  // Client/Server Data Synchronization), and no state at all for "answered, and
  // changing it". Whether the week is answered is `thisWeek`, always.
  const [draft, setDraft] = useState<CheckinDraft | null>(() =>
    thisWeek ? null : checkinDraftFrom(null)
  );
  const [isPending, startTransition] = useTransition();

  const answer = draft && completeAnswer(draft);

  function submit(complete: CheckinAnswer) {
    startTransition(async () => {
      const result = await saveCheckinAction(complete);

      if (!result.success) {
        toast.error(result.error);
        return;
      }

      // Closing on the reconciled props: the action revalidates `/phase` inside
      // this transition, so `thisWeek` is the row just written by the time the
      // planter can reopen it.
      setDraft(null);
      toast.success(
        thisWeek
          ? "Changed — that stays with you."
          : "Thanks — that stays with you."
      );
    });
  }

  return (
    <Card data-testid="planter-checkin">
      <CardHeader>
        <CardTitle>How are you doing?</CardTitle>
        <CardDescription className="max-w-[60ch] text-pretty">
          A plant can hit every number while the planter is running on empty.
          This is a weekly note to yourself.{" "}
          <strong className="font-medium">
            Only you can see it — it is never shared with your coach or your
            sending organisation, and it never reaches the assessment.
          </strong>
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-5">
        {draft === null ? (
          <div className="space-y-3">
            <p className="text-muted-foreground text-sm">
              You have answered this week. Come back next week — or change your
              answer any time before then.
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setDraft(checkinDraftFrom(thisWeek))}
              className="cursor-pointer"
            >
              Change my answer
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            {CHECKIN_DIMENSIONS.map((dimension) => (
              <div key={dimension.key} className="space-y-1.5">
                <Label className="text-sm font-medium">
                  {dimension.label}
                  <span className="text-muted-foreground ml-2 font-normal">
                    {dimension.prompt}
                  </span>
                </Label>
                <div className="flex flex-wrap gap-2">
                  {CHECKIN_LEVELS.map((level) => (
                    <button
                      key={level.value}
                      type="button"
                      data-selected={
                        draft.answers[dimension.key] === level.value
                      }
                      aria-pressed={
                        draft.answers[dimension.key] === level.value
                      }
                      disabled={isPending}
                      onClick={() =>
                        setDraft(
                          (current) =>
                            current && {
                              ...current,
                              answers: {
                                ...current.answers,
                                [dimension.key]: level.value,
                              },
                            }
                        )
                      }
                      className={cn(
                        "cursor-pointer rounded-md border px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50",
                        "hover:bg-muted",
                        LEVEL_BUTTON[level.value]
                      )}
                    >
                      {level.label}
                    </button>
                  ))}
                </div>
              </div>
            ))}

            <div className="space-y-1.5">
              <Label htmlFor="checkin-note" className="text-sm font-medium">
                Anything you want to say to yourself?
                <span className="text-muted-foreground ml-2 font-normal">
                  Optional
                </span>
              </Label>
              <Textarea
                id="checkin-note"
                value={draft.note}
                onChange={(event) =>
                  setDraft(
                    (current) =>
                      current && { ...current, note: event.target.value }
                  )
                }
                disabled={isPending}
                rows={2}
                placeholder="Nobody else reads this."
              />
            </div>

            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                onClick={() => answer && submit(answer)}
                disabled={!answer || isPending}
                className="cursor-pointer"
              >
                {isPending
                  ? "Saving..."
                  : thisWeek
                    ? "Save changes"
                    : "Save this week"}
              </Button>
              {/* Cancel only exists once there is something to cancel BACK to.
                  On an unanswered week the form is the card. */}
              {thisWeek && (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setDraft(null)}
                  disabled={isPending}
                  className="cursor-pointer"
                >
                  Cancel
                </Button>
              )}
            </div>
          </div>
        )}

        <CheckinStrip weeks={weeks} nudges={nudges} />
      </CardContent>
    </Card>
  );
}

/**
 * The last twelve weeks, as four rows of dots.
 *
 * A GAP IS DRAWN, NOT SKIPPED. A week nobody answered is a hollow slot rather
 * than a missing column, because "I did not answer" is part of the picture —
 * three unanswered weeks in a row is itself worth seeing.
 */
export function CheckinStrip({
  weeks,
  nudges,
}: {
  weeks: CheckinWeek[];
  nudges: CheckinNudge[];
}) {
  if (weeks.every((week) => week.levels === null)) {
    return (
      <p className="text-muted-foreground border-t pt-4 text-xs">
        Your last twelve weeks will appear here once you have answered a few.
      </p>
    );
  }

  return (
    <div className="space-y-2 border-t pt-4" data-testid="checkin-strip">
      <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
        Your last {weeks.length} weeks
      </p>

      <ul className="space-y-1.5">
        {CHECKIN_DIMENSIONS.map((dimension) => (
          <li key={dimension.key} className="flex items-center gap-3">
            <span className="text-muted-foreground w-32 shrink-0 text-xs">
              {dimension.label}
            </span>
            <span className="flex gap-1">
              {weeks.map((week) => (
                <span
                  key={week.weekStart}
                  title={`Week of ${week.weekStart}: ${
                    week.levels ? week.levels[dimension.key] : "not answered"
                  }`}
                  data-level={week.levels?.[dimension.key] ?? "none"}
                  className={cn(
                    "size-2.5 rounded-full",
                    week.levels
                      ? LEVEL_DOT[week.levels[dimension.key]]
                      : "border-border border border-dashed"
                  )}
                />
              ))}
            </span>
          </li>
        ))}
      </ul>

      {nudges.length > 0 && (
        <ul className="space-y-1 pt-1" data-testid="checkin-nudges">
          {nudges.map((nudge) => (
            <li
              key={nudge.dimension}
              className="text-amber-700 dark:text-amber-400"
            >
              <p className="text-xs text-pretty">Your {nudge.message}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
