import { eq } from "drizzle-orm";
import { db } from "@/db";
import {
  churches,
  churchPrivacySettings,
  type User,
  type ChurchPrivacySettings,
} from "@/db/schema";
import type { PrivacyColumn } from "@/lib/privacy/sharing-defaults";
// Imported for this module's OWN rules below, never re-served: `@/lib/auth/tenancy`
// is the one place these come from, and a re-export from here — whose first
// statement is `import { db } from "@/db"` — would give one authority policy two
// import paths, the failure `@/lib/invitations/register-path` and
// `@/lib/oversight/org-label` are both written to avoid.
import { isChurchLevelUser, oversightOrgOf } from "@/lib/auth/tenancy";
import { assignedChurchIds } from "@/lib/coaching/assignments";

// ============================================================================
// Church Access Resolution
// ============================================================================

/**
 * Resolves all church IDs a user is authorized to access, from the pair the
 * seat model is read as — the tenancy FK, and the seat held in it.
 *
 * - A seat in a plant (`church_id`): [user.church_id], whichever seat it is.
 * - No seat at all: the church IDs of the account's active coach assignments.
 *   A coach IS this case — coaching is an assignment, never a seat (ruling
 *   185 (2)) — and so is an account whose seat was removed, which is why the
 *   assignment lookup runs rather than an early `[]`.
 * - A seat in a sending church: church IDs where churches.sending_church_id
 *   matches. In a network: where churches.sending_network_id matches.
 *
 * THE SEAT IS NOT CONSULTED BEYOND "IS THERE ONE". Access is what the tenancy
 * reaches; the seat decides what may be DONE there, and that is `@/lib/auth/seats`'s
 * guard (#498).
 * An org Member reads the same portfolio as its Owner (ruling 185 (3)), so
 * branching on the seat here would be the wrong answer as well as a second
 * copy of a rule.
 *
 * A ROW NAMING TWO TENANCIES REACHES NOTHING, and the plant arm asks
 * `isChurchLevelUser` rather than `user.churchId` so that it does. `role` used
 * to break that tie; with it gone the two halves of this function would
 * otherwise disagree — the oversight arm refuses such a row (`oversightOrgOf`
 * answers only for exactly one tenancy) while a bare `churchId` test would hand
 * it the plant, and `canAccessFeatureData` would then privacy-gate an account
 * on its own plant. One rule, applied both ways, failing closed.
 *
 * Returns an empty array if the user has no accessible churches.
 */
export async function getAccessibleChurchIds(user: User): Promise<string[]> {
  const org = oversightOrgOf(user);
  if (org) {
    return org.type === "network"
      ? getNetworkChurchIds(org.id)
      : getSendingChurchPlantIds(org.id);
  }

  if (user.seat && user.churchId && isChurchLevelUser(user)) {
    return [user.churchId];
  }

  // DELEGATED, NOT DUPLICATED (#496). "Which plants does this coach reach" is
  // one question with one answer, and `@/lib/coaching/assignments` owns it — the
  // nav section, the coached-plant page and this check now read the same
  // `WHERE`, so an assignment that is live for one of them is live for all three.
  return assignedChurchIds(user.id);
}

/**
 * Check if a user can access a specific church's data.
 * @throws Error if the user does not have access.
 */
export async function requireChurchAccess(
  user: User,
  churchId: string
): Promise<void> {
  if (!(await canAccessChurch(user, churchId))) {
    throw new Error("Forbidden: no access to this church");
  }
}

/**
 * Check if a user can access a specific church's data (non-throwing).
 */
export async function canAccessChurch(
  user: User,
  churchId: string
): Promise<boolean> {
  const accessibleIds = await getAccessibleChurchIds(user);
  return accessibleIds.includes(churchId);
}

// ============================================================================
// Privacy Controls
// ============================================================================

