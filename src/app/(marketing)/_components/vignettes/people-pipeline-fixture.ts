// ============================================================================
// PEOPLE_FIXTURE — nine real contacts, frozen so the landing page can render
// the app's own person card.
//
// Source: Redemption Hill Church's live people list, snapshotted read-only on
// 2026-08-04 via `listPeople(churchId, { status: [...] })`
// (src/lib/people/service.ts) — the same church and the same records the
// retired fs-people.webp / sec-core-61.webp captures screenshotted. To
// regenerate, re-run that query for Redemption Hill and paste the rows back
// over the constant below.
//
// The nine are a selection, not the first nine: the list's own order is
// created_at descending, and in this church that ordering *is* the pipeline
// read backwards — the newest rows are prospects, the oldest are leaders. So
// the selection keeps the list's real order and picks one person per rung, and
// what you read top-to-bottom is a contact aging into a committed leader. All
// seven statuses in `STATUS_BADGE_CONFIG` appear at least once, which is the
// whole claim this panel makes.
//
// Every rendered string is verbatim: names, emails, phones, the status, the
// source (the card title-cases it), the created date the card prints as
// "Added ...". Only the inert identifiers were scrubbed — `id`, `churchId` and
// `createdBy` never reach the DOM except as the card's `href`, which the
// landing mount makes unreachable anyway.
//
// `tags` is deliberately absent. `PersonCard` can render them, but the only
// caller in the product (`components/people/people-list.tsx`, fed by
// `listPeople`, which returns plain `Person[]`) never passes any — so a
// landing page that showed tag chips would be showing a card the product does
// not currently render.
//
// import type only: `@/lib/people/types` re-exports from `@/db/schema`, and a
// value import would pull Drizzle into the marketing bundle.
// ============================================================================

import type { Person } from "@/lib/people/types";

const CHURCH_ID = "fixture-church";
const CREATED_BY = "fixture-user";

/** The columns every one of these rows shares — address, household and the
 *  soft-delete tombstone are unset on all of them, and none of it renders. */
const BLANK = {
  churchId: CHURCH_ID,
  addressLine1: null,
  addressLine2: null,
  city: null,
  state: null,
  postalCode: null,
  country: "US",
  sourceDetails: null,
  backgroundCheckStatus: "not_started",
  photoUrl: null,
  householdId: null,
  householdRole: null,
  pipelineSortOrder: 0,
  createdBy: CREATED_BY,
  deletedAt: null,
} as const;

export const PEOPLE_FIXTURE = [
  {
    ...BLANK,
    id: "fixture-person-1",
    firstName: "Elias",
    lastName: "Figueroa",
    email: "elias.figueroa@gmail.com",
    phone: "(940) 555-0193",
    status: "following_up",
    source: "personal_referral",
    notes: null,
    createdAt: new Date("2026-07-27T06:27:14.774Z"),
    updatedAt: new Date("2026-06-07T06:27:14.774Z"),
  },
  {
    ...BLANK,
    id: "fixture-person-2",
    firstName: "J. P.",
    lastName: "Holloway",
    email: "jp.holloway@hotmail.com",
    phone: "(940) 555-0192",
    status: "prospect",
    source: "event",
    notes: "First conversation at the neighborhood cookout.",
    createdAt: new Date("2026-07-27T06:27:14.774Z"),
    updatedAt: new Date("2026-07-27T06:27:14.774Z"),
  },
  {
    ...BLANK,
    id: "fixture-person-3",
    firstName: "Grace",
    lastName: "Lin",
    email: "grace.lin@yahoo.com",
    phone: "(940) 555-0187",
    status: "following_up",
    source: "website",
    notes: "Coffee next week — asked good questions about the vision.",
    createdAt: new Date("2026-07-22T06:27:14.774Z"),
    updatedAt: new Date("2026-07-29T06:27:14.774Z"),
  },
  {
    ...BLANK,
    id: "fixture-person-4",
    firstName: "Sam",
    lastName: "Torres",
    email: "sam.torres@gmail.com",
    phone: "(940) 555-0183",
    status: "attendee",
    source: "social_media",
    notes: "Found us on Instagram. Follow-up call Friday.",
    createdAt: new Date("2026-07-19T06:27:14.774Z"),
    updatedAt: new Date("2026-07-26T06:27:14.774Z"),
  },
  {
    ...BLANK,
    id: "fixture-person-5",
    firstName: "Marissa",
    lastName: "Morales",
    email: "marissa.morales@icloud.com",
    phone: "(940) 555-0175",
    status: "attendee",
    source: "vision_meeting",
    notes: null,
    createdAt: new Date("2026-07-14T06:27:14.774Z"),
    updatedAt: new Date("2026-07-23T06:27:14.774Z"),
  },
  {
    ...BLANK,
    id: "fixture-person-6",
    firstName: "Kayla",
    lastName: "Duong",
    email: "kayla.duong@yahoo.com",
    phone: "(940) 555-0157",
    status: "core_group",
    source: "vision_meeting",
    notes: null,
    createdAt: new Date("2026-06-28T06:27:14.774Z"),
    updatedAt: new Date("2026-07-24T06:27:14.774Z"),
  },
  {
    ...BLANK,
    id: "fixture-person-7",
    firstName: "Hannah",
    lastName: "Carr",
    email: "hannah.carr@icloud.com",
    phone: null,
    status: "interviewed",
    source: "vision_meeting",
    notes: null,
    createdAt: new Date("2026-06-05T06:27:14.774Z"),
    updatedAt: new Date("2026-07-18T06:27:14.774Z"),
  },
  {
    ...BLANK,
    id: "fixture-person-8",
    firstName: "Danielle",
    lastName: "Flores",
    email: "danielle.flores@icloud.com",
    phone: "(940) 555-0128",
    status: "launch_team",
    source: "vision_meeting",
    notes: null,
    createdAt: new Date("2026-05-13T06:27:14.774Z"),
    updatedAt: new Date("2026-07-08T06:27:14.774Z"),
  },
  {
    ...BLANK,
    id: "fixture-person-9",
    firstName: "Ana",
    lastName: "Jimenez",
    email: "ana.jimenez@hotmail.com",
    phone: "(940) 555-0109",
    status: "leader",
    source: "personal_referral",
    notes: null,
    createdAt: new Date("2026-03-31T06:27:14.774Z"),
    updatedAt: new Date("2026-07-26T06:27:14.774Z"),
  },
] satisfies Person[];

/** The two the phone composition shows: the newest contact still being
 *  followed up (Grace Lin, the one the retired capture's alt text named) and
 *  the person at the far end of the same pipeline. Two cards is the fewest
 *  that still says "this list spans first conversation to leader", which is
 *  the claim; the six between them only make it denser. */
export const PEOPLE_FIXTURE_COMPACT = [PEOPLE_FIXTURE[2], PEOPLE_FIXTURE[8]];

/** The Core Group metric, verbatim from `getDashboardMetrics(churchId, userId)`
 *  for the same church on the same day (`coreGroupSize: 61`) — the number the
 *  retired sec-core-61.webp overlay showed, and the number the dashboard's own
 *  "Core Group" card prints. Total people that day: 142. */
export const CORE_GROUP_SIZE = 61;
export const TOTAL_PEOPLE = 142;
