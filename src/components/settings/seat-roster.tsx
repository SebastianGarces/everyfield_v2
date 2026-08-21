"use client";

// ============================================================================
// THE SEAT ROSTER — who is on this plant, and the Owner's three verbs over them
// (AS-015 / AS-016 / AS-017 / AS-023, #497).
//
// Presentational and fully serializable, exactly like `InvitationsList` next
// door: every row arrives pre-shaped by the page, INCLUDING ITS JOIN DATE AS A
// STRING formatted against `APP_TIME_ZONE` (`memory/invariants.md` → Date &
// Time Rendering — a `Date` formatted in the browser's zone and again on the
// server produces two different strings and a hydration mismatch).
//
// THE CONTROLS ARE ABSENT, NOT DISABLED (AS-020). `canManageSeats` is false for
// an Admin and the whole actions column — header cell included — is never
// rendered, so there is no greyed button to hover and no tooltip explaining
// what somebody may not do. The same rule handles the Owner's own row through
// `isSelf`: AS-017 says an Owner may not remove their own seat, so the row that
// would offer it renders nothing at all.
//
// NONE OF THAT IS THE AUTHORIZATION. `requireSeat("seat.manage")` and the
// plant-scoped `WHERE` in `@/lib/seats/roster` refuse a request that never saw
// this component, which is what the action tests assert. What this file decides
// is only what a person is ASKED to do.
//
// THE ACTIONS ARRIVE AS PROPS rather than being imported, the pattern
// `InvitationsList` established: it keeps this component renderable by a test
// with no database behind it, and it is why `seat-roster.test.ts` can assert
// the absence rule on real markup.
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { UserSeat } from "@/db/schema";
import type { SeatTenancyType } from "@/lib/auth/tenancy";
import { TENANCY_NOUN } from "@/lib/invitations/seat-copy";

import type { SeatActionOutcome } from "./seat-action-outcome";

/**
 * WHAT THE TWO WORKING SEATS DO HERE, for the Owner reading the roster.
 *
 * The two org kinds share a sentence: a sending church's team and a network's
 * team hold the same two seats over the same kind of reach.
 */
const SEAT_SUMMARY = {
  church:
    "Admins run the day-to-day work; Members read the plant and act on their own duties.",
  sending_church:
    "Admins can invite others onto the team; Members read the portfolio and change nothing.",
  network:
    "Admins can invite others onto the team; Members read the portfolio and change nothing.",
} as const satisfies Record<SeatTenancyType, string>;

/**
 * WHAT REMOVING A SEAT ACTUALLY DOES, per tenancy — the sentence the
 * confirmation dialog is accountable to.
 *
 * It mirrors `removeSeat`'s own batch: a plant gets the sessions delete, the
 * task reassignment, the leader-slot clear and the marker; an org gets the
 * sessions delete and the marker. A copy table that promised the plant's
 * cascade to an org would be describing statements that are not in that batch.
 */
const REMOVAL_CONSEQUENCES = {
  church:
    "They lose access straight away and are signed out everywhere. Their open tasks come to you, and any ministry team they lead is left with an open leader slot. Their record in the people directory stays exactly as it is — to bring them back, invite them again.",
  sending_church:
    "They lose access straight away and are signed out everywhere. Nothing else changes — to bring them back, invite them again.",
  network:
    "They lose access straight away and are signed out everywhere. Nothing else changes — to bring them back, invite them again.",
} as const satisfies Record<SeatTenancyType, string>;

/** What one roster row looks like to the browser. No ids beyond the subject. */
export type SeatRosterViewRow = {
  userId: string;
  /** An account may hold no name until it sets one; the address always exists. */
  name: string | null;
  email: string;
  seat: UserSeat;
  /** Pre-formatted on the server — see the header. */
  joinedLabel: string;
  /** Whether this row is the person reading it (AS-017). */
  isSelf: boolean;
};