/**
 * Feature keys that map to privacy toggle columns.
 *
 * The first six gate what an oversight user may PULL — a dashboard read.
 * `oversight_activity` gates what is PUSHED to them (F11 N-026): the daily
 * activity summary and two of the FIVE milestones (`oversightMilestoneKinds`) —
 * a phase advance and a launch date, the two that are facts about the plant's
 * own progress. The other THREE are exempt, each being the org's own
 * relationship changing: an invitation accepted, an invitation declined, an
 * association ended (`OVERSIGHT_SHARING_EXEMPT_TYPES` — ruled 2026-08-01 for
 * the accept, extended to the other two by #304 / OV-006 + OV-007).
 *
 * It gates nothing at all in the other direction. `association.removed_by_org`
 * (`src/lib/notifications/plant-association.ts`) tells a PLANTER that their
 * oversight org removed them; it is addressed to a church-level role, so
 * neither this key nor the oversight category allow-list is consulted for it.
 *
 * It supersedes the per-category `phase` and `digest` keys: under the
 * 2026-07-27 ruling oversight has no per-category notification eligibility left
 * to gate.
 *
 * The two per-category toggles 0026 added were dropped by the #255 contract
 * migration after 0029's expand window closed. What this type governs is
 * what the shipped code READS.
 */
export type PrivacyFeatureKey =
  | "people"
  | "meetings"
  | "tasks"
  | "financials"
  | "ministry_teams"
  | "facilities"
  | "oversight_activity";

// The toggle column set is `@/lib/privacy/sharing-defaults`'s, imported rather than declared
// twice: CS-013's accept writes exactly the columns this map gates, so a second
// spelling of "which columns are toggles" is the drift that would let the two
// disagree about #62's wiki row. #619's panel WRITES those same columns through
// `privacyColumnFor` below, so all three — the accept, the panel and this gate —
// now name one set.

/** Maps feature keys to their corresponding column in church_privacy_settings */
const PRIVACY_COLUMN_MAP: Record<PrivacyFeatureKey, PrivacyColumn> = {
  people: "sharePeople",
  meetings: "shareMeetings",
  tasks: "shareTasks",
  financials: "shareFinancials",
  ministry_teams: "shareMinistryTeams",
  facilities: "shareFacilities",
  oversight_activity: "shareActivityWithOversight",
};

/**
 * The column a feature key gates on — the read gate's own answer, exported so
 * the WRITE side cannot keep a second opinion.
 *
 * `setSharingToggle` (`@/lib/notifications/oversight-sharing`) flips exactly the
 * column `canAccessFeatureData` will read back, because both ask this. A write
 * path with its own feature→column map is how a toggle comes to save the wrong
 * consent.
 */
export function privacyColumnFor(feature: PrivacyFeatureKey): PrivacyColumn {
  return PRIVACY_COLUMN_MAP[feature];
}

/**
 * Get privacy settings for a church.
 * Returns default (all false) if no settings record exists.
 */
export async function getChurchPrivacySettings(
  churchId: string
): Promise<ChurchPrivacySettings | null> {
  const [settings] = await db
    .select()
    .from(churchPrivacySettings)
    .where(eq(churchPrivacySettings.churchId, churchId))
    .limit(1);

  return settings ?? null;
}

/**
 * Check if an oversight user is allowed to see a specific feature's data
 * for a given church, based on the church's privacy settings.
 *
 * - Church-level accounts — a seat in a plant, or a coach with no tenancy —
 *   always have access (coach access is gated by coach_assignments, not by
 *   privacy settings).
 * - Accounts whose tenancy is an oversight org are subject to privacy toggles,
 *   whichever seat they hold in it.
 */
export async function canAccessFeatureData(
  user: User,
  churchId: string,
  feature: PrivacyFeatureKey
): Promise<boolean> {
  // Church-level accounts are not subject to privacy toggles
  if (isChurchLevelUser(user)) {
    return true;
  }

  // Oversight users: check privacy settings
  const settings = await getChurchPrivacySettings(churchId);

  // No settings record = all defaults to false = no access
  if (!settings) {
    return false;
  }

  const column = PRIVACY_COLUMN_MAP[feature];
  return settings[column];
}

// ============================================================================
// Internal Helpers
// ============================================================================

async function getSendingChurchPlantIds(
  sendingChurchId: string | null
): Promise<string[]> {
  if (!sendingChurchId) return [];

  const plants = await db
    .select({ id: churches.id })
    .from(churches)
    .where(eq(churches.sendingChurchId, sendingChurchId));

  return plants.map((p) => p.id);
}

async function getNetworkChurchIds(
  sendingNetworkId: string | null
): Promise<string[]> {
  if (!sendingNetworkId) return [];

  const networkChurches = await db
    .select({ id: churches.id })
    .from(churches)
    .where(eq(churches.sendingNetworkId, sendingNetworkId));

  return networkChurches.map((c) => c.id);
}
