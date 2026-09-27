import { randomUUID } from "node:crypto";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { households, personMerges, persons } from "@/db/schema";
import { lockPlantLeadership } from "@/lib/ministry-teams/leadership-lock";
import { toPersonForClient } from "./types";
import { blockerArray, mergeChecks } from "./merge-checks";
import { personMergeReferences } from "./merge-references";
import {
  mergeFields,
  type MergeRequest,
  type MergeReview,
} from "./merge-model";

export async function getMergeReview(
  churchId: string,
  leftId: string,
  rightId: string
): Promise<MergeReview | null> {
  if (leftId === rightId) return null;
  const rows = await db
    .select({
      person: persons,
      version: sql<string>`md5(to_jsonb(${persons})::text)`,
    })
    .from(persons)
    .where(
      and(
        eq(persons.churchId, churchId),
        inArray(persons.id, [leftId, rightId]),
        isNull(persons.deletedAt)
      )
    );
  const left = rows.find((row) => row.person.id === leftId);
  const right = rows.find((row) => row.person.id === rightId);
  if (!left || !right) return null;
  const householdRows = await db
    .select({ id: households.id, name: households.name })
    .from(households)
    .where(
      and(
        eq(households.churchId, churchId),
        inArray(
          households.id,
          [left.person.householdId, right.person.householdId].filter(
            (id): id is string => !!id
          )
        )
      )
    );
  const details = await db.execute<{
    left: string[];
    right: string[];
    shared_tags: number;
  }>(sql`select
    ${blockerArray(mergeChecks(churchId, rightId, leftId))} as left,
    ${blockerArray(mergeChecks(churchId, leftId, rightId))} as right,
    (select count(*)::int from person_tags a join person_tags b on a.tag_id=b.tag_id where a.person_id=${leftId} and b.person_id=${rightId}) as shared_tags`);
  const profile = (row: typeof left) => ({
    person: toPersonForClient(row.person),
    version: row.version,
    linkedAccount: row.person.userId !== null,
    householdName:
      householdRows.find((h) => h.id === row.person.householdId)?.name ?? null,
  });
  return {
    left: profile(left),
    right: profile(right),
    conflicts: mergeFields
      .filter((field) =>
        field.columns.some(
          (column) => left.person[column] !== right.person[column]
        )
      )
      .map((field) => field.key),
    blockers: details.rows[0].left.filter((message) =>
      details.rows[0].right.includes(message)
    ),
    survivorBlockers: {
      left: details.rows[0].left,
      right: details.rows[0].right,
    },
    sharedTags: details.rows[0].shared_tags,
  };
}

/** One transaction, including the read-after-lock guard. Every effect is gated
 * by this attempt's receipt, so a refused request cannot partially apply. */
