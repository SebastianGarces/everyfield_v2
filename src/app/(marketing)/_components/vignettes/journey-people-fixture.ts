// ============================================================================
// JOURNEY_PEOPLE fixtures — two frozen reads of Redemption Hill's People
// screen, so the landing page can render the app's own person and meeting
// cards instead of screenshots of them.
//
// Source: Redemption Hill Church (phase 4), dev database, snapshotted
// read-only on 2026-08-04 via the app's own read layer:
//
//   PIPELINE_PEOPLE   listPeople(churchId, { limit: 100 })
//                     + listPeople(churchId, { status: ["interviewed",
//                       "core_group"] })  — nine of those rows, named below
//   COMMITTED_PEOPLE  listPeople(churchId, {
//                       status: ["core_group", "launch_team", "leader"],
//                       limit: 12 })      — page 1, newest first
//   COMMITTED_TOTAL   the `total` that same call returned (61)
//   VISION_MEETING_4  listMeetings(churchId, { status: "past",
//                       type: "vision_meeting" })[0]
//
// To regenerate: re-run those calls for that church and paste the rows back
// over the constants below.
//
// Every rendered string is verbatim — names, emails, phone numbers, statuses,
// sources, the tag name and its hex, the meeting's title, location and
// attendance, and the `createdAt` each card prints as "Added …". Only inert
// identifiers were scrubbed: ids, churchId, createdBy and locationId never
// reach the DOM, they exist here to satisfy the types.
//
// These feed the live embeds in journey-people.tsx. Because the components are
// the app's own (components/people/person-card.tsx, people-list.tsx,
// meetings/meeting-card.tsx), the landing page cannot drift into showing a
// card the product does not render — but it does mean a change to those
// components changes this page.
// ============================================================================

import type { MeetingWithCounts } from "@/lib/meetings/types";
import type { Person, Tag } from "@/lib/people/types";

/** What `PersonCard` takes (person-card.tsx:13). `PeopleList` takes the
 *  narrower plain `Person[]`, which every row below also satisfies. */
export type PersonCardPerson = Person & { tags?: Tag[] };

const CHURCH_ID = "fixture-church";
const CREATED_BY = "fixture-user";
const LOCATION_ID = "fixture-location";

/** The columns every row in this file shares, so each person below is only
 *  the fields the card actually reads. None of these render: `country` is the
 *  column default, the address and household columns are empty for every
 *  person in this church, and `photoUrl` being null is why every card shows
 *  the app's initials avatar rather than a photo we would have to host. */
const PERSON_BASE = {
  churchId: CHURCH_ID,
  addressLine1: null,
  addressLine2: null,
  city: null,
  state: null,
  postalCode: null,
  country: "US",
  sourceDetails: null,
  backgroundCheckStatus: "not_started",
  notes: null,
  photoUrl: null,
  householdId: null,
  householdRole: null,
  pipelineSortOrder: 0,
  // Contacts, not accounts — nobody in this pipeline holds a login (#378).
  userId: null,
  createdBy: CREATED_BY,
  deletedAt: null,
} as const;

/** Sam Torres's one tag. Real row, real hex — `TagBadge` reads `color` and
 *  paints the badge with it directly (tag-badge.tsx:29). */
const MUSICIAN_TAG = {
  id: "fixture-tag-musician",
  churchId: CHURCH_ID,
  name: "Musician",
  color: "#1D4ED8",
  createdAt: new Date("2026-07-31T06:27:19.530Z"),
} satisfies Tag;

// ---------------------------------------------------------------------------
// Core group — the pipeline, read left to right and top to bottom
// ---------------------------------------------------------------------------

