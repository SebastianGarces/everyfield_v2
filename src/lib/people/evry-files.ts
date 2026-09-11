import { sql } from "drizzle-orm";

import { db } from "@/db";
import type { EvryAuditKey } from "@/lib/evry/audit/identity";
import type { EvryEffectInput, EvryEffectResult } from "@/lib/evry/executor";

import {
  claimEvryPeopleEffect,
  recoverCompletedEvryPeopleEffect,
} from "./evry-effect";
import { evryImportDuplicateSnapshotCtes } from "./duplicate-match";
import { emitPersonCreated } from "./events";

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

interface DuplicateSnapshotCurrent extends Record<string, unknown> {
  is_current: boolean;
}

interface DuplicateSnapshotCount extends Record<string, unknown> {
  matched_count: number;
}

export function evryImportRowsHaveUniqueTargets(
  rows: readonly EvryImportPersonRow[]
): boolean {
  const mergeTargets = rows.flatMap((row) =>
    row.disposition === "merge" && row.targetPersonId
      ? [row.targetPersonId]
      : []
  );
  return (
    rows.length > 0 &&
    new Set(rows.map(({ rowNumber }) => rowNumber)).size === rows.length &&
    new Set(rows.map(({ rowKey }) => rowKey)).size === rows.length &&
    new Set(rows.map(({ personId }) => personId)).size === rows.length &&
    mergeTargets.length ===
      rows.filter(({ disposition }) => disposition === "merge").length &&
    new Set(mergeTargets).size === mergeTargets.length
  );
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

export async function evryImportDuplicateSnapshotIsCurrent(input: {
  database: Pick<typeof db, "execute">;
  plantId: string;
  snapshotJson: string;
}): Promise<boolean> {
  const expectedCount = (JSON.parse(input.snapshotJson) as unknown[]).length;
  const result = await input.database.execute<DuplicateSnapshotCurrent>(sql`
    with ${evryImportDuplicateSnapshotCtes({
      plantId: input.plantId,
      snapshotJson: input.snapshotJson,
      expectedCount,
    })}
    select is_current from duplicate_snapshot_current
  `);
  return result.rows[0]?.is_current === true;
}

async function importMergeTargetsAreCurrent(input: {
  plantId: string;
  rows: readonly EvryImportPersonRow[];
}): Promise<boolean> {
  const mergeRows = input.rows.filter((row) => row.disposition === "merge");
  if (mergeRows.length === 0) return true;
  const result = await db.execute<DuplicateSnapshotCount>(sql`
    with requested as materialized (
      select * from jsonb_to_recordset(${JSON.stringify(mergeRows)}::jsonb) as r(
        "targetPersonId" uuid, "expectedTargetJson" text
      )
    )
    select count(*)::integer as matched_count
    from requested r join persons p
      on p.id = r."targetPersonId" and p.church_id = ${input.plantId}::uuid
      and p.deleted_at is null
      and ${personSnapshot(sql`p`)} = r."expectedTargetJson"::jsonb
  `);
  return result.rows[0]?.matched_count === mergeRows.length;
}

export async function claimEvryBulkImport(
  input: EffectIdentity & {
    rows: readonly EvryImportPersonRow[];
    duplicateSnapshotJson: string;
  }
): Promise<EvryEffectResult> {
  const replay = await recoverCompletedEvryPeopleEffect(input);
  if (replay) return replay;
  if (!evryImportRowsHaveUniqueTargets(input.rows)) {
    return { status: "refused", excludedCount: 1 };
  }
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
        ${evryImportDuplicateSnapshotCtes({
          plantId: input.execution.plantId,
          snapshotJson: input.duplicateSnapshotJson,
          expectedCount: duplicateCount,
        })}, requested as materialized (
          select * from jsonb_to_recordset(${rowsJson}::jsonb) as r(
            "rowNumber" integer, "rowKey" text, "personId" uuid,
            "firstName" text, "lastName" text, email text, phone text,
            source text, "addressLine1" text, "addressLine2" text, city text,
            state text, "postalCode" text, country text, notes text,
            disposition text, "targetPersonId" uuid, "expectedTargetJson" text
          )
        ), requested_shape_current as materialized (
          select count(*) = ${count}
            and count(distinct "rowKey") = ${count}
            and count(distinct "personId") = ${count}
            and count(*) filter (where disposition = 'merge') =
              count("targetPersonId") filter (where disposition = 'merge')
            and count(*) filter (where disposition = 'merge') =
              count(distinct "targetPersonId") filter (where disposition = 'merge')
            as is_current
          from requested
        ), merge_targets_current as materialized (
          select count(*) filter (where r.disposition = 'merge') =
            count(*) filter (
              where r.disposition = 'merge' and exists (
                select 1
                from persons p cross join eligible e
                where p.id = r."targetPersonId" and p.church_id = e.church_id
                  and p.deleted_at is null
                  and ${personSnapshot(sql`p`)} = r."expectedTargetJson"::jsonb
              )
            ) as is_current
          from requested r
        ), import_preconditions_current as materialized (
          select
            (select is_current from duplicate_snapshot_current)
            and (select is_current from requested_shape_current)
            and (select is_current from merge_targets_current)
            as is_current
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
            and (select is_current from import_preconditions_current)
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
            and (select is_current from import_preconditions_current)
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
    targetIsCurrent: async () =>
      evryImportRowsHaveUniqueTargets(input.rows) &&
      (await evryImportDuplicateSnapshotIsCurrent({
        database: db,
        plantId: input.execution.plantId,
        snapshotJson: input.duplicateSnapshotJson,
      })) &&
      (await importMergeTargetsAreCurrent({
        plantId: input.execution.plantId,
        rows: input.rows,
      })),
    afterClaim: async () => {
      for (const row of input.rows) {
        if (row.disposition !== "create") continue;
        await emitPersonCreated({
          id: row.personId,
          churchId: input.execution.plantId,
          status: "prospect",
        });
      }
    },
  });
}
