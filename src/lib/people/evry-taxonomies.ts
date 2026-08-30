import { sql } from "drizzle-orm";

import { db } from "@/db";
import type { EvryAuditKey } from "@/lib/evry/audit/identity";
import type { EvryEffectInput, EvryEffectResult } from "@/lib/evry/executor";

import { claimEvryPeopleEffect } from "./evry-effect";

type EffectIdentity = Pick<EvryEffectInput, "execution"> & {
  effectKey: EvryAuditKey;
};

async function hasRow(query: ReturnType<typeof sql>): Promise<boolean> {
  return (await db.execute(query)).rows.length === 1;
}

export async function claimEvryCreateTag(
  input: EffectIdentity & { name: string; color: string | null }
): Promise<EvryEffectResult> {
  return claimEvryPeopleEffect({
    ...input,
    mutation: sql`
      insert into tags (church_id, name, color, created_at)
      select e.church_id, ${input.name}, ${input.color}, transaction_timestamp()
      from eligible e
      returning 1 as affected_count, 0 as excluded_count
    `,
    targetIsCurrent: async () => true,
  });
}

export async function claimEvryUpdateTag(
  input: EffectIdentity & {
    tagId: string;
    expectedName: string;
    expectedColor: string | null;
    name: string;
    color: string | null;
  }
): Promise<EvryEffectResult> {
  const condition = sql`
    id = ${input.tagId}::uuid
    and church_id = ${input.execution.plantId}::uuid
    and name = ${input.expectedName}
    and color is not distinct from ${input.expectedColor}
  `;
  return claimEvryPeopleEffect({
    ...input,
    mutation: sql`
      update tags t
      set name = ${input.name}, color = ${input.color}
      from eligible e
      where t.id = ${input.tagId}::uuid
        and t.church_id = e.church_id
        and t.name = ${input.expectedName}
        and t.color is not distinct from ${input.expectedColor}
      returning 1 as affected_count, 0 as excluded_count
    `,
    targetIsCurrent: () => hasRow(sql`select 1 from tags where ${condition}`),
  });
}

export async function claimEvryDeleteTag(
  input: EffectIdentity & {
    tagId: string;
    expectedName: string;
    expectedColor: string | null;
    expectedPersonIds: readonly string[];
  }
): Promise<EvryEffectResult> {
  const expected = JSON.stringify([...input.expectedPersonIds].sort());
  const currentSet = sql`(
    select coalesce(jsonb_agg(pt.person_id::text order by pt.person_id::text), '[]'::jsonb)
    from person_tags pt
    where pt.church_id = ${input.execution.plantId}::uuid
      and pt.tag_id = ${input.tagId}::uuid
  ) = ${expected}::jsonb`;
  return claimEvryPeopleEffect({
    ...input,
    mutation: sql`
      delete from tags t
      using eligible e
      where t.id = ${input.tagId}::uuid
        and t.church_id = e.church_id
        and t.name = ${input.expectedName}
        and t.color is not distinct from ${input.expectedColor}
        and ${currentSet}
      returning 1 as affected_count, 0 as excluded_count
    `,
    targetIsCurrent: () =>
      hasRow(sql`
        select 1 from tags
        where id = ${input.tagId}::uuid
          and church_id = ${input.execution.plantId}::uuid
          and name = ${input.expectedName}
          and color is not distinct from ${input.expectedColor}
          and ${currentSet}
      `),
  });
}

