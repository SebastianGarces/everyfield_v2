import { sql } from "drizzle-orm";

import { db } from "@/db";
import type { EvryAuditKey } from "@/lib/evry/audit/identity";
import type { EvryEffectInput, EvryEffectResult } from "@/lib/evry/executor";

import { claimEvryPeopleEffect } from "./evry-effect";

type EffectIdentity = Pick<EvryEffectInput, "execution"> & {
  effectKey: EvryAuditKey;
};

export type EvryPersonPayload = Readonly<{
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  country: string | null;
  status: string;
  backgroundCheckStatus: string;
  source: string | null;
  sourceDetails: string | null;
  notes: string | null;
  householdId: string | null;
  householdRole: string | null;
}>;

async function hasRow(query: ReturnType<typeof sql>): Promise<boolean> {
  return (await db.execute(query)).rows.length === 1;
}

function personSnapshot(alias: ReturnType<typeof sql>) {
  return sql`jsonb_build_object(
    'firstName', ${alias}.first_name, 'lastName', ${alias}.last_name,
    'email', ${alias}.email, 'phone', ${alias}.phone,
    'addressLine1', ${alias}.address_line1, 'addressLine2', ${alias}.address_line2,
    'city', ${alias}.city, 'state', ${alias}.state,
    'postalCode', ${alias}.postal_code, 'country', ${alias}.country,
    'status', ${alias}.status,
    'backgroundCheckStatus', ${alias}.background_check_status,
    'source', ${alias}.source, 'sourceDetails', ${alias}.source_details,
    'notes', ${alias}.notes, 'householdId', ${alias}.household_id::text,
    'householdRole', ${alias}.household_role
  )`;
}

export async function claimEvryCreatePerson(
  input: EffectIdentity & {
    person: EvryPersonPayload;
    activitySource: "form" | "quick_add";
    expectedHouseholdName: string | null;
  }
): Promise<EvryEffectResult> {
  const person = input.person;
  return claimEvryPeopleEffect({
    ...input,
    beforeMutation: sql`
      created_person as (
        insert into persons (
          church_id, first_name, last_name, email, phone, address_line1,
          address_line2, city, state, postal_code, country, status,
          background_check_status, source, source_details, notes, household_id,
          household_role, pipeline_sort_order, created_by, created_at, updated_at
        )
        select e.church_id, ${person.firstName}, ${person.lastName},
          ${person.email}, ${person.phone}, ${person.addressLine1},
          ${person.addressLine2}, ${person.city}, ${person.state},
          ${person.postalCode}, ${person.country}, ${person.status},
          ${person.backgroundCheckStatus}, ${person.source},
          ${person.sourceDetails}, ${person.notes}, ${person.householdId}::uuid,
          ${person.householdRole}, 0, e.actor_user_id,
          transaction_timestamp(), transaction_timestamp()
        from eligible e
        where ${person.householdId}::uuid is null or exists (
          select 1 from households h
          where h.id = ${person.householdId}::uuid and h.church_id = e.church_id
            and h.name = ${input.expectedHouseholdName}
        )
        returning church_id, id
      ), activity as (
        insert into person_activities (
          church_id, person_id, activity_type, metadata, performed_by, created_at
        )
        select church_id, id, 'person_created',
          ${JSON.stringify({ source: input.activitySource })}::jsonb,
          ${input.execution.actorUserId}::uuid, transaction_timestamp()
        from created_person returning 1
      ),
    `,
    mutation: sql`select 1 as affected_count, 0 as excluded_count from activity`,
    targetIsCurrent: () =>
      person.householdId
        ? hasRow(sql`
            select 1 from households
            where id = ${person.householdId}::uuid
              and church_id = ${input.execution.plantId}::uuid
              and name = ${input.expectedHouseholdName}
          `)
        : Promise.resolve(true),
  });
}

export async function claimEvryUpdatePerson(
  input: EffectIdentity & {
    personId: string;
    baselineJson: string;
    after: EvryPersonPayload;
  }
): Promise<EvryEffectResult> {
  const after = input.after;
  const current = personSnapshot(sql`p`);
  return claimEvryPeopleEffect({
    ...input,
    mutation: sql`
      update persons p set
        first_name = ${after.firstName}, last_name = ${after.lastName},
        email = ${after.email}, phone = ${after.phone},
        address_line1 = ${after.addressLine1}, address_line2 = ${after.addressLine2},
        city = ${after.city}, state = ${after.state}, postal_code = ${after.postalCode},
        country = ${after.country}, background_check_status = ${after.backgroundCheckStatus},
        source = ${after.source}, source_details = ${after.sourceDetails}, notes = ${after.notes},
        household_id = ${after.householdId}::uuid, household_role = ${after.householdRole},
        updated_at = transaction_timestamp()
      from eligible e
      where p.id = ${input.personId}::uuid and p.church_id = e.church_id
        and p.deleted_at is null and ${current} = ${input.baselineJson}::jsonb
        and (${after.householdId}::uuid is null or exists (
          select 1 from households h
          where h.id = ${after.householdId}::uuid and h.church_id = e.church_id
        ))
      returning 1 as affected_count, 0 as excluded_count
    `,
    targetIsCurrent: () =>
      hasRow(sql`
        select 1 from persons p
        where p.id = ${input.personId}::uuid
          and p.church_id = ${input.execution.plantId}::uuid
          and p.deleted_at is null and ${current} = ${input.baselineJson}::jsonb
          and (${after.householdId}::uuid is null or exists (
            select 1 from households h where h.id = ${after.householdId}::uuid
              and h.church_id = ${input.execution.plantId}::uuid
          ))
      `),
  });
}

