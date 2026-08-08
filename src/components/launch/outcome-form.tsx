"use client";

// ============================================================================
// "How did the day go?" — the outcome record, and its corrections (LS-006).
//
// PLANTER-ONLY. The page renders this for the planter alone; the server refuses
// anyone else (`recordLaunchOutcome` / `updateLaunchOutcome` both throw on a
// role they do not accept), so a hidden form is a courtesy and the server check
// is the rule (LS-007).
//
// TWO MODES, ONE FORM, TWO WRITES:
//   record  once, from the target date onward. It completes the launch, which
//           also freezes the date, so it confirms before writing.
//   edit    afterwards, for as long as the record exists. Corrections happen —
//           a headcount re-done on Monday, a decision card that turned up late
//           — and every one of them is journalled (ruled 2026-08-04). It
//           confirms too: the correction is recorded in the plant's history,
//           which is not something to do by mis-click.
//
// The two are separate server actions on purpose. They have different guards
// (a launch that is not yet completed vs one that already is) and neither may
// be inferred from state the client sends.
//
// NO MEETING ROW IS CREATED. Launch Sunday is not a meeting (FRD).
// ============================================================================

import { Loader2, PartyPopper, Pencil } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import {
  recordLaunchOutcomeAction,
  updateLaunchOutcomeAction,
} from "@/app/(dashboard)/launch/actions";
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

/**
 * An empty field is `null` — "not recorded" — and NOT `0`. Zero is a real
 * answer (nobody responded); the schema's nullable counts exist so the two
 * cannot be confused, and this is the boundary that keeps them apart.
 */
function toCount(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === "") return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

/** A stored count as an input value: `null` is an EMPTY field, never "0". */
function fromCount(value: number | null | undefined): string {
  return value === null || value === undefined ? "" : String(value);
}

export interface OutcomeFormProps {
  /** `"record"` on the day, `"edit"` once the outcome exists. */
  mode?: "record" | "edit";
  /**
   * What is currently on the record, in edit mode. Used to seed the draft only
   * — the page gives this component a `key` derived from the stored values, so
   * a saved correction REMOUNTS the form rather than leaving a stale draft
   * behind (memory/contracts/data-patterns.md: never sync props into state).
   */
  initial?: {
    attendanceCount: number | null;
    decisionsCount: number | null;
    outcomeNotes: string | null;
    captureTheDay: string | null;
  } | null;
}

export function OutcomeForm({ mode = "record", initial }: OutcomeFormProps) {
  const isEdit = mode === "edit";

  // Draft state, not server state: the working values while the planter types.
  const [attendance, setAttendance] = useState(
    fromCount(initial?.attendanceCount)
  );
  const [decisions, setDecisions] = useState(
    fromCount(initial?.decisionsCount)
  );
  const [notes, setNotes] = useState(initial?.outcomeNotes ?? "");
  const [capture, setCapture] = useState(initial?.captureTheDay ?? "");
  // In edit mode the fields stay folded away until asked for: the record itself
  // is what the page is showing, and a permanently open form invites edits
  // nobody came to make.
  const [open, setOpen] = useState(!isEdit);
  const [confirming, setConfirming] = useState(false);
  const [isPending, startTransition] = useTransition();

  function submit() {
    startTransition(async () => {
      const input = {
        attendanceCount: toCount(attendance),
        decisionsCount: toCount(decisions),
        outcomeNotes: notes.trim() || null,
        captureTheDay: capture.trim() || null,
      };

      if (isEdit) {
        const result = await updateLaunchOutcomeAction(input);
        if (!result.success) {
          toast.error(result.error);
          return;
        }
        setConfirming(false);
        // A save that changed nothing wrote nothing and journalled nothing, so
        // it must not claim a correction was recorded.
        toast.success(
          result.data.changed
            ? "The record is updated, and the change is in the history."
            : "Nothing changed, so nothing was recorded."
        );
        return;
      }

      const result = await recordLaunchOutcomeAction(input);
      if (!result.success) {
        toast.error(result.error);
        return;
      }

      setConfirming(false);
      toast.success("Launch Sunday is on the record.");
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {isEdit ? "Correct the record" : "Record the day"}
        </CardTitle>
        <CardDescription>
          {isEdit
            ? "Numbers firm up after the fact. Change what you need to — the correction is kept in the launch history, with the original."
            : "Launch Sunday has arrived. Write down what happened — it becomes part of the plant's story."}
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {!open ? (
          <Button
            type="button"
            variant="outline"
            className="cursor-pointer"
            onClick={() => setOpen(true)}
          >
            <Pencil className="mr-2 h-4 w-4" />
            Edit the record
          </Button>
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="launch-attendance">Attendance</Label>
                <Input
                  id="launch-attendance"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  value={attendance}
                  onChange={(event) => setAttendance(event.target.value)}
                  placeholder="How many were present?"
                  disabled={isPending}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="launch-decisions">
                  Decisions and responses
                </Label>
                <Input
                  id="launch-decisions"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  value={decisions}
                  onChange={(event) => setDecisions(event.target.value)}
                  placeholder="0 is an answer too"
                  disabled={isPending}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="launch-notes">How did it go?</Label>
              <Textarea
                id="launch-notes"
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                placeholder="What God did, what worked, what you'd do differently."
                rows={4}
                maxLength={10000}
                disabled={isPending}
                className="resize-none"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="launch-capture">Capturing the day</Label>
              <Textarea
                id="launch-capture"
                value={capture}
                onChange={(event) => setCapture(event.target.value)}
                placeholder="Where the photos and video live, who has them."
                rows={2}
                maxLength={10000}
                disabled={isPending}
                className="resize-none"
              />
              <p className="text-muted-foreground text-xs">
                The Playbook&apos;s own charge: give thought to capturing the
                day so it can be remembered and God glorified.
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                className="cursor-pointer"
                disabled={isPending}
                onClick={() => setConfirming(true)}
              >
                {isEdit ? (
                  <Pencil className="mr-2 h-4 w-4" />
                ) : (
                  <PartyPopper className="mr-2 h-4 w-4" />
                )}
                {isEdit ? "Save the correction" : "Record the outcome"}
              </Button>
              {isEdit && (
                <Button
                  type="button"
                  variant="ghost"
                  className="cursor-pointer"
                  disabled={isPending}
                  onClick={() => setOpen(false)}
                >
                  Cancel
                </Button>
              )}
            </div>
          </>
        )}
      </CardContent>

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {isEdit ? "Save this correction?" : "Record Launch Sunday?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {isEdit
                ? "The record is updated and the correction is added to the launch history, with your name and the time."
                : "This marks the launch complete. Afterwards the launch date is history and can no longer be moved — the record itself stays editable."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="cursor-pointer" disabled={isPending}>
              {isEdit ? "Keep it as it is" : "Not yet"}
            </AlertDialogCancel>
            <Button
              type="button"
              className="cursor-pointer"
              disabled={isPending}
              onClick={submit}
            >
              {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {isEdit ? "Save the correction" : "Record it"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
