import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import type { MeetingStatus } from "@/db/schema";
import type { MeetingWithCounts } from "@/lib/vision-meetings/types";
import { CalendarDays, MapPin, Users } from "lucide-react";
import Link from "next/link";

interface MeetingCardProps {
  meeting: MeetingWithCounts;
  isPast?: boolean;
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
    weekday: "short",
    month: "short",
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

export function MeetingCard({ meeting, isPast }: MeetingCardProps) {
  const locationDisplay =
    meeting.locationName || meeting.location?.name || "No location set";
  const status = meeting.status as MeetingStatus;

  return (
    <Link
      href={`/vision-meetings/${meeting.id}`}
      className="block cursor-pointer"
    >
      <Card className="hover:border-primary/50 h-full transition-colors">
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between">
            <div className="space-y-1">
              <p className="text-muted-foreground text-sm">
                {formatMeetingDate(meeting.datetime)} &bull;{" "}
                {formatMeetingTime(meeting.datetime)}
              </p>
              <h3 className="text-lg leading-tight font-semibold">
                Vision Meeting #{meeting.meetingNumber}
              </h3>
            </div>
            <Badge className={statusColors[status]} variant="secondary">
              {statusLabels[status]}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="text-muted-foreground flex items-center gap-2 text-sm">
            <MapPin className="h-4 w-4 shrink-0" />
            <span className="truncate">{locationDisplay}</span>
          </div>
          {isPast && meeting.actualAttendance != null ? (
            <div className="text-muted-foreground flex items-center gap-2 text-sm">
              <Users className="h-4 w-4 shrink-0" />
              <span>
                {meeting.actualAttendance} attended
                {meeting.newAttendees > 0 && (
                  <span className="text-green-600 dark:text-green-400">
                    {" "}
                    ({meeting.newAttendees} new)
                  </span>
                )}
              </span>
            </div>
          ) : meeting.estimatedAttendance ? (
            <div className="text-muted-foreground flex items-center gap-2 text-sm">
              <Users className="h-4 w-4 shrink-0" />
              <span>~{meeting.estimatedAttendance} estimated</span>
            </div>
          ) : null}
          {!isPast && (
            <div className="text-muted-foreground flex items-center gap-2 text-sm">
              <CalendarDays className="h-4 w-4 shrink-0" />
              <span>{getDaysUntil(meeting.datetime)}</span>
            </div>
          )}
        </CardContent>
      </Card>
    </Link>
  );
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
