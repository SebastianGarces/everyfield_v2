/**
 * Shared status badge configuration.
 * Single source of truth for status colors and variants used across
 * person-card, person-header, and person-status-card. Labels come from
 * STATUS_LABELS (status.shared.ts) — the one label map in the domain.
 */

import type { PersonStatus } from "@/lib/people/types";
import { STATUS_LABELS } from "./status.shared";

export type StatusBadgeConfig = {
  label: string;
  className: string;
  variant: "secondary" | "default";
  /** Icon identifier — components render the actual icon element */
  icon?: "rocket" | "star";
};

export const STATUS_BADGE_CONFIG: Record<PersonStatus, StatusBadgeConfig> = {
  prospect: {
    label: STATUS_LABELS.prospect,
    className: "",
    variant: "secondary",
  },
  attendee: {
    label: STATUS_LABELS.attendee,
    className: "bg-blue-500 hover:bg-blue-600",
    variant: "default",
  },
  following_up: {
    label: STATUS_LABELS.following_up,
    className: "bg-yellow-500 text-white hover:bg-yellow-600",
    variant: "default",
  },
  interviewed: {
    label: STATUS_LABELS.interviewed,
    className: "bg-purple-500 hover:bg-purple-600",
    variant: "default",
  },
  core_group: {
    label: STATUS_LABELS.core_group,
    className: "bg-emerald-600 hover:bg-emerald-700",
    variant: "default",
  },
  launch_team: {
    label: STATUS_LABELS.launch_team,
    className: "bg-blue-600 hover:bg-blue-700",
    variant: "default",
    icon: "rocket",
  },
  leader: {
    label: STATUS_LABELS.leader,
    className: "bg-amber-500 hover:bg-amber-600",
    variant: "default",
    icon: "star",
  },
};

/**
 * Status descriptions for tooltip / detail views.
 * Kept separate since only the status card sidebar uses these.
 */
export const STATUS_DESCRIPTIONS: Record<PersonStatus, string> = {
  prospect: "New contact who has shown initial interest.",
  attendee: "Actively attending services or events.",
  following_up: "In the follow-up process with a team member.",
  interviewed: "Has completed an interview with leadership.",
  core_group: "Active member of the Core Group. Has signed a commitment card.",
  launch_team: "Part of the church launch team.",
  leader: "Serving in a leadership role.",
};
