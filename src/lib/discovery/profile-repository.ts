import { sql } from "drizzle-orm";

import { discoveryProfiles } from "../../db/schema/discovery-profile";
import { users } from "../../db/schema/user";

/** Supplied by a session-minting caller, never a client-selected target. */
type DiscoveryActor = { readonly id: string };

function unseatedAccount(actor: DiscoveryActor) {
  return sql`${users.id} = ${actor.id}
    and ${users.seat} is null
    and ${users.churchId} is null
    and ${users.sendingChurchId} is null
    and ${users.sendingNetworkId} is null`;
}

/**
 * Statement ONE in the same db.batch as a create or retirement. Keep the
 * mutation separate so it takes a fresh READ COMMITTED snapshot after waiting.
 * Association and seat writers must serialize on this same user row.
 */
export function lockDiscoveryAccountStatement(actor: DiscoveryActor) {
  return sql`select ${users.id} from ${users}
    where ${users.id} = ${actor.id} for update`;
}

/**
 * Create an empty profile only for an account with no standing. Returns its
 * user ID only on insertion; a replay is a no-op, not another conversion.
 */
export function createDiscoveryProfileStatement(actor: DiscoveryActor) {
  return sql`insert into ${discoveryProfiles} (user_id)
    select ${users.id} from ${users} where ${unseatedAccount(actor)}
    on conflict (user_id) do nothing
    returning user_id as "userId"`;
}

/** Own profile only. A stale profile cannot expose discovery for a seated user. */
export function readDiscoveryProfileStatement(actor: DiscoveryActor) {
  return sql`select
      ${discoveryProfiles.userId} as "userId",
      ${discoveryProfiles.sendingChurchId} as "sendingChurchId",
      ${discoveryProfiles.sendingNetworkId} as "sendingNetworkId"
    from ${discoveryProfiles}
    join ${users} on ${users.id} = ${discoveryProfiles.userId}
    where ${unseatedAccount(actor)}`;
}

/**
 * Seat conversion must refuse either association and retire only an empty
 * profile. This RETURNING row is the winner. To grant a seat, embed this SQL
 * as a data-modifying CTE and SELECT from its RETURNING row in the grant.
 * Never infer a winner from profile absence or a preloaded policy decision.
 *
 * Integration must add invitation token/email/expiry eligibility to the
 * retirement predicate itself, not only to a later grant: a zero-row grant
 * would otherwise leave a retired profile. This profile-only builder neither
 * consumes a token nor grants a seat and is not a seat-acceptance operation.
 * An empty result is a refusal/no-op; it does NOT abort a surrounding batch.
 */
export function retireEmptyDiscoveryProfileStatement(actor: DiscoveryActor) {
  return sql`delete from ${discoveryProfiles}
    where ${discoveryProfiles.userId} = ${actor.id}
      and ${discoveryProfiles.sendingChurchId} is null
      and ${discoveryProfiles.sendingNetworkId} is null
      and exists (select 1 from ${users} where ${unseatedAccount(actor)})
    returning user_id as "userId"`;
}
