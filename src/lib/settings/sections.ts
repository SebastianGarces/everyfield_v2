import type { LucideIcon } from "lucide-react";
import {
  Bell,
  Building2,
  Church,
  Share2,
  UserRound,
  Users,
} from "lucide-react";

import { holdsSeatFor } from "@/lib/auth/seat-rules";
import {
  isOrgOwner,
  isPlantOwner,
  oversightOrgOf,
  type SeatFields,
} from "@/lib/auth/tenancy";

// ============================================================================
// THE SETTINGS REGISTRY — the one list of sections (CS-001, #615).
//
// Ruled 2026-08-21 §187: settings is a modal over whatever screen the reader is
// on, and "one settings registry — section id, label, icon, entry keywords,
// required capability — drives the side nav, the search, and which sections
// render for which account shape, so the section list is data, not per-page
// conditionals".
//
// This module is that list, and it is the ONLY one. Three consumers read it and
// none of them keeps a copy:
//
//   * the side navigation and the search box (`settings-modal.tsx`), which is a
//     CLIENT component — so nothing here may reach `@/db`. Both value imports
//     are the import-free leaves that exist for exactly this (`./seat-rules`
//     carries the argument in its own header);
//   * the routes, which resolve `/settings/<section>` through
//     `isSettingsSectionId` and refuse anything else;
//   * `settingsSectionsFor`, which is the ONE answer to "which sections does
//     this account see" — the gates below are the same predicates the old
//     sibling pages redirected on, moved here rather than re-derived.
//
// A NEW SECTION IS A NEW ENTRY AND NOTHING ELSE. It appears in the nav, becomes
// searchable, gains a URL and gains its gate by being added to the array; the
// only other file it needs is the component that draws its body
// (`@/components/settings/sections/`), wired in `settings-surface.tsx`.
// ============================================================================

export type SettingsSectionId =
  | "account"
  | "church"
  | "team"
  | "association"
  | "notifications"
  | "sharing";

export type SettingsSection = {
  id: SettingsSectionId;
  /** The side-nav entry, the pane heading and the document title. */
  label: string;
  /** The sentence under the pane heading. One per section, never per role. */
  description: string;
  icon: LucideIcon;
  /**
   * What the reader might TYPE to find this section — the names of the entries
   * inside it, which the labels alone do not carry. "Timezone" and "digest" are
   * both in the Church section and neither is the word "Church" (CS-016).
   */
  keywords: readonly string[];
  /**
   * Whether the side navigation lists it. `false` means addressable by URL and
   * reachable by a link, but absent from the nav — see `sharing` below.
   */
  inNav: boolean;
  /** Who may open it. The same question the section's own writes are guarded with. */
  isVisibleTo: (viewer: SeatFields) => boolean;
};

// ----------------------------------------------------------------------------
// The gates
//
// Named for what they mean rather than inlined, because two of them are read
// twice and because `answer-surfaces.test.ts` holds the association surface to
// these names: an account an org may TARGET must have somewhere in the product
// to answer from, and this is now the gate that decides whether that somewhere
// renders.
// ----------------------------------------------------------------------------

/** A plant Owner whose plant exists — the account the Church section is about. */
function isPlanterWithPlant(viewer: SeatFields): boolean {
  return isPlantOwner(viewer);
}

/**
 * A sending church's Owner (#304 WS3, ruled 2026-08-09).
 *
 * BOTH HALVES (#500). An org has Members now, and every write behind the
 * Association section is Owner-only by ruling 185 (1), so the tenancy alone
 * would list a section whose every control refuses its reader.
 */
function isSendingChurchAdminWithOrg(viewer: SeatFields): boolean {
  return (
    oversightOrgOf(viewer)?.type === "sending_church" && isOrgOwner(viewer)
  );
}

/** The union of the two accounts that can answer an invitation or leave an org. */
function canManageAssociation(viewer: SeatFields): boolean {
  return isPlanterWithPlant(viewer) || isSendingChurchAdminWithOrg(viewer);
}

/** Every signed-in account, in any tenancy. */
function everyAccount(): boolean {
  return true;
}

