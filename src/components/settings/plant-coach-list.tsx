"use client";

// ============================================================================
// THE PLANT'S COACHES, AND ENDING AN ASSIGNMENT — AS-018 and AS-024 (#497).
//
// BESIDE THE SEAT ROSTER ON PURPOSE (AS-024): a planter auditing who reaches
// their plant has to see both reaches in one pass, because a coach reads the
// plant's own records without holding a seat at all. Two cards on one page is
// the whole of that requirement.
//
// COACHING IS NOT A SEAT, and this list is shaped to say so. There is no seat
// column, the verb is "End assignment" rather than "Remove", and the copy names
// what actually happens — the assignment goes inactive and NOTHING else
// changes. `endCoachAssignment` is the same act as a seat removal with a much
// smaller blast radius, and a control that read like the roster's would invite
// the planter to expect the cascade.
//
// AN ADMIN SEES THE CONTROL, which is the one place this surface is wider than
// the roster beside it: AS-004 gives an Admin the power to invite a coach, so
// ending one is the symmetric verb (ruled in `coach.assignment.manage`'s
// docblock). `canEndAssignments` is therefore a different prop from the
// roster's `canManageSeats` rather than the same boolean threaded twice.
// ============================================================================

import { useState, useTransition } from "react";

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

import type { SeatActionOutcome } from "./seat-action-outcome";

/** One active coach assignment, as the browser sees it. */
export type PlantCoachViewRow = {
  assignmentId: string;
  name: string | null;
  email: string;
  /** Pre-formatted on the server (`memory/invariants.md` → Date & Time). */
  assignedLabel: string;
};

export function PlantCoachList({
  rows,
  canEndAssignments,
  endAssignment,
}: {
  rows: PlantCoachViewRow[];
  canEndAssignments: boolean;
  endAssignment: (assignmentId: string) => Promise<SeatActionOutcome>;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Coaches</CardTitle>
        <CardDescription>
          Coaches read this plant&rsquo;s own records and change nothing. They
          hold no seat, so they are not on the roster above.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-muted-foreground py-6 text-center text-sm">
            No coach is assigned to this plant.
          </p>
        ) : (
          <ul className="divide-border divide-y">
            {rows.map((row) => (
              <CoachRow
                key={row.assignmentId}
                row={row}
                canEndAssignments={canEndAssignments}
                endAssignment={endAssignment}
              />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function CoachRow({
  row,
  canEndAssignments,
  endAssignment,
}: {
  row: PlantCoachViewRow;
  canEndAssignments: boolean;
  endAssignment: (assignmentId: string) => Promise<SeatActionOutcome>;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);

  const name = row.name?.trim() || row.email;

  function end() {
    setError(null);
    startTransition(async () => {
      const result = await endAssignment(row.assignmentId);
      if (!result.success) {
        setError(result.error);
        return;
      }
      setConfirming(false);
    });
  }

  return (
    <li className="flex flex-wrap items-center justify-between gap-3 py-3">
      <div className="min-w-0">
        <p className="truncate font-medium">{name}</p>
        <p className="text-muted-foreground truncate text-sm">
          {row.email} · coaching since {row.assignedLabel}
        </p>
        {/* Only while the dialog is CLOSED. Radix's AlertDialog is modal — it
            portals over a `fixed inset-0` overlay and `aria-hidden`s everything
            outside — so a refusal rendered here during the confirmation would
            be both invisible and unannounced. It renders inside the dialog
            instead, which is the whole reason the confirm control below is a
            plain Button rather than `AlertDialogAction`. */}
        {error && !confirming ? (
          <p role="alert" className="text-destructive mt-1 text-xs">
            {error}
          </p>
        ) : null}
      </div>

      {canEndAssignments ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={pending}
          aria-label={`End ${name}'s coach assignment`}
          onClick={() => setConfirming(true)}
        >
          End assignment
        </Button>
      ) : null}

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              End {name}&rsquo;s coach assignment?
            </AlertDialogTitle>
            <AlertDialogDescription>
              They stop reaching this plant on their next request. Nothing else
              changes — they keep their own account, and any other plant they
              coach. To bring them back, invite them again.
            </AlertDialogDescription>
          </AlertDialogHeader>

          {error ? (
            <p role="alert" className="text-destructive text-sm">
              {error}
            </p>
          ) : null}

          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
            {/* A plain Button rather than `AlertDialogAction`, which closes on
                click and would unmount a refusal before it could be read. */}
            <Button
              type="button"
              variant="destructive"
              disabled={pending}
              onClick={end}
            >
              {pending ? "Ending…" : "End assignment"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </li>
  );
}
