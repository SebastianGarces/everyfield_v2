import { and, eq, sql } from "drizzle-orm";

import { db } from "@/db";
import { commitments } from "@/db/schema";
import type { EvryAuditKey } from "@/lib/evry/audit/identity";
import type { EvryEffectInput, EvryEffectResult } from "@/lib/evry/executor";
import { deleteFile, listFileKeys } from "@/lib/storage";

import { claimEvryPeopleEffect } from "./evry-effect";

type EffectIdentity = Pick<EvryEffectInput, "execution"> & {
  effectKey: EvryAuditKey;
};

type PersonBaseline = Readonly<{
  personId: string;
  firstName: string;
  lastName: string;
  status: string;
}>;

/**
 * Sweep unreferenced final commitment objects below one exact person prefix.
 * Database references are authoritative; failures remain visible to reruns.
 */
export async function sweepEvryCommitmentDocumentObjects(input: {
  plantId: string;
  personId: string;
  loadReferenced?: (scope: {
    plantId: string;
    personId: string;
  }) => Promise<readonly string[]>;
  list?: typeof listFileKeys;
  remove?: typeof deleteFile;
}): Promise<Readonly<{ removed: number; failed: number }>> {
  const referenced = new Set(
    input.loadReferenced
      ? await input.loadReferenced({
          plantId: input.plantId,
          personId: input.personId,
        })
      : (
          await db
            .select({ key: commitments.documentUrl })
            .from(commitments)
            .where(
              and(
                eq(commitments.churchId, input.plantId),
                eq(commitments.personId, input.personId)
              )
            )
        ).flatMap(({ key }) => (key ? [key] : []))
  );
  const prefix = `commitments/${input.plantId}/${input.personId}/`;
  const keys = await (input.list ?? listFileKeys)(prefix);
  let removed = 0;
  let failed = 0;
  for (const key of keys) {
    if (!key.startsWith(prefix) || referenced.has(key)) continue;
    try {
      await (input.remove ?? deleteFile)(key);
      removed += 1;
    } catch {
      failed += 1;
    }
  }
  return { removed, failed };
}

async function hasRow(query: ReturnType<typeof sql>): Promise<boolean> {
  return (await db.execute(query)).rows.length === 1;
}

function personIsCurrent(input: EffectIdentity & { person: PersonBaseline }) {
  return hasRow(sql`
    select 1 from persons where id = ${input.person.personId}::uuid
      and church_id = ${input.execution.plantId}::uuid and deleted_at is null
      and first_name = ${input.person.firstName} and last_name = ${input.person.lastName}
      and status = ${input.person.status}
  `);
}

export async function claimEvryCreateAssessment(
  input: EffectIdentity & {
    person: PersonBaseline;
    values: Readonly<{
      committedScore: number;
      committedNotes: string | null;
      compelledScore: number;
      compelledNotes: string | null;
      contagiousScore: number;
      contagiousNotes: string | null;
      courageousScore: number;
      courageousNotes: string | null;
      assessmentDate: string;
    }>;
  }
): Promise<EvryEffectResult> {
  const values = input.values;
  const total =
    values.committedScore +
    values.compelledScore +
    values.contagiousScore +
    values.courageousScore;
  return claimEvryPeopleEffect({
    ...input,
    beforeMutation: sql`
      created_assessment as (
        insert into assessments (
          church_id, person_id, assessed_by, committed_score, committed_notes,
          compelled_score, compelled_notes, contagious_score, contagious_notes,
          courageous_score, courageous_notes, total_score, assessment_date, created_at
        )
        select e.church_id, p.id, e.actor_user_id,
          ${values.committedScore}, ${values.committedNotes},
          ${values.compelledScore}, ${values.compelledNotes},
          ${values.contagiousScore}, ${values.contagiousNotes},
          ${values.courageousScore}, ${values.courageousNotes}, ${total},
          ${values.assessmentDate}::date, transaction_timestamp()
        from eligible e join persons p on p.church_id = e.church_id
        where p.id = ${input.person.personId}::uuid and p.deleted_at is null
          and p.first_name = ${input.person.firstName} and p.last_name = ${input.person.lastName}
          and p.status = ${input.person.status}
        returning church_id, person_id, id
      ), activity as (
        insert into person_activities (
          church_id, person_id, activity_type, metadata, performed_by, created_at
        )
        select church_id, person_id, 'assessment_completed',
          jsonb_build_object(
            'assessmentId', id, 'totalScore', ${total}::integer,
            'committedScore', ${values.committedScore}::integer,
            'compelledScore', ${values.compelledScore}::integer,
            'contagiousScore', ${values.contagiousScore}::integer,
            'courageousScore', ${values.courageousScore}::integer
          ), ${input.execution.actorUserId}::uuid, transaction_timestamp()
        from created_assessment returning 1
      ),
    `,
    mutation: sql`select 1 as affected_count, 0 as excluded_count from activity`,
    targetIsCurrent: () => personIsCurrent(input),
  });
}

