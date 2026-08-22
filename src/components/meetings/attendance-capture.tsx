"use client";

import { useState, useTransition, useCallback } from "react";
import {
  Search,
  UserPlus,
  CheckCircle,
  Plus,
  Loader2,
  CheckCircle2,
  XCircle,
  Clock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  toggleAttendanceStatusAction,
  addWalkInAttendeeAction,
  quickAddWalkInAction,
  finalizeAttendanceAction,
} from "@/app/(dashboard)/meetings/actions";
import { searchPeopleAction } from "@/app/(dashboard)/communication/actions";
import { ResponsePicker } from "@/components/meetings/response-picker";
import { useCan } from "@/components/shared/viewer-capabilities";
import {
  responseCardLabel,
  RESPONSE_NOT_RECORDED_LABEL,
} from "@/lib/meetings/response-card";
import type { ResponseCardType } from "@/db/schema/meetings";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface GuestEntry {
  id: string;
  personId: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  attendanceStatus: string;
  responseStatus: string | null;
}

interface AttendanceSummary {
  total: number;
  firstTime: number;
  returning: number;
  coreGroup: number;
}

interface PersonResult {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
}

interface AttendanceCaptureProps {
  meetingId: string;
  guests: GuestEntry[];
  summary: AttendanceSummary;
  /**
   * VM-014. Response cards are a VISION MEETING artifact (FRD → VM-014), so the
   * column is absent rather than empty on an orientation or a team meeting —
   * an always-present control that is never the right thing to fill in trains a
   * planter to ignore the column.
   */
  showResponseCards?: boolean;
  /**
   * The stored card per person id. A person ABSENT from this map has no card
   * recorded, which is a state of its own and never a refusal — see
   * `buildResponseBreakdown`.
   */
  responseCards?: Record<string, ResponseCardType>;
  /**
   * Whether this meeting has already been finalized. It changes what the
   * button is FOR: the first press finalizes, every later one reconciles the
   * register — which is a real job (a late-added first-timer gets their
   * follow-up) but not the same job, and a control that keeps saying
   * "Finalize" hides the difference (#323 WS3).
   */
  finalized?: boolean;
}

/**
 * What the planter is told after the action returns. One sentence per outcome,
 * because they are three different things that happened — and the middle one
 * used to be reported as the same silent success as the others while their
 * late-added attendee got nothing.
 *
 * The counts are facts. The task claims are stated as a RULE ("any first-time
 * attendee ..."), which stays true for a meeting where nobody was new, rather
 * than as a count this call does not have.
 */
