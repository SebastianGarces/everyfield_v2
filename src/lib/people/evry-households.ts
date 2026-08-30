import { sql } from "drizzle-orm";

import { db } from "@/db";
import type { EvryAuditKey } from "@/lib/evry/audit/identity";
import type { EvryEffectInput, EvryEffectResult } from "@/lib/evry/executor";

import { claimEvryPeopleEffect } from "./evry-effect";

type EffectIdentity = Pick<EvryEffectInput, "execution"> & {
  effectKey: EvryAuditKey;
};

export type EvryAddressSnapshot = Readonly<{
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  country: string | null;
}>;

export type EvryHouseholdSnapshot = EvryAddressSnapshot &
  Readonly<{ name: string }>;

export type EvryHouseholdMemberSnapshot = EvryAddressSnapshot &
  Readonly<{
    personId: string;
    firstName: string;
    lastName: string;
    householdId: string | null;
    householdRole: string | null;
  }>;

async function hasRow(query: ReturnType<typeof sql>): Promise<boolean> {
  return (await db.execute(query)).rows.length === 1;
}

function householdSnapshot(alias: ReturnType<typeof sql>) {
  return sql`jsonb_build_object(
    'name', ${alias}.name,
    'addressLine1', ${alias}.address_line1, 'addressLine2', ${alias}.address_line2,
    'city', ${alias}.city, 'state', ${alias}.state,
    'postalCode', ${alias}.postal_code, 'country', ${alias}.country
  )`;
}

function memberSnapshot(alias: ReturnType<typeof sql>) {
  return sql`jsonb_build_object(
    'personId', ${alias}.id::text, 'firstName', ${alias}.first_name,
    'lastName', ${alias}.last_name, 'householdId', ${alias}.household_id::text,
    'householdRole', ${alias}.household_role,
    'addressLine1', ${alias}.address_line1, 'addressLine2', ${alias}.address_line2,
    'city', ${alias}.city, 'state', ${alias}.state,
    'postalCode', ${alias}.postal_code, 'country', ${alias}.country
  )`;
}

export async function claimEvryCreateHouseholdWithHead(
  input: EffectIdentity & {
    person: EvryHouseholdMemberSnapshot;
    householdId: string;
    householdName: string;
    usePersonAddress: boolean;
  }
): Promise<EvryEffectResult> {
  const personJson = JSON.stringify(input.person);
  const address = input.usePersonAddress
    ? input.person
    : {
        addressLine1: null,
        addressLine2: null,
        city: null,
        state: null,
        postalCode: null,
        country: "US",
      };
  return claimEvryPeopleEffect({
    ...input,
    beforeMutation: sql`
      created_household as (
        insert into households (
          id, church_id, name, address_line1, address_line2, city, state,
          postal_code, country, created_at, updated_at
        )
        select ${input.householdId}::uuid, e.church_id, ${input.householdName},
          ${address.addressLine1}, ${address.addressLine2}, ${address.city},
          ${address.state}, ${address.postalCode}, ${address.country},
          transaction_timestamp(), transaction_timestamp()
        from eligible e join persons p
          on p.church_id = e.church_id and p.id = ${input.person.personId}::uuid
        where p.deleted_at is null and ${memberSnapshot(sql`p`)} = ${personJson}::jsonb
        returning church_id, id
      ), updated_person as (
        update persons p set household_id = h.id, household_role = 'head',
          updated_at = transaction_timestamp()
        from created_household h
        where p.id = ${input.person.personId}::uuid and p.church_id = h.church_id
          and p.deleted_at is null and ${memberSnapshot(sql`p`)} = ${personJson}::jsonb
        returning p.church_id, p.id
      ), activity as (
        insert into person_activities (
          church_id, person_id, activity_type, metadata, performed_by, created_at
        )
        select church_id, id, 'household_created',
          ${JSON.stringify({
            householdName: input.householdName,
            householdId: input.householdId,
            role: "head",
          })}::jsonb,
          ${input.execution.actorUserId}::uuid, transaction_timestamp()
        from updated_person returning 1
      ),
    `,
    mutation: sql`select 2 as affected_count, 0 as excluded_count from activity`,
    targetIsCurrent: () =>
      hasRow(sql`
        select 1 from persons p
        where p.id = ${input.person.personId}::uuid
          and p.church_id = ${input.execution.plantId}::uuid
          and p.deleted_at is null and ${memberSnapshot(sql`p`)} = ${personJson}::jsonb
          and not exists (select 1 from households where id = ${input.householdId}::uuid)
      `),
  });
}

