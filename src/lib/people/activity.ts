import { db } from "@/db";
import { personActivities, users, type ActivityType } from "@/db/schema";
import { and, desc, eq, lt, sql, type SQL } from "drizzle-orm";
import type { EvryAuditKey } from "@/lib/evry/audit/identity";
import type { EvryEffectInput, EvryEffectResult } from "@/lib/evry/executor";
import {
  type ActivityWithPerformer,
  type GetActivitiesOptions,
} from "./activity.shared";
import { claimEvryPeopleEffect } from "./evry-effect";

// Re-export shared types and functions for server-side use
export {
  formatActivityMessage,
  type ActivityWithPerformer,
  type GetActivitiesOptions,
  type GetActivitiesResult,
} from "./activity.shared";

/**
 * The one writer of person_activities rows — every timeline entry (notes,
 * tags, skills, assessments, household moves, status changes) goes through
 * here instead of a hand-rolled db.insert at each call site.
 *
 * Takes a single named-field object: three of the fields are interchangeable
 * UUID strings, and positional slots let a transposed churchId/personId/
 * performedBy type-check silently while writing a corrupt timeline row.
 */
export async function logPersonActivity(entry: {
  churchId: string;
  personId: string;
  activityType: ActivityType;
  metadata: Record<string, unknown>;
  performedBy: string;
}): Promise<void> {
  await db.insert(personActivities).values(entry);
}

/**
 * Atomically claim the executor's existing exact effect key and append a note.
 *
 * The completed step outcome is the claim. The activity insert selects only
 * from the winning claim CTE, so a replay can read the original durable result
 * while a concurrent or crash-after-commit retry can never append twice.
 */
export async function claimEvryPersonNote(input: {
  execution: EvryEffectInput["execution"];
  effectKey: EvryAuditKey;
  personId: string;
  expectedFirstName: string;
  expectedLastName: string;
  note: string;
}): Promise<EvryEffectResult> {
  return claimEvryPeopleEffect({
    execution: input.execution,
    effectKey: input.effectKey,
    mutation: sql`
      insert into person_activities (
        church_id, person_id, activity_type, metadata, performed_by, created_at
      )
      select
        e.church_id, p.id, 'note_added',
        ${JSON.stringify({ note: input.note })}::jsonb,
        e.actor_user_id, transaction_timestamp()
      from eligible e
      join persons p
        on p.id = ${input.personId}::uuid
       and p.church_id = e.church_id
       and p.deleted_at is null
       and p.first_name = ${input.expectedFirstName}
       and p.last_name = ${input.expectedLastName}
      returning 1 as affected_count, 0 as excluded_count
    `,
    async targetIsCurrent() {
      const result = await db.execute(sql`
        select 1
        from persons
        where id = ${input.personId}::uuid
          and church_id = ${input.execution.plantId}::uuid
          and deleted_at is null
          and first_name = ${input.expectedFirstName}
          and last_name = ${input.expectedLastName}
      `);
      return result.rows.length === 1;
    },
  });
}

export type EvryAuthoredNoteSnapshot = Readonly<{
  id: string;
  personId: string;
  note: string;
  metadataJson: string;
}>;

/** Resolve an editable note without revealing missing, foreign, or other-authored rows. */
export async function getEvryAuthoredNote(input: {
  churchId: string;
  actorUserId: string;
  personId: string;
  activityId: string;
}): Promise<EvryAuthoredNoteSnapshot | null> {
  const [row] = await db
    .select({
      id: personActivities.id,
      personId: personActivities.personId,
      metadata: personActivities.metadata,
    })
    .from(personActivities)
    .where(
      and(
        authoredNoteCondition(
          input.churchId,
          input.activityId,
          input.actorUserId
        ),
        eq(personActivities.personId, input.personId)
      )
    )
    .limit(1);
  if (!row) return null;
  const metadata =
    typeof row.metadata === "object" && row.metadata !== null
      ? (row.metadata as Record<string, unknown>)
      : {};
  const note = typeof metadata.note === "string" ? metadata.note : null;
  return note === null
    ? null
    : Object.freeze({
        id: row.id,
        personId: row.personId,
        note,
        metadataJson: JSON.stringify(metadata),
      });
}

