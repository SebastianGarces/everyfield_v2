import { db } from "@/db";
import { sql } from "drizzle-orm";
import {
  churchCreationStatements,
  type ChurchCreationWrite,
  type DiscoveryPlantConsent,
} from "@/lib/onboarding/create-church";
import { lockDiscoveryAccountStatement } from "./profile-repository";

/** Every transferred fact is sourced from the retired profile, in this batch. */
export function completeDiscoveryTransferStatement(
  userId: string,
  churchId: string
) {
  return sql`with retired as (
    delete from discovery_profiles d using users u
    where d.user_id = ${userId}::uuid and u.id = d.user_id
      and u.seat = 'owner' and u.church_id = ${churchId}::uuid
      and u.sending_church_id is null and u.sending_network_id is null
    returning d.*
  ), associations as (
    select r.user_id, a.org_type, a.org_id from retired r
    cross join lateral (values ('sending_church', r.sending_church_id), ('network', r.sending_network_id)) a(org_type, org_id)
    where a.org_id is not null
  ), audited as (
    insert into association_events (subject_type, church_id, discovery_user_id, org_type, org_id, event, actor_user_id)
    select 'discovery', null::uuid, user_id, org_type, org_id, 'disassociated', user_id from associations
    union all
    select 'church', ${churchId}::uuid, null::uuid, org_type, org_id, 'associated', user_id from associations
    returning id
  ), retargeted as (
    update organization_invitations set target_user_id = null, target_church_id = ${churchId}::uuid,
      type = case type when 'discovery_to_sending_church' then 'church_to_sending_church' else 'church_to_network' end
    where target_user_id = ${userId}::uuid and status = 'pending'
      and type in ('discovery_to_sending_church', 'discovery_to_network')
      and exists (select 1 from retired)
    returning id
  ) select user_id as "userId" from retired`;
}

/** The actor/account values and new ID are server-derived; consent is parsed. */
export function discoveryPlantCreationStatements(
  write: ChurchCreationWrite,
  consent: DiscoveryPlantConsent
) {
  return [
    db.execute(lockDiscoveryAccountStatement({ id: write.plantedBy })),
    ...churchCreationStatements(write, consent),
    db.execute(
      completeDiscoveryTransferStatement(write.plantedBy, write.churchId)
    ),
  ] as const;
}
