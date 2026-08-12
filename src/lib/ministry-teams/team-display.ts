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
 * the display surfaces (card, header, org chart) show 0 — an empty bar — while
 * the health read-model counts it 100, "nothing required, nothing missing".
 * Both callers state their answer here instead of re-deriving the ratio.
 */
export function staffingPercent(
  filled: number,
  total: number,
  whenNoRoles = 0
): number {
  return total > 0 ? Math.round((filled / total) * 100) : whenNoRoles;
}