export async function claimEvryUpdateHousehold(
  input: EffectIdentity & {
    householdId: string;
    before: EvryHouseholdSnapshot;
    after: EvryHouseholdSnapshot;
  }
): Promise<EvryEffectResult> {
  const beforeJson = JSON.stringify(input.before);
  const after = input.after;
  return claimEvryPeopleEffect({
    ...input,
    mutation: sql`
      update households h set name = ${after.name},
        address_line1 = ${after.addressLine1}, address_line2 = ${after.addressLine2},
        city = ${after.city}, state = ${after.state}, postal_code = ${after.postalCode},
        country = ${after.country}, updated_at = transaction_timestamp()
      from eligible e
      where h.id = ${input.householdId}::uuid and h.church_id = e.church_id
        and ${householdSnapshot(sql`h`)} = ${beforeJson}::jsonb
      returning 1 as affected_count, 0 as excluded_count
    `,
    targetIsCurrent: () =>
      hasRow(sql`
        select 1 from households h where h.id = ${input.householdId}::uuid
          and h.church_id = ${input.execution.plantId}::uuid
          and ${householdSnapshot(sql`h`)} = ${beforeJson}::jsonb
      `),
  });
}

export async function claimEvryDeleteHousehold(
  input: EffectIdentity & {
    householdId: string;
    household: EvryHouseholdSnapshot;
  }
): Promise<EvryEffectResult> {
  const householdJson = JSON.stringify(input.household);
  return claimEvryPeopleEffect({
    ...input,
    mutation: sql`
      delete from households h using eligible e
      where h.id = ${input.householdId}::uuid and h.church_id = e.church_id
        and ${householdSnapshot(sql`h`)} = ${householdJson}::jsonb
        and not exists (
          select 1 from persons p where p.church_id = e.church_id
            and p.household_id = h.id and p.deleted_at is null
        )
      returning 1 as affected_count, 0 as excluded_count
    `,
    targetIsCurrent: () =>
      hasRow(sql`
        select 1 from households h where h.id = ${input.householdId}::uuid
          and h.church_id = ${input.execution.plantId}::uuid
          and ${householdSnapshot(sql`h`)} = ${householdJson}::jsonb
          and not exists (
            select 1 from persons p where p.church_id = h.church_id
              and p.household_id = h.id and p.deleted_at is null
          )
      `),
  });
}

export async function claimEvryAddToHousehold(
  input: EffectIdentity & {
    person: EvryHouseholdMemberSnapshot;
    householdId: string;
    household: EvryHouseholdSnapshot;
    role: string;
    afterAddress: EvryAddressSnapshot;
  }
): Promise<EvryEffectResult> {
  const personJson = JSON.stringify(input.person);
  const householdJson = JSON.stringify(input.household);
  const after = input.afterAddress;
  return claimEvryPeopleEffect({
    ...input,
    beforeMutation: sql`
      updated_person as (
        update persons p set household_id = h.id, household_role = ${input.role},
          address_line1 = ${after.addressLine1}, address_line2 = ${after.addressLine2},
          city = ${after.city}, state = ${after.state}, postal_code = ${after.postalCode},
          country = ${after.country}, updated_at = transaction_timestamp()
        from eligible e join households h on h.church_id = e.church_id
        where h.id = ${input.householdId}::uuid
          and ${householdSnapshot(sql`h`)} = ${householdJson}::jsonb
          and p.id = ${input.person.personId}::uuid and p.church_id = e.church_id
          and p.deleted_at is null and ${memberSnapshot(sql`p`)} = ${personJson}::jsonb
        returning p.church_id, p.id
      ), activity as (
        insert into person_activities (
          church_id, person_id, activity_type, metadata, performed_by, created_at
        )
        select church_id, id, 'household_joined',
          ${JSON.stringify({
            householdName: input.household.name,
            householdId: input.householdId,
            role: input.role,
          })}::jsonb,
          ${input.execution.actorUserId}::uuid, transaction_timestamp()
        from updated_person returning 1
      ),
    `,
    mutation: sql`select 1 as affected_count, 0 as excluded_count from activity`,
    targetIsCurrent: () =>
      hasRow(sql`
        select 1 from persons p cross join households h
        where p.id = ${input.person.personId}::uuid
          and p.church_id = ${input.execution.plantId}::uuid
          and p.deleted_at is null and ${memberSnapshot(sql`p`)} = ${personJson}::jsonb
          and h.id = ${input.householdId}::uuid and h.church_id = p.church_id
          and ${householdSnapshot(sql`h`)} = ${householdJson}::jsonb
      `),
  });
}

