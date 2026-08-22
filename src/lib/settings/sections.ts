import type { LucideIcon } from "lucide-react";
import { Bell, Building2, Church, UserRound, Users } from "lucide-react";

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
  | "notifications";

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
   * reachable by a link, but absent from the nav.
   *
   * Every section is in the nav today. The flag stays because the ruled nav is
   * a list of five and the registry is the only place a sixth could be added
   * unlisted — `sharing` was exactly that, from #615 until #619 folded its
   * panel into Church and deleted the entry.
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

/** A plant Owner whose plant exists — the account the Sharing section is about. */
function isPlanterWithPlant(viewer: SeatFields): boolean {
  return isPlantOwner(viewer);
}

/**
 * A plant ADMIN OR ABOVE — the account the Church section is about (CS-006).
 *
 * THE WIDENING #615 DEFERRED, MADE HERE ON PURPOSE (#618). That change moved
 * the zone and digest controls into this section and kept the old index block's
 * Owner-only gate, with the reason stated in its PR: "CS-006 widens the church
 * profile to Admin-and-above; doing it here would be a permission change
 * wearing a rename." This is the issue that owns the widening, so it happens
 * here, once, and the FRD row it answers is CS-006.
 *
 * It ASKS THE CAPABILITY TABLE rather than spelling a seat set, so the section's
 * visibility and its four writes are the same question — `church.profile` is
 * ADMIN_PLUS on a plant, and `setChurchProfileFieldAction` guards on exactly
 * that. A control beside an action guaranteed to refuse it is the visible half
 * of a permission drift (memory/invariants.md → Multi-Tenancy).
 *
 * SHARING DOES NOT COME WITH IT. The teaser inside the section stays gated on
 * `isPlanterWithPlant`, because consent to share a plant's activity is the
 * Owner's decision and always has been — see the section body.
 */
function isPlantAdminOrAbove(viewer: SeatFields): boolean {
  return holdsSeatFor(viewer, "church.profile");
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
      "Where this plant is and what to call it, how its dates and times are shown, and what it shares with its sending church or network.",
    icon: Church,
    // The sharing words are entry keywords rather than a section of their own
    // since #619 folded the panel in here. A planter looking for "privacy" was
    // one of the readers `/settings/sharing` served, and the search box is now
    // the only way that word reaches them.
    keywords: [
      "name",
      "address",
      "street",
      "city",
      "state",
      "region",
      "country",
      "location",
      "timezone",
      "time zone",
      "digest",
      "schedule",
      "weekday",
      "clock",
      "inactivity",
      "inactive",
      "quiet",
      "sharing",
      "privacy",
      "consent",
      "oversight",
      "sending church",
      "network",
    ],
    inNav: true,
    isVisibleTo: isPlantAdminOrAbove,
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
];

/**
 * Where `/settings` with no section lands — the one section every account has.
 */
export const DEFAULT_SETTINGS_SECTION: SettingsSectionId = "account";

/**
 * IDS THAT WERE REAL, AND THE SECTION THAT ABSORBED THEM.
 *
 * An unknown id bounces to the default section, which is right for a typo and
 * wrong for `/settings/sharing`: that was the consent panel's own address for
 * two releases, it is the one id in the product guaranteed to be in somebody's
 * history, and dropping its reader on Account tells a planter their privacy
 * controls were removed. #619 folded the panel into Church, so that is where the
 * URL goes.
 *
 * It is a REDIRECT, not a surviving route — the entry is deleted, the registry
 * is five, and nothing renders under the old id.
 */
export const RETIRED_SETTINGS_SECTIONS: Readonly<
  Record<string, SettingsSectionId>
> = {
  sharing: "church",
};

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
