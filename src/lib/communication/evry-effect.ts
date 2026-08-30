import { createHash } from "node:crypto";

import { sql, type SQL } from "drizzle-orm";

import { db } from "@/db";
import type { EvryAuditKey } from "@/lib/evry/audit/identity";
import type { EvryEffectInput, EvryEffectResult } from "@/lib/evry/executor";
import { claimEvryDatabaseEffect } from "@/lib/evry/executor/database-effect";

/** Re-read the exact admin-plus plant seat at the lasting-effect boundary. */
export async function actorStillHoldsCommunicationSend(
  execution: EvryEffectInput["execution"]
): Promise<boolean> {
  const result = await db.execute(sql`
    select 1
    from users actor
    where actor.id = ${execution.actorUserId}::uuid
      and actor.church_id = ${execution.plantId}::uuid
      and actor.sending_church_id is null
      and actor.sending_network_id is null
      and actor.seat in ('owner', 'admin')
    limit 1
  `);
  return result.rows.length === 1;
}

/**
 * Claim a Communication database mutation through the shared effect ledger
 * while keeping the owning workflow's admin-plus authority check in the same
 * SQL statement as the domain write.
 */
export async function claimEvryCommunicationDatabaseEffect(input: {
  execution: EvryEffectInput["execution"];
  effectKey: EvryAuditKey;
  mutation: SQL;
  targetIsCurrent(): Promise<boolean>;
}): Promise<EvryEffectResult> {
  return claimEvryDatabaseEffect({
    execution: input.execution,
    effectKey: input.effectKey,
    eligibility: sql`
      exists (
        select 1
        from users actor
        where actor.id = ${input.execution.actorUserId}::uuid
          and actor.church_id = ${input.execution.plantId}::uuid
          and actor.sending_church_id is null
          and actor.sending_network_id is null
          and actor.seat in ('owner', 'admin')
      )
    `,
    mutation: input.mutation,
    async targetIsCurrent() {
      return (
        (await actorStillHoldsCommunicationSend(input.execution)) &&
        (await input.targetIsCurrent())
      );
    },
  });
}

/** Stable database/provider identity derived only from the approved effect. */
export function communicationEvryEffectUuid(
  effectKey: string,
  purpose: string
): string {
  const digest = createHash("sha256")
    .update("evry-communication-effect-v1\0")
    .update(effectKey)
    .update("\0")
    .update(purpose)
    .digest("hex")
    .slice(0, 32)
    .split("");
  digest[12] = "4";
  digest[16] = ((Number.parseInt(digest[16] ?? "0", 16) & 0x3) | 0x8).toString(
    16
  );
  return `${digest.slice(0, 8).join("")}-${digest
    .slice(8, 12)
    .join("")}-${digest.slice(12, 16).join("")}-${digest
    .slice(16, 20)
    .join("")}-${digest.slice(20).join("")}`;
}