export async function claimEvryRemoveFromHousehold(
  input: EffectIdentity & {
    person: EvryHouseholdMemberSnapshot;
    household: EvryHouseholdSnapshot;
  }
): Promise<EvryEffectResult> {
  const personJson = JSON.stringify(input.person);
  const householdJson = JSON.stringify(input.household);
  return claimEvryPeopleEffect({
    ...input,
    beforeMutation: sql`
      updated_person as (
        update persons p set household_id = null, household_role = null,
          updated_at = transaction_timestamp()
        from eligible e join households h on h.church_id = e.church_id
        where h.id = ${input.person.householdId}::uuid
          and ${householdSnapshot(sql`h`)} = ${householdJson}::jsonb
          and p.id = ${input.person.personId}::uuid and p.church_id = e.church_id
          and p.deleted_at is null and ${memberSnapshot(sql`p`)} = ${personJson}::jsonb
        returning p.church_id, p.id
      ), activity as (
        insert into person_activities (
          church_id, person_id, activity_type, metadata, performed_by, created_at
        )
        select church_id, id, 'household_left',
          ${JSON.stringify({
            householdName: input.household.name,
            householdId: input.person.householdId,
          })}::jsonb,
          ${input.execution.actorUserId}::uuid, transaction_timestamp()
        from updated_person returning 1
      ),
    `,
    mutation: sql`select 1 as affected_count, 0 as excluded_count from activity`,
    targetIsCurrent: () =>
      hasRow(sql`
        select 1 from persons p join households h on h.id = p.household_id
        where p.id = ${input.person.personId}::uuid
          and p.church_id = ${input.execution.plantId}::uuid
          and p.deleted_at is null and ${memberSnapshot(sql`p`)} = ${personJson}::jsonb
          and h.church_id = p.church_id and ${householdSnapshot(sql`h`)} = ${householdJson}::jsonb
      `),
  });
}

export async function claimEvryPropagateHouseholdAddress(
  input: EffectIdentity & {
    householdId: string;
    household: EvryHouseholdSnapshot;
    members: readonly EvryHouseholdMemberSnapshot[];
  }
): Promise<EvryEffectResult> {
  const householdJson = JSON.stringify(input.household);
  const membersJson = JSON.stringify(input.members);
  const count = input.members.length;
  return claimEvryPeopleEffect({
    ...input,
    beforeMutation: sql`
      requested as materialized (
        select value as snapshot, (value->>'personId')::uuid as person_id
        from jsonb_array_elements(${membersJson}::jsonb)
      ), exact_members as materialized (
        select p.id
        from requested r join persons p on p.id = r.person_id
        join eligible e on e.church_id = p.church_id
        join households h on h.id = ${input.householdId}::uuid and h.church_id = e.church_id
        where p.deleted_at is null and p.household_id = h.id
          and ${memberSnapshot(sql`p`)} = r.snapshot
          and ${householdSnapshot(sql`h`)} = ${householdJson}::jsonb
          and (select count(*) from persons current
            where current.church_id = e.church_id and current.household_id = h.id
              and current.deleted_at is null) = ${count}
      ), updated_members as (
        update persons p set address_line1 = ${input.household.addressLine1},
          address_line2 = ${input.household.addressLine2}, city = ${input.household.city},
          state = ${input.household.state}, postal_code = ${input.household.postalCode},
          country = ${input.household.country}, updated_at = transaction_timestamp()
        from exact_members m where p.id = m.id
          and (select count(*) from exact_members) = ${count}
          and (select count(*) from requested) = ${count}
        returning 1
      ),
    `,
    mutation: sql`
      select count(*)::integer as affected_count, 0 as excluded_count
      from updated_members having count(*) = ${count}
    `,
    targetIsCurrent: () =>
      hasRow(sql`
        with requested as (
          select value as snapshot, (value->>'personId')::uuid as person_id
          from jsonb_array_elements(${membersJson}::jsonb)
        )
        select 1 from households h join requested r on true
        join persons p on p.id = r.person_id and p.church_id = h.church_id
        where h.id = ${input.householdId}::uuid
          and h.church_id = ${input.execution.plantId}::uuid
          and ${householdSnapshot(sql`h`)} = ${householdJson}::jsonb
          and p.deleted_at is null and p.household_id = h.id
          and ${memberSnapshot(sql`p`)} = r.snapshot
          and (select count(*) from persons current
            where current.church_id = h.church_id and current.household_id = h.id
              and current.deleted_at is null) = ${count}
        having count(*) = ${count}
      `),
  });
}
