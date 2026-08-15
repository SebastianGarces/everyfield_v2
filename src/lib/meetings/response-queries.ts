import { and, desc, eq, exists, or, sql } from "drizzle-orm";

import { db } from "@/db";
import {
  meetingAttendance,
  meetingResponses,
  type MeetingResponse,
  type ResponseCardType,
} from "@/db/schema";

// Imported, never RE-EXPORTED, on the same rule `service.ts` states for
// `labels.ts`: a pass-through here would put this module's `@/db` graph back on
// the client's path to the response-card vocabulary.
import {
  buildResponseBreakdown,
  type ResponseBreakdown,
  type ResponseCardCounts,
} from "./response-card";

// ============================================================================
// Response cards (VM-014) — the db half
// ============================================================================
//
// What people said they wanted, captured per attendee during the attendance
// workflow and counted on the Outcomes tab. The paper half already ships — F6
// prints the Response Card (DOC-010) — so this is the capture of what comes
// back.
//
// A MODULE OF ITS OWN, beside `guest-list.ts` and `locations.ts`, rather than
// another section of `service.ts`. Nothing in `service.ts` reaches any of this
// except `removeAttendee`, which takes ONE query (`meetingResponseDeleteQuery`)
// to delete a card with the attendance row it belongs to. The db-free-sibling
// rule (memory/invariants.md → Meetings) constrains what a `"use client"`
// module may reach, not how many server modules the feature has — this file
// opens with `@/db` exactly as `service.ts` does, so it is a db module, never a
// sibling, and `response-card.ts` remains the client-reachable vocabulary.
//
// TENANCY IS IN EVERY WHERE, and in the WRITE it is in a guard rather than a
// filter. There is no RLS behind these queries (memory/invariants.md →
// Multi-Tenancy), and `personId` and `meetingId` are both values a client
// chose, so the writer proves the (church, meeting, person) triple exists as an
// ATTENDANCE row before it writes anything. That guard does two jobs at once: a
// forged church id reaches no row, and a response can only exist for somebody
// who was actually on the meeting's list.
//
// DELIBERATELY OUT OF SCOPE: turning a response into a task. That intersects
// the open follow-up-generation question (#323), and guessing at it here would
// mint work a planter never asked for — the same surprise T-020 avoids.
// ----------------------------------------------------------------------------

/**
 * Record (or correct) one attendee's response card.
 *
 * An UPSERT on `meeting_responses_meeting_person_unique`, not a
 * SELECT-then-INSERT: a card is one card, a correction replaces it, and a
 * double-submitted form must not make one attendee count twice in the
 * breakdown. SELECT-then-INSERT is not a concurrency guard (memory/invariants.md
 * → Transactions) — the unique constraint is.
 *
 * The attendance guard is a separate read, which is a race: an attendance row
 * deleted between the two statements commits a response for somebody no longer
 * on the list — the same accepted shape as `createHouseholdWithHead`'s.
 *
 * WHAT THAT RESIDUAL COSTS, now that it costs nothing readable. It used to be
 * called benign because the stray row could not cross a tenant boundary, which
 * was true and was not the point: it still inflated the Outcomes tab's recorded
 * count above its attendee count, and a figure a planter reads as "2 of 1
 * attendee handed a card in" is a false number on the feature's headline screen
 * (product value V5). Both readable paths into that state are closed by
 * construction now — `removeAttendee` deletes the card with the attendance row,
 * and both breakdown queries below count ONE population, cards that still have
 * an attendance row and attendance rows that attended or hold a card. A row this
 * race leaves behind is counted by neither, so it is invisible rather than
 * wrong.
 */
