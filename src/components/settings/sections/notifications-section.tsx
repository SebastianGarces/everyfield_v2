"use client";

import { EmailSuppressionNotice } from "@/components/notifications/email-suppression-notice";
import { PreferenceMatrix } from "@/components/notifications/preference-matrix";
import type { NotificationsSectionView } from "@/lib/settings/section-view";

// ============================================================================
// Notification preferences (N-006) — UNCHANGED, moved into the modal (#615) and
// re-fed from `section-data.ts` when the modal became client state (#657).
//
// The server resolves the whole section and hands this a finished view model:
// the matrix's rows and columns derived from the code registry, every cell
// resolved against the user's stored rows, and the digest cadence. Nothing about
// the set of categories is written down here — add a seventh to
// `notificationCategories` with its copy in
// `src/lib/notifications/categories.ts` and it appears, with its coded default,
// with no edit to this file.
//
// Preferences are per USER, not per church (a coach across two plants keeps one
// set of choices), so unlike every other dashboard surface this one takes no
// church scope. The owner is minted from the session and is the only thing the
// reads and writes will accept; see `settings/actions.ts`.
//
// THE DEEP LINK IS A FRAGMENT AGAIN (#657, ruling 2026-08-22 superseding the
// path half of 2026-08-21 §187) — but a fragment naming the SECTION, not a
// heading inside a long page. `NOTIFICATION_PREFERENCES_PATH` is
// `/dashboard#settings/notifications`, which the modal reads client-side, so
// there is still no `<h2 id>` here for a browser to scroll to and no exported
// anchor id to keep in step with one.
//
// This section therefore draws no heading of its own: the modal's own title
// says "Notifications" directly above it, and a second copy would be announced
// twice.
// ============================================================================

export function NotificationsSection({
  view,
}: {
  view: NotificationsSectionView;
}) {
  return (
    <div className="space-y-8">
      {/* ABOVE the matrix, because it changes what every row in it means: a
          suppressed address makes every `email` switch below inert, and a
          notice under them would be read after the reader had already concluded
          their settings were fine. */}
      {view.suppressedEmail && (
        <EmailSuppressionNotice email={view.suppressedEmail} />
      )}

      <PreferenceMatrix view={view.matrix} />
    </div>
  );
}