export function finalizeOutcomeMessage(
  outcome: "finalized" | "already_finalized" | "reconciled",
  total: number
): string {
  switch (outcome) {
    case "finalized":
      return `Attendance finalized: ${total} attended. Any first-time attendee now has a follow-up task, due 48 hours after the meeting.`;
    case "reconciled":
      return `Attendance updated: ${total} attended. Any first-time attendee added since is covered too.`;
    case "already_finalized":
      return `Nothing to update — ${total} attended, unchanged since you finalized.`;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * The displayed name of a guest. `lastName` can be blank for a quick-added
 * walk-in, so the parts are joined and trimmed rather than concatenated with a
 * hard space — a trailing space is invisible on screen but is read out, and it
 * would put "Mark Ana  as attended" into the accessible name below.
 */
export function guestFullName(guest: {
  firstName: string;
  lastName: string;
}): string {
  return `${guest.firstName} ${guest.lastName}`.replace(/\s+/g, " ").trim();
}

/**
 * The accessible name of an attendance checkbox. The row's only visible label
 * is the "Here" column header, which does not say WHOSE attendance the control
 * toggles, so each checkbox names its person (issue #159, Lighthouse
 * `button-name` — Radix renders the checkbox as a `<button role="checkbox">`).
 * The label is deliberately state-free: `aria-checked` already announces on/off,
 * and a name that flipped with the state would be read as a different control.
 */
export function attendanceCheckboxLabel(guestName: string): string {
  const name = guestName.trim();
  return name ? `Mark ${name} as attended` : "Mark this guest as attended";
}

const rsvpBadge: Record<
  string,
  { label: string; className: string; icon: typeof CheckCircle2 }
> = {
  confirmed: {
    label: "Confirmed",
    className: "bg-green-100 text-green-800",
    icon: CheckCircle2,
  },
  declined: {
    label: "Declined",
    className: "bg-red-100 text-red-800",
    icon: XCircle,
  },
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function AttendanceCapture({
  meetingId,
  guests,
  summary,
  showResponseCards = false,
  responseCards = {},
  finalized = false,
}: AttendanceCaptureProps) {
  const [isPending, startTransition] = useTransition();

  // AS-020. Every write on this screen is `meetings.write`: the register's
  // ticks, the walk-in card, the response cards and the finalize. A Member
  // keeps the register as a READ — who was invited, who came, what they handed
  // in — and is offered none of the controls that change it.
  const canWrite = useCan("meetings.write");

  // Walk-in search state
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<PersonResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [showWalkIn, setShowWalkIn] = useState(false);

  // Quick-add dialog state
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [quickAddError, setQuickAddError] = useState<string | null>(null);

  // Finalize error state
  const [finalizeError, setFinalizeError] = useState<string | null>(null);
  // What the last press actually did. Cleared on the next press, so the planter
  // never reads a stale outcome beside a spinner.
  const [finalizeOutcome, setFinalizeOutcome] = useState<string | null>(null);

  const guestPersonIds = new Set(guests.map((g) => g.personId));
  const attendedCount = guests.filter(
    (g) => g.attendanceStatus === "attended"
  ).length;

  // ------- Toggle attendance -------
  const handleToggle = (personId: string, currentStatus: string) => {
    const attended = currentStatus !== "attended";
    startTransition(async () => {
      await toggleAttendanceStatusAction(meetingId, personId, attended);
    });
  };

  // ------- Walk-in search -------
  const handleSearch = useCallback(
    async (value: string) => {
      setSearchQuery(value);
      if (value.length < 2) {
        setSearchResults([]);
        return;
      }
      setSearching(true);
      try {
        const people = await searchPeopleAction(value);
        setSearchResults(people.filter((p) => !guestPersonIds.has(p.id)));
      } catch {
        setSearchResults([]);
      } finally {
        setSearching(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [guests]
  );

  const handleAddWalkIn = (person: PersonResult) => {
    startTransition(async () => {
      await addWalkInAttendeeAction(meetingId, person.id);
      setSearchQuery("");
      setSearchResults([]);
    });
  };

  // ------- Quick-add walk-in -------
  const handleQuickAdd = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setQuickAddError(null);
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const result = await quickAddWalkInAction(meetingId, formData);
      if (result.success) {
        setQuickAddOpen(false);
      } else {
        setQuickAddError(result.error ?? "Something went wrong");
      }
    });
  };

  // ------- Finalize -------
  // The action reports a failed finalize instead of throwing (the count is left
  // alone and the click is safe to repeat), so the result has to be read —
  // otherwise the spinner just stops and the user is told nothing. The SUCCESS
  // half is read for the same reason: three different things can have happened
  // and only one of them is "your register is now the record" (#323 WS3).
  const handleFinalize = () => {
    setFinalizeError(null);
    setFinalizeOutcome(null);
    startTransition(async () => {
      const result = await finalizeAttendanceAction(meetingId);
      if (!result.success) {
        setFinalizeError(result.error ?? "Something went wrong");
        return;
      }
      setFinalizeOutcome(
        finalizeOutcomeMessage(result.data.outcome, result.data.total)
      );
    });
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Card>
          <CardContent className="pt-4 text-center">
            <p className="text-xl font-bold">{attendedCount}</p>
            <p className="text-muted-foreground text-xs">Attended</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 text-center">
            <p className="text-xl font-bold text-green-600">
              {summary.firstTime}
            </p>
            <p className="text-muted-foreground text-xs">First Time</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 text-center">
            <p className="text-xl font-bold text-blue-600">
              {summary.returning}
            </p>
            <p className="text-muted-foreground text-xs">Returning</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 text-center">
            <p className="text-xl font-bold text-purple-600">
              {summary.coreGroup}
            </p>
            <p className="text-muted-foreground text-xs">Core Group</p>
          </CardContent>
        </Card>
      </div>

      {/* Walk-in Section — the whole card is a write, so it is absent rather
          than emptied. */}
      {canWrite && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">Add Walk-in</CardTitle>
              <div className="flex items-center gap-2">
                <Dialog open={quickAddOpen} onOpenChange={setQuickAddOpen}>
                  <DialogTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      className="cursor-pointer"
                    >
                      <UserPlus className="mr-2 h-4 w-4" />
                      Quick Add Person
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="sm:max-w-[425px]">
                    <DialogHeader>
                      <DialogTitle>Quick Add Walk-in</DialogTitle>
                      <DialogDescription>
                        Create a new person and mark them as attended.
                      </DialogDescription>
                    </DialogHeader>
                    <form onSubmit={handleQuickAdd} className="space-y-4">
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label htmlFor="firstName">First Name *</Label>
                          <Input
                            id="firstName"
                            name="firstName"
                            required
                            placeholder="John"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="lastName">Last Name *</Label>
                          <Input
                            id="lastName"
                            name="lastName"
                            required
                            placeholder="Doe"
                          />
                        </div>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="email">Email</Label>
                        <Input
                          id="email"
                          name="email"
                          type="email"
                          placeholder="john@example.com"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="phone">Phone</Label>
                        <Input
                          id="phone"
                          name="phone"
                          type="tel"
                          placeholder="(555) 123-4567"
                        />
                      </div>
                      {quickAddError && (
                        <p className="text-destructive text-sm">
                          {quickAddError}
                        </p>
                      )}
                      <DialogFooter>
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => setQuickAddOpen(false)}
                          className="cursor-pointer"
                        >
                          Cancel
                        </Button>
                        <Button
                          type="submit"
                          disabled={isPending}
                          className="cursor-pointer"
                        >
                          {isPending && (
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          )}
                          Add & Mark Attended
                        </Button>
                      </DialogFooter>
                    </form>
                  </DialogContent>
                </Dialog>

                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowWalkIn(!showWalkIn)}
                  className="cursor-pointer"
                >
                  <Plus className="mr-2 h-4 w-4" />
                  Add Existing
                </Button>
              </div>
            </div>
          </CardHeader>
          {showWalkIn && (
            <CardContent>
              <div className="relative">
                <Search className="text-muted-foreground absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
                <Input
                  value={searchQuery}
                  onChange={(e) => handleSearch(e.target.value)}
                  placeholder="Search by name..."
                  className="pl-10"
                />
                {searchResults.length > 0 && (
                  <div className="absolute z-10 mt-1 max-h-48 w-full overflow-auto rounded-md border bg-white shadow-sm dark:bg-gray-900">
                    {searchResults.map((person) => (
                      <button
                        key={person.id}
                        type="button"
                        className="flex w-full cursor-pointer items-center justify-between px-3 py-2 text-left text-sm hover:bg-gray-50 dark:hover:bg-gray-800"
                        onClick={() => handleAddWalkIn(person)}
                        disabled={isPending}
                      >
                        <div>
                          <span className="font-medium">
                            {person.firstName} {person.lastName}
                          </span>
                          {person.email && (
                            <span className="text-muted-foreground ml-2 text-xs">
                              {person.email}
                            </span>
                          )}
                        </div>
                        <Plus className="text-muted-foreground h-4 w-4" />
                      </button>
                    ))}
                  </div>
                )}
                {searching && (
                  <p className="text-muted-foreground mt-1 text-xs">
                    Searching...
                  </p>
                )}
                {searchQuery.length >= 2 &&
                  !searching &&
                  searchResults.length === 0 && (
                    <p className="text-muted-foreground mt-1 text-xs">
                      No results found. Use &quot;Quick Add Person&quot; to
                      create a new one.
                    </p>
                  )}
              </div>
            </CardContent>
          )}
        </Card>
      )}

      {/* Attendance List */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Attendance ({guests.length} guests)
          </CardTitle>
        </CardHeader>
        <CardContent>
          {guests.length === 0 ? (
            <p className="text-muted-foreground py-8 text-center text-sm">
              {canWrite
                ? "No guests on the list yet. Add people from the Guest List tab or add walk-ins above."
                : "No guests on the list yet. Your plant's admins build the guest list for a meeting."}
            </p>
          ) : (
            /* A real table, not a grid of divs (#361): "Here", "RSVP" and
               "Status" only say what a cell MEANS if the cell is announced with
               its column header, and a screen reader can only do that when the
               headers are `<th scope>` in a `<thead>`. The person's name is the
               row header, so a cell read on its own still says whose it is. */
            <Table>
              <TableCaption className="sr-only">
                Attendance for this meeting. Each row is one guest; the Here
                checkbox marks that guest as attended.
              </TableCaption>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  {/* The column goes with the checkbox in it. "Here" over an
                      empty cell names a control the viewer does not have. */}
                  {canWrite && (
                    <TableHead
                      scope="col"
                      className="text-muted-foreground w-16 text-center text-xs uppercase"
                    >
                      Here
                    </TableHead>
                  )}
                  <TableHead
                    scope="col"
                    className="text-muted-foreground text-xs uppercase"
                  >
                    Name
                  </TableHead>
                  <TableHead
                    scope="col"
                    className="text-muted-foreground text-xs uppercase"
                  >
                    Contact
                  </TableHead>
                  <TableHead
                    scope="col"
                    className="text-muted-foreground text-xs uppercase"
                  >
                    RSVP
                  </TableHead>
                  <TableHead
                    scope="col"
                    className="text-muted-foreground text-xs uppercase"
                  >
                    Status
                  </TableHead>
                  {showResponseCards && (
                    <TableHead
                      scope="col"
                      className="text-muted-foreground text-xs uppercase"
                    >
                      Response
                    </TableHead>
                  )}
                </TableRow>
              </TableHeader>
              <TableBody>
                {guests.map((guest) => {
                  const isAttended = guest.attendanceStatus === "attended";
                  const rsvp = guest.responseStatus
                    ? rsvpBadge[guest.responseStatus]
                    : null;
                  const guestName = guestFullName(guest);

                  return (
                    <TableRow key={guest.id}>
                      {canWrite && (
                        <TableCell className="text-center">
                          <Checkbox
                            checked={isAttended}
                            onCheckedChange={() =>
                              handleToggle(
                                guest.personId,
                                guest.attendanceStatus
                              )
                            }
                            disabled={isPending}
                            aria-label={attendanceCheckboxLabel(guestName)}
                            className="cursor-pointer"
                          />
                        </TableCell>
                      )}

                      <TableHead
                        scope="row"
                        className={
                          isAttended ? "font-medium" : "text-muted-foreground"
                        }
                      >
                        {guestName}
                      </TableHead>

                      <TableCell className="text-muted-foreground">
                        <span className="block max-w-[16rem] truncate">
                          {guest.email || guest.phone || "—"}
                        </span>
                      </TableCell>

                      <TableCell>
                        {rsvp ? (
                          <Badge className={rsvp.className} variant="secondary">
                            <rsvp.icon className="mr-1 h-3 w-3" />
                            {rsvp.label}
                          </Badge>
                        ) : (
                          <Badge
                            variant="outline"
                            className="text-muted-foreground"
                          >
                            <Clock className="mr-1 h-3 w-3" />
                            Pending
                          </Badge>
                        )}
                      </TableCell>

                      <TableCell>
                        {isAttended ? (
                          <Badge className="bg-green-100 text-green-800">
                            Attended
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground text-xs">
                            —
                          </span>
                        )}
                      </TableCell>

                      {showResponseCards && (
                        <TableCell>
                          {/* Only somebody who was in the room can hand a card
                              in. The control is disabled rather than absent so
                              the column keeps its shape down the table, and the
                              reason is the row's own attendance state, which is
                              already on screen beside it. THAT disabled is a
                              business rule and stays; AS-020's hide is the
                              branch around it — a Member reads what was handed
                              in and is offered no picker to change it. */}
                          {canWrite ? (
                            <ResponsePicker
                              meetingId={meetingId}
                              personId={guest.personId}
                              personName={guestName}
                              value={responseCards[guest.personId] ?? null}
                              disabled={!isAttended || isPending}
                            />
                          ) : (
                            <span className="text-muted-foreground text-sm">
                              {responseCards[guest.personId]
                                ? responseCardLabel(
                                    responseCards[guest.personId]
                                  )
                                : RESPONSE_NOT_RECORDED_LABEL}
                            </span>
                          )}
                        </TableCell>
                      )}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Finalize Button */}
      {canWrite && guests.length > 0 && (
        <div className="space-y-3">
          {finalizeError && (
            <p role="alert" className="text-destructive text-sm">
              {finalizeError}
            </p>
          )}
          {finalizeOutcome && (
            <p
              role="status"
              aria-live="polite"
              className="text-muted-foreground text-sm"
              data-testid="finalize-outcome"
            >
              {finalizeOutcome}
            </p>
          )}
          <div className="flex items-center justify-between">
            {/* A live region, because this count is the only feedback a
                toggle produces (#361). The checkbox announces its own state,
                but the running total — which is what the Finalize button is
                gated on — changed silently. `role="status"` is polite, so it
                waits for the reader to finish rather than interrupting a
                planter ticking down the list. It is mounted for as long as
                there is anything to toggle, so the first change is announced
                too. */}
            <p
              role="status"
              aria-live="polite"
              className="text-muted-foreground text-sm"
            >
              {attendedCount} of {guests.length} marked as attended
            </p>
            <Button
              onClick={handleFinalize}
              disabled={isPending || attendedCount === 0}
              size="lg"
              className="cursor-pointer"
            >
              {isPending ? (
                <Loader2 className="mr-2 h-5 w-5 animate-spin" />
              ) : (
                <CheckCircle className="mr-2 h-5 w-5" />
              )}
              {finalized ? "Update Attendance" : "Finalize Attendance"} (
              {attendedCount})
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