export async function claimEvryPersonNoteEdit(input: {
  execution: EvryEffectInput["execution"];
  effectKey: EvryAuditKey;
  personId: string;
  activityId: string;
  expectedMetadataJson: string;
  note: string;
  editedAt: string;
}): Promise<EvryEffectResult> {
  return claimEvryPeopleEffect({
    execution: input.execution,
    effectKey: input.effectKey,
    mutation: sql`
      update person_activities a
      set metadata = ${input.expectedMetadataJson}::jsonb ||
          jsonb_build_object('note', ${input.note}, 'editedAt', ${input.editedAt})
      from eligible e
      where a.id = ${input.activityId}::uuid
        and a.church_id = e.church_id
        and a.person_id = ${input.personId}::uuid
        and a.activity_type = 'note_added'
        and a.performed_by = e.actor_user_id
        and a.metadata = ${input.expectedMetadataJson}::jsonb
      returning 1 as affected_count, 0 as excluded_count
    `,
    async targetIsCurrent() {
      const result = await db.execute(sql`
        select 1
        from person_activities
        where id = ${input.activityId}::uuid
          and church_id = ${input.execution.plantId}::uuid
          and person_id = ${input.personId}::uuid
          and activity_type = 'note_added'
          and performed_by = ${input.execution.actorUserId}::uuid
          and metadata = ${input.expectedMetadataJson}::jsonb
      `);
      return result.rows.length === 1;
    },
  });
}

export async function claimEvryPersonNoteDelete(input: {
  execution: EvryEffectInput["execution"];
  effectKey: EvryAuditKey;
  personId: string;
  activityId: string;
  expectedMetadataJson: string;
}): Promise<EvryEffectResult> {
  return claimEvryPeopleEffect({
    execution: input.execution,
    effectKey: input.effectKey,
    mutation: sql`
      delete from person_activities a
      using eligible e
      where a.id = ${input.activityId}::uuid
        and a.church_id = e.church_id
        and a.person_id = ${input.personId}::uuid
        and a.activity_type = 'note_added'
        and a.performed_by = e.actor_user_id
        and a.metadata = ${input.expectedMetadataJson}::jsonb
      returning 1 as affected_count, 0 as excluded_count
    `,
    async targetIsCurrent() {
      const result = await db.execute(sql`
        select 1
        from person_activities
        where id = ${input.activityId}::uuid
          and church_id = ${input.execution.plantId}::uuid
          and person_id = ${input.personId}::uuid
          and activity_type = 'note_added'
          and performed_by = ${input.execution.actorUserId}::uuid
          and metadata = ${input.expectedMetadataJson}::jsonb
      `);
      return result.rows.length === 1;
    },
  });
}

/**
 * THE PREDICATE THAT SAYS "THIS NOTE IS YOURS TO CHANGE" (P-010e).
 *
 * Four terms, and every one of them is load-bearing:
 *
 *  - the id, which is a value the CLIENT chose;
 *  - the church, which is therefore the tenancy boundary — without it an
 *    `activityId` from another plant matches;
 *  - `note_added`, so a status change or a tag entry cannot be rewritten
 *    through the note endpoints;
 *  - the performer, because a note is its author's sentence.
 *
 * Declared once because the edit and the delete must not be able to disagree
 * about who may act: a second copy is a second place to forget the church term.
 * A row that does not match reads as MISSING, which is the same answer a
 * deleted note gets.
 */
export function authoredNoteCondition(
  churchId: string,
  activityId: string,
  userId: string
): SQL {
  return and(
    eq(personActivities.id, activityId),
    eq(personActivities.churchId, churchId),
    eq(personActivities.activityType, "note_added"),
    eq(personActivities.performedBy, userId)
  )!;
}

export async function getActivities(
  churchId: string,
  personId: string,
  options: GetActivitiesOptions = {}
): Promise<{ activities: ActivityWithPerformer[]; nextCursor?: Date }> {
  const limit = options.limit || 20;
  const cursor = options.cursor;

  const whereClause = and(
    eq(personActivities.churchId, churchId),
    eq(personActivities.personId, personId),
    cursor ? lt(personActivities.createdAt, cursor) : undefined
  );

  const activities = await db
    .select({
      id: personActivities.id,
      churchId: personActivities.churchId,
      personId: personActivities.personId,
      activityType: personActivities.activityType,
      metadata: personActivities.metadata,
      performedBy: personActivities.performedBy,
      createdAt: personActivities.createdAt,
      performer: {
        name: users.name,
        email: users.email,
      },
    })
    .from(personActivities)
    .leftJoin(users, eq(personActivities.performedBy, users.id))
    .where(whereClause)
    .orderBy(desc(personActivities.createdAt))
    .limit(limit + 1); // Fetch one more to check for next page

  let nextCursor: Date | undefined = undefined;
  if (activities.length > limit) {
    const nextItem = activities.pop();
    nextCursor = nextItem?.createdAt;
  }

  return {
    activities,
    nextCursor,
  };
}
