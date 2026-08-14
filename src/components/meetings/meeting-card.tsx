import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { CalendarDays, MapPin, Users } from "lucide-react";
// Same zone-pinned formatter the meeting detail page uses, so a card and the
// page it links to never show different times. See src/lib/datetime.ts.
import { formatDate, formatRelativeDay, formatTime } from "@/lib/datetime";
import type { MeetingWithCounts } from "@/lib/meetings/types";
// The one meeting display vocabulary — labels, badge tints and the title. This
// card and the detail header it links to render the same values from the same
// module, so the two cannot call one meeting two things. The card once had its
// own shorter table ("Vision", "Team") and its own title fallback
// ("Orientation Meeting"), which is exactly the drift that removed.
// See src/lib/meetings/labels.ts.
import {
  MEETING_STATUS_BADGE_CLASSES,
  MEETING_STATUS_LABELS,
  MEETING_TYPE_BADGE_CLASSES,
  MEETING_TYPE_LABELS,
  meetingDisplayTitle,
} from "@/lib/meetings/labels";

interface MeetingCardProps {
  meeting: MeetingWithCounts;
  isPast?: boolean;
  /** Render the card as inert markup instead of a link — for presentational
   *  embeds (the marketing page), where nothing may be clickable, focusable or
   *  prefetchable. Absent, as in the app, this card is unchanged. */
  linkStatic?: boolean;
}

export function MeetingCard({ meeting, isPast, linkStatic }: MeetingCardProps) {
  const locationDisplay =
    meeting.locationName || meeting.location?.name || "No location set";
  const status = meeting.status;

  const card = (
    <Card className="hover:border-primary/50 h-full transition-colors">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Badge
                className={MEETING_TYPE_BADGE_CLASSES[meeting.type]}
                variant="secondary"
              >
                {MEETING_TYPE_LABELS[meeting.type]}
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
              {meetingDisplayTitle(meeting)}
            </h3>
          </div>
          <Badge
            className={MEETING_STATUS_BADGE_CLASSES[status]}
            variant="secondary"
          >
            {MEETING_STATUS_LABELS[status]}
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
