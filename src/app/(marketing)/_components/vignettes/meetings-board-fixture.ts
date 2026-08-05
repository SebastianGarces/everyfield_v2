// ============================================================================
// MEETINGS FIXTURE — one real meetings board, frozen so the landing page can
// render the real MeetingCard.
//
// Source: Redemption Hill Church's live meetings, read 2026-08-04 through the
// app's own read layer — `listMeetings(churchId, { status: "upcoming" })` and
// `listMeetings(churchId, { status: "past" })`
// (src/lib/meetings/service.ts:164). That is the same call the /meetings page
// makes, so these rows are shaped exactly as the page's own cards receive them.
// To regenerate, re-run those two calls for that church and paste the results
// back over the constants below.
//
// Every rendered string is verbatim: titles, meeting numbers, location names,
// statuses, estimates, attendance. The datetimes are verbatim too, and then
// shifted by whole weeks — see TIME below, which is the one interesting thing
// in this file. Only the identifiers were
// scrubbed, and here that matters more than it did for the scorecard: a
// meeting's `id` DOES reach the DOM, because MeetingCard wraps the card in a
// link to /meetings/<id>. The scrubbed ids keep a real church's row ids off a
// public page; the link is inert on the landing page anyway (see
// meetings-board.tsx).
//
// WHAT THIS BOARD IS. Redemption Hill has 4 upcoming and 4 past meetings. This
// fixture carries three of each, and the vignette derives its section counts
// from the arrays it renders — exactly as the app does
// (`Upcoming ({upcomingMeetings.length})`, components/meetings/meeting-list
// .tsx:110) — so the headings and the cards under them always agree. It is a
// smaller board than Redemption Hill's, not a mis-stated one: each section is
// the first three rows the read layer returns, in its order, and the two left
// over are the fourth of each.
//
// One deliberate exception to "the first three": the fourth upcoming row is
// "Launch Sunday", which the seed dates 2026-08-28 — a FRIDAY. That is a fact
// about the demo database, not about the product, and it is not going on a
// public page — which is a second reason the board stops at three. (The
// launch-sunday panel renders that meeting from launch-sunday-fixture.ts,
// where the date is hand-moved to Sunday 2026-08-30 by the 2026-08-05 ruling.)
//
// Vision Night #5 comes in with `locationName: null`, so its card renders the
// app's "No location set" fallback. That stays: it is what the product shows
// for a meeting whose venue is not booked yet, and a board where every row is
// perfect is not a board anybody recognises.
//
// TIME — the one thing here that is not frozen, and why. MeetingCard renders
// an upcoming meeting's date AND a relative-day line beside it ("Tomorrow",
// "In 24 days" — `formatRelativeDay`), computed against the reader's clock. A
// datetime frozen to the day it was read would keep the date and turn the line
// under it into "In 24 days" → "312 days ago" while the badge still says
// Planning: the one thing the product would never render.
//
// So, as in snapshot-clock.ts, the fixture freezes the OFFSETS rather than the
// instants — but by WHOLE WEEKS, which is what a calendar of scheduled meetings
// needs and a feed of elapsed timestamps does not: a whole-week shift preserves
// every meeting's weekday and its wall-clock time (a 7:00 PM Wednesday stays a
// 7:00 PM Wednesday), and preserves the exact spacing between all six meetings.
// The shift is the smallest number of weeks that keeps the soonest upcoming
// meeting ahead of the render, so the board always reads as a live one: three
// meetings inside the next month, three inside the last two.
//
// The verbatim ISO strings stay in the file — every `at("…")` below is the
// literal timestamp that was read — so the record of what the database actually
// held is still here. Evaluated once per build (server components, prerendered
// page), so a rebuild is what re-anchors it. Record metadata (createdAt /
// updatedAt) is left exactly as read; none of it reaches the card.
// ============================================================================

import type { Location, MeetingWithCounts } from "@/lib/meetings/types";

const CHURCH_ID = "fixture-church";
const CREATED_BY = "fixture-user";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** The soonest upcoming meeting in the snapshot — the anchor the whole board
 *  is shifted by, so the shift is one number for all six meetings. */
const ANCHOR_ISO = "2026-08-05T19:00:00.000Z";

const SHIFT_MS =
  Math.max(0, Math.ceil((Date.now() - Date.parse(ANCHOR_ISO)) / WEEK_MS)) *
  WEEK_MS;

/** A verbatim snapshot timestamp, moved onto the same weekday and clock time in
 *  the render's own week. */
const at = (iso: string) => new Date(Date.parse(iso) + SHIFT_MS);

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

const RIVERAS = {
  id: "fixture-location-riveras",
  churchId: CHURCH_ID,
  name: "The Riveras' home",
  address: "1418 Sagebrush Ln, Denton, TX",
  contactName: null,
  contactPhone: null,
  contactEmail: null,
  cost: null,
  capacity: 35,
  notes: null,
  isActive: true,
  createdAt: new Date("2026-07-31T06:27:44.945Z"),
  updatedAt: new Date("2026-07-31T06:27:44.945Z"),
} satisfies Location;

/** Upcoming, soonest first — the first three `listMeetings` returns, in its
 *  order, which happens to be one of each kind the panel's sentence promises:
 *  a team night, an orientation, and a vision meeting. */
