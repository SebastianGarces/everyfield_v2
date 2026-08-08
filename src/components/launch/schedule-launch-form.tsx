"use client";

// ============================================================================
// Scheduling, moving and postponing the launch (LS-001/002/009).
//
// PLANTER-ONLY, and this component is only half of that: the page does not
// render it for anyone else, and `scheduleLaunchAction` → `setLaunchDate`
// refuses a forged call from a team member regardless of what the page rendered
// (LS-007). A hidden button is a courtesy; the server check is the rule.
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
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export interface ScheduleLaunchFormProps {
  /** The stored day, or `null` when none has been named yet. */
  targetDate: string | null;
}

export function ScheduleLaunchForm({ targetDate }: ScheduleLaunchFormProps) {
  // Form state, not server state: the input's working value while the planter
  // types. The page gives this component a `key` of the stored date, so a
  // saved change remounts it rather than leaving a stale draft behind
  // (memory/contracts/data-patterns.md — never sync props into state).
  const [value, setValue] = useState(targetDate ?? "");
  const [note, setNote] = useState("");
  const [confirming, setConfirming] = useState<"move" | "postpone" | null>(
    null
  );
  const [isPending, startTransition] = useTransition();

  const hasDate = !!targetDate;
  const isUnchanged = value === (targetDate ?? "");

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
    setConfirming(postpone ? "postpone" : "move");
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{hasDate ? "Change the date" : "Name the day"}</CardTitle>
        <CardDescription>
          {hasDate
            ? "Moving or postponing the date is recorded — who changed it, when, and from what."
            : "Set Launch Sunday and we'll seed your readiness milestones from the Launch Playbook."}
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
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
              disabled={isPending || !value || (hasDate && isUnchanged)}
              onClick={() => requestSubmit(false)}
            >
              {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {hasDate ? "Move the date" : "Schedule launch"}
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
              Pick a different day to move or postpone the launch.
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
      </CardContent>

      <AlertDialog
        open={confirming !== null}
        onOpenChange={(open) => !open && setConfirming(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirming === "postpone"
                ? "Postpone Launch Sunday?"
                : "Move Launch Sunday?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
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
            </AlertDialogDescription>
          </AlertDialogHeader>

          <AlertDialogFooter>
            <AlertDialogCancel className="cursor-pointer" disabled={isPending}>
              Keep the current date
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
              {confirming === "postpone" ? "Postpone" : "Move the date"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