export async function recordMeetingResponse(
  churchId: string,
  meetingId: string,
  input: {
    personId: string;
    responseType: ResponseCardType;
    notes?: string | null;
    recordedById?: string | null;
  }
): Promise<MeetingResponse> {
  const [attending] = await attendanceRowQuery(
    churchId,
    meetingId,
    input.personId
  );

  if (!attending) {
    throw new MeetingResponseError("Attendance record not found");
  }

  const now = new Date();
  const notes = input.notes?.trim() || null;

  const [record] = await db
    .insert(meetingResponses)
    .values({
      churchId,
      meetingId,
      personId: input.personId,
      responseType: input.responseType,
      notes,
      recordedById: input.recordedById ?? null,
      recordedAt: now,
    })
    .onConflictDoUpdate({
      target: [meetingResponses.meetingId, meetingResponses.personId],
      // Field by field, never a spread of a caller-supplied object: the church
      // and the person are what scope this row, and a SET that could rewrite
      // either is a tenancy hole (memory/invariants.md → Wiki, same rule).
      set: {
        responseType: input.responseType,
        notes,
        recordedById: input.recordedById ?? null,
        recordedAt: now,
        updatedAt: now,
      },
    })
    .returning();

  if (!record) {
    throw new MeetingResponseError("Failed to record the response card");
  }

  return record;
}

/**
 * Take a response card back off an attendee.
 *
 * The way back to "no card recorded", which is a DIFFERENT state from every
 * value in the vocabulary — including `not_interested`. Without this, a
 * mis-keyed card could only be corrected to another response, so the planter
 * would be forced to assert something they never heard.
 */
export async function clearMeetingResponse(
  churchId: string,
  meetingId: string,
  personId: string
): Promise<void> {
  await meetingResponseDeleteQuery(churchId, meetingId, personId);
}

/**
 * The (church, meeting, person) attendance row a response-card write is gated
 * on. Its WHERE is the tenancy boundary AND the "was this person in the room?"
 * check — `personId` and `meetingId` are both values a client chose.
 */
export function attendanceRowQuery(
  churchId: string,
  meetingId: string,
  personId: string
) {
  return db
    .select({ id: meetingAttendance.id })
    .from(meetingAttendance)
    .where(
      and(
        eq(meetingAttendance.churchId, churchId),
        eq(meetingAttendance.meetingId, meetingId),
        eq(meetingAttendance.personId, personId)
      )
    )
    .limit(1);
}

/**
 * Removing a card names the church in its own WHERE.
 *
 * A DELETE scoped only by (meeting, person) would be a cross-tenant write, not
 * merely an over-broad read: both ids arrive from the client.
 */
export function meetingResponseDeleteQuery(
  churchId: string,
  meetingId: string,
  personId: string
) {
  return db
    .delete(meetingResponses)
    .where(
      and(
        eq(meetingResponses.churchId, churchId),
        eq(meetingResponses.meetingId, meetingId),
        eq(meetingResponses.personId, personId)
      )
    );
}

/** Every recorded card for a meeting, keyed by person, for the capture UI. */
export async function listMeetingResponses(
  churchId: string,
  meetingId: string
): Promise<MeetingResponse[]> {
  return db
    .select()
    .from(meetingResponses)
    .where(
      and(
        eq(meetingResponses.churchId, churchId),
        eq(meetingResponses.meetingId, meetingId)
      )
    )
    .orderBy(desc(meetingResponses.recordedAt));
}

/**
 * The Outcomes tab's figures: how many of each response type came back, and how
 * many attendees handed nothing in.
 *
 * TWO counts from two tables, because they answer two different questions and
 * one join cannot: the attendee count is the population the cards came out of,
 * and the response counts are the cards. A LEFT JOIN would give the same numbers
 * today and the wrong ones the moment a response outlives its attendance row.
 *
 * The two are nonetheless ONE POPULATION, and each query says so in its own
 * WHERE: a card is counted only while its person still has an attendance row,
 * and an attendance row is counted when it attended OR holds a card. That is
 * what makes `recordedCount <= attendeeCount` true of every pair these two
 * queries can return, rather than something the arithmetic downstream has to
 * survive.
 *
 * Both queries name `church_id` in their own WHERE. That is the tenancy
 * boundary — a meeting id from another church returns zeroes rather than
 * another plant's meeting (`response-summary.test.ts` runs the two-church
 * fixture through the rendered SQL).
 */