export async function mergePeople(
  churchId: string,
  actorId: string,
  input: MergeRequest
) {
  const survivorId = input.survivor === "left" ? input.leftId : input.rightId;
  const sourceId = input.survivor === "left" ? input.rightId : input.leftId;
  const previous = await db
    .select({ survivorId: personMerges.survivorId })
    .from(personMerges)
    .where(
      and(
        eq(personMerges.churchId, churchId),
        eq(personMerges.sourceId, sourceId)
      )
    );
  if (previous[0]?.survivorId === survivorId)
    return { success: true as const, survivorId };
  const review = await getMergeReview(churchId, input.leftId, input.rightId);
  if (!review)
    return {
      success: false as const,
      error: "Both profiles must still be active in this church.",
    };
  if (review.conflicts.some((key) => !input.choices[key]))
    return {
      success: false as const,
      error: "Choose which value to keep for every difference.",
    };
  const receiptId = randomUUID();
  const applied = sql`exists(select 1 from person_merges where id=${receiptId} and church_id=${churchId})`;
  const checks = mergeChecks(churchId, sourceId, survivorId);
  const claim =
    db.execute(sql`insert into person_merges(id,church_id,source_id,survivor_id,actor_id,survivor_before,choices)
    select ${receiptId},${churchId},${sourceId},${survivorId},${actorId},to_jsonb(kept),${JSON.stringify(input.choices)}::jsonb
    from persons l join persons r on r.id=${input.rightId} join persons kept on kept.id=${survivorId}
    where l.id=${input.leftId} and l.church_id=${churchId} and r.church_id=${churchId}
      and md5(to_jsonb(l)::text)=${input.leftVersion} and md5(to_jsonb(r)::text)=${input.rightVersion}
      and not (${sql.join(
        checks.map((check) => sql`(${check.condition})`),
        sql` or `
      )})
    on conflict(source_id) do nothing`);
  // Transfer a table's person columns together. A self-referral must never
  // pass through a half-transferred row that still names the retired source.
  const transfers = [
    ...new Set(personMergeReferences.map((ref) => ref.table)),
  ].map((table) => {
    const refs = personMergeReferences.filter((ref) => ref.table === table);
    return db.execute(sql`update ${sql.identifier(table)} child
      set ${sql.join(
        refs.map(
          (ref) =>
            sql`${sql.identifier(ref.column)}=case when child.${sql.identifier(ref.column)}=${sourceId} then ${survivorId}::uuid else child.${sql.identifier(ref.column)} end`
        ),
        sql`, `
      )}
      where (${sql.join(
        refs.map((ref) => sql`child.${sql.identifier(ref.column)}=${sourceId}`),
        sql` or `
      )})
        and child.church_id=${churchId} and ${applied}
        ${table === "tasks" ? sql`and child.related_type='person'` : table === "notifications" ? sql`and child.entity_type='person'` : sql``}
        ${table === "person_tags" ? sql`and not exists(select 1 from person_tags kept where kept.person_id=${survivorId} and kept.tag_id=child.tag_id)` : sql``}`);
  });
  const assignments = mergeFields.flatMap((field) =>
    field.columns.map((column) => {
      const chosenId =
        (input.choices[field.key] ?? input.survivor) === "left"
          ? input.leftId
          : input.rightId;
      return sql`${sql.identifier(persons[column].name)}=(select ${persons[column]} from ${persons} where ${persons.id}=${chosenId})`;
    })
  );
  await db.batch([
    lockPlantLeadership(churchId),
    db.execute(
      sql`select id from persons where church_id=${churchId} and id in (${sourceId},${survivorId}) order by id for update`
    ),
    claim,
    ...transfers,
    db.execute(
      sql`update persons set ${sql.join(assignments, sql`, `)}, updated_at=now() where id=${survivorId} and church_id=${churchId} and ${applied}`
    ),
    db.execute(
      sql`update persons set deleted_at=now(),updated_at=now() where id=${sourceId} and church_id=${churchId} and ${applied}`
    ),
  ]);
  const [receipt] = await db
    .select({ survivorId: personMerges.survivorId })
    .from(personMerges)
    .where(
      and(
        eq(personMerges.churchId, churchId),
        eq(personMerges.sourceId, sourceId)
      )
    );
  if (receipt?.survivorId === survivorId)
    return { success: true as const, survivorId };
  const current = await getMergeReview(churchId, input.leftId, input.rightId);
  return {
    success: false as const,
    error:
      current?.survivorBlockers[input.survivor][0] ??
      "These profiles changed during review. Refresh the review and choose again.",
  };
}

/** Old profile links remain useful without resurrecting retired people. */
export async function mergedPersonDestination(
  churchId: string,
  personId: string
) {
  const result = await db.execute<{
    id: string;
  }>(sql`with recursive destinations(id, visited) as (
    select survivor_id, array[source_id,survivor_id] from person_merges where church_id=${churchId} and source_id=${personId}
    union all select m.survivor_id, d.visited || m.survivor_id from destinations d join person_merges m on m.source_id=d.id and m.church_id=${churchId} where not m.survivor_id=any(d.visited)
  ) select p.id from destinations d join persons p on p.id=d.id where p.church_id=${churchId} and p.deleted_at is null limit 1`);
  return result.rows[0]?.id ?? null;
}
