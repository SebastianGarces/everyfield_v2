import { db } from "@/db";
import { sql } from "drizzle-orm";
import {
  assessmentCreateSchema,
  interviewCreateSchema,
  commitmentCreateSchema,
} from "@/lib/validations/people";

export const personRecordKinds = [
  "assessment",
  "interview",
  "commitment",
] as const;
export type PersonRecordKind = (typeof personRecordKinds)[number];
const tables = {
  assessment: "assessments",
  interview: "interviews",
  commitment: "commitments",
};
const schemas = {
  assessment: assessmentCreateSchema,
  interview: interviewCreateSchema,
  commitment: commitmentCreateSchema,
};
const columns = {
  assessment: [
    "committed_score",
    "committed_notes",
    "compelled_score",
    "compelled_notes",
    "contagious_score",
    "contagious_notes",
    "courageous_score",
    "courageous_notes",
    "assessment_date",
    "total_score",
  ],
  interview: [
    "interview_date",
    "maturity_status",
    "maturity_notes",
    "gifted_status",
    "gifted_notes",
    "chemistry_status",
    "chemistry_notes",
    "right_reasons_status",
    "right_reasons_notes",
    "season_status",
    "season_notes",
    "overall_result",
    "next_steps",
  ],
  commitment: ["commitment_type", "signed_date", "notes"],
};

export async function getPersonRecordCorrection(
  churchId: string,
  personId: string,
  kind: PersonRecordKind,
  id: string
) {
  const result = await db.execute(
    sql`select to_jsonb(r) as record, md5(to_jsonb(r)::text) as version from ${sql.identifier(tables[kind])} r where r.id = ${id}::uuid and r.church_id = ${churchId}::uuid and r.person_id = ${personId}::uuid`
  );
  return result.rows[0] as
    | { record: Record<string, unknown>; version: string }
    | undefined;
}

/** One statement locks, compares, updates and appends history; stale edits write nothing. */
export async function correctPersonRecord(
  churchId: string,
  userId: string,
  personId: string,
  kind: PersonRecordKind,
  id: string,
  version: string,
  input: Record<string, unknown>
) {
  const parsed = schemas[kind].parse({ ...input, personId });
  const values: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (key === "personId") continue;
    const column = key.replace(
      /[A-Z]/g,
      (letter) => `_${letter.toLowerCase()}`
    );
    values[column] =
      value instanceof Date
        ? value.toISOString().slice(0, 10)
        : (value ?? null);
  }
  for (const column of columns[kind])
    if (!(column in values)) values[column] = null;
  if (kind === "assessment")
    values.total_score = [
      "committed_score",
      "compelled_score",
      "contagious_score",
      "courageous_score",
    ].reduce((sum, key) => sum + Number(values[key]), 0);
  const table = sql.identifier(tables[kind]);
  const sets = sql.join(
    columns[kind].map(
      (column) =>
        sql`${sql.identifier(column)} = patch.${sql.identifier(column)}`
    ),
    sql`, `
  );
  const result = await db.execute(sql`
    with original as materialized (
      select r.*, to_jsonb(r) as snapshot from ${table} r
      where r.id = ${id}::uuid and r.church_id = ${churchId}::uuid and r.person_id = ${personId}::uuid
        and md5(to_jsonb(r)::text) = ${version} for update
    ), changed as (
      update ${table} r set ${sets}
      from original, jsonb_populate_record(null::${table}, ${JSON.stringify(values)}::jsonb) patch
      where r.id = original.id returning to_jsonb(r) as snapshot
    )
    insert into record_corrections (church_id, entity_type, entity_id, before, after, corrected_by)
    select ${churchId}::uuid, ${kind}, ${id}::uuid, original.snapshot, changed.snapshot, ${userId}::uuid
    from original, changed returning id
  `);
  return result.rows.length === 1;
}