/**
 * Six real people, ordered so a two-column grid IS the pipeline the phase
 * describes: two prospects, then an attendee and someone in follow-up, then
 * one interviewed and one who has joined the core group. The app's own status
 * badge does the telling — grey prospect, blue attendee, yellow following up,
 * purple interviewed, emerald Core Group (lib/people/status-colors.ts:17).
 *
 * Six rather than a full screenful: six is what fits this phase pane at the
 * app's own size (see journey-people.tsx), and five distinct badges is the
 * whole vocabulary — a seventh card would repeat one of them at a smaller
 * size.
 *
 * J. P. Holloway (a prospect from an event) and Grace Lin (in follow-up, from
 * the website) are the two people the retired pt-coregroup capture named in
 * its alt text — the same rows, now rendered rather than photographed.
 */
export const PIPELINE_PEOPLE = [
  {
    ...PERSON_BASE,
    id: "fixture-person-holloway",
    firstName: "J. P.",
    lastName: "Holloway",
    email: "jp.holloway@hotmail.com",
    phone: "(940) 555-0192",
    status: "prospect",
    source: "event",
    createdAt: new Date("2026-07-27T06:27:14.774Z"),
    updatedAt: new Date("2026-07-27T06:27:14.774Z"),
  },
  {
    ...PERSON_BASE,
    id: "fixture-person-foster",
    firstName: "Julia",
    lastName: "Foster",
    email: "julia.foster@hotmail.com",
    phone: "(940) 555-0189",
    status: "prospect",
    source: "social_media",
    createdAt: new Date("2026-07-23T06:27:14.774Z"),
    updatedAt: new Date("2026-07-30T06:27:14.774Z"),
  },
  {
    ...PERSON_BASE,
    id: "fixture-person-torres",
    firstName: "Sam",
    lastName: "Torres",
    email: "sam.torres@gmail.com",
    phone: "(940) 555-0183",
    status: "attendee",
    source: "social_media",
    createdAt: new Date("2026-07-19T06:27:14.774Z"),
    updatedAt: new Date("2026-07-26T06:27:14.774Z"),
    tags: [MUSICIAN_TAG],
  },
  {
    ...PERSON_BASE,
    id: "fixture-person-lin",
    firstName: "Grace",
    lastName: "Lin",
    email: "grace.lin@yahoo.com",
    phone: "(940) 555-0187",
    status: "following_up",
    source: "website",
    createdAt: new Date("2026-07-22T06:27:14.774Z"),
    updatedAt: new Date("2026-07-29T06:27:14.774Z"),
  },
  {
    ...PERSON_BASE,
    id: "fixture-person-boyd",
    firstName: "Gloria",
    lastName: "Boyd",
    email: "gloria.boyd@yahoo.com",
    phone: "(940) 555-0140",
    status: "interviewed",
    source: "vision_meeting",
    createdAt: new Date("2026-06-03T06:27:14.774Z"),
    updatedAt: new Date("2026-07-19T06:27:14.774Z"),
  },
  {
    ...PERSON_BASE,
    id: "fixture-person-duong-k",
    firstName: "Kayla",
    lastName: "Duong",
    email: "kayla.duong@yahoo.com",
    phone: "(940) 555-0157",
    status: "core_group",
    source: "vision_meeting",
    createdAt: new Date("2026-06-28T06:27:14.774Z"),
    updatedAt: new Date("2026-07-24T06:27:14.774Z"),
  },
] satisfies PersonCardPerson[];

/** The two the phone composition shows: the first prospect in the pipeline and
 *  the person at the end of it. Two real cards are the smallest set that still
 *  says "contact becomes committed, and the badge is how you know" — all six
 *  side by side would be a wall of 7px type at 360px wide. */
export const PIPELINE_PEOPLE_COMPACT = [PIPELINE_PEOPLE[0], PIPELINE_PEOPLE[5]];

/** Redemption Hill's whole pipeline, for the phone composition's chrome —
 *  `listPeople(churchId)` returned this `total` on the same read. */
export const PIPELINE_TOTAL = 142;

// ---------------------------------------------------------------------------
// Launch team — the People screen filtered to the committed
// ---------------------------------------------------------------------------

