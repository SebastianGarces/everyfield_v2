"use client";

import {
  useEffect,
  useOptimistic,
  useRef,
  useState,
  useTransition,
} from "react";
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
  CHECKIN_NOTE_MAX,
  checkinDraftFrom,
  completeAnswer,
  type CheckinAnswer,
  type CheckinDimension,
  type CheckinDraft,
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

export function PlanterCheckinCard({
  thisWeek,
  weeks,
  nudges,
}: PlanterCheckinCardProps) {
  const [isPending, startTransition] = useTransition();

  // `useOptimistic` OVER THE SERVER PROP, never `useState` seeded from it
  // (invariants → Client/Server Data Synchronization; the reference shape is
  // `SignalToggle` on this same page). Answering flips the card to its answered
  // state on the tap, and `refresh()` inside the action reconciles it with the
  // row that was actually written.
  const [answeredWeek, setAnsweredWeek] = useOptimistic(thisWeek);

  // The ONLY local state is "the planter asked to edit". Whether the week is
  // answered is `answeredWeek`, derived on every render — a latched flag would
  // go stale the way the `answered` flag this replaces did, and on a page left
  // open across a Monday it would claim a new week was already answered.
  const [editing, setEditing] = useState<CheckinDraft | null>(null);
  const draft = editing ?? (answeredWeek ? null : checkinDraftFrom(null));

  const answer = draft && completeAnswer(draft);

  // Focus is a DOM command, which is the one thing an effect is for — the
  // repo's `useEffect` rule is about server data, and neither of these reads
  // any. Both controls UNMOUNT THEMSELVES on click, and an unmounted element
  // drops focus to `<body>`: a keyboard user who pressed Enter on "Change my
  // answer" would be thrown to the top of the page, dozens of Tabs from the
  // form they just opened. Same defect and same remedy as `ResendEmailButton`
  // (invitations-list.tsx, PR #392 warning (b)); axe cannot see it, because
  // losing focus is not itself a WCAG failure.
  const formPanel = useRef<HTMLDivElement>(null);
  const changeButton = useRef<HTMLButtonElement>(null);
  const open = draft !== null;
  const settled = useRef(false);

  useEffect(() => {
    // NOT ON MOUNT. An unanswered week opens into the form on its own, and a
    // card that grabs focus from the top of a page nobody asked it to is worse
    // than the defect. Only the SWITCH between the two panels moves focus.
    if (!settled.current) {
      settled.current = true;
      return;
    }
    (open ? formPanel : changeButton).current?.focus();
  }, [open]);

  function submit(complete: CheckinAnswer) {
    startTransition(async () => {
      const changing = answeredWeek !== null;
      setAnsweredWeek(complete);
      setEditing(null);

      const result = await saveCheckinAction(complete);

      if (!result.success) {
        toast.error(result.error);
        // Hand the form back with their answers in it. The optimistic week
        // reverts to server truth when this transition settles.
        setEditing(checkinDraftFrom(complete));
        return;
      }

      toast.success(
        changing
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
              ref={changeButton}
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setEditing(checkinDraftFrom(answeredWeek))}
              className="cursor-pointer"
            >
              Change my answer
            </Button>
          </div>
        ) : (
          <div
            ref={formPanel}
            // Programmatically focusable, never in the tab order: a pointer
            // user must not collect an extra Tab stop for a panel they can see.
            // The focus ring is NOT suppressed — a keyboard user who just
            // pressed Enter needs to see where focus went, and Tab can never
            // land here, so the ring only ever appears right after that press.
            tabIndex={-1}
            role="group"
            aria-label="This week's check-in"
            className="space-y-4"
          >
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
                        setEditing({
                          ...draft,
                          answers: {
                            ...draft.answers,
                            [dimension.key]: level.value,
                          },
                        })
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
                  setEditing({ ...draft, note: event.target.value })
                }
                disabled={isPending}
                rows={2}
                // The server refuses a longer note, and its one refusal message
                // is about the three levels. Stop it at the keyboard instead.
                maxLength={CHECKIN_NOTE_MAX}
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
                  : answeredWeek
                    ? "Save changes"
                    : "Save this week"}
              </Button>
              {/* Cancel only exists once there is something to cancel BACK to.
                  On an unanswered week the form is the card. */}
              {answeredWeek && (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setEditing(null)}
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
