"use client";

import { useState, useTransition, useCallback } from "react";
import Link from "next/link";
import {
  Plus,
  Send,
  Loader2,
  Mail,
  CheckCheck,
  Eye,
  Search,
  X,
  ExternalLink,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  createInvitationAction,
  updateInvitationStatusAction,
} from "@/app/(dashboard)/meetings/actions";
import { searchPeopleAction } from "@/app/(dashboard)/communication/actions";
import { InvitationLeaderboard } from "./invitation-leaderboard";
import type { Invitation, Person } from "@/db/schema";
import type {
  InvitationLeaderboardEntry,
  InvitationSummary,
} from "@/lib/meetings/types";

interface EmailTrackingData {
  status: string;
  deliveredAt: string | null;
  openedAt: string | null;
}

interface InvitationTrackerProps {
  meetingId: string;
  invitations: (Invitation & { inviterName: string })[];
  leaderboard: InvitationLeaderboardEntry[];
  summary: InvitationSummary;
  coreGroupMembers: Person[];
  emailTracking?: Record<string, EmailTrackingData>;
}

const statusColors: Record<string, string> = {
  invited: "bg-yellow-100 text-yellow-800",
  confirmed: "bg-green-100 text-green-800",
  maybe: "bg-blue-100 text-blue-800",
  declined: "bg-red-100 text-red-800",
  attended: "bg-purple-100 text-purple-800",
  no_show: "bg-gray-100 text-gray-800",
};

const emailStatusIcons: Record<
  string,
  { icon: typeof Mail; color: string; label: string }
> = {
  pending: { icon: Mail, color: "text-gray-400", label: "Pending" },
  sent: { icon: Mail, color: "text-blue-500", label: "Sent" },
  delivered: {
    icon: CheckCheck,
    color: "text-green-500",
    label: "Delivered",
  },
  opened: { icon: Eye, color: "text-emerald-600", label: "Opened" },
  clicked: { icon: Eye, color: "text-teal-600", label: "Clicked" },
  bounced: { icon: Mail, color: "text-red-500", label: "Bounced" },
  failed: { icon: Mail, color: "text-red-500", label: "Failed" },
};

interface PersonResult {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
}

