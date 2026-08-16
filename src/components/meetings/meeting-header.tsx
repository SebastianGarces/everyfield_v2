import { Badge } from "@/components/ui/badge";
import { CalendarDays, MapPin, Users, Clock } from "lucide-react";
// Shares one zone-pinned formatter with the detail card below it, so the two
// cannot disagree about when the meeting is. See src/lib/datetime.ts.
import { formatDate, formatRelativeDay, formatTime } from "@/lib/datetime";
import type { MeetingWithCounts } from "@/lib/meetings/types";
// The one meeting display vocabulary — labels, badge tints and the title. The
// card beside this header renders the same values from the same module, so the
// two cannot call one meeting two things. See src/lib/meetings/labels.ts.
import {
  MEETING_STATUS_BADGE_CLASSES,
  MEETING_STATUS_LABELS,
  MEETING_TYPE_BADGE_CLASSES,
  MEETING_TYPE_LABELS,
  meetingDisplayTitle,
} from "@/lib/meetings/labels";

interface MeetingHeaderProps {
  meeting: MeetingWithCounts;
  /** Church IANA zone for the relative-day badge. Meeting wall-clock date and
   *  time stay on `APP_TIME_ZONE`. */
  timeZone?: string;
}

export function MeetingHeader({ meeting, timeZone }: MeetingHeaderProps) {
  const status = meeting.status;
  const locationDisplay =
    meeting.locationName || meeting.location?.name || "No location set";
  const addressDisplay =
    meeting.locationAddress || meeting.location?.address || "";
  const isPast = new Date(meeting.datetime) < new Date();

  return (
    <div className="space-y-4 pb-4">
      <div className="flex items-start justify-between">
        <div className="space-y-1">
          <div className="mb-1 flex items-center gap-2">
            <Badge
              className={MEETING_TYPE_BADGE_CLASSES[meeting.type]}
              variant="secondary"
            >
              {MEETING_TYPE_LABELS[meeting.type]}
            </Badge>
            {meeting.teamName && meeting.type === "team_meeting" && (
              <span className="text-muted-foreground text-sm">
                {meeting.teamName}
              </span>
            )}
          </div>
          <h1 className="text-2xl font-bold tracking-tight">
            {meetingDisplayTitle(meeting)}
          </h1>
          <div className="text-muted-foreground flex flex-wrap items-center gap-4 text-sm">
            <span className="flex items-center gap-1.5">
              <CalendarDays className="h-4 w-4" />
              {formatDate(meeting.datetime)}
            </span>
            <span className="flex items-center gap-1.5">
              <Clock className="h-4 w-4" />
              {formatTime(meeting.datetime)}
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
            {formatRelativeDay(meeting.datetime, new Date(), timeZone)}
          </span>
          <Badge
            className={MEETING_STATUS_BADGE_CLASSES[status]}
            variant="secondary"
          >
            {MEETING_STATUS_LABELS[status]}
          </Badge>
        </div>
      </div>

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
