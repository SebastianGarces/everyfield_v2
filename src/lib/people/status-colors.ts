/**
 * Shared status badge configuration.
 * Single source of truth for status colors and variants used across
 * person-card, person-header, and person-status-card. Labels come from
 * STATUS_LABELS (status.shared.ts) — the one label map in the domain.
 *
 * ## The scale — direction B, "tinted editorial" (RULED 2026-08-13, #429)
 *
 * Four directions were built as live prototypes and compared on a preview
 * (draft PR #431); Sebastian ruled B. Every status that carries a colour paints
 * the SAME HUE three times:
 *
 *   pale ground + deep ink + a hairline border, one step between the ground and
 *   the border, and the dark theme MIRRORS it — deep ground, pale ink.
 *
 * That is why each entry spells six classes rather than one fill. What the
 * shape buys, and what a later edit must not give back:
 *
 *  - **AA with headroom, in both themes.** The scale it replaced painted a
 *    saturated 500-level fill under whichever label the Badge variant supplied
 *    and failed AA on eight of its twelve status/theme pairs — worst 1.91:1
 *    (`bg-yellow-500 text-white`), which Lighthouse flagged on `/people`. Every
 *    pair here clears 4.5:1 by a wide margin. The numbers are not written down
 *    anywhere: `src/app/theme-tokens.test.ts` re-derives all fourteen from
 *    Tailwind's own `theme.css` and requires AA of every one, with no deferral
 *    list left to add to.
 *  - **Prospect stays neutral**, part of the ruling rather than an omission: it
 *    is the pipeline's zero and carries the token-backed `secondary` variant, so
 *    it declares no colour classes at all.
 *  - **Attendee and Launch Team stay on ONE hue** and separate by TINT LEVEL
 *    (blue 50/200 against blue 100/300, mirrored in the dark theme). The ruling
 *    considered splitting them onto different hues and declined. Splitting them
 *    now needs a new ruling, not a commit.
 *
 * `variant: "outline"` is the honest carrier for a bordered badge: its own
 * `border-border` / `text-foreground` are the only colours it contributes and
 * both are overridden here, so exactly one ground, one ink and one border reach
 * the DOM. There is no hover fill — a badge is not a control, and a tint that
 * darkens under the pointer claims it is.
 *
 * A new status joins by writing all six classes on one hue. Write fewer and the
 * suite fails naming the missing half; write a hue whose ink does not clear AA
 * on its ground and it fails with the measured number.
 */

import type { PersonStatus } from "@/lib/people/types";
import { STATUS_LABELS } from "./status.shared";

export type StatusBadgeConfig = {
  label: string;
  className: string;
  variant: "secondary" | "outline";
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
    className:
      "bg-blue-50 text-blue-800 border-blue-200 dark:bg-blue-950 dark:text-blue-200 dark:border-blue-800",
    variant: "outline",
  },
  following_up: {
    label: STATUS_LABELS.following_up,
    className:
      "bg-yellow-50 text-yellow-800 border-yellow-200 dark:bg-yellow-950 dark:text-yellow-200 dark:border-yellow-800",
    variant: "outline",
  },
  interviewed: {
    label: STATUS_LABELS.interviewed,
    className:
      "bg-purple-50 text-purple-800 border-purple-200 dark:bg-purple-950 dark:text-purple-200 dark:border-purple-800",
    variant: "outline",
  },
  core_group: {
    label: STATUS_LABELS.core_group,
    className:
      "bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-200 dark:border-emerald-800",
    variant: "outline",
  },
  launch_team: {
    // One step up the same blue as `attendee`, by ruling: the two nearest rungs
    // of the pipeline read as one family, told apart by weight.
    label: STATUS_LABELS.launch_team,
    className:
      "bg-blue-100 text-blue-900 border-blue-300 dark:bg-blue-900 dark:text-blue-200 dark:border-blue-700",
    variant: "outline",
    icon: "rocket",
  },
  leader: {
    label: STATUS_LABELS.leader,
    className:
      "bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950 dark:text-amber-200 dark:border-amber-800",
    variant: "outline",
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