export function InvitationTracker({
  meetingId,
  invitations: invitationsList,
  leaderboard,
  summary,
  coreGroupMembers,
  emailTracking,
}: InvitationTrackerProps) {
  const [isPending, startTransition] = useTransition();
  const [showAddForm, setShowAddForm] = useState(false);
  const [selectedInviter, setSelectedInviter] = useState("");

  // Person picker state
  const [inviteeQuery, setInviteeQuery] = useState("");
  const [inviteeResults, setInviteeResults] = useState<PersonResult[]>([]);
  const [selectedInvitee, setSelectedInvitee] = useState<PersonResult | null>(
    null
  );
  const [searching, setSearching] = useState(false);

  // Already-invited person IDs (to filter search results)
  const invitedPersonIds = new Set(
    invitationsList.filter((inv) => inv.inviteeId).map((inv) => inv.inviteeId!)
  );

  const handleInviteeSearch = useCallback(
    async (value: string) => {
      setInviteeQuery(value);
      if (value.length < 2) {
        setInviteeResults([]);
        return;
      }
      setSearching(true);
      try {
        const people = await searchPeopleAction(value);
        // Filter out already-invited people
        setInviteeResults(
          people.filter((p) => !invitedPersonIds.has(p.id))
        );
      } catch {
        setInviteeResults([]);
      } finally {
        setSearching(false);
      }
    },
    [invitedPersonIds]
  );

  const handleSelectInvitee = (person: PersonResult) => {
    setSelectedInvitee(person);
    setInviteeQuery("");
    setInviteeResults([]);
  };

  const handleClearInvitee = () => {
    setSelectedInvitee(null);
  };

  const handleAddInvitation = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedInviter || !selectedInvitee) return;
    const formData = new FormData();
    formData.set("inviterId", selectedInviter);
    formData.set("inviteeId", selectedInvitee.id);
    startTransition(async () => {
      await createInvitationAction(meetingId, formData);
      setSelectedInvitee(null);
    });
  };

  const handleStatusChange = (invitationId: string, newStatus: string) => {
    const formData = new FormData();
    formData.set("status", newStatus);
    startTransition(async () => {
      await updateInvitationStatusAction(invitationId, formData);
    });
  };

  // Build "Send Invitations" URL with invitees who haven't been successfully emailed
  const sendableInvitees = invitationsList.filter((inv) => {
    if (!inv.inviteeId) return false;
    const tracking = emailTracking?.[inv.inviteeId];
    // Include if no tracking (never emailed) or if previous send failed
    return !tracking || tracking.status === "failed";
  });

  const sendInvitationsUrl =
    sendableInvitees.length > 0
      ? `/communication/compose?meetingId=${meetingId}&recipientIds=${sendableInvitees.map((inv) => inv.inviteeId).join(",")}`
      : null;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      {/* Summary Stats */}
      <div className="grid grid-cols-3 gap-4 md:grid-cols-6">
        <Card>
          <CardContent className="pt-4 text-center">
            <p className="text-xl font-bold">{summary.total}</p>
            <p className="text-xs text-muted-foreground">Invited</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 text-center">
            <p className="text-xl font-bold text-green-600">
              {summary.confirmed}
            </p>
            <p className="text-xs text-muted-foreground">Confirmed</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 text-center">
            <p className="text-xl font-bold text-blue-600">{summary.maybe}</p>
            <p className="text-xs text-muted-foreground">Maybe</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 text-center">
            <p className="text-xl font-bold text-red-600">
              {summary.declined}
            </p>
            <p className="text-xs text-muted-foreground">Declined</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 text-center">
            <p className="text-xl font-bold text-purple-600">
              {summary.attended}
            </p>
            <p className="text-xs text-muted-foreground">Attended</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 text-center">
            <p className="text-xl font-bold text-gray-600">{summary.noShow}</p>
            <p className="text-xs text-muted-foreground">No Show</p>
          </CardContent>
        </Card>
      </div>

      {/* Leaderboard */}
      <InvitationLeaderboard leaderboard={leaderboard} />

      {/* Invitations Card */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Invitations</CardTitle>
            <div className="flex items-center gap-2">
              {sendInvitationsUrl && (
                <Button variant="default" size="sm" asChild>
                  <Link
                    href={sendInvitationsUrl}
                    className="cursor-pointer"
                  >
                    <Mail className="mr-2 h-4 w-4" />
                    Send Invitations ({sendableInvitees.length})
                  </Link>
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowAddForm(!showAddForm)}
                className="cursor-pointer"
              >
                <Plus className="mr-2 h-4 w-4" />
                Add Invitee
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {showAddForm && (
            <form
              onSubmit={handleAddInvitation}
              className="space-y-3 rounded-lg border bg-muted/30 p-4"
            >
              <div className="grid grid-cols-2 gap-4">
                {/* Inviter (core group member) */}
                <div className="space-y-2">
                  <Label>Invited By *</Label>
                  <Select
                    value={selectedInviter}
                    onValueChange={setSelectedInviter}
                  >
                    <SelectTrigger className="cursor-pointer">
                      <SelectValue placeholder="Select member" />
                    </SelectTrigger>
                    <SelectContent>
                      {coreGroupMembers.map((m) => (
                        <SelectItem
                          key={m.id}
                          value={m.id}
                          className="cursor-pointer"
                        >
                          {m.firstName} {m.lastName}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Person picker for invitee */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label>Invitee *</Label>
                    <Link
                      href="/people/new"
                      target="_blank"
                      className="text-primary flex cursor-pointer items-center gap-1 text-xs hover:underline"
                    >
                      <ExternalLink className="h-3 w-3" />
                      Quick Add Person
                    </Link>
                  </div>

                  {selectedInvitee ? (
                    <div className="flex items-center justify-between rounded-md border bg-white px-3 py-2">
                      <div>
                        <span className="text-sm font-medium">
                          {selectedInvitee.firstName}{" "}
                          {selectedInvitee.lastName}
                        </span>
                        {selectedInvitee.email && (
                          <span className="text-muted-foreground ml-2 text-xs">
                            {selectedInvitee.email}
                          </span>
                        )}
                      </div>
                      <button
                        type="button"
                        className="cursor-pointer rounded-full p-1 hover:bg-gray-100"
                        onClick={handleClearInvitee}
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ) : (
                    <div className="relative">
                      <Search className="text-muted-foreground absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2" />
                      <Input
                        value={inviteeQuery}
                        onChange={(e) => handleInviteeSearch(e.target.value)}
                        placeholder="Search people by name..."
                        className="pl-10"
                      />
                      {/* Search results dropdown */}
                      {inviteeResults.length > 0 && (
                        <div className="absolute z-10 mt-1 max-h-48 w-full overflow-auto rounded-md border bg-white shadow-sm">
                          {inviteeResults.map((person) => (
                            <button
                              key={person.id}
                              type="button"
                              className="flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left text-sm hover:bg-gray-50"
                              onClick={() => handleSelectInvitee(person)}
                            >
                              <span className="font-medium">
                                {person.firstName} {person.lastName}
                              </span>
                              {person.email && (
                                <span className="text-muted-foreground text-xs">
                                  {person.email}
                                </span>
                              )}
                            </button>
                          ))}
                        </div>
                      )}
                      {searching && (
                        <p className="text-muted-foreground mt-1 text-xs">
                          Searching...
                        </p>
                      )}
                    </div>
                  )}
                </div>
              </div>

              <Button
                type="submit"
                size="sm"
                disabled={
                  isPending || !selectedInviter || !selectedInvitee
                }
                className="cursor-pointer"
              >
                {isPending && (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                )}
                <Send className="mr-2 h-4 w-4" />
                Record Invitation
              </Button>
            </form>
          )}

          {/* Invitation List */}
          {invitationsList.length === 0 ? (
            <p className="text-muted-foreground py-4 text-center text-sm">
              No invitations tracked yet.
            </p>
          ) : (
            <div className="divide-y">
              {invitationsList.map((inv) => {
                const tracking =
                  inv.inviteeId && emailTracking?.[inv.inviteeId];
                const trackingConfig = tracking
                  ? emailStatusIcons[tracking.status] ??
                    emailStatusIcons.pending
                  : null;

                return (
                  <div
                    key={inv.id}
                    className="flex items-center justify-between py-3"
                  >
                    <div className="flex items-center gap-3">
                      <div>
                        <p className="text-sm font-medium">
                          {inv.inviteeName || "Unnamed invitee"}
                        </p>
                        <p className="text-muted-foreground text-xs">
                          Invited by {inv.inviterName}
                        </p>
                      </div>
                      {trackingConfig && (
                        <span
                          className={`flex items-center gap-1 text-xs ${trackingConfig.color}`}
                          title={`Email: ${trackingConfig.label}`}
                        >
                          <trackingConfig.icon className="h-3.5 w-3.5" />
                          {trackingConfig.label}
                        </span>
                      )}
                    </div>
                    <Select
                      value={inv.status}
                      onValueChange={(v) => handleStatusChange(inv.id, v)}
                    >
                      <SelectTrigger className="w-32 cursor-pointer">
                        <Badge
                          className={statusColors[inv.status] ?? ""}
                          variant="secondary"
                        >
                          {inv.status.replace("_", " ")}
                        </Badge>
                      </SelectTrigger>
                      <SelectContent>
                        {[
                          "invited",
                          "confirmed",
                          "maybe",
                          "declined",
                          "attended",
                          "no_show",
                        ].map((s) => (
                          <SelectItem
                            key={s}
                            value={s}
                            className="cursor-pointer"
                          >
                            {s.replace("_", " ")}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
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