export async function getMeetingResponseBreakdown(
  churchId: string,
  meetingId: string
): Promise<ResponseBreakdown> {
  const [countRows, attendanceRows] = await Promise.all([
    meetingResponseCountsQuery(churchId, meetingId),
    meetingAttendedCountQuery(churchId, meetingId),
  ]);

  const counts: ResponseCardCounts = {};
  for (const row of countRows) {
    counts[row.responseType] = row.total;
  }

  return buildResponseBreakdown(counts, attendanceRows[0]?.total ?? 0);
}

/**
 * How many cards of each type came back, church-scoped — counting only cards
 * belonging to somebody still on this meeting's list.
 *
 * THE `EXISTS` IS WHAT MAKES THE NUMERATOR AND THE DENOMINATOR ONE POPULATION.
 * Every counted card now implies an attendance row, and every attendance row
 * with a card is counted by `meetingAttendedCountQuery` below — so
 * `recordedCount <= attendeeCount` is a property of the SQL rather than
 * something the display layer has to defend against. It also answers the plainer
 * question: a card from somebody no longer on the meeting's list is not a
 * finding about that meeting, and reporting it is reporting a person who is not
 * there.
 *
 * A `*Query` BUILDER rather than an inline statement, on the same terms as
 * `meetingFollowUpCountQuery`: tenancy here is application-enforced with no RLS
 * behind it, so what has to be assertable is the SQL that reaches the database —
 * a read that stopped scoping by church still type-checks and still returns
 * rows. `response-queries.test.ts` renders this with `.toSQL()` against a
 * two-church fixture. The correlated probe carries the church in its own WHERE
 * for the same reason the outer read does.
 */
export function meetingResponseCountsQuery(
  churchId: string,
  meetingId: string
) {
  return db
    .select({
      responseType: meetingResponses.responseType,
      total: sql<number>`count(*)::int`,
    })
    .from(meetingResponses)
    .where(
      and(
        eq(meetingResponses.churchId, churchId),
        eq(meetingResponses.meetingId, meetingId),
        exists(
          db
            .select({ one: sql`1` })
            .from(meetingAttendance)
            .where(
              and(
                eq(meetingAttendance.churchId, churchId),
                eq(meetingAttendance.meetingId, meetingId),
                eq(meetingAttendance.personId, meetingResponses.personId)
              )
            )
        )
      )
    )
    .groupBy(meetingResponses.responseType);
}

/**
 * The population the cards could have come out of: everyone marked `attended`,
 * PLUS anyone on this meeting's list who handed a card in.
 *
 * `status = 'attended'` POSITIVELY, never `<> 'absent'`, because the column has
 * three values — `excused` is neither. Counting the guest list instead would put
 * everyone who did not turn up into `notRecordedCount`, which reads as "we did
 * not get a card from them" about people who were never in the room.
 *
 * WHY THE SECOND ARM. `status` is editable after the fact, so flipping an
 * attendee from `attended` to `absent` once their card was keyed used to drop
 * them out of this count while their card stayed in the numerator — "2 of 1
 * attendee handed a card in" on the feature's headline screen. The fix is the
 * right POPULATION, not a clamp downstream (product value V5): somebody who
 * handed a card in was demonstrably in the room, whatever the attendance row was
 * later edited to say, so they belong in the denominator and their card is never
 * destroyed by a status correction.
 *
 * Both arms are church- AND meeting-scoped in their own WHERE, the correlated
 * one included.
 */
export function meetingAttendedCountQuery(churchId: string, meetingId: string) {
  return db
    .select({ total: sql<number>`count(*)::int` })
    .from(meetingAttendance)
    .where(
      and(
        eq(meetingAttendance.churchId, churchId),
        eq(meetingAttendance.meetingId, meetingId),
        or(
          eq(meetingAttendance.status, "attended"),
          exists(
            db
              .select({ one: sql`1` })
              .from(meetingResponses)
              .where(
                and(
                  eq(meetingResponses.churchId, churchId),
                  eq(meetingResponses.meetingId, meetingId),
                  eq(meetingResponses.personId, meetingAttendance.personId)
                )
              )
          )
        )
      )
    );
}

/** A response-card write that could not be made. Callers report, never throw on. */
export class MeetingResponseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MeetingResponseError";
  }
}
