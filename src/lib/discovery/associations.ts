import { announceDiscoveryAssociationChange } from "./association-notice";
import { and, eq, or, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  organizationInvitations,
  sendingChurches,
  sendingNetworks,
  users,
  type AssociationOrgType,
  type OrganizationInvitation,
} from "@/db/schema";
import { discoveryProfiles } from "@/db/schema/discovery-profile";
import { isOrgOwner, oversightOrgOf } from "@/lib/auth/tenancy";
import {
  InvitationError,
  isUuid,
  type InvitationActor,
} from "@/lib/invitations/core";

/** Always evaluated after locking users: conversion and relationship writes share this lock. */
export const discoveryStanding = sql`u.seat is null and u.church_id is null and u.sending_church_id is null and u.sending_network_id is null`;
const lockAccount = (userId: string) =>
  db.execute(sql`select id from users where id=${userId}::uuid for update`);
const slot = (type: AssociationOrgType) =>
  type === "network" ? sql`sending_network_id` : sql`sending_church_id`;

export async function getDiscoveryAssociations(actor: InvitationActor) {
  const result = await db.execute<{
    sendingChurchId: string | null;
    sendingChurchName: string | null;
    networkId: string | null;
    networkName: string | null;
  }>(sql`
    select p.sending_church_id as "sendingChurchId", sc.name as "sendingChurchName", p.sending_network_id as "networkId", n.name as "networkName"
    from discovery_profiles p join users u on u.id=p.user_id
    left join sending_churches sc on sc.id=p.sending_church_id
    left join sending_networks n on n.id=p.sending_network_id
    where p.user_id=${actor.id}::uuid and ${discoveryStanding}`);
  const row = result.rows[0];
  return row
    ? {
        sendingChurch: row.sendingChurchId
          ? {
              id: row.sendingChurchId,
              name: row.sendingChurchName ?? "Sending church",
            }
          : null,
        network: row.networkId
          ? { id: row.networkId, name: row.networkName ?? "Network" }
          : null,
      }
    : null;
}

export async function getPendingDiscoveryInvitations(actor: InvitationActor) {
  return db
    .select({
      id: organizationInvitations.id,
      type: organizationInvitations.type,
      expiresAt: organizationInvitations.expiresAt,
      createdAt: organizationInvitations.createdAt,
      orgName: sql<string>`coalesce(${sendingChurches.name},${sendingNetworks.name})`,
    })
    .from(organizationInvitations)
    .innerJoin(
      discoveryProfiles,
      eq(discoveryProfiles.userId, organizationInvitations.targetUserId)
    )
    .innerJoin(users, eq(users.id, discoveryProfiles.userId))
    .leftJoin(
      sendingChurches,
      eq(sendingChurches.id, organizationInvitations.sendingChurchId)
    )
    .leftJoin(
      sendingNetworks,
      eq(sendingNetworks.id, organizationInvitations.sendingNetworkId)
    )
    .where(
      and(
        eq(users.id, actor.id),
        sql`${users.seat} is null and ${users.churchId} is null and ${users.sendingChurchId} is null and ${users.sendingNetworkId} is null`,
        eq(organizationInvitations.status, "pending"),
        sql`(${organizationInvitations.expiresAt} is null or ${organizationInvitations.expiresAt}>statement_timestamp())`,
        sql`lower(${organizationInvitations.inviteeEmail})=lower(${users.email})`,
        or(
          eq(organizationInvitations.type, "discovery_to_network"),
          eq(organizationInvitations.type, "discovery_to_sending_church")
        )
      )
    );
}

export async function getDiscoveryAssociatesForOrg(actor: InvitationActor) {
  const org = oversightOrgOf(actor);
  if (!org) return [];
  return db
    .select({ userId: users.id, name: users.name, email: users.email })
    .from(discoveryProfiles)
    .innerJoin(users, eq(users.id, discoveryProfiles.userId))
    .where(
      and(
        eq(
          org.type === "network"
            ? discoveryProfiles.sendingNetworkId
            : discoveryProfiles.sendingChurchId,
          org.id
        ),
        sql`${users.seat} is null and ${users.churchId} is null and ${users.sendingChurchId} is null and ${users.sendingNetworkId} is null`
      )
    );
}

/** The claim, profile effect, and audit consume the same RETURNING winner. */
export function discoveryInvitationResponseStatement(
  actor: InvitationActor,
  invitation: OrganizationInvitation,
  response: "accepted" | "declined"
) {
  const orgType =
    invitation.type === "discovery_to_network" ? "network" : "sending_church";
  const orgId =
    orgType === "network"
      ? invitation.sendingNetworkId
      : invitation.sendingChurchId;
  if (
    !orgId ||
    !invitation.targetUserId ||
    !["discovery_to_network", "discovery_to_sending_church"].includes(
      invitation.type
    ) ||
    invitation.targetChurchId ||
    invitation.targetSendingChurchId ||
    (invitation.sendingNetworkId && invitation.sendingChurchId)
  )
    throw new InvitationError("You cannot respond to this invitation");
  return sql`with claimed as (
    update organization_invitations i set status=${response},responded_by=${actor.id}::uuid,responded_at=statement_timestamp()
    where i.id=${invitation.id}::uuid and i.status='pending' and i.type=${invitation.type}
      and i.target_user_id=${actor.id}::uuid and i.target_user_id=${invitation.targetUserId}::uuid
      and i.target_church_id is null and i.target_sending_church_id is null
      and i.sending_church_id is not distinct from ${invitation.sendingChurchId}::uuid
      and i.sending_network_id is not distinct from ${invitation.sendingNetworkId}::uuid
      and (i.expires_at is null or i.expires_at>statement_timestamp())
      and exists(select 1 from users u join discovery_profiles p on p.user_id=u.id
        where u.id=${actor.id}::uuid and lower(u.email)=lower(i.invitee_email) and ${discoveryStanding}
        ${response === "accepted" ? sql`and p.${slot(orgType)} is null` : sql``})
    returning i.*
  ), associated as (
    update discovery_profiles p set ${slot(orgType)}=${orgId}::uuid
    from claimed c where ${response === "accepted"} and p.user_id=c.target_user_id and p.${slot(orgType)} is null returning p.user_id
  ), audited as (
    insert into association_events(subject_type,discovery_user_id,org_type,org_id,event,actor_user_id,source_invitation_id)
    select 'discovery',a.user_id,${orgType},${orgId}::uuid,'associated',${actor.id}::uuid,${invitation.id}::uuid from associated a returning id
  ) select id from claimed`;
}