async function claimEvryTagMembership(
  input: EffectIdentity & {
    mode: "assign" | "remove";
    personId: string;
    expectedFirstName: string;
    expectedLastName: string;
    tagId: string;
    expectedTagName: string;
    expectedTagColor: string | null;
  }
): Promise<EvryEffectResult> {
  const target = sql`
    select 1
    from persons p
    join tags t on t.id = ${input.tagId}::uuid and t.church_id = p.church_id
    where p.id = ${input.personId}::uuid
      and p.church_id = ${input.execution.plantId}::uuid
      and p.deleted_at is null
      and p.first_name = ${input.expectedFirstName}
      and p.last_name = ${input.expectedLastName}
      and t.name = ${input.expectedTagName}
      and t.color is not distinct from ${input.expectedTagColor}
      and ${input.mode === "assign" ? sql`not` : sql``} exists (
        select 1 from person_tags pt
        where pt.church_id = p.church_id and pt.person_id = p.id and pt.tag_id = t.id
      )
  `;
  const membership =
    input.mode === "assign"
      ? sql`
          insert into person_tags (church_id, person_id, tag_id, created_at)
          select e.church_id, p.id, t.id, transaction_timestamp()
          from eligible e
          join persons p on p.id = ${input.personId}::uuid
            and p.church_id = e.church_id and p.deleted_at is null
            and p.first_name = ${input.expectedFirstName}
            and p.last_name = ${input.expectedLastName}
          join tags t on t.id = ${input.tagId}::uuid
            and t.church_id = e.church_id and t.name = ${input.expectedTagName}
            and t.color is not distinct from ${input.expectedTagColor}
          where not exists (
            select 1 from person_tags current
            where current.church_id = e.church_id
              and current.person_id = p.id and current.tag_id = t.id
          )
          returning church_id, person_id
        `
      : sql`
          delete from person_tags pt
          using eligible e, persons p, tags t
          where pt.church_id = e.church_id
            and pt.person_id = ${input.personId}::uuid
            and pt.tag_id = ${input.tagId}::uuid
            and p.id = pt.person_id and p.church_id = e.church_id
            and p.deleted_at is null and p.first_name = ${input.expectedFirstName}
            and p.last_name = ${input.expectedLastName}
            and t.id = pt.tag_id and t.church_id = e.church_id
            and t.name = ${input.expectedTagName}
            and t.color is not distinct from ${input.expectedTagColor}
          returning pt.church_id, pt.person_id
        `;
  return claimEvryPeopleEffect({
    ...input,
    beforeMutation: sql`
      membership as (${membership}), activity as (
        insert into person_activities (
          church_id, person_id, activity_type, metadata, performed_by, created_at
        )
        select m.church_id, m.person_id,
          ${input.mode === "assign" ? "tag_added" : "tag_removed"},
          ${JSON.stringify({
            tagId: input.tagId,
            tagName: input.expectedTagName,
            tagColor: input.expectedTagColor,
          })}::jsonb,
          ${input.execution.actorUserId}::uuid, transaction_timestamp()
        from membership m
        returning 1
      ),
    `,
    mutation: sql`
      select 1 as affected_count, 0 as excluded_count from activity
    `,
    targetIsCurrent: () => hasRow(target),
  });
}

export const claimEvryAssignTag = (
  input: Omit<Parameters<typeof claimEvryTagMembership>[0], "mode">
) => claimEvryTagMembership({ ...input, mode: "assign" });

export const claimEvryRemoveTag = (
  input: Omit<Parameters<typeof claimEvryTagMembership>[0], "mode">
) => claimEvryTagMembership({ ...input, mode: "remove" });

type SkillSnapshot = {
  skillId: string;
  personId: string;
  expectedFirstName: string;
  expectedLastName: string;
  expectedCategory: string;
  expectedName: string;
  expectedProficiency: string | null;
  expectedNotes: string | null;
};

function skillCondition(input: EffectIdentity & SkillSnapshot) {
  return sql`
    s.id = ${input.skillId}::uuid
    and s.church_id = ${input.execution.plantId}::uuid
    and s.person_id = ${input.personId}::uuid
    and s.skill_category = ${input.expectedCategory}
    and s.skill_name = ${input.expectedName}
    and s.proficiency is not distinct from ${input.expectedProficiency}
    and s.notes is not distinct from ${input.expectedNotes}
    and exists (
      select 1 from persons p
      where p.id = s.person_id and p.church_id = s.church_id
        and p.deleted_at is null and p.first_name = ${input.expectedFirstName}
        and p.last_name = ${input.expectedLastName}
    )
  `;
}

