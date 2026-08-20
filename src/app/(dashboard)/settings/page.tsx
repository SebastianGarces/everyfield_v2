import type { Metadata } from "next";
import Link from "next/link";

import { HeaderBreadcrumbs } from "@/components/header";
import { EmailSuppressionNotice } from "@/components/notifications/email-suppression-notice";
import { PreferenceMatrix } from "@/components/notifications/preference-matrix";
import { ChurchTimeZoneSelect } from "@/components/settings/church-time-zone-select";
import { holdsSeatFor } from "@/lib/auth/seat-rules";
import { getCurrentUserChurch, verifySession } from "@/lib/auth/session";
import { isPlantOwner, oversightOrgOf } from "@/lib/auth/tenancy";
import { OVERSIGHT_SHARING_TEASER } from "@/lib/notifications/categories";
import { NOTIFICATION_PREFERENCES_HEADING_ID } from "@/lib/notifications/channels/email";
import { isAddressSuppressed } from "@/lib/notifications/channels/suppression";
import {
  audienceForTenancy,
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
  const church = isPlantOwner(session.user)
    ? await getCurrentUserChurch()
    : null;
  // The matrix must be resolved against the SAME audience the feed, the badge
  // and the dispatcher resolve against, or an absent row renders as one value
  // here and behaves as another there (N-027).
  const view = buildPreferenceMatrixView(
    await loadUserPreferences(owner),
    audienceForTenancy(session.user)
  );

  // #324. Asked for the SESSION'S OWN address and nowhere else: this is the one
  // screen that can say "we stopped emailing you" to the person who can do
  // something about it. Absent a suppression the read returns false and nothing
  // renders, so the ordinary case costs one bounded query and shows no notice.
  const emailSuppressed = await isAddressSuppressed(session.user.email);

  const isPlanterWithPlant = isPlantOwner(session.user);

  // #304 WS3 (ruled 2026-08-09): `/settings/association` serves TWO tenancies
  // now — the plant's Owner answering for their plant, and a sending church's
  // answering a network's invitation for their org. The link has to be visible
  // to both or the second half of "no invitation that cannot be answered"
  // (`memory/invariants.md` → Multi-Tenancy) is a page nobody can find. The
  // condition mirrors the page's own guard exactly; anyone else is redirected
  // there, and every write behind it refuses them again server-side.
  const isSendingChurchAdminWithOrg =
    oversightOrgOf(session.user)?.type === "sending_church";
  const canManageAssociation =
    isPlanterWithPlant || isSendingChurchAdminWithOrg;

  // The SAME question `/settings/team` redirects on and its actions guard with
  // (#495), asked through the one capability table rather than re-derived here —
  // a link an Admin can see leading to a page that redirects them is the visible
  // half of a permission drift.
  const canManageTeam = holdsSeatFor(session.user, "seat.invitation.manage");

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
          aria-labelledby={NOTIFICATION_PREFERENCES_HEADING_ID}
          className="space-y-4"
        >
          <div className="space-y-1">
            <h2
              id={NOTIFICATION_PREFERENCES_HEADING_ID}
              className="text-lg font-semibold tracking-tight"
            >
              Notifications
            </h2>
            <p className="text-muted-foreground text-sm">
              Choose what you hear about, and where. Changes save as you make
              them and apply from the next send.
            </p>
          </div>

          {/* INSIDE the section and ABOVE the matrix, because it changes what
              every row in it means: a suppressed address makes every `email`
              switch below inert, and a notice under them would be read after
              the reader had already concluded their settings were fine.

              Inside, not above the heading, because the heading is what the
              deep link lands on (#467) — every email and /unsubscribe now send
              readers to `#notification-preferences`, and a notice sitting above
              that anchor is scrolled off the top of the screen for exactly the
              readers who most need to see it. */}
          {emailSuppressed && (
            <EmailSuppressionNotice email={session.user.email} />
          )}

          <PreferenceMatrix view={view} />
        </section>

        {church && (
          <section aria-labelledby="church-timezone" className="space-y-4">
            <div className="space-y-1">
              <h2
                id="church-timezone"
                className="text-lg font-semibold tracking-tight"
              >
                Church
              </h2>
              <p className="text-muted-foreground text-sm">
                How this plant&apos;s dates and times are shown.
              </p>
            </div>
            <ChurchTimeZoneSelect timeZone={church.timeZone} />
          </section>
        )}

        {/* The one setting on the neighbouring screen, linked rather than
            inlined. It is a different KIND of decision — church-wide, about
            what leaves the plant, and the planter's alone — and folding it into
            a personal notification matrix would make a consent choice read as
            one more switch about email volume (N-026). Shown only to a planter
            with a plant, which is exactly who the target screen serves.

            The copy names the exceptions rather than omitting them, and it is
            NOT written here. This toggle gates what is PUSHED to oversight —
            the digest and the two gated milestones — but not the THREE types in
            OVERSIGHT_SHARING_EXEMPT_TYPES, each of which is the inviting org's
            own relationship changing: an invitation accepted, an invitation
            declined, an association ended (ruled 2026-08-01 for the accept,
            extended to all three on 2026-08-10, round 5 of #304). "No updates
            unless you turn sharing on" is therefore false three times over, and
            the version of this teaser that named only the accept was false
            twice — it told a planter their decline and their departure were
            covered by a switch that has never gated either.

            That is why the sentence now comes from OVERSIGHT_SHARING_TEASER in
            src/lib/notifications/categories.ts and this file renders it
            unchanged. A hardcoded sibling sentence is invisible to the guard
            that keeps the sharing screen honest, which is exactly how this one
            drifted; oversight.test.ts now checks every surface in
            OVERSIGHT_CONSENT_SURFACES against the exempt list itself.

            It is also not "nothing": the oversight dashboard already lists the
            plant with its name, current stage and launch date, ungated — see
            the header of OVERSIGHT_SHARING_TOGGLE. A teaser that promises more
            than the setting delivers is the one way this feature can fail its
            own purpose. */}
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

        {/* #495 / AS-014 — the third org-wide decision, on the same "linked
            rather than inlined" footing as Association and Sharing. Who has a
            login on this plant is not a preference about email volume either.

            Shown on the same rule the page itself guards with — an Admin
            reaches it as well as the Owner, which is what `seat.invitation.manage`
            says and what `/settings/team` redirects on. */}
        {canManageTeam && (
          <section aria-labelledby="team-link" className="space-y-1">
            <h2 id="team-link" className="text-lg font-semibold tracking-tight">
              Team
            </h2>
            <p className="text-muted-foreground text-sm text-pretty">
              Invite people onto this church plant, and see who is still to
              answer.{" "}
              <Link
                href="/settings/team"
                className="cursor-pointer font-medium underline underline-offset-4"
              >
                Manage your team
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
              {OVERSIGHT_SHARING_TEASER}{" "}
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
