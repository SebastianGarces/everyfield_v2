import { Badge } from "@/components/ui/badge";
import type { MeetingStatus } from "@/db/schema";
import type { MeetingWithCounts } from "@/lib/vision-meetings/types";
import { CalendarDays, Clock, MapPin, Users } from "lucide-react";

interface MeetingHeaderProps {
  meeting: MeetingWithCounts;
}

const statusColors: Record<MeetingStatus, string> = {
  planning:
    "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
  ready: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  in_progress:
    "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
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

function formatMeetingDate(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(new Date(date));
}

function formatMeetingTime(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
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

export function MeetingHeader({ meeting }: MeetingHeaderProps) {
  const status = meeting.status as MeetingStatus;
  const locationDisplay =
    meeting.locationName || meeting.location?.name || "No location set";
  const addressDisplay =
    meeting.locationAddress || meeting.location?.address || "";
  const isPast = new Date(meeting.datetime) < new Date();

  return (
    <div className="space-y-4 pb-4">
      <div className="flex items-start justify-between">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold tracking-tight">
            Vision Meeting #{meeting.meetingNumber}
          </h1>
          <div className="text-muted-foreground flex flex-wrap items-center gap-4 text-sm">
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
          <span className="text-muted-foreground text-sm font-medium">
            {getTimeRelative(meeting.datetime)}
          </span>
          <Badge className={statusColors[status]} variant="secondary">
            {statusLabels[status]}
          </Badge>
        </div>
      </div>

      {/* Quick stats */}
      {isPast && meeting.actualAttendance != null && (
        <div className="flex gap-6 text-sm">
          <div className="flex items-center gap-1.5">
            <Users className="text-muted-foreground h-4 w-4" />
            <span className="font-medium">{meeting.actualAttendance}</span>
            <span className="text-muted-foreground">attended</span>
          </div>
          {meeting.newAttendees > 0 && (
            <div>
              <span className="font-medium text-green-600 dark:text-green-400">
                {meeting.newAttendees}
              </span>
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
