"use client";

import { useState } from "react";
import { format } from "date-fns";
import {
  CalendarDays,
  Clock,
  ExternalLink,
  MapPin,
  Plus,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { createMeetingAction } from "@/app/(dashboard)/teams/actions";
import type { MeetingWithCounts } from "@/lib/meetings/types";
import Link from "next/link";

const SUBTYPE_LABELS: Record<string, string> = {
  regular: "Regular",
  training: "Training",
  planning: "Planning",
  special: "Special Event",
  rehearsal: "Rehearsal",
};

const SUBTYPE_COLORS: Record<string, string> = {
  regular: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-400",
  training: "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-400",
  planning: "bg-purple-100 text-purple-700 dark:bg-purple-950 dark:text-purple-400",
  special: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400",
  rehearsal: "bg-pink-100 text-pink-700 dark:bg-pink-950 dark:text-pink-400",
};

interface MeetingsTabProps {
  teamId: string;
  meetings: MeetingWithCounts[];
}

export function MeetingsTab({ teamId, meetings }: MeetingsTabProps) {
  const [addOpen, setAddOpen] = useState(false);
  const [addLoading, setAddLoading] = useState(false);

  const now = new Date();
  const upcomingMeetings = meetings.filter(
    (m) => new Date(m.datetime) >= now
  );
  const pastMeetings = meetings.filter(
    (m) => new Date(m.datetime) < now
  );

  async function handleCreate(formData: FormData) {
    setAddLoading(true);
    try {
      const result = await createMeetingAction(teamId, formData);
      if (result.success) {
        setAddOpen(false);
      }
    } finally {
      setAddLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Meetings</h2>
        <Dialog open={addOpen} onOpenChange={setAddOpen}>
          <DialogTrigger asChild>
            <Button variant="outline" size="sm" className="cursor-pointer">
              <Plus className="mr-2 h-4 w-4" />
              Schedule Meeting
            </Button>
          </DialogTrigger>
          <DialogContent>
            <form action={handleCreate}>
              <DialogHeader>
                <DialogTitle>Schedule Meeting</DialogTitle>
                <DialogDescription>
                  Create a new team meeting.
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 py-4">
                <div className="grid gap-2">
                  <Label htmlFor="title">Title</Label>
                  <Input
                    id="title"
                    name="title"
                    placeholder="e.g., Weekly Team Meeting"
                    required
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="meetingType">Type</Label>
                  <Select name="meetingType" defaultValue="regular">
                    <SelectTrigger className="cursor-pointer">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="regular" className="cursor-pointer">
                        Regular Team Meeting
                      </SelectItem>
                      <SelectItem value="training" className="cursor-pointer">
                        Training Session
                      </SelectItem>
                      <SelectItem value="planning" className="cursor-pointer">
                        Planning Meeting
                      </SelectItem>
                      <SelectItem value="special" className="cursor-pointer">
                        Special Event
                      </SelectItem>
                      <SelectItem value="rehearsal" className="cursor-pointer">
                        Pre-Launch Rehearsal
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="datetime">Date & Time</Label>
                  <Input
                    id="datetime"
                    name="datetime"
                    type="datetime-local"
                    required
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="grid gap-2">
                    <Label htmlFor="durationMinutes">Duration (minutes)</Label>
                    <Input
                      id="durationMinutes"
                      name="durationMinutes"
                      type="number"
                      placeholder="60"
                      min={1}
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="locationName">Location</Label>
                    <Input
                      id="locationName"
                      name="locationName"
                      placeholder="e.g., Room 201"
                    />
                  </div>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="notes">Agenda / Notes</Label>
                  <Textarea
                    id="notes"
                    name="notes"
                    placeholder="Meeting agenda..."
                    rows={3}
                  />
                </div>
              </div>
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setAddOpen(false)}
                  className="cursor-pointer"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={addLoading}
                  className="cursor-pointer"
                >
                  {addLoading ? "Scheduling..." : "Schedule Meeting"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {meetings.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center p-8 text-center">
            <CalendarDays className="text-muted-foreground h-10 w-10" />
            <h3 className="mt-3 font-medium">No meetings scheduled</h3>
            <p className="text-muted-foreground mt-1 max-w-sm text-sm">
              Schedule team meetings to coordinate and track attendance.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          {upcomingMeetings.length > 0 && (
            <div className="space-y-3">
              <h3 className="text-muted-foreground text-sm font-medium uppercase tracking-wide">
                Upcoming ({upcomingMeetings.length})
              </h3>
              {upcomingMeetings.map((meeting) => (
                <TeamMeetingCard key={meeting.id} meeting={meeting} />
              ))}
            </div>
          )}

          {pastMeetings.length > 0 && (
            <div className="space-y-3">
              <h3 className="text-muted-foreground text-sm font-medium uppercase tracking-wide">
                Past ({pastMeetings.length})
              </h3>
              {pastMeetings.map((meeting) => (
                <TeamMeetingCard key={meeting.id} meeting={meeting} isPast />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function TeamMeetingCard({
  meeting,
  isPast = false,
}: {
  meeting: MeetingWithCounts;
  isPast?: boolean;
}) {
  const meetingDate = new Date(meeting.datetime);
  const subtype = meeting.meetingSubtype ?? "regular";
  const typeColor =
    SUBTYPE_COLORS[subtype] ??
    "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300";

  return (
    <Link href={`/meetings/${meeting.id}`} className="cursor-pointer block">
      <Card className={cn("py-0 hover:border-primary/50 transition-colors", isPast && "opacity-60")}>
        <CardContent className="flex items-center gap-4 p-4">
          <div className="bg-muted flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-lg text-center">
            <span className="text-xs font-medium uppercase">
              {format(meetingDate, "MMM")}
            </span>
            <span className="text-lg font-bold leading-none">
              {format(meetingDate, "d")}
            </span>
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h4 className="truncate text-sm font-medium">
                {meeting.title || "Team Meeting"}
              </h4>
              <Badge className={cn("text-xs capitalize", typeColor)}>
                {SUBTYPE_LABELS[subtype] ?? subtype}
              </Badge>
            </div>
            <div className="text-muted-foreground mt-1 flex items-center gap-4 text-xs">
              <span className="flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {format(meetingDate, "h:mm a")}
                {meeting.durationMinutes &&
                  ` (${meeting.durationMinutes} min)`}
              </span>
              {meeting.locationName && (
                <span className="flex items-center gap-1">
                  <MapPin className="h-3 w-3" />
                  {meeting.locationName}
                </span>
              )}
            </div>
          </div>

          <ExternalLink className="h-4 w-4 text-muted-foreground shrink-0" />
        </CardContent>
      </Card>
    </Link>
  );
}