export async function claimEvryCreateInterview(
  input: EffectIdentity & {
    person: PersonBaseline;
    values: Readonly<{
      interviewDate: string;
      maturityStatus: string;
      maturityNotes: string | null;
      giftedStatus: string;
      giftedNotes: string | null;
      chemistryStatus: string;
      chemistryNotes: string | null;
      rightReasonsStatus: string;
      rightReasonsNotes: string | null;
      seasonStatus: string;
      seasonNotes: string | null;
      overallResult: string;
      nextSteps: string | null;
    }>;
  }
): Promise<EvryEffectResult> {
  const value = input.values;
  const changesStatus = input.person.status !== "interviewed";
  return claimEvryPeopleEffect({
    ...input,
    beforeMutation: sql`
      current_person as materialized (
        select p.church_id, p.id
        from eligible e join persons p on p.church_id = e.church_id
        where p.id = ${input.person.personId}::uuid and p.deleted_at is null
          and p.first_name = ${input.person.firstName} and p.last_name = ${input.person.lastName}
          and p.status = ${input.person.status}
      ), created_interview as (
        insert into interviews (
          church_id, person_id, interviewed_by, interview_date,
          maturity_status, maturity_notes, gifted_status, gifted_notes,
          chemistry_status, chemistry_notes, right_reasons_status,
          right_reasons_notes, season_status, season_notes, overall_result,
          next_steps, created_at
        )
        select church_id, id, ${input.execution.actorUserId}::uuid,
          ${value.interviewDate}::date, ${value.maturityStatus}, ${value.maturityNotes},
          ${value.giftedStatus}, ${value.giftedNotes}, ${value.chemistryStatus},
          ${value.chemistryNotes}, ${value.rightReasonsStatus},
          ${value.rightReasonsNotes}, ${value.seasonStatus}, ${value.seasonNotes},
          ${value.overallResult}, ${value.nextSteps}, transaction_timestamp()
        from current_person returning church_id, person_id, id
      ), interview_activity as (
        insert into person_activities (
          church_id, person_id, activity_type, metadata, performed_by, created_at
        )
        select church_id, person_id, 'interview_completed',
          jsonb_build_object(
            'interviewId', id, 'overallResult', ${value.overallResult}::text,
            'maturityStatus', ${value.maturityStatus}::text, 'giftedStatus', ${value.giftedStatus}::text,
            'chemistryStatus', ${value.chemistryStatus}::text,
            'rightReasonsStatus', ${value.rightReasonsStatus}::text, 'seasonStatus', ${value.seasonStatus}::text
          ), ${input.execution.actorUserId}::uuid, transaction_timestamp()
        from created_interview returning church_id, person_id
      ), changed_status as (
        update persons p set status = 'interviewed', updated_at = transaction_timestamp()
        from interview_activity a where p.id = a.person_id and p.church_id = a.church_id
          and ${changesStatus}
        returning p.church_id, p.id
      ), status_activity as (
        insert into person_activities (
          church_id, person_id, activity_type, metadata, performed_by, created_at
        )
        select church_id, id, 'status_changed',
          ${JSON.stringify({
            oldStatus: input.person.status,
            newStatus: "interviewed",
          })}::jsonb,
          ${input.execution.actorUserId}::uuid, transaction_timestamp()
        from changed_status returning 1
      ),
    `,
    mutation: sql`select 1 as affected_count, 0 as excluded_count from interview_activity limit 1`,
    targetIsCurrent: () => personIsCurrent(input),
  });
}

