import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AccountSection } from "@/components/settings/sections/account-section";
import { AssociationSection } from "@/components/settings/sections/association-section";
import { ChurchSection } from "@/components/settings/sections/church-section";
import { NotificationsSection } from "@/components/settings/sections/notifications-section";
import { SharingSection } from "@/components/settings/sections/sharing-section";
import { TeamSection } from "@/components/settings/sections/team-section";
import { SettingsModal } from "@/components/settings/settings-modal";
import { verifySession } from "@/lib/auth/session";
import { isOversightUser } from "@/lib/auth/tenancy";
import {
  DEFAULT_SETTINGS_SECTION,
  isSettingsSectionId,
  SETTINGS_SECTIONS,
  settingsSectionHref,
  settingsSectionsFor,
  type SettingsSectionId,
} from "@/lib/settings/sections";

/** The `[section]` route parameter, as Next hands it to a page. */
export type SettingsSectionParams = Promise<{ section: string }>;

/**
 * The section a `/settings/<section>` URL names.
 *
 * An id the registry does not know is a REDIRECT to the default section, not a
 * 404: a `notFound()` raised inside the modal's parallel slot escapes to the
 * root not-found boundary and replaces the whole screen the modal is supposed to
 * be sitting on top of. Bouncing corrects the address bar instead, which is what
 * the sibling pages did for a reader who could not open them.
 */
export async function settingsSectionFromParams(
  params: SettingsSectionParams
): Promise<SettingsSectionId> {
  const { section } = await params;
  if (!isSettingsSectionId(section)) {
    redirect(settingsSectionHref(DEFAULT_SETTINGS_SECTION));
  }
  return section;
}

/** The document title for a section route, taken from the registry's label. */
export async function settingsSectionMetadata(
  params: SettingsSectionParams
): Promise<Metadata> {
  const { section } = await params;
  const known = SETTINGS_SECTIONS.find((entry) => entry.id === section);
  return { title: known ? `${known.label} · Settings` : "Settings" };
}

// ============================================================================
// THE SETTINGS SURFACE — one server component, four routes (#615).
//
// `/settings`, `/settings/<section>` and their two intercepted twins all render
// this. What differs between them is ONE argument, `overlaid`, and it decides
// exactly one thing: what closing does. Everything else — the session, the gate,
// which sections the side navigation lists, which body draws — is resolved once,
// here, so the four route files stay three lines each and cannot drift.
//
// THE GATE IS THE REGISTRY'S, ASKED ONCE. `settingsSectionsFor` is the same
// answer the navigation is built from, so a section can never be listed and then
// refuse its reader, and a section can never be reachable by URL that the
// navigation would not have offered. The section bodies still re-state their own
// gates: the refusal that matters is the server action's, and a body that trusts
// its caller is a body that stops being safe the day somebody renders it
// elsewhere.
// ============================================================================

/**
 * One body per section id, as a total map rather than a switch.
 *
 * `Record<SettingsSectionId, …>` is the exhaustiveness check: adding an id to
 * the registry fails the build here until it has something to draw, which is
 * the one thing the registry cannot supply for itself.
 */
const SECTION_BODIES: Record<
  SettingsSectionId,
  () => Promise<React.ReactNode>
> = {
  account: AccountSection,
  church: ChurchSection,
  team: TeamSection,
  association: AssociationSection,
  notifications: NotificationsSection,
  sharing: SharingSection,
};

export async function SettingsSurface({
  sectionId,
  overlaid,
}: {
  sectionId: SettingsSectionId;
  /**
   * True when an intercepting route put this modal over a live screen, false
   * when the URL was loaded cold. The ROUTE knows which it is; nothing here can
   * work it out, and history length is not an answer.
   */
  overlaid: boolean;
}) {
  const { user } = await verifySession();

  const visible = settingsSectionsFor(user);
  if (!visible.some((section) => section.id === sectionId)) {
    // The same bounce the sibling pages did, to the one section every account
    // has. It cannot loop: `account` is visible to every signed-in account.
    redirect(settingsSectionHref(DEFAULT_SETTINGS_SECTION));
  }

  const Body = SECTION_BODIES[sectionId];

  return (
    <SettingsModal
      activeId={sectionId}
      visibleIds={visible.map((section) => section.id)}
      dismissal={
        overlaid
          ? { kind: "back" }
          : // Nothing is behind a cold load, so closing goes to the account's
            // own home rather than out of the app. Resolved here rather than
            // pushed at `/dashboard` and letting its redirect fire, because an
            // oversight account bouncing through a plant dashboard is a visible
            // flash on the way to the screen it was always going to reach.
            {
              kind: "replace",
              href: isOversightUser(user) ? "/oversight" : "/dashboard",
            }
      }
    >
      <Body />
    </SettingsModal>
  );
}
