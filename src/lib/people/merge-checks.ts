import { sql, type SQL } from "drizzle-orm";
import { canLeadTeam } from "@/lib/ministry-teams/leader-eligibility";
import { personMergeReferences } from "./merge-references";

/** These same predicates explain review and guard the receipt INSERT, after
 * locks. A UI check never substitutes for a current database predicate. */
export function mergeChecks(
  churchId: string,
  sourceId: string,
  survivorId: string
) {
  const collision = (
    table: string,
    key: string,
    extra: SQL = sql`true`
  ) => sql`exists (
    select 1 from ${sql.identifier(table)} a join ${sql.identifier(table)} b
      on a.${sql.identifier(key)} = b.${sql.identifier(key)}
    where a.person_id = ${sourceId} and b.person_id = ${survivorId} and ${extra})`;
  return [
    {
      message: "Both profiles must still be active in this church.",
      condition: sql`(select count(*) from persons where church_id=${churchId} and id in (${sourceId},${survivorId}) and deleted_at is null) <> 2`,
    },
    {
      message:
        "Keep the account-linked profile. Two account-linked profiles cannot be merged.",
      condition: sql`exists(select 1 from persons where id=${sourceId} and user_id is not null)`,
    },
    {
      message:
        "Merging would change team leadership access. Reassign the team leader separately first.",
      condition: sql`exists(select 1 from ministry_teams where leader_id=${sourceId}) and (
      exists(select 1 from persons where id=${survivorId} and user_id is not null)
      or not ${canLeadTeam(churchId, survivorId)})`,
    },
    {
      message:
        "A pending RSVP link still belongs to one of these profiles. Resolve it before merging.",
      condition: sql`exists(select 1 from meeting_confirmation_tokens where person_id in (${sourceId},${survivorId}) and status='pending')`,
    },
    {
      message:
        "Both profiles have attendance for the same meeting. Those records need separate review.",
      condition: collision("meeting_attendance", "meeting_id"),
    },
    {
      message:
        "Both profiles have response cards for the same meeting. Those records need separate review.",
      condition: collision("meeting_responses", "meeting_id"),
    },
    {
      message:
        "Both profiles have a completion for the same training program. Those records need separate review.",
      condition: collision("training_completions", "training_program_id"),
    },
    {
      message:
        "Both profiles have a live follow-up on the same date. Resolve those tasks before merging.",
      condition: sql`exists(select 1 from tasks a join tasks b on a.due_date=b.due_date and a.church_id=b.church_id where a.related_type='person' and b.related_type='person' and a.related_id=${sourceId} and b.related_id=${survivorId} and a.category='follow_up' and b.category='follow_up' and a.deleted_at is null and b.deleted_at is null)`,
    },
    {
      message:
        "An invitation between these profiles would become a self-referral. Review that relationship first.",
      condition: sql`exists(select 1 from invitations where inviter_id in (${sourceId},${survivorId}) and invitee_id in (${sourceId},${survivorId}) and inviter_id <> invitee_id) or exists(select 1 from meeting_attendance where person_id in (${sourceId},${survivorId}) and invited_by_id in (${sourceId},${survivorId}) and person_id <> invited_by_id)`,
    },
    {
      message:
        "A related record has inconsistent church ownership. The merge cannot change it.",
      condition: sql`(${sql.join(
        personMergeReferences.map(
          (ref) =>
            sql`exists(select 1 from ${sql.identifier(ref.table)} where ${sql.identifier(ref.column)} in (${sourceId},${survivorId}) and church_id is distinct from ${churchId} ${"discriminator" in ref ? sql`and ${sql.identifier(ref.discriminator)}='person'` : sql``})`
        ),
        sql` or `
      )}) or exists(select 1 from person_tags p join tags t on t.id=p.tag_id where p.person_id in (${sourceId},${survivorId}) and t.church_id <> ${churchId}) or exists(select 1 from persons p join households h on h.id=p.household_id where p.id in (${sourceId},${survivorId}) and h.church_id <> ${churchId})`,
    },
  ];
}

export function blockerArray(checks: ReturnType<typeof mergeChecks>) {
  return sql<string[]>`array_remove(array[${sql.join(
    checks.map(
      (check) =>
        sql`case when ${check.condition} then ${check.message}::text end`
    ),
    sql`, `
  )}], null)`;
}
