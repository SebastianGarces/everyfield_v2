import { eq } from "drizzle-orm";

import { db } from "@/db";
import { churchPrivacySettings } from "@/db/schema";

// ============================================================================
// The plant-side sharing toggle (N-026) — read and write.
//
// ONE boolean on `church_privacy_settings`, per plant. It is the whole of what
// a planter decides about oversight: with it off no oversight recipient is ever
// enqueued anything about this plant, with it on they get the daily summary and
// the three milestones and still nothing else.
//
// The gate itself is NOT here. `enqueue` reads the same column through
// `canAccessFeatureData` at the moment it would write a row, which is what
// makes a flip take effect at the next enqueue rather than at the next deploy.
// This module exists so the SETTINGS SCREEN has somewhere to read and write it
// that is not the screen itself.
//
// Authorisation is the caller's: the action layer checks the actor is the
// plant's planter. This module writes.
// ============================================================================

/**
 * Is this plant sharing with its sending church / network?
 *
 * An ABSENT settings row reads as `false`, matching `canAccessFeatureData`,
 * which treats a missing row as every feature closed. Absence and "off" mean
 * the same thing here and must keep meaning the same thing: a plant that
 * predates the settings table must not be sharing by accident.
 */
export async function isSharingActivityWithOversight(
  churchId: string
): Promise<boolean> {
  const [settings] = await db
    .select({ enabled: churchPrivacySettings.shareActivityWithOversight })
    .from(churchPrivacySettings)
    .where(eq(churchPrivacySettings.churchId, churchId))
    .limit(1);

  return settings?.enabled ?? false;
}

/**
 * Turn sharing on or off for a plant.
 *
 * An upsert, not an update: the settings row is written at church creation, but
 * a plant created before that was true — or by a path that skipped it — must
 * still be able to opt in, and "your setting did not save and nobody said so"
 * is the worst outcome a consent control can have. `ON CONFLICT` on the unique
 * `church_id` makes the two cases one statement, so two concurrent saves settle
 * on one row rather than racing a SELECT-then-INSERT (memory/invariants.md →
 * Atomicity).
 *
 * `updatedBy` is recorded because this is a consent decision: who changed it,
 * and when, is the audit trail a planter would ask us for.
 */
export async function setSharingActivityWithOversight(input: {
  churchId: string;
  enabled: boolean;
  updatedBy: string;
}): Promise<boolean> {
  const [row] = await db
    .insert(churchPrivacySettings)
    .values({
      churchId: input.churchId,
      shareActivityWithOversight: input.enabled,
      updatedBy: input.updatedBy,
    })
    .onConflictDoUpdate({
      target: churchPrivacySettings.churchId,
      set: {
        shareActivityWithOversight: input.enabled,
        updatedAt: new Date(),
        updatedBy: input.updatedBy,
      },
    })
    .returning({
      enabled: churchPrivacySettings.shareActivityWithOversight,
    });

  return row?.enabled ?? input.enabled;
}
