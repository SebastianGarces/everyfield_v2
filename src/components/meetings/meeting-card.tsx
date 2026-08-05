import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { CalendarDays, MapPin, Users } from "lucide-react";
// Same zone-pinned formatter the meeting detail page uses, so a card and the
// page it links to never show different times. See src/lib/datetime.ts.
import { formatDate, formatRelativeDay, formatTime } from "@/lib/datetime";
import type { MeetingWithCounts } from "@/lib/meetings/types";
import type { MeetingStatus, MeetingType } from "@/db/schema";

interface MeetingCardProps {
  meeting: MeetingWithCounts;
  isPast?: boolean;
  /** Render the card as inert markup instead of a link — for presentational
   *  embeds (the marketing page), where nothing may be clickable, focusable or
   *  prefetchable. Absent, as in the app, this card is unchanged. */
  linkStatic?: boolean;
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

const typeColors: Record<MeetingType, string> = {
  vision_meeting:
    "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-400",
  orientation:
    "bg-teal-100 text-teal-800 dark:bg-teal-900/30 dark:text-teal-400",
  team_meeting:
    "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400",
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

export function MeetingCard({ meeting, isPast, linkStatic }: MeetingCardProps) {
  const locationDisplay =
    meeting.locationName || meeting.location?.name || "No location set";
  const status = meeting.status as MeetingStatus;

  const card = (
    <Card className="hover:border-primary/50 h-full transition-colors">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Badge className={typeColors[meeting.type]} variant="secondary">
                {typeLabels[meeting.type]}
              </Badge>
              {meeting.teamName && meeting.type === "team_meeting" && (
                <span className="text-muted-foreground text-xs">
                  {meeting.teamName}
                </span>
              )}
            </div>
            <p className="text-muted-foreground text-sm">
              {formatDate(meeting.datetime, "short")} &bull;{" "}
              {formatTime(meeting.datetime)}
            </p>
            <h3 className="text-lg leading-tight font-semibold">
              {getMeetingTitle(meeting)}
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
            <span>{formatRelativeDay(meeting.datetime)}</span>
          </div>
        )}
      </CardContent>
    </Card>
  );

  // A span with the identical className, not an href-less anchor: a
  // presentational embed should carry no app URL at all, so there is nothing
  // left to prefetch by construction. `block` is on the className, so the box
  // is identical either way.
  return linkStatic ? (
    <span className="block cursor-pointer">{card}</span>
  ) : (
    <Link href={`/meetings/${meeting.id}`} className="block cursor-pointer">
      {card}
    </Link>
  );
}
