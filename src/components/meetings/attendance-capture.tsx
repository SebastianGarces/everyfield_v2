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
}: AttendanceCaptureProps) {
  const [isPending, startTransition] = useTransition();

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
  // The action reports a failed finalize instead of throwing (the meeting is
  // left un-finalized and the click is safe to repeat), so the result has to be
  // read — otherwise the spinner just stops and the user is told nothing.
  const handleFinalize = () => {
    setFinalizeError(null);
    startTransition(async () => {
      const result = await finalizeAttendanceAction(meetingId);
      if (!result.success) {
        setFinalizeError(result.error ?? "Something went wrong");
      }
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

      {/* Walk-in Section */}
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
                    No results found. Use &quot;Quick Add Person&quot; to create
                    a new one.
                  </p>
                )}
            </div>
          </CardContent>
        )}
      </Card>

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
              No guests on the list yet. Add people from the Guest List tab or
              add walk-ins above.
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
                  <TableHead
                    scope="col"
                    className="text-muted-foreground w-16 text-center text-xs uppercase"
                  >
                    Here
                  </TableHead>
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
                      <TableCell className="text-center">
                        <Checkbox
                          checked={isAttended}
                          onCheckedChange={() =>
                            handleToggle(guest.personId, guest.attendanceStatus)
                          }
                          disabled={isPending}
                          aria-label={attendanceCheckboxLabel(guestName)}
                          className="cursor-pointer"
                        />
                      </TableCell>

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
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Finalize Button */}
      {guests.length > 0 && (
        <div className="space-y-3">
          {finalizeError && (
            <p role="alert" className="text-destructive text-sm">
              {finalizeError}
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
              Finalize Attendance ({attendedCount})
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
