// ============================================================================
// MeetingSummaryCards — the "what/where/who" tiles on a meeting's detail page.
//
// Presentational. It performs NO data access, owns no state and handles no
// events: it is handed the fields it renders and nothing else. The interactive
// host (meeting-details-client.tsx) keeps the action bar, the edit dialog and
// the delete confirmation; this file only draws the cards below them.
//
// It is split out so the same markup can be rendered from a typed fixture —
// the marketing page embeds the real card rather than a screenshot of it
// (issue #296). That is also why the prop is a narrow structural shape rather
// than `MeetingWithCounts`: a fixture should have to supply the seven fields
// these cards actually read, not a whole `church_meetings` row. Every real
// meeting row satisfies it.
// ============================================================================

import { CalendarDays, Clock, MapPin, Users } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
// These cards are SSR'd and then hydrated inside the client host, so they must
// format the meeting time through the shared zone-pinned helpers — a
// locale-default format renders one string on the server and another in the
// browser (React #418) and drifts away from the server-only header above it.
// See src/lib/datetime.ts.
import { formatDate, formatTime } from "@/lib/datetime";

/**
 * The subset of a meeting these cards read.
 *
 * Structurally satisfied by `MeetingWithCounts`; small enough to hand-write as
 * a fixture.
 */
export interface MeetingSummary {
  datetime: Date;
  /** Free-text venue typed on the meeting, which wins over the linked one. */
  locationName: string | null;
  locationAddress: string | null;
  location: { name: string; address: string | null } | null;
  actualAttendance: number | null;
  estimatedAttendance: number | null;
  notes: string | null;
}

export function MeetingSummaryCards({ meeting }: { meeting: MeetingSummary }) {
  const locationDisplay =
    meeting.locationName || meeting.location?.name || "Not set";
  const addressDisplay =
    meeting.locationAddress || meeting.location?.address || "";

  return (
    <div className="grid gap-6 md:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Date & Time</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex items-center gap-2 text-sm">
            <CalendarDays className="text-muted-foreground h-4 w-4" />
            <span>{formatDate(meeting.datetime)}</span>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <Clock className="text-muted-foreground h-4 w-4" />
            <span>{formatTime(meeting.datetime)}</span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Location</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex items-center gap-2 text-sm">
            <MapPin className="text-muted-foreground h-4 w-4" />
            <span>{locationDisplay}</span>
          </div>
          {addressDisplay && (
            <p className="text-muted-foreground pl-6 text-sm">
              {addressDisplay}
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Attendance</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex items-center gap-2 text-sm">
            <Users className="text-muted-foreground h-4 w-4" />
            {meeting.actualAttendance != null ? (
              <span>
                <span className="font-medium">{meeting.actualAttendance}</span>{" "}
                actual
                {meeting.estimatedAttendance && (
                  <span className="text-muted-foreground">
                    {" "}
                    / {meeting.estimatedAttendance} estimated
                  </span>
                )}
              </span>
            ) : (
              <span>
                {meeting.estimatedAttendance ? (
                  <>
                    <span className="font-medium">
                      ~{meeting.estimatedAttendance}
                    </span>{" "}
                    estimated
                  </>
                ) : (
                  <span className="text-muted-foreground">No estimate set</span>
                )}
              </span>
            )}
          </div>
        </CardContent>
      </Card>

      {meeting.notes && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Notes</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm whitespace-pre-wrap">{meeting.notes}</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
