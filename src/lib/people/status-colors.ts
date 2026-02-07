/**
 * Shared status badge configuration.
 * Single source of truth for status colors, labels, and variants
 * used across person-card, person-header, and person-status-card.
 */

import type { PersonStatus } from "@/lib/people/types";

export type StatusBadgeConfig = {
  label: string;
  className: string;
  variant: "secondary" | "default";
  /** Icon identifier — components render the actual icon element */
  icon?: "rocket" | "star";
};

export const STATUS_BADGE_CONFIG: Record<PersonStatus, StatusBadgeConfig> = {
  prospect: {
    label: "Prospect",
    className: "",
    variant: "secondary",
  },
  attendee: {
    label: "Attendee",
    className: "bg-blue-500 hover:bg-blue-600",
    variant: "default",
  },
  following_up: {
    label: "Following Up",
    className: "bg-yellow-500 text-white hover:bg-yellow-600",
    variant: "default",
  },
  interviewed: {
    label: "Interviewed",
    className: "bg-purple-500 hover:bg-purple-600",
    variant: "default",
  },
  committed: {
    label: "Committed",
    className: "bg-green-500 hover:bg-green-600",
    variant: "default",
  },
  core_group: {
    label: "Core Group",
    className: "bg-emerald-600 hover:bg-emerald-700",
    variant: "default",
  },
  launch_team: {
    label: "Launch Team",
    className: "bg-blue-600 hover:bg-blue-700",
    variant: "default",
    icon: "rocket",
  },
  leader: {
    label: "Leader",
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
  committed: "Has signed a commitment card.",
  core_group: "Active member of the core group.",
  launch_team: "Part of the church launch team.",
  leader: "Serving in a leadership role.",
};
