import { sql, type SQL, type SQLWrapper } from "drizzle-orm";

/**
 * A duplicate field is equal after case-folding and trimming the candidate.
 *
 * This is deliberately equality, not LIKE: `%`, `_`, and `\` are legal data,
 * never pattern syntax. Preview and execution both build their predicates here
 * so a reviewed duplicate snapshot cannot disagree with its write-time fence.
 */
export function literalCaseInsensitiveDuplicateMatch(
  stored: SQLWrapper,
  candidate: string | SQLWrapper
): SQL {
  return sql`lower(${stored}) = lower(trim(${candidate}))`;
}

/**
 * The one SQL definition of an import snapshot's current duplicate matches.
 * Both the retry preflight and the atomic write CTE embed this exact fragment.
 */
export function evryImportDuplicateSnapshotCtes(input: {
  plantId: string;
  snapshotJson: string;
  expectedCount: number;
}): SQL {
  const emailMatches = literalCaseInsensitiveDuplicateMatch(
    sql`p.email`,
    sql`r.email`
  );
  const firstNameMatches = literalCaseInsensitiveDuplicateMatch(
    sql`p.first_name`,
    sql`r."firstName"`
  );
  const lastNameMatches = literalCaseInsensitiveDuplicateMatch(
    sql`p.last_name`,
    sql`r."lastName"`
  );

  return sql`
    duplicate_scope as materialized (
      select id from churches where id = ${input.plantId}::uuid
    ), duplicate_requested as materialized (
      select * from jsonb_to_recordset(${input.snapshotJson}::jsonb) as r(
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
          and r.email is not null and ${emailMatches}
        order by p.id asc limit 1
      ) exact_match on true
      left join lateral (
        select array_agg(matches.id order by matches.id asc) as ids
        from (
          select p.id from persons p
          where p.church_id = d.id and p.deleted_at is null
            and p.id is distinct from exact_match.id
            and (
              (${firstNameMatches} and ${lastNameMatches})
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
      select count(*)::integer = ${input.expectedCount}
        and count(*) filter (where "matchIds" = current_ids) =
          ${input.expectedCount} as is_current
      from current_matches
    )
  `;
}