export async function claimEvryCreateCommitment(
  input: EffectIdentity & {
    person: PersonBaseline;
    values: Readonly<{
      commitmentType: string;
      signedDate: string;
      witnessedBy: string | null;
      witnessLabel: string | null;
      notes: string | null;
      documentKey: string | null;
    }>;
  }
): Promise<EvryEffectResult> {
  const value = input.values;
  const nextStatus = "core_group";
  const changesStatus = input.person.status !== nextStatus;
  return claimEvryPeopleEffect({
    ...input,
    beforeMutation: sql`
      current_person as materialized (
        select p.church_id, p.id
        from eligible e join persons p on p.church_id = e.church_id
        where p.id = ${input.person.personId}::uuid and p.deleted_at is null
          and p.first_name = ${input.person.firstName} and p.last_name = ${input.person.lastName}
          and p.status = ${input.person.status}
          and (${value.witnessedBy}::uuid is null or exists (
            select 1 from users u where u.id = ${value.witnessedBy}::uuid
              and u.church_id = e.church_id
              and coalesce(u.name, u.email) = ${value.witnessLabel}
          ))
      ), created_commitment as (
        insert into commitments (
          church_id, person_id, commitment_type, signed_date, witnessed_by,
          document_url, notes, created_at
        )
        select church_id, id, ${value.commitmentType}, ${value.signedDate}::date,
          ${value.witnessedBy}::uuid, ${value.documentKey}, ${value.notes}, transaction_timestamp()
        from current_person returning church_id, person_id, id
      ), commitment_activity as (
        insert into person_activities (
          church_id, person_id, activity_type, metadata, performed_by, created_at
        )
        select church_id, person_id, 'commitment_recorded',
          jsonb_build_object(
            'commitmentId', id, 'commitmentType', ${value.commitmentType}::text,
            'signedDate', ${value.signedDate}::text,
            'hasDocument', ${value.documentKey !== null}::boolean
          ), ${input.execution.actorUserId}::uuid, transaction_timestamp()
        from created_commitment returning church_id, person_id
      ), changed_status as (
        update persons p set status = ${nextStatus}, updated_at = transaction_timestamp()
        from commitment_activity a where p.id = a.person_id and p.church_id = a.church_id
          and ${changesStatus}
        returning p.church_id, p.id
      ), status_activity as (
        insert into person_activities (
          church_id, person_id, activity_type, metadata, performed_by, created_at
        )
        select church_id, id, 'status_changed',
          ${JSON.stringify({
            oldStatus: input.person.status,
            newStatus: nextStatus,
          })}::jsonb,
          ${input.execution.actorUserId}::uuid, transaction_timestamp()
        from changed_status returning 1
      ),
    `,
    mutation: sql`select 1 as affected_count, 0 as excluded_count from commitment_activity limit 1`,
    targetIsCurrent: () =>
      hasRow(sql`
        select 1 from persons p where p.id = ${input.person.personId}::uuid
          and p.church_id = ${input.execution.plantId}::uuid and p.deleted_at is null
          and p.first_name = ${input.person.firstName} and p.last_name = ${input.person.lastName}
          and p.status = ${input.person.status}
          and (${value.witnessedBy}::uuid is null or exists (
            select 1 from users u where u.id = ${value.witnessedBy}::uuid
              and u.church_id = p.church_id
              and coalesce(u.name, u.email) = ${value.witnessLabel}
          ))
      `),
  });
}