export type SeatRosterActions = {
  appoint: (userId: string) => Promise<SeatActionOutcome>;
  demote: (userId: string) => Promise<SeatActionOutcome>;
  remove: (userId: string) => Promise<SeatActionOutcome>;
};

/**
 * EVERYTHING THIS SURFACE KNOWS ABOUT A SEAT, AS ONE TABLE.
 *
 * Three questions used to be three conditionals spread down the row — what to
 * call it, whether it may move, whether it may be removed — and two of them
 * were spelled `row.seat === "owner"`. `seat-guard.test.ts` fails on a
 * hand-compared seat for a reason that applies here as much as in an action:
 * a rule with two spellings drifts, and a UI that decides "is this the Owner"
 * on its own is how a control appears beside somebody the server would refuse.
 *
 * So the seat is a KEY, never an operand. `move: null` and `removable: false`
 * on the Owner row ARE the rule — appointing and demoting move a seat between
 * Admin and Member (AS-015), the Owner's seat is not removable from this
 * surface (AS-016), and handing ownership over is a verb this track does not
 * ship (#342). A fourth seat would be one more line here and no new branch.
 */
const SEAT_RULES: Record<
  UserSeat,
  {
    label: string;
    emphasis: "default" | "secondary";
    move: { action: "appoint" | "demote"; label: string } | null;
    removable: boolean;
  }
> = {
  owner: {
    label: "Owner",
    emphasis: "default",
    move: null,
    removable: false,
  },
  admin: {
    label: "Admin",
    emphasis: "secondary",
    move: { action: "demote", label: "Make a Member" },
    removable: true,
  },
  member: {
    label: "Member",
    emphasis: "secondary",
    move: { action: "appoint", label: "Make an Admin" },
    removable: true,
  },
};

/** The name to address somebody by when they have not set one. */
function displayName(row: SeatRosterViewRow): string {
  return row.name?.trim() || row.email;
}

