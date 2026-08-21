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
 * The shape every roster action answers in.
 *
 * Declared here rather than imported from the `"use server"` module: a
 * `"use server"` module's exports are enumerated into the page's action
 * manifest, so re-exporting a type through one fails the build
 * (`settings/team/actions.ts` carries the whole note). The two declarations are
 * checked against each other by the compiler at the call site in `page.tsx`.
 */
export type SeatActionOutcome =
  | { success: true }
  | { success: false; error: string };

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
}: {
  rows: SeatRosterViewRow[];
  canManageSeats: boolean;
  actions: SeatRosterActions;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Seats</CardTitle>
        <CardDescription>
          {canManageSeats
            ? "Everyone with a login on this plant. Admins run the day-to-day work; Members read the plant and act on their own duties."
            : "Everyone with a login on this plant. Only the Owner can change what a seat may do."}
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
}: {
  row: SeatRosterViewRow;
  canManageSeats: boolean;
  actions: SeatRosterActions;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [confirmingRemoval, setConfirmingRemoval] = useState(false);

  const name = displayName(row);
  const rule = SEAT_RULES[row.seat];
  // A `const` so the closure below narrows with it — an inline `rule.move!`
  // would be a claim the compiler cannot check, which is how a table gains a
  // fourth row and a runtime crash on the same day.
  const move = rule.move;

  // THE WHOLE ABSENCE RULE, IN ONE EXPRESSION. An Admin manages nothing
  // (AS-015); nobody manages their own row (AS-017); and whether the seat
  // itself may be touched is the table's answer, not a comparison here.
  const manageable = canManageSeats && !row.isSelf && rule.removable;

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
          {manageable ? (
            <div className="flex flex-wrap items-center justify-end gap-2">
              {move ? (
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

              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={pending}
                className="text-destructive hover:text-destructive"
                aria-label={`Remove ${name} from this plant`}
                onClick={() => setConfirmingRemoval(true)}
              >
                Remove
              </Button>
            </div>
          ) : null}

          {error ? (
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
                  Remove {name} from this plant?
                </AlertDialogTitle>
                <AlertDialogDescription>
                  They lose access straight away and are signed out everywhere.
                  Their open tasks come to you, and any ministry team they lead
                  is left with an open leader slot. Their record in the people
                  directory stays exactly as it is — to bring them back, invite
                  them again.
                </AlertDialogDescription>
              </AlertDialogHeader>
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
                  {pending ? "Removing…" : "Remove from plant"}
                </Button>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </TableCell>
      ) : null}
    </TableRow>
  );
}
