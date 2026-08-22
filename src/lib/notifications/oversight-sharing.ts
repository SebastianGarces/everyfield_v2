import { eq, ne } from "drizzle-orm";

import { db } from "@/db";
import { churches, churchPrivacySettings } from "@/db/schema";
import type { AssociationOrgType } from "@/db/schema";
import { privacyColumnFor } from "@/lib/auth/access";
import type { PrivacyFeatureKey } from "@/lib/auth/access";
// The column set is CS-013's, read off the schema — the same one the acceptance
// writes and `canAccessFeatureData` gates on. A third spelling here is the drift
// that would let the panel write a column nothing reads.
import type { PrivacyColumn } from "@/lib/privacy/sharing-defaults";

import { announceSharingChanged } from "./oversight";
import { OVERSIGHT_ADMIN_ROWS } from "./oversight-admin";

// ============================================================================
// The plant-side sharing toggles (N-026, CS-010/011/012) — write, and the
// audience a change is announced to.
//
// SEVEN booleans on `church_privacy_settings`, per plant: the six `share_*`
// columns that gate what an oversight org may PULL, and
// `share_activity_with_oversight`, which gates what is PUSHED to it. Until #619
// only the seventh had an edit surface; the panel writes all of them through the
// one function below.
//
// THE GATES ARE NOT HERE. `canAccessFeatureData` reads the same columns at the
// moment a section is drawn, and `enqueue` reads the seventh at the moment a row
// would be written — which is what makes a flip take effect at the next read
// rather than at the next deploy. This module exists so the SETTINGS PANEL has
// somewhere to write them that is not the panel itself.
//
// READING them is `getChurchPrivacySettings` (`@/lib/auth/access`), the gate's
// own reader, used unchanged by the panel: a second read here would be a second
// opinion about what "no settings row" means.
//
// Authorisation is the caller's: the action layer refuses any seat but the
// plant's Owner (`sharing.toggle`, OWNER_ONLY). This module writes.
// ============================================================================

/** What a toggle write did — the value now stored, and whether it moved. */
export interface SharingWriteResult {
  stored: boolean;
  /**
   * FALSE for a write that landed on the value already there. Two tabs open on
   * the panel is enough to produce one: the stale tab posts `false` for a toggle
   * the other tab already closed. It matters because the coarse notice fires on
   * a CHANGE, and announcing one that did not happen would tell an org their
   * plant closed something twice.
   */
  changed: boolean;
}

/**
 * Turn one sharing toggle on or off for a plant.
 *
 * THE COLUMN IS THE READ GATE'S OWN ANSWER, written as a computed key rather
 * than chosen from a table of fragments: the key this writes IS
 * `privacyColumnFor(feature)`, the same call `canAccessFeatureData` reads back
 * through, so "the write and the read name the same column" is true by
 * construction and there is no per-column literal anywhere for a sibling's name
 * to be typed into.
 *
 * An upsert, not an update: the settings row is written at church creation, but
 * a plant created before that was true — or by a path that skipped it — must
 * still be able to opt in, and "your setting did not save and nobody said so" is
 * the worst outcome a consent control can have. `ON CONFLICT` on the unique
 * `church_id` makes the two cases one statement, so two concurrent saves settle
 * on one row rather than racing a SELECT-then-INSERT (memory/invariants.md →
 * Atomicity).
 *
 * THE INSERT ARM CARRIES ONLY THIS COLUMN, and the other six keep their schema
 * default of FALSE. That is the safe direction and it is deliberate: a first
 * write must never be able to open a toggle nobody touched.
 *
 * `setWhere` IS WHAT MAKES `changed` HONEST, and it costs no extra round trip:
 * a conflict that would not move the value updates nothing, so `RETURNING` hands
 * back no row at all. It also stops a no-op write from bumping `updated_by` and
 * `updated_at`, which for a CONSENT record is an audit trail saying somebody
 * decided something when nobody did.
 *
 * `updatedBy` is recorded because this is a consent decision: who changed it,
 * and when, is the audit trail a planter would ask us for.
 */