export function SeatRoster({
  rows,
  canManageSeats,
  actions,
  tenancyType,
}: {
  rows: SeatRosterViewRow[];
  canManageSeats: boolean;
  actions: SeatRosterActions;
  /**
   * WHICH KIND OF TEAM THIS IS (#500). It decides copy only — every scope lives
   * in the actor's own `WHERE` one layer down — but the copy is not cosmetic:
   * the removal dialog names the CASCADE, and a sending church has no tasks and
   * no ministry teams for a removal to touch.
   */
  tenancyType: SeatTenancyType;
}) {
  const noun = TENANCY_NOUN[tenancyType];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Seats</CardTitle>
        <CardDescription>
          {`Everyone with a login on this ${noun}. ${
            canManageSeats
              ? SEAT_SUMMARY[tenancyType]
              : "Only the Owner can change what a seat may do."
          }`}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Seat</TableHead>
                <TableHead>Joined</TableHead>
                {/* Absent, not empty, for an Admin — see the header. */}
                {canManageSeats ? (
                  <TableHead className="text-right">Manage</TableHead>
                ) : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <SeatRow
                  key={row.userId}
                  row={row}
                  canManageSeats={canManageSeats}
                  actions={actions}
                  tenancyType={tenancyType}
                />
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

function SeatRow({
  row,
  canManageSeats,
  actions,
  tenancyType,
}: {
  row: SeatRosterViewRow;
  canManageSeats: boolean;
  actions: SeatRosterActions;
  tenancyType: SeatTenancyType;
}) {
  const noun = TENANCY_NOUN[tenancyType];
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [confirmingRemoval, setConfirmingRemoval] = useState(false);

  const name = displayName(row);
  const rule = SEAT_RULES[row.seat];
  // A `const` so the closure below narrows with it — an inline `rule.move!`
  // would be a claim the compiler cannot check, which is how a table gains a
  // fourth row and a runtime crash on the same day.
  const move = rule.move;

  // WHO MAY ACT ON THIS ROW AT ALL: an Admin manages nothing (AS-015), and
  // nobody manages their own row (AS-017). WHAT may then be done is each rule's
  // own answer — `move` and `removable` gate their own buttons below, and
  // deliberately not each other's. Reading `removable` for both would mean a
  // seat declared movable-but-not-removable silently lost its appoint control,
  // with no diff anywhere near the line that decided it.
  const mayAct = canManageSeats && !row.isSelf;

  function run(mutate: () => Promise<SeatActionOutcome>) {
    setError(null);
    startTransition(async () => {
      const result = await mutate();
      if (!result.success) {
        setError(result.error);
        return;
      }
      setConfirmingRemoval(false);
    });
  }

  return (
    <TableRow>
      <TableCell className="font-medium">
        {row.name?.trim() || (
          <span className="text-muted-foreground">Not set</span>
        )}
      </TableCell>
      <TableCell className="text-muted-foreground">{row.email}</TableCell>
      <TableCell>
        <Badge variant={rule.emphasis}>{rule.label}</Badge>
      </TableCell>
      <TableCell className="text-muted-foreground whitespace-nowrap">
        {row.joinedLabel}
      </TableCell>

      {canManageSeats ? (
        <TableCell className="text-right">
          <div className="flex flex-wrap items-center justify-end gap-2">
            {mayAct && move ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={pending}
                aria-label={`${move.label} — ${name}`}
                // The table names WHICH action, so there is no ternary here
                // to get backwards and no second place stating that a Member
                // is appointed and an Admin is demoted.
                onClick={() => run(() => actions[move.action](row.userId))}
              >
                {move.label}
              </Button>
            ) : null}

            {mayAct && rule.removable ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={pending}
                className="text-destructive hover:text-destructive"
                aria-label={`Remove ${name} from this ${noun}`}
                onClick={() => setConfirmingRemoval(true)}
              >
                Remove
              </Button>
            ) : null}
          </div>

          {/* THE REFUSAL GOES WHERE THE READER IS LOOKING. While the dialog is
              open it is MODAL — Radix portals it over a `fixed inset-0`
              overlay and `aria-hidden`s everything outside — so a message
              rendered in this cell would be painted under the overlay and
              taken out of the accessibility tree, which is the one path the
              plain-Button-instead-of-AlertDialogAction choice below exists to
              serve. So the removal's refusal renders INSIDE the dialog, and
              only the appoint/demote refusal renders here. */}
          {error && !confirmingRemoval ? (
            <p role="alert" className="text-destructive mt-1 text-xs">
              {error}
            </p>
          ) : null}

          {/* THE CONFIRMATION AS-016 REQUIRES. It is a deliberateness control
              and nothing else — every rule it looks like it is enforcing lives
              in `removeSeat`, which a request that never opened this dialog
              meets too. */}
          <AlertDialog
            open={confirmingRemoval}
            onOpenChange={setConfirmingRemoval}
          >
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  Remove {name} from this {noun}?
                </AlertDialogTitle>
                {/* THE DIALOG NAMES THE CASCADE, so it has to name the RIGHT
                    one. A plant's removal reassigns open tasks and empties a
                    ministry-team leader slot; a sending church and a network
                    have neither table, so their removal is the access and
                    nothing else (`removeSeat` batches exactly that). Promising
                    effects that will not happen is the same defect as hiding
                    ones that will. */}
                <AlertDialogDescription>
                  {REMOVAL_CONSEQUENCES[tenancyType]}
                </AlertDialogDescription>
              </AlertDialogHeader>

              {error ? (
                <p role="alert" className="text-destructive text-sm">
                  {error}
                </p>
              ) : null}

              <AlertDialogFooter>
                <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
                {/* A plain Button, not `AlertDialogAction`: the primitive closes
                    the dialog on click, which would unmount the row's error
                    before a refusal could be read. */}
                <Button
                  type="button"
                  variant="destructive"
                  disabled={pending}
                  onClick={() => run(() => actions.remove(row.userId))}
                >
                  {pending ? "Removing…" : `Remove from ${noun}`}
                </Button>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </TableCell>
      ) : null}
    </TableRow>
  );
}
