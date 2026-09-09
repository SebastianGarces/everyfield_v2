import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { users, userInvitations } from "@/db/schema";
import { tenancyColumns } from "@/lib/auth/tenancy";
import {
  accountPersonLinkStatements,
  findLinkablePersonId,
} from "@/lib/people/account-person-link";
import { InvitationError } from "./core";
import {
  describeUserInvitationForRegistration,
  hashUserInvitationToken,
} from "./seat";

export const SEAT_INVITATION_NOT_ANSWERABLE_MESSAGE =
  "This invitation cannot be accepted. It may have expired, been withdrawn, belong to another address, or your account may already hold a seat or tenancy.";

/** Lock the account before claiming an invitation: competing tokens share this row. */
export function acceptSeatInvitationStatements(
  userId: string,
  token: string,
  invitation: NonNullable<
    Awaited<ReturnType<typeof describeUserInvitationForRegistration>>
  >,
  matchedPersonId: string | null,
  account: { name: string | null; email: string },
  now: Date
) {
  if (invitation.invitedAs.kind !== "seat")
    throw new InvitationError(SEAT_INVITATION_NOT_ANSWERABLE_MESSAGE);
  const tokenHash = hashUserInvitationToken(token);
  const emptyAccount = and(
    isNull(users.seat),
    isNull(users.churchId),
    isNull(users.sendingChurchId),
    isNull(users.sendingNetworkId)
  );
  const accepted = sql`exists (select 1 from ${userInvitations}
    where ${userInvitations.id} = ${invitation.id} and ${userInvitations.tokenHash} = ${tokenHash}
      and ${userInvitations.status} = 'accepted' and ${userInvitations.respondedBy} = ${userId})`;
  const tenancy = tenancyColumns(invitation.tenancy);
  const granted = sql`exists (select 1 from ${users} where ${users.id} = ${userId}
    and ${users.seat} = ${invitation.invitedAs.seat}
    and ${users.churchId} is not distinct from ${tenancy.churchId}::uuid
    and ${users.sendingChurchId} is not distinct from ${tenancy.sendingChurchId}::uuid
    and ${users.sendingNetworkId} is not distinct from ${tenancy.sendingNetworkId}::uuid)
    and ${accepted}`;
  return [
    db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, userId))
      .for("update"),
    db.execute(sql`with claimed as (
      update ${userInvitations} set status = 'accepted', responded_by = ${userId}, responded_at = ${now.toISOString()}
      where id = ${invitation.id} and token_hash = ${tokenHash} and kind = 'seat'
        and status = 'pending' and expires_at > ${now.toISOString()}
        and exists (select 1 from ${users} where ${users.id} = ${userId}
          and lower(${users.email}) = lower(${userInvitations.inviteeEmail}) and ${emptyAccount})
      returning seat, church_id, sending_church_id, sending_network_id
    ) update ${users} set seat = claimed.seat, church_id = claimed.church_id,
      sending_church_id = claimed.sending_church_id, sending_network_id = claimed.sending_network_id,
      updated_at = ${now.toISOString()} from claimed where ${users.id} = ${userId} and ${emptyAccount}
      returning ${users.id}`),
    ...(invitation.tenancy.type === "church"
      ? accountPersonLinkStatements({
          userId,
          churchId: invitation.tenancy.id,
          name: account.name,
          email: account.email,
          matchedPersonId,
          eligible: granted,
        })
      : []),
  ] as const;
}

export async function acceptSeatInvitationAs(
  user: { id: string },
  token: string | null | undefined,
  now = new Date()
): Promise<void> {
  const invitation = await describeUserInvitationForRegistration(token, now);
  if (!invitation || invitation.invitedAs.kind !== "seat")
    throw new InvitationError(SEAT_INVITATION_NOT_ANSWERABLE_MESSAGE);
  const [account] = await db
    .select({ name: users.name, email: users.email })
    .from(users)
    .where(eq(users.id, user.id))
    .limit(1);
  if (
    !account ||
    account.email.trim().toLowerCase() !==
      invitation.inviteeEmail.trim().toLowerCase()
  )
    throw new InvitationError(SEAT_INVITATION_NOT_ANSWERABLE_MESSAGE);
  const matched =
    invitation.tenancy.type === "church"
      ? await findLinkablePersonId(invitation.tenancy.id, account.email)
      : null;
  const [, granted] = await db.batch(
    acceptSeatInvitationStatements(
      user.id,
      (token ?? "").trim(),
      invitation,
      matched,
      account,
      now
    )
  );
  if (granted.rows.length === 0)
    throw new InvitationError(SEAT_INVITATION_NOT_ANSWERABLE_MESSAGE);
}
