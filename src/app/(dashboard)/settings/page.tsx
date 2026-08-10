import type { Metadata } from "next";
import Link from "next/link";

import { HeaderBreadcrumbs } from "@/components/header";
import { PreferenceMatrix } from "@/components/notifications/preference-matrix";
import { verifySession } from "@/lib/auth/session";
import {
  audienceForRole,
  buildPreferenceMatrixView,
  loadUserPreferences,
  preferenceOwnerFromSession,
} from "@/lib/notifications/preferences";

// ============================================================================
// Screen 2 — notification preferences (N-006).
//
// The server resolves the whole screen and hands the client component a
// finished view model: the matrix's rows and columns derived from the code
// registry, every cell resolved against the user's stored rows, and the digest
// cadence. Nothing about the set of categories is written down here — add a
// seventh to `notificationCategories` with its copy in
// `src/lib/notifications/categories.ts` and it appears, with its coded default,
// with no edit to this file.
//
// Preferences are per USER, not per church (a coach across two plants keeps one
// set of choices), so unlike every other dashboard screen this one takes no
// church scope — and unlike every other screen there is no id in the URL to
// scope it by either. The owner is minted from the session and is the only
// thing the reads and writes will accept; see `actions.ts`.
// ============================================================================

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Settings",
};

export default async function SettingsPage() {
  const session = await verifySession();
  const owner = preferenceOwnerFromSession(session);
  // The matrix must be resolved against the SAME audience the feed, the badge
  // and the dispatcher resolve against, or an absent row renders as one value
  // here and behaves as another there (N-027).
  const view = buildPreferenceMatrixView(
    await loadUserPreferences(owner),
    audienceForRole(session.user.role)
  );

  const isPlanterWithPlant =
    session.user.role === "planter" && Boolean(session.user.churchId);

  // #304 WS3 (ruled 2026-08-09): `/settings/association` serves TWO roles now —
  // the planter answering for their plant, and a sending-church admin answering
  // a network's invitation for their sending church. The link has to be visible
  // to both or the second half of "no invitation that cannot be answered"
  // (`memory/invariants.md` → Multi-Tenancy) is a page nobody can find. The
  // condition mirrors the page's own guard exactly; anyone else is redirected
  // there, and every write behind it refuses them again server-side.
  const isSendingChurchAdminWithOrg =
    session.user.role === "sending_church_admin" &&
    Boolean(session.user.sendingChurchId);
  const canManageAssociation =
    isPlanterWithPlant || isSendingChurchAdminWithOrg;

  return (
    <>
      <HeaderBreadcrumbs items={[{ label: "Settings" }]} />

      <div className="mx-auto w-full max-w-3xl space-y-8 p-4 md:p-6">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
          <p className="text-muted-foreground text-sm">
            How EveryField reaches you.
          </p>
        </div>

        <section
          aria-labelledby="notification-preferences"
          className="space-y-4"
        >
          <div className="space-y-1">
            <h2
              id="notification-preferences"
              className="text-lg font-semibold tracking-tight"
            >
              Notifications
            </h2>
            <p className="text-muted-foreground text-sm">
              Choose what you hear about, and where. Changes save as you make
              them and apply from the next send.
            </p>
          </div>

          <PreferenceMatrix view={view} />
        </section>

        {/* The one setting on the neighbouring screen, linked rather than
            inlined. It is a different KIND of decision — church-wide, about
            what leaves the plant, and the planter's alone — and folding it into
            a personal notification matrix would make a consent choice read as
            one more switch about email volume (N-026). Shown only to a planter
            with a plant, which is exactly who the target screen serves.

            The copy names the exception rather than omitting it. This toggle
            gates what is PUSHED to oversight — the digest and the two gated
            milestones — but NOT "your invitation was accepted", which is
            exempt (ruled 2026-08-01) because it is the inviting org's own
            event. "No updates unless you turn sharing on" was therefore false
            for the one message a planter is most likely to have already
            caused. It is also not "nothing": the oversight dashboard already
            lists the plant with its name, current stage and launch date,
            ungated — see the header of OVERSIGHT_SHARING_TOGGLE. A teaser that
            promises more than the setting delivers is the one way this feature
            can fail its own purpose. */}
        {/* #304 / OV-004 — the other org-wide decision, on the same "linked
            rather than inlined" footing as Sharing below. The two are
            neighbours on purpose: this one decides WHO your organization
            belongs to, that one decides what they hear about it, and neither is
            a preference about email volume.

            Shown to BOTH roles that can answer an invitation since #304 WS3 —
            the planter for their plant, a sending-church admin for their
            sending church. A link only a planter can see was the visible half
            of the dead end HR4 found. */}
        {canManageAssociation && (
          <section aria-labelledby="association-link" className="space-y-1">
            <h2
              id="association-link"
              className="text-lg font-semibold tracking-tight"
            >
              Association
            </h2>
            <p className="text-muted-foreground text-sm text-pretty">
              {/* BOTH branches name the LEAVE control, because both roles have
                  one (OV-013 gave the sending church admin `LeaveNetworkDialog`
                  on the same route's second view). The admin's sentence used to
                  stop at "see which network your sending church belongs to",
                  which described the screen as read-only and was the copy half
                  of the dead end HR4 found on the planter's side: a control
                  nobody is told about is a control nobody uses. */}
              {isPlanterWithPlant
                ? "Answer an invitation from a sending church or network, see who your plant belongs to, and leave an organization. "
                : "Answer an invitation from a church planting network, see which network your sending church belongs to, and leave it. "}
              <Link
                href="/settings/association"
                className="cursor-pointer font-medium underline underline-offset-4"
              >
                Manage your association
              </Link>
            </p>
          </section>
        )}

        {isPlanterWithPlant && (
          <section aria-labelledby="sharing-link" className="space-y-1">
            <h2
              id="sharing-link"
              className="text-lg font-semibold tracking-tight"
            >
              Sharing
            </h2>
            <p className="text-muted-foreground text-sm text-pretty">
              Apart from being told you accepted their invitation, your sending
              church and network get no updates about this plant unless you turn
              sharing on.{" "}
              <Link
                href="/settings/sharing"
                className="cursor-pointer font-medium underline underline-offset-4"
              >
                Choose what you share
              </Link>
            </p>
          </section>
        )}
      </div>
    </>
  );
}