export async function setSharingToggle(input: {
  churchId: string;
  feature: PrivacyFeatureKey;
  enabled: boolean;
  updatedBy: string;
}): Promise<SharingWriteResult> {
  const column = privacyColumnFor(input.feature);
  const patch: Partial<Record<PrivacyColumn, boolean>> = {
    [column]: input.enabled,
  };

  const [row] = await db
    .insert(churchPrivacySettings)
    .values({ churchId: input.churchId, updatedBy: input.updatedBy, ...patch })
    .onConflictDoUpdate({
      target: churchPrivacySettings.churchId,
      set: { ...patch, updatedAt: new Date(), updatedBy: input.updatedBy },
      setWhere: ne(churchPrivacySettings[column], input.enabled),
    })
    .returning();

  // No row means the conflict arm matched and `setWhere` refused it — the value
  // was already what was asked for, so that IS the stored value.
  return row
    ? { stored: row[column], changed: true }
    : { stored: input.enabled, changed: false };
}

/** One organization that oversees a plant right now. */
export interface OverseeingOrg {
  kind: AssociationOrgType;
  orgId: string;
}

/** A plant, and who is currently owed a notice when its sharing changes. */
export interface SharingChangeAudience {
  plantName: string;
  orgs: OverseeingOrg[];
}

/**
 * WHO HEARS THAT THIS PLANT CHANGED WHAT IT SHARES (CS-012).
 *
 * BOTH ORGS, when there are two. A `share_*` column is per PLANT, not per org,
 * so turning one off closes that section for the sending church AND for the
 * network at the same instant. Telling one of them would leave the other with a
 * page that quietly lost a card and no account of why.
 *
 * The FK per org kind comes from `OVERSIGHT_ADMIN_ROWS`, so a third kind of
 * oversight org is announced to with no edit here — the same pairing table the
 * audience SQL and the anchor kinds are built from.
 *
 * `null` for a church id that names no row. A plant with no oversight returns an
 * empty `orgs`, which is "nobody", never "everybody".
 */
export async function sharingChangeAudience(
  churchId: string
): Promise<SharingChangeAudience | null> {
  const [row] = await db
    .select({
      plantName: churches.name,
      sendingChurchId: churches.sendingChurchId,
      sendingNetworkId: churches.sendingNetworkId,
    })
    .from(churches)
    .where(eq(churches.id, churchId))
    .limit(1);

  if (!row) return null;

  return {
    plantName: row.plantName,
    orgs: OVERSIGHT_ADMIN_ROWS.flatMap(([kind, { fk }]) => {
      const orgId = row[fk];
      return orgId ? [{ kind, orgId }] : [];
    }),
  };
}

/**
 * Tell every org that oversees this plant, coarsely, that it changed what it
 * shares (CS-012). Called after a toggle goes OFF, never after one goes on.
 *
 * NEVER THROWS. Consent is recorded whether or not the announcement lands, so a
 * failure here must not fail the save that caused it — the same posture every
 * milestone emitter takes (`announceMilestone`), applied to the read this one
 * needs as well as to the fan-out.
 *
 * THE DAY IS STAMPED HERE, in UTC, and it is a dedupe window rather than a fact
 * anybody reads: a planter tidying several toggles in one sitting produces one
 * row per org instead of one per toggle, which is what stops the COUNT of
 * notices from reassembling the per-toggle detail §187 ruled out. At a UTC
 * midnight a burst can straddle two days and send two coarse notices, which is
 * the harmless direction and the reason this is not worth a church-local clock.
 */
export async function announceSharingChange(churchId: string): Promise<void> {
  try {
    const audience = await sharingChangeAudience(churchId);
    if (!audience || audience.orgs.length === 0) return;

    await announceSharingChanged({
      churchId,
      plantName: audience.plantName,
      orgs: audience.orgs,
      day: new Date().toISOString().slice(0, 10),
    });
  } catch (error) {
    console.error("announcing a sharing change failed", { churchId, error });
  }
}
