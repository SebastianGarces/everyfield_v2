/**
 * THE ONE BACKGROUND-CHECK DISPLAY VOCABULARY.
 *
 * The status is read on two surfaces that share no component — the person
 * profile (a form control, a labelled row, a header badge) and a ministry-team
 * roster — so the label and the tint are declared once here and imported by
 * both. A second table is how the profile and the roster end up disagreeing
 * about what `flagged` is called.
 *
 * Import-free apart from the enum's own type: a `"use client"` roster renders
 * these, so nothing here may reach `@/db`.
 *
 * The tints follow the person-status scale (`status-colors.ts`): one hue
 * painted three ways — pale ground, deep ink, hairline border — mirrored in the
 * dark theme, on `variant: "outline"` so the badge contributes exactly one
 * ground, one ink and one border. `not_started` is the scale's zero and carries
 * no colour at all, for the same reason `prospect` does not: an untouched
 * volunteer is not a warning.
 */

import type { BackgroundCheckStatus } from "@/db/schema/people";

export type BackgroundCheckBadgeConfig = {
  label: string;
  variant: "secondary" | "outline";
  className: string;
};

export const BACKGROUND_CHECK_BADGE_CONFIG: Record<
  BackgroundCheckStatus,
  BackgroundCheckBadgeConfig
> = {
  not_started: {
    label: "Not started",
    variant: "secondary",
    className: "",
  },
  in_progress: {
    label: "In progress",
    variant: "outline",
    className:
      "bg-yellow-50 text-yellow-800 border-yellow-200 dark:bg-yellow-950 dark:text-yellow-200 dark:border-yellow-800",
  },
  cleared: {
    label: "Cleared",
    variant: "outline",
    className:
      "bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-200 dark:border-emerald-800",
  },
  flagged: {
    label: "Flagged",
    variant: "outline",
    className:
      "bg-red-50 text-red-800 border-red-200 dark:bg-red-950 dark:text-red-200 dark:border-red-800",
  },
};

/**
 * The badge for a STORED value — the one accessor every surface reads a row
 * through.
 *
 * Keyed through `Object.hasOwn` rather than a bare index: the column is
 * CHECK-constrained, but a row still arrives at a component as a string, and
 * `"constructor"` reaches `Object.prototype` past a `??` fallback. An
 * unrecognised value reads as the zero rather than as itself, because a roster
 * that renders a raw column value is worse than one that says nothing was
 * recorded.
 */
export function backgroundCheckBadge(
  status: string
): BackgroundCheckBadgeConfig {
  return Object.hasOwn(BACKGROUND_CHECK_BADGE_CONFIG, status)
    ? BACKGROUND_CHECK_BADGE_CONFIG[status as BackgroundCheckStatus]
    : BACKGROUND_CHECK_BADGE_CONFIG.not_started;
}
