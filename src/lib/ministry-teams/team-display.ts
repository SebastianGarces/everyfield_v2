import {
  Baby,
  Building,
  Crown,
  Handshake,
  Heart,
  Megaphone,
  Monitor,
  Music,
  Rocket,
  Users,
  type LucideIcon,
} from "lucide-react";

/**
 * The one map from a team's stored `icon` slug to its Lucide icon. Rendered by
 * the team card, the team detail header and the org chart — a template rename
 * (#378) or a new icon lands in all three because there is only this copy.
 * Unknown or missing slugs fall back to `Users` at the call sites.
 */
export const TEAM_ICONS: Record<string, LucideIcon> = {
  crown: Crown,
  rocket: Rocket,
  music: Music,
  baby: Baby,
  building: Building,
  handshake: Handshake,
  users: Users,
  megaphone: Megaphone,
  heart: Heart,
  monitor: Monitor,
};

/**
 * The one staffing-percent derivation: filled roles over total roles, rounded.
 *
 * `whenNoRoles` names the deliberate divergence for a team with zero roles:
 * the team-detail header shows 0 — an empty bar — while the card and org chart
 * use `teamStaffingDisplay` to say "No roles defined". The health read-model
 * counts it 100, "nothing required, nothing missing". Each caller states its
 * answer here instead of re-deriving the ratio.
 */
export function staffingPercent(
  filled: number,
  total: number,
  whenNoRoles = 0
): number {
  return total > 0 ? Math.round((filled / total) * 100) : whenNoRoles;
}

type ConfiguredStaffingLevel = "red" | "yellow" | "green";

/**
 * The staffing signal a team-management display shows. A team without roles
 * is not understaffed: it is not configured yet, so it gets copy rather than
 * the zero-percent warning that applies to a configured team.
 */
export type TeamStaffingDisplay =
  | {
      kind: "no_roles";
      percentage: 0;
      label: "No roles defined";
    }
  | {
      kind: "configured";
      percentage: number;
      level: ConfiguredStaffingLevel;
    };

export function teamStaffingDisplay(
  filled: number,
  total: number
): TeamStaffingDisplay {
  if (total === 0) {
    return { kind: "no_roles", percentage: 0, label: "No roles defined" };
  }

  const percentage = staffingPercent(filled, total);
  const level = percentage < 40 ? "red" : percentage < 60 ? "yellow" : "green";

  return { kind: "configured", percentage, level };
}