export const MEETINGS_UPCOMING = [
  {
    id: "fixture-meeting-worship-night",
    churchId: CHURCH_ID,
    type: "team_meeting",
    title: "Worship team night",
    datetime: at("2026-08-05T19:00:00.000Z"),
    status: "planning",
    locationId: LAKEVIEW.id,
    locationName: "Lakeview Elementary — gym",
    locationAddress: null,
    meetingNumber: null,
    teamId: "fixture-team-worship",
    meetingSubtype: "rehearsal",
    estimatedAttendance: 8,
    actualAttendance: null,
    durationMinutes: null,
    notes: null,
    agenda: null,
    createdBy: CREATED_BY,
    createdAt: new Date("2026-07-31T06:28:05.460Z"),
    updatedAt: new Date("2026-07-31T06:28:05.460Z"),
    totalAttendees: 0,
    newAttendees: 0,
    returningAttendees: 0,
    location: LAKEVIEW,
    teamName: "Worship Team",
  },
  {
    id: "fixture-meeting-orientation-2",
    churchId: CHURCH_ID,
    type: "orientation",
    title: "Orientation #2",
    datetime: at("2026-08-10T18:30:00.000Z"),
    status: "planning",
    locationId: RIVERAS.id,
    locationName: "The Riveras' home",
    locationAddress: null,
    meetingNumber: null,
    teamId: null,
    meetingSubtype: null,
    estimatedAttendance: 12,
    actualAttendance: null,
    durationMinutes: null,
    notes: null,
    agenda: null,
    createdBy: CREATED_BY,
    createdAt: new Date("2026-07-31T06:28:05.460Z"),
    updatedAt: new Date("2026-07-31T06:28:05.460Z"),
    totalAttendees: 0,
    newAttendees: 0,
    returningAttendees: 0,
    location: RIVERAS,
    teamName: null,
  },
  {
    id: "fixture-meeting-vision-5",
    churchId: CHURCH_ID,
    type: "vision_meeting",
    title: "Vision Night #5",
    datetime: at("2026-08-14T19:00:00.000Z"),
    status: "planning",
    locationId: null,
    locationName: null,
    locationAddress: null,
    meetingNumber: 5,
    teamId: null,
    meetingSubtype: null,
    estimatedAttendance: 32,
    actualAttendance: null,
    durationMinutes: null,
    notes: null,
    agenda: null,
    createdBy: CREATED_BY,
    createdAt: new Date("2026-07-31T06:28:05.460Z"),
    updatedAt: new Date("2026-07-31T06:28:05.460Z"),
    totalAttendees: 0,
    newAttendees: 0,
    returningAttendees: 0,
    location: null,
    teamName: null,
  },
] satisfies MeetingWithCounts[];

/** Past, most recent first — again the read layer's own order. Read right to
 *  left they are the attendance trend the engine quotes elsewhere on this
 *  page: 21, then 24, then 28. */
export const MEETINGS_PAST = [
  {
    id: "fixture-meeting-vision-4",
    churchId: CHURCH_ID,
    type: "vision_meeting",
    title: "Vision Night #4",
    datetime: at("2026-07-24T19:00:00.000Z"),
    status: "completed",
    locationId: RIVERAS.id,
    locationName: "The Riveras' home",
    locationAddress: null,
    meetingNumber: 4,
    teamId: null,
    meetingSubtype: null,
    estimatedAttendance: 26,
    actualAttendance: 28,
    durationMinutes: 90,
    notes: null,
    agenda: null,
    createdBy: CREATED_BY,
    createdAt: new Date("2026-07-31T06:27:56.629Z"),
    updatedAt: new Date("2026-07-25T09:00:00.000Z"),
    totalAttendees: 28,
    newAttendees: 1,
    returningAttendees: 1,
    location: RIVERAS,
    teamName: null,
  },
  {
    id: "fixture-meeting-vision-3",
    churchId: CHURCH_ID,
    type: "vision_meeting",
    title: "Vision Night #3",
    datetime: at("2026-07-03T19:00:00.000Z"),
    status: "completed",
    locationId: RIVERAS.id,
    locationName: "The Riveras' home",
    locationAddress: null,
    meetingNumber: 3,
    teamId: null,
    meetingSubtype: null,
    estimatedAttendance: 22,
    actualAttendance: 24,
    durationMinutes: 90,
    notes: null,
    agenda: null,
    createdBy: CREATED_BY,
    createdAt: new Date("2026-07-31T06:27:52.246Z"),
    updatedAt: new Date("2026-07-04T09:00:00.000Z"),
    totalAttendees: 24,
    newAttendees: 1,
    returningAttendees: 0,
    location: RIVERAS,
    teamName: null,
  },
  {
    id: "fixture-meeting-vision-2",
    churchId: CHURCH_ID,
    type: "vision_meeting",
    title: "Vision Night #2",
    datetime: at("2026-06-12T19:00:00.000Z"),
    status: "completed",
    locationId: RIVERAS.id,
    locationName: "The Riveras' home",
    locationAddress: null,
    meetingNumber: 2,
    teamId: null,
    meetingSubtype: null,
    estimatedAttendance: 19,
    actualAttendance: 21,
    durationMinutes: 90,
    notes: null,
    agenda: null,
    createdBy: CREATED_BY,
    createdAt: new Date("2026-07-31T06:27:48.416Z"),
    updatedAt: new Date("2026-06-13T09:00:00.000Z"),
    totalAttendees: 21,
    newAttendees: 0,
    returningAttendees: 0,
    location: RIVERAS,
    teamName: null,
  },
] satisfies MeetingWithCounts[];

/** The phone composition shows one card of each kind rather than six at a
 *  width where six would be unreadable: the orientation that is planned, and
 *  the vision night that was run and counted. Same real cards, just the
 *  minimum of them that gets the idea across. */
export const MEETINGS_COMPACT_UPCOMING = MEETINGS_UPCOMING[1];
export const MEETINGS_COMPACT_PAST = MEETINGS_PAST[0];
