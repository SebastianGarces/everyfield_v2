"use client";

import {
  createInvitationAction,
  updateInvitationStatusAction,
} from "@/app/(dashboard)/vision-meetings/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Invitation, Person } from "@/db/schema";
import type {
  InvitationLeaderboardEntry,
  InvitationSummary,
} from "@/lib/vision-meetings/types";
import { Loader2, Plus, Send } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { InvitationLeaderboard } from "./invitation-leaderboard";

interface InvitationTrackerProps {
  meetingId: string;
  invitations: (Invitation & { inviterName: string })[];
  leaderboard: InvitationLeaderboardEntry[];
  summary: InvitationSummary;
  coreGroupMembers: Person[];
}

const statusColors: Record<string, string> = {
  invited: "bg-yellow-100 text-yellow-800",
  confirmed: "bg-green-100 text-green-800",
  maybe: "bg-blue-100 text-blue-800",
  declined: "bg-red-100 text-red-800",
  attended: "bg-purple-100 text-purple-800",
  no_show: "bg-gray-100 text-gray-800",
};

export function InvitationTracker({
  meetingId,
  invitations: invitationsList,
  leaderboard,
  summary,
  coreGroupMembers,
}: InvitationTrackerProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [showAddForm, setShowAddForm] = useState(false);
  const [selectedInviter, setSelectedInviter] = useState("");
  const [inviteeName, setInviteeName] = useState("");

  const handleAddInvitation = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedInviter) return;
    const formData = new FormData();
    formData.set("inviterId", selectedInviter);
    if (inviteeName) formData.set("inviteeName", inviteeName);
    startTransition(async () => {
      await createInvitationAction(meetingId, formData);
      setInviteeName("");
      router.refresh();
    });
  };

  const handleStatusChange = (invitationId: string, newStatus: string) => {
    const formData = new FormData();
    formData.set("status", newStatus);
    startTransition(async () => {
      await updateInvitationStatusAction(invitationId, formData);
      router.refresh();
    });
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      {/* Summary Stats */}
      <div className="grid grid-cols-3 gap-4 md:grid-cols-6">
        <Card>
          <CardContent className="pt-4 text-center">
            <p className="text-xl font-bold">{summary.total}</p>
            <p className="text-muted-foreground text-xs">Invited</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 text-center">
            <p className="text-xl font-bold text-green-600">
              {summary.confirmed}
            </p>
            <p className="text-muted-foreground text-xs">Confirmed</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 text-center">
            <p className="text-xl font-bold text-blue-600">{summary.maybe}</p>
            <p className="text-muted-foreground text-xs">Maybe</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 text-center">
            <p className="text-xl font-bold text-red-600">{summary.declined}</p>
            <p className="text-muted-foreground text-xs">Declined</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 text-center">
            <p className="text-xl font-bold text-purple-600">
              {summary.attended}
            </p>
            <p className="text-muted-foreground text-xs">Attended</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 text-center">
            <p className="text-xl font-bold text-gray-600">{summary.noShow}</p>
            <p className="text-muted-foreground text-xs">No Show</p>
          </CardContent>
        </Card>
      </div>

      {/* Leaderboard */}
      <InvitationLeaderboard leaderboard={leaderboard} />

      {/* Add Invitation */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Invitations</CardTitle>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowAddForm(!showAddForm)}
              className="cursor-pointer"
            >
              <Plus className="mr-2 h-4 w-4" />
              Add Invitation
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {showAddForm && (
            <form
              onSubmit={handleAddInvitation}
              className="bg-muted/30 space-y-3 rounded-lg border p-4"
            >
              <div className="grid grid-cols-2 gap-4">
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
                <div className="space-y-2">
                  <Label>Invitee Name</Label>
                  <Input
                    value={inviteeName}
                    onChange={(e) => setInviteeName(e.target.value)}
                    placeholder="Person invited"
                  />
                </div>
              </div>
              <Button
                type="submit"
                size="sm"
                disabled={isPending || !selectedInviter}
                className="cursor-pointer"
              >
                {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
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
              {invitationsList.map((inv) => (
                <div
                  key={inv.id}
                  className="flex items-center justify-between py-3"
                >
                  <div>
                    <p className="text-sm font-medium">
                      {inv.inviteeName || "Unnamed invitee"}
                    </p>
                    <p className="text-muted-foreground text-xs">
                      Invited by {inv.inviterName}
                    </p>
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
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