export async function claimEvryDeletePerson(
  input: EffectIdentity & { personId: string; baselineJson: string }
): Promise<EvryEffectResult> {
  const current = personSnapshot(sql`p`);
  return claimEvryPeopleEffect({
    ...input,
    mutation: sql`
      update persons p set deleted_at = transaction_timestamp(), updated_at = transaction_timestamp()
      from eligible e
      where p.id = ${input.personId}::uuid and p.church_id = e.church_id
        and p.deleted_at is null and ${current} = ${input.baselineJson}::jsonb
      returning 1 as affected_count, 0 as excluded_count
    `,
    targetIsCurrent: () =>
      hasRow(sql`
        select 1 from persons p where p.id = ${input.personId}::uuid
          and p.church_id = ${input.execution.plantId}::uuid
          and p.deleted_at is null and ${current} = ${input.baselineJson}::jsonb
      `),
  });
}

export async function claimEvryChangePersonStatus(
  input: EffectIdentity & {
    personId: string;
    expectedFirstName: string;
    expectedLastName: string;
    expectedStatus: string;
    newStatus: string;
    reason: string | null;
    skippedStatuses: readonly string[];
  }
): Promise<EvryEffectResult> {
  return claimEvryPeopleEffect({
    ...input,
    beforeMutation: sql`
      changed_person as (
        update persons p set status = ${input.newStatus}, updated_at = transaction_timestamp()
        from eligible e
        where p.id = ${input.personId}::uuid and p.church_id = e.church_id
          and p.deleted_at is null and p.first_name = ${input.expectedFirstName}
          and p.last_name = ${input.expectedLastName} and p.status = ${input.expectedStatus}
        returning p.church_id, p.id
      ), activity as (
        insert into person_activities (
          church_id, person_id, activity_type, metadata, performed_by, created_at
        )
        select church_id, id, 'status_changed',
          ${JSON.stringify({
            oldStatus: input.expectedStatus,
            newStatus: input.newStatus,
            ...(input.reason ? { reason: input.reason } : {}),
            ...(input.skippedStatuses.length
              ? { skippedStatuses: input.skippedStatuses }
              : {}),
          })}::jsonb,
          ${input.execution.actorUserId}::uuid, transaction_timestamp()
        from changed_person returning 1
      ),
    `,
    mutation: sql`select 1 as affected_count, 0 as excluded_count from activity`,
    targetIsCurrent: () =>
      hasRow(sql`
        select 1 from persons where id = ${input.personId}::uuid
          and church_id = ${input.execution.plantId}::uuid and deleted_at is null
          and first_name = ${input.expectedFirstName} and last_name = ${input.expectedLastName}
          and status = ${input.expectedStatus}
      `),
  });
}

export async function claimEvryReorderPeople(
  input: EffectIdentity & {
    entries: readonly Readonly<{
      personId: string;
      expectedStatus: string;
      expectedOrder: number;
      newOrder: number;
    }>[];
  }
): Promise<EvryEffectResult> {
  const entriesJson = JSON.stringify(input.entries);
  return claimEvryPeopleEffect({
    ...input,
    beforeMutation: sql`
      requested as materialized (
        select * from jsonb_to_recordset(${entriesJson}::jsonb)
          as r("personId" uuid, "expectedStatus" text, "expectedOrder" integer, "newOrder" integer)
      ), exact_targets as materialized (
        select p.id, r."newOrder"
        from requested r join persons p on p.id = r."personId"
        join eligible e on e.church_id = p.church_id
        where p.deleted_at is null and p.status = r."expectedStatus"
          and p.pipeline_sort_order = r."expectedOrder"
      ), reordered as (
        update persons p set pipeline_sort_order = t."newOrder"
        from exact_targets t
        where p.id = t.id
          and (select count(*) from exact_targets) = ${input.entries.length}
          and (select count(*) from requested) = ${input.entries.length}
        returning 1
      ),
    `,
    mutation: sql`
      select count(*)::integer as affected_count, 0 as excluded_count
      from reordered having count(*) = ${input.entries.length}
    `,
    targetIsCurrent: () =>
      hasRow(sql`
        with requested as (
          select * from jsonb_to_recordset(${entriesJson}::jsonb)
            as r("personId" uuid, "expectedStatus" text, "expectedOrder" integer, "newOrder" integer)
        )
        select 1 from requested r join persons p on p.id = r."personId"
        where p.church_id = ${input.execution.plantId}::uuid and p.deleted_at is null
          and p.status = r."expectedStatus" and p.pipeline_sort_order = r."expectedOrder"
        having count(*) = ${input.entries.length}
      `),
  });
}

export async function claimEvryRemovePersonPhoto(
  input: EffectIdentity & { personId: string; currentPhotoKey: string }
): Promise<EvryEffectResult> {
  return claimEvryPeopleEffect({
    ...input,
    mutation: sql`
      update persons p set photo_url = null, updated_at = transaction_timestamp()
      from eligible e
      where p.id = ${input.personId}::uuid and p.church_id = e.church_id
        and p.deleted_at is null and p.photo_url = ${input.currentPhotoKey}
      returning 1 as affected_count, 0 as excluded_count
    `,
    targetIsCurrent: () =>
      hasRow(sql`
        select 1 from persons where id = ${input.personId}::uuid
          and church_id = ${input.execution.plantId}::uuid and deleted_at is null
          and photo_url = ${input.currentPhotoKey}
      `),
  });
}