/**
 * Page one of `status in (core_group, launch_team, leader)`, newest first —
 * exactly what the People screen renders when a planter filters to the
 * committed, which is what the retired pt-launch-team capture photographed.
 * Twelve rather than the screen's twenty-four: twelve is three rows of the
 * app's own `xl:grid-cols-4` grid, which fits the phase pane at close to life
 * size, and twenty-four would halve the type (see journey-people.tsx).
 *
 * Every one of these twelve is Core Group — that is not a filter, it is what
 * the newest twelve happen to be, and it is why the retired capture's alt text
 * said "Core Group badges on every card".
 *
 * Typed as plain `Person`, because `PeopleList` takes `Person[]`
 * (people-list.tsx:8) — no tags are loaded on that screen, so none render.
 */
export const COMMITTED_PEOPLE = [
  {
    ...PERSON_BASE,
    id: "fixture-person-duong-k",
    firstName: "Kayla",
    lastName: "Duong",
    email: "kayla.duong@yahoo.com",
    phone: "(940) 555-0157",
    status: "core_group",
    source: "vision_meeting",
    createdAt: new Date("2026-06-28T06:27:14.774Z"),
    updatedAt: new Date("2026-07-24T06:27:14.774Z"),
  },
  {
    ...PERSON_BASE,
    id: "fixture-person-coleman",
    firstName: "Julia",
    lastName: "Coleman",
    email: "julia.coleman@hotmail.com",
    phone: "(940) 555-0152",
    status: "core_group",
    source: "vision_meeting",
    createdAt: new Date("2026-06-25T06:27:14.774Z"),
    updatedAt: new Date("2026-07-25T06:27:14.774Z"),
  },
  {
    ...PERSON_BASE,
    id: "fixture-person-calloway",
    firstName: "Josue",
    lastName: "Calloway",
    email: "josue.calloway@icloud.com",
    phone: "(940) 555-0148",
    status: "core_group",
    source: "vision_meeting",
    createdAt: new Date("2026-06-22T06:27:14.774Z"),
    updatedAt: new Date("2026-07-26T06:27:14.774Z"),
  },
  {
    ...PERSON_BASE,
    id: "fixture-person-bell",
    firstName: "Jordan",
    lastName: "Bell",
    email: "jordan.bell@gmail.com",
    phone: "(940) 555-0146",
    status: "core_group",
    source: "vision_meeting",
    createdAt: new Date("2026-06-19T06:27:14.774Z"),
    updatedAt: new Date("2026-07-18T06:27:14.774Z"),
  },
  {
    ...PERSON_BASE,
    id: "fixture-person-abara",
    firstName: "Jonah",
    lastName: "Abara",
    email: "jonah.abara@icloud.com",
    phone: "(940) 555-0145",
    status: "core_group",
    source: "vision_meeting",
    createdAt: new Date("2026-06-16T06:27:14.774Z"),
    updatedAt: new Date("2026-07-19T06:27:14.774Z"),
  },
  {
    ...PERSON_BASE,
    id: "fixture-person-patel",
    firstName: "Joel",
    lastName: "Patel",
    email: "joel.patel@yahoo.com",
    phone: null,
    status: "core_group",
    source: "vision_meeting",
    createdAt: new Date("2026-06-13T06:27:14.774Z"),
    updatedAt: new Date("2026-07-20T06:27:14.774Z"),
  },
  {
    ...PERSON_BASE,
    id: "fixture-person-mccoy",
    firstName: "Jessica",
    lastName: "McCoy",
    email: "jessica.mccoy@gmail.com",
    phone: "(940) 555-0143",
    status: "core_group",
    source: "vision_meeting",
    createdAt: new Date("2026-06-10T06:27:14.774Z"),
    updatedAt: new Date("2026-07-21T06:27:14.774Z"),
  },
  {
    ...PERSON_BASE,
    id: "fixture-person-jefferson",
    firstName: "Jerome",
    lastName: "Jefferson",
    email: "jerome.jefferson@hotmail.com",
    phone: "(940) 555-0142",
    status: "core_group",
    source: "vision_meeting",
    createdAt: new Date("2026-06-07T06:27:14.774Z"),
    updatedAt: new Date("2026-07-22T06:27:14.774Z"),
  },
  {
    ...PERSON_BASE,
    id: "fixture-person-harmon",
    firstName: "Javier",
    lastName: "Harmon",
    email: "javier.harmon@outlook.com",
    phone: "(940) 555-0141",
    status: "core_group",
    source: "vision_meeting",
    createdAt: new Date("2026-06-04T06:27:14.774Z"),
    updatedAt: new Date("2026-07-23T06:27:14.774Z"),
  },
  {
    ...PERSON_BASE,
    id: "fixture-person-okafor-c",
    firstName: "Chidi",
    lastName: "Okafor",
    email: "chidi.okafor@yahoo.com",
    phone: "(940) 555-0137",
    status: "core_group",
    source: "vision_meeting",
    createdAt: new Date("2026-06-01T06:27:14.774Z"),
    updatedAt: new Date("2026-07-28T06:27:14.774Z"),
  },
  {
    ...PERSON_BASE,
    id: "fixture-person-gaines",
    firstName: "Jasmine",
    lastName: "Gaines",
    email: "jasmine.gaines@gmail.com",
    phone: null,
    status: "core_group",
    source: "vision_meeting",
    createdAt: new Date("2026-06-01T06:27:14.774Z"),
    updatedAt: new Date("2026-07-24T06:27:14.774Z"),
  },
  {
    ...PERSON_BASE,
    id: "fixture-person-okafor-a",
    firstName: "Amara",
    lastName: "Okafor",
    email: "amara.okafor@outlook.com",
    phone: null,
    status: "core_group",
    source: "vision_meeting",
    createdAt: new Date("2026-06-01T06:27:14.774Z"),
    updatedAt: new Date("2026-07-28T06:27:14.774Z"),
  },
] satisfies Person[];

