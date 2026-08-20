import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { sendingChurches, sendingNetworks, users } from "@/db/schema";
import type { AssociationOrgType } from "@/db/schema";

import {
  enqueue,
  type EnqueueNotificationInput,
  type EnqueueResult,
} from "./enqueue";

// ============================================================================
// What the PLANT is told about its own oversight relationship (#304, OV-007b).
//
// Everything else in this folder that mentions oversight composes messages FOR
// an oversight admin, under the two questions that govern them — is the category
// oversight-eligible, and has the plant consented. This file is the other
// direction, and it is the ordinary one:
//
//   * the recipient is the plant's OWNER, a church-level account whose
//     `canAccessChurch` on their own plant is true by construction;
//   * `enqueue`'s gates 2 and 3 (`OVERSIGHT_ELIGIBLE_CATEGORIES`, the
//     `share_activity_with_oversight` toggle) are asked only of oversight
//     recipients, so neither applies here. A plant's own consent setting governs
//     what leaves the plant; it was never a switch for muting news about the
//     plant's own association.
//
// Hence a plain `association.*` type rather than an `oversight.milestone.*` one.
// That is not cosmetic: the two exemption lists in `./categories.ts` are keyed on
// type strings, and a message to a planter must not be able to match one of them.
//
// NO `"use server"` DIRECTIVE, like every other module here — see `./oversight.ts`.
//
// BEST-EFFORT AT THE CALL SITE. `removePlantFromOrgAs` calls this AFTER the sever
// commits and swallows failures: a notification must not be able to undo, or
// fail, the write that caused it (`memory/invariants.md` → Atomicity). The order
// matters for the message too — announcing first would tell a planter they had
// been removed while they still had not been.
// ============================================================================

/**
 * The notification `type` for "your oversight org removed you".
 *
 * Deliberately NOT under the `oversight.milestone.` prefix: everything with that
 * prefix is addressed to an oversight admin and two of them carry consent or
 * tenancy exemptions (`OVERSIGHT_SHARING_EXEMPT_TYPES`,
 * `OVERSIGHT_OWN_RELATIONSHIP_TYPES`). This one is addressed to a planter and
 * needs neither, so it must not be able to collide with either list.
 */
export const ASSOCIATION_REMOVED_TYPE = "association.removed_by_org";

/** How the plant's own screens name the two kinds of oversight org. */
const ORG_NOUN: Record<AssociationOrgType, string> = {
  sending_church: "sending church",
  network: "network",
};

/** One recipient inside the plant. */
export interface PlantRecipient {
  id: string;
}

/** What a removal announcement is composed from. */
export interface RemovedFromOrgFacts {
  churchId: string;
  /** The org that removed them — the one whose FK was just nulled. */
  orgType: AssociationOrgType;
  orgId: string;
  /**
   * What makes this event unique: the `association_events` row's id. A plant
   * that is removed, re-invited and removed again is two distinct events rather
   * than one swallowed by a permanent dedupe key.
   */
  occurrence: string;
}

/** What a fan-out did, without throwing. Mirrors `OversightFanOutReport`. */
export interface PlantNotifyReport {
  considered: number;
  recorded: number;
  created: number;
  skipped: number;
  failed: number;
}

const emptyReport = (): PlantNotifyReport => ({
  considered: 0,
  recorded: 0,
  created: 0,
  skipped: 0,
  failed: 0,
});

export interface PlantAssociationDeps {
  /** The real `enqueue` — the gate, and the only writer. */
  enqueue(input: EnqueueNotificationInput): Promise<EnqueueResult>;
  /**
   * WHO inside the plant is told — the Owner, or nobody.
   *
   * SINGULAR SINCE #494. `users_church_owner_unique_idx` makes a second Owner
   * unwritable, so "the plant's Owner" is at most one row and a list was a
   * shape the database can no longer produce. A plant with no Owner is a real
   * state (OB-004's `no_planter`), which is why the answer is nullable rather
   * than assumed.
   */
  plantOwner(churchId: string): Promise<PlantRecipient | null>;
  /** The removing org's display name, or null when it does not resolve. */
  resolveOrgName(
    orgType: AssociationOrgType,
    orgId: string
  ): Promise<string | null>;
}

/**
 * Title + body + dedupe key. Pure, so the promise this makes to a planter is
 * testable on its own — the reason every emitter in `./oversight.ts` is too.
 *
 * THE COPY HAS THREE JOBS, in this order: say what happened in the planter's own
 * terms, say what actually changed, and say what did not. A bare "removed" reads
 * as a punishment or a bug, and the planter's next move — checking whether their
 * own data survived — is the one thing the message can settle immediately. The
 * last sentence exists because re-joining is not something they can do from their
 * side: only the org can invite them back, and a planter who does not know that
 * will look for a button that is not there.
 */
