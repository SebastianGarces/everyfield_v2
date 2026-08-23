"use client";

// ============================================================================
// THE PLANT'S COACHES, AND ENDING AN ASSIGNMENT — AS-018 and AS-024 (#497).
//
// BESIDE THE SEAT ROSTER ON PURPOSE (AS-024): a planter auditing who reaches
// their plant has to see both reaches in one pass, because a coach reads the
// plant's own records without holding a seat at all. Two blocks in one pane is
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

import { type RefObject, useRef, useState, useTransition } from "react";

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  SettingsBlock,
  SettingsHeading,
} from "@/components/settings/settings-block";
import { Button } from "@/components/ui/button";

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
  // The list outlives every row in it, which is why it is focusable: ending an
  // assignment unmounts the button focus would otherwise return to. See the
  // dialog in `CoachRow`.
  const list = useRef<HTMLUListElement>(null);

  return (
    <section aria-labelledby="team-coaches">
      <SettingsBlock>
        <SettingsHeading
          id="team-coaches"
          description={
            <>
              Coaches read this plant&rsquo;s own records and change nothing.
              They hold no seat, so they are not on the roster above.
            </>
          }
        >
          Coaches
        </SettingsHeading>
        {rows.length === 0 ? (
          <p className="text-muted-foreground py-6 text-center text-sm">
            No coach is assigned to this plant.
          </p>
        ) : (
          <ul ref={list} tabIndex={-1} className="divide-border divide-y">
            {rows.map((row) => (
              <CoachRow
                key={row.assignmentId}
                row={row}
                canEndAssignments={canEndAssignments}
                endAssignment={endAssignment}
                listRef={list}
              />
            ))}
          </ul>
        )}
      </SettingsBlock>
    </section>
  );
}

function CoachRow({
  row,
  canEndAssignments,
  endAssignment,
  listRef,
}: {
  row: PlantCoachViewRow;
  canEndAssignments: boolean;
  endAssignment: (assignmentId: string) => Promise<SeatActionOutcome>;
  /** Where focus goes when this row's own control stops existing. */
  listRef: RefObject<HTMLUListElement | null>;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);
  // A ref and not state: it is read inside Radix's close handler in the same
  // tick the success closes the dialog, and it must not schedule a render of a
  // row the server is about to drop.
  const ended = useRef(false);

  const name = row.name?.trim() || row.email;

  function end() {
    setError(null);
    startTransition(async () => {
      const result = await endAssignment(row.assignmentId);
      if (!result.success) {
        setError(result.error);
        return;
      }
      ended.current = true;
      setConfirming(false);
    });
  }

  return (
    <li className="flex flex-wrap items-center justify-between gap-3 py-3">
      <div className="min-w-0">
        {/* Wrapping, not truncating: a name or an address cut off with an
            ellipsis leaves the full value unreachable — there is no hover, no
            tooltip and no second place it is written. */}
        <p className="font-medium break-words">{name}</p>
        <p className="text-muted-foreground text-sm break-words">
          {row.email} · coaching since {row.assignedLabel}
        </p>
        {/* Only while the dialog is CLOSED. Radix's AlertDialog is modal — it
            portals over a `fixed inset-0` overlay and `aria-hidden`s everything
            outside — so a refusal rendered here during the confirmation would
            be both invisible and unannounced. It renders inside the dialog
            instead, which is the whole reason the confirm control below is a
            plain Button rather than `AlertDialogAction`. */}
        {error && !confirming ? (
          <p role="alert" className="text-destructive mt-1 text-sm text-pretty">
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
        <AlertDialogContent
          // WHERE FOCUS GOES WHEN THE ROW STOPS EXISTING. Radix restores focus
          // to the trigger on close, and after a successful end that trigger
          // unmounts with its row on the next render — dropping keyboard focus
          // to `<body>`. The list outlives every row, so it takes focus
          // instead. A CANCEL keeps Radix's own restore: the End-assignment
          // button it came from is still on the screen.
          onCloseAutoFocus={(event) => {
            if (!ended.current) return;
            event.preventDefault();
            listRef.current?.focus();
          }}
        >
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