/** The `total` the committed filter returned — the number the retired capture
 *  quoted, and the number `PeopleList` prints under the grid. */
export const COMMITTED_TOTAL = 61;

/** The two the phone composition shows. Same rows, top of the same list. */
export const COMMITTED_PEOPLE_COMPACT = [
  COMMITTED_PEOPLE[0],
  COMMITTED_PEOPLE[1],
];

/** How the 61 break down, for the phone composition's footer — the counts
 *  `listPeople` returned per status on the same read (34 + 18 + 9 = 61). */
export const COMMITTED_BREAKDOWN = {
  coreGroup: 34,
  launchTeam: 18,
  leaders: 9,
} as const;

// ---------------------------------------------------------------------------
// The vision meeting that stands on the core-group grid
// ---------------------------------------------------------------------------

/**
 * Redemption Hill's most recent completed vision meeting — the 28-person night
 * the Plant Intelligence scorecard higher up this page cites as
 * `visionMeetings.latestAttendance=28`. One read, two surfaces.
 *
 * A COMPLETED meeting on purpose. `MeetingCard` renders
 * `formatRelativeDay(meeting.datetime)` for anything not marked past
 * (meeting-card.tsx:120), and that reads the clock — a frozen upcoming meeting
 * would say "In 10 days" the week this shipped and "45 days ago" a month
 * later. Rendered with `isPast`, the card drops that row and shows the
 * attendance instead, so every string on it is a pure function of this
 * fixture.
 */
export const VISION_MEETING_4 = {
  id: "fixture-meeting-vision-4",
  churchId: CHURCH_ID,
  type: "vision_meeting",
  title: "Vision Night #4",
  datetime: new Date("2026-07-24T19:00:00.000Z"),
  status: "completed",
  locationId: LOCATION_ID,
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
  location: {
    id: LOCATION_ID,
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
  },
  teamName: null,
} satisfies MeetingWithCounts;