export function composeRemovedFromOrg(
  facts: RemovedFromOrgFacts & { orgName: string },
  recipientUserId: string
): EnqueueNotificationInput {
  return {
    churchId: facts.churchId,
    recipientUserId,
    category: "milestones",
    type: ASSOCIATION_REMOVED_TYPE,
    title: `${facts.orgName} ended your association`,
    body: `Your plant is no longer part of this ${ORG_NOUN[facts.orgType]}. It has stopped appearing in their directory and they receive no further updates about you. Nothing in your own plant changed — your people, meetings and tasks are untouched. Only they can invite you back.`,
    // One key per EVENT, shared across recipients: the partial unique index is on
    // (church_id, recipient_user_id, dedupe_key), so a second planter still gets
    // their own row while a replay of the emitter writes nothing.
    dedupeKey: `${ASSOCIATION_REMOVED_TYPE}:${facts.churchId}:${facts.occurrence}`,
  };
}

/**
 * Tell the plant's planter that an oversight org removed them (OV-007b).
 *
 * Never throws — the sever it follows has already committed. An org whose name
 * does not resolve announces NOTHING rather than a message with a blank
 * counterparty: "someone removed you" is worse than silence, because it cannot
 * be acted on.
 */
export async function announceRemovedFromOversightOrg(
  facts: RemovedFromOrgFacts,
  deps: PlantAssociationDeps = dbPlantAssociationDeps
): Promise<PlantNotifyReport> {
  const report = emptyReport();

  try {
    const orgName = await deps.resolveOrgName(facts.orgType, facts.orgId);
    if (!orgName) return report;

    // ONE RECIPIENT, so no loop and no per-recipient catch. Both existed to
    // stop one recipient's failure costing the others theirs; with at most one
    // Owner there are no others, and the outer catch below already keeps a
    // failure from costing the caller its sever.
    const owner = await deps.plantOwner(facts.churchId);
    if (!owner) return report;

    report.considered = 1;

    const result = await deps.enqueue(
      composeRemovedFromOrg({ ...facts, orgName }, owner.id)
    );
    if (result.status === "recorded") {
      report.recorded += 1;
      if (result.created) report.created += 1;
    } else {
      report.skipped += 1;
    }
  } catch (error) {
    report.failed = report.considered - report.recorded - report.skipped;
    console.error("plant association announcement failed", {
      churchId: facts.churchId,
      orgType: facts.orgType,
      error,
    });
  }

  return report;
}

// ----------------------------------------------------------------------------
// Production wiring
// ----------------------------------------------------------------------------

/**
 * The plant's Owner, or null.
 *
 * The SEAT is in the statement, not filtered afterwards: OV-010 makes the
 * Owner the plant's decision-maker for its associations (AS-003), so they are
 * the person this concerns. ONE ROW AT MOST, and the return type says so —
 * `users_church_owner_unique_idx` is what makes that true, rather than the
 * query hoping for it. A plant with no Owner answers null, which is OB-004's
 * `no_planter` and not an error. A projection rather than `select()` — answering "who"
 * must not pull `password_hash` into application memory (the same reasoning as
 * `accessColumns` in `./enqueue.ts`).
 */
export async function plantOwnerOfChurch(
  churchId: string
): Promise<PlantRecipient | null> {
  const [owner] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.churchId, churchId), eq(users.seat, "owner")))
    .limit(1);

  return owner ?? null;
}

/**
 * The removing org's name, from the table its KIND names — never a coalesce over
 * both, which would name a sending church for a network id that happened to
 * collide.
 */
export async function resolveOversightOrgName(
  orgType: AssociationOrgType,
  orgId: string
): Promise<string | null> {
  if (orgType === "sending_church") {
    const [org] = await db
      .select({ name: sendingChurches.name })
      .from(sendingChurches)
      .where(eq(sendingChurches.id, orgId))
      .limit(1);
    return org?.name ?? null;
  }

  const [org] = await db
    .select({ name: sendingNetworks.name })
    .from(sendingNetworks)
    .where(eq(sendingNetworks.id, orgId))
    .limit(1);
  return org?.name ?? null;
}

export const dbPlantAssociationDeps: PlantAssociationDeps = {
  enqueue,
  plantOwner: plantOwnerOfChurch,
  resolveOrgName: resolveOversightOrgName,
};