export const SETTINGS_SECTIONS: readonly SettingsSection[] = [
  {
    id: "account",
    label: "Account",
    description: "Who you are signed in as.",
    icon: UserRound,
    keywords: ["profile", "email", "password", "photo", "name", "sign in"],
    inNav: true,
    isVisibleTo: everyAccount,
  },
  {
    id: "church",
    label: "Church",
    description:
      "How this plant's dates and times are shown, and when its digest arrives.",
    icon: Church,
    keywords: [
      "timezone",
      "time zone",
      "digest",
      "schedule",
      "weekday",
      "clock",
    ],
    inNav: true,
    isVisibleTo: isPlanterWithPlant,
  },
  {
    id: "team",
    label: "Team",
    description: "Who has a login here, and who is still to answer.",
    icon: Users,
    keywords: ["invite", "seats", "roster", "admin", "coach", "remove"],
    inNav: true,
    isVisibleTo: (viewer) => holdsSeatFor(viewer, "seat.invitation.manage"),
  },
  {
    id: "association",
    label: "Association",
    description:
      "Who your organization belongs to, and any invitation waiting on your answer.",
    icon: Building2,
    keywords: ["sending church", "network", "invitation", "leave", "join"],
    inNav: true,
    isVisibleTo: canManageAssociation,
  },
  {
    id: "notifications",
    label: "Notifications",
    description:
      "Choose what you hear about, and where. Changes save as you make them and apply from the next send.",
    icon: Bell,
    keywords: ["email", "in-app", "digest", "unsubscribe", "preferences"],
    inNav: true,
    isVisibleTo: everyAccount,
  },
  {
    id: "sharing",
    label: "Sharing",
    /**
     * ABSENT FROM THE NAV, DELIBERATELY (#615). The ruled section list is the
     * five above; CS-011 folds the sharing panel into the Church section, and
     * until it does this entry keeps `/settings/sharing` — a URL that is in
     * emails and in `OVERSIGHT_CONSENT_SURFACES` — working unchanged, reached
     * by the link the Church section already draws.
     *
     * It is an ENTRY rather than a surviving sibling route because the modal
     * intercepts every `/settings/*` path: a route the registry did not know
     * about would open as a 404 inside the modal.
     */
    description: "What your sending church or network hears about this plant.",
    icon: Share2,
    keywords: ["oversight", "consent", "privacy", "sending church", "network"],
    inNav: false,
    isVisibleTo: isPlanterWithPlant,
  },
];

/**
 * Where `/settings` with no section lands — the one section every account has.
 */
export const DEFAULT_SETTINGS_SECTION: SettingsSectionId = "account";

export function isSettingsSectionId(value: string): value is SettingsSectionId {
  return SETTINGS_SECTIONS.some((section) => section.id === value);
}

export function settingsSectionHref(id: SettingsSectionId): string {
  return `/settings/${id}`;
}

/**
 * The sections this account may open, in registry order.
 *
 * The ORDER is the array's, so the nav, the search results and the tab order
 * are one sequence that no consumer sorts for itself.
 */
export function settingsSectionsFor(viewer: SeatFields): SettingsSection[] {
  return SETTINGS_SECTIONS.filter((section) => section.isVisibleTo(viewer));
}

/**
 * Does this query match the section? Label first, then the entries inside it.
 *
 * Case- and position-insensitive on purpose: a reader typing "zone" is looking
 * for the timezone control, which is inside a section called "Church".
 */
export function sectionMatchesQuery(
  section: SettingsSection,
  query: string
): boolean {
  const needle = query.trim().toLowerCase();
  if (needle === "") return true;
  // BOTH SIDES ARE LOWERCASED. Every keyword above happens to be lowercase
  // today, so folding only the needle would work — right up to the first entry
  // that writes "Sunday" or "UTC", which would then be silently unsearchable
  // with nothing to fail.
  return (
    section.label.toLowerCase().includes(needle) ||
    section.keywords.some((keyword) => keyword.toLowerCase().includes(needle))
  );
}
