"use client";

// ============================================================================
// "How did the day go?" — the outcome record (LS-006).
//
// PLANTER-ONLY and WRITE-ONCE. The page renders it for the planter alone; the
// server refuses anyone else and refuses a second submission
// (`recordLaunchOutcome`). It confirms before writing, because completing a
// launch also freezes its date — a completed launch's date is history and the
// date write refuses to move it (FRD non-functional requirements: destructive
// and status-changing actions confirm).
//
// NO MEETING ROW IS CREATED. Launch Sunday is not a meeting (FRD).
// ============================================================================

import { Loader2, PartyPopper } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { recordLaunchOutcomeAction } from "@/app/(dashboard)/launch/actions";
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

export function OutcomeForm() {
  const [attendance, setAttendance] = useState("");
  const [decisions, setDecisions] = useState("");
  const [notes, setNotes] = useState("");
  const [capture, setCapture] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [isPending, startTransition] = useTransition();

  function submit() {
    startTransition(async () => {
      const result = await recordLaunchOutcomeAction({
        attendanceCount: toCount(attendance),
        decisionsCount: toCount(decisions),
        outcomeNotes: notes.trim() || null,
        captureTheDay: capture.trim() || null,
      });

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
        <CardTitle>Record the day</CardTitle>
        <CardDescription>
          Launch Sunday has arrived. Write down what happened — this is recorded
          once and becomes part of the plant&apos;s story.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
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
            <Label htmlFor="launch-decisions">Decisions and responses</Label>
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
            The Playbook&apos;s own charge: give thought to capturing the day so
            it can be remembered and God glorified.
          </p>
        </div>

        <Button
          type="button"
          className="cursor-pointer"
          disabled={isPending}
          onClick={() => setConfirming(true)}
        >
          <PartyPopper className="mr-2 h-4 w-4" />
          Record the outcome
        </Button>
      </CardContent>

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Record Launch Sunday?</AlertDialogTitle>
            <AlertDialogDescription>
              This marks the launch complete and is recorded once. Afterwards
              the launch date is history and can no longer be moved.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="cursor-pointer" disabled={isPending}>
              Not yet
            </AlertDialogCancel>
            <Button
              type="button"
              className="cursor-pointer"
              disabled={isPending}
              onClick={submit}
            >
              {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Record it
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
