"use client";

// ============================================================================
// Scheduling, moving and postponing the launch (LS-001/002/009).
//
// PLANTER-ONLY, and this component is only half of that: the page does not
// render it for anyone else, and `scheduleLaunchAction` → `setLaunchDate`
// refuses a forged call from a team member regardless of what the page rendered
// (LS-007). A hidden button is a courtesy; the server check is the rule.
//
// IT IS NOT A CARD. It renders as a plain section because it lives inside the
// date card's disclosure (`launch-date-card.tsx`), which owns the surface, the
// heading and the decision about when it is on screen at all. Standing alone as
// a permanent card is what gave a once-a-launch admin act the same weight as
// the plant's readiness list.
//
// The date is a `YYYY-MM-DD` string end to end — it is never round-tripped
// through a `Date`, because a naive day parsed in the runtime's zone is a
// different day in the browser than on the server (memory/invariants.md → Date
// & Time Rendering).
// ============================================================================

import { CalendarDays, Loader2 } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { scheduleLaunchAction } from "@/app/(dashboard)/launch/actions";
import { formatLaunchDay } from "@/components/launch/presentation";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { LaunchStatus } from "@/db/schema/launch";

export interface ScheduleLaunchFormProps {
  /** The stored day, or `null` when none has been named yet. */
  targetDate: string | null;
  /**
   * The launch's stored status. Load-bearing for ONE case: a `postponed` launch
   * whose planter has decided to go ahead on the very same Sunday after all.
   * The date has not changed, so a form that keys "is there anything to save?"
   * on the date alone leaves them stuck showing `Postponed` — to their sending
   * church too — until they move the day somewhere else and back.
   */
  status: LaunchStatus;
}

export function ScheduleLaunchForm({
  targetDate,
  status,
}: ScheduleLaunchFormProps) {
  // Form state, not server state: the input's working value while the planter
  // types. The page gives this component a `key` of the stored date, so a
  // saved change remounts it rather than leaving a stale draft behind
  // (memory/contracts/data-patterns.md — never sync props into state).
  const [value, setValue] = useState(targetDate ?? "");
  const [note, setNote] = useState("");
  const [confirming, setConfirming] = useState<
    "move" | "postpone" | "reconfirm" | null
  >(null);
  const [isPending, startTransition] = useTransition();

  const hasDate = !!targetDate;
  const isUnchanged = value === (targetDate ?? "");
  /**
   * The postponement is being taken back on the same day it was postponed from.
   * That is a real write — status `postponed` → `scheduled` — and the only case
   * where an unchanged date has something to save.
   */
  const isReconfirm = hasDate && isUnchanged && status === "postponed";

  function submit(postpone: boolean) {
    startTransition(async () => {
      const result = await scheduleLaunchAction({
        targetDate: value,
        postpone,
        note: note.trim() || null,
      });

      if (!result.success) {
        toast.error(result.error);
        return;
      }

      setConfirming(null);
      setNote("");
      toast.success(
        postpone
          ? `Postponed to ${formatLaunchDay(result.data.targetDate)}`
          : result.data.changed
            ? `Launch Sunday is ${formatLaunchDay(result.data.targetDate)}`
            : "That was already the date."
      );
    });
  }

  /**
   * A FIRST commitment writes straight through — there is nothing to confirm,
   * nothing is being undone. Changing a date that already exists always
   * confirms, because the plant has been preparing against it and the change
   * is journalled and announced to oversight (FRD non-functional requirements).
   * Taking a postponement back confirms too, and for the same reason: oversight
   * was told the launch was off, and this is what tells them it is on again.
   */
  function requestSubmit(postpone: boolean) {
    if (!value) {
      toast.error("Pick a date first.");
      return;
    }
    if (!hasDate) {
      submit(false);
      return;
    }
    setConfirming(postpone ? "postpone" : isUnchanged ? "reconfirm" : "move");
  }

  return (
    <section className="space-y-4" aria-labelledby="launch-schedule-heading">
      <div>
        <h3
          id="launch-schedule-heading"
          className="text-sm font-medium tracking-tight"
        >
          {hasDate ? "Move or postpone the launch" : "Set the date"}
        </h3>
        <p className="text-muted-foreground mt-1 text-sm">
          {hasDate
            ? "The change is recorded below — who changed it, when, and from what — and your sending church is notified."
            : "Set Launch Sunday and we'll seed your readiness milestones from the Launch Playbook."}
        </p>
      </div>

      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="launch-target-date">Launch Sunday</Label>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              id="launch-target-date"
              type="date"
              value={value}
              onChange={(event) => setValue(event.target.value)}
              disabled={isPending}
              className="w-full cursor-pointer sm:w-56"
            />
            <Button
              type="button"
              className="cursor-pointer"
              disabled={
                isPending || !value || (hasDate && isUnchanged && !isReconfirm)
              }
              onClick={() => requestSubmit(false)}
            >
              {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {isReconfirm
                ? "Confirm this date"
                : hasDate
                  ? "Move the date"
                  : "Schedule launch"}
            </Button>
            {hasDate && (
              <Button
                type="button"
                variant="outline"
                className="cursor-pointer"
                disabled={isPending || !value || isUnchanged}
                onClick={() => requestSubmit(true)}
              >
                Postpone to this date
              </Button>
            )}
          </div>
          {hasDate && isUnchanged && (
            <p className="text-muted-foreground text-xs">
              {isReconfirm
                ? "Still going ahead on this day? Confirm it to take the postponement back. Or pick a different day."
                : "Pick a different day to move or postpone the launch."}
            </p>
          )}
        </div>

        {hasDate && (
          <div className="space-y-2">
            <Label htmlFor="launch-note">Why is it changing? (optional)</Label>
            <Textarea
              id="launch-note"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Venue fell through, team not ready, …"
              rows={2}
              maxLength={2000}
              disabled={isPending}
              className="resize-none"
            />
          </div>
        )}
      </div>

      <AlertDialog
        open={confirming !== null}
        onOpenChange={(open) => !open && setConfirming(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirming === "postpone"
                ? "Postpone Launch Sunday?"
                : confirming === "reconfirm"
                  ? "Launch Sunday is back on?"
                  : "Move Launch Sunday?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirming === "reconfirm" ? (
                <>
                  Launch Sunday stays on{" "}
                  <span className="font-medium">
                    {value && formatLaunchDay(value)}
                  </span>
                  , and the launch is no longer postponed. The change is
                  recorded, and your sending church is notified.
                </>
              ) : (
                <>
                  {targetDate && (
                    <>
                      The day moves from{" "}
                      <span className="font-medium">
                        {formatLaunchDay(targetDate)}
                      </span>{" "}
                      to{" "}
                      <span className="font-medium">
                        {value && formatLaunchDay(value)}
                      </span>
                      .{" "}
                    </>
                  )}
                  {confirming === "postpone"
                    ? "The launch is marked postponed, the change is recorded, and your sending church is notified."
                    : "The change is recorded, and your sending church is notified."}
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>

          <AlertDialogFooter>
            <AlertDialogCancel className="cursor-pointer" disabled={isPending}>
              {confirming === "reconfirm"
                ? "Leave it postponed"
                : "Keep the current date"}
            </AlertDialogCancel>
            <Button
              type="button"
              className="cursor-pointer"
              disabled={isPending}
              onClick={() => submit(confirming === "postpone")}
            >
              {isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <CalendarDays className="mr-2 h-4 w-4" />
              )}
              {confirming === "postpone"
                ? "Postpone"
                : confirming === "reconfirm"
                  ? "Confirm this date"
                  : "Move the date"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
