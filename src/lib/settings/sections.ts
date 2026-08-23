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
// conditionals". Ruled again 2026-08-22 (#657): its address is a FRAGMENT, and
// the grammar of that fragment is at the foot of this file.
//
// This module is that list, and it is the ONLY one. Three consumers read it and
// none of them keeps a copy:
//
//   * the modal (`settings-modal.tsx`), which is a CLIENT component — so
//     nothing here may reach `@/db`. Both value imports are the import-free
//     leaves that exist for exactly this (`./seat-rules` carries the argument in
//     its own header). It reads the nav, the search, and `#settings/<id>`;
//   * `loadSettingsSection` (`./section-data.ts`), which resolves the id the
//     browser asks for through `isSettingsSectionId` and refuses anything else;
//   * `settingsSectionsFor`, which is the ONE answer to "which sections does
//     this account see" — the gates below are the same predicates the old
//     sibling pages redirected on, moved here rather than re-derived. It is
//     asked TWICE, and that is deliberate: the layout asks it to build the nav,
//     and the loader asks it again before reading a row, so the visible list and
//     the served section cannot disagree.
//
// A NEW SECTION IS A NEW ENTRY AND NOTHING ELSE. It appears in the nav, becomes
// searchable, gains an address and gains its gate by being added to the array;
// the only other files it needs are its view model (`./section-view.ts`), the
// read that fills it (`./section-data.ts`) and the component that draws it
// (`@/components/settings/sections/`) — each of which is a total map over this
// type, so the build names all three the moment an id is added.
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
    // WHAT AN ADMIN ACTUALLY GETS, and no more. The sentence used to end "and
    // what it shares with its sending church or network", which is the Sharing
    // block — gated on `isPlanterWithPlant`, so an Admin was promised a control
    // their pane never draws. The section's own gate is wider than that block's
    // (see `isPlantAdminOrAbove`), so the description names only the half every
    // reader who can open it can use.
    description:
      "Where this plant is, what to call it, and how its dates and times are shown.",
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
      "Who you belong to, and any invitation waiting on your answer.",
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

// ----------------------------------------------------------------------------
// THE ADDRESS — a fragment, not a route (#657, ruled 2026-08-22)
//
// Settings is client state layered over whatever screen the reader is on, so its
// address is the part of the URL that never reaches the server:
// `/meetings#settings/church`. Everything below is the whole grammar of it, and
// it lives beside the registry because the set of legal addresses IS the section
// list.
//
// This reverses the "real paths, never a hash" half of ruling 2026-08-21 §187.
// That ruling's reason — the server must be able to see which section to render
// — stopped applying when the sections became client-rendered: they are fed by
// `loadSettingsSection`, which the browser calls with the id it read here.
// ----------------------------------------------------------------------------

/** What marks a fragment as a settings address, before the section id. */
const SETTINGS_HASH_PREFIX = "settings";

/**
 * The fragment for a section — what a link on a dashboard screen points at.
 *
 * Relative on purpose: settings opens over the CURRENT page, so the href carries
 * no path and following it changes no route.
 */
export function settingsSectionHref(id: SettingsSectionId): string {
  return `#${SETTINGS_HASH_PREFIX}/${id}`;
}

/**
 * Where the dashboard opens a settings section from OUTSIDE the app — mail, a
 * bookmark, the old `/settings/*` redirects.
 *
 * A fragment needs a page to sit on, and `/dashboard` is the one every account
 * can reach: an oversight account is bounced from it to `/oversight` by the
 * page's own redirect, carrying the fragment with it, because a browser
 * re-applies a fragment across a redirect whose Location carries none.
 */
export const SETTINGS_HOST_PATH = "/dashboard";

export function settingsSectionUrl(id: SettingsSectionId): string {
  return `${SETTINGS_HOST_PATH}${settingsSectionHref(id)}`;
}

/**
 * The section a fragment names, or `null` when it names no settings at all.
 *
 * Total on purpose — every string a browser can put in `location.hash` has an
 * answer, and only two of them are interesting:
 *
 *   * `#settings` and `#settings/<unknown>` open the DEFAULT section rather than
 *     closing, so a typo or a retired id lands somewhere real. This is the same
 *     correction the deleted routes made with a redirect;
 *   * `#settings/sharing` is the one retired id in the wild
 *     (`RETIRED_SETTINGS_SECTIONS`) and goes where its panel went.
 *
 * `settings-modal.tsx` rewrites the fragment to `settingsSectionHref` of what
 * comes back, so the address bar cannot keep saying something the modal is not
 * showing — a bookmarked `#settings/sharing` corrects itself to Church on the
 * way in.
 */
export function settingsSectionFromHash(
  hash: string
): SettingsSectionId | null {
  const fragment = hash.startsWith("#") ? hash.slice(1) : hash;
  if (
    fragment !== SETTINGS_HASH_PREFIX &&
    !fragment.startsWith(`${SETTINGS_HASH_PREFIX}/`)
  ) {
    return null;
  }
  return resolveSettingsSection(
    fragment.slice(SETTINGS_HASH_PREFIX.length + 1)
  );
}

/**
 * The section an id NAMES, corrected — total, so it never needs a `!`.
 *
 * Split from the parse above because the retired `/settings/*` redirects ask
 * exactly this and have already established that they are looking at a settings
 * address. One spelling of "what does this id mean", read by the fragment parser
 * and by the two redirect pages, so a retired id cannot go one place from the
 * address bar and another from a mailed link.
 */
export function resolveSettingsSection(id: string): SettingsSectionId {
  if (isSettingsSectionId(id)) return id;
  return RETIRED_SETTINGS_SECTIONS[id] ?? DEFAULT_SETTINGS_SECTION;
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
