import { Badge } from "@/components/ui/badge";
import { CalendarDays, MapPin, Users, Clock } from "lucide-react";
import type { MeetingWithCounts } from "@/lib/meetings/types";
import type { MeetingStatus, MeetingType } from "@/db/schema";

interface MeetingHeaderProps {
  meeting: MeetingWithCounts;
}

const statusColors: Record<MeetingStatus, string> = {
  planning: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
  ready: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  in_progress: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
  completed: "bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400",
  cancelled: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
};

const statusLabels: Record<MeetingStatus, string> = {
  planning: "Planning", ready: "Ready", in_progress: "In Progress",
  completed: "Completed", cancelled: "Cancelled",
};

const typeColors: Record<MeetingType, string> = {
  vision_meeting: "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-400",
  orientation: "bg-teal-100 text-teal-800 dark:bg-teal-900/30 dark:text-teal-400",
  team_meeting: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400",
};

const typeLabels: Record<MeetingType, string> = {
  vision_meeting: "Vision Meeting", orientation: "Orientation", team_meeting: "Team Meeting",
};

function formatMeetingDate(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long", month: "long", day: "numeric", year: "numeric",
  }).format(new Date(date));
}

function formatMeetingTime(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric", minute: "2-digit", hour12: true,
  }).format(new Date(date));
}

function getTimeRelative(date: Date): string {
  const now = new Date();
  const meetingDate = new Date(date);
  const diffMs = meetingDate.getTime() - now.getTime();
  const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Tomorrow";
  if (diffDays > 1) return `In ${diffDays} days`;
  if (diffDays === -1) return "Yesterday";
  return `${Math.abs(diffDays)} days ago`;
}

function getMeetingTitle(meeting: MeetingWithCounts): string {
  if (meeting.type === "vision_meeting" && meeting.meetingNumber) {
    return `Vision Meeting #${meeting.meetingNumber}`;
  }
  if (meeting.type === "team_meeting" && meeting.teamName) {
    return meeting.title || `${meeting.teamName} Meeting`;
  }
  return meeting.title || typeLabels[meeting.type];
}

export function MeetingHeader({ meeting }: MeetingHeaderProps) {
  const status = meeting.status as MeetingStatus;
  const locationDisplay = meeting.locationName || meeting.location?.name || "No location set";
  const addressDisplay = meeting.locationAddress || meeting.location?.address || "";
  const isPast = new Date(meeting.datetime) < new Date();

  return (
    <div className="space-y-4 pb-4">
      <div className="flex items-start justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2 mb-1">
            <Badge className={typeColors[meeting.type]} variant="secondary">
              {typeLabels[meeting.type]}
            </Badge>
            {meeting.teamName && meeting.type === "team_meeting" && (
              <span className="text-sm text-muted-foreground">{meeting.teamName}</span>
            )}
          </div>
          <h1 className="text-2xl font-bold tracking-tight">
            {getMeetingTitle(meeting)}
          </h1>
          <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <CalendarDays className="h-4 w-4" />
              {formatMeetingDate(meeting.datetime)}
            </span>
            <span className="flex items-center gap-1.5">
              <Clock className="h-4 w-4" />
              {formatMeetingTime(meeting.datetime)}
            </span>
            <span className="flex items-center gap-1.5">
              <MapPin className="h-4 w-4" />
              {locationDisplay}
              {addressDisplay && ` - ${addressDisplay}`}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium text-muted-foreground">
            {getTimeRelative(meeting.datetime)}
          </span>
          <Badge className={statusColors[status]} variant="secondary">
            {statusLabels[status]}
          </Badge>
        </div>
      </div>

      {isPast && meeting.actualAttendance != null && (
        <div className="flex gap-6 text-sm">
          <div className="flex items-center gap-1.5">
            <Users className="h-4 w-4 text-muted-foreground" />
            <span className="font-medium">{meeting.actualAttendance}</span>
            <span className="text-muted-foreground">attended</span>
          </div>
          {meeting.newAttendees > 0 && (
            <div>
              <span className="font-medium text-green-600 dark:text-green-400">{meeting.newAttendees}</span>
              <span className="text-muted-foreground"> new</span>
            </div>
          )}
          {meeting.returningAttendees > 0 && (
            <div>
              <span className="font-medium">{meeting.returningAttendees}</span>
              <span className="text-muted-foreground"> returning</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
