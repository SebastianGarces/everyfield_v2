import { sql } from "drizzle-orm";

import type { EvryAuditKey } from "@/lib/evry/audit/identity";
import type { EvryEffectInput, EvryEffectResult } from "@/lib/evry/executor";
import { deleteFile } from "@/lib/storage";

import {
  claimEvryPeopleEffect,
  recoverCompletedEvryPeopleEffect,
} from "./evry-effect";

type EffectIdentity = Pick<EvryEffectInput, "execution"> & {
  effectKey: EvryAuditKey;
};

export async function claimEvryUploadPersonPhoto(
  input: EffectIdentity & {
    personId: string;
    currentPhotoKey: string | null;
    newPhotoKey: string;
  }
): Promise<EvryEffectResult> {
  const replay = await recoverCompletedEvryPeopleEffect(input);
  if (replay) return replay;
  const result = await claimEvryPeopleEffect({
    ...input,
    mutation: sql`
      update persons p set photo_url = ${input.newPhotoKey},
        updated_at = transaction_timestamp()
      from eligible e
      where p.id = ${input.personId}::uuid and p.church_id = e.church_id
        and p.deleted_at is null
        and p.photo_url is not distinct from ${input.currentPhotoKey}
      returning 1 as affected_count, 0 as excluded_count
    `,
    targetIsCurrent: async () => false,
  });
  if (
    result.status === "completed" &&
    input.currentPhotoKey &&
    input.currentPhotoKey !== input.newPhotoKey
  ) {
    try {
      await deleteFile(input.currentPhotoKey);
    } catch (error) {
      console.error(
        "[evry:people] failed to delete replaced photo object:",
        error
      );
    }
  }
  return result;
}

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
}>;

export async function claimEvryBulkImport(
  input: EffectIdentity & { rows: readonly EvryImportPersonRow[] }
): Promise<EvryEffectResult> {
  const replay = await recoverCompletedEvryPeopleEffect(input);
  if (replay) return replay;
  const rowsJson = JSON.stringify(input.rows);
  const count = input.rows.length;
  return claimEvryPeopleEffect({
    ...input,
    beforeMutation: sql`
      requested as materialized (
        select * from jsonb_to_recordset(${rowsJson}::jsonb) as r(
          "rowNumber" integer, "rowKey" text, "personId" uuid,
          "firstName" text, "lastName" text, email text, phone text,
          source text, "addressLine1" text, "addressLine2" text, city text,
          state text, "postalCode" text, country text, notes text
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
        where (select count(*) from requested) = ${count}
          and (select count(distinct "rowKey") from requested) = ${count}
          and (select count(distinct "personId") from requested) = ${count}
        returning church_id, id
      ), activities as (
        insert into person_activities (
          church_id, person_id, activity_type, metadata, performed_by, created_at
        )
        select p.church_id, p.id, 'person_created',
          jsonb_build_object('source', 'bulk_import', 'rowKey', r."rowKey", 'rowNumber', r."rowNumber"),
          ${input.execution.actorUserId}::uuid, transaction_timestamp()
        from created_people p join requested r on r."personId" = p.id
        returning 1
      ),
    `,
    mutation: sql`
      select count(*)::integer as affected_count, 0 as excluded_count
      from activities having count(*) = ${count}
    `,
    targetIsCurrent: () => Promise.resolve(true),
  });
}
