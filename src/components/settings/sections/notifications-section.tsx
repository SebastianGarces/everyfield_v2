import { EmailSuppressionNotice } from "@/components/notifications/email-suppression-notice";
import { PreferenceMatrix } from "@/components/notifications/preference-matrix";
import { verifySession } from "@/lib/auth/session";
import { isAddressSuppressed } from "@/lib/notifications/channels/suppression";
import {
  audienceForTenancy,
  buildPreferenceMatrixView,
  loadUserPreferences,
  preferenceOwnerFromSession,
} from "@/lib/notifications/preferences";

// ============================================================================
// Notification preferences (N-006) — UNCHANGED, moved into the modal (#615).
//
// The server resolves the whole section and hands the client component a
// finished view model: the matrix's rows and columns derived from the code
// registry, every cell resolved against the user's stored rows, and the digest
// cadence. Nothing about the set of categories is written down here — add a
// seventh to `notificationCategories` with its copy in
// `src/lib/notifications/categories.ts` and it appears, with its coded default,
// with no edit to this file.
//
// Preferences are per USER, not per church (a coach across two plants keeps one
// set of choices), so unlike every other dashboard surface this one takes no
// church scope — and there is no id in the URL to scope it by either. The owner
// is minted from the session and is the only thing the reads and writes will
// accept; see `settings/actions.ts`.
//
// THE DEEP LINK IS A ROUTE NOW, NOT A FRAGMENT (#615, ruling 2026-08-21 §187).
// Every notification email and `/unsubscribe` used to send readers to
// `/settings#notification-preferences` (#467), which needed an `<h2 id>` here
// for the browser to scroll to. `NOTIFICATION_PREFERENCES_PATH` is
// `/settings/notifications` now — the section has a URL of its own, the server
// sees it, and the modal opens on it. So the anchor and the id it needed are
// both gone rather than kept as a second way to address the same thing.
//
// This section therefore draws no heading of its own: the modal's own title
// says "Notifications" directly above it, and a second copy would be announced
// twice.
// ============================================================================

export async function NotificationsSection() {
  const session = await verifySession();
  const owner = preferenceOwnerFromSession(session);

  // The matrix must be resolved against the SAME audience the feed, the badge
  // and the dispatcher resolve against, or an absent row renders as one value
  // here and behaves as another there (N-027).
  const view = buildPreferenceMatrixView(
    await loadUserPreferences(owner),
    audienceForTenancy(session.user)
  );

  // #324. Asked for the SESSION'S OWN address and nowhere else: this is the one
  // surface that can say "we stopped emailing you" to the person who can do
  // something about it. Absent a suppression the read returns false and nothing
  // renders, so the ordinary case costs one bounded query and shows no notice.
  const emailSuppressed = await isAddressSuppressed(session.user.email);

  return (
    <div className="space-y-4">
      {/* ABOVE the matrix, because it changes what every row in it means: a
          suppressed address makes every `email` switch below inert, and a
          notice under them would be read after the reader had already concluded
          their settings were fine. */}
      {emailSuppressed && <EmailSuppressionNotice email={session.user.email} />}

      <PreferenceMatrix view={view} />
    </div>
  );
}
