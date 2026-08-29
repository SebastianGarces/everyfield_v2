import { sql } from "drizzle-orm";

import { db } from "@/db";
import type { EvryAuditKey } from "@/lib/evry/audit/identity";
import type { EvryEffectInput, EvryEffectResult } from "@/lib/evry/executor";

import {
  claimEvryPeopleEffect,
  recoverCompletedEvryPeopleEffect,
} from "./evry-effect";

type EffectIdentity = Pick<EvryEffectInput, "execution"> & {
  effectKey: EvryAuditKey;
};

export type EvryImportPersonRow = Readonly<{
  rowNumber: number;
  rowKey: string;
  personId: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  source: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  country: string;
  notes: string | null;
  disposition: "create" | "merge";
  targetPersonId: string | null;
  expectedTargetJson: string | null;
}>;

interface DuplicateSnapshotCount extends Record<string, unknown> {
  matched_count: number;
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

async function duplicateSnapshotIsCurrent(input: {
  database: Pick<typeof db, "execute">;
  plantId: string;
  snapshotJson: string;
}): Promise<boolean> {
  const expectedCount = (JSON.parse(input.snapshotJson) as unknown[]).length;
  const result = await input.database.execute<DuplicateSnapshotCount>(sql`
    with requested as materialized (
      select * from jsonb_to_recordset(${input.snapshotJson}::jsonb) as r(
        "rowNumber" integer, email text, phone text, "firstName" text,
        "lastName" text, "matchIds" jsonb
      )
    ), current_matches as (
      select r."rowNumber", r."matchIds",
        to_jsonb(
          (case when exact_match.id is null then array[]::uuid[]
                 else array[exact_match.id] end) ||
          coalesce(fuzzy_matches.ids, array[]::uuid[])
        ) as current_ids
      from requested r
      left join lateral (
        select p.id from persons p
        where p.church_id = ${input.plantId}::uuid and p.deleted_at is null
          and r.email is not null and lower(p.email) = lower(r.email)
        order by p.id asc limit 1
      ) exact_match on true
      left join lateral (
        select array_agg(matches.id order by matches.id asc) as ids
        from (
          select p.id from persons p
          where p.church_id = ${input.plantId}::uuid and p.deleted_at is null
            and p.id is distinct from exact_match.id
            and (
              (lower(p.first_name) = lower(trim(r."firstName"))
                and lower(p.last_name) = lower(trim(r."lastName")))
              or (
                length(regexp_replace(coalesce(r.phone, ''), '[^0-9]', '', 'g')) >= 4
                and right(regexp_replace(coalesce(p.phone, ''), '[^0-9]', '', 'g'), 4) =
                  right(regexp_replace(r.phone, '[^0-9]', '', 'g'), 4)
              )
            )
          order by p.id asc limit 5
        ) matches
      ) fuzzy_matches on true
    )
    select count(*)::integer as matched_count from current_matches
    where "matchIds" = current_ids
  `);
  return result.rows[0]?.matched_count === expectedCount;
}

export async function claimEvryBulkImport(
  input: EffectIdentity & {
    rows: readonly EvryImportPersonRow[];
    duplicateSnapshotJson: string;
  }
): Promise<EvryEffectResult> {
  const replay = await recoverCompletedEvryPeopleEffect(input);
  if (replay) return replay;
  const rowsJson = JSON.stringify(input.rows);
  const count = input.rows.length;
  const duplicateCount = (JSON.parse(input.duplicateSnapshotJson) as unknown[])
    .length;
  return claimEvryPeopleEffect({
    ...input,
    lock: sql`
      select id from churches
      where id = ${input.execution.plantId}::uuid
      for update
    `,
    beforeMutation: sql`
        duplicate_scope as materialized (
          select id from churches
          where id = ${input.execution.plantId}::uuid
        ), duplicate_requested as materialized (
          select *
          from jsonb_to_recordset(${input.duplicateSnapshotJson}::jsonb) as r(
            "rowNumber" integer, email text, phone text, "firstName" text,
            "lastName" text, "matchIds" jsonb
          )
        ), current_matches as materialized (
          select r."rowNumber", r."matchIds",
            to_jsonb(
              (case when exact_match.id is null then array[]::uuid[]
                     else array[exact_match.id] end) ||
              coalesce(fuzzy_matches.ids, array[]::uuid[])
            ) as current_ids
          from duplicate_requested r
          cross join duplicate_scope d
          left join lateral (
            select p.id from persons p
            where p.church_id = d.id and p.deleted_at is null
              and r.email is not null and lower(p.email) = lower(r.email)
            order by p.id asc limit 1
          ) exact_match on true
          left join lateral (
            select array_agg(matches.id order by matches.id asc) as ids
            from (
              select p.id from persons p
              where p.church_id = d.id and p.deleted_at is null
                and p.id is distinct from exact_match.id
                and (
                  (lower(p.first_name) = lower(trim(r."firstName"))
                    and lower(p.last_name) = lower(trim(r."lastName")))
                  or (
                    length(regexp_replace(coalesce(r.phone, ''), '[^0-9]', '', 'g')) >= 4
                    and right(regexp_replace(coalesce(p.phone, ''), '[^0-9]', '', 'g'), 4) =
                      right(regexp_replace(r.phone, '[^0-9]', '', 'g'), 4)
                  )
                )
              order by p.id asc limit 5
            ) matches
          ) fuzzy_matches on true
        ), duplicate_snapshot_current as materialized (
          select count(*)::integer = ${duplicateCount}
            and count(*) filter (where "matchIds" = current_ids) =
              ${duplicateCount} as is_current
          from current_matches
        ), requested as materialized (
          select * from jsonb_to_recordset(${rowsJson}::jsonb) as r(
            "rowNumber" integer, "rowKey" text, "personId" uuid,
            "firstName" text, "lastName" text, email text, phone text,
            source text, "addressLine1" text, "addressLine2" text, city text,
            state text, "postalCode" text, country text, notes text,
            disposition text, "targetPersonId" uuid, "expectedTargetJson" text
          )
        ), created_people as (
          insert into persons (
            id, church_id, first_name, last_name, email, phone, source,
            address_line1, address_line2, city, state, postal_code, country,
            notes, status, pipeline_sort_order, created_by, created_at, updated_at
          )
          select r."personId", e.church_id, r."firstName", r."lastName",
            r.email, r.phone, r.source, r."addressLine1", r."addressLine2",
            r.city, r.state, r."postalCode", r.country, r.notes, 'prospect', 0,
            e.actor_user_id, transaction_timestamp(), transaction_timestamp()
          from requested r cross join eligible e
          join duplicate_scope d on d.id = e.church_id
          where r.disposition = 'create'
            and (select is_current from duplicate_snapshot_current)
            and (select count(*) from requested) = ${count}
            and (select count(distinct "rowKey") from requested) = ${count}
            and (select count(distinct "personId") from requested) = ${count}
          returning church_id, id
        ), merged_people as (
          update persons p set
            email = coalesce(p.email, r.email),
            phone = coalesce(p.phone, r.phone),
            address_line1 = coalesce(p.address_line1, r."addressLine1"),
            address_line2 = coalesce(p.address_line2, r."addressLine2"),
            city = coalesce(p.city, r.city), state = coalesce(p.state, r.state),
            postal_code = coalesce(p.postal_code, r."postalCode"),
            source = coalesce(p.source, r.source),
            notes = case
              when r.notes is null then p.notes
              when p.notes is null then r.notes
              else p.notes || E'\n\n' || r.notes
            end,
            updated_at = transaction_timestamp()
          from requested r cross join eligible e
          join duplicate_scope d on d.id = e.church_id
          where r.disposition = 'merge'
            and (select is_current from duplicate_snapshot_current)
            and p.id = r."targetPersonId" and p.church_id = e.church_id
            and p.deleted_at is null
            and ${personSnapshot(sql`p`)} = r."expectedTargetJson"::jsonb
          returning p.church_id, p.id
        ), changed_people as (
          select church_id, id, 'created'::text as change from created_people
          union all
          select church_id, id, 'merged'::text as change from merged_people
        ), activities as (
          insert into person_activities (
            church_id, person_id, activity_type, metadata, performed_by, created_at
          )
          select p.church_id, p.id,
            case when p.change = 'created' then 'person_created' else 'person_updated' end,
            jsonb_build_object('source', 'bulk_import', 'change', p.change,
              'rowKey', r."rowKey", 'rowNumber', r."rowNumber"),
            ${input.execution.actorUserId}::uuid, transaction_timestamp()
          from changed_people p join requested r
            on (r.disposition = 'create' and r."personId" = p.id)
              or (r.disposition = 'merge' and r."targetPersonId" = p.id)
          returning 1
        ),
    `,
    mutation: sql`
      select count(*)::integer as affected_count, 0 as excluded_count
      from activities having count(*) = ${count}
    `,
    targetIsCurrent: () =>
      duplicateSnapshotIsCurrent({
        database: db,
        plantId: input.execution.plantId,
        snapshotJson: input.duplicateSnapshotJson,
      }),
  });
}
