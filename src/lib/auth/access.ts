import { eq, and, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  churches,
  coachAssignments,
  churchPrivacySettings,
  type User,
  type UserRole,
  type ChurchPrivacySettings,
} from "@/db/schema";

// ============================================================================
// Role Helpers
// ============================================================================

/** Roles that operate at the church-plant level */
export const CHURCH_LEVEL_ROLES: UserRole[] = [
  "planter",
  "coach",
  "team_member",
];

/** Roles that have oversight access */
export const OVERSIGHT_ROLES: UserRole[] = [
  "sending_church_admin",
  "network_admin",
];

/**
 * Check if a user has one of the specified roles.
 * @throws Error if the user does not have the required role.
 */
export function requireRole(user: User, ...allowedRoles: UserRole[]): void {
  if (!allowedRoles.includes(user.role as UserRole)) {
    throw new Error(
      `Forbidden: requires one of [${allowedRoles.join(", ")}], got "${user.role}"`
    );
  }
}

/**
 * Check if a user has a specific role (non-throwing).
 */
export function hasRole(user: User, ...roles: UserRole[]): boolean {
  return roles.includes(user.role as UserRole);
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
  const accessibleIds = await getAccessibleChurchIds(user);
  if (!accessibleIds.includes(churchId)) {
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

/** Feature keys that map to privacy toggle columns */
export type PrivacyFeatureKey =
  | "people"
  | "meetings"
  | "tasks"
  | "financials"
  | "ministry_teams"
  | "facilities";

/** Maps feature keys to their corresponding column in church_privacy_settings */
const PRIVACY_COLUMN_MAP: Record<
  PrivacyFeatureKey,
  keyof ChurchPrivacySettings
> = {
  people: "sharePeople",
  meetings: "shareMeetings",
  tasks: "shareTasks",
  financials: "shareFinancials",
  ministry_teams: "shareMinistryTeams",
  facilities: "shareFacilities",
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
  return settings[column] as boolean;
}

/**
 * For a list of church IDs, filter down to only those where the given feature
 * is shared. Useful for oversight dashboards that aggregate across churches.
 */
export async function filterChurchesByPrivacy(
  churchIds: string[],
  feature: PrivacyFeatureKey
): Promise<string[]> {
  if (churchIds.length === 0) return [];

  const column = PRIVACY_COLUMN_MAP[feature];
  const allSettings = await db
    .select()
    .from(churchPrivacySettings)
    .where(inArray(churchPrivacySettings.churchId, churchIds));

  return allSettings
    .filter((s) => s[column] === true)
    .map((s) => s.churchId);
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
