"use client";

import { useState, useTransition, useCallback } from "react";
import Link from "next/link";
import {
  Plus,
  Mail,
  Search,
  X,
  Loader2,
  Trash2,
  CheckCircle2,
  XCircle,
  Clock,
  UserPlus,
  CheckCheck,
  Eye,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
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
  addToGuestListAction,
  removeFromGuestListAction,
  updateRsvpStatusAction,
  quickAddPersonToGuestListAction,
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

interface EmailTrackingData {
  status: string;
  deliveredAt: string | null;
  openedAt: string | null;
}

interface PersonResult {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
}

interface GuestListProps {
  meetingId: string;
  guests: GuestEntry[];
  emailTracking?: Record<string, EmailTrackingData>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const rsvpBadge: Record<string, { label: string; className: string; icon: typeof CheckCircle2 }> = {
  confirmed: { label: "Confirmed", className: "bg-green-100 text-green-800", icon: CheckCircle2 },
  declined: { label: "Declined", className: "bg-red-100 text-red-800", icon: XCircle },
};

const emailStatusIcons: Record<string, { icon: typeof Mail; color: string; label: string }> = {
  pending: { icon: Mail, color: "text-gray-400", label: "Pending" },
  sent: { icon: Mail, color: "text-blue-500", label: "Sent" },
  delivered: { icon: CheckCheck, color: "text-green-500", label: "Delivered" },
  opened: { icon: Eye, color: "text-emerald-600", label: "Opened" },
  clicked: { icon: Eye, color: "text-teal-600", label: "Clicked" },
  bounced: { icon: Mail, color: "text-red-500", label: "Bounced" },
  failed: { icon: Mail, color: "text-red-500", label: "Failed" },
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function GuestList({ meetingId, guests, emailTracking }: GuestListProps) {
  const [isPending, startTransition] = useTransition();

  // Person picker state
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<PersonResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [showSearch, setShowSearch] = useState(false);

  // Quick-add dialog state
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [quickAddError, setQuickAddError] = useState<string | null>(null);

  const guestPersonIds = new Set(guests.map((g) => g.personId));

  const confirmed = guests.filter((g) => g.responseStatus === "confirmed").length;
  const declined = guests.filter((g) => g.responseStatus === "declined").length;
  const noResponse = guests.filter(
    (g) => !g.responseStatus || !["confirmed", "declined"].includes(g.responseStatus)
  ).length;

  // Build "Send Email" URL with all guest personIds
  const guestsWithEmail = guests.filter((g) => g.email);
  const sendEmailUrl =
    guestsWithEmail.length > 0
      ? `/communication/compose?meetingId=${meetingId}&recipientIds=${guestsWithEmail.map((g) => g.personId).join(",")}`
      : null;

  // ------- Person search -------
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

  const handleAddPerson = (person: PersonResult) => {
    startTransition(async () => {
      await addToGuestListAction(meetingId, person.id);
      setSearchQuery("");
      setSearchResults([]);
    });
  };

  const handleRemovePerson = (personId: string) => {
    startTransition(async () => {
      await removeFromGuestListAction(meetingId, personId);
    });
  };

  const handleRsvpToggle = (personId: string, current: string | null) => {
    // Cycle: null -> confirmed -> declined -> null
    let next: string;
    if (!current || !["confirmed", "declined"].includes(current)) {
      next = "confirmed";
    } else if (current === "confirmed") {
      next = "declined";
    } else {
      next = "confirmed";
    }
    startTransition(async () => {
      await updateRsvpStatusAction(meetingId, personId, next);
    });
  };

  // ------- Quick-add person -------
  const handleQuickAdd = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setQuickAddError(null);
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const result = await quickAddPersonToGuestListAction(meetingId, formData);
      if (result.success) {
        setQuickAddOpen(false);
      } else {
        setQuickAddError(result.error ?? "Something went wrong");
      }
    });
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      {/* Summary Stats */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Card>
          <CardContent className="pt-4 text-center">
            <p className="text-xl font-bold">{guests.length}</p>
            <p className="text-xs text-muted-foreground">Total Guests</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 text-center">
            <p className="text-xl font-bold text-green-600">{confirmed}</p>
            <p className="text-xs text-muted-foreground">Confirmed</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 text-center">
            <p className="text-xl font-bold text-red-600">{declined}</p>
            <p className="text-xs text-muted-foreground">Declined</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 text-center">
            <p className="text-xl font-bold text-gray-600">{noResponse}</p>
            <p className="text-xs text-muted-foreground">No Response</p>
          </CardContent>
        </Card>
      </div>

      {/* Guest List Card */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Guest List</CardTitle>
            <div className="flex items-center gap-2">
              {sendEmailUrl && (
                <Button variant="default" size="sm" asChild>
                  <Link href={sendEmailUrl} className="cursor-pointer">
                    <Mail className="mr-2 h-4 w-4" />
                    Send Email ({guestsWithEmail.length})
                  </Link>
                </Button>
              )}

              {/* Quick Add Person Dialog */}
              <Dialog open={quickAddOpen} onOpenChange={setQuickAddOpen}>
                <DialogTrigger asChild>
                  <Button variant="outline" size="sm" className="cursor-pointer">
                    <UserPlus className="mr-2 h-4 w-4" />
                    Quick Add Person
                  </Button>
                </DialogTrigger>
                <DialogContent className="sm:max-w-[425px]">
                  <DialogHeader>
                    <DialogTitle>Quick Add Person</DialogTitle>
                    <DialogDescription>
                      Create a new person and add them to the guest list.
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
                      <p className="text-sm text-red-600">{quickAddError}</p>
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
                      <Button type="submit" disabled={isPending} className="cursor-pointer">
                        {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Add Person
                      </Button>
                    </DialogFooter>
                  </form>
                </DialogContent>
              </Dialog>

              {/* Add Existing Person */}
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowSearch(!showSearch)}
                className="cursor-pointer"
              >
                <Plus className="mr-2 h-4 w-4" />
                Add Existing
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Person Search */}
          {showSearch && (
            <div className="rounded-lg border bg-muted/30 p-4">
              <Label className="mb-2 block text-sm font-medium">
                Search People
              </Label>
              <div className="relative">
                <Search className="text-muted-foreground absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2" />
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
                        onClick={() => handleAddPerson(person)}
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
                        <Plus className="h-4 w-4 text-muted-foreground" />
                      </button>
                    ))}
                  </div>
                )}
                {searching && (
                  <p className="text-muted-foreground mt-1 text-xs">
                    Searching...
                  </p>
                )}
                {searchQuery.length >= 2 && !searching && searchResults.length === 0 && (
                  <p className="text-muted-foreground mt-1 text-xs">
                    No results found. Try &quot;Quick Add Person&quot; to create a new one.
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Guest Table */}
          {guests.length === 0 ? (
            <p className="text-muted-foreground py-8 text-center text-sm">
              No guests added yet. Add people from your database or use Quick Add
              to create new people.
            </p>
          ) : (
            <div className="divide-y">
              {/* Table header */}
              <div className="grid grid-cols-12 gap-4 pb-2 text-xs font-medium text-muted-foreground uppercase">
                <div className="col-span-4">Name</div>
                <div className="col-span-3">Contact</div>
                <div className="col-span-2">RSVP</div>
                <div className="col-span-2">Email Status</div>
                <div className="col-span-1 text-right">Actions</div>
              </div>

              {guests.map((guest) => {
                const tracking = emailTracking?.[guest.personId];
                const trackingConfig = tracking
                  ? emailStatusIcons[tracking.status] ?? emailStatusIcons.pending
                  : null;

                const rsvp = guest.responseStatus
                  ? rsvpBadge[guest.responseStatus]
                  : null;

                return (
                  <div
                    key={guest.id}
                    className="grid grid-cols-12 items-center gap-4 py-3"
                  >
                    {/* Name */}
                    <div className="col-span-4">
                      <Link
                        href={`/people/${guest.personId}`}
                        className="cursor-pointer text-sm font-medium hover:underline"
                      >
                        {guest.firstName} {guest.lastName}
                      </Link>
                    </div>

                    {/* Contact */}
                    <div className="col-span-3 text-sm text-muted-foreground truncate">
                      {guest.email || guest.phone || "—"}
                    </div>

                    {/* RSVP Status */}
                    <div className="col-span-2">
                      <button
                        type="button"
                        className="cursor-pointer"
                        onClick={() =>
                          handleRsvpToggle(guest.personId, guest.responseStatus)
                        }
                        disabled={isPending}
                        title="Click to change RSVP status"
                      >
                        {rsvp ? (
                          <Badge className={rsvp.className} variant="secondary">
                            <rsvp.icon className="mr-1 h-3 w-3" />
                            {rsvp.label}
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-muted-foreground">
                            <Clock className="mr-1 h-3 w-3" />
                            Pending
                          </Badge>
                        )}
                      </button>
                    </div>

                    {/* Email Tracking */}
                    <div className="col-span-2">
                      {trackingConfig ? (
                        <span
                          className={`flex items-center gap-1 text-xs ${trackingConfig.color}`}
                          title={`Email: ${trackingConfig.label}`}
                        >
                          <trackingConfig.icon className="h-3.5 w-3.5" />
                          {trackingConfig.label}
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </div>

                    {/* Actions */}
                    <div className="col-span-1 flex justify-end">
                      <button
                        type="button"
                        className="cursor-pointer rounded-md p-1 text-muted-foreground hover:bg-red-50 hover:text-red-600"
                        onClick={() => handleRemovePerson(guest.personId)}
                        disabled={isPending}
                        title="Remove from guest list"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
