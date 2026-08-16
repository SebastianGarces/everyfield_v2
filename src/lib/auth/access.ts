import { eq, and } from "drizzle-orm";
import { db } from "@/db";
import {
  churches,
  coachAssignments,
  churchPrivacySettings,
  type User,
  type UserRole,
  type ChurchPrivacySettings,
} from "@/db/schema";
// Imported for this module's OWN rules below, never re-served: `@/lib/auth/roles`
// is the one place either symbol comes from, and a re-export from here — whose
// first statement is `import { db } from "@/db"` — would give one authority
// policy two import paths, the failure `@/lib/invitations/register-path` and
// `@/lib/oversight/org-label` are both written to avoid.
import { CHURCH_LEVEL_ROLES, OVERSIGHT_ROLES } from "@/lib/auth/roles";

// ============================================================================
// Role Helpers
// ============================================================================

/**
 * Check if a user has one of the specified roles.
 * @throws Error if the user does not have the required role.
 */
export function requireRole(user: User, ...allowedRoles: UserRole[]): void {
  if (!hasRole(user, ...allowedRoles)) {
    throw new Error(
      `Forbidden: requires one of [${allowedRoles.join(", ")}], got "${user.role}"`
    );
  }
}

/**
 * Check if a user has a specific role (non-throwing).
 */
export function hasRole(user: User, ...roles: UserRole[]): boolean {
  return roles.includes(user.role);
}

/**
 * Check if a user is an oversight user (sending church admin or network admin).
 */
export function isOversightUser(user: User): boolean {
  return hasRole(user, ...OVERSIGHT_ROLES);
}

// ============================================================================
// Church Access Resolution
// ============================================================================

/**
 * Resolves all church IDs a user is authorized to access based on their role.
 *
 * - Planter/Team Member: [user.church_id]
 * - Coach: church IDs from active coach_assignments
 * - Sending Church Admin: church IDs where churches.sending_church_id matches
 * - Network Admin: church IDs where churches.sending_network_id matches
 *
 * Returns an empty array if the user has no accessible churches.
 */
export async function getAccessibleChurchIds(user: User): Promise<string[]> {
  switch (user.role) {
    case "planter":
    case "team_member":
      return user.churchId ? [user.churchId] : [];

    case "coach":
      return getCoachChurchIds(user.id);

    case "sending_church_admin":
      return getSendingChurchPlantIds(user.sendingChurchId);

    case "network_admin":
      return getNetworkChurchIds(user.sendingNetworkId);

    default:
      return [];
  }
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

/**
 * The names of the boolean toggle columns on church_privacy_settings — the
 * mapped type rejects `id`, `churchId`, `updatedAt` etc. at compile time, so a
 * mapped column is a boolean by construction and needs no runtime cast.
 */
type PrivacyColumn = {
  [K in keyof ChurchPrivacySettings]: ChurchPrivacySettings[K] extends boolean
    ? K
    : never;
}[keyof ChurchPrivacySettings];

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
 * - Church-level users (planter, team_member, coach) always have access
 *   (coach access is gated by coach_assignments, not privacy settings).
 * - Oversight users (sending_church_admin, network_admin) are subject to privacy toggles.
 */
export async function canAccessFeatureData(
  user: User,
  churchId: string,
  feature: PrivacyFeatureKey
): Promise<boolean> {
  // Church-level roles are not subject to privacy toggles
  if (hasRole(user, ...CHURCH_LEVEL_ROLES)) {
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

async function getCoachChurchIds(coachUserId: string): Promise<string[]> {
  const assignments = await db
    .select({ churchId: coachAssignments.churchId })
    .from(coachAssignments)
    .where(
      and(
        eq(coachAssignments.coachUserId, coachUserId),
        eq(coachAssignments.status, "active")
      )
    );

  return assignments.map((a) => a.churchId);
}

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
