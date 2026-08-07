// ============================================================================
// LAUNCH SUNDAY FIXTURE — the real launch-day meeting, frozen so the landing
// page can render the app's real MeetingHeader and MeetingSummaryCards.
//
// Source: Redemption Hill Church's "Launch Sunday" meeting, read 2026-08-05
// through the app's own read layer — `getMeeting(churchId, meetingId)`
// (src/lib/meetings/service.ts:117), which is the exact call the meeting's
// page layout makes before handing the row to MeetingHeader. To regenerate,
// re-run it for that meeting and paste the row back over the constant below.
//
// Every rendered string is verbatim: the title, the datetime, the status, the
// venue and its address, the estimate, and the run-sheet note. Only the
// identifiers were scrubbed; none of them reach the DOM in this composition.
//
// TWO THINGS THAT AGE, both of which mean "re-read this fixture", not "edit it":
//
//   1. RELATIVE TIME. MeetingHeader renders `formatRelativeDay(meeting
//      .datetime)`, which reads the clock. The marketing page is prerendered,
//      so that line freezes at build time and re-freezes on every deploy: it
//      says "In N days" while this snapshot is fresh and decays to "N days
//      ago" under a "Planning" badge once the date passes. The check is: does
//      the datetime below still lie in the future? The rest of the composition
//      is clock-independent.
//   2. THE WEEKDAY. The source row read from the seed was 2026-08-28T10:00Z —
//      a FRIDAY, a seed-data artifact that made the phase titled "One Sunday"
//      print "Friday" three times. Ruled 2026-08-05 (PR #299 decision 2): the
//      datetime below is hand-moved to Sunday 2026-08-30T10:00Z. Fixtures are
//      static helpers and hand edits are legitimate; every other field is
//      still verbatim. If the seed is ever re-dated and this fixture re-read,
//      keep the date a Sunday — and keep meetings-board-fixture.ts's note on
//      the same meeting in agreement.
// ============================================================================

import type { MeetingSummary } from "@/app/(dashboard)/meetings/[id]/meeting-summary-cards";
import type { Location, MeetingWithCounts } from "@/lib/meetings/types";

const CHURCH_ID = "fixture-church";
const CREATED_BY = "fixture-user";

const LAKEVIEW = {
  id: "fixture-location-lakeview",
  churchId: CHURCH_ID,
  name: "Lakeview Elementary — gym",
  address: "300 Lakeview Blvd, Denton, TX",
  contactName: "Front office",
  contactPhone: null,
  contactEmail: null,
  cost: "$250/Sunday",
  capacity: 220,
  notes: null,
  isActive: true,
  createdAt: new Date("2026-07-31T06:27:44.985Z"),
  updatedAt: new Date("2026-07-31T06:27:44.985Z"),
} satisfies Location;

/** The row MeetingHeader is handed on /meetings/<id>. */
export const LAUNCH_SUNDAY_MEETING = {
  id: "fixture-meeting-launch-sunday",
  churchId: CHURCH_ID,
  type: "vision_meeting",
  title: "Launch Sunday",
  // Sunday — hand-moved from the seed's Friday 2026-08-28 (see header note 2)
  datetime: new Date("2026-08-30T10:00:00.000Z"),
  status: "planning",
  locationId: LAKEVIEW.id,
  locationName: "Lakeview Elementary — gym",
  locationAddress: null,
  meetingNumber: null,
  teamId: null,
  meetingSubtype: null,
  estimatedAttendance: 120,
  actualAttendance: null,
  durationMinutes: 75,
  notes:
    "Run sheet — 7:30 setup crew arrives · 8:15 band call · 9:15 doors open · 10:00 service. All teams on site by 8:00.",
  agenda: null,
  createdBy: CREATED_BY,
  createdAt: new Date("2026-07-31T06:28:05.502Z"),
  updatedAt: new Date("2026-07-31T06:28:05.502Z"),
  totalAttendees: 0,
  newAttendees: 0,
  returningAttendees: 0,
  location: LAKEVIEW,
  teamName: null,
} satisfies MeetingWithCounts;

/**
 * The same meeting for the summary cards, with `notes` dropped.
 *
 * The notes ARE the run sheet, and the run-sheet vignette that floats over
 * this panel is that same sentence in the marketing voice — rendering the
 * Notes card too would put the identical claim on the visual twice, and would
 * cost the composition a fourth card's height (and with it a readable type
 * size). One claim per visual: the vignette keeps it.
 *
 * Every other field is the meeting's own, so the three cards that do render
 * are the app's, unedited.
 */
export const LAUNCH_SUNDAY_CARDS = {
  datetime: LAUNCH_SUNDAY_MEETING.datetime,
  locationName: LAUNCH_SUNDAY_MEETING.locationName,
  locationAddress: LAUNCH_SUNDAY_MEETING.locationAddress,
  location: LAUNCH_SUNDAY_MEETING.location,
  actualAttendance: LAUNCH_SUNDAY_MEETING.actualAttendance,
  estimatedAttendance: LAUNCH_SUNDAY_MEETING.estimatedAttendance,
  notes: null,
} satisfies MeetingSummary;