export async function claimEvryAddSkill(
  input: EffectIdentity & {
    personId: string;
    expectedFirstName: string;
    expectedLastName: string;
    category: string;
    name: string;
    proficiency: string | null;
    notes: string | null;
  }
): Promise<EvryEffectResult> {
  return claimEvryPeopleEffect({
    ...input,
    beforeMutation: sql`
      skill as (
        insert into skills_inventory (
          church_id, person_id, skill_category, skill_name, proficiency, notes, created_at
        )
        select e.church_id, p.id, ${input.category}, ${input.name},
          ${input.proficiency}, ${input.notes}, transaction_timestamp()
        from eligible e
        join persons p on p.id = ${input.personId}::uuid
          and p.church_id = e.church_id and p.deleted_at is null
          and p.first_name = ${input.expectedFirstName}
          and p.last_name = ${input.expectedLastName}
        returning church_id, person_id
      ), activity as (
        insert into person_activities (
          church_id, person_id, activity_type, metadata, performed_by, created_at
        )
        select church_id, person_id, 'skill_added',
          ${JSON.stringify({
            skillName: input.name,
            skillCategory: input.category,
            proficiency: input.proficiency,
          })}::jsonb,
          ${input.execution.actorUserId}::uuid, transaction_timestamp()
        from skill returning 1
      ),
    `,
    mutation: sql`
      select 1 as affected_count, 0 as excluded_count from activity
    `,
    targetIsCurrent: () =>
      hasRow(sql`
        select 1 from persons
        where id = ${input.personId}::uuid
          and church_id = ${input.execution.plantId}::uuid
          and deleted_at is null and first_name = ${input.expectedFirstName}
          and last_name = ${input.expectedLastName}
      `),
  });
}

export async function claimEvryUpdateSkill(
  input: EffectIdentity &
    SkillSnapshot & {
      category: string;
      name: string;
      proficiency: string | null;
      notes: string | null;
    }
): Promise<EvryEffectResult> {
  return claimEvryPeopleEffect({
    ...input,
    beforeMutation: sql`
      skill as (
        update skills_inventory s set
          skill_category = ${input.category}, skill_name = ${input.name},
          proficiency = ${input.proficiency}, notes = ${input.notes}
        from eligible e
        where s.church_id = e.church_id and ${skillCondition(input)}
        returning s.church_id, s.person_id
      ), activity as (
        insert into person_activities (
          church_id, person_id, activity_type, metadata, performed_by, created_at
        )
        select church_id, person_id, 'skill_updated',
          ${JSON.stringify({
            skillName: input.name,
            skillCategory: input.category,
            proficiency: input.proficiency,
            previousName: input.expectedName,
            previousProficiency: input.expectedProficiency,
          })}::jsonb,
          ${input.execution.actorUserId}::uuid, transaction_timestamp()
        from skill returning 1
      ),
    `,
    mutation: sql`
      select 1 as affected_count, 0 as excluded_count from activity
    `,
    targetIsCurrent: () =>
      hasRow(
        sql`select 1 from skills_inventory s where ${skillCondition(input)}`
      ),
  });
}

export async function claimEvryRemoveSkill(
  input: EffectIdentity & SkillSnapshot
): Promise<EvryEffectResult> {
  return claimEvryPeopleEffect({
    ...input,
    beforeMutation: sql`
      skill as (
        delete from skills_inventory s using eligible e
        where s.church_id = e.church_id and ${skillCondition(input)}
        returning s.church_id, s.person_id
      ), activity as (
        insert into person_activities (
          church_id, person_id, activity_type, metadata, performed_by, created_at
        )
        select church_id, person_id, 'skill_removed',
          ${JSON.stringify({
            skillName: input.expectedName,
            skillCategory: input.expectedCategory,
          })}::jsonb,
          ${input.execution.actorUserId}::uuid, transaction_timestamp()
        from skill returning 1
      ),
    `,
    mutation: sql`
      select 1 as affected_count, 0 as excluded_count from activity
    `,
    targetIsCurrent: () =>
      hasRow(
        sql`select 1 from skills_inventory s where ${skillCondition(input)}`
      ),
  });
}