export async function respondDiscoveryInvitationAs(
  actor: InvitationActor,
  invitation: OrganizationInvitation,
  response: "accepted" | "declined"
): Promise<OrganizationInvitation> {
  const [, result] = await db.batch([
    lockAccount(actor.id),
    db.execute<{ id: string }>(
      discoveryInvitationResponseStatement(actor, invitation, response)
    ),
  ]);
  if (!result.rows.length)
    throw new InvitationError("This invitation is no longer available");
  const [updated] = await db
    .select()
    .from(organizationInvitations)
    .where(eq(organizationInvitations.id, invitation.id));
  const orgType =
    invitation.type === "discovery_to_network" ? "network" : "sending_church";
  const orgId =
    orgType === "network"
      ? invitation.sendingNetworkId
      : invitation.sendingChurchId;
  if (orgId)
    await announceDiscoveryAssociationChange({
      userId: actor.id,
      orgType,
      orgId,
      event: response,
      occurrence: invitation.id,
    });
  return updated;
}

export function severDiscoveryAssociationStatement(
  actor: InvitationActor,
  userId: string,
  orgType: AssociationOrgType,
  orgId: string,
  confirmation: string,
  mode: "leave" | "remove"
) {
  const orgTable =
    orgType === "network" ? sql`sending_networks` : sql`sending_churches`;
  const actorFk = slot(orgType);
  return sql`with severed as (
    update discovery_profiles p set ${slot(orgType)}=null
    where p.user_id=${userId}::uuid and p.${slot(orgType)}=${orgId}::uuid
      and exists(select 1 from users u where u.id=p.user_id and ${discoveryStanding})
      and ${mode === "leave" ? sql`p.user_id=${actor.id}::uuid and exists(select 1 from ${orgTable} o where o.id=${orgId}::uuid and o.name=${confirmation})` : sql`exists(select 1 from users manager where manager.id=${actor.id}::uuid and manager.seat='owner' and manager.${actorFk}=${orgId}::uuid and manager.church_id is null and ${orgType === "network" ? sql`manager.sending_church_id` : sql`manager.sending_network_id`} is null) and exists(select 1 from users subject where subject.id=p.user_id and coalesce(nullif(subject.name,''),subject.email)=${confirmation})`}
    returning p.user_id
  ) insert into association_events(subject_type,discovery_user_id,org_type,org_id,event,actor_user_id)
    select 'discovery',user_id,${orgType},${orgId}::uuid,'disassociated',${actor.id}::uuid from severed returning id`;
}

export async function leaveDiscoveryOrgAs(
  actor: InvitationActor,
  orgType: AssociationOrgType,
  confirmation: string
) {
  if (orgType !== "network" && orgType !== "sending_church")
    throw new InvitationError("Choose an association");
  const associations = await getDiscoveryAssociations(actor);
  const org =
    orgType === "network" ? associations?.network : associations?.sendingChurch;
  if (!org || confirmation !== org.name)
    throw new InvitationError("Type the organization name to leave");
  const [, result] = await db.batch([
    lockAccount(actor.id),
    db.execute<{ id: string }>(
      severDiscoveryAssociationStatement(
        actor,
        actor.id,
        orgType,
        org.id,
        confirmation,
        "leave"
      )
    ),
  ]);
  if (!result.rows.length)
    throw new InvitationError("This association is no longer available");
  await announceDiscoveryAssociationChange({
    userId: actor.id,
    orgType,
    orgId: org.id,
    event: "left",
    occurrence: result.rows[0].id,
  });
  return result.rows[0];
}

export async function removeDiscoveryFromOrgAs(
  actor: InvitationActor,
  userId: string,
  confirmation: string
) {
  const org = isOrgOwner(actor) ? oversightOrgOf(actor) : null;
  if (!org || !isUuid(userId))
    throw new InvitationError("You cannot remove this association");
  const [, result] = await db.batch([
    lockAccount(userId),
    db.execute<{ id: string }>(
      severDiscoveryAssociationStatement(
        actor,
        userId,
        org.type,
        org.id,
        confirmation,
        "remove"
      )
    ),
  ]);
  if (!result.rows.length)
    throw new InvitationError(
      "Type the associated account's name to remove it"
    );
  await announceDiscoveryAssociationChange({
    userId,
    orgType: org.type,
    orgId: org.id,
    event: "removed",
    occurrence: result.rows[0].id,
  });
  return result.rows[0];
}
