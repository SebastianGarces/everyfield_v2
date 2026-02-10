import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { CalendarDays, MapPin, Users } from "lucide-react";
import type { MeetingWithCounts } from "@/lib/meetings/types";
import type { MeetingStatus, MeetingType } from "@/db/schema";

interface MeetingCardProps {
  meeting: MeetingWithCounts;
  isPast?: boolean;
}

const statusColors: Record<MeetingStatus, string> = {
  planning: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
  ready: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  in_progress: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
  completed: "bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400",
  cancelled: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
};

const statusLabels: Record<MeetingStatus, string> = {
  planning: "Planning",
  ready: "Ready",
  in_progress: "In Progress",
  completed: "Completed",
  cancelled: "Cancelled",
};

const typeColors: Record<MeetingType, string> = {
  vision_meeting: "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-400",
  orientation: "bg-teal-100 text-teal-800 dark:bg-teal-900/30 dark:text-teal-400",
  team_meeting: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400",
};

const typeLabels: Record<MeetingType, string> = {
  vision_meeting: "Vision",
  orientation: "Orientation",
  team_meeting: "Team",
};

function getMeetingTitle(meeting: MeetingWithCounts): string {
  if (meeting.type === "vision_meeting" && meeting.meetingNumber) {
    return `Vision Meeting #${meeting.meetingNumber}`;
  }
  if (meeting.type === "team_meeting" && meeting.teamName) {
    return meeting.title || `${meeting.teamName} Meeting`;
  }
  return meeting.title || typeLabels[meeting.type] + " Meeting";
}

function formatMeetingDate(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short", month: "short", day: "numeric", year: "numeric",
  }).format(new Date(date));
}

function formatMeetingTime(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric", minute: "2-digit", hour12: true,
  }).format(new Date(date));
}

function getDaysUntil(date: Date): string {
  const now = new Date();
  const meetingDate = new Date(date);
  const diffMs = meetingDate.getTime() - now.getTime();
  const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Tomorrow";
  if (diffDays < 0) return `${Math.abs(diffDays)} days ago`;
  return `In ${diffDays} days`;
}

export function MeetingCard({ meeting, isPast }: MeetingCardProps) {
  const locationDisplay = meeting.locationName || meeting.location?.name || "No location set";
  const status = meeting.status as MeetingStatus;

  return (
    <Link href={`/meetings/${meeting.id}`} className="cursor-pointer block">
      <Card className="hover:border-primary/50 transition-colors h-full">
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <Badge className={typeColors[meeting.type]} variant="secondary">
                  {typeLabels[meeting.type]}
                </Badge>
                {meeting.teamName && meeting.type === "team_meeting" && (
                  <span className="text-xs text-muted-foreground">{meeting.teamName}</span>
                )}
              </div>
              <p className="text-sm text-muted-foreground">
                {formatMeetingDate(meeting.datetime)} &bull; {formatMeetingTime(meeting.datetime)}
              </p>
              <h3 className="font-semibold text-lg leading-tight">
                {getMeetingTitle(meeting)}
              </h3>
            </div>
            <Badge className={statusColors[status]} variant="secondary">
              {statusLabels[status]}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <MapPin className="h-4 w-4 shrink-0" />
            <span className="truncate">{locationDisplay}</span>
          </div>
          {isPast && meeting.actualAttendance != null ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Users className="h-4 w-4 shrink-0" />
              <span>
                {meeting.actualAttendance} attended
                {meeting.newAttendees > 0 && (
                  <span className="text-green-600 dark:text-green-400"> ({meeting.newAttendees} new)</span>
                )}
              </span>
            </div>
          ) : meeting.estimatedAttendance ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Users className="h-4 w-4 shrink-0" />
              <span>~{meeting.estimatedAttendance} estimated</span>
            </div>
          ) : null}
          {!isPast && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <CalendarDays className="h-4 w-4 shrink-0" />
              <span>{getDaysUntil(meeting.datetime)}</span>
            </div>
          )}
        </CardContent>
      </Card>
    </Link>
  );
}
